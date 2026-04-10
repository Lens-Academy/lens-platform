# AI Coach Discord DM Prototype — Design

**Date:** 2026-04-10
**Status:** Draft — pending review
**Author:** Brainstorm session with Claude

## Goal

Prototype an AI coach accessible via Discord DM. The coach is a study / accountability / light customer-service persona, distinct from the existing AI safety tutor. The prototype must be built on a **handoff-ready architecture** so that:

1. The same agent layer later extends to WhatsApp (blocked on a Meta developer account — infra-ready when that unblocks).
2. A user on WhatsApp can seamlessly trigger a tutor handoff mid-conversation (and vice versa on the web platform).
3. The existing module-tutor, roleplay, and web-platform chat flows are not disturbed.

For the prototype specifically, we only build the coach + a tutor **stub**. The tutor stub exists to exercise the full handoff machinery end-to-end; the real tutor integration is a follow-up.

## Architecture overview

We use the **swarm / handoff pattern** (OpenAI Swarm, LangGraph swarm mode, AutoGen handoff). Each agent owns its own system prompt and tools, including `transfer_to_<other>` tools. There is no central router. An agent decides for itself when to hand off, and the full conversation history carries across.

Rationale (see "Research findings" section at the end):
- **Handoff beats supervisor** on latency, cost, and accuracy per LangChain's June 2025 benchmarks, because there's no extra LLM call per turn for routing.
- **Handoff beats monolithic single-prompt** because distinct personas with distinct tone/instructions suffer "attention dilution" when bundled.
- Two agents is the sweet spot for handoff; the pattern scales cleanly to 3–4 but not beyond.

### Flow

```
Discord DM
    │
    ▼
discord_bot/cogs/coach_cog.py          (thin adapter — on_message listener)
    │  calls core.agents.handle_message(platform_identity, text)
    ▼
core/agents/dispatcher.py              (platform-agnostic dispatch loop)
    │  ├─ resolve platform_identity → internal user_id
    │  ├─ load/create open-ended chat_sessions row
    │  ├─ pick active agent (persisted, or default for platform)
    │  ├─ run LLM loop with handoff protocol
    │  └─ persist messages, commit
    ▼
core/agents/registry.py
    │  ├─ COACH_AGENT   ← core/coach/persona.py
    │  └─ TUTOR_AGENT   ← stub for prototype
    ▼
core/modules/llm.py                    (existing LiteLLM — reused unchanged)
    ▼
Anthropic / OpenAI / whatever
```

### Boundary rules

- `discord_bot/cogs/coach_cog.py` knows about Discord. Calls into `core/agents/`. Receives plain text. No business logic.
- `core/agents/` is platform-agnostic. Knows nothing about Discord. Takes a `PlatformIdentity` + text, returns text.
- `core/coach/` holds **only** the coach persona definition (system prompt, handoff instructions). It does not know about the dispatcher.
- `core/modules/llm.py` is untouched. We reuse `litellm.acompletion()` directly.

## Module layout

```
core/
  agents/                           # NEW
    __init__.py
    agent.py                        # Agent dataclass
    dispatcher.py                   # handle_message() + dispatch loop
    registry.py                     # AGENT_REGISTRY, default_agent_for(platform)
    identity.py                     # PlatformIdentity, resolve_user_id()
    tools.py                        # build_transfer_tool() schemas
    sessions.py                     # load/save for the open-ended chat_sessions shape
    caching.py                      # apply cache_control, token counting, 50k hard cap
    tests/
      test_dispatcher.py
      test_handoff.py
      test_caching.py
      test_identity.py

  coach/                            # NEW
    __init__.py
    persona.py                      # COACH_SYSTEM_PROMPT, build_coach_agent()
    tests/
      test_persona.py

discord_bot/
  cogs/
    coach_cog.py                    # NEW: on_message DM handler
  tests/
    test_coach_cog.py

migrations/
  NNNN_chat_sessions_open_ended.sql # NEW

alembic/versions/
  <hash>_chat_sessions_open_ended.py

docs/superpowers/specs/
  2026-04-10-ai-coach-discord-prototype-design.md  # this file
```

The existing `core/modules/chat.py`, `core/modules/chat_sessions.py`, tutor logic, and existing `chat_sessions` table data are **untouched**.

## Schema changes

### `chat_sessions` refactor

The existing table is module/roleplay-scoped. We extend it to also host "open-ended" conversations (coach today, others tomorrow) without disturbing the existing shapes. The only schema change is a single partial unique index — no new columns.

**Important correction from review**: `module_id` is **already nullable** in the current schema (`core/tables.py:413`). The existing unique indexes (`idx_chat_sessions_unique_user_tutor`, `idx_chat_sessions_unique_user_roleplay`, and their anonymous variants) all place `module_id` inside the index columns rather than relying on a NOT NULL guarantee, so they continue to work correctly with NULL values. No `DROP NOT NULL` step is needed.

```sql
-- Migration: chat_sessions_open_ended

-- Partial unique index for the open-ended session shape:
-- one active open-ended session per user
CREATE UNIQUE INDEX idx_chat_sessions_unique_user_open_ended
ON chat_sessions (user_id)
WHERE user_id IS NOT NULL
  AND module_id IS NULL
  AND roleplay_id IS NULL
  AND archived_at IS NULL;
```

**No `active_agent` column.** The active agent is derived at load time from the last assistant message's `agent` tag in the `messages` JSONB array. This avoids a column that must be kept in sync on every turn. Since we already load the full JSONB blob for the LLM call anyway, reading the last assistant message's `agent` tag is effectively free.

**Three session shapes now coexist in one table:**

| Shape | `module_id` | `roleplay_id` | Uniqueness |
|---|---|---|---|
| Module tutor chat (existing) | set | NULL | existing index |
| Roleplay (existing) | set | set | existing index |
| Open-ended coach (new) | NULL | NULL | new partial index |

Existing unique constraints on the module-tutor and roleplay shapes are unchanged. Existing queries that assume `module_id IS NOT NULL` for those flows must be verified to still work after the column becomes nullable — any such query must add `AND module_id IS NOT NULL` explicitly where needed.

**Rollback**: `DROP INDEX idx_chat_sessions_unique_user_open_ended;` (safe at any time — no data changes involved).

**Query audit**: Existing queries that read `chat_sessions.module_id` already handle the nullable case correctly — verified in `core/modules/chat_sessions.py` (`get_or_create_chat_session` checks `if module_id is not None`). No follow-up audit required.

### Message schema (inside `messages` JSONB)

Standard LiteLLM-compatible dicts, with two minor additions:

```jsonc
[
  {"role": "user", "content": "Hey, feeling stuck this week", "platform": "discord_dm"},
  {"role": "assistant", "agent": "coach", "content": "I hear you. What's getting in the way?"},
  {"role": "user", "content": "Actually, I have a question about corrigibility", "platform": "discord_dm"},
  {"role": "assistant", "agent": "coach", "content": null, "tool_calls": [
    {"id": "call_1", "type": "function",
     "function": {"name": "transfer_to_tutor", "arguments": "{\"reason\": \"Technical AI safety question\"}"}}
  ]},
  {"role": "tool", "tool_call_id": "call_1", "content": "Handed off to tutor."},
  {"role": "assistant", "agent": "tutor", "content": "[stub reply]"}
]
```

**Schema conventions:**

- `agent` on every assistant message: which persona authored it. Cheap, direct queryability. Note: this is a diagnostic / audit field, not load-bearing for dispatcher logic. The authoritative "who is active now" signal is `chat_sessions.active_agent`.
- `platform` on every user message: provenance (Discord DM, WhatsApp, web, etc.). Only a hint today; used later for proactive-outreach channel selection.
- **Handoffs are logged via the tool call itself** — no separate event entry. The `reason` parameter is **required** on the transfer tool, so the LLM must state its reasoning, captured for evals.
- **Assistant messages that contain only tool calls use `content: null`**, not `content: ""`. This matches the OpenAI convention and LiteLLM's expected shape.
- Extra keys (`agent`, `platform`) are stripped before sending to the LLM API; `tool_calls`, `tool_call_id`, and `role` are preserved.
- **`content` may be transformed to a content-block list at request time** to carry `cache_control` on the final block — see "Caching strategy" for details. The DB representation stays as a plain string; the transformation happens in `_run_agent` immediately before calling LiteLLM.

## Agent definition

```python
# core/agents/agent.py
from dataclasses import dataclass, field

@dataclass(frozen=True)
class Agent:
    name: str                              # "coach", "tutor"
    system_prompt: str
    model: str                             # LiteLLM provider string
    extra_tools: tuple[dict, ...] = ()     # non-handoff tools (none for prototype)
    can_handoff_to: tuple[str, ...] = ()   # names of other agents this one can transfer to
```

Agents are immutable singletons constructed at import time and registered in `AGENT_REGISTRY`. `default_agent_for(platform)` returns the entry agent for a given platform.

```python
# core/agents/registry.py (sketch)
AGENT_REGISTRY: dict[str, Agent] = {
    "coach": build_coach_agent(),
    "tutor": build_tutor_stub(),
}

PLATFORM_DEFAULTS: dict[str, str] = {
    "discord_dm": "coach",
    "whatsapp":   "coach",
    "web_coach":  "coach",
    # Later: "web_tutor": "tutor" — existing module-tutor flow
}

def default_agent_for(platform: str) -> Agent:
    return AGENT_REGISTRY[PLATFORM_DEFAULTS[platform]]
```

## Dispatch protocol

Lives in `core/agents/dispatcher.py`. Pseudocode below; note that this incorporates several fixes flagged during design review (token-cap re-check, graceful-degradation on max handoffs, orphan-tool-call prevention, malformed tool-call handling).

```python
MAX_HANDOFFS_PER_TURN = 1
MAX_INPUT_TOKENS = 50_000
TOKEN_SAFETY_MARGIN = 5_000  # abort at 45k estimated, leave headroom for undercounting + response
LOCK_TIMEOUT_SECONDS = 120

async def handle_message(identity: PlatformIdentity, text: str) -> HandleResult:
    user_id = await resolve_user_id(identity)
    platform = identity.platform_name

    try:
        async with asyncio.timeout(LOCK_TIMEOUT_SECONDS):
            async with _user_lock(user_id):
                return await _handle_locked(user_id, platform, text)
    except asyncio.TimeoutError:
        return HandleResult(kind="error", reply_text=(
            "Still working on your previous message — please try again in a moment."
        ))


async def _handle_locked(user_id: int, platform: str, text: str) -> HandleResult:
    session = await load_or_create_open_ended_session(user_id)
    session.messages.append({
        "role": "user",
        "content": text,
        "platform": platform,
    })

    active_agent = _derive_active_agent(session.messages, platform)
    handoffs_this_turn = 0

    while True:
        # Token cap is re-checked at the top of EACH iteration because the
        # active agent (and therefore its system prompt + tools) may have
        # just changed via handoff.
        estimated = await estimate_input_tokens(session.messages, active_agent)
        if estimated > (MAX_INPUT_TOKENS - TOKEN_SAFETY_MARGIN):
            # Abort before the LLM call. Do not persist the user message as
            # part of a failed turn — but DO persist so the user can see their
            # own message echoed when they reset.
            await save_session(session)
            return HandleResult(kind="error", reply_text=(
                "This conversation has gotten too long for me to continue here "
                "(over 45,000 tokens). Please reset — a `reset` command is coming "
                "soon; for now, ask staff to archive this session."
            ))

        llm_response = await _run_agent(active_agent, session.messages)
        session.messages.extend(llm_response.new_messages)

        handoff = _extract_valid_handoff(llm_response, active_agent)

        if handoff is None:
            # Agent produced a final text reply (possibly with invalid/no tool call).
            # If the LLM emitted malformed or unauthorized tool calls, those were
            # already normalised by _extract_valid_handoff (which emits synthetic
            # error tool-results to keep tool_call/result pairing valid).
            break

        if handoffs_this_turn >= MAX_HANDOFFS_PER_TURN:
            # Receiving agent tried to hand off again. Emit a synthetic
            # tool-result telling it that further handoffs are disabled,
            # and loop one more time to let it produce a direct reply.
            # Crucially: we do NOT strip transfer tools from the schema on
            # the retry — doing so would orphan the historical tool_call.
            # The prompt instructs agents that further handoffs are refused
            # this turn; they should answer the user directly.
            session.messages.append({
                "role": "tool",
                "tool_call_id": handoff.tool_call_id,
                "content": (
                    "Further handoffs disabled this turn. "
                    "Please answer the user directly."
                ),
            })
            # One more iteration, same active_agent, to collect its text reply.
            # The loop exits on the next iteration when the agent produces text.
            # Guard against infinite loops with an absolute hard cap:
            if handoffs_this_turn >= MAX_HANDOFFS_PER_TURN + 1:
                logger.error("handoff_loop_exhausted", user_id=user_id)
                break
            handoffs_this_turn += 1
            continue

        # Valid handoff within budget — perform it.
        session.messages.append({
            "role": "tool",
            "tool_call_id": handoff.tool_call_id,
            "content": f"Handed off to {handoff.target}.",
        })
        active_agent = AGENT_REGISTRY[handoff.target]
        handoffs_this_turn += 1

    session.updated_at = now_utc()
    await save_session(session)
    # active_agent is NOT persisted to a column — it's derived from the last
    # assistant message's `agent` tag on load.

    return HandleResult(
        kind="ok",
        reply_text=_extract_final_text(session.messages),
    )
```

### `_derive_active_agent`

Walks backward through `session.messages` to find the last assistant message with an `agent` tag. Returns `AGENT_REGISTRY[tag]` if found; otherwise falls back to `default_agent_for(platform)`. O(1) in practice since the last message is almost always recent.

### `_extract_valid_handoff`

Returns a `Handoff(target, tool_call_id)` if the most recent assistant message contains **exactly one** valid `transfer_to_<name>` call whose `name` is in `active_agent.can_handoff_to`, otherwise returns `None` and **mutates `session.messages` in place** to emit synthetic error tool-results for every orphaned tool call. This guarantees tool_call/tool_result pairing integrity regardless of how malformed the LLM output is.

Handled cases:
- **Multiple tool_calls in one message**: iterate all of them, emit a synthetic error tool_result for each, return the first valid transfer target (if any) — but **only if it's the only valid one**, otherwise return None (treat as ambiguous) and emit errors for all.
- **Unknown target** (`transfer_to_typo`): emit `{"role":"tool","tool_call_id":...,"content":"Unknown handoff target 'typo'; ignored."}` and continue.
- **Malformed JSON in `arguments`**: emit error tool-result, return None.
- **Missing required `reason`**: emit error tool-result explaining the missing field, return None. The agent's next turn will see the error and can either re-try the call with a reason or just answer directly.
- **Assistant message has both text AND a handoff tool_call**: the text is ignored in favor of the handoff (handoff wins). The text is still persisted for audit but does not get surfaced to the user.

### Key behaviours

- **Per-user lock** with 120s timeout: `asyncio.Lock` keyed on `user_id`, held in an in-process dict. Serializes concurrent messages from the same user. A stuck turn times out and the user gets a friendly retry message rather than blocking forever.
- **Shared history across handoffs**: the message list is passed unchanged; the receiving agent sees everything.
- **Single handoff per user turn**: if agent B tries a second handoff, we emit a synthetic tool-result telling it further handoffs are disabled and loop once more to collect its text reply. **Transfer tools are NOT stripped from the schema on retry**, because doing so would orphan the historical transfer tool_call (violating Anthropic's tool_use/tools pairing requirement — see "Handoff-ready tool schema" below).
- **Derived active agent**: on each turn, the active agent is derived from the last assistant message's `agent` tag in the conversation history. If no assistant messages exist yet (brand-new session), the platform default is used. No column to keep in sync.
- **Input token hard cap** (45k effective, 50k absolute): re-checked at the top of every loop iteration because the active agent can change mid-loop. The 5k safety margin accounts for documented undercounting in `litellm.token_counter()` and leaves headroom for the response.

### `_run_agent` responsibilities

- Build the LiteLLM message array:
  1. System prompt (from `active_agent.system_prompt`), passed as the `system` parameter to LiteLLM
  2. Strip `agent`, `platform`, and any other non-standard keys from `session.messages`
  3. Filter out any stale `system`-role timeline markers (matching the existing pattern in `core/modules/chat.py:177`)
  4. **Transform the final message's `content` to a content-block list** carrying `cache_control` — see "Caching strategy" for the exact shape
- Include tools in the call: **all transfer tools + all extra tools for every agent**, regardless of the agent's `can_handoff_to`. This is non-obvious but necessary — see "Handoff-ready tool schema" below.
- Call LiteLLM via `core/modules/llm.py`'s existing `complete()` or `stream_chat()` helpers (they already wrap `litellm.acompletion` with the project's conventions, including `DEFAULT_PROVIDER = "anthropic/claude-sonnet-4-6"`). **Do not reuse `core/modules/chat.py` — that module is tightly coupled to `current_stage` / `current_content` and is not applicable to open-ended coach conversations.**
- Start with non-streaming for prototype simplicity; Discord UX uses the typing indicator instead.
- Return a structured result: `{new_messages, final_text}`. Handoff extraction happens in the dispatcher via `_extract_valid_handoff`.

## Handoff-ready tool schema

```python
# core/agents/tools.py

def build_transfer_tool(target_agent_name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": f"transfer_to_{target_agent_name}",
            "description": (
                f"Hand off the conversation to the {target_agent_name}. "
                f"Only call this when the user's message is clearly outside your expertise. "
                f"You must provide a clear reason."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Why this conversation should move to the other agent.",
                    },
                },
                "required": ["reason"],
            },
        },
    }


def build_all_transfer_tools() -> list[dict]:
    """Every agent's request carries ALL transfer tools, not just its own.

    This is required because after a handoff, the conversation history contains
    a `tool_use` block referencing `transfer_to_<other>`. Anthropic enforces
    that every tool name appearing in message history must also appear in the
    `tools` array, or the request is rejected with 400.

    Restriction of which transfers are allowed is enforced at the *prompting*
    layer (the system prompt tells each agent which targets it may use) and at
    the *dispatcher* layer (`can_handoff_to` validates the emitted target).
    """
    return [build_transfer_tool(name) for name in AGENT_REGISTRY.keys()]
```

**Why this matters**: Anthropic's API **rejects requests** where any `tool_use` or `tool_result` block in the messages array references a tool name not present in the current `tools` definition (confirmed by multiple Claude Code issues: [#18947](https://github.com/anthropics/claude-code/issues/18947), [#13460](https://github.com/anthropics/claude-code/issues/13460), [#8763](https://github.com/anthropics/claude-code/issues/8763), and Portkey's error library). This was initially flagged as a "day 1 spike test" but the research review confirmed it's a known rejection — we use the include-everything-in-schema approach as the **default**, not a contingency.

Consequences:
- Each agent sees a `transfer_to_<self>` tool in its own schema (harmless no-op; prompting says "don't call this").
- The self-transfer is discouraged by the coach's system prompt. If the LLM does emit it, the dispatcher's `_extract_valid_handoff` rejects it (not in `can_handoff_to`) and emits a synthetic error tool_result.
- Cache invalidation from handoffs is slightly worse than with per-agent tool lists (the tools block is now identical across agents, but the system prompt still differs — so each agent still has its own cache lineage keyed on system prompt).
- The dispatcher's "one handoff per turn" rule is enforced by prompt-level soft constraints + tool-result feedback ("Further handoffs disabled this turn") rather than by stripping tools from the schema mid-conversation.

## Agents

### Coach persona (`core/coach/persona.py`)

- **Tone**: Warm, supportive, curious. Conversational, not clinical. Short-ish replies (Discord DM UX).
- **Role blend**: Study / accountability coach (primary) + light customer-service (secondary). Examples: "How's the course going?" "What's getting in the way?" "What's your goal for today?" "Want help finding the right resource?"
- **Handoff criteria** (spelled out in the prompt): "If the user asks a specific technical AI safety or course content question, call `transfer_to_tutor(reason=...)`. If they're asking about motivation, study habits, schedule, logistics, or just want to think out loud — you handle it."
- **Scope limits** (spelled out in the prompt): No access to course progress, calendar, or personal info in the prototype. If asked something that requires that data, be honest about not having it yet.
- **Safety**: Standard refusal guidance. Not a therapist; escalate to the user contacting staff for anything serious.
- Full prompt text is written during implementation, not in this design. The prompt is the product — expect heavy iteration.

### Tutor stub (`core/agents/registry.py`)

A deliberate bounce-back: the stub acknowledges the handoff, apologizes briefly, suggests continuing with the coach, and calls `transfer_to_coach(reason="tutor_stub")`. This exercises the full handoff machinery (both directions) without needing a real tutor integration. Replacing the stub with a real tutor agent later is a single-file change.

## Caching strategy

Append-only, with block-level prompt caching. Based on extensive research into current Anthropic and LiteLLM behavior (spring 2026).

### Core principles

- **Append-only within a session.** Full history in DB, full history sent to LLM. Never trim mid-session. Trimming breaks prefix caching catastrophically (0% cache hits, plus a 25% write premium on every turn).
- **Block-level `cache_control`** on the final content block of each request. Anthropic supports both top-level automatic caching and block-level explicit caching, but **LiteLLM only propagates block-level `cache_control`** — the top-level form is silently dropped. Because we always append-only, placing `cache_control` on the final block each turn works identically to Anthropic's automatic mode: the cached prefix advances forward with each turn.
- **Context growth handling**: a hard 50,000 input-token cap (45k effective with safety margin) enforced *before* the LLM call. If exceeded, we return a readable error to the user rather than silently truncating.

### Message format for caching

LiteLLM requires the cached message's `content` to be a **content-block list**, not a plain string. The transformation happens in `_run_agent`, just before the LiteLLM call:

```python
# In DB:
{"role": "user", "content": "What's corrigibility?"}

# At request time, the LAST message is transformed to:
{"role": "user", "content": [
    {"type": "text", "text": "What's corrigibility?",
     "cache_control": {"type": "ephemeral"}}
]}
```

All prior messages keep their plain-string form — LiteLLM and Anthropic accept mixed formats. Only the final message needs the content-block form to carry the cache breakpoint.

### 5-minute TTL caveat (Discord cadence)

Anthropic's prompt cache has a **5-minute default TTL** (refreshed on each hit). Within a rapid back-and-forth (user sends several messages in a few minutes), the cache stays warm and every turn after the first gets ~100% cache hits on the entire prefix.

However, **Discord DM coaching has a conversational cadence measured in minutes to hours**, not seconds. A user who sends a message, gets a reply, and comes back 20 minutes later will get a complete cache miss. Realistic overall cache hit rate for this use case: **~30–50%**, not 85–100%.

This is acceptable for the prototype:
- The coach's system prompt is short (~1k tokens). Even on a cache miss, the rebuild is cheap.
- At prototype volume (a few dozen users), the absolute cost difference is negligible.
- **1-hour TTL** (`"ttl": "1h"`, at 2x write cost instead of 1.25x, breaking even at 2.2 reads per prefix) is available as a knob worth experimenting with once we have real usage data. Noted as follow-up.

### Handoff and caching interaction

When the coach hands off to the tutor, the system prompt changes (tools are now shared — see "Handoff-ready tool schema"). Anthropic's cache is keyed on the full prefix (tools → system → messages), so the receiving agent hits a cache miss on the system portion and rebuilds.

Practical impact:
- Each agent maintains an independent cache lineage keyed on its own system prompt.
- Within a streak of turns by the same agent, high cache hit rate on the growing history.
- Each handoff costs one cache rebuild (system prompt + full message history re-cached under the new agent's key).
- For our expected handoff frequency (0–2 per conversation), this is negligible.

### Token counting

`core/agents/caching.py` provides `estimate_input_tokens(messages, agent) -> int`:

- **Prefer Anthropic's native `/v1/messages/count_tokens` endpoint** (exposed via LiteLLM's `litellm.acompletion(..., count_tokens=True)` route or a direct API call). This gives exact token counts including system prompt and tools. Local `litellm.token_counter()` has documented undercounting issues (PR [#8880](https://github.com/BerriAI/litellm/pull/8880): 0–10 tokens reported when actual was 200; image/document blocks not counted per issue [#20367](https://github.com/BerriAI/litellm/issues/20367)). For the prototype, the native endpoint adds one extra API call per turn (~50ms latency), which is acceptable.
- Count system prompt + tools + all messages.
- Run this check at the **top of each dispatch loop iteration** (not just once before the loop), because the active agent can change via handoff.
- 5,000-token safety margin: error threshold is effectively 45k, leaving headroom for known undercounting and the response. Configured as `TOKEN_SAFETY_MARGIN = 5_000`.

## Discord cog

```python
# discord_bot/cogs/coach_cog.py (sketch)

import discord
from discord.ext import commands
from core.agents import handle_message, PlatformIdentity, HandleResult

class CoachCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return
        if not isinstance(message.channel, discord.DMChannel):
            return
        if not message.content.strip():
            return

        identity = PlatformIdentity(type="discord", id=message.author.id)

        async with message.channel.typing():
            try:
                result: HandleResult = await handle_message(identity, message.content)
            except Exception:
                logger.exception("coach_message_failed", extra={
                    "discord_user_id": message.author.id,
                })
                await message.channel.send(
                    "Sorry, something went wrong on my end. Please try again in a moment."
                )
                return

        await _send_in_chunks(message.channel, result.reply_text)
```

Register the cog in `discord_bot/main.py`'s `COGS` list.

**Typing indicator**: Discord's `typing()` context manager expires after ~10s. If LLM calls take longer, we re-enter the context manager in a loop, or use `channel.trigger_typing()` periodically. Handled inside a small helper.

**Message chunking**: Discord's 2000-char limit. `_send_in_chunks()` splits on sentence boundaries where possible, hard-splits where not.

## Cross-platform identity resolution

`core/agents/identity.py` defines the boundary between platform-specific identifiers and internal user IDs:

```python
from dataclasses import dataclass
from typing import Literal

@dataclass(frozen=True)
class PlatformIdentity:
    type: Literal["discord", "whatsapp", "web"]
    id: int | str   # discord snowflake, whatsapp phone, web user_id
    platform_name: str  # "discord_dm", "whatsapp", "web_coach"

async def resolve_user_id(identity: PlatformIdentity) -> int:
    """Look up or create a users row matching this platform identity."""
    ...
```

**For the prototype (Discord only)**: use the existing `core.auth.get_or_create_user(discord_id, ...)` helper, which already handles Discord ID → `users.user_id` resolution and creates a minimal user row if none exists. It is already exported in `core/__init__.py`. There's also `core.queries.users.get_user_by_discord_id()` for lookup-only. `resolve_user_id` wraps these, adding a `PlatformIdentity` dispatch layer for future WhatsApp support without changing the existing helpers.

**For future WhatsApp integration**: `resolve_user_id` is the single chokepoint. Add a phone-number branch, add account linking UX (users link WhatsApp → web platform account), done. No dispatcher changes.

**Known limitation**: a user who starts on WhatsApp without a web account will initially have a separate `users` row from their Discord identity. Cross-platform identity *merge* (if Discord user X is also WhatsApp user Y) is explicitly future work.

## Error handling

| Failure mode | Response |
|---|---|
| LiteLLM call fails (network, rate limit) | Retry once with short backoff; on second failure return friendly error to user, log to Sentry |
| LLM returns malformed tool call | Log warning, fall through as if no tool call was made, let current agent respond on next attempt |
| Handoff target not in `can_handoff_to` | Log warning, ignore the handoff, force current agent to answer without the transfer tool |
| Max handoff depth exceeded | Retry current agent's turn with transfer tool removed from schema |
| Input tokens exceed 50k | Return readable error to user before LLM call; do not append a turn |
| DB write fails after LLM response | Return response to user; log error. UX > perfect persistence for prototype. |
| Concurrent messages from same user | Per-user `asyncio.Lock` with 120s timeout; timeout returns a friendly "still processing" message |
| Discord message > 2000 chars | Split with `_send_in_chunks()` |
| User DMs before DB is up | Cog logs, sends "temporarily unavailable" |
| Historical tool call references tool not in current schema | Handled by design: all transfer tools are included in every agent's `tools` array (see "Handoff-ready tool schema") |
| LLM returns text AND a tool call in the same message | Handoff wins; text is persisted for audit but not surfaced to the user |
| Malformed JSON in tool call `arguments` | `_extract_valid_handoff` emits a synthetic error tool-result for the orphaned tool_call and returns None; agent gets another turn to respond with text |
| LLM omits required `reason` parameter | Same as malformed JSON — synthetic error tool-result, agent retries with text |
| Multiple `transfer_to_*` tool calls in one assistant message | `_extract_valid_handoff` returns the first valid one (if unambiguous) and emits error tool-results for all others; if ambiguous (multiple valid targets), rejects all and emits errors |
| DB save fails after successful LLM response | Return response to user anyway; log Sentry alert (not just a log line). Next turn may be incoherent — prototype-acceptable, but the Sentry alert ensures we notice. |
| Lock acquisition timeout (>120s) | Return "still processing previous message" error without entering the handler |

## Testing strategy

### Unit tests (mock LiteLLM, no network)

- `test_dispatcher.py`: happy path (no handoff), successful handoff, max-depth enforcement, invalid target, DB load/save cycle, per-user lock serialization
- `test_handoff.py`: `_extract_handoff` correctly parses tool calls, `build_transfer_tool` returns valid schema, `AGENT_REGISTRY` consistency (every `can_handoff_to` target exists)
- `test_caching.py`: `estimate_input_tokens` returns sane values for Anthropic models, `apply_cache_control` adds the field to the last message, 50k cap enforcement path returns the error kind
- `test_identity.py`: `resolve_user_id` looks up by Discord ID, creates user row if missing
- `test_persona.py`: coach system prompt loads, contains required handoff instructions
- `test_coach_cog.py`: on_message filters (ignore bots, ignore channels, ignore empty), error path returns friendly message, chunking works for long replies

### Integration test (real DB, stub LLM)

Full flow with a canned-response LLM stub:
- Create session → user message → coach replies
- Force a "transfer_to_tutor" response → tutor stub replies → tutor stub hands back to coach
- Verify session persisted correctly with all messages + agent tags + tool calls
- Verify `active_agent` is correctly updated across turns

### Manual test

- Start dev server + bot (`python main.py`)
- DM the test bot, have a conversation
- Motivational question → coach replies
- "What's instrumental convergence?" → verify `transfer_to_tutor` fires (check DB `messages` column for the tool call)
- Stub reply comes through with `agent: "tutor"` tag
- Follow-up message goes to whichever agent was active last

## Observability

- Structured log line per handled message:
  ```
  {user_id, platform, active_agent_in, active_agent_out, handoff_happened, handoff_reason, llm_latency_ms, input_tokens, cached_tokens, output_tokens, error}
  ```
- Sentry captures exceptions (already configured)
- PostHog events for "coach_message_handled", "coach_handoff_fired", "coach_token_cap_hit" — use existing infra if cheap, otherwise defer
- `cached_tokens` specifically: useful to verify that prompt caching is actually working. Realistic target for Discord DM cadence: **~30–50% overall cache hit rate** (100% within rapid exchanges, 0% when the user returns after >5 minutes). If consistently <20%, investigate whether the content-block `cache_control` format is being propagated correctly.

## Explicitly out of scope for the prototype

- **Real tutor integration** (stub only)
- **WhatsApp adapter** (infra-ready; blocked on Meta account verification)
- **Web platform adapter** for the coach
- **AI-proposed session reset** / `start_fresh_session` tool — deferred in favor of the simple 50k cap
- **Automatic summarization / Anthropic Compaction API**
- **Proactive nudges** (APScheduler-based scheduled check-ins)
- **Access to course progress, calendar, enrollment, roleplays from the coach**
- **User opt-in/opt-out, rate limiting, content moderation** (all needed before production)
- **Multi-language support**
- **Voice / media messages** (text only)
- **Agent-specific models** (everything uses `DEFAULT_PROVIDER` for now)
- **More than 2 agents**
- **Cross-platform identity merging**
- **Manual "reset my conversation" slash command** (follow-up — users will hit the 50k cap and need it)

## Known follow-ups

These are explicitly called out as the next things to build, in rough priority order:

1. **Manual conversation reset command**. Users will hit the 50k cap and need an escape hatch. `/coach reset` or a magic phrase. Implementation: archive current session, create new one.
2. **AI-proposed session reset** + `start_fresh_session` tool. The coach notices temporal drift or approaching-cap signals and offers to start fresh. Replaces the hard error with a graceful boundary.
3. **Real tutor integration**. Replace the stub with an agent that can answer AI safety content questions. Likely involves giving the tutor a content-search tool.
4. **Module-tutor + coach unification.** The existing `core/modules/chat.py` flow becomes one of the agents. This is a meaningful refactor because of how the existing flow binds to `current_stage` / module context.
5. **Roleplay unification**. Currently roleplay is a distinct `chat_sessions` shape with scoring tied to `session_id`. Making roleplay a callable agent from the coach (the "coach invites you to practice a roleplay on WhatsApp" dream) requires moving scoring to a child table (`roleplay_attempts`) with message-range pointers, so multiple roleplay attempts can live inside one conversation.
6. **WhatsApp adapter**. `whatsapp_bot/` peer to `discord_bot/`, new webhook route on the existing FastAPI app, pywa or raw LiteLLM integration. Architecture is already ready.
7. **1-hour cache TTL experiment**. Switch from 5-minute to 1-hour TTL (`"ttl": "1h"`) at 2x write cost. Breaks even at 2.2 reads per prefix. Worth trying once we have real Discord usage patterns to measure against.
8. **Two-breakpoint caching strategy** (system prompt + conversation). Modest cost improvement on long conversations.
9. **Anthropic Compaction API** evaluation. Server-side summarization for truly long-running sessions.

## Key uncertainties

These are the things we should validate early in implementation:

1. ~~**Historical tool-call compatibility**~~ — **Resolved during review.** Anthropic rejects requests where `tool_use` blocks reference tool names not in the `tools` array. We handle this by including all transfer tools in every agent's schema (see "Handoff-ready tool schema"). No spike test needed.
2. **Block-level `cache_control` propagation through LiteLLM.** Research confirmed that LiteLLM propagates block-level `cache_control` on content blocks, but NOT top-level `cache_control` on the request. Day 1 verification: send a multi-turn conversation and check `cache_read_input_tokens` in the response usage object. If 0, the content-block format isn't being picked up — debug the message shape.
3. **Token counting accuracy.** We're using Anthropic's native `/count_tokens` endpoint (via LiteLLM) rather than local `litellm.token_counter()` due to documented undercounting bugs. Day 1: verify the LiteLLM route to `/count_tokens` works and returns sane values for our message+tools+system shape. Benchmark against the actual `input_tokens` reported in a real response.
4. **Coach persona boundaries**. The prompt's handoff criteria are the highest-leverage lever on whether the prototype feels good. Expect multiple iteration rounds once we're DMing it.
5. ~~**`users` table Discord integration**~~ — **Resolved during review.** `core.auth.get_or_create_user(discord_id, ...)` already handles this; `core.queries.users.get_user_by_discord_id()` for lookup-only. Both exported via `core/__init__.py`.
6. ~~**`module_id` NOT NULL queries**~~ — **Resolved during review.** `module_id` is already nullable in the schema. Existing queries in `chat_sessions.py` already check `if module_id is not None` before filtering. No audit needed.
7. **LiteLLM synthetic tool-result format.** The spec uses `{"role": "tool", "tool_call_id": ...}` (OpenAI convention). Anthropic natively uses `{"role": "user", "content": [{"type": "tool_result", "tool_use_id": ...}]}`. LiteLLM is expected to translate between the two, but worth a day-1 verification with a real handoff roundtrip.

## Research findings (condensed)

### Multi-persona routing patterns

Three mainstream patterns for directing conversation to the right specialist:

1. **Monolithic single-prompt**: one LLM with both personas in one system prompt. Simple but suffers attention dilution as instructions grow. Not recommended beyond 2–3 clearly-separated concerns.
2. **Supervisor / Router**: central classifier LLM picks the specialist each turn. Adds one LLM call per turn. LangChain's June 2025 benchmark showed this consistently underperforms handoff on latency, cost, and accuracy.
3. **Swarm / Handoff**: each agent owns its own system prompt + tools including a `transfer_to_<other>` tool. Conversation history carries across. No central router. OpenAI Swarm, OpenAI Agents SDK, LangGraph swarm mode, AutoGen handoff, Azure Logic Apps handoff, AG2 — this is the industry-standard pattern for 2–4 specialists. **This is what we use.**

### Prompt caching for multi-turn conversations

- Prompt caching is prefix-based. Any change to the stable prefix invalidates the cache.
- Rolling/sliding window breaks caching → 0% cache hit rate.
- Append-only with block-level `cache_control` → ~100% cache hit rate within a rapid exchange, but ~30–50% overall for Discord DM cadence (5-min TTL expires between slow turns).
- Anthropic cache: reads at 10% of base, writes at 125% of base, 5-min default TTL. Break-even at 1.4 reads per cached prefix.
- Context window growth → handled by compaction (server-side since Jan 2026 in Anthropic beta) or conversation reset. For the prototype we use a hard cap + error; AI-proposed reset is the follow-up.

### Session model insights (from brainstorm)

- Platform should not be part of session identity. Users on WhatsApp and Discord can't "switch sessions" via UI — they have one ongoing conversation.
- Per-user session lets the active agent persist across platforms seamlessly.
- Session boundaries should be semantic (same topic, same stretch of time), not platform-bound or UI-bound.
- Handoffs are log entries (via tool calls) inside a single growing conversation, not session transitions.

---

**End of design.** Implementation plan will be written in a separate document after this spec is reviewed and approved.
