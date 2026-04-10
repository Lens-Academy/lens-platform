# AI Coach Discord DM Prototype — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Discord DM chatbot with an AI coach persona, running on a handoff-ready multi-agent architecture that will later extend to WhatsApp and the web platform.

**Architecture:** Swarm/handoff pattern — each agent (coach, tutor stub) owns its own system prompt and tools; agents hand off via `transfer_to_<name>` tool calls. The dispatcher is platform-agnostic; the Discord cog is a thin adapter. Uses the existing LiteLLM layer (`core/modules/llm.py`) unchanged.

**Tech Stack:** Python 3.10+, discord.py, LiteLLM, SQLAlchemy async, PostgreSQL (existing), pytest

**Spec:** `docs/superpowers/specs/2026-04-10-ai-coach-discord-prototype-design.md`

**TDD Approach:** Every task follows red-green-refactor. Tests use real dependencies where possible (real DB via `get_transaction`, real SQLAlchemy). Mocks only for: LiteLLM API calls (external), Discord API (external). Unit+1 style.

---

## File Map

| File | Responsibility | Created/Modified |
|---|---|---|
| `core/agents/__init__.py` | Public exports for the agents package | Create |
| `core/agents/agent.py` | `Agent` frozen dataclass | Create |
| `core/agents/tools.py` | `build_transfer_tool()`, `build_all_transfer_tools()` | Create |
| `core/agents/identity.py` | `PlatformIdentity` dataclass, `resolve_user_id()` | Create |
| `core/agents/sessions.py` | `load_or_create_open_ended_session()`, `save_session()` | Create |
| `core/agents/caching.py` | `estimate_input_tokens()`, `apply_cache_control()` | Create |
| `core/agents/dispatcher.py` | `handle_message()`, dispatch loop, handoff extraction | Create |
| `core/agents/registry.py` | `AGENT_REGISTRY`, `default_agent_for()`, tutor stub | Create |
| `core/coach/__init__.py` | Public exports | Create |
| `core/coach/persona.py` | `COACH_SYSTEM_PROMPT`, `build_coach_agent()` | Create |
| `discord_bot/cogs/coach_cog.py` | `CoachCog` with `on_message` DM handler | Create |
| `discord_bot/main.py` | Add `"cogs.coach_cog"` to `COGS` list | Modify |
| `alembic/versions/*_chat_sessions_open_ended.py` | Partial unique index migration | Create |
| `core/agents/tests/test_agent.py` | Agent dataclass tests | Create |
| `core/agents/tests/test_tools.py` | Transfer tool schema tests | Create |
| `core/agents/tests/test_identity.py` | Identity resolution tests | Create |
| `core/agents/tests/test_sessions.py` | Session load/save tests | Create |
| `core/agents/tests/test_caching.py` | Token counting + cache_control tests | Create |
| `core/agents/tests/test_dispatcher.py` | Dispatch loop + handoff tests | Create |
| `core/coach/tests/test_persona.py` | Coach persona tests | Create |
| `discord_bot/tests/test_coach_cog.py` | Cog filtering + error handling tests | Create |

---

## Task 1: Database Migration — Partial Unique Index

**Files:**
- Create: `alembic/versions/<hash>_chat_sessions_open_ended.py`
- Reference: `core/tables.py:400-472`

- [ ] **Step 1: Generate the migration**

```bash
cd /home/penguin/code/lens-platform/ws1
.venv/bin/alembic revision -m "chat_sessions_open_ended"
```

- [ ] **Step 2: Write the migration**

Open the generated file in `alembic/versions/` and replace the body:

```python
"""chat_sessions_open_ended

Add partial unique index for open-ended sessions (coach, etc.)
— one active open-ended session per user.
"""
from alembic import op


revision = "<generated>"
down_revision = "<generated>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_chat_sessions_unique_user_open_ended",
        "chat_sessions",
        ["user_id"],
        unique=True,
        postgresql_where="user_id IS NOT NULL AND module_id IS NULL AND roleplay_id IS NULL AND archived_at IS NULL",
    )


def downgrade() -> None:
    op.drop_index("idx_chat_sessions_unique_user_open_ended", table_name="chat_sessions")
```

- [ ] **Step 3: Run the migration**

```bash
.venv/bin/alembic upgrade head
```

Expected: Migration applies successfully. Verify with:

```bash
.venv/bin/alembic current
```

- [ ] **Step 4: Verify the index exists**

```bash
.venv/bin/python -c "
from core.database import get_engine
import asyncio
from sqlalchemy import text

async def check():
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.execute(text(
            \"SELECT indexname FROM pg_indexes WHERE tablename='chat_sessions' AND indexname LIKE '%open_ended%'\"
        ))
        rows = result.fetchall()
        print('Index found:', rows)
        assert len(rows) == 1, f'Expected 1 index, got {len(rows)}'

asyncio.run(check())
"
```

Expected: `Index found: [('idx_chat_sessions_unique_user_open_ended',)]`

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: add partial unique index for open-ended chat sessions"
```

---

## Task 2: Agent Dataclass and Transfer Tools

**Files:**
- Create: `core/agents/__init__.py`
- Create: `core/agents/agent.py`
- Create: `core/agents/tools.py`
- Create: `core/agents/tests/__init__.py`
- Create: `core/agents/tests/test_agent.py`
- Create: `core/agents/tests/test_tools.py`

- [ ] **Step 1: Write failing test for Agent dataclass**

```python
# core/agents/tests/test_agent.py
from core.agents.agent import Agent


def test_agent_is_frozen():
    agent = Agent(
        name="test",
        system_prompt="You are a test agent.",
        model="anthropic/claude-sonnet-4-6",
        can_handoff_to=("other",),
    )
    assert agent.name == "test"
    assert agent.can_handoff_to == ("other",)
    # Frozen — assignment should raise
    try:
        agent.name = "changed"
        assert False, "Should have raised FrozenInstanceError"
    except AttributeError:
        pass


def test_agent_defaults():
    agent = Agent(name="a", system_prompt="p", model="m")
    assert agent.extra_tools == ()
    assert agent.can_handoff_to == ()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_agent.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'core.agents'`

- [ ] **Step 3: Implement Agent dataclass**

```python
# core/agents/__init__.py
# Exports populated as modules are built.
```

```python
# core/agents/agent.py
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Agent:
    """An immutable agent definition with a persona and handoff targets."""

    name: str
    system_prompt: str
    model: str
    extra_tools: tuple[dict, ...] = field(default_factory=tuple)
    can_handoff_to: tuple[str, ...] = field(default_factory=tuple)
```

Create empty `core/agents/tests/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_agent.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Write failing test for transfer tools**

```python
# core/agents/tests/test_tools.py
from core.agents.tools import build_transfer_tool, build_all_transfer_tools


def test_build_transfer_tool_schema():
    tool = build_transfer_tool("tutor")
    assert tool["type"] == "function"
    assert tool["function"]["name"] == "transfer_to_tutor"
    params = tool["function"]["parameters"]
    assert "reason" in params["properties"]
    assert "reason" in params["required"]


def test_build_transfer_tool_description_mentions_target():
    tool = build_transfer_tool("coach")
    assert "coach" in tool["function"]["description"].lower()


def test_build_all_transfer_tools(monkeypatch):
    # Provide a fake registry to test iteration
    from core.agents import tools as tools_module
    fake_registry = {"coach": None, "tutor": None}
    monkeypatch.setattr(tools_module, "AGENT_REGISTRY", fake_registry)
    all_tools = build_all_transfer_tools()
    assert len(all_tools) == 2
    names = {t["function"]["name"] for t in all_tools}
    assert names == {"transfer_to_coach", "transfer_to_tutor"}
```

- [ ] **Step 6: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_tools.py -v
```

Expected: FAIL — `ModuleNotFoundError` or `ImportError`

- [ ] **Step 7: Implement transfer tools**

```python
# core/agents/tools.py

# AGENT_REGISTRY is injected at import time by registry.py.
# This module uses a forward reference to avoid circular imports.
AGENT_REGISTRY: dict = {}


def build_transfer_tool(target_agent_name: str) -> dict:
    """Build an OpenAI-format tool schema for handing off to another agent."""
    return {
        "type": "function",
        "function": {
            "name": f"transfer_to_{target_agent_name}",
            "description": (
                f"Hand off the conversation to the {target_agent_name}. "
                f"Only call this when the user's message is clearly outside "
                f"your expertise. You must provide a clear reason."
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
    """Build transfer tools for every registered agent.

    Every agent's request carries ALL transfer tools. This is required because
    Anthropic rejects requests where tool_use blocks in message history reference
    tool names not in the current tools array.
    """
    return [build_transfer_tool(name) for name in AGENT_REGISTRY.keys()]
```

- [ ] **Step 8: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_tools.py -v
```

Expected: 3 passed.

- [ ] **Step 9: Commit**

```bash
jj new -m "feat: add Agent dataclass and transfer tool schema builders"
```

---

## Task 3: Platform Identity and User Resolution

**Files:**
- Create: `core/agents/identity.py`
- Create: `core/agents/tests/test_identity.py`
- Reference: `core/auth.py:7-43`, `core/queries/users.py:24-31`

- [ ] **Step 1: Write failing test for PlatformIdentity + resolve_user_id**

```python
# core/agents/tests/test_identity.py
import pytest
from core.agents.identity import PlatformIdentity, resolve_user_id


def test_platform_identity_discord():
    identity = PlatformIdentity(type="discord", id=123456789, platform_name="discord_dm")
    assert identity.type == "discord"
    assert identity.platform_name == "discord_dm"


def test_platform_identity_is_frozen():
    identity = PlatformIdentity(type="discord", id=123, platform_name="discord_dm")
    with pytest.raises(AttributeError):
        identity.type = "whatsapp"


@pytest.mark.asyncio
async def test_resolve_user_id_creates_user_if_missing():
    """Integration test — hits real DB. Creates a user and resolves."""
    identity = PlatformIdentity(type="discord", id=999999999999, platform_name="discord_dm")
    user_id = await resolve_user_id(identity)
    assert isinstance(user_id, int)
    assert user_id > 0

    # Second call returns same user_id (idempotent)
    user_id_2 = await resolve_user_id(identity)
    assert user_id_2 == user_id
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_identity.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement identity resolution**

```python
# core/agents/identity.py
from dataclasses import dataclass
from typing import Literal

from core.auth import get_or_create_user


@dataclass(frozen=True)
class PlatformIdentity:
    """A user's identity on a specific messaging platform."""

    type: Literal["discord", "whatsapp", "web"]
    id: int | str
    platform_name: str  # "discord_dm", "whatsapp", "web_coach"


async def resolve_user_id(identity: PlatformIdentity) -> int:
    """Resolve a platform identity to an internal user_id.

    Creates a minimal user record if one doesn't exist.
    Currently only supports Discord; WhatsApp branch is a future addition.
    """
    if identity.type == "discord":
        user, _is_new = await get_or_create_user(discord_id=str(identity.id))
        return user["user_id"]

    raise ValueError(f"Unsupported platform type: {identity.type}")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_identity.py -v
```

Expected: 3 passed (the async test needs the DB running).

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: add PlatformIdentity and resolve_user_id wrapping core.auth"
```

---

## Task 4: Open-Ended Session Load/Save

**Files:**
- Create: `core/agents/sessions.py`
- Create: `core/agents/tests/test_sessions.py`
- Reference: `core/modules/chat_sessions.py`, `core/tables.py:400-472`, `core/database.py:64-92`

- [ ] **Step 1: Write failing tests for session load/save**

```python
# core/agents/tests/test_sessions.py
import pytest
from core.agents.sessions import load_or_create_open_ended_session, save_session


@pytest.mark.asyncio
async def test_load_creates_new_session_if_none_exists():
    # Use a user_id unlikely to exist; create via identity first
    from core.agents.identity import PlatformIdentity, resolve_user_id
    identity = PlatformIdentity(type="discord", id=888888888888, platform_name="discord_dm")
    user_id = await resolve_user_id(identity)

    session = await load_or_create_open_ended_session(user_id)
    assert session["user_id"] == user_id
    assert session["messages"] == []
    assert session["module_id"] is None
    assert session["roleplay_id"] is None
    assert "session_id" in session


@pytest.mark.asyncio
async def test_load_returns_existing_session():
    from core.agents.identity import PlatformIdentity, resolve_user_id
    identity = PlatformIdentity(type="discord", id=888888888889, platform_name="discord_dm")
    user_id = await resolve_user_id(identity)

    session1 = await load_or_create_open_ended_session(user_id)
    session1["messages"].append({"role": "user", "content": "hello"})
    await save_session(session1)

    session2 = await load_or_create_open_ended_session(user_id)
    assert session2["session_id"] == session1["session_id"]
    assert len(session2["messages"]) == 1
    assert session2["messages"][0]["content"] == "hello"


@pytest.mark.asyncio
async def test_save_session_persists_messages():
    from core.agents.identity import PlatformIdentity, resolve_user_id
    identity = PlatformIdentity(type="discord", id=888888888890, platform_name="discord_dm")
    user_id = await resolve_user_id(identity)

    session = await load_or_create_open_ended_session(user_id)
    session["messages"] = [
        {"role": "user", "content": "hi", "platform": "discord_dm"},
        {"role": "assistant", "agent": "coach", "content": "hey there!"},
    ]
    await save_session(session)

    reloaded = await load_or_create_open_ended_session(user_id)
    assert len(reloaded["messages"]) == 2
    assert reloaded["messages"][1]["agent"] == "coach"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_sessions.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement session load/save**

```python
# core/agents/sessions.py
"""Load/save open-ended chat sessions (module_id IS NULL, roleplay_id IS NULL)."""

import json
from datetime import datetime, timezone

from sqlalchemy import select, insert, update, text

from core.database import get_connection, get_transaction
from core.tables import chat_sessions


async def load_or_create_open_ended_session(user_id: int) -> dict:
    """Load the active open-ended session for a user, or create one.

    Open-ended sessions have module_id=NULL and roleplay_id=NULL.
    Returns a mutable dict with session_id, user_id, messages, etc.
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(chat_sessions).where(
                chat_sessions.c.user_id == user_id,
                chat_sessions.c.module_id.is_(None),
                chat_sessions.c.roleplay_id.is_(None),
                chat_sessions.c.archived_at.is_(None),
            )
        )
        row = result.mappings().first()

    if row:
        session = dict(row)
        # messages is stored as JSONB; ensure it's a list
        if isinstance(session["messages"], str):
            session["messages"] = json.loads(session["messages"])
        return session

    # Create new session
    async with get_transaction() as conn:
        result = await conn.execute(
            insert(chat_sessions)
            .values(
                user_id=user_id,
                module_id=None,
                roleplay_id=None,
                messages=[],
            )
            .returning(chat_sessions)
        )
        row = result.mappings().first()
        return dict(row)


async def save_session(session: dict) -> None:
    """Persist the session's messages and updated_at to the database."""
    async with get_transaction() as conn:
        await conn.execute(
            update(chat_sessions)
            .where(chat_sessions.c.session_id == session["session_id"])
            .values(
                messages=session["messages"],
                last_active_at=datetime.now(timezone.utc),
            )
        )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_sessions.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: add open-ended session load/save for agent conversations"
```

---

## Task 5: Token Counting and Cache Control

**Files:**
- Create: `core/agents/caching.py`
- Create: `core/agents/tests/test_caching.py`
- Reference: `core/modules/llm.py` (for `DEFAULT_PROVIDER`)

- [ ] **Step 1: Write failing tests**

```python
# core/agents/tests/test_caching.py
import pytest
from core.agents.agent import Agent
from core.agents.caching import estimate_input_tokens, apply_cache_control


def _make_agent(prompt="You are a coach."):
    return Agent(name="coach", system_prompt=prompt, model="anthropic/claude-sonnet-4-6")


def test_estimate_input_tokens_returns_positive_int():
    """Smoke test — should return a positive number for any non-empty input."""
    agent = _make_agent()
    messages = [{"role": "user", "content": "Hello, how are you?"}]
    # This calls litellm.token_counter, which works offline for Anthropic models
    count = estimate_input_tokens(messages, agent)
    assert isinstance(count, int)
    assert count > 0


def test_estimate_input_tokens_grows_with_messages():
    agent = _make_agent()
    short = [{"role": "user", "content": "Hi"}]
    long = [{"role": "user", "content": "Hi " * 500}]
    assert estimate_input_tokens(long, agent) > estimate_input_tokens(short, agent)


def test_apply_cache_control_transforms_last_message():
    messages = [
        {"role": "user", "content": "first"},
        {"role": "user", "content": "second"},
    ]
    result = apply_cache_control(messages)

    # First message unchanged
    assert result[0]["content"] == "first"

    # Last message transformed to content-block list with cache_control
    last = result[-1]
    assert isinstance(last["content"], list)
    assert last["content"][0]["type"] == "text"
    assert last["content"][0]["text"] == "second"
    assert last["content"][0]["cache_control"] == {"type": "ephemeral"}


def test_apply_cache_control_preserves_existing_block_format():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "already a block"}]},
    ]
    result = apply_cache_control(messages)
    block = result[0]["content"][0]
    assert block["cache_control"] == {"type": "ephemeral"}
    assert block["text"] == "already a block"


def test_apply_cache_control_skips_empty_list():
    result = apply_cache_control([])
    assert result == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_caching.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement caching utilities**

```python
# core/agents/caching.py
"""Token counting and prompt cache control helpers."""

import copy

from litellm import token_counter

from core.agents.agent import Agent
from core.agents.tools import build_all_transfer_tools


def estimate_input_tokens(messages: list[dict], agent: Agent) -> int:
    """Estimate the total input token count for an agent turn.

    Uses litellm.token_counter() which provides a local estimate.
    Includes system prompt, tools, and all messages.

    Note: litellm's local counter has known undercounting issues for some
    content types. We compensate with a 5k safety margin in the dispatcher.
    """
    # Build the full message list as it would be sent to the LLM
    llm_messages = [{"role": "system", "content": agent.system_prompt}]
    for m in messages:
        # Strip custom keys for counting
        clean = {"role": m["role"], "content": m.get("content", "")}
        if "tool_calls" in m:
            clean["tool_calls"] = m["tool_calls"]
        if "tool_call_id" in m:
            clean["tool_call_id"] = m["tool_call_id"]
        llm_messages.append(clean)

    tools = list(agent.extra_tools) + build_all_transfer_tools()

    return token_counter(model=agent.model, messages=llm_messages, tools=tools)


def apply_cache_control(messages: list[dict]) -> list[dict]:
    """Transform the last message's content to a content-block list with cache_control.

    LiteLLM only propagates cache_control on content blocks (not as a sibling
    key or top-level request field). This function converts the last message's
    content to the block form if needed.

    Returns a shallow copy of the list — only the last message is deep-copied.
    """
    if not messages:
        return []

    result = list(messages)  # shallow copy
    last = copy.deepcopy(result[-1])

    content = last.get("content")
    if content is None:
        # tool-call-only message — nothing to cache-control
        return result

    if isinstance(content, str):
        # Convert string to content-block list
        last["content"] = [
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
        ]
    elif isinstance(content, list):
        # Already block format — add cache_control to last block
        if content:
            content[-1]["cache_control"] = {"type": "ephemeral"}
    else:
        return result

    result[-1] = last
    return result
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_caching.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: add token counting and cache_control helpers for agent dispatch"
```

---

## Task 6: Coach Persona and Tutor Stub

**Files:**
- Create: `core/coach/__init__.py`
- Create: `core/coach/persona.py`
- Create: `core/coach/tests/__init__.py`
- Create: `core/coach/tests/test_persona.py`
- Create: `core/agents/registry.py`
- Reference: `core/modules/llm.py:15` (`DEFAULT_PROVIDER`)

- [ ] **Step 1: Write failing tests for coach persona and registry**

```python
# core/coach/tests/test_persona.py
from core.coach.persona import COACH_SYSTEM_PROMPT, build_coach_agent
from core.agents.agent import Agent


def test_coach_system_prompt_is_nonempty():
    assert len(COACH_SYSTEM_PROMPT) > 100


def test_coach_prompt_mentions_handoff_criteria():
    lower = COACH_SYSTEM_PROMPT.lower()
    assert "transfer_to_tutor" in lower or "hand off" in lower


def test_coach_prompt_mentions_scope_limits():
    lower = COACH_SYSTEM_PROMPT.lower()
    assert "course progress" in lower or "don't have access" in lower


def test_build_coach_agent_returns_agent():
    agent = build_coach_agent()
    assert isinstance(agent, Agent)
    assert agent.name == "coach"
    assert "tutor" in agent.can_handoff_to


def test_registry_has_coach_and_tutor():
    from core.agents.registry import AGENT_REGISTRY, default_agent_for
    assert "coach" in AGENT_REGISTRY
    assert "tutor" in AGENT_REGISTRY


def test_default_agent_for_discord_dm_is_coach():
    from core.agents.registry import default_agent_for
    agent = default_agent_for("discord_dm")
    assert agent.name == "coach"


def test_tutor_stub_can_handoff_to_coach():
    from core.agents.registry import AGENT_REGISTRY
    tutor = AGENT_REGISTRY["tutor"]
    assert "coach" in tutor.can_handoff_to


def test_registry_consistency():
    """Every agent's can_handoff_to targets exist in the registry."""
    from core.agents.registry import AGENT_REGISTRY
    for name, agent in AGENT_REGISTRY.items():
        for target in agent.can_handoff_to:
            assert target in AGENT_REGISTRY, (
                f"Agent '{name}' can hand off to '{target}' but '{target}' is not registered"
            )
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest core/coach/tests/test_persona.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement coach persona**

```python
# core/coach/__init__.py
```

```python
# core/coach/persona.py
from core.agents.agent import Agent
from core.modules.llm import DEFAULT_PROVIDER


COACH_SYSTEM_PROMPT = """\
You are an AI study coach and accountability partner for an AI Safety education program.

## Your role
- Help students stay motivated and on track with their studies
- Ask about their goals, progress, and what's getting in the way
- Provide encouragement, study tips, and gentle accountability
- Answer questions about course logistics, scheduling, and general support
- Be warm, curious, and conversational — short replies suit Discord DM

## What you can help with
- Study habits and motivation ("I can't get started")
- Accountability ("What's your goal for today?")
- Course logistics ("When's the next session?", "How do I join a group?")
- General support and encouragement

## What you should hand off
If the user asks a specific technical AI safety or course content question \
(e.g., "What is corrigibility?", "Explain mesa-optimization"), call \
`transfer_to_tutor` with a clear reason. Technical content questions are \
outside your expertise — the tutor handles those.

Do NOT hand off for:
- Motivation, study habits, scheduling → you handle these
- Logistics questions → you handle these
- Vague questions ("I'm confused about the course") → ask what specifically, then decide

## Scope limits
You don't currently have access to the user's course progress, calendar, \
enrollment status, or personal information. If they ask about their specific \
progress or schedule, be honest that you can't see that data yet, and suggest \
they check the web platform.

## Safety
You are not a therapist or counselor. If a student shares something that \
suggests they need professional support (crisis, mental health emergency), \
gently acknowledge it and suggest they reach out to course staff or \
appropriate professional resources. Do not attempt to provide therapy.

## Tone
Warm but not saccharine. Curious. Brief. You're a supportive peer, not a \
corporate chatbot. Match the user's energy — casual if they're casual, \
focused if they're focused.
"""


def build_coach_agent() -> Agent:
    return Agent(
        name="coach",
        system_prompt=COACH_SYSTEM_PROMPT,
        model=DEFAULT_PROVIDER,
        can_handoff_to=("tutor",),
    )
```

Create empty `core/coach/tests/__init__.py`.

- [ ] **Step 4: Implement registry with tutor stub**

```python
# core/agents/registry.py
from core.agents.agent import Agent
from core.agents import tools as tools_module
from core.coach.persona import build_coach_agent
from core.modules.llm import DEFAULT_PROVIDER


_TUTOR_STUB_PROMPT = """\
You are a placeholder for the AI safety tutor, which isn't fully integrated yet.

Briefly acknowledge what the user asked about, apologize that the tutor \
integration is still being built, and suggest they continue with the coach \
for now. Then call `transfer_to_coach` with reason "tutor_stub".

Keep your reply to 1-2 sentences before handing back.
"""


def _build_tutor_stub() -> Agent:
    return Agent(
        name="tutor",
        system_prompt=_TUTOR_STUB_PROMPT,
        model=DEFAULT_PROVIDER,
        can_handoff_to=("coach",),
    )


AGENT_REGISTRY: dict[str, Agent] = {
    "coach": build_coach_agent(),
    "tutor": _build_tutor_stub(),
}

# Wire up tools.py's forward reference so build_all_transfer_tools() works
tools_module.AGENT_REGISTRY = AGENT_REGISTRY

PLATFORM_DEFAULTS: dict[str, str] = {
    "discord_dm": "coach",
    "whatsapp": "coach",
    "web_coach": "coach",
}


def default_agent_for(platform: str) -> Agent:
    name = PLATFORM_DEFAULTS.get(platform)
    if name is None:
        raise ValueError(f"No default agent for platform: {platform}")
    return AGENT_REGISTRY[name]
```

- [ ] **Step 5: Run test to verify it passes**

```bash
.venv/bin/pytest core/coach/tests/test_persona.py -v
```

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
jj new -m "feat: add coach persona, tutor stub, and agent registry"
```

---

## Task 7: Dispatcher — Core Dispatch Loop with Handoff

**Files:**
- Create: `core/agents/dispatcher.py`
- Create: `core/agents/tests/test_dispatcher.py`
- Reference: `core/modules/llm.py` (for `acompletion`), spec dispatch protocol section

This is the largest task. We split tests into sub-steps: happy path first, then handoff, then error cases.

- [ ] **Step 1: Write failing test — happy path (no handoff)**

```python
# core/agents/tests/test_dispatcher.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from core.agents.identity import PlatformIdentity
from core.agents.dispatcher import handle_message


def _mock_llm_response(content="Hello! I'm the coach.", tool_calls=None):
    """Build a mock LiteLLM response object."""
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


@pytest.fixture
def discord_identity():
    return PlatformIdentity(type="discord", id=777777777777, platform_name="discord_dm")


@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_happy_path_no_handoff(mock_llm, discord_identity):
    mock_llm.return_value = _mock_llm_response("Hi there! How's studying going?")

    result = await handle_message(discord_identity, "Hey")

    assert result.kind == "ok"
    assert "studying" in result.reply_text.lower() or len(result.reply_text) > 0
    mock_llm.assert_called_once()

    # Verify the system prompt was the coach's
    call_kwargs = mock_llm.call_args
    messages = call_kwargs.kwargs.get("messages") or call_kwargs[1].get("messages")
    assert messages[0]["role"] == "system"
    assert "coach" in messages[0]["content"].lower() or "study" in messages[0]["content"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher.py::test_happy_path_no_handoff -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement the dispatcher**

```python
# core/agents/dispatcher.py
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

# Per-user locks (in-process; sufficient for single-process prototype)
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

        # Check if it's a transfer tool
        if not func_name.startswith("transfer_to_"):
            # Not a transfer tool — might be a regular tool call
            # For now, emit error (no regular tools in prototype)
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": f"Unknown tool '{func_name}'. No action taken.",
            })
            continue

        # Parse target agent name
        target = func_name.removeprefix("transfer_to_")

        # Validate target is in can_handoff_to
        if target not in active_agent.can_handoff_to:
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": f"Handoff to '{target}' not allowed for {active_agent.name}. Ignored.",
            })
            continue

        # Validate arguments
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

        # Valid handoff found
        if valid_handoff is not None:
            # Ambiguous — multiple valid handoffs. Reject both.
            session_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": "Multiple handoffs in one message are not supported. Ignored.",
            })
            continue

        valid_handoff = _HandoffInfo(target=target, tool_call_id=tc_id)

    return valid_handoff


async def _run_agent(agent: Agent, messages: list[dict]) -> dict:
    """Run an LLM call for the given agent and return the assistant message.

    Returns the raw assistant message dict (with content, tool_calls, etc.).
    """
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

    # Build the message dict to persist
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

    while True:
        # Token cap — re-checked each iteration because active agent may change
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
        # Still return the response — UX > perfect persistence for prototype

    # Extract final text from the last assistant message
    final_text = None
    for msg in reversed(session["messages"]):
        if msg.get("role") == "assistant" and msg.get("content"):
            final_text = msg["content"]
            break

    return HandleResult(
        kind="ok",
        reply_text=final_text or "I'm not sure what to say. Could you try again?",
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher.py::test_happy_path_no_handoff -v
```

Expected: PASS.

- [ ] **Step 5: Write failing test — handoff path**

Add to `core/agents/tests/test_dispatcher.py`:

```python
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_handoff_coach_to_tutor_stub(mock_llm, discord_identity):
    """Coach hands off to tutor, tutor stub replies and hands back."""
    # Call 1: Coach calls transfer_to_tutor
    coach_tc = MagicMock()
    coach_tc.id = "call_handoff_1"
    coach_tc.function.name = "transfer_to_tutor"
    coach_tc.function.arguments = '{"reason": "Technical question"}'
    coach_response = _mock_llm_response(content=None, tool_calls=[coach_tc])

    # Call 2: Tutor stub responds with text (no further handoff due to MAX=1)
    tutor_response = _mock_llm_response(content="That's a great question about corrigibility! The tutor integration isn't live yet — continuing with the coach.")

    mock_llm.side_effect = [coach_response, tutor_response]

    result = await handle_message(discord_identity, "What is corrigibility?")

    assert result.kind == "ok"
    assert mock_llm.call_count == 2
    # Verify second call used the tutor's system prompt
    second_call = mock_llm.call_args_list[1]
    second_messages = second_call.kwargs.get("messages") or second_call[1].get("messages")
    assert "placeholder" in second_messages[0]["content"].lower() or "tutor" in second_messages[0]["content"].lower()
```

- [ ] **Step 6: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher.py::test_handoff_coach_to_tutor_stub -v
```

Expected: FAIL — the dispatcher should be implemented but the test may need adjustment based on exact mocking shape. Iterate until it fails for the right reason (behavior, not import error).

- [ ] **Step 7: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher.py -v
```

Expected: 2 passed (happy path + handoff).

- [ ] **Step 8: Write failing test — token cap**

Add to `core/agents/tests/test_dispatcher.py`:

```python
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
@patch("core.agents.dispatcher.estimate_input_tokens", return_value=46_000)
async def test_token_cap_returns_error(mock_estimate, mock_llm, discord_identity):
    result = await handle_message(discord_identity, "This is a very long conversation")

    assert result.kind == "error"
    assert "too long" in result.reply_text.lower()
    mock_llm.assert_not_called()  # LLM should NOT be called
```

- [ ] **Step 9: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher.py -v
```

Expected: 3 passed.

- [ ] **Step 10: Write failing test — invalid handoff target**

Add to `core/agents/tests/test_dispatcher.py`:

```python
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_invalid_handoff_target_emits_error_tool_result(mock_llm, discord_identity):
    """If LLM calls transfer_to_typo, emit error tool-result and get text reply."""
    bad_tc = MagicMock()
    bad_tc.id = "call_bad"
    bad_tc.function.name = "transfer_to_typo"
    bad_tc.function.arguments = '{"reason": "test"}'
    bad_response = _mock_llm_response(content=None, tool_calls=[bad_tc])

    text_response = _mock_llm_response(content="Let me help you directly instead.")

    mock_llm.side_effect = [bad_response, text_response]

    result = await handle_message(discord_identity, "Hello")

    assert result.kind == "ok"
    assert "help" in result.reply_text.lower() or len(result.reply_text) > 0
```

- [ ] **Step 11: Run test to verify it passes**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher.py -v
```

Expected: 4 passed.

- [ ] **Step 12: Commit**

```bash
jj new -m "feat: add multi-agent dispatcher with handoff support, token cap, and error handling"
```

---

## Task 8: Discord Coach Cog

**Files:**
- Create: `discord_bot/cogs/coach_cog.py`
- Create: `discord_bot/tests/test_coach_cog.py`
- Modify: `discord_bot/main.py:34-44` (add to COGS list)
- Reference: `discord_bot/cogs/stampy_cog.py:249-270` (on_message pattern), `discord_bot/cogs/stampy_cog.py:493-506` (chunking)

- [ ] **Step 1: Write failing tests for cog filtering and chunking**

```python
# discord_bot/tests/test_coach_cog.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import discord

# We can't easily construct real discord.Message objects, so we test
# the helper functions and the cog's filtering logic indirectly.

from discord_bot.cogs.coach_cog import _send_in_chunks, _should_handle


def test_should_handle_ignores_bots():
    msg = MagicMock()
    msg.author.bot = True
    assert _should_handle(msg) is False


def test_should_handle_ignores_non_dm():
    msg = MagicMock()
    msg.author.bot = False
    msg.channel = MagicMock(spec=discord.TextChannel)  # NOT a DMChannel
    assert _should_handle(msg) is False


def test_should_handle_ignores_empty():
    msg = MagicMock()
    msg.author.bot = False
    msg.channel = MagicMock(spec=discord.DMChannel)
    msg.content = "   "
    assert _should_handle(msg) is False


def test_should_handle_accepts_valid_dm():
    msg = MagicMock()
    msg.author.bot = False
    msg.channel = MagicMock(spec=discord.DMChannel)
    msg.content = "Hello coach!"
    assert _should_handle(msg) is True


@pytest.mark.asyncio
async def test_send_in_chunks_short_message():
    channel = AsyncMock()
    await _send_in_chunks(channel, "Short message")
    channel.send.assert_called_once_with("Short message")


@pytest.mark.asyncio
async def test_send_in_chunks_long_message():
    channel = AsyncMock()
    # 3000 chars = should be split into 2 messages
    long_text = "a" * 3000
    await _send_in_chunks(channel, long_text)
    assert channel.send.call_count == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest discord_bot/tests/test_coach_cog.py -v
```

Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement coach cog**

```python
# discord_bot/cogs/coach_cog.py
"""Discord cog that handles DM messages via the AI coach agent dispatcher."""

import logging

import discord
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.agents.dispatcher import handle_message, HandleResult
from core.agents.identity import PlatformIdentity

logger = logging.getLogger(__name__)

DISCORD_MAX_LENGTH = 2000


def _should_handle(message: discord.Message) -> bool:
    """Return True if this message should be handled by the coach cog."""
    if message.author.bot:
        return False
    if not isinstance(message.channel, discord.DMChannel):
        return False
    if not message.content.strip():
        return False
    return True


async def _send_in_chunks(channel: discord.abc.Messageable, text: str) -> None:
    """Send a message, splitting into chunks if it exceeds Discord's limit."""
    if len(text) <= DISCORD_MAX_LENGTH:
        await channel.send(text)
        return

    # Split on newline boundaries where possible
    chunks = []
    remaining = text
    while remaining:
        if len(remaining) <= DISCORD_MAX_LENGTH:
            chunks.append(remaining)
            break
        # Find a good split point
        split_at = remaining.rfind("\n", 0, DISCORD_MAX_LENGTH)
        if split_at == -1 or split_at < DISCORD_MAX_LENGTH // 2:
            # No good newline — split at max length
            split_at = DISCORD_MAX_LENGTH
        chunks.append(remaining[:split_at])
        remaining = remaining[split_at:].lstrip("\n")

    for chunk in chunks:
        if chunk.strip():
            await channel.send(chunk)


class CoachCog(commands.Cog):
    """Listens for DM messages and routes them through the AI coach dispatcher."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if not _should_handle(message):
            return

        identity = PlatformIdentity(
            type="discord",
            id=message.author.id,
            platform_name="discord_dm",
        )

        async with message.channel.typing():
            try:
                result: HandleResult = await handle_message(identity, message.content)
            except Exception:
                logger.exception("coach_cog_error", extra={
                    "discord_user_id": message.author.id,
                })
                await message.channel.send(
                    "Sorry, something went wrong on my end. Please try again in a moment."
                )
                return

        await _send_in_chunks(message.channel, result.reply_text)


async def setup(bot: commands.Bot):
    await bot.add_cog(CoachCog(bot))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/pytest discord_bot/tests/test_coach_cog.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Register the cog in main.py**

Modify `discord_bot/main.py` — add `"cogs.coach_cog"` to the `COGS` list (after `"cogs.stampy_cog"`):

```python
COGS = [
    "cogs.ping_cog",
    "cogs.enrollment_cog",
    "cogs.scheduler_cog",
    "cogs.groups_cog",
    "cogs.breakout_cog",
    "cogs.sync_cog",
    "cogs.stampy_cog",
    "cogs.coach_cog",  # AI coach DM handler
    "discord_bot.cogs.nickname_cog",
]
```

- [ ] **Step 6: Commit**

```bash
jj new -m "feat: add Discord coach cog with DM handling and message chunking"
```

---

## Task 9: Public Exports and Integration Smoke Test

**Files:**
- Modify: `core/agents/__init__.py`
- No new test files — this task verifies integration

- [ ] **Step 1: Update core/agents/__init__.py with public exports**

```python
# core/agents/__init__.py
from core.agents.dispatcher import handle_message, HandleResult
from core.agents.identity import PlatformIdentity, resolve_user_id
from core.agents.registry import AGENT_REGISTRY, default_agent_for

__all__ = [
    "handle_message",
    "HandleResult",
    "PlatformIdentity",
    "resolve_user_id",
    "AGENT_REGISTRY",
    "default_agent_for",
]
```

- [ ] **Step 2: Run the full test suite**

```bash
.venv/bin/pytest core/agents/tests/ core/coach/tests/ discord_bot/tests/test_coach_cog.py -v
```

Expected: All tests pass (should be ~20+ tests across all files).

- [ ] **Step 3: Run the existing test suite to check for regressions**

```bash
.venv/bin/pytest core/tests/ discord_bot/tests/ web_api/tests/ -v --timeout=60
```

Expected: No regressions. If any fail, investigate before proceeding.

- [ ] **Step 4: Commit**

```bash
jj new -m "feat: add core.agents public exports and verify integration"
```

---

## Task 10: Manual End-to-End Test

**Files:** None created — this is a manual verification step.

- [ ] **Step 1: Start the dev server**

```bash
cd /home/penguin/code/lens-platform/ws1
python main.py --port 8100
```

Verify the bot connects to Discord (look for `on_ready` log).

- [ ] **Step 2: DM the bot from Discord**

Send a casual message like "Hey, I'm feeling stuck with the course this week."

Expected: The coach responds with a warm, supportive reply. Check the server logs for the structured log line (user_id, agent, etc.).

- [ ] **Step 3: Trigger a handoff**

Send: "What is instrumental convergence?"

Expected: The coach should call `transfer_to_tutor`. The tutor stub should reply briefly and hand back. Check the database to verify:
- The `messages` JSONB contains the tool_call with `transfer_to_tutor`
- The subsequent assistant messages have `"agent": "tutor"` and `"agent": "coach"` tags

```bash
.venv/bin/python -c "
import asyncio
from core.database import get_connection
from sqlalchemy import select, text

async def check():
    async with get_connection() as conn:
        result = await conn.execute(text(
            \"SELECT messages FROM chat_sessions WHERE module_id IS NULL AND archived_at IS NULL ORDER BY last_active_at DESC LIMIT 1\"
        ))
        row = result.fetchone()
        if row:
            import json
            msgs = row[0] if isinstance(row[0], list) else json.loads(row[0])
            for m in msgs:
                agent = m.get('agent', '')
                role = m['role']
                content = str(m.get('content', ''))[:80]
                tc = 'TOOL_CALL' if 'tool_calls' in m else ''
                print(f'{role:10} {agent:8} {tc:10} {content}')

asyncio.run(check())
"
```

- [ ] **Step 4: Verify prompt caching**

Check the server logs or add a temporary print. After 2+ turns, look for `cache_read_input_tokens > 0` in the LiteLLM response usage. If it's 0 on every turn, the `cache_control` content-block format isn't being propagated — debug the message shape in `_run_agent`.

- [ ] **Step 5: Document any issues found**

Create a note of any issues or prompt adjustments needed. The coach persona prompt will likely need iteration — this is expected and is the highest-leverage work going forward.

---

## Self-Review Checklist

- [x] **Spec coverage**: Migration (Task 1), Agent+Tools (Task 2), Identity (Task 3), Sessions (Task 4), Caching (Task 5), Personas+Registry (Task 6), Dispatcher (Task 7), Discord Cog (Task 8), Integration (Task 9), E2E (Task 10). All spec sections covered.
- [x] **Placeholder scan**: No TBD/TODO. All code blocks are complete.
- [x] **Type consistency**: `Agent`, `PlatformIdentity`, `HandleResult`, `_HandoffInfo` used consistently. `build_all_transfer_tools()` wired through `tools_module.AGENT_REGISTRY` in registry.py.
- [x] **TDD**: Every implementation task has RED→GREEN→commit. Tests mock only LiteLLM (external) and Discord (external). Sessions tests hit real DB.
- [x] **Testing anti-patterns**: No test-only production methods. No mock-behavior assertions. Mocks only at the slow/external boundary (LiteLLM API, Discord API). Token counting test uses real `litellm.token_counter` (local, no network).
