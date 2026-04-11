# Progress Tracking Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fragile index-based progress tracking with UUID-based content identifiers, enabling persistent cross-device progress and resilience to content restructuring.

**Architecture:** New `user_content_progress` table tracks completion at module/lens level using UUIDs from content frontmatter. New `chat_sessions` table separates chat history from progress. Anonymous users get a `session_token` (UUID in localStorage) that's claimed on login.

**Tech Stack:** PostgreSQL (Alembic migrations), FastAPI, React 19, TypeScript

---

## Phase 1: Database Schema

### Task 1.1: Create Alembic Migration for New Tables

**Files:**
- Create: `alembic/versions/004_progress_tracking_redesign.py`

**Step 1: Create the migration file**

```python
"""Progress tracking redesign - new tables.

Revision ID: 004
Revises: 003
Create Date: 2026-01-27

Creates user_content_progress and chat_sessions tables.
Does NOT drop old tables - they remain for migration/rollback.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "004"
down_revision: Union[str, None] = "003_add_notification_dedup_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create user_content_progress table
    op.create_table(
        "user_content_progress",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_token", UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True),
        sa.Column("content_id", UUID(as_uuid=True), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("content_title", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("time_to_complete_s", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total_time_spent_s", sa.Integer(), server_default="0", nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "content_type IN ('module', 'lo', 'lens', 'test')",
            name="valid_content_type"
        ),
    )

    # Partial unique index for authenticated users
    op.create_index(
        "idx_user_content_progress_user",
        "user_content_progress",
        ["user_id", "content_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )

    # Partial unique index for anonymous users
    op.create_index(
        "idx_user_content_progress_anon",
        "user_content_progress",
        ["session_token", "content_id"],
        unique=True,
        postgresql_where=sa.text("session_token IS NOT NULL"),
    )

    # Index for claiming (UPDATE WHERE session_token = ?)
    op.create_index(
        "idx_user_content_progress_token",
        "user_content_progress",
        ["session_token"],
        postgresql_where=sa.text("session_token IS NOT NULL"),
    )

    # Create chat_sessions table
    op.create_table(
        "chat_sessions",
        sa.Column("session_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_token", UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True),
        sa.Column("content_id", UUID(as_uuid=True), nullable=True),
        sa.Column("content_type", sa.Text(), nullable=True),
        sa.Column("messages", JSONB(), server_default="[]", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_active_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("session_id"),
        sa.CheckConstraint(
            "content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test')",
            name="valid_chat_content_type"
        ),
    )

    # Index for finding active chat by user + content
    op.create_index(
        "idx_chat_sessions_user_content",
        "chat_sessions",
        ["user_id", "content_id", "archived_at"],
    )

    # Index for claiming
    op.create_index(
        "idx_chat_sessions_token",
        "chat_sessions",
        ["session_token"],
    )


def downgrade() -> None:
    op.drop_table("chat_sessions")
    op.drop_table("user_content_progress")
```

**Step 2: Verify migration file syntax**

Run: `python -c "import alembic.versions" 2>&1 || echo "Check import path"`

**Step 3: Run migration on local database**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2 && alembic upgrade head`
Expected: Migration applies without errors

**Step 4: Verify tables created**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2 && python -c "from core.db import get_engine; from sqlalchemy import inspect; i = inspect(get_engine()); print([t for t in i.get_table_names() if 'progress' in t or 'chat_sessions' in t])"`
Expected: `['user_content_progress', 'chat_sessions']`

**Step 5: Commit**

```bash
git add alembic/versions/004_progress_tracking_redesign.py
git commit -m "feat: add user_content_progress and chat_sessions tables

New schema for UUID-based progress tracking:
- user_content_progress: tracks completion per content item
- chat_sessions: separated from progress, supports archiving

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.2: Add SQLAlchemy Table Definitions

**Files:**
- Modify: `core/tables.py` (add after line ~387, after `content_events` table)

**Step 1: Add the table definitions**

Add after the `content_events` table definition:

```python
# Progress tracking - new UUID-based system
user_content_progress = Table(
    "user_content_progress",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("session_token", UUID(as_uuid=True), nullable=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("content_id", UUID(as_uuid=True), nullable=False),
    Column("content_type", Text, nullable=False),
    Column("content_title", Text, nullable=False),
    Column("started_at", DateTime(timezone=True), server_default=func.now()),
    Column("time_to_complete_s", Integer, server_default="0"),
    Column("total_time_spent_s", Integer, server_default="0"),
    Column("completed_at", DateTime(timezone=True), nullable=True),
    Index("idx_user_content_progress_user", "user_id", "content_id", unique=True, postgresql_where=text("user_id IS NOT NULL")),
    Index("idx_user_content_progress_anon", "session_token", "content_id", unique=True, postgresql_where=text("session_token IS NOT NULL")),
    Index("idx_user_content_progress_token", "session_token", postgresql_where=text("session_token IS NOT NULL")),
    CheckConstraint("content_type IN ('module', 'lo', 'lens', 'test')", name="valid_content_type"),
)

chat_sessions = Table(
    "chat_sessions",
    metadata,
    Column("session_id", Integer, primary_key=True, autoincrement=True),
    Column("session_token", UUID(as_uuid=True), nullable=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("content_id", UUID(as_uuid=True), nullable=True),
    Column("content_type", Text, nullable=True),
    Column("messages", JSONB, server_default="[]"),
    Column("started_at", DateTime(timezone=True), server_default=func.now()),
    Column("last_active_at", DateTime(timezone=True), server_default=func.now()),
    Column("archived_at", DateTime(timezone=True), nullable=True),
    Index("idx_chat_sessions_user_content", "user_id", "content_id", "archived_at"),
    Index("idx_chat_sessions_token", "session_token"),
    CheckConstraint("content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test')", name="valid_chat_content_type"),
)
```

**Step 2: Add UUID import if not present**

Check if `UUID` is imported from `sqlalchemy.dialects.postgresql`. If not, add to imports:

```python
from sqlalchemy.dialects.postgresql import JSONB, UUID
```

**Step 3: Verify syntax**

Run: `python -c "from core.tables import user_content_progress, chat_sessions; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add core/tables.py
git commit -m "feat: add SQLAlchemy definitions for progress tables

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Content UUID Support

### Task 2.1: Update Markdown Parser to Extract UUIDs

**Files:**
- Modify: `core/modules/markdown_parser.py`
- Modify: `core/modules/types.py`

**Step 1: Write the failing test**

Create test file `core/modules/tests/test_uuid_parsing.py`:

```python
"""Tests for UUID extraction from content frontmatter."""

import uuid
from core.modules.markdown_parser import parse_module


def test_parse_module_extracts_uuid():
    """Module with id in frontmatter should have content_id set."""
    markdown = """---
id: 550e8400-e29b-41d4-a716-446655440000
slug: introduction
title: Introduction
---

# Text: Welcome
content::
Hello world.
"""
    module = parse_module(markdown)
    assert module.content_id == uuid.UUID("550e8400-e29b-41d4-a716-446655440000")


def test_parse_module_without_uuid():
    """Module without id should have content_id as None."""
    markdown = """---
slug: introduction
title: Introduction
---

# Text: Welcome
content::
Hello world.
"""
    module = parse_module(markdown)
    assert module.content_id is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_uuid_parsing.py -v`
Expected: FAIL with `AttributeError: 'ParsedModule' object has no attribute 'content_id'`

**Step 3: Update ParsedModule type**

In `core/modules/types.py`, update the `ParsedModule` dataclass:

```python
from uuid import UUID as PyUUID

@dataclass
class ParsedModule:
    slug: str
    title: str
    sections: list[Section]
    content_id: PyUUID | None = None  # UUID from frontmatter, if present
```

**Step 4: Update parser to extract id**

In `core/modules/markdown_parser.py`, update `parse_module()` function:

```python
from uuid import UUID as PyUUID

def parse_module(text: str) -> ParsedModule:
    """Parse module markdown into structured format."""
    frontmatter, content = _parse_frontmatter(text)

    slug = frontmatter.get("slug", "")
    title = frontmatter.get("title", "")

    # Extract content_id if present
    content_id = None
    if "id" in frontmatter:
        try:
            content_id = PyUUID(frontmatter["id"])
        except ValueError:
            pass  # Invalid UUID format, leave as None

    sections = _parse_sections(content)

    return ParsedModule(slug=slug, title=title, sections=sections, content_id=content_id)
```

**Step 5: Run test to verify it passes**

Run: `pytest core/modules/tests/test_uuid_parsing.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add core/modules/types.py core/modules/markdown_parser.py core/modules/tests/test_uuid_parsing.py
git commit -m "feat: extract content UUID from module frontmatter

Adds content_id field to ParsedModule, populated from 'id' in YAML frontmatter.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2.2: Add UUID Support for Sections (Lenses)

**Files:**
- Modify: `core/modules/types.py`
- Modify: `core/modules/markdown_parser.py`

**Step 1: Write the failing test**

Add to `core/modules/tests/test_uuid_parsing.py`:

```python
def test_parse_section_with_uuid():
    """Section with id field should have content_id set."""
    markdown = """---
slug: introduction
title: Introduction
---

# Video: AI Overview
id:: f47ac10b-58cc-4372-a567-0e02b2c3d479
source:: [[video_transcripts/ai-overview]]

## Video-excerpt
from:: 0:00
"""
    module = parse_module(markdown)
    assert len(module.sections) == 1
    assert module.sections[0].content_id == uuid.UUID("f47ac10b-58cc-4372-a567-0e02b2c3d479")


def test_parse_section_without_uuid():
    """Section without id should have content_id as None."""
    markdown = """---
slug: introduction
title: Introduction
---

# Video: AI Overview
source:: [[video_transcripts/ai-overview]]

## Video-excerpt
from:: 0:00
"""
    module = parse_module(markdown)
    assert len(module.sections) == 1
    assert module.sections[0].content_id is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_uuid_parsing.py::test_parse_section_with_uuid -v`
Expected: FAIL with `AttributeError: ... object has no attribute 'content_id'`

**Step 3: Update section types**

In `core/modules/types.py`, add `content_id` field to section dataclasses:

```python
@dataclass
class VideoSection:
    type: Literal["video"]
    source: str
    segments: list[NarrativeSegment]
    content_id: PyUUID | None = None
    optional: bool = False


@dataclass
class ArticleSection:
    type: Literal["article"]
    source: str
    segments: list[NarrativeSegment]
    content_id: PyUUID | None = None
    optional: bool = False


@dataclass
class TextSection:
    type: Literal["text"]
    content: str
    content_id: PyUUID | None = None
    optional: bool = False


@dataclass
class ChatSection:
    type: Literal["chat"]
    instructions: str
    hide_previous_content_from_user: bool = False
    hide_previous_content_from_tutor: bool = False
    content_id: PyUUID | None = None
    optional: bool = False
```

**Step 4: Update parser to extract section id**

In `core/modules/markdown_parser.py`, update section parsing to extract `id::` field:

In the `_parse_video_section`, `_parse_article_section`, `_parse_text_section`, and `_parse_chat_section` functions, add:

```python
# Extract content_id if present
content_id = None
if "id" in fields:
    try:
        content_id = PyUUID(fields["id"])
    except ValueError:
        pass
```

And pass `content_id=content_id` to the section constructor.

**Step 5: Run test to verify it passes**

Run: `pytest core/modules/tests/test_uuid_parsing.py -v`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add core/modules/types.py core/modules/markdown_parser.py core/modules/tests/test_uuid_parsing.py
git commit -m "feat: extract content UUID from section frontmatter

Sections (lenses) can now have 'id::' field for UUID tracking.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Backend Progress Service

### Task 3.1: Create Progress Service Module

**Files:**
- Create: `core/modules/progress.py`
- Create: `core/modules/tests/test_progress.py`

**Step 1: Write the failing test**

Create `core/modules/tests/test_progress.py`:

```python
"""Tests for progress tracking service."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from core.modules.progress import (
    get_or_create_progress,
    mark_content_complete,
    update_time_spent,
    get_module_progress,
    claim_progress_records,
)


@pytest.fixture
def mock_conn():
    """Create a mock database connection."""
    conn = AsyncMock()
    return conn


@pytest.mark.asyncio
async def test_mark_content_complete_creates_record(mock_conn):
    """Marking complete should create progress record if none exists."""
    content_id = uuid.uuid4()
    user_id = 123

    # No existing record
    mock_conn.fetchrow.return_value = None
    mock_conn.execute.return_value = None

    result = await mark_content_complete(
        conn=mock_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test Lens",
        time_spent_s=120,
    )

    # Should have called INSERT
    assert mock_conn.execute.called
    call_args = str(mock_conn.execute.call_args)
    assert "INSERT" in call_args
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_progress.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.modules.progress'`

**Step 3: Create progress service**

Create `core/modules/progress.py`:

```python
"""Progress tracking service.

Handles user progress through course content using UUID-based tracking.
Supports both authenticated users (user_id) and anonymous users (session_token).
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import user_content_progress


async def get_or_create_progress(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    content_id: UUID,
    content_type: str,
    content_title: str,
) -> dict:
    """Get existing progress record or create new one.

    Returns dict with: id, started_at, completed_at, time_to_complete_s, total_time_spent_s

    Uses INSERT ... ON CONFLICT to handle race conditions where two concurrent
    requests might both try to create a record for the same user/content.
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    # Build insert values
    insert_values = {
        "content_id": content_id,
        "content_type": content_type,
        "content_title": content_title,
    }

    if user_id is not None:
        insert_values["user_id"] = user_id
        # Use the partial unique index for authenticated users
        conflict_target = ["user_id", "content_id"]
        conflict_where = user_content_progress.c.user_id.isnot(None)
    elif session_token is not None:
        insert_values["session_token"] = session_token
        # Use the partial unique index for anonymous users
        conflict_target = ["session_token", "content_id"]
        conflict_where = user_content_progress.c.session_token.isnot(None)
    else:
        raise ValueError("Either user_id or session_token must be provided")

    # INSERT ... ON CONFLICT DO UPDATE (no-op update to return existing row)
    stmt = pg_insert(user_content_progress).values(**insert_values)
    stmt = stmt.on_conflict_do_update(
        index_elements=conflict_target,
        index_where=conflict_where,
        set_={"started_at": user_content_progress.c.started_at},  # No-op update
    ).returning(user_content_progress)

    result = await conn.execute(stmt)
    row = result.fetchone()
    await conn.commit()
    return dict(row._mapping)


async def mark_content_complete(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    content_id: UUID,
    content_type: str,
    content_title: str,
    time_spent_s: int = 0,
) -> dict:
    """Mark content as complete, creating record if needed.

    Returns updated progress record.
    """
    # Get or create the record first
    progress = await get_or_create_progress(
        conn,
        user_id=user_id,
        session_token=session_token,
        content_id=content_id,
        content_type=content_type,
        content_title=content_title,
    )

    # If already completed, just return
    if progress.get("completed_at"):
        return progress

    # Update to mark complete
    now = datetime.now(timezone.utc)
    result = await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.id == progress["id"])
        .values(
            completed_at=now,
            time_to_complete_s=time_spent_s,
        )
        .returning(user_content_progress)
    )
    row = result.fetchone()
    await conn.commit()
    return dict(row._mapping)


async def update_time_spent(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    content_id: UUID,
    time_delta_s: int,
) -> None:
    """Add time to total_time_spent_s (and time_to_complete_s if not yet completed)."""
    from sqlalchemy import case

    # Build WHERE clause
    if user_id is not None:
        where_clause = and_(
            user_content_progress.c.user_id == user_id,
            user_content_progress.c.content_id == content_id,
        )
    elif session_token is not None:
        where_clause = and_(
            user_content_progress.c.session_token == session_token,
            user_content_progress.c.content_id == content_id,
        )
    else:
        return  # No identity, can't track

    # Update time columns
    # time_to_complete_s only updates if not yet completed (SQL CASE expression)
    await conn.execute(
        update(user_content_progress)
        .where(where_clause)
        .values(
            total_time_spent_s=user_content_progress.c.total_time_spent_s + time_delta_s,
            time_to_complete_s=case(
                (user_content_progress.c.completed_at.is_(None),
                 user_content_progress.c.time_to_complete_s + time_delta_s),
                else_=user_content_progress.c.time_to_complete_s
            ),
        )
    )
    await conn.commit()


async def get_module_progress(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    lens_ids: list[UUID],
) -> dict[UUID, dict]:
    """Get progress for multiple content items (lenses in a module).

    Returns dict mapping content_id to progress record.
    """
    if not lens_ids:
        return {}

    # Build WHERE clause
    if user_id is not None:
        where_clause = and_(
            user_content_progress.c.user_id == user_id,
            user_content_progress.c.content_id.in_(lens_ids),
        )
    elif session_token is not None:
        where_clause = and_(
            user_content_progress.c.session_token == session_token,
            user_content_progress.c.content_id.in_(lens_ids),
        )
    else:
        return {}

    result = await conn.execute(
        select(user_content_progress).where(where_clause)
    )

    return {row.content_id: dict(row._mapping) for row in result.fetchall()}


async def claim_progress_records(
    conn: AsyncConnection,
    *,
    session_token: UUID,
    user_id: int,
) -> int:
    """Claim all anonymous progress records for a user.

    Returns count of records claimed.
    """
    result = await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.session_token == session_token)
        .values(user_id=user_id, session_token=None)
    )
    await conn.commit()
    return result.rowcount
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_progress.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/modules/progress.py core/modules/tests/test_progress.py
git commit -m "feat: add progress tracking service

Core functions for UUID-based progress:
- get_or_create_progress
- mark_content_complete
- update_time_spent
- get_module_progress
- claim_progress_records

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3.2: Create Chat Sessions Service

**Files:**
- Create: `core/modules/chat_sessions.py`
- Create: `core/modules/tests/test_chat_sessions.py`

**Step 1: Write the failing test**

Create `core/modules/tests/test_chat_sessions.py`:

```python
"""Tests for chat sessions service."""

import uuid
from unittest.mock import AsyncMock

import pytest

from core.modules.chat_sessions import (
    get_or_create_chat_session,
    add_chat_message,
    archive_chat_session,
    claim_chat_sessions,
)


@pytest.fixture
def mock_conn():
    conn = AsyncMock()
    return conn


@pytest.mark.asyncio
async def test_get_or_create_creates_new_session(mock_conn):
    """Should create new session when none exists."""
    content_id = uuid.uuid4()
    user_id = 123

    # No existing session
    mock_conn.execute.return_value.fetchone.side_effect = [None, {"session_id": 1}]

    result = await get_or_create_chat_session(
        conn=mock_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="module",
    )

    assert result["session_id"] == 1
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_chat_sessions.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Create chat sessions service**

Create `core/modules/chat_sessions.py`:

```python
"""Chat sessions service.

Manages chat history separately from progress tracking.
Supports archiving old sessions and creating new ones.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import chat_sessions


async def get_or_create_chat_session(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    session_token: UUID | None,
    content_id: UUID | None,
    content_type: str | None,
) -> dict:
    """Get active chat session or create new one.

    Active = archived_at IS NULL
    """
    # Build WHERE clause for active session
    conditions = [chat_sessions.c.archived_at.is_(None)]

    if content_id is not None:
        conditions.append(chat_sessions.c.content_id == content_id)
    else:
        conditions.append(chat_sessions.c.content_id.is_(None))

    if user_id is not None:
        conditions.append(chat_sessions.c.user_id == user_id)
    elif session_token is not None:
        conditions.append(chat_sessions.c.session_token == session_token)
    else:
        raise ValueError("Either user_id or session_token must be provided")

    # Check for existing active session
    result = await conn.execute(
        select(chat_sessions).where(and_(*conditions))
    )
    row = result.fetchone()

    if row:
        return dict(row._mapping)

    # Create new session
    insert_values = {
        "content_id": content_id,
        "content_type": content_type,
        "messages": [],
    }
    if user_id is not None:
        insert_values["user_id"] = user_id
    else:
        insert_values["session_token"] = session_token

    result = await conn.execute(
        chat_sessions.insert().values(**insert_values).returning(chat_sessions)
    )
    row = result.fetchone()
    await conn.commit()
    return dict(row._mapping)


async def add_chat_message(
    conn: AsyncConnection,
    *,
    session_id: int,
    role: str,
    content: str,
    icon: str | None = None,
) -> None:
    """Append message to chat session."""
    message = {"role": role, "content": content}
    if icon:
        message["icon"] = icon

    # Use PostgreSQL jsonb_insert or || operator
    await conn.execute(
        update(chat_sessions)
        .where(chat_sessions.c.session_id == session_id)
        .values(
            messages=chat_sessions.c.messages + [message],
            last_active_at=datetime.now(timezone.utc),
        )
    )
    await conn.commit()


async def archive_chat_session(
    conn: AsyncConnection,
    *,
    session_id: int,
) -> None:
    """Archive a chat session (soft delete)."""
    await conn.execute(
        update(chat_sessions)
        .where(chat_sessions.c.session_id == session_id)
        .values(archived_at=datetime.now(timezone.utc))
    )
    await conn.commit()


async def get_chat_session(
    conn: AsyncConnection,
    *,
    session_id: int,
) -> dict | None:
    """Get chat session by ID."""
    result = await conn.execute(
        select(chat_sessions).where(chat_sessions.c.session_id == session_id)
    )
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def claim_chat_sessions(
    conn: AsyncConnection,
    *,
    session_token: UUID,
    user_id: int,
) -> int:
    """Claim all anonymous chat sessions for a user.

    Returns count of sessions claimed.
    """
    result = await conn.execute(
        update(chat_sessions)
        .where(chat_sessions.c.session_token == session_token)
        .values(user_id=user_id, session_token=None)
    )
    await conn.commit()
    return result.rowcount
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_chat_sessions.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/modules/chat_sessions.py core/modules/tests/test_chat_sessions.py
git commit -m "feat: add chat sessions service

Separated chat history from progress tracking:
- get_or_create_chat_session
- add_chat_message
- archive_chat_session
- claim_chat_sessions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: API Routes

### Task 4.1: Add Progress API Routes

**Files:**
- Create: `web_api/routes/progress.py`
- Modify: `web_api/routes/__init__.py`

**Step 1: Create progress routes**

Create `web_api/routes/progress.py`:

```python
"""Progress tracking API routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel

from core.db import get_connection
from core.modules.progress import (
    mark_content_complete,
    update_time_spent,
    get_module_progress,
    claim_progress_records,
)
from core.modules.chat_sessions import claim_chat_sessions
from web_api.auth import get_optional_user

router = APIRouter(prefix="/api/progress", tags=["progress"])


class MarkCompleteRequest(BaseModel):
    content_id: UUID
    content_type: str  # 'module', 'lo', 'lens', 'test'
    content_title: str
    time_spent_s: int = 0


class MarkCompleteResponse(BaseModel):
    completed_at: str
    module_status: str | None = None
    module_progress: dict | None = None


class TimeUpdateRequest(BaseModel):
    content_id: UUID
    time_delta_s: int


async def get_user_or_token(
    request: Request,
    x_session_token: str | None = Header(None),
) -> tuple[int | None, UUID | None]:
    """Get user_id from auth or session_token from header."""
    user = await get_optional_user(request)
    if user:
        return user["user_id"], None

    if x_session_token:
        try:
            return None, UUID(x_session_token)
        except ValueError:
            pass

    raise HTTPException(401, "Authentication required")


@router.post("/complete", response_model=MarkCompleteResponse)
async def complete_content(
    body: MarkCompleteRequest,
    auth: tuple = Depends(get_user_or_token),
):
    """Mark content as complete."""
    user_id, session_token = auth

    if body.content_type not in ("module", "lo", "lens", "test"):
        raise HTTPException(400, "Invalid content_type")

    async with get_connection() as conn:
        progress = await mark_content_complete(
            conn,
            user_id=user_id,
            session_token=session_token,
            content_id=body.content_id,
            content_type=body.content_type,
            content_title=body.content_title,
            time_spent_s=body.time_spent_s,
        )

    return MarkCompleteResponse(
        completed_at=progress["completed_at"].isoformat() if progress.get("completed_at") else None,
    )


@router.post("/time", status_code=204)
async def update_time(
    body: TimeUpdateRequest,
    auth: tuple = Depends(get_user_or_token),
):
    """Update time spent on content (periodic heartbeat)."""
    user_id, session_token = auth

    async with get_connection() as conn:
        await update_time_spent(
            conn,
            user_id=user_id,
            session_token=session_token,
            content_id=body.content_id,
            time_delta_s=body.time_delta_s,
        )


class ClaimRequest(BaseModel):
    session_token: UUID


@router.post("/claim")
async def claim_records(
    body: ClaimRequest,
    request: Request,
):
    """Claim all anonymous records for authenticated user."""
    user = await get_optional_user(request)
    if not user:
        raise HTTPException(401, "Must be authenticated to claim records")

    async with get_connection() as conn:
        progress_count = await claim_progress_records(
            conn,
            session_token=body.session_token,
            user_id=user["user_id"],
        )
        chat_count = await claim_chat_sessions(
            conn,
            session_token=body.session_token,
            user_id=user["user_id"],
        )

    return {"progress_records_claimed": progress_count, "chat_sessions_claimed": chat_count}
```

**Step 2: Register router**

In `web_api/routes/__init__.py`, add:

```python
from web_api.routes.progress import router as progress_router

# In the include_routers function or wherever routers are added:
app.include_router(progress_router)
```

**Step 3: Verify routes**

Run: `python -c "from web_api.routes.progress import router; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add web_api/routes/progress.py web_api/routes/__init__.py
git commit -m "feat: add progress API routes

New endpoints:
- POST /api/progress/complete - mark content complete
- POST /api/progress/time - update time spent
- POST /api/progress/claim - claim anonymous records

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4.2: Update Course Progress Endpoint

**Files:**
- Modify: `web_api/routes/courses.py`

**Step 1: Write failing test**

Create `web_api/tests/test_course_progress_uuid.py`:

```python
"""Test course progress with UUID-based tracking."""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_course_progress_includes_lens_completion():
    """Course progress should show lens-level completion from new tables."""
    # This test documents the expected behavior after migration
    # The endpoint should return completion status per lens UUID
    pass  # Placeholder - actual test depends on implementation
```

**Step 2: Update course progress endpoint**

The existing `/api/courses/{course_slug}/progress` endpoint needs to be updated to:
1. Extract lens UUIDs from parsed modules
2. Query `user_content_progress` for those UUIDs
3. Calculate module status from lens completions

This is a significant change to `web_api/routes/courses.py`. The key changes:

```python
# In get_course_progress function:

# After getting course structure, collect all lens UUIDs
lens_ids = []
for unit in course.units:
    for module in unit.modules:
        parsed = load_narrative_module(module.slug)
        if parsed:
            for section in parsed.sections:
                if section.content_id:
                    lens_ids.append(section.content_id)

# Query progress for all lens UUIDs at once
from core.modules.progress import get_module_progress

async with get_connection() as conn:
    progress_map = await get_module_progress(
        conn,
        user_id=user_id,
        session_token=session_token,
        lens_ids=lens_ids,
    )

# Calculate module status from lens completions
def get_module_status(parsed_module, progress_map):
    required_lens_ids = [
        s.content_id for s in parsed_module.sections
        if s.content_id and not getattr(s, 'optional', False)
    ]
    if not required_lens_ids:
        return "not_started", 0, 0

    completed = sum(
        1 for lid in required_lens_ids
        if lid in progress_map and progress_map[lid].get("completed_at")
    )
    total = len(required_lens_ids)

    if completed == 0:
        return "not_started", 0, total
    elif completed >= total:
        return "completed", completed, total
    else:
        return "in_progress", completed, total
```

**Step 3: Commit**

```bash
git add web_api/routes/courses.py web_api/tests/test_course_progress_uuid.py
git commit -m "feat: update course progress to use UUID-based tracking

Module status now derived from lens completion in user_content_progress.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4.3: Add Module Progress Endpoint

**Files:**
- Modify: `web_api/routes/modules.py`

**Step 1: Write the failing test**

Add to `web_api/tests/test_progress_integration.py`:

```python
@pytest.mark.asyncio
async def test_get_module_progress_returns_lens_completion(test_client, authenticated_user):
    """Module progress endpoint returns lens-level completion status."""
    response = await test_client.get(
        "/api/modules/introduction/progress",
        cookies=authenticated_user.cookies,
    )

    assert response.status_code == 200
    data = response.json()
    assert "module" in data
    assert "status" in data
    assert "progress" in data
    assert "lenses" in data
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_progress_integration.py::test_get_module_progress_returns_lens_completion -v`
Expected: FAIL with 404 (endpoint doesn't exist)

**Step 3: Add the endpoint**

In `web_api/routes/modules.py`, add:

```python
from core.modules.progress import get_module_progress
from core.modules.chat_sessions import get_or_create_chat_session

@router.get("/api/modules/{module_slug}/progress")
async def get_module_progress_endpoint(
    module_slug: str,
    request: Request,
    x_session_token: str | None = Header(None),
):
    """Get detailed progress for a single module.

    Returns lens-level completion status, time spent, and chat session info.
    """
    # Get user or session token
    user = await get_optional_user(request)
    user_id = user["user_id"] if user else None
    session_token = None
    if not user_id and x_session_token:
        try:
            session_token = UUID(x_session_token)
        except ValueError:
            pass

    if not user_id and not session_token:
        raise HTTPException(401, "Authentication required")

    # Load module
    from core.modules.loader import load_narrative_module
    module = load_narrative_module(module_slug)
    if not module:
        raise HTTPException(404, "Module not found")

    # Collect lens UUIDs
    lens_ids = [s.content_id for s in module.sections if s.content_id]

    async with get_connection() as conn:
        # Get progress for all lenses
        progress_map = await get_module_progress(
            conn,
            user_id=user_id,
            session_token=session_token,
            lens_ids=lens_ids,
        )

        # Get chat session
        chat_session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            session_token=session_token,
            content_id=module.content_id,
            content_type="module",
        )

    # Build lens list with completion status
    lenses = []
    for section in module.sections:
        lens_data = {
            "id": str(section.content_id) if section.content_id else None,
            "title": getattr(section, "title", section.type),
            "type": section.type,
            "optional": getattr(section, "optional", False),
            "completed": False,
            "completedAt": None,
            "timeSpentS": 0,
        }
        if section.content_id and section.content_id in progress_map:
            prog = progress_map[section.content_id]
            lens_data["completed"] = prog.get("completed_at") is not None
            lens_data["completedAt"] = prog["completed_at"].isoformat() if prog.get("completed_at") else None
            lens_data["timeSpentS"] = prog.get("total_time_spent_s", 0)
        lenses.append(lens_data)

    # Calculate module status
    required_lenses = [l for l in lenses if not l["optional"]]
    completed_count = sum(1 for l in required_lenses if l["completed"])
    total_count = len(required_lenses)

    if completed_count == 0:
        status = "not_started"
    elif completed_count >= total_count:
        status = "completed"
    else:
        status = "in_progress"

    return {
        "module": {
            "id": str(module.content_id) if module.content_id else None,
            "slug": module.slug,
            "title": module.title,
        },
        "status": status,
        "progress": {"completed": completed_count, "total": total_count},
        "lenses": lenses,
        "chatSession": {
            "sessionId": chat_session["session_id"],
            "hasMessages": len(chat_session.get("messages", [])) > 0,
        },
    }
```

**Step 4: Run test to verify it passes**

Run: `pytest web_api/tests/test_progress_integration.py::test_get_module_progress_returns_lens_completion -v`
Expected: PASS

**Step 5: Commit**

```bash
git add web_api/routes/modules.py
git commit -m "feat: add GET /api/modules/{slug}/progress endpoint

Returns lens-level completion status, time spent, and chat session info.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4.4: Complete /api/progress/complete Response

**Files:**
- Modify: `web_api/routes/progress.py`

**Step 1: Update the endpoint to populate module_status and module_progress**

The endpoint should compute module-level status when a lens is marked complete:

```python
@router.post("/complete", response_model=MarkCompleteResponse)
async def complete_content(
    body: MarkCompleteRequest,
    auth: tuple = Depends(get_user_or_token),
):
    """Mark content as complete."""
    user_id, session_token = auth

    if body.content_type not in ("module", "lo", "lens", "test"):
        raise HTTPException(400, "Invalid content_type")

    async with get_connection() as conn:
        progress = await mark_content_complete(
            conn,
            user_id=user_id,
            session_token=session_token,
            content_id=body.content_id,
            content_type=body.content_type,
            content_title=body.content_title,
            time_spent_s=body.time_spent_s,
        )

        # If this is a lens, compute parent module status
        module_status = None
        module_progress = None

        if body.content_type == "lens" and body.parent_module_id:
            # Get all lens IDs for the parent module
            # (Caller must provide parent_module_id and lens_ids for this feature)
            if body.sibling_lens_ids:
                sibling_progress = await get_module_progress(
                    conn,
                    user_id=user_id,
                    session_token=session_token,
                    lens_ids=[UUID(lid) for lid in body.sibling_lens_ids],
                )

                completed = sum(1 for p in sibling_progress.values() if p.get("completed_at"))
                total = len(body.sibling_lens_ids)

                if completed == 0:
                    module_status = "not_started"
                elif completed >= total:
                    module_status = "completed"
                else:
                    module_status = "in_progress"

                module_progress = {"completed": completed, "total": total}

    return MarkCompleteResponse(
        completed_at=progress["completed_at"].isoformat() if progress.get("completed_at") else None,
        module_status=module_status,
        module_progress=module_progress,
    )
```

**Step 2: Update MarkCompleteRequest to include optional fields**

```python
class MarkCompleteRequest(BaseModel):
    content_id: UUID
    content_type: str  # 'module', 'lo', 'lens', 'test'
    content_title: str
    time_spent_s: int = 0
    # Optional: for computing parent module status when marking lens complete
    parent_module_id: UUID | None = None
    sibling_lens_ids: list[str] | None = None  # All lens UUIDs in the module
```

**Step 3: Commit**

```bash
git add web_api/routes/progress.py
git commit -m "feat: populate module_status and module_progress in complete response

When marking a lens complete, returns updated module-level status if
parent_module_id and sibling_lens_ids are provided.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Frontend Updates

### Task 5.1: Add Session Token Management

**Files:**
- Create: `web_frontend/src/hooks/useSessionToken.ts`

**Step 1: Create the hook**

```typescript
/**
 * Manages anonymous session token for progress tracking.
 *
 * The token is a UUID stored in localStorage, sent as X-Session-Token header.
 * On login, call claimSessionRecords() to associate anonymous progress with user.
 */

import { useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

const SESSION_TOKEN_KEY = "session_token";

export function useSessionToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Get or create session token
    let stored = localStorage.getItem(SESSION_TOKEN_KEY);
    if (!stored) {
      stored = uuidv4();
      localStorage.setItem(SESSION_TOKEN_KEY, stored);
    }
    setToken(stored);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    setToken(null);
  }, []);

  return { token, clearToken };
}

/**
 * Get session token synchronously (for use in API calls).
 */
export function getSessionToken(): string {
  let token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) {
    token = uuidv4();
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  }
  return token;
}
```

**Step 2: Add uuid dependency if needed**

Run: `cd web_frontend && npm list uuid || npm install uuid`

**Step 3: Commit**

```bash
git add web_frontend/src/hooks/useSessionToken.ts
git commit -m "feat: add session token management hook

UUID-based anonymous session tracking for progress.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.2: Create Progress API Client

**Files:**
- Create: `web_frontend/src/api/progress.ts`

**Step 1: Create the API client**

```typescript
/**
 * API client for progress tracking endpoints.
 */

import { API_URL } from "../config";
import { getSessionToken } from "../hooks/useSessionToken";

const API_BASE = API_URL;

interface AuthHeaders {
  Authorization?: string;
  "X-Session-Token"?: string;
}

function getAuthHeaders(isAuthenticated: boolean): AuthHeaders {
  if (isAuthenticated) {
    // JWT is sent via credentials: include
    return {};
  }
  return { "X-Session-Token": getSessionToken() };
}

export interface MarkCompleteRequest {
  content_id: string;
  content_type: "module" | "lo" | "lens" | "test";
  content_title: string;
  time_spent_s?: number;
}

export interface MarkCompleteResponse {
  completed_at: string;
  module_status?: string;
  module_progress?: { completed: number; total: number };
}

export async function markComplete(
  request: MarkCompleteRequest,
  isAuthenticated: boolean,
): Promise<MarkCompleteResponse> {
  const res = await fetch(`${API_BASE}/api/progress/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(isAuthenticated),
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    throw new Error("Failed to mark complete");
  }

  return res.json();
}

export async function updateTimeSpent(
  contentId: string,
  timeDeltaS: number,
  isAuthenticated: boolean,
): Promise<void> {
  await fetch(`${API_BASE}/api/progress/time`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(isAuthenticated),
    },
    credentials: "include",
    body: JSON.stringify({
      content_id: contentId,
      time_delta_s: timeDeltaS,
    }),
  });
  // Fire and forget - don't throw on error
}

export async function claimSessionRecords(
  sessionToken: string,
): Promise<{ progress_records_claimed: number; chat_sessions_claimed: number }> {
  const res = await fetch(`${API_BASE}/api/progress/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ session_token: sessionToken }),
  });

  if (!res.ok) {
    throw new Error("Failed to claim records");
  }

  return res.json();
}
```

**Step 2: Commit**

```bash
git add web_frontend/src/api/progress.ts
git commit -m "feat: add progress API client

Client functions for marking complete, time tracking, and claiming.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.3: Update Module Viewer to Use New Progress API

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`
- Modify: `web_frontend/src/components/module/MarkCompleteButton.tsx`

**Step 1: Update MarkCompleteButton**

The button should call the new progress API instead of just updating localStorage:

```typescript
// In MarkCompleteButton.tsx

import { markComplete } from "../../api/progress";
import { useAuth } from "../../hooks/useAuth";

interface Props {
  contentId: string;
  contentType: "lens" | "module";
  contentTitle: string;
  onComplete: () => void;
  timeSpentS?: number;
}

export function MarkCompleteButton({
  contentId,
  contentType,
  contentTitle,
  onComplete,
  timeSpentS = 0,
}: Props) {
  const { isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      await markComplete(
        {
          content_id: contentId,
          content_type: contentType,
          content_title: contentTitle,
          time_spent_s: timeSpentS,
        },
        isAuthenticated,
      );
      onComplete();
    } catch (error) {
      console.error("Failed to mark complete:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={isLoading}>
      {isLoading ? "Saving..." : "Mark Complete"}
    </button>
  );
}
```

**Step 2: Update Module.tsx to track section UUIDs**

The module viewer needs to:
1. Get section content_ids from the module data
2. Pass content_id to MarkCompleteButton
3. Update progress state when marking complete

**Step 3: Commit**

```bash
git add web_frontend/src/views/Module.tsx web_frontend/src/components/module/MarkCompleteButton.tsx
git commit -m "feat: integrate new progress API in module viewer

Marks lens complete via API instead of localStorage only.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.4: Update Auth Flow to Claim Records

**Files:**
- Modify: `web_frontend/src/hooks/useAuth.ts` (or equivalent auth hook)

**Step 1: Add claiming on login**

After successful authentication, claim anonymous records:

```typescript
// In the login success handler:

import { claimSessionRecords } from "../api/progress";
import { getSessionToken } from "./useSessionToken";

async function onLoginSuccess() {
  const sessionToken = getSessionToken();
  try {
    await claimSessionRecords(sessionToken);
    // Optionally clear token after claiming
    // localStorage.removeItem("session_token");
  } catch (error) {
    // Non-fatal - user still logged in
    console.error("Failed to claim session records:", error);
  }
}
```

**Step 2: Commit**

```bash
git add web_frontend/src/hooks/useAuth.ts
git commit -m "feat: claim anonymous progress on login

Links anonymous progress records to user account after authentication.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.5: Update Progress Bar Components

**Files:**
- Modify: `web_frontend/src/components/module/StageProgressBar.tsx`
- Modify: `web_frontend/src/components/module/ModuleDrawer.tsx` (or equivalent)

**Step 1: Update StageProgressBar to use lens UUIDs**

The progress bar should display completion based on lens UUIDs from the API:

```typescript
// StageProgressBar.tsx

interface LensProgress {
  id: string | null;
  title: string;
  type: string;
  optional: boolean;
  completed: boolean;
}

interface Props {
  lenses: LensProgress[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

export function StageProgressBar({ lenses, currentIndex, onNavigate }: Props) {
  return (
    <div className="flex items-center gap-1">
      {lenses.map((lens, index) => (
        <button
          key={lens.id || index}
          onClick={() => onNavigate(index)}
          className={cn(
            "w-3 h-3 rounded-full border-2 transition-colors",
            lens.completed && "bg-blue-500 border-blue-500",
            !lens.completed && index === currentIndex && "border-blue-500",
            !lens.completed && index !== currentIndex && "border-gray-300",
            lens.optional && "opacity-50"
          )}
          title={lens.title}
        />
      ))}
    </div>
  );
}
```

**Step 2: Update ModuleDrawer to show lens completion**

```typescript
// In drawer/sidebar component

interface Props {
  lenses: LensProgress[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onMarkComplete: (lensId: string) => void;
}

export function ModuleDrawer({ lenses, currentIndex, onNavigate, onMarkComplete }: Props) {
  const requiredLenses = lenses.filter(l => !l.optional);
  const completedCount = requiredLenses.filter(l => l.completed).length;

  return (
    <div className="p-4">
      <div className="text-sm text-gray-500 mb-4">
        Progress: {completedCount}/{requiredLenses.length} required lenses
      </div>

      {lenses.map((lens, index) => (
        <button
          key={lens.id || index}
          onClick={() => onNavigate(index)}
          className={cn(
            "w-full text-left p-2 rounded flex items-center gap-2",
            index === currentIndex && "bg-blue-50"
          )}
        >
          <span className={lens.completed ? "text-blue-500" : "text-gray-400"}>
            {lens.completed ? "●" : "○"}
          </span>
          <span>{lens.title}</span>
          {lens.optional && (
            <span className="text-xs bg-gray-100 px-1 rounded">Optional</span>
          )}
        </button>
      ))}
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add web_frontend/src/components/module/StageProgressBar.tsx web_frontend/src/components/module/ModuleDrawer.tsx
git commit -m "feat: update progress bar components for UUID-based tracking

Shows lens completion from API, with visual indicators for current/completed/optional.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.6: Add Module Completion Modal

**Files:**
- Modify: `web_frontend/src/components/module/ModuleCompleteModal.tsx`
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Update ModuleCompleteModal**

The modal should show when all required lenses are completed:

```typescript
// ModuleCompleteModal.tsx

interface Props {
  isOpen: boolean;
  moduleTitle: string;
  hasOptionalContent: boolean;
  optionalCount: number;
  onViewOptional: () => void;
  onContinue: () => void;
  onBackToOverview: () => void;
}

export function ModuleCompleteModal({
  isOpen,
  moduleTitle,
  hasOptionalContent,
  optionalCount,
  onViewOptional,
  onContinue,
  onBackToOverview,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🎉</div>
          <h2 className="text-xl font-semibold">Module Completed!</h2>
          <p className="text-gray-600 mt-2">
            You've finished "{moduleTitle}"
          </p>
        </div>

        <div className="space-y-3">
          {hasOptionalContent && (
            <button
              onClick={onViewOptional}
              className="w-full p-3 border rounded-lg text-left hover:bg-gray-50"
            >
              View Optional Content ({optionalCount} lenses)
            </button>
          )}

          <button
            onClick={onContinue}
            className="w-full p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Continue to Next Module →
          </button>

          <button
            onClick={onBackToOverview}
            className="w-full p-3 border rounded-lg hover:bg-gray-50"
          >
            Back to Course Overview
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Integrate into Module.tsx**

```typescript
// In Module.tsx

const [showCompletionModal, setShowCompletionModal] = useState(false);

// After marking a lens complete, check if module is now complete
const handleLensComplete = async (lensId: string) => {
  const response = await markComplete({
    content_id: lensId,
    content_type: "lens",
    content_title: currentLens.title,
    time_spent_s: timeSpent,
    parent_module_id: module.content_id,
    sibling_lens_ids: lenses.filter(l => !l.optional).map(l => l.id),
  }, isAuthenticated);

  // Update local state
  setLensProgress(prev => ({
    ...prev,
    [lensId]: { ...prev[lensId], completed: true },
  }));

  // Check if module just became complete
  if (response.module_status === "completed") {
    setShowCompletionModal(true);
  } else {
    // Auto-advance to next incomplete lens
    const nextIndex = findNextIncompleteLens();
    if (nextIndex !== -1) {
      setCurrentIndex(nextIndex);
    }
  }
};
```

**Step 3: Commit**

```bash
git add web_frontend/src/components/module/ModuleCompleteModal.tsx web_frontend/src/views/Module.tsx
git commit -m "feat: add module completion modal with auto-advance

Shows completion modal when all required lenses done.
Auto-advances to next incomplete lens otherwise.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.7: Update Course Overview UI

**Files:**
- Modify: `web_frontend/src/views/CourseOverview.tsx` (or equivalent)

**Step 1: Update to display new progress format**

```typescript
// CourseOverview.tsx - update module card display

interface ModuleProgress {
  id: string;
  slug: string;
  title: string;
  status: "not_started" | "in_progress" | "completed";
  progress: { completed: number; total: number };
  optional: boolean;
}

function ModuleCard({ module }: { module: ModuleProgress }) {
  return (
    <Link
      to={`/module/${module.slug}`}
      className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
    >
      <div className="flex items-center gap-3">
        {/* Status icon */}
        <span className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center",
          module.status === "completed" && "bg-green-100 text-green-600",
          module.status === "in_progress" && "bg-blue-100 text-blue-600",
          module.status === "not_started" && "bg-gray-100 text-gray-400",
        )}>
          {module.status === "completed" ? "✓" :
           module.status === "in_progress" ? "◐" : "○"}
        </span>

        <div>
          <div className="font-medium">{module.title}</div>
          {module.optional && (
            <span className="text-xs text-gray-500">Optional</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Progress fraction */}
        <span className="text-sm text-gray-500">
          {module.progress.completed}/{module.progress.total}
        </span>

        {/* Status badge */}
        <span className={cn(
          "text-xs px-2 py-1 rounded",
          module.status === "completed" && "bg-green-100 text-green-700",
          module.status === "in_progress" && "bg-blue-100 text-blue-700",
          module.status === "not_started" && "bg-gray-100 text-gray-600",
        )}>
          {module.status === "completed" ? "Completed" :
           module.status === "in_progress" ? "In Progress" : "Not Started"}
        </span>
      </div>
    </Link>
  );
}
```

**Step 2: Commit**

```bash
git add web_frontend/src/views/CourseOverview.tsx
git commit -m "feat: update course overview to show new progress format

Displays module status, progress fraction, and completion badges.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.9: Refactor useActivityTracker for New Progress API

**Files:**
- Modify: `web_frontend/src/hooks/useActivityTracker.ts`

**Step 1: Read existing implementation**

The existing hook tracks:
- Activity events (scroll, mousemove, keydown)
- Visibility changes (document.hidden)
- Inactivity timeout (180s articles, 300s chat)
- Sends heartbeat every 30s

**Step 2: Update to support new progress API**

```typescript
// useActivityTracker.ts

import { updateTimeSpent } from "../api/progress";

interface UseActivityTrackerOptions {
  // New system (UUID-based)
  contentId?: string;
  isAuthenticated?: boolean;

  // Legacy system (session-based) - keep during migration
  sessionId?: number;
  stageType?: "article" | "video" | "chat";
  stageIndex?: number;

  // Shared config
  heartbeatIntervalMs?: number;  // Default: 60000 (was 30000)
  inactivityTimeoutMs?: number;  // Default: 180000
}

export function useActivityTracker({
  contentId,
  isAuthenticated = false,
  sessionId,
  stageType,
  stageIndex,
  heartbeatIntervalMs = 60000,  // Changed from 30s to 60s per design
  inactivityTimeoutMs = 180000,
}: UseActivityTrackerOptions) {
  const lastActivityRef = useRef(Date.now());
  const isActiveRef = useRef(true);
  const accumulatedTimeRef = useRef(0);
  const lastHeartbeatRef = useRef(Date.now());

  // Activity detection (existing logic - keep as-is)
  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
      isActiveRef.current = true;
    };

    // Throttle to avoid excessive updates
    const throttledOnActivity = throttle(onActivity, 1000);

    window.addEventListener("mousemove", throttledOnActivity);
    window.addEventListener("keydown", throttledOnActivity);
    window.addEventListener("scroll", throttledOnActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", throttledOnActivity);
      window.removeEventListener("keydown", throttledOnActivity);
      window.removeEventListener("scroll", throttledOnActivity);
    };
  }, []);

  // Visibility tracking (existing logic - keep as-is)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        isActiveRef.current = false;
      } else {
        lastActivityRef.current = Date.now();
        isActiveRef.current = true;
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Heartbeat interval
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityRef.current;
      const isInactive = timeSinceLastActivity > inactivityTimeoutMs;
      const isHidden = document.hidden;

      // Only count time if user is active and tab is visible
      if (!isInactive && !isHidden) {
        const elapsed = Math.floor((now - lastHeartbeatRef.current) / 1000);

        // Send to new progress API if contentId provided
        if (contentId && elapsed > 0) {
          updateTimeSpent(contentId, elapsed, isAuthenticated);
        }

        // Send to legacy API if sessionId provided (during migration)
        if (sessionId !== undefined) {
          sendLegacyHeartbeat(sessionId, stageType, stageIndex);
        }
      }

      lastHeartbeatRef.current = now;
    }, heartbeatIntervalMs);

    return () => clearInterval(interval);
  }, [contentId, isAuthenticated, sessionId, stageType, stageIndex, heartbeatIntervalMs, inactivityTimeoutMs]);

  // Send accumulated time on unmount/navigation
  useEffect(() => {
    const sendFinalTime = () => {
      if (contentId) {
        const elapsed = Math.floor((Date.now() - lastHeartbeatRef.current) / 1000);
        if (elapsed > 0) {
          // Use sendBeacon for reliability on page unload
          const data = JSON.stringify({ content_id: contentId, time_delta_s: elapsed });
          navigator.sendBeacon("/api/progress/time", data);
        }
      }
    };

    window.addEventListener("beforeunload", sendFinalTime);
    return () => {
      window.removeEventListener("beforeunload", sendFinalTime);
      sendFinalTime(); // Also send on unmount (navigation within SPA)
    };
  }, [contentId]);
}

// Legacy heartbeat function (keep during migration)
async function sendLegacyHeartbeat(sessionId: number, stageType?: string, stageIndex?: number) {
  try {
    await fetch(`/api/module-sessions/${sessionId}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ stage_type: stageType, stage_index: stageIndex }),
    });
  } catch {
    // Fire and forget
  }
}
```

**Step 3: Update usage in Module.tsx**

```typescript
// Before (old system only):
useActivityTracker({
  sessionId,
  stageType: currentStage.type,
  stageIndex: currentIndex,
});

// After (new system, with legacy fallback):
useActivityTracker({
  // New system
  contentId: currentLens?.id,
  isAuthenticated,
  // Legacy (remove after migration)
  sessionId,
  stageType: currentStage?.type,
  stageIndex: currentIndex,
});
```

**Step 4: Update sendBeacon endpoint to accept beacon format**

The `beforeunload` handler uses `navigator.sendBeacon()` which sends as `text/plain` by default. Update the API to handle this:

```python
# In web_api/routes/progress.py

@router.post("/time", status_code=204)
async def update_time(
    request: Request,
    body: TimeUpdateRequest | None = None,
    auth: tuple = Depends(get_user_or_token),
):
    """Update time spent on content (periodic heartbeat or beacon)."""
    user_id, session_token = auth

    # Handle sendBeacon (raw JSON body)
    if body is None:
        raw = await request.body()
        data = json.loads(raw)
        content_id = UUID(data["content_id"])
        time_delta_s = data["time_delta_s"]
    else:
        content_id = body.content_id
        time_delta_s = body.time_delta_s

    async with get_connection() as conn:
        await update_time_spent(
            conn,
            user_id=user_id,
            session_token=session_token,
            content_id=content_id,
            time_delta_s=time_delta_s,
        )
```

**Step 5: Commit**

```bash
git add web_frontend/src/hooks/useActivityTracker.ts web_api/routes/progress.py
git commit -m "feat: update useActivityTracker to use new progress API

- Accepts contentId for UUID-based time tracking
- Keeps legacy sessionId support during migration
- Changed heartbeat interval from 30s to 60s
- Uses sendBeacon for reliable page unload tracking
- Activity detection logic unchanged (already robust)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5.10: Clean Up Legacy localStorage Keys

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add one-time cleanup**

Add a migration that removes old localStorage keys:

```typescript
// At module load or app initialization
function cleanupLegacyProgress() {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("module-completed-") || key?.startsWith("module_session_")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));

  // Mark cleanup as done
  localStorage.setItem("progress_migration_v2", "done");
}

// Call once
if (!localStorage.getItem("progress_migration_v2")) {
  cleanupLegacyProgress();
}
```

**Step 2: Commit**

```bash
git add web_frontend/src/views/Module.tsx
git commit -m "chore: clean up legacy localStorage progress keys

One-time migration removes old module-completed-* and module_session_* keys.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 6: Data Migration

### Task 6.1: Create Data Migration Script

**Files:**
- Create: `scripts/migrate_progress_data.py`

**Step 1: Create migration script**

```python
#!/usr/bin/env python3
"""Migrate existing module_sessions data to new progress tables.

Run with: python scripts/migrate_progress_data.py

Prerequisites:
- New tables must exist (run alembic upgrade head first)
- Content must have UUIDs in frontmatter
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.db import get_engine
from core.content.cache import get_cache
from sqlalchemy import text


async def build_module_uuid_lookup() -> dict[str, tuple[str, str]]:
    """Build mapping from module slug to (uuid, title)."""
    cache = await get_cache()
    lookup = {}

    for slug, module in cache.modules.items():
        if module.content_id:
            lookup[slug] = (str(module.content_id), module.title)

    return lookup


def escape_sql_string(s: str) -> str:
    """Escape single quotes in SQL string literals."""
    return s.replace("'", "''")


async def migrate_sessions():
    """Migrate module_sessions to chat_sessions."""
    print("Building module UUID lookup...")
    lookup = await build_module_uuid_lookup()
    print(f"Found {len(lookup)} modules with UUIDs")

    if not lookup:
        print("No modules with UUIDs found. Add UUIDs to content before migrating.")
        return

    engine = get_engine()

    async with engine.begin() as conn:
        # Count existing sessions
        result = await conn.execute(text("SELECT COUNT(*) FROM module_sessions"))
        total = result.scalar()
        print(f"Migrating {total} sessions...")

        # Build VALUES clause with proper escaping
        values_list = [
            f"('{escape_sql_string(slug)}', '{uuid}')"
            for slug, (uuid, _) in lookup.items()
        ]
        values_clause = ",".join(values_list)

        # Migrate to chat_sessions
        # Anonymous sessions get random tokens (unclaimable - acceptable loss)
        await conn.execute(text(f"""
            INSERT INTO chat_sessions (session_token, user_id, content_id, content_type, messages, started_at, last_active_at)
            SELECT
                CASE WHEN ms.user_id IS NULL THEN gen_random_uuid() ELSE NULL END,
                ms.user_id,
                CASE WHEN m.uuid IS NOT NULL THEN m.uuid::uuid ELSE NULL END,
                'module',
                ms.messages,
                ms.started_at,
                ms.last_active_at
            FROM module_sessions ms
            LEFT JOIN (VALUES {values_clause}) AS m(slug, uuid) ON m.slug = ms.module_slug
            WHERE NOT EXISTS (
                SELECT 1 FROM chat_sessions cs
                WHERE cs.user_id = ms.user_id
                AND cs.content_id = m.uuid::uuid
            )
        """))

        # Build VALUES clause with titles (escaped)
        values_with_titles = [
            f"('{escape_sql_string(slug)}', '{uuid}', '{escape_sql_string(title)}')"
            for slug, (uuid, title) in lookup.items()
        ]
        values_clause_with_titles = ",".join(values_with_titles)

        # Migrate completed sessions to user_content_progress
        await conn.execute(text(f"""
            INSERT INTO user_content_progress (user_id, content_id, content_type, content_title, started_at, completed_at)
            SELECT
                ms.user_id,
                m.uuid::uuid,
                'module',
                m.title,
                ms.started_at,
                ms.completed_at
            FROM module_sessions ms
            JOIN (VALUES {values_clause_with_titles}) AS m(slug, uuid, title) ON m.slug = ms.module_slug
            WHERE ms.completed_at IS NOT NULL
            AND ms.user_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM user_content_progress ucp
                WHERE ucp.user_id = ms.user_id
                AND ucp.content_id = m.uuid::uuid
            )
        """))

        print("Migration complete!")


async def rename_old_tables():
    """Rename old tables to _archived suffix."""
    engine = get_engine()

    async with engine.begin() as conn:
        await conn.execute(text("""
            ALTER TABLE IF EXISTS module_sessions RENAME TO module_sessions_archived;
            ALTER TABLE IF EXISTS content_events RENAME TO content_events_archived;

            COMMENT ON TABLE module_sessions_archived IS 'Archived 2026-01-XX. Replaced by chat_sessions and user_content_progress.';
            COMMENT ON TABLE content_events_archived IS 'Archived 2026-01-XX. Replaced by time tracking in user_content_progress.';
        """))

        print("Old tables renamed to *_archived")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", action="store_true", help="Also rename old tables to _archived")
    args = parser.parse_args()

    asyncio.run(migrate_sessions())

    if args.archive:
        asyncio.run(rename_old_tables())
```

**Step 2: Commit**

```bash
git add scripts/migrate_progress_data.py
git commit -m "feat: add data migration script for progress tables

Migrates module_sessions to chat_sessions and user_content_progress.
Use --archive flag to rename old tables.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 7: Testing & Verification

### Task 7.1: Add Comprehensive Unit Tests

**Files:**
- Modify: `core/modules/tests/test_progress.py`

**Step 1: Add comprehensive tests for progress service**

```python
"""Tests for progress tracking service."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.modules.progress import (
    get_or_create_progress,
    mark_content_complete,
    update_time_spent,
    get_module_progress,
    claim_progress_records,
)


# ============================================================================
# get_or_create_progress tests
# ============================================================================

@pytest.mark.asyncio
async def test_get_or_create_returns_existing_record(db_conn):
    """Should return existing record without creating new one."""
    content_id = uuid.uuid4()
    user_id = 123

    # Create initial record
    record1 = await get_or_create_progress(
        db_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
    )

    # Get same record
    record2 = await get_or_create_progress(
        db_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
    )

    assert record1["id"] == record2["id"]


@pytest.mark.asyncio
async def test_get_or_create_handles_concurrent_requests(db_conn):
    """Should handle race condition gracefully with ON CONFLICT."""
    content_id = uuid.uuid4()
    user_id = 123

    # Simulate concurrent requests by calling twice rapidly
    import asyncio
    results = await asyncio.gather(
        get_or_create_progress(db_conn, user_id=user_id, session_token=None,
                               content_id=content_id, content_type="lens", content_title="Test"),
        get_or_create_progress(db_conn, user_id=user_id, session_token=None,
                               content_id=content_id, content_type="lens", content_title="Test"),
    )

    # Both should return the same record ID
    assert results[0]["id"] == results[1]["id"]


@pytest.mark.asyncio
async def test_get_or_create_requires_identity():
    """Should raise error if neither user_id nor session_token provided."""
    conn = AsyncMock()

    with pytest.raises(ValueError, match="Either user_id or session_token"):
        await get_or_create_progress(
            conn,
            user_id=None,
            session_token=None,
            content_id=uuid.uuid4(),
            content_type="lens",
            content_title="Test",
        )


# ============================================================================
# mark_content_complete tests
# ============================================================================

@pytest.mark.asyncio
async def test_mark_complete_is_idempotent(db_conn):
    """Calling mark_complete twice should return same completion time."""
    content_id = uuid.uuid4()
    user_id = 123

    result1 = await mark_content_complete(
        db_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
        time_spent_s=60,
    )

    result2 = await mark_content_complete(
        db_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
        time_spent_s=120,  # Different time
    )

    # Same completed_at, time not updated
    assert result1["completed_at"] == result2["completed_at"]
    assert result1["time_to_complete_s"] == result2["time_to_complete_s"]


@pytest.mark.asyncio
async def test_mark_complete_sets_time_to_complete(db_conn):
    """Should set time_to_complete_s when marking complete."""
    content_id = uuid.uuid4()

    result = await mark_content_complete(
        db_conn,
        user_id=123,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
        time_spent_s=300,
    )

    assert result["time_to_complete_s"] == 300
    assert result["completed_at"] is not None


# ============================================================================
# update_time_spent tests
# ============================================================================

@pytest.mark.asyncio
async def test_update_time_increments_total(db_conn):
    """Should increment total_time_spent_s."""
    content_id = uuid.uuid4()
    user_id = 123

    # Create record
    await get_or_create_progress(
        db_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
    )

    # Update time multiple times
    await update_time_spent(db_conn, user_id=user_id, session_token=None,
                            content_id=content_id, time_delta_s=60)
    await update_time_spent(db_conn, user_id=user_id, session_token=None,
                            content_id=content_id, time_delta_s=60)

    # Check total
    from core.modules.progress import get_module_progress
    progress = await get_module_progress(db_conn, user_id=user_id,
                                         session_token=None, lens_ids=[content_id])
    assert progress[content_id]["total_time_spent_s"] == 120


@pytest.mark.asyncio
async def test_update_time_freezes_after_completion(db_conn):
    """time_to_complete_s should not update after marking complete."""
    content_id = uuid.uuid4()
    user_id = 123

    # Create and complete
    await mark_content_complete(
        db_conn,
        user_id=user_id,
        session_token=None,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
        time_spent_s=100,
    )

    # Update time after completion
    await update_time_spent(db_conn, user_id=user_id, session_token=None,
                            content_id=content_id, time_delta_s=60)

    # time_to_complete_s unchanged, total_time_spent_s updated
    progress = await get_module_progress(db_conn, user_id=user_id,
                                         session_token=None, lens_ids=[content_id])
    assert progress[content_id]["time_to_complete_s"] == 100  # Frozen
    assert progress[content_id]["total_time_spent_s"] == 160  # Still accumulates


# ============================================================================
# claim_progress_records tests
# ============================================================================

@pytest.mark.asyncio
async def test_claim_transfers_records(db_conn):
    """Should transfer records from session_token to user_id."""
    content_id = uuid.uuid4()
    session_token = uuid.uuid4()
    user_id = 456

    # Create anonymous record
    await mark_content_complete(
        db_conn,
        user_id=None,
        session_token=session_token,
        content_id=content_id,
        content_type="lens",
        content_title="Test",
    )

    # Claim
    count = await claim_progress_records(
        db_conn,
        session_token=session_token,
        user_id=user_id,
    )

    assert count == 1

    # Verify record is now owned by user
    progress = await get_module_progress(db_conn, user_id=user_id,
                                         session_token=None, lens_ids=[content_id])
    assert content_id in progress
```

**Step 2: Run tests**

Run: `pytest core/modules/tests/test_progress.py -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add core/modules/tests/test_progress.py
git commit -m "test: add comprehensive unit tests for progress service

Tests get_or_create, mark_complete, update_time, and claiming.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 7.2: Add Integration Tests

**Files:**
- Create: `web_api/tests/test_progress_integration.py`

**Step 1: Write integration tests**

```python
"""Integration tests for progress tracking flow."""

import pytest
from uuid import uuid4


@pytest.mark.asyncio
async def test_anonymous_user_can_mark_complete(test_client):
    """Anonymous user can mark content complete with session token."""
    content_id = str(uuid4())
    session_token = str(uuid4())

    response = await test_client.post(
        "/api/progress/complete",
        headers={"X-Session-Token": session_token},
        json={
            "content_id": content_id,
            "content_type": "lens",
            "content_title": "Test Lens",
            "time_spent_s": 60,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert "completed_at" in data


@pytest.mark.asyncio
async def test_authenticated_user_can_mark_complete(test_client, authenticated_user):
    """Authenticated user can mark content complete without session token."""
    content_id = str(uuid4())

    response = await test_client.post(
        "/api/progress/complete",
        cookies=authenticated_user.cookies,
        json={
            "content_id": content_id,
            "content_type": "lens",
            "content_title": "Test Lens",
        },
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_claim_records_on_login(test_client, authenticated_user):
    """Records are claimed when user authenticates."""
    session_token = str(uuid4())
    content_id = str(uuid4())

    # Create anonymous progress
    await test_client.post(
        "/api/progress/complete",
        headers={"X-Session-Token": session_token},
        json={
            "content_id": content_id,
            "content_type": "lens",
            "content_title": "Test Lens",
        },
    )

    # Claim as authenticated user
    response = await test_client.post(
        "/api/progress/claim",
        json={"session_token": session_token},
        cookies=authenticated_user.cookies,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["progress_records_claimed"] >= 1


@pytest.mark.asyncio
async def test_time_update_endpoint(test_client):
    """Time update endpoint should return 204."""
    content_id = str(uuid4())
    session_token = str(uuid4())

    # First create a record
    await test_client.post(
        "/api/progress/complete",
        headers={"X-Session-Token": session_token},
        json={
            "content_id": content_id,
            "content_type": "lens",
            "content_title": "Test Lens",
        },
    )

    # Update time
    response = await test_client.post(
        "/api/progress/time",
        headers={"X-Session-Token": session_token},
        json={
            "content_id": content_id,
            "time_delta_s": 60,
        },
    )

    assert response.status_code == 204


@pytest.mark.asyncio
async def test_invalid_content_type_rejected(test_client):
    """Invalid content_type should return 400."""
    response = await test_client.post(
        "/api/progress/complete",
        headers={"X-Session-Token": str(uuid4())},
        json={
            "content_id": str(uuid4()),
            "content_type": "invalid",
            "content_title": "Test",
        },
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_missing_auth_returns_401(test_client):
    """Request without auth should return 401."""
    response = await test_client.post(
        "/api/progress/complete",
        json={
            "content_id": str(uuid4()),
            "content_type": "lens",
            "content_title": "Test",
        },
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_module_progress_endpoint(test_client, authenticated_user):
    """Module progress endpoint returns lens completion status."""
    # Note: This test requires a module to exist in content cache
    response = await test_client.get(
        "/api/modules/introduction/progress",
        cookies=authenticated_user.cookies,
    )

    # Either 200 (module exists) or 404 (module not found in test env)
    assert response.status_code in (200, 404)

    if response.status_code == 200:
        data = response.json()
        assert "module" in data
        assert "status" in data
        assert "progress" in data
        assert "lenses" in data
```

**Step 2: Commit**

```bash
git add web_api/tests/test_progress_integration.py
git commit -m "test: add comprehensive integration tests for progress API

Tests all endpoints, auth modes, edge cases, and error handling.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 7.2: Manual Verification Checklist

**Verification steps to perform before deploying:**

1. **Database migration:**
   - [ ] Run `alembic upgrade head` on staging
   - [ ] Verify tables created with correct indexes
   - [ ] Run data migration script
   - [ ] Spot-check migrated records

2. **Anonymous user flow:**
   - [ ] Open module as anonymous user
   - [ ] Mark lens complete
   - [ ] Verify progress persists on page reload
   - [ ] Login and verify progress claimed

3. **Authenticated user flow:**
   - [ ] Login first
   - [ ] Mark lens complete
   - [ ] Verify progress shows on different device

4. **Course overview:**
   - [ ] Verify module status shows correctly
   - [ ] Verify progress fractions match actual completions

5. **Content restructuring:**
   - [ ] Complete some lenses
   - [ ] Reorder lenses in content
   - [ ] Verify progress still shows correctly

---

## Summary

**Phase 1:** Database schema (2 tasks)
**Phase 2:** Content UUID support (2 tasks)
**Phase 3:** Backend services (2 tasks)
**Phase 4:** API routes (4 tasks)
**Phase 5:** Frontend updates (9 tasks)
**Phase 6:** Data migration (1 task)
**Phase 7:** Testing (3 tasks)

**Total: 23 tasks**

Each task is designed to be committed independently, allowing for incremental progress and easy rollback if issues arise.

---

## Code Review Fixes Applied

This plan incorporates fixes from code review:

1. **Fixed `update_time_spent` SQL logic** - Uses SQLAlchemy `case()` expression instead of Python-side conditional
2. **Added `GET /api/modules/{slug}/progress` endpoint** - Task 4.3 covers the missing module progress endpoint
3. **Complete response population** - Task 4.4 ensures `module_status` and `module_progress` are populated
4. **Race condition handling** - `get_or_create_progress` uses `INSERT ... ON CONFLICT`
5. **Type consistency** - Migration uses `Text` to match SQLAlchemy table definitions
6. **Migration script safety** - Added `escape_sql_string()` to prevent SQL injection from special characters in titles
7. **Comprehensive tests** - Task 7.1 adds unit tests for all service functions
8. **Frontend UI components** - Tasks 5.5, 5.6, 5.7 cover progress bars, completion modal, and course overview
9. **Time tracking hook** - Task 5.9 refactors `useActivityTracker` to use new progress API with activity detection, visibility tracking, and `sendBeacon` for page unload
