# AI Coach Phase 2: Persistence, Tools & Scheduled Jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the AI coach from a generic chatbot into a personalized assistant with per-user memory files, course-context tools, scheduled check-ins, and message timestamps.

**Architecture:** Phase 2 builds on the Phase 1 agent dispatcher (branch tip `lspzzswv`). It adds a tool execution loop to the dispatcher, DB-backed per-user files, course-context tools, scheduled job processing via APScheduler, and per-turn context injection. The coach persona moves from `core/coach/` to `core/agents/coach/`.

**Tech Stack:** Python 3.12, SQLAlchemy (async), PostgreSQL, LiteLLM, APScheduler, Alembic, pytest

**Spec:** `docs/superpowers/specs/2026-04-25-ai-coach-phase2-persistence-tools-design.md`

---

## Prerequisites

This plan builds on Phase 1 code (branch tip `lspzzswv`, change ID `lspzzswv`). Before starting:

```bash
# Rebase Phase 1 onto current main so we start from a clean base
jj rebase -s mmyoxtxy -d main
# Create a new working change on top of the Phase 1 tip
jj new lspzzswv -m "phase 2: persistence, tools, scheduled jobs"
```

Verify Phase 1 tests still pass after rebase:

```bash
.venv/bin/pytest core/agents/tests/ core/coach/tests/ discord_bot/tests/test_coach_cog.py -v
```

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `core/agents/user_files.py` | Load/save per-user files (agent_style.md, user.md, memory.md) from `coach_user_files` table |
| `core/agents/tools/__init__.py` | Aggregates tool schemas + dispatcher function |
| `core/agents/tools/memory_tools.py` | `read_file`, `edit_file`, `append_memory` tool handlers + schemas |
| `core/agents/tools/progress_tools.py` | `get_my_progress`, `get_my_upcoming_deadlines` tool handlers + schemas |
| `core/agents/tools/scheduling_tools.py` | `schedule_reminder`, `list_my_reminders`, `cancel_reminder` tool handlers + schemas |
| `core/agents/coach/__init__.py` | Package init (re-exports `build_coach_agent`) |
| `core/agents/coach/persona.py` | Moved from `core/coach/persona.py`, updated system prompt + tool_executor wiring |
| `core/agents/coach/context.py` | Builds per-turn context injection block |
| `core/agents/coach/tests/__init__.py` | Test package |
| `core/agents/coach/tests/test_persona.py` | Moved from `core/coach/tests/test_persona.py` |
| `core/agents/tests/test_user_files.py` | Tests for user_files.py |
| `core/agents/tests/test_memory_tools.py` | Tests for memory tools |
| `core/agents/tests/test_progress_tools.py` | Tests for progress tools |
| `core/agents/tests/test_scheduling_tools.py` | Tests for scheduling tools |
| `core/agents/tests/test_context.py` | Tests for context injection |
| `core/agents/tests/test_dispatcher_tools.py` | Tests for dispatcher tool execution loop |
| `core/agents/tests/test_job_processor.py` | Tests for scheduled job processing |
| `alembic/versions/XXXX_coach_phase2_tables.py` | Migration for `coach_user_files` + `coach_scheduled_jobs` |

### Modified files

| File | Changes |
|------|---------|
| `core/tables.py` | Add `coach_user_files` and `coach_scheduled_jobs` table definitions |
| `core/agents/agent.py` | Add `tool_executor` field to Agent dataclass |
| `core/agents/dispatcher.py` | Add non-transfer tool execution loop, message timestamps, context injection, user timezone lookup |
| `core/agents/registry.py` | Update import path from `core.coach.persona` → `core.agents.coach.persona` |
| `core/agents/__init__.py` | No changes needed (imports from registry/dispatcher) |
| `core/notifications/scheduler.py` | Add `process_due_coach_jobs` function + APScheduler interval job |
| `discord_bot/cogs/coach_cog.py` | No changes needed |

### Deleted files

| File | Reason |
|------|--------|
| `core/coach/__init__.py` | Moved to `core/agents/coach/` |
| `core/coach/persona.py` | Moved to `core/agents/coach/persona.py` |
| `core/coach/tests/__init__.py` | Moved to `core/agents/coach/tests/` |
| `core/coach/tests/test_persona.py` | Moved to `core/agents/coach/tests/` |

---

## Task 1: DB Schema — Tables + Alembic Migration

Add `coach_user_files` and `coach_scheduled_jobs` table definitions to `core/tables.py` and generate an Alembic migration.

**Files:**
- Modify: `core/tables.py` (append after existing tables)
- Create: `alembic/versions/XXXX_coach_phase2_tables.py` (auto-generated, then reviewed)

- [ ] **Step 1: Add table definitions to `core/tables.py`**

Append after the last table definition (after `question_assessments`):

```python
# =====================================================
# COACH: PER-USER FILES
# =====================================================
coach_user_files = Table(
    "coach_user_files",
    metadata,
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("filename", Text, nullable=False),
    Column("content", Text, nullable=False, server_default=""),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
    PrimaryKeyConstraint("user_id", "filename"),
)


# =====================================================
# COACH: SCHEDULED JOBS
# =====================================================
coach_scheduled_jobs = Table(
    "coach_scheduled_jobs",
    metadata,
    Column("job_id", UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("fire_at", TIMESTAMP(timezone=True), nullable=False),
    Column("reason", Text, nullable=False),
    Column("status", Text, nullable=False, server_default="pending"),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now(), nullable=False),
    Column("resolved_at", TIMESTAMP(timezone=True)),
    Index("idx_coach_jobs_pending", "fire_at", postgresql_where=text("status = 'pending'")),
    Index("idx_coach_jobs_user", "user_id"),
)
```

You will also need to add `PrimaryKeyConstraint` to the imports at the top of `core/tables.py` (from `sqlalchemy`), and `UUID` from `sqlalchemy.dialects.postgresql` if not already imported.

- [ ] **Step 2: Auto-generate Alembic migration**

```bash
.venv/bin/alembic revision --autogenerate -m "coach phase 2: user files and scheduled jobs tables"
```

- [ ] **Step 3: Review the generated migration**

Open the generated file in `alembic/versions/`. Verify it contains:

- `CREATE TABLE coach_user_files` with composite PK `(user_id, filename)`
- `CREATE TABLE coach_scheduled_jobs` with UUID PK
- The partial index `idx_coach_jobs_pending` with `WHERE status = 'pending'`
- The index `idx_coach_jobs_user`
- Proper `downgrade()` that drops both tables

Fix any issues the autogenerate missed (partial indexes are often missed — add manually if needed).

- [ ] **Step 4: Run the migration**

```bash
.venv/bin/alembic upgrade head
```

Expected: migration completes without errors.

- [ ] **Step 5: Verify tables exist**

```bash
.venv/bin/python -c "
import asyncio
from core.database import get_connection
from sqlalchemy import text

async def check():
    async with get_connection() as conn:
        r1 = await conn.execute(text(\"SELECT column_name FROM information_schema.columns WHERE table_name='coach_user_files' ORDER BY ordinal_position\"))
        print('coach_user_files columns:', [row[0] for row in r1])
        r2 = await conn.execute(text(\"SELECT column_name FROM information_schema.columns WHERE table_name='coach_scheduled_jobs' ORDER BY ordinal_position\"))
        print('coach_scheduled_jobs columns:', [row[0] for row in r2])

asyncio.run(check())
"
```

Expected: both tables list correct columns.

- [ ] **Step 6: Commit**

```bash
jj describe -m "feat(coach): add coach_user_files and coach_scheduled_jobs tables"
jj new
```

---

## Task 2: Agent Dataclass — Add `tool_executor` Field

Extend the `Agent` dataclass with an optional `tool_executor` callable.

**Files:**
- Modify: `core/agents/agent.py`
- Test: `core/agents/tests/test_agent.py` (existing)

- [ ] **Step 1: Write failing test**

Add to `core/agents/tests/test_agent.py`:

```python
def test_agent_with_tool_executor():
    """Agent can be created with a tool_executor callable."""
    async def fake_executor(tool_call, user_id):
        return "result"

    agent = Agent(
        name="test",
        system_prompt="prompt",
        model="test-model",
        tool_executor=fake_executor,
    )
    assert agent.tool_executor is fake_executor


def test_agent_tool_executor_defaults_to_none():
    """Agent.tool_executor defaults to None when not provided."""
    agent = Agent(
        name="test",
        system_prompt="prompt",
        model="test-model",
    )
    assert agent.tool_executor is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/pytest core/agents/tests/test_agent.py::test_agent_with_tool_executor -v
```

Expected: FAIL with `TypeError: Agent.__init__() got an unexpected keyword argument 'tool_executor'`

- [ ] **Step 3: Add `tool_executor` field to Agent**

Modify `core/agents/agent.py`:

```python
from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class Agent:
    """An immutable agent definition with a persona and handoff targets."""
    name: str
    system_prompt: str
    model: str
    extra_tools: tuple[dict, ...] = field(default_factory=tuple)
    can_handoff_to: tuple[str, ...] = field(default_factory=tuple)
    tool_executor: Callable | None = None
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_agent.py -v
```

Expected: all tests PASS (including existing tests).

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat(coach): add tool_executor field to Agent dataclass"
jj new
```

---

## Task 3: Per-User Files CRUD — `user_files.py`

Create the module that loads and saves per-user files from the `coach_user_files` table.

**Files:**
- Create: `core/agents/user_files.py`
- Create: `core/agents/tests/test_user_files.py`

- [ ] **Step 1: Write failing tests**

Create `core/agents/tests/test_user_files.py`:

```python
"""Tests for per-user file storage."""

import pytest
from core.agents.user_files import load_user_files, save_user_file, VALID_FILENAMES


# These tests hit the real DB (unit+1 style).
# The conftest.py autouse fixture resets the engine per test.


@pytest.mark.asyncio
async def test_load_creates_empty_files_for_new_user():
    """First load for a user creates three empty files."""
    # user_id=99999 is unlikely to exist; get_or_create_user not needed here
    # because user_files only references user_id, and we use a raw insert test pattern.
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy import insert

    async with get_transaction() as conn:
        await conn.execute(
            insert(users).values(user_id=99999, discord_id="test_uf_99999")
        )

    files = await load_user_files(99999)
    assert set(files.keys()) == {"agent_style.md", "user.md", "memory.md"}
    assert all(v == "" for v in files.values())


@pytest.mark.asyncio
async def test_load_returns_existing_content():
    """After saving, load returns the saved content."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy import insert

    async with get_transaction() as conn:
        await conn.execute(
            insert(users).values(user_id=99998, discord_id="test_uf_99998")
        )

    # First load creates files
    await load_user_files(99998)

    # Save some content
    await save_user_file(99998, "agent_style.md", "Be direct and concise.")

    # Reload
    files = await load_user_files(99998)
    assert files["agent_style.md"] == "Be direct and concise."
    assert files["user.md"] == ""
    assert files["memory.md"] == ""


@pytest.mark.asyncio
async def test_save_rejects_unknown_filename():
    """save_user_file raises ValueError for unknown filenames."""
    with pytest.raises(ValueError, match="Unknown file"):
        await save_user_file(1, "evil.md", "bad content")


def test_valid_filenames():
    """VALID_FILENAMES contains exactly the three expected files."""
    assert VALID_FILENAMES == {"agent_style.md", "user.md", "memory.md"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_user_files.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'core.agents.user_files'`

- [ ] **Step 3: Implement `user_files.py`**

Create `core/agents/user_files.py`:

```python
"""Load/save per-user Markdown files from coach_user_files table."""

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.database import get_connection, get_transaction
from core.tables import coach_user_files

VALID_FILENAMES = {"agent_style.md", "user.md", "memory.md"}


async def load_user_files(user_id: int) -> dict[str, str]:
    """Load all per-user files, creating empty ones if they don't exist.

    Returns dict mapping filename to content string.
    Always returns exactly three keys: agent_style.md, user.md, memory.md.
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_user_files.c.filename, coach_user_files.c.content).where(
                coach_user_files.c.user_id == user_id
            )
        )
        existing = {row.filename: row.content for row in result}

    missing = VALID_FILENAMES - existing.keys()
    if missing:
        async with get_transaction() as conn:
            for filename in missing:
                await conn.execute(
                    pg_insert(coach_user_files)
                    .values(user_id=user_id, filename=filename, content="")
                    .on_conflict_do_nothing()
                )
        # Re-read to get consistent state
        async with get_connection() as conn:
            result = await conn.execute(
                select(coach_user_files.c.filename, coach_user_files.c.content).where(
                    coach_user_files.c.user_id == user_id
                )
            )
            existing = {row.filename: row.content for row in result}

    return {fn: existing.get(fn, "") for fn in VALID_FILENAMES}


async def save_user_file(user_id: int, filename: str, content: str) -> None:
    """Save content to a per-user file. Raises ValueError for unknown filenames."""
    if filename not in VALID_FILENAMES:
        raise ValueError(f"Unknown file: {filename}. Valid files: {', '.join(sorted(VALID_FILENAMES))}")

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(coach_user_files)
            .values(user_id=user_id, filename=filename, content=content)
            .on_conflict_do_update(
                index_elements=["user_id", "filename"],
                set_={"content": content, "updated_at": func.now()},
            )
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_user_files.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat(coach): add per-user file storage (agent_style.md, user.md, memory.md)"
jj new
```

---

## Task 4: Memory Tools — `read_file`, `edit_file`, `append_memory`

Implement the memory tool handlers and their LLM-facing schemas.

**Files:**
- Create: `core/agents/tools/__init__.py` (empty initially, built up in Task 7)
- Create: `core/agents/tools/memory_tools.py`
- Create: `core/agents/tests/test_memory_tools.py`

- [ ] **Step 1: Convert `tools.py` to `tools/` package**

Phase 1 has `core/agents/tools.py` (a single file with transfer tool builders). Phase 2 needs `core/agents/tools/` as a package directory. You can't have both — move the transfer tool code into a submodule.

```bash
# Rename the old module to the new submodule location
mkdir -p core/agents/tools
mv core/agents/tools.py core/agents/tools/transfer.py
```

Create `core/agents/tools/__init__.py` (initially just re-exporting transfer tools):

```python
"""Coach tool executor registry.

Re-exports transfer tool builders for backward compatibility.
"""

from .transfer import build_transfer_tool, build_all_transfer_tools, AGENT_REGISTRY

__all__ = ["build_transfer_tool", "build_all_transfer_tools", "AGENT_REGISTRY"]
```

Update imports in files that reference the old `core.agents.tools` module:

In `core/agents/dispatcher.py`, change:
```python
# Old:
from core.agents.tools import build_all_transfer_tools
# New:
from core.agents.tools.transfer import build_all_transfer_tools
```

In `core/agents/caching.py`, change:
```python
# Old:
from core.agents.tools import build_all_transfer_tools
# New:
from core.agents.tools.transfer import build_all_transfer_tools
```

In `core/agents/registry.py`, change:
```python
# Old:
from core.agents import tools as tools_module
# ...
tools_module.AGENT_REGISTRY = AGENT_REGISTRY
# New:
from core.agents.tools import transfer as transfer_module
# ...
transfer_module.AGENT_REGISTRY = AGENT_REGISTRY
```

Verify Phase 1 tests still pass after this refactor:

```bash
.venv/bin/pytest core/agents/tests/ -v
```

- [ ] **Step 2: Write failing tests**

Create `core/agents/tests/test_memory_tools.py`:

```python
"""Tests for memory tools (read_file, edit_file, append_memory)."""

import pytest
from datetime import date
from core.agents.tools.memory_tools import (
    execute_read_file,
    execute_edit_file,
    execute_append_memory,
    MEMORY_TOOL_SCHEMAS,
    MEMORY_SOFT_LIMIT,
)
from core.agents.user_files import load_user_files, save_user_file


# --- Helpers ---

async def _setup_user(user_id: int):
    """Create a test user and initialize their files."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy import insert
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=user_id, discord_id=f"test_mt_{user_id}")
            .on_conflict_do_nothing()
        )
    await load_user_files(user_id)  # creates empty files


# --- read_file tests ---

@pytest.mark.asyncio
async def test_read_file_returns_content():
    await _setup_user(90001)
    await save_user_file(90001, "agent_style.md", "Be concise.")
    result = await execute_read_file(90001, "agent_style.md")
    assert result == "Be concise."


@pytest.mark.asyncio
async def test_read_file_returns_empty_for_new_file():
    await _setup_user(90002)
    result = await execute_read_file(90002, "memory.md")
    assert result == "(empty)"


@pytest.mark.asyncio
async def test_read_file_rejects_unknown():
    result = await execute_read_file(1, "evil.md")
    assert "Unknown file" in result


# --- edit_file tests ---

@pytest.mark.asyncio
async def test_edit_file_replaces_text():
    await _setup_user(90003)
    await save_user_file(90003, "user.md", "Name: Alice\nGoal: Learn AI safety")
    result = await execute_edit_file(90003, "user.md", "Name: Alice", "Name: Bob")
    assert "Updated" in result
    files = await load_user_files(90003)
    assert files["user.md"] == "Name: Bob\nGoal: Learn AI safety"


@pytest.mark.asyncio
async def test_edit_file_not_found():
    await _setup_user(90004)
    await save_user_file(90004, "user.md", "Name: Alice")
    result = await execute_edit_file(90004, "user.md", "Name: Bob", "Name: Carol")
    assert "not found" in result.lower()


@pytest.mark.asyncio
async def test_edit_file_ambiguous_match():
    await _setup_user(90005)
    await save_user_file(90005, "user.md", "apple and apple")
    result = await execute_edit_file(90005, "user.md", "apple", "orange")
    assert "ambiguous" in result.lower() or "multiple" in result.lower()


@pytest.mark.asyncio
async def test_edit_file_rejects_unknown_filename():
    result = await execute_edit_file(1, "evil.md", "a", "b")
    assert "Unknown file" in result


# --- append_memory tests ---

@pytest.mark.asyncio
async def test_append_memory_adds_timestamped_note():
    await _setup_user(90006)
    result = await execute_append_memory(90006, "User prefers mornings")
    assert "Noted" in result or "Added" in result
    files = await load_user_files(90006)
    today = date.today().isoformat()
    assert f"- {today}: User prefers mornings" in files["memory.md"]


@pytest.mark.asyncio
async def test_append_memory_appends_multiple():
    await _setup_user(90007)
    await execute_append_memory(90007, "First note")
    await execute_append_memory(90007, "Second note")
    files = await load_user_files(90007)
    assert "First note" in files["memory.md"]
    assert "Second note" in files["memory.md"]


@pytest.mark.asyncio
async def test_append_memory_warns_at_soft_limit():
    await _setup_user(90008)
    # Write content just over the soft limit
    big_content = "x" * (MEMORY_SOFT_LIMIT + 1)
    await save_user_file(90008, "memory.md", big_content)
    result = await execute_append_memory(90008, "One more note")
    assert "getting long" in result.lower() or "clean" in result.lower()


# --- schema tests ---

def test_schemas_have_correct_names():
    names = {s["function"]["name"] for s in MEMORY_TOOL_SCHEMAS}
    assert names == {"read_file", "edit_file", "append_memory"}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_memory_tools.py -v
```

Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Implement `memory_tools.py`**

Create `core/agents/tools/memory_tools.py`:

```python
"""Memory tools: read_file, edit_file, append_memory.

These let the coach read and edit per-user Markdown files.
"""

from datetime import date

from core.agents.user_files import load_user_files, save_user_file, VALID_FILENAMES

MEMORY_SOFT_LIMIT = 10_000  # chars — warn coach when memory.md exceeds this


MEMORY_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "Read one of your per-user files: agent_style.md, user.md, or memory.md. "
                "Returns the file content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "File to read: agent_style.md, user.md, or memory.md",
                    },
                },
                "required": ["filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Surgical find-and-replace within a per-user file. "
                "old_string must match exactly once in the file. "
                "Read the file first to see current content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "File to edit: agent_style.md, user.md, or memory.md",
                    },
                    "old_string": {
                        "type": "string",
                        "description": "Exact text to find (must appear exactly once)",
                    },
                    "new_string": {
                        "type": "string",
                        "description": "Replacement text",
                    },
                },
                "required": ["filename", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "append_memory",
            "description": (
                "Append a timestamped note to memory.md. "
                "Use this for observations, decisions, or patterns you've noticed about the user."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note": {
                        "type": "string",
                        "description": "The note to append",
                    },
                },
                "required": ["note"],
            },
        },
    },
]


async def execute_read_file(user_id: int, filename: str) -> str:
    """Read a per-user file. Returns content or error string."""
    if filename not in VALID_FILENAMES:
        return f"Unknown file: {filename}. Valid files: {', '.join(sorted(VALID_FILENAMES))}"
    files = await load_user_files(user_id)
    content = files[filename]
    return content if content else "(empty)"


async def execute_edit_file(
    user_id: int, filename: str, old_string: str, new_string: str
) -> str:
    """Find-and-replace within a per-user file. Returns status message."""
    if filename not in VALID_FILENAMES:
        return f"Unknown file: {filename}. Valid files: {', '.join(sorted(VALID_FILENAMES))}"

    files = await load_user_files(user_id)
    content = files[filename]

    count = content.count(old_string)
    if count == 0:
        return f"Text not found in {filename}. Read the file first to see current content."
    if count > 1:
        return (
            f"Ambiguous match — text appears {count} times in {filename}. "
            "Use a longer old_string for a unique match."
        )

    new_content = content.replace(old_string, new_string, 1)
    await save_user_file(user_id, filename, new_content)
    return f"Updated {filename}."


async def execute_append_memory(user_id: int, note: str) -> str:
    """Append a timestamped note to memory.md. Returns status message."""
    files = await load_user_files(user_id)
    content = files["memory.md"]
    today = date.today().isoformat()
    entry = f"- {today}: {note}"

    if content:
        new_content = content + "\n" + entry
    else:
        new_content = entry

    await save_user_file(user_id, "memory.md", new_content)

    if len(new_content) > MEMORY_SOFT_LIMIT:
        return (
            f"Noted. Warning: memory.md is getting long ({len(new_content)} chars). "
            "Consider asking the user if you should clean it up."
        )
    return "Noted."
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_memory_tools.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
jj describe -m "feat(coach): add memory tools (read_file, edit_file, append_memory)"
jj new
```

---

## Task 5: Progress Tools — `get_my_progress`, `get_my_upcoming_deadlines`

Implement tools that let the coach see the user's course progress and upcoming deadlines.

**Files:**
- Create: `core/agents/tools/progress_tools.py`
- Create: `core/agents/tests/test_progress_tools.py`

- [ ] **Step 1: Write failing tests**

Create `core/agents/tests/test_progress_tools.py`:

```python
"""Tests for progress tools (get_my_progress, get_my_upcoming_deadlines)."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timezone, timedelta
from core.agents.tools.progress_tools import (
    execute_get_my_progress,
    execute_get_my_upcoming_deadlines,
    get_user_course_slug,
    PROGRESS_TOOL_SCHEMAS,
)


# --- get_user_course_slug tests ---

@pytest.mark.asyncio
async def testget_user_course_slug_returns_slug():
    """Returns course_slug when user is in an active group."""
    from core.database import get_transaction
    from core.tables import users, cohorts, groups, groups_users
    from sqlalchemy import insert

    async with get_transaction() as conn:
        await conn.execute(insert(users).values(user_id=80001, discord_id="test_pt_80001"))
        await conn.execute(
            insert(cohorts).values(
                cohort_id=8001,
                cohort_name="Test Cohort",
                course_slug="test-course",
                cohort_start_date="2026-01-01",
                duration_days=56,
                number_of_group_meetings=8,
            )
        )
        await conn.execute(
            insert(groups).values(
                group_id=8001,
                group_name="Test Group",
                cohort_id=8001,
            )
        )
        await conn.execute(
            insert(groups_users).values(
                user_id=80001,
                group_id=8001,
                role="student",
                status="active",
            )
        )

    slug = await get_user_course_slug(80001)
    assert slug == "test-course"


@pytest.mark.asyncio
async def testget_user_course_slug_returns_none_for_unenrolled():
    """Returns None for users not in any group."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy import insert

    async with get_transaction() as conn:
        await conn.execute(insert(users).values(user_id=80002, discord_id="test_pt_80002"))

    slug = await get_user_course_slug(80002)
    assert slug is None


# --- execute_get_my_progress tests ---
# These mock the course loader because the content cache isn't initialized in tests.

@pytest.mark.asyncio
async def test_get_my_progress_unenrolled():
    """Unenrolled user gets a friendly message."""
    result = await execute_get_my_progress(80002)
    assert "not enrolled" in result.lower() or "not currently" in result.lower()


@pytest.mark.asyncio
@patch("core.agents.tools.progress_tools.load_course")
@patch("core.agents.tools.progress_tools.load_flattened_module")
@patch("core.agents.tools.progress_tools.get_completed_content_ids", new_callable=AsyncMock)
async def test_get_my_progress_formats_output(mock_completed, mock_module, mock_course):
    """Progress tool returns formatted module-by-module summary."""
    # Mock course with 2 modules
    mod1 = MagicMock()
    mod1.slug = "mod-1"
    mod1.optional = False
    mod2 = MagicMock()
    mod2.slug = "mod-2"
    mod2.optional = False

    course = MagicMock()
    course.title = "AI Safety Fundamentals"
    course.progression = [mod1, mod2]
    mock_course.return_value = course

    # Mock modules with sections
    flat_mod1 = MagicMock()
    flat_mod1.title = "Introduction"
    flat_mod1.sections = [
        {"contentId": "uuid-1", "type": "lens"},
        {"contentId": "uuid-2", "type": "lens"},
    ]
    flat_mod2 = MagicMock()
    flat_mod2.title = "Risks"
    flat_mod2.sections = [
        {"contentId": "uuid-3", "type": "lens"},
        {"contentId": "uuid-4", "type": "lens"},
        {"contentId": "uuid-5", "type": "lens"},
    ]
    mock_module.side_effect = lambda slug: {"mod-1": flat_mod1, "mod-2": flat_mod2}[slug]

    # User completed 2 of 5 lenses
    mock_completed.return_value = {"uuid-1", "uuid-2"}

    result = await execute_get_my_progress(80001)
    assert "AI Safety Fundamentals" in result
    assert "2/5" in result
    assert "Introduction" in result
    assert "2/2" in result
    assert "Risks" in result
    assert "0/3" in result


# --- execute_get_my_upcoming_deadlines tests ---

@pytest.mark.asyncio
async def test_get_my_upcoming_deadlines_unenrolled():
    """Unenrolled user gets friendly message."""
    result = await execute_get_my_upcoming_deadlines(80002)
    assert "not enrolled" in result.lower() or "not currently" in result.lower()


@pytest.mark.asyncio
@patch("core.agents.tools.progress_tools.get_meeting_dates_for_user", new_callable=AsyncMock)
@patch("core.agents.tools.progress_tools.load_course")
@patch("core.agents.tools.progress_tools.get_due_by_meeting")
async def test_get_my_upcoming_deadlines_formats_output(
    mock_due_by, mock_course, mock_meetings
):
    """Deadlines tool returns formatted meeting schedule."""
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    mock_meetings.return_value = {4: tomorrow}

    mod1 = MagicMock()
    mod1.slug = "mod-1"
    mod1.optional = False
    course = MagicMock()
    course.title = "AI Safety"
    course.progression = [mod1]
    mock_course.return_value = course

    mock_due_by.return_value = 4

    result = await execute_get_my_upcoming_deadlines(80001)
    assert "Meeting 4" in result


# --- schema tests ---

def test_schemas_have_correct_names():
    names = {s["function"]["name"] for s in PROGRESS_TOOL_SCHEMAS}
    assert names == {"get_my_progress", "get_my_upcoming_deadlines"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_progress_tools.py -v
```

Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `progress_tools.py`**

Create `core/agents/tools/progress_tools.py`:

```python
"""Progress tools: get_my_progress, get_my_upcoming_deadlines.

Let the coach see the user's course progress and upcoming deadlines.
user_id is injected by the dispatcher — never exposed to the LLM.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select, func

from core.database import get_connection
from core.modules.progress import get_completed_content_ids
from core.modules.course_loader import load_course, get_modules, get_due_by_meeting
from core.modules.loader import load_flattened_module, ModuleNotFoundError
from core.modules.flattened_types import ModuleRef, MeetingMarker
from core.queries.meetings import get_meeting_dates_for_user
from core.tables import groups_users, groups, cohorts

logger = logging.getLogger(__name__)


PROGRESS_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_my_progress",
            "description": (
                "Get the current user's course progress. "
                "Returns which modules they've completed, which they're working on, "
                "and overall completion percentage."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_upcoming_deadlines",
            "description": (
                "Get the current user's upcoming deadlines: next group meeting, "
                "and which modules are due before each meeting."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


async def get_user_course_slug(user_id: int) -> str | None:
    """Get the course_slug for a user's active group. Returns None if unenrolled."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(
                func.coalesce(
                    groups.c.course_slug_override, cohorts.c.course_slug
                ).label("course_slug")
            )
            .select_from(
                groups_users.join(groups, groups_users.c.group_id == groups.c.group_id)
                .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
            )
            .where(groups_users.c.user_id == user_id)
            .where(groups_users.c.status == "active")
        )
        row = result.first()
    return row.course_slug if row else None


async def execute_get_my_progress(user_id: int) -> str:
    """Format the user's course progress as a readable summary."""
    course_slug = await get_user_course_slug(user_id)
    if not course_slug:
        return "You're not currently enrolled in an active cohort. Visit the web platform to sign up!"

    try:
        course = load_course(course_slug)
    except Exception:
        logger.exception("Failed to load course", extra={"course_slug": course_slug})
        return "Sorry, I couldn't load the course information right now."

    async with get_connection() as conn:
        completed_ids = await get_completed_content_ids(conn, user_id)

    modules = get_modules(course)
    lines = [f"Course: {course.title}"]
    total_lenses = 0
    total_completed = 0

    for mod_ref in modules:
        try:
            flat = load_flattened_module(mod_ref.slug)
        except ModuleNotFoundError:
            lines.append(f"  {mod_ref.slug} — (module not found)")
            continue

        lens_sections = [s for s in flat.sections if s.get("type") == "lens"]
        lens_count = len(lens_sections)
        done_count = sum(1 for s in lens_sections if s.get("contentId") in completed_ids)
        total_lenses += lens_count
        total_completed += done_count

        if done_count == lens_count and lens_count > 0:
            status = "completed ✓"
        elif done_count > 0:
            status = "in progress"
        else:
            status = "not started"

        optional = " (optional)" if mod_ref.optional else ""
        lines.append(f"  {flat.title}{optional} — {done_count}/{lens_count} lenses ({status})")

    pct = round(total_completed / total_lenses * 100) if total_lenses else 0
    lines.insert(1, f"Overall: {total_completed}/{total_lenses} lenses completed ({pct}%)")
    lines.insert(2, "")

    return "\n".join(lines)


async def execute_get_my_upcoming_deadlines(user_id: int) -> str:
    """Format the user's upcoming deadlines as a readable summary."""
    course_slug = await get_user_course_slug(user_id)
    if not course_slug:
        return "You're not currently enrolled in an active cohort. Visit the web platform to sign up!"

    async with get_connection() as conn:
        meeting_dates = await get_meeting_dates_for_user(conn, user_id)

    if not meeting_dates:
        return "No meetings scheduled for your group yet."

    now = datetime.now(timezone.utc)
    future_meetings = {
        num: iso_date
        for num, iso_date in meeting_dates.items()
        if datetime.fromisoformat(iso_date) > now
    }

    if not future_meetings:
        return "All your group meetings have passed. Check with your facilitator for next steps."

    try:
        course = load_course(course_slug)
    except Exception:
        logger.exception("Failed to load course", extra={"course_slug": course_slug})
        return "Sorry, I couldn't load the course information right now."

    modules = get_modules(course)
    lines = []

    for meeting_num in sorted(future_meetings.keys()):
        iso_date = future_meetings[meeting_num]
        dt = datetime.fromisoformat(iso_date)
        date_str = dt.strftime("%A %B %d at %I:%M %p UTC")

        due_modules = []
        for mod_ref in modules:
            due_meeting = get_due_by_meeting(course, mod_ref.slug)
            if due_meeting == meeting_num:
                try:
                    flat = load_flattened_module(mod_ref.slug)
                    due_modules.append(flat.title)
                except ModuleNotFoundError:
                    due_modules.append(mod_ref.slug)

        lines.append(f"Meeting {meeting_num}: {date_str}")
        if due_modules:
            for mod_title in due_modules:
                lines.append(f"  Due: {mod_title}")
        lines.append("")

    return "\n".join(lines).strip()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_progress_tools.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat(coach): add progress tools (get_my_progress, get_my_upcoming_deadlines)"
jj new
```

---

## Task 6: Scheduling Tools — `schedule_reminder`, `list_my_reminders`, `cancel_reminder`

Implement tools that let the coach schedule, list, and cancel check-in reminders.

**Files:**
- Create: `core/agents/tools/scheduling_tools.py`
- Create: `core/agents/tests/test_scheduling_tools.py`

- [ ] **Step 1: Write failing tests**

Create `core/agents/tests/test_scheduling_tools.py`:

```python
"""Tests for scheduling tools (schedule_reminder, list_my_reminders, cancel_reminder)."""

import pytest
from datetime import datetime, timezone, timedelta
from uuid import UUID

from core.agents.tools.scheduling_tools import (
    execute_schedule_reminder,
    execute_list_my_reminders,
    execute_cancel_reminder,
    SCHEDULING_TOOL_SCHEMAS,
    MAX_PENDING_JOBS,
    MAX_FUTURE_DAYS,
)


async def _setup_user(user_id: int):
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=user_id, discord_id=f"test_st_{user_id}")
            .on_conflict_do_nothing()
        )


# --- schedule_reminder tests ---

@pytest.mark.asyncio
async def test_schedule_reminder_creates_job():
    await _setup_user(70001)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    result = await execute_schedule_reminder(70001, fire_at, "Check-in")
    assert "Scheduled" in result or "scheduled" in result


@pytest.mark.asyncio
async def test_schedule_reminder_rejects_past():
    await _setup_user(70002)
    fire_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    result = await execute_schedule_reminder(70002, fire_at, "Too late")
    assert "past" in result.lower()


@pytest.mark.asyncio
async def test_schedule_reminder_rejects_too_far_future():
    await _setup_user(70003)
    fire_at = (datetime.now(timezone.utc) + timedelta(days=MAX_FUTURE_DAYS + 1)).isoformat()
    result = await execute_schedule_reminder(70003, fire_at, "Way out")
    assert "90 days" in result or "too far" in result.lower()


@pytest.mark.asyncio
async def test_schedule_reminder_rate_limit():
    await _setup_user(70004)
    # Create MAX_PENDING_JOBS reminders
    for i in range(MAX_PENDING_JOBS):
        fire_at = (datetime.now(timezone.utc) + timedelta(hours=i + 1)).isoformat()
        await execute_schedule_reminder(70004, fire_at, f"Reminder {i}")

    # One more should be rejected
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=MAX_PENDING_JOBS + 1)).isoformat()
    result = await execute_schedule_reminder(70004, fire_at, "One too many")
    assert "20 pending" in result or "limit" in result.lower()


# --- list_my_reminders tests ---

@pytest.mark.asyncio
async def test_list_my_reminders_shows_pending():
    await _setup_user(70005)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    await execute_schedule_reminder(70005, fire_at, "Morning check")
    result = await execute_list_my_reminders(70005)
    assert "Morning check" in result


@pytest.mark.asyncio
async def test_list_my_reminders_empty():
    await _setup_user(70006)
    result = await execute_list_my_reminders(70006)
    assert "no pending" in result.lower() or "none" in result.lower()


# --- cancel_reminder tests ---

@pytest.mark.asyncio
async def test_cancel_reminder_updates_status():
    await _setup_user(70007)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    schedule_result = await execute_schedule_reminder(70007, fire_at, "To cancel")
    # Extract job_id from result
    # Result format: "Scheduled reminder <uuid> for <date>."
    job_id = schedule_result.split("reminder ")[1].split(" for")[0]
    cancel_result = await execute_cancel_reminder(70007, job_id)
    assert "Cancelled" in cancel_result or "cancelled" in cancel_result


@pytest.mark.asyncio
async def test_cancel_reminder_wrong_user():
    await _setup_user(70008)
    await _setup_user(70009)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    schedule_result = await execute_schedule_reminder(70008, fire_at, "Not yours")
    job_id = schedule_result.split("reminder ")[1].split(" for")[0]
    # Try to cancel from different user
    result = await execute_cancel_reminder(70009, job_id)
    assert "not found" in result.lower()


@pytest.mark.asyncio
async def test_cancel_reminder_nonexistent():
    result = await execute_cancel_reminder(1, "00000000-0000-0000-0000-000000000000")
    assert "not found" in result.lower()


# --- schema tests ---

def test_schemas_have_correct_names():
    names = {s["function"]["name"] for s in SCHEDULING_TOOL_SCHEMAS}
    assert names == {"schedule_reminder", "list_my_reminders", "cancel_reminder"}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_scheduling_tools.py -v
```

Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `scheduling_tools.py`**

Create `core/agents/tools/scheduling_tools.py`:

```python
"""Scheduling tools: schedule_reminder, list_my_reminders, cancel_reminder.

Let the coach schedule future check-ins that fire as full coach turns.
"""

import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

from sqlalchemy import select, update, func, insert

from core.database import get_connection, get_transaction
from core.tables import coach_scheduled_jobs

logger = logging.getLogger(__name__)

MAX_PENDING_JOBS = 20
MAX_FUTURE_DAYS = 90


SCHEDULING_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "schedule_reminder",
            "description": (
                "Schedule a future check-in with the user. "
                "At the scheduled time, you'll get a full turn to decide what to say."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fire_at": {
                        "type": "string",
                        "description": "When to fire (ISO 8601 UTC), e.g. '2026-04-26T18:00:00Z'",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why this reminder exists (you'll see this at fire time)",
                    },
                },
                "required": ["fire_at", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_my_reminders",
            "description": "List all pending reminders for the current user.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_reminder",
            "description": "Cancel a pending reminder by its job ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {
                        "type": "string",
                        "description": "The job ID to cancel",
                    },
                },
                "required": ["job_id"],
            },
        },
    },
]


async def execute_schedule_reminder(user_id: int, fire_at: str, reason: str) -> str:
    """Schedule a reminder. Returns status message."""
    try:
        dt = datetime.fromisoformat(fire_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return f"Invalid date format: {fire_at}. Use ISO 8601 (e.g., '2026-04-26T18:00:00Z')."

    now = datetime.now(timezone.utc)
    if dt <= now:
        return "Can't schedule in the past."

    if dt > now + timedelta(days=MAX_FUTURE_DAYS):
        return f"Can't schedule more than {MAX_FUTURE_DAYS} days in the future."

    # Check rate limit
    async with get_connection() as conn:
        result = await conn.execute(
            select(func.count()).select_from(coach_scheduled_jobs).where(
                coach_scheduled_jobs.c.user_id == user_id,
                coach_scheduled_jobs.c.status == "pending",
            )
        )
        pending_count = result.scalar()

    if pending_count >= MAX_PENDING_JOBS:
        return f"You have {MAX_PENDING_JOBS} pending reminders. Cancel some before scheduling more."

    async with get_transaction() as conn:
        result = await conn.execute(
            insert(coach_scheduled_jobs)
            .values(user_id=user_id, fire_at=dt, reason=reason)
            .returning(coach_scheduled_jobs.c.job_id)
        )
        job_id = result.scalar()

    date_str = dt.strftime("%A %B %d at %I:%M %p UTC")
    return f"Scheduled reminder {job_id} for {date_str}."


async def execute_list_my_reminders(user_id: int) -> str:
    """List pending reminders for a user. Returns formatted string."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(
                coach_scheduled_jobs.c.job_id,
                coach_scheduled_jobs.c.fire_at,
                coach_scheduled_jobs.c.reason,
            )
            .where(
                coach_scheduled_jobs.c.user_id == user_id,
                coach_scheduled_jobs.c.status == "pending",
            )
            .order_by(coach_scheduled_jobs.c.fire_at)
        )
        rows = result.fetchall()

    if not rows:
        return "No pending reminders."

    lines = ["Pending reminders:"]
    for row in rows:
        date_str = row.fire_at.strftime("%a %b %d at %I:%M %p UTC")
        lines.append(f"  [{row.job_id}] {date_str} — {row.reason}")

    return "\n".join(lines)


async def execute_cancel_reminder(user_id: int, job_id: str) -> str:
    """Cancel a pending reminder. Only allows cancelling own reminders."""
    try:
        job_uuid = UUID(job_id)
    except ValueError:
        return f"Invalid job ID: {job_id}"

    async with get_transaction() as conn:
        result = await conn.execute(
            update(coach_scheduled_jobs)
            .where(
                coach_scheduled_jobs.c.job_id == job_uuid,
                coach_scheduled_jobs.c.user_id == user_id,
                coach_scheduled_jobs.c.status == "pending",
            )
            .values(status="cancelled", resolved_at=func.now())
        )

    if result.rowcount == 0:
        return "Reminder not found (it may have already fired or been cancelled)."

    return "Cancelled."
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_scheduling_tools.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat(coach): add scheduling tools (schedule_reminder, list_my_reminders, cancel_reminder)"
jj new
```

---

## Task 7: Tool Executor Registry — `core/agents/tools/__init__.py`

Wire all tool schemas and handlers into a single dispatcher function the coach agent uses.

**Files:**
- Modify: `core/agents/tools/__init__.py`
- Create: `core/agents/tests/test_tool_executor.py`

- [ ] **Step 1: Write failing tests**

Create `core/agents/tests/test_tool_executor.py`:

```python
"""Tests for the coach tool executor registry."""

import pytest
import json
from unittest.mock import patch, AsyncMock
from core.agents.tools import COACH_TOOL_SCHEMAS, coach_tool_executor


def test_all_schemas_present():
    """All 8 tool schemas are registered."""
    names = {s["function"]["name"] for s in COACH_TOOL_SCHEMAS}
    assert names == {
        "read_file", "edit_file", "append_memory",
        "get_my_progress", "get_my_upcoming_deadlines",
        "schedule_reminder", "list_my_reminders", "cancel_reminder",
    }


def _make_tool_call(name: str, arguments: dict) -> dict:
    return {
        "id": "call_test",
        "type": "function",
        "function": {
            "name": name,
            "arguments": json.dumps(arguments),
        },
    }


@pytest.mark.asyncio
@patch("core.agents.tools.execute_read_file", new_callable=AsyncMock, return_value="file content")
async def test_dispatches_read_file(mock_fn):
    tc = _make_tool_call("read_file", {"filename": "agent_style.md"})
    result = await coach_tool_executor(tc, user_id=1)
    assert result == "file content"
    mock_fn.assert_called_once_with(1, "agent_style.md")


@pytest.mark.asyncio
@patch("core.agents.tools.execute_append_memory", new_callable=AsyncMock, return_value="Noted.")
async def test_dispatches_append_memory(mock_fn):
    tc = _make_tool_call("append_memory", {"note": "likes tea"})
    result = await coach_tool_executor(tc, user_id=2)
    assert result == "Noted."
    mock_fn.assert_called_once_with(2, "likes tea")


@pytest.mark.asyncio
@patch("core.agents.tools.execute_get_my_progress", new_callable=AsyncMock, return_value="progress")
async def test_dispatches_get_my_progress(mock_fn):
    tc = _make_tool_call("get_my_progress", {})
    result = await coach_tool_executor(tc, user_id=3)
    assert result == "progress"
    mock_fn.assert_called_once_with(3)


@pytest.mark.asyncio
async def test_unknown_tool_returns_error():
    tc = _make_tool_call("hack_the_planet", {})
    result = await coach_tool_executor(tc, user_id=1)
    assert "Unknown tool" in result


@pytest.mark.asyncio
async def test_malformed_arguments_returns_error():
    tc = {
        "id": "call_test",
        "type": "function",
        "function": {"name": "read_file", "arguments": "not valid json {"},
    }
    result = await coach_tool_executor(tc, user_id=1)
    assert "Invalid" in result or "error" in result.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_tool_executor.py -v
```

Expected: FAIL with `ImportError: cannot import name 'COACH_TOOL_SCHEMAS'`

- [ ] **Step 3: Implement `tools/__init__.py`**

Write `core/agents/tools/__init__.py`:

```python
"""Coach tool executor registry.

Aggregates all tool schemas and provides a single dispatch function.
"""

import json
import logging

from .memory_tools import (
    MEMORY_TOOL_SCHEMAS,
    execute_read_file,
    execute_edit_file,
    execute_append_memory,
)
from .progress_tools import (
    PROGRESS_TOOL_SCHEMAS,
    execute_get_my_progress,
    execute_get_my_upcoming_deadlines,
)
from .scheduling_tools import (
    SCHEDULING_TOOL_SCHEMAS,
    execute_schedule_reminder,
    execute_list_my_reminders,
    execute_cancel_reminder,
)

logger = logging.getLogger(__name__)

COACH_TOOL_SCHEMAS = tuple(MEMORY_TOOL_SCHEMAS + PROGRESS_TOOL_SCHEMAS + SCHEDULING_TOOL_SCHEMAS)


async def coach_tool_executor(tool_call: dict, user_id: int) -> str:
    """Dispatch a tool call to the appropriate handler.

    Args:
        tool_call: OpenAI-format tool call dict with function.name and function.arguments.
        user_id: The authenticated user's ID (injected, not from LLM).

    Returns:
        String result to feed back to the LLM as a tool result.
    """
    func = tool_call.get("function", {})
    name = func.get("name", "")

    try:
        args = json.loads(func.get("arguments", "{}"))
    except json.JSONDecodeError:
        return f"Invalid tool arguments (malformed JSON)."

    try:
        if name == "read_file":
            return await execute_read_file(user_id, args["filename"])
        elif name == "edit_file":
            return await execute_edit_file(user_id, args["filename"], args["old_string"], args["new_string"])
        elif name == "append_memory":
            return await execute_append_memory(user_id, args["note"])
        elif name == "get_my_progress":
            return await execute_get_my_progress(user_id)
        elif name == "get_my_upcoming_deadlines":
            return await execute_get_my_upcoming_deadlines(user_id)
        elif name == "schedule_reminder":
            return await execute_schedule_reminder(user_id, args["fire_at"], args["reason"])
        elif name == "list_my_reminders":
            return await execute_list_my_reminders(user_id)
        elif name == "cancel_reminder":
            return await execute_cancel_reminder(user_id, args["job_id"])
        else:
            return f"Unknown tool: {name}"
    except KeyError as e:
        return f"Missing required parameter: {e}"
    except Exception:
        logger.exception("tool_execution_failed", extra={"tool": name, "user_id": user_id})
        return f"Tool '{name}' failed unexpectedly. Please try again."
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_tool_executor.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat(coach): add tool executor registry wiring all coach tools"
jj new
```

---

## Task 8: Move Coach + Update System Prompt + Wire Tools

Move the coach persona from `core/coach/` to `core/agents/coach/`, update the system prompt with tool and memory guidance, and wire the tool executor.

**Files:**
- Create: `core/agents/coach/__init__.py`
- Create: `core/agents/coach/persona.py` (moved + modified from `core/coach/persona.py`)
- Create: `core/agents/coach/tests/__init__.py`
- Create: `core/agents/coach/tests/test_persona.py` (moved + modified from `core/coach/tests/test_persona.py`)
- Delete: `core/coach/persona.py`, `core/coach/__init__.py`, `core/coach/tests/`
- Modify: `core/agents/registry.py` (update import path)

- [ ] **Step 1: Create the `coach` package under `agents/`**

```bash
mkdir -p core/agents/coach/tests
touch core/agents/coach/__init__.py
touch core/agents/coach/tests/__init__.py
```

- [ ] **Step 2: Write the updated persona with tests**

Create `core/agents/coach/tests/test_persona.py`:

```python
"""Tests for coach persona and agent builder."""

from core.agents.coach.persona import build_coach_agent, COACH_SYSTEM_PROMPT


def test_build_coach_agent_returns_agent():
    agent = build_coach_agent()
    assert agent.name == "coach"
    assert agent.model is not None
    assert "tutor" in agent.can_handoff_to


def test_coach_has_tool_executor():
    agent = build_coach_agent()
    assert agent.tool_executor is not None


def test_coach_has_tool_schemas():
    agent = build_coach_agent()
    tool_names = {t["function"]["name"] for t in agent.extra_tools}
    assert "read_file" in tool_names
    assert "get_my_progress" in tool_names
    assert "schedule_reminder" in tool_names


def test_system_prompt_mentions_tools():
    assert "read_file" in COACH_SYSTEM_PROMPT
    assert "append_memory" in COACH_SYSTEM_PROMPT
    assert "get_my_progress" in COACH_SYSTEM_PROMPT
    assert "schedule_reminder" in COACH_SYSTEM_PROMPT


def test_system_prompt_mentions_memory_policy():
    assert "Want me to note that" in COACH_SYSTEM_PROMPT or "remember" in COACH_SYSTEM_PROMPT.lower()


def test_system_prompt_mentions_user_files():
    assert "agent_style.md" in COACH_SYSTEM_PROMPT
    assert "user.md" in COACH_SYSTEM_PROMPT
    assert "memory.md" in COACH_SYSTEM_PROMPT
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/coach/tests/test_persona.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'core.agents.coach.persona'`

- [ ] **Step 4: Create the new `persona.py`**

Create `core/agents/coach/persona.py`:

```python
"""Coach agent persona: system prompt, tool wiring, and agent builder."""

from core.agents.agent import Agent
from core.agents.tools import COACH_TOOL_SCHEMAS, coach_tool_executor
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

## Your tools

### Memory tools
- read_file(filename) — read agent_style.md, user.md, or memory.md
- edit_file(filename, old_string, new_string) — surgical find-and-replace within a file
- append_memory(note) — add a timestamped note to memory.md

### Course tools
- get_my_progress() — see the user's course completion status
- get_my_upcoming_deadlines() — see upcoming meetings and what's due

### Scheduling tools
- schedule_reminder(fire_at, reason) — schedule a future check-in
- list_my_reminders() — show pending reminders
- cancel_reminder(job_id) — cancel a scheduled reminder

## Memory guidelines
- When the user tells you something worth remembering, ask: "Want me to note that?"
- Use append_memory for running observations. Use edit_file for curated profile updates.
- Confirm with the user before editing agent_style.md or user.md.
- Keep memory.md focused — don't note every detail of every conversation.

## Scheduling guidelines
- Offer to schedule check-ins when it feels natural ("Want me to nudge you tomorrow?")
- Don't schedule reminders the user didn't ask for
- When a scheduled job fires, you have full context and judgment — decide whether \
to actually message the user based on their current state

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
        extra_tools=COACH_TOOL_SCHEMAS,
        can_handoff_to=("tutor",),
        tool_executor=coach_tool_executor,
    )
```

- [ ] **Step 5: Create `core/agents/coach/__init__.py`**

```python
from .persona import build_coach_agent

__all__ = ["build_coach_agent"]
```

- [ ] **Step 6: Update `core/agents/registry.py` import**

Change the import in `core/agents/registry.py`:

```python
# Old:
from core.coach.persona import build_coach_agent
# New:
from core.agents.coach.persona import build_coach_agent
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/coach/tests/test_persona.py -v
```

Expected: all tests PASS.

- [ ] **Step 8: Delete old `core/coach/` directory**

```bash
rm -rf core/coach/
```

- [ ] **Step 9: Run all existing Phase 1 tests to verify nothing broke**

```bash
.venv/bin/pytest core/agents/tests/ -v
```

Expected: all existing tests PASS (the registry now imports from the new location).

- [ ] **Step 10: Commit**

```bash
jj describe -m "refactor(coach): move core/coach/ → core/agents/coach/, update system prompt with tools"
jj new
```

---

## Task 9: Per-Turn Context Injection — `core/agents/coach/context.py`

Build the small programmatic context block injected near the end of the message array each turn.

**Files:**
- Create: `core/agents/coach/context.py`
- Create: `core/agents/tests/test_context.py`

- [ ] **Step 1: Write failing tests**

Create `core/agents/tests/test_context.py`:

```python
"""Tests for per-turn context injection."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timezone, timedelta
from core.agents.coach.context import build_context_block


@pytest.mark.asyncio
@patch("core.agents.coach.context.get_user_course_slug", new_callable=AsyncMock, return_value=None)
async def test_unenrolled_user_gets_minimal_context(mock_slug):
    """Unenrolled users still get a context block (just without progress)."""
    result = await build_context_block(user_id=1)
    assert result is not None
    assert isinstance(result, str)


@pytest.mark.asyncio
@patch("core.agents.coach.context.get_meeting_dates_for_user", new_callable=AsyncMock)
@patch("core.agents.coach.context.get_completed_content_ids", new_callable=AsyncMock)
@patch("core.agents.coach.context.load_flattened_module")
@patch("core.agents.coach.context.load_course")
@patch("core.agents.coach.context.get_user_course_slug", new_callable=AsyncMock)
async def test_enrolled_user_gets_full_context(
    mock_slug, mock_course, mock_module, mock_completed, mock_meetings
):
    """Enrolled user gets progress + next meeting in context."""
    mock_slug.return_value = "test-course"

    mod1 = MagicMock()
    mod1.slug = "mod-1"
    mod1.optional = False
    course = MagicMock()
    course.title = "AI Safety"
    course.progression = [mod1]
    mock_course.return_value = course

    flat = MagicMock()
    flat.title = "Intro"
    flat.sections = [
        {"contentId": "uuid-1", "type": "lens"},
        {"contentId": "uuid-2", "type": "lens"},
    ]
    mock_module.return_value = flat

    mock_completed.return_value = {"uuid-1"}

    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    mock_meetings.return_value = {4: tomorrow}

    result = await build_context_block(user_id=1)
    assert "1/2" in result
    assert "Meeting 4" in result


@pytest.mark.asyncio
@patch("core.agents.coach.context.get_user_course_slug", new_callable=AsyncMock, return_value="test")
@patch("core.agents.coach.context.load_course", side_effect=Exception("cache not init"))
async def test_context_gracefully_handles_errors(mock_course, mock_slug):
    """Context injection should never crash — returns empty on error."""
    result = await build_context_block(user_id=1)
    assert result is not None  # Returns something, even on error
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_context.py -v
```

Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `context.py`**

Create `core/agents/coach/context.py`:

```python
"""Build per-turn context injection block for the coach.

A small programmatic block (~50 tokens) injected as a system message
near the tail of the message array. Contains progress, next meeting,
and last study activity. NOT about time — timestamps handle that.
"""

import logging
from datetime import datetime, timezone

from core.database import get_connection
from core.modules.progress import get_completed_content_ids
from core.modules.course_loader import load_course, get_modules
from core.modules.loader import load_flattened_module, ModuleNotFoundError
from core.modules.flattened_types import ModuleRef
from core.queries.meetings import get_meeting_dates_for_user
from core.agents.tools.progress_tools import get_user_course_slug

logger = logging.getLogger(__name__)


async def build_context_block(user_id: int) -> str:
    """Build the per-turn context injection string.

    Returns a short text block for injection as a system message.
    Never raises — returns minimal context on any error.
    """
    try:
        return await _build_context_inner(user_id)
    except Exception:
        logger.exception("context_injection_failed", extra={"user_id": user_id})
        return "(Course context unavailable.)"


async def _build_context_inner(user_id: int) -> str:
    course_slug = await get_user_course_slug(user_id)
    if not course_slug:
        return "(User not enrolled in a course.)"

    course = load_course(course_slug)
    modules = get_modules(course)

    async with get_connection() as conn:
        completed_ids = await get_completed_content_ids(conn, user_id)
        meeting_dates = await get_meeting_dates_for_user(conn, user_id)

    # Compute progress
    total_lenses = 0
    total_done = 0
    current_module_title = None

    for mod_ref in modules:
        try:
            flat = load_flattened_module(mod_ref.slug)
        except ModuleNotFoundError:
            continue
        lens_sections = [s for s in flat.sections if s.get("type") == "lens"]
        lens_count = len(lens_sections)
        done_count = sum(1 for s in lens_sections if s.get("contentId") in completed_ids)
        total_lenses += lens_count
        total_done += done_count
        if 0 < done_count < lens_count and current_module_title is None:
            current_module_title = flat.title

    parts = []
    pct = round(total_done / total_lenses * 100) if total_lenses else 0

    if current_module_title:
        parts.append(f"Progress: {total_done}/{total_lenses} lenses ({pct}%) — working on {current_module_title}")
    else:
        parts.append(f"Progress: {total_done}/{total_lenses} lenses ({pct}%)")

    # Next meeting
    now = datetime.now(timezone.utc)
    future_meetings = sorted(
        ((num, datetime.fromisoformat(iso)) for num, iso in meeting_dates.items() if datetime.fromisoformat(iso) > now),
        key=lambda x: x[1],
    )

    if future_meetings:
        meeting_num, meeting_dt = future_meetings[0]
        delta = meeting_dt - now
        if delta.days == 0:
            time_str = "today"
        elif delta.days == 1:
            time_str = "tomorrow"
        else:
            time_str = f"in {delta.days} days"
        date_str = meeting_dt.strftime("%a %b %d at %I:%M %p UTC")
        parts.append(f"Next meeting: Meeting {meeting_num}, {date_str} ({time_str})")

    return "\n".join(parts)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_context.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat(coach): add per-turn context injection (progress, next meeting)"
jj new
```

---

## Task 10: Dispatcher Refactor — Tool Execution Loop, Timestamps, Context Injection

The biggest change: extend the Phase 1 dispatcher to handle regular tool calls, add timestamps to messages, and inject per-turn context.

**Files:**
- Modify: `core/agents/dispatcher.py`
- Create: `core/agents/tests/test_dispatcher_tools.py`
- Modify: `core/agents/tests/test_dispatcher.py` (existing tests should still pass)

- [ ] **Step 1: Write failing tests for new dispatcher behavior**

Create `core/agents/tests/test_dispatcher_tools.py`:

```python
"""Tests for dispatcher tool execution (Phase 2 additions)."""

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from core.agents.identity import PlatformIdentity
from core.agents.dispatcher import handle_message, MAX_TOOL_ROUNDS


def _mock_llm_response(content="Hello!", tool_calls=None):
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def _make_tc(name, arguments, tc_id="call_1"):
    tc = MagicMock()
    tc.id = tc_id
    tc.function.name = name
    tc.function.arguments = json.dumps(arguments)
    return tc


def _fresh_session(user_id=42):
    return {"session_id": 999, "user_id": user_id, "messages": []}


@pytest.fixture
def mock_sessions():
    session = _fresh_session()

    async def fake_load(user_id):
        return session

    async def fake_save(s):
        pass

    with (
        patch("core.agents.dispatcher.load_or_create_open_ended_session", side_effect=fake_load),
        patch("core.agents.dispatcher.save_session", side_effect=fake_save),
        patch("core.agents.dispatcher.resolve_user_id", return_value=42),
        patch("core.agents.dispatcher.build_context_block", new_callable=AsyncMock, return_value="Progress: 5/10"),
        patch("core.agents.dispatcher.load_user_files", new_callable=AsyncMock, return_value={
            "agent_style.md": "", "user.md": "", "memory.md": "",
        }),
        patch("core.agents.dispatcher._get_user_timezone", new_callable=AsyncMock, return_value=None),
    ):
        yield session


# Test 1: Regular tool call → execute → LLM sees result
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_regular_tool_call_executes_and_loops(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    # LLM call 1: calls get_my_progress
    tc = _make_tc("get_my_progress", {})
    llm_call1 = _mock_llm_response(content=None, tool_calls=[tc])

    # LLM call 2: responds with text using the tool result
    llm_call2 = _mock_llm_response("You're 40% done — great progress!")

    mock_llm.side_effect = [llm_call1, llm_call2]

    # Mock the tool executor on the coach agent
    with patch("core.agents.registry.build_coach_agent") as mock_build:
        from core.agents.registry import AGENT_REGISTRY
        original_coach = AGENT_REGISTRY["coach"]
        mock_executor = AsyncMock(return_value="Course: AI Safety\nOverall: 12/30 lenses (40%)")

        from dataclasses import replace
        patched_coach = replace(original_coach, tool_executor=mock_executor)
        AGENT_REGISTRY["coach"] = patched_coach
        try:
            result = await handle_message(identity, "How am I doing?")
        finally:
            AGENT_REGISTRY["coach"] = original_coach

    assert result.kind == "ok"
    assert "40%" in result.reply_text or "progress" in result.reply_text.lower()
    assert mock_llm.call_count == 2
    mock_executor.assert_called_once()


# Test 2: MAX_TOOL_ROUNDS forces text response
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_max_tool_rounds_forces_text(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    # Create MAX_TOOL_ROUNDS + 1 LLM responses: first MAX_TOOL_ROUNDS call tools, last is text
    tool_responses = []
    for i in range(MAX_TOOL_ROUNDS):
        tc = _make_tc("list_my_reminders", {}, tc_id=f"call_{i}")
        tool_responses.append(_mock_llm_response(content=None, tool_calls=[tc]))
    tool_responses.append(_mock_llm_response("Here's what I found."))

    mock_llm.side_effect = tool_responses

    from core.agents.registry import AGENT_REGISTRY
    from dataclasses import replace
    original_coach = AGENT_REGISTRY["coach"]
    mock_executor = AsyncMock(return_value="No pending reminders.")
    patched_coach = replace(original_coach, tool_executor=mock_executor)
    AGENT_REGISTRY["coach"] = patched_coach
    try:
        result = await handle_message(identity, "What reminders do I have?")
    finally:
        AGENT_REGISTRY["coach"] = original_coach

    assert result.kind == "ok"
    # Last LLM call should have tool_choice="none"
    last_call_kwargs = mock_llm.call_args_list[-1]
    assert last_call_kwargs.kwargs.get("tool_choice") == "none" or \
           (last_call_kwargs[1].get("tool_choice") == "none" if len(last_call_kwargs) > 1 else False)


# Test 3: Messages have timestamps
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_messages_get_timestamps(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")
    mock_llm.return_value = _mock_llm_response("Hi!")
    await handle_message(identity, "Hello")

    session = mock_sessions
    user_msg = next(m for m in session["messages"] if m["role"] == "user")
    assistant_msg = next(m for m in session["messages"] if m["role"] == "assistant")
    assert "ts" in user_msg
    assert "ts" in assistant_msg


# Test 4: Agent without tool_executor ignores non-transfer tool calls
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_agent_without_executor_ignores_tools(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    # Tutor stub has no tool_executor
    tc = _make_tc("some_tool", {})
    llm_call = _mock_llm_response(content="Let me help.", tool_calls=[tc])
    mock_llm.return_value = llm_call

    # Manually set session to have tutor as active agent
    mock_sessions["messages"].append({"role": "assistant", "agent": "tutor", "content": "Hi"})

    result = await handle_message(identity, "test")
    assert result.kind == "ok"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher_tools.py -v
```

Expected: FAIL (dispatcher doesn't have tool execution, timestamps, or context injection yet)

- [ ] **Step 3: Modify the dispatcher**

Apply the following changes to `core/agents/dispatcher.py`:

**3a. Add imports** at the top:

```python
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from core.agents.user_files import load_user_files
from core.agents.coach.context import build_context_block

from sqlalchemy import select
from core.database import get_connection
from core.tables import users
```

**3b. Add constants:**

```python
MAX_TOOL_ROUNDS = 5
```

**3c. Add user timezone lookup helper:**

```python
async def _get_user_timezone(user_id: int) -> str | None:
    """Get the user's IANA timezone string, or None."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(users.c.timezone).where(users.c.user_id == user_id)
        )
        row = result.first()
    return row.timezone if row else None
```

**3d. Update `_strip_custom_keys` to handle timestamps:**

Replace the existing `_strip_custom_keys` function with:

```python
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
        if ts_str and content and m.get("role") in ("user", "assistant"):
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
```

**3e. Update `_build_system_prompt_with_files` (new function):**

```python
def _build_system_prompt_with_files(
    base_prompt: str, user_files: dict[str, str]
) -> str:
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
```

**3f. Update `_run_agent` to accept the composed system prompt and tool_choice:**

Replace the existing `_run_agent` function:

```python
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
```

**3g. Update `_handle_locked` to add timestamps, load user files, build context, and execute tools:**

Replace the existing `_handle_locked` function:

```python
async def _handle_locked(user_id: int, platform: str, text: str) -> HandleResult:
    session = await load_or_create_open_ended_session(user_id)

    # Load per-user files and build system prompt
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

    # Build system prompt with user files (for coach) or use base prompt
    if active_agent.tool_executor is not None:
        system_prompt = _build_system_prompt_with_files(active_agent.system_prompt, user_files)
    else:
        system_prompt = active_agent.system_prompt

    # Build and inject per-turn context (tagged for removal before save)
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
            await save_session(session)
            return HandleResult(
                kind="error",
                reply_text=(
                    "This conversation has gotten too long for me to continue "
                    "(over 45,000 tokens). A reset command is coming soon — "
                    "for now, please ask staff to archive this session."
                ),
            )

        # Force text on final tool round
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
            # Agent has no tool executor — emit errors for regular tool calls
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

        # No tools at all — shouldn't reach here, but break to be safe
        break

    # Remove injected context messages before saving (tagged with _injected)
    session["messages"] = [
        m for m in session["messages"]
        if not m.get("_injected")
    ]

    try:
        await save_session(session)
    except Exception:
        logger.exception("save_session_failed", extra={"user_id": user_id})

    final_text = _build_reply_text(reply_parts) if reply_parts else None

    return HandleResult(
        kind="ok",
        reply_text=final_text or "I'm not sure what to say. Could you try again?",
    )
```

- [ ] **Step 4: Run new tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher_tools.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Run existing Phase 1 dispatcher tests**

```bash
.venv/bin/pytest core/agents/tests/test_dispatcher.py -v
```

Expected: all existing tests still PASS. Some may need minor updates if they assert on message structure (since user messages now have `ts` fields). If tests fail, update them to account for `ts` and the context injection message.

- [ ] **Step 6: Run full test suite**

```bash
.venv/bin/pytest core/agents/tests/ core/agents/coach/tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
jj describe -m "feat(coach): extend dispatcher with tool execution loop, timestamps, and context injection"
jj new
```

---

## Task 11: Scheduled Job Processor — APScheduler Integration

Add a cron-style job processor that scans `coach_scheduled_jobs` for due jobs and fires full coach turns.

**Files:**
- Create: `core/agents/tests/test_job_processor.py`
- Modify: `core/notifications/scheduler.py` (add coach job processing)

- [ ] **Step 1: Write failing tests**

Create `core/agents/tests/test_job_processor.py`:

```python
"""Tests for the coach scheduled job processor."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from core.agents.job_processor import process_due_coach_jobs, _fire_coach_job


async def _create_test_job(user_id: int, fire_at: datetime, reason: str, status: str = "pending"):
    """Insert a test job directly into the DB."""
    from core.database import get_transaction
    from core.tables import coach_scheduled_jobs, users
    from sqlalchemy import insert
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=user_id, discord_id=f"test_jp_{user_id}")
            .on_conflict_do_nothing()
        )
        result = await conn.execute(
            insert(coach_scheduled_jobs)
            .values(user_id=user_id, fire_at=fire_at, reason=reason, status=status)
            .returning(coach_scheduled_jobs.c.job_id)
        )
        return result.scalar()


async def _get_job_status(job_id):
    from core.database import get_connection
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs.c.status).where(
                coach_scheduled_jobs.c.job_id == job_id
            )
        )
        return result.scalar()


# --- process_due_coach_jobs tests ---

@pytest.mark.asyncio
@patch("core.agents.job_processor._fire_coach_job", new_callable=AsyncMock)
async def test_process_picks_up_due_jobs(mock_fire):
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    job_id = await _create_test_job(60001, past, "Check-in")
    await process_due_coach_jobs()
    mock_fire.assert_called_once()
    call_args = mock_fire.call_args
    assert call_args[0][0]["job_id"] == job_id


@pytest.mark.asyncio
@patch("core.agents.job_processor._fire_coach_job", new_callable=AsyncMock)
async def test_process_skips_future_jobs(mock_fire):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    await _create_test_job(60002, future, "Not yet")
    await process_due_coach_jobs()
    mock_fire.assert_not_called()


# --- _fire_coach_job tests ---

@pytest.mark.asyncio
@patch("core.agents.job_processor.send_dm", new_callable=AsyncMock, return_value="msg_123")
@patch("core.agents.job_processor.acompletion", new_callable=AsyncMock)
async def test_fire_sends_dm(mock_llm, mock_dm):
    """When LLM responds with text, a DM is sent and job marked 'sent'."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=60003, discord_id="test_jp_60003")
            .on_conflict_do_nothing()
        )

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    job_id = await _create_test_job(60003, past, "Daily check-in")

    # Mock LLM response
    msg = MagicMock()
    msg.content = "Hey! How's studying going today?"
    msg.tool_calls = None
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]
    mock_llm.return_value = response

    # Load the job dict
    from core.database import get_connection
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs).where(coach_scheduled_jobs.c.job_id == job_id)
        )
        job = dict(result.mappings().first())

    await _fire_coach_job(job)

    mock_dm.assert_called_once_with("test_jp_60003", "Hey! How's studying going today?")
    status = await _get_job_status(job_id)
    assert status == "sent"


@pytest.mark.asyncio
@patch("core.agents.job_processor.acompletion", new_callable=AsyncMock)
async def test_fire_skips_no_message(mock_llm):
    """When LLM responds with [NO_MESSAGE], job is marked 'skipped'."""
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=60004, discord_id="test_jp_60004")
            .on_conflict_do_nothing()
        )

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    job_id = await _create_test_job(60004, past, "Check-in")

    msg = MagicMock()
    msg.content = "[NO_MESSAGE]"
    msg.tool_calls = None
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]
    mock_llm.return_value = response

    from core.database import get_connection
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs).where(coach_scheduled_jobs.c.job_id == job_id)
        )
        job = dict(result.mappings().first())

    await _fire_coach_job(job)
    status = await _get_job_status(job_id)
    assert status == "skipped"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/agents/tests/test_job_processor.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'core.agents.job_processor'`

- [ ] **Step 3: Implement `job_processor.py`**

Create `core/agents/job_processor.py`:

```python
"""Coach scheduled job processor.

Scans coach_scheduled_jobs for due jobs and fires full coach turns.
Called periodically by APScheduler (every 15 minutes).
"""

import logging
from datetime import datetime, timezone

from litellm import acompletion
from sqlalchemy import select, update, func

from core.database import get_connection, get_transaction
from core.tables import coach_scheduled_jobs, users
from core.agents.user_files import load_user_files
from core.agents.coach.persona import COACH_SYSTEM_PROMPT
from core.agents.tools import COACH_TOOL_SCHEMAS, coach_tool_executor
from core.agents.tools.transfer import build_all_transfer_tools
from core.discord_outbound.messages import send_dm
from core.modules.llm import DEFAULT_PROVIDER

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
JOB_TRIGGER_PROMPT = (
    "A scheduled job has fired. Reason: {reason}. "
    "Decide whether to message the user and what to say. "
    "You have access to your usual tools (progress, deadlines, memory). "
    "If you decide not to message, respond with exactly '[NO_MESSAGE]'."
)


async def process_due_coach_jobs() -> None:
    """Scan for due jobs and fire them. Called by APScheduler every 15 min."""
    now = datetime.now(timezone.utc)

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs)
            .where(
                coach_scheduled_jobs.c.status == "pending",
                coach_scheduled_jobs.c.fire_at <= now,
            )
            .order_by(coach_scheduled_jobs.c.fire_at)
            .limit(BATCH_SIZE)
        )
        jobs = [dict(row) for row in result.mappings()]

    if not jobs:
        return

    logger.info("processing_coach_jobs", extra={"count": len(jobs)})

    for job in jobs:
        try:
            await _fire_coach_job(job)
        except Exception:
            logger.exception("coach_job_failed", extra={"job_id": str(job["job_id"])})
            await _update_job_status(job["job_id"], "failed")


async def _fire_coach_job(job: dict) -> None:
    """Fire a single coach job: run LLM, optionally send DM."""
    user_id = job["user_id"]
    reason = job["reason"]

    # Load user info
    async with get_connection() as conn:
        result = await conn.execute(
            select(users.c.discord_id).where(users.c.user_id == user_id)
        )
        row = result.first()

    if not row or not row.discord_id:
        logger.warning("coach_job_no_discord", extra={"user_id": user_id})
        await _update_job_status(job["job_id"], "failed")
        return

    discord_id = row.discord_id

    # Load user files and build system prompt
    user_files = await load_user_files(user_id)
    system_parts = [COACH_SYSTEM_PROMPT]
    system_parts.append(
        "\nYou have a personal workspace for this user with three files that persist "
        "across sessions. Use them to remember things and adapt your behavior."
    )
    for filename in ("agent_style.md", "user.md", "memory.md"):
        content = user_files.get(filename, "")
        display = content if content else "(empty)"
        label = {
            "agent_style.md": "agent_style.md (your style adjustments for this user)",
            "user.md": "user.md (what you know about this user)",
            "memory.md": "memory.md (your running notes about this user)",
        }[filename]
        system_parts.append(f"\n## {label}\n{display}")

    system_prompt = "\n".join(system_parts)

    # Build messages
    trigger_content = JOB_TRIGGER_PROMPT.format(reason=reason)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": trigger_content},
    ]

    tools = list(COACH_TOOL_SCHEMAS) + build_all_transfer_tools()

    try:
        response = await acompletion(
            model=DEFAULT_PROVIDER,
            messages=messages,
            tools=tools if tools else None,
            max_tokens=2048,
        )
    except Exception:
        logger.exception("coach_job_llm_failed", extra={"job_id": str(job["job_id"])})
        await _update_job_status(job["job_id"], "failed")
        return

    reply = response.choices[0].message.content

    if not reply or "[NO_MESSAGE]" in reply:
        await _update_job_status(job["job_id"], "skipped")
        return

    # Send DM
    msg_id = await send_dm(discord_id, reply)
    if msg_id:
        await _update_job_status(job["job_id"], "sent")
    else:
        logger.warning("coach_job_dm_failed", extra={"job_id": str(job["job_id"]), "user_id": user_id})
        await _update_job_status(job["job_id"], "failed")


async def _update_job_status(job_id, status: str) -> None:
    """Update a job's status and resolved_at timestamp."""
    async with get_transaction() as conn:
        await conn.execute(
            update(coach_scheduled_jobs)
            .where(coach_scheduled_jobs.c.job_id == job_id)
            .values(status=status, resolved_at=func.now())
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest core/agents/tests/test_job_processor.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Register the job processor with APScheduler**

Add the following to `core/notifications/scheduler.py`, inside `init_scheduler()`, after the existing job registrations:

```python
# Coach scheduled job processor — runs every 15 minutes
from core.agents.job_processor import process_due_coach_jobs
_scheduler.add_job(
    process_due_coach_jobs,
    trigger="interval",
    minutes=15,
    id="coach_job_processor",
    replace_existing=True,
)
```

Note: Use a deferred import to avoid circular imports. Place this inside the `init_scheduler()` function body, after `_scheduler.start()`.

- [ ] **Step 6: Run full test suite**

```bash
.venv/bin/pytest core/agents/tests/ core/agents/coach/tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
jj describe -m "feat(coach): add scheduled job processor with APScheduler integration"
jj new
```

---

## Post-Implementation Verification

After all tasks are complete, run the full test suite:

```bash
.venv/bin/pytest core/agents/tests/ core/agents/coach/tests/ -v
```

Then run the linting checks required before push:

```bash
ruff check .
ruff format --check .
```

### Manual test checklist

1. Start the server: `python main.py --dev --port 8100`
2. DM the bot on Discord
3. Say "remember that I study best in the mornings" → verify coach calls `append_memory`
4. Say "how am I doing in the course?" → verify coach calls `get_my_progress`
5. Say "remind me tomorrow at 9am to study" → verify coach calls `schedule_reminder`
6. Say "what reminders do I have?" → verify coach calls `list_my_reminders`
7. Verify timestamps appear in DB messages (`ts` field)
8. Verify context injection doesn't persist in saved session
