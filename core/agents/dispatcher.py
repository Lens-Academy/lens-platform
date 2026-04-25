"""Platform-agnostic multi-agent message dispatcher with handoff support."""

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from litellm import acompletion
from sqlalchemy import select

from core.agents.agent import Agent
from core.agents.caching import estimate_input_tokens, apply_cache_control
from core.agents.coach.context import build_context_block
from core.agents.identity import PlatformIdentity, resolve_user_id
from core.agents.registry import AGENT_REGISTRY, default_agent_for
from core.agents.sessions import load_or_create_open_ended_session, save_session
from core.agents.tools.transfer import build_all_transfer_tools
from core.agents.user_files import load_user_files
from core.database import get_connection
from core.tables import users

logger = logging.getLogger(__name__)

MAX_HANDOFFS_PER_TURN = 1
MAX_INPUT_TOKENS = 50_000
MAX_TOOL_ROUNDS = 5
TOKEN_SAFETY_MARGIN = 5_000
LOCK_TIMEOUT_SECONDS = 120

_user_locks: dict[int, asyncio.Lock] = {}


@dataclass
class HandleResult:
    kind: str  # "ok" or "error"
    reply_text: str


@dataclass
class _HandoffInfo:
    target: str
    tool_call_id: str


def _get_user_lock(user_id: int) -> asyncio.Lock:
    if user_id not in _user_locks:
        _user_locks[user_id] = asyncio.Lock()
    return _user_locks[user_id]


async def _get_user_timezone(user_id: int) -> str | None:
    """Get the user's IANA timezone string, or None."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(users.c.timezone).where(users.c.user_id == user_id)
        )
        row = result.first()
    return row.timezone if row else None


def _derive_active_agent(messages: list[dict], platform: str) -> Agent:
    """Derive the active agent from the last assistant message's agent tag."""
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and "agent" in msg:
            agent_name = msg["agent"]
            if agent_name in AGENT_REGISTRY:
                return AGENT_REGISTRY[agent_name]
    return default_agent_for(platform)


def _strip_custom_keys(messages: list[dict], user_tz: str | None = None) -> list[dict]:
    """Strip non-standard keys and prepend timestamps for the LLM API call.

    Custom keys stripped: agent, platform, ts, _injected
    Timestamps are converted to the user's timezone and prepended to content.
    """
    try:
        tz = ZoneInfo(user_tz) if user_tz else timezone.utc
    except (KeyError, ValueError):
        tz = timezone.utc

    tz_is_utc = tz == timezone.utc
    cleaned = []
    for m in messages:
        clean = {k: v for k, v in m.items() if k not in ("agent", "platform", "ts", "_injected")}
        ts_str = m.get("ts")
        content = clean.get("content")
        if ts_str and content and m.get("role") == "user":
            try:
                dt = datetime.fromisoformat(ts_str)
                local_dt = dt.astimezone(tz)
                fmt = local_dt.strftime("%a %b %d, %I:%M %p")
                if tz_is_utc:
                    fmt += " UTC"
                clean["content"] = f"[{fmt}] {content}"
            except (ValueError, OverflowError):
                pass
        cleaned.append(clean)
    return cleaned


def _extract_valid_handoff(
    assistant_message: dict,
    active_agent: Agent,
    session_messages: list[dict],
) -> _HandoffInfo | None:
    """Extract a valid handoff from the assistant message's tool_calls.

    If tool_calls are invalid/malformed/unauthorized, emits synthetic error
    tool-result messages into session_messages to keep pairing valid.

    Returns a _HandoffInfo if exactly one valid handoff was found, else None.
    """
    tool_calls = assistant_message.get("tool_calls")
    if not tool_calls:
        return None

    valid_handoff = None

    for tc in tool_calls:
        tc_id = tc.get("id", "unknown")
        func = tc.get("function", {})
        func_name = func.get("name", "")

        if not func_name.startswith("transfer_to_"):
            # Non-transfer tools are handled by the tool execution loop
            continue

        target = func_name.removeprefix("transfer_to_")

        if target not in active_agent.can_handoff_to:
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": f"Handoff to '{target}' not allowed for {active_agent.name}. Ignored.",
            })
            continue

        try:
            args = json.loads(func.get("arguments", "{}"))
        except json.JSONDecodeError:
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": "Malformed tool call arguments. Please try again.",
            })
            continue

        if "reason" not in args:
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": "Missing required 'reason' parameter. Please provide a reason for the handoff.",
            })
            continue

        if valid_handoff is not None:
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": "Multiple handoffs in one message are not supported. Ignored.",
            })
            continue

        valid_handoff = _HandoffInfo(target=target, tool_call_id=tc_id)

    return valid_handoff


AGENT_DISPLAY_NAMES: dict[str, str] = {
    "coach": "Coach",
    "tutor": "Tutor",
}


def _build_reply_text(parts: list[tuple[str, str]]) -> str:
    """Join reply parts, prefixing with agent name and inserting separators on change."""
    sections = []
    prev_agent = None
    for agent_name, text in parts:
        if prev_agent is not None and agent_name != prev_agent:
            display = AGENT_DISPLAY_NAMES.get(agent_name, agent_name)
            sections.append(f"--- *{display}* ---")
        sections.append(text)
        prev_agent = agent_name

    reply = "\n\n".join(sections)

    # Prefix with agent name from the first part
    if parts:
        first_agent = parts[0][0]
        display = AGENT_DISPLAY_NAMES.get(first_agent, first_agent)
        reply = f"**{display}:**\n{reply}"

    return reply


def _build_system_prompt_with_files(base_prompt: str, user_files: dict[str, str]) -> str:
    """Compose the full system prompt with per-user file content."""
    sections = [base_prompt]
    sections.append(
        "\nYou have a personal workspace for this user with three files that persist "
        "across sessions. Use them to remember things and adapt your behavior."
    )
    for filename in ("agent_style.md", "user.md", "memory.md"):
        content = user_files.get(filename, "")
        label = {
            "agent_style.md": "agent_style.md (your style adjustments for this user)",
            "user.md": "user.md (what you know about this user)",
            "memory.md": "memory.md (your running notes about this user)",
        }[filename]
        display = content if content else "(empty)"
        sections.append(f"\n## {label}\n{display}")
    return "\n".join(sections)


async def _run_agent(
    agent: Agent,
    messages: list[dict],
    system_prompt: str | None = None,
    tool_choice: str | None = None,
) -> dict:
    """Run an LLM call for the given agent. Returns the assistant message dict."""
    system = system_prompt or agent.system_prompt
    tools = list(agent.extra_tools) + build_all_transfer_tools()
    cached = apply_cache_control(messages)

    llm_messages = [{"role": "system", "content": system}] + cached

    kwargs = {
        "model": agent.model,
        "messages": llm_messages,
        "tools": tools if tools else None,
        "max_tokens": 4096,
    }
    if tool_choice is not None:
        kwargs["tool_choice"] = tool_choice

    response = await acompletion(**kwargs)

    assistant_msg = response.choices[0].message

    result = {
        "role": "assistant",
        "agent": agent.name,
        "content": assistant_msg.content,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    if assistant_msg.tool_calls:
        result["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in assistant_msg.tool_calls
        ]

    return result


async def handle_message(identity: PlatformIdentity, text: str) -> HandleResult:
    """Handle an incoming user message through the agent dispatch loop."""
    user_id = await resolve_user_id(identity)
    platform = identity.platform_name
    lock = _get_user_lock(user_id)

    try:
        async with asyncio.timeout(LOCK_TIMEOUT_SECONDS):
            async with lock:
                return await _handle_locked(user_id, platform, text)
    except TimeoutError:
        return HandleResult(
            kind="error",
            reply_text="Still working on your previous message — please try again in a moment.",
        )


async def _handle_locked(user_id: int, platform: str, text: str) -> HandleResult:
    session = await load_or_create_open_ended_session(user_id)

    # Load per-user files and user timezone
    user_files = await load_user_files(user_id)
    user_tz = await _get_user_timezone(user_id)

    # Add timestamp to user message
    session["messages"].append({
        "role": "user",
        "content": text,
        "platform": platform,
        "ts": datetime.now(timezone.utc).isoformat(),
    })

    active_agent = _derive_active_agent(session["messages"], platform)

    # Build system prompt with user files (for agents with tool_executor) or use base
    if active_agent.tool_executor is not None:
        system_prompt = _build_system_prompt_with_files(active_agent.system_prompt, user_files)
    else:
        system_prompt = active_agent.system_prompt

    # Inject per-turn context (tagged for removal before save)
    context_text = await build_context_block(user_id)
    if context_text:
        session["messages"].append({
            "role": "system",
            "content": f"[Current context]\n{context_text}",
            "_injected": True,
        })

    handoffs_this_turn = 0
    tool_rounds = 0
    reply_parts: list[tuple[str, str]] = []

    while True:
        estimated = estimate_input_tokens(session["messages"], active_agent)
        if estimated > (MAX_INPUT_TOKENS - TOKEN_SAFETY_MARGIN):
            # Remove injected context before saving
            session["messages"] = [m for m in session["messages"] if not m.get("_injected")]
            await save_session(session)
            return HandleResult(
                kind="error",
                reply_text=(
                    "This conversation has gotten too long for me to continue "
                    "(over 45,000 tokens). A reset command is coming soon — "
                    "for now, please ask staff to archive this session."
                ),
            )

        force_text = tool_rounds >= MAX_TOOL_ROUNDS

        try:
            cleaned = _strip_custom_keys(session["messages"], user_tz)
            assistant_msg = await _run_agent(
                active_agent,
                cleaned,
                system_prompt=system_prompt,
                tool_choice="none" if force_text else None,
            )
        except Exception:
            logger.exception("llm_call_failed", extra={
                "user_id": user_id, "agent": active_agent.name,
            })
            return HandleResult(
                kind="error",
                reply_text="Sorry, something went wrong on my end. Please try again in a moment.",
            )

        session["messages"].append(assistant_msg)

        if assistant_msg.get("content"):
            reply_parts.append((assistant_msg["agent"], assistant_msg["content"]))

        tool_calls = assistant_msg.get("tool_calls")
        if not tool_calls:
            break

        # Separate transfer tools from regular tools
        handoff = _extract_valid_handoff(assistant_msg, active_agent, session["messages"])
        regular_tools = [
            tc for tc in tool_calls
            if not tc.get("function", {}).get("name", "").startswith("transfer_to_")
        ]

        # Execute regular tools
        if regular_tools and active_agent.tool_executor is not None:
            for tc in regular_tools:
                tc_id = tc.get("id", "unknown")
                try:
                    result_text = await active_agent.tool_executor(tc, user_id)
                except Exception:
                    logger.exception("tool_exec_error", extra={
                        "tool": tc.get("function", {}).get("name"),
                        "user_id": user_id,
                    })
                    result_text = "Tool execution failed. Please try again."
                session["messages"].append({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": result_text,
                })
            tool_rounds += 1
        elif regular_tools and active_agent.tool_executor is None:
            for tc in regular_tools:
                tc_id = tc.get("id", "unknown")
                func_name = tc.get("function", {}).get("name", "")
                session["messages"].append({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": f"Unknown tool '{func_name}'. No action taken.",
                })

        # Handle handoff
        if handoff is not None:
            if handoffs_this_turn >= MAX_HANDOFFS_PER_TURN:
                session["messages"].append({
                    "role": "tool",
                    "tool_call_id": handoff.tool_call_id,
                    "content": "Further handoffs disabled this turn. Please answer the user directly.",
                })
                handoffs_this_turn += 1
                if handoffs_this_turn > MAX_HANDOFFS_PER_TURN + 1:
                    logger.error("handoff_loop_exhausted", extra={"user_id": user_id})
                    break
                continue

            session["messages"].append({
                "role": "tool",
                "tool_call_id": handoff.tool_call_id,
                "content": f"Handed off to {handoff.target}.",
            })
            active_agent = AGENT_REGISTRY[handoff.target]
            system_prompt = active_agent.system_prompt
            handoffs_this_turn += 1
            continue

        # Regular tools only — loop for LLM to process results
        if regular_tools:
            continue

        break

    # Remove injected context before saving
    session["messages"] = [m for m in session["messages"] if not m.get("_injected")]

    try:
        await save_session(session)
    except Exception:
        logger.exception("save_session_failed", extra={"user_id": user_id})

    final_text = _build_reply_text(reply_parts) if reply_parts else None

    return HandleResult(
        kind="ok",
        reply_text=final_text or "I'm not sure what to say. Could you try again?",
    )
