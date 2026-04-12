"""Platform-agnostic multi-agent message dispatcher with handoff support."""

import asyncio
import copy
import json
import logging
from dataclasses import dataclass

from litellm import acompletion

from core.agents.agent import Agent
from core.agents.caching import estimate_input_tokens, apply_cache_control
from core.agents.identity import PlatformIdentity, resolve_user_id
from core.agents.registry import AGENT_REGISTRY, default_agent_for
from core.agents.sessions import load_or_create_open_ended_session, save_session
from core.agents.tools import build_all_transfer_tools

logger = logging.getLogger(__name__)

MAX_HANDOFFS_PER_TURN = 1
MAX_INPUT_TOKENS = 50_000
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


def _derive_active_agent(messages: list[dict], platform: str) -> Agent:
    """Derive the active agent from the last assistant message's agent tag."""
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and "agent" in msg:
            agent_name = msg["agent"]
            if agent_name in AGENT_REGISTRY:
                return AGENT_REGISTRY[agent_name]
    return default_agent_for(platform)


def _strip_custom_keys(messages: list[dict]) -> list[dict]:
    """Strip non-standard keys (agent, platform) for the LLM API call."""
    cleaned = []
    for m in messages:
        clean = {k: v for k, v in m.items() if k not in ("agent", "platform")}
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
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": f"Unknown tool '{func_name}'. No action taken.",
            })
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


async def _run_agent(agent: Agent, messages: list[dict]) -> dict:
    """Run an LLM call for the given agent. Returns the assistant message dict."""
    system = agent.system_prompt
    tools = list(agent.extra_tools) + build_all_transfer_tools()
    cleaned = _strip_custom_keys(messages)
    cached = apply_cache_control(cleaned)

    llm_messages = [{"role": "system", "content": system}] + cached

    response = await acompletion(
        model=agent.model,
        messages=llm_messages,
        tools=tools if tools else None,
        max_tokens=4096,
    )

    assistant_msg = response.choices[0].message

    result = {
        "role": "assistant",
        "agent": agent.name,
        "content": assistant_msg.content,
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
    session["messages"].append({
        "role": "user",
        "content": text,
        "platform": platform,
    })

    active_agent = _derive_active_agent(session["messages"], platform)
    handoffs_this_turn = 0
    reply_parts: list[str] = []  # collect text from ALL assistant messages this turn

    while True:
        estimated = estimate_input_tokens(session["messages"], active_agent)
        if estimated > (MAX_INPUT_TOKENS - TOKEN_SAFETY_MARGIN):
            await save_session(session)
            return HandleResult(
                kind="error",
                reply_text=(
                    "This conversation has gotten too long for me to continue "
                    "(over 45,000 tokens). A reset command is coming soon — "
                    "for now, please ask staff to archive this session."
                ),
            )

        try:
            assistant_msg = await _run_agent(active_agent, session["messages"])
        except Exception:
            logger.exception("llm_call_failed", extra={
                "user_id": user_id, "agent": active_agent.name,
            })
            return HandleResult(
                kind="error",
                reply_text="Sorry, something went wrong on my end. Please try again in a moment.",
            )

        session["messages"].append(assistant_msg)

        # Collect any text the agent produced (even if it also made a tool call)
        if assistant_msg.get("content"):
            reply_parts.append(assistant_msg["content"])

        handoff = _extract_valid_handoff(assistant_msg, active_agent, session["messages"])

        if handoff is None:
            break

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
        handoffs_this_turn += 1

    try:
        await save_session(session)
    except Exception:
        logger.exception("save_session_failed", extra={"user_id": user_id})

    final_text = "\n\n".join(reply_parts) if reply_parts else None

    return HandleResult(
        kind="ok",
        reply_text=final_text or "I'm not sure what to say. Could you try again?",
    )
