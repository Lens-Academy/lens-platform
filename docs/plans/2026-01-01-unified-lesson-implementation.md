# Unified Lesson Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified lesson page that supports sequential stages of articles, videos, and chat discussions with AI tutoring.

**Architecture:** Backend-driven lesson sessions stored in PostgreSQL. Frontend is a thin UI that fetches session state and sends user actions. AI prompt construction happens server-side in `core/`.

**Tech Stack:** FastAPI, SQLAlchemy (async), PostgreSQL, React, TypeScript, Tailwind CSS

---

## Task 1: Core Lesson Types (Python)

**Files:**
- Create: `core/lessons/types.py`
- Create: `core/lessons/__init__.py`

**Step 1: Create the types module**

```python
# core/lessons/types.py
"""
Type definitions for lesson stages and sessions.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass
class ArticleStage:
    """Display a section of a markdown article."""
    type: Literal["article"]
    source_url: str
    from_text: str | None = None  # None means full article
    to_text: str | None = None


@dataclass
class VideoStage:
    """Display a YouTube video clip."""
    type: Literal["video"]
    video_id: str
    from_seconds: int = 0
    to_seconds: int | None = None  # None means to end


@dataclass
class ChatStage:
    """Active discussion with AI tutor."""
    type: Literal["chat"]
    context: str  # Instructions for the AI
    include_previous_content: bool = True


Stage = ArticleStage | VideoStage | ChatStage


@dataclass
class Lesson:
    """A complete lesson definition."""
    id: str
    title: str
    stages: list[Stage]
```

**Step 2: Create the init file**

```python
# core/lessons/__init__.py
"""Lesson management module."""

from .types import (
    ArticleStage,
    VideoStage,
    ChatStage,
    Stage,
    Lesson,
)

__all__ = [
    "ArticleStage",
    "VideoStage",
    "ChatStage",
    "Stage",
    "Lesson",
]
```

**Step 3: Verify imports work**

Run: `python -c "from core.lessons import Lesson, ArticleStage, VideoStage, ChatStage; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
jj describe -m "feat(core): add lesson type definitions"
```

---

## Task 2: Sample Lesson JSON

**Files:**
- Create: `core/content/lessons/intro-to-ai-safety.json`
- Create: `core/content/articles/` (directory)
- Create: `core/content/video_transcripts/` (directory)

**Step 1: Create directory structure**

```bash
mkdir -p core/content/lessons core/content/articles core/content/video_transcripts
```

**Step 2: Create sample lesson JSON**

```json
{
  "id": "intro-to-ai-safety",
  "title": "Introduction to AI Safety",
  "stages": [
    {
      "type": "article",
      "source_url": "articles/four-background-claims.md",
      "from": "AI Safety is an important topic",
      "to": "instrumental convergence."
    },
    {
      "type": "chat",
      "context": "The user just read an introduction to AI Safety. Ask them what they found most surprising or what questions they have. Check their understanding of why AI safety matters.",
      "includePreviousContent": true
    },
    {
      "type": "video",
      "videoId": "pYXy-A4siMw",
      "from": 0,
      "to": 120
    },
    {
      "type": "chat",
      "context": "The user just watched a video clip about AI safety. Quiz them on the key points without providing hints - test their recall.",
      "includePreviousContent": false
    }
  ]
}
```

**Step 3: Create placeholder article**

```markdown
# Four Background Claims

AI Safety is an important topic that deserves serious attention.

## Claim 1: Intelligence is General

The first claim is that general intelligence exists. Humans have demonstrated remarkable ability to solve problems across diverse domains...

This relates to the concept of instrumental convergence.

## Claim 2: AI Could Surpass Humans

The second claim is about superintelligence...
```

Save to: `core/content/articles/four-background-claims.md`

**Step 4: Commit**

```bash
jj describe -m "feat(core): add sample lesson content"
```

---

## Task 3: Lesson Loader

**Files:**
- Create: `core/lessons/loader.py`
- Modify: `core/lessons/__init__.py`

**Step 1: Write the failing test**

Create: `core/lessons/tests/__init__.py` (empty)
Create: `core/lessons/tests/test_loader.py`

```python
# core/lessons/tests/test_loader.py
"""Tests for lesson loader."""

import pytest
from core.lessons.loader import load_lesson, get_available_lessons, LessonNotFoundError


def test_load_existing_lesson():
    """Should load a lesson from JSON file."""
    lesson = load_lesson("intro-to-ai-safety")
    assert lesson.id == "intro-to-ai-safety"
    assert lesson.title == "Introduction to AI Safety"
    assert len(lesson.stages) > 0


def test_load_nonexistent_lesson():
    """Should raise LessonNotFoundError for unknown lesson."""
    with pytest.raises(LessonNotFoundError):
        load_lesson("nonexistent-lesson")


def test_get_available_lessons():
    """Should return list of available lesson IDs."""
    lessons = get_available_lessons()
    assert isinstance(lessons, list)
    assert "intro-to-ai-safety" in lessons
```

**Step 2: Run test to verify it fails**

Run: `pytest core/lessons/tests/test_loader.py -v`
Expected: FAIL (loader module doesn't exist)

**Step 3: Write minimal implementation**

```python
# core/lessons/loader.py
"""Load lesson definitions from JSON files."""

import json
from pathlib import Path

from .types import Lesson, ArticleStage, VideoStage, ChatStage, Stage


class LessonNotFoundError(Exception):
    """Raised when a lesson cannot be found."""
    pass


# Path to lesson JSON files
LESSONS_DIR = Path(__file__).parent.parent / "content" / "lessons"


def _parse_stage(data: dict) -> Stage:
    """Parse a stage dict into a Stage dataclass."""
    stage_type = data["type"]

    if stage_type == "article":
        return ArticleStage(
            type="article",
            source_url=data["source_url"],
            from_text=data.get("from"),
            to_text=data.get("to"),
        )
    elif stage_type == "video":
        return VideoStage(
            type="video",
            video_id=data["videoId"],
            from_seconds=data.get("from", 0),
            to_seconds=data.get("to"),
        )
    elif stage_type == "chat":
        return ChatStage(
            type="chat",
            context=data["context"],
            include_previous_content=data.get("includePreviousContent", True),
        )
    else:
        raise ValueError(f"Unknown stage type: {stage_type}")


def load_lesson(lesson_id: str) -> Lesson:
    """
    Load a lesson by ID from the lessons directory.

    Args:
        lesson_id: The lesson ID (filename without .json extension)

    Returns:
        Lesson dataclass with parsed stages

    Raises:
        LessonNotFoundError: If lesson file doesn't exist
    """
    lesson_path = LESSONS_DIR / f"{lesson_id}.json"

    if not lesson_path.exists():
        raise LessonNotFoundError(f"Lesson not found: {lesson_id}")

    with open(lesson_path) as f:
        data = json.load(f)

    stages = [_parse_stage(s) for s in data["stages"]]

    return Lesson(
        id=data["id"],
        title=data["title"],
        stages=stages,
    )


def get_available_lessons() -> list[str]:
    """
    Get list of available lesson IDs.

    Returns:
        List of lesson IDs (filenames without .json extension)
    """
    if not LESSONS_DIR.exists():
        return []

    return [f.stem for f in LESSONS_DIR.glob("*.json")]
```

**Step 4: Update init to export loader**

```python
# core/lessons/__init__.py
"""Lesson management module."""

from .types import (
    ArticleStage,
    VideoStage,
    ChatStage,
    Stage,
    Lesson,
)
from .loader import (
    load_lesson,
    get_available_lessons,
    LessonNotFoundError,
)

__all__ = [
    "ArticleStage",
    "VideoStage",
    "ChatStage",
    "Stage",
    "Lesson",
    "load_lesson",
    "get_available_lessons",
    "LessonNotFoundError",
]
```

**Step 5: Run test to verify it passes**

Run: `pytest core/lessons/tests/test_loader.py -v`
Expected: PASS

**Step 6: Commit**

```bash
jj describe -m "feat(core): add lesson loader with tests"
```

---

## Task 4: Content Extractor

**Files:**
- Create: `core/lessons/content.py`
- Modify: `core/lessons/__init__.py`

**Step 1: Write the failing test**

```python
# core/lessons/tests/test_content.py
"""Tests for content extraction."""

import pytest
from core.lessons.content import extract_article_section, load_article


def test_load_full_article():
    """Should load entire article content."""
    content = load_article("articles/four-background-claims.md")
    assert "Four Background Claims" in content
    assert len(content) > 100


def test_extract_section_with_anchors():
    """Should extract text between from/to anchors."""
    full_text = """
    Some intro text here.

    The first claim is that general intelligence exists.
    This is a very important point to understand.
    It relates to instrumental convergence.

    More text after.
    """

    section = extract_article_section(
        full_text,
        from_text="The first claim is",
        to_text="instrumental convergence."
    )

    assert "The first claim is" in section
    assert "instrumental convergence." in section
    assert "Some intro text" not in section
    assert "More text after" not in section


def test_extract_section_no_anchors():
    """Should return full text when no anchors specified."""
    full_text = "Complete article content here."
    section = extract_article_section(full_text, None, None)
    assert section == full_text
```

**Step 2: Run test to verify it fails**

Run: `pytest core/lessons/tests/test_content.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

```python
# core/lessons/content.py
"""Content loading and extraction utilities."""

from pathlib import Path


# Path to content files
CONTENT_DIR = Path(__file__).parent.parent / "content"


def load_article(source_url: str) -> str:
    """
    Load article content from file.

    Args:
        source_url: Relative path from content directory (e.g., "articles/foo.md")

    Returns:
        Full markdown content as string
    """
    article_path = CONTENT_DIR / source_url

    if not article_path.exists():
        raise FileNotFoundError(f"Article not found: {source_url}")

    return article_path.read_text()


def extract_article_section(
    content: str,
    from_text: str | None,
    to_text: str | None,
) -> str:
    """
    Extract a section of text between two anchor phrases.

    Args:
        content: Full article content
        from_text: Starting anchor phrase (inclusive), or None for start
        to_text: Ending anchor phrase (inclusive), or None for end

    Returns:
        Extracted section including the anchor phrases
    """
    if from_text is None and to_text is None:
        return content

    start_idx = 0
    end_idx = len(content)

    if from_text:
        idx = content.find(from_text)
        if idx != -1:
            start_idx = idx

    if to_text:
        # Search from start_idx to find the ending anchor
        idx = content.find(to_text, start_idx)
        if idx != -1:
            end_idx = idx + len(to_text)

    return content[start_idx:end_idx].strip()


def load_video_transcript(source_url: str) -> str:
    """
    Load video transcript from file.

    Args:
        source_url: Relative path from content directory

    Returns:
        Full transcript as string
    """
    transcript_path = CONTENT_DIR / source_url

    if not transcript_path.exists():
        raise FileNotFoundError(f"Transcript not found: {source_url}")

    return transcript_path.read_text()
```

**Step 4: Update init**

Add to `core/lessons/__init__.py`:

```python
from .content import (
    load_article,
    extract_article_section,
    load_video_transcript,
)

# Add to __all__:
    "load_article",
    "extract_article_section",
    "load_video_transcript",
```

**Step 5: Run test to verify it passes**

Run: `pytest core/lessons/tests/test_content.py -v`
Expected: PASS

**Step 6: Commit**

```bash
jj describe -m "feat(core): add content extraction utilities"
```

---

## Task 5: Database Table for Lesson Sessions

**Files:**
- Modify: `core/tables.py`
- Modify: `core/enums.py` (if needed)

**Step 1: Add lesson_sessions table to tables.py**

Add after the `auth_codes` table definition:

```python
# =====================================================
# 14. LESSON_SESSIONS
# =====================================================
lesson_sessions = Table(
    "lesson_sessions",
    metadata,
    Column("session_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("lesson_id", Text, nullable=False),
    Column("current_stage_index", Integer, server_default="0"),
    Column("messages", JSONB, server_default="[]"),
    Column("started_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("last_active_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("completed_at", TIMESTAMP(timezone=True)),
    Index("idx_lesson_sessions_user_id", "user_id"),
    Index("idx_lesson_sessions_lesson_id", "lesson_id"),
)
```

**Step 2: Verify syntax**

Run: `python -c "from core.tables import lesson_sessions; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
jj describe -m "feat(db): add lesson_sessions table definition"
```

---

## Task 6: Alembic Migration

**Files:**
- Create: `alembic/versions/YYYYMMDD_add_lesson_sessions.py`

**Step 1: Generate migration**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform && alembic revision -m "add_lesson_sessions"`

**Step 2: Edit migration file**

```python
"""add_lesson_sessions

Revision ID: <auto-generated>
Revises: 39e3de01c3b8
Create Date: <auto-generated>
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision: str = '<auto-generated>'
down_revision: Union[str, None] = '39e3de01c3b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lesson_sessions',
        sa.Column('session_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('lesson_id', sa.Text(), nullable=False),
        sa.Column('current_stage_index', sa.Integer(), server_default='0', nullable=True),
        sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=True),
        sa.Column('started_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('last_active_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('completed_at', postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], name=op.f('fk_lesson_sessions_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('session_id', name=op.f('pk_lesson_sessions'))
    )
    op.create_index('idx_lesson_sessions_lesson_id', 'lesson_sessions', ['lesson_id'], unique=False)
    op.create_index('idx_lesson_sessions_user_id', 'lesson_sessions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_lesson_sessions_user_id', table_name='lesson_sessions')
    op.drop_index('idx_lesson_sessions_lesson_id', table_name='lesson_sessions')
    op.drop_table('lesson_sessions')
```

**Step 3: Run migration**

Run: `alembic upgrade head`
Expected: Migration applies successfully

**Step 4: Commit**

```bash
jj describe -m "feat(db): add lesson_sessions migration"
```

---

## Task 7: Lesson Session Business Logic

**Files:**
- Create: `core/lessons/sessions.py`
- Modify: `core/lessons/__init__.py`

**Step 1: Write the failing test**

```python
# core/lessons/tests/test_sessions.py
"""Tests for lesson session management."""

import pytest
from core.lessons.sessions import (
    create_session,
    get_session,
    add_message,
    advance_stage,
    SessionNotFoundError,
)


@pytest.mark.asyncio
async def test_create_session():
    """Should create a new lesson session."""
    session = await create_session(user_id=1, lesson_id="intro-to-ai-safety")
    assert session["lesson_id"] == "intro-to-ai-safety"
    assert session["current_stage_index"] == 0
    assert session["messages"] == []


@pytest.mark.asyncio
async def test_get_session():
    """Should retrieve an existing session."""
    created = await create_session(user_id=1, lesson_id="intro-to-ai-safety")
    session = await get_session(created["session_id"])
    assert session["lesson_id"] == "intro-to-ai-safety"


@pytest.mark.asyncio
async def test_add_message():
    """Should add a message to session history."""
    session = await create_session(user_id=1, lesson_id="intro-to-ai-safety")
    updated = await add_message(
        session["session_id"],
        role="user",
        content="Hello!"
    )
    assert len(updated["messages"]) == 1
    assert updated["messages"][0]["role"] == "user"


@pytest.mark.asyncio
async def test_advance_stage():
    """Should increment stage index."""
    session = await create_session(user_id=1, lesson_id="intro-to-ai-safety")
    updated = await advance_stage(session["session_id"])
    assert updated["current_stage_index"] == 1
```

**Step 2: Run test to verify it fails**

Run: `pytest core/lessons/tests/test_sessions.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

```python
# core/lessons/sessions.py
"""Lesson session management - database operations."""

from datetime import datetime, timezone

from sqlalchemy import select, update, insert

from core.database import get_connection, get_transaction
from core.tables import lesson_sessions


class SessionNotFoundError(Exception):
    """Raised when a session cannot be found."""
    pass


async def create_session(user_id: int, lesson_id: str) -> dict:
    """
    Create a new lesson session.

    Args:
        user_id: The user's database ID
        lesson_id: The lesson ID to start

    Returns:
        Dict with session data including session_id
    """
    async with get_transaction() as conn:
        result = await conn.execute(
            insert(lesson_sessions)
            .values(
                user_id=user_id,
                lesson_id=lesson_id,
                current_stage_index=0,
                messages=[],
            )
            .returning(lesson_sessions)
        )
        row = result.mappings().one()
        return dict(row)


async def get_session(session_id: int) -> dict:
    """
    Get a session by ID.

    Args:
        session_id: The session ID

    Returns:
        Dict with session data

    Raises:
        SessionNotFoundError: If session doesn't exist
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(lesson_sessions).where(lesson_sessions.c.session_id == session_id)
        )
        row = result.mappings().first()

        if not row:
            raise SessionNotFoundError(f"Session not found: {session_id}")

        return dict(row)


async def get_user_sessions(user_id: int) -> list[dict]:
    """
    Get all sessions for a user.

    Args:
        user_id: The user's database ID

    Returns:
        List of session dicts
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(lesson_sessions)
            .where(lesson_sessions.c.user_id == user_id)
            .order_by(lesson_sessions.c.last_active_at.desc())
        )
        return [dict(row) for row in result.mappings().all()]


async def add_message(session_id: int, role: str, content: str) -> dict:
    """
    Add a message to session history.

    Args:
        session_id: The session ID
        role: "user" or "assistant"
        content: Message content

    Returns:
        Updated session dict
    """
    session = await get_session(session_id)
    messages = session["messages"] + [{"role": role, "content": content}]

    async with get_transaction() as conn:
        await conn.execute(
            update(lesson_sessions)
            .where(lesson_sessions.c.session_id == session_id)
            .values(
                messages=messages,
                last_active_at=datetime.now(timezone.utc),
            )
        )

    return await get_session(session_id)


async def advance_stage(session_id: int) -> dict:
    """
    Move to the next stage.

    Args:
        session_id: The session ID

    Returns:
        Updated session dict
    """
    session = await get_session(session_id)
    new_index = session["current_stage_index"] + 1

    async with get_transaction() as conn:
        await conn.execute(
            update(lesson_sessions)
            .where(lesson_sessions.c.session_id == session_id)
            .values(
                current_stage_index=new_index,
                last_active_at=datetime.now(timezone.utc),
            )
        )

    return await get_session(session_id)


async def complete_session(session_id: int) -> dict:
    """
    Mark a session as completed.

    Args:
        session_id: The session ID

    Returns:
        Updated session dict
    """
    async with get_transaction() as conn:
        await conn.execute(
            update(lesson_sessions)
            .where(lesson_sessions.c.session_id == session_id)
            .values(
                completed_at=datetime.now(timezone.utc),
                last_active_at=datetime.now(timezone.utc),
            )
        )

    return await get_session(session_id)
```

**Step 4: Update init**

Add to `core/lessons/__init__.py`:

```python
from .sessions import (
    create_session,
    get_session,
    get_user_sessions,
    add_message,
    advance_stage,
    complete_session,
    SessionNotFoundError,
)

# Add to __all__
```

**Step 5: Run test to verify it passes**

Run: `pytest core/lessons/tests/test_sessions.py -v`
Expected: PASS (requires database connection)

**Step 6: Commit**

```bash
jj describe -m "feat(core): add lesson session management"
```

---

## Task 8: Lesson Chat with Context

**Files:**
- Create: `core/lessons/chat.py`
- Modify: `core/lessons/__init__.py`

**Step 1: Create chat module with prompt construction**

```python
# core/lessons/chat.py
"""
Lesson chat - Claude SDK integration with stage-aware prompting.
"""

import os
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from .types import Stage, ArticleStage, VideoStage, ChatStage
from .content import load_article, extract_article_section


# Tool for transitioning to next stage
TRANSITION_TOOL = {
    "name": "transition_to_next",
    "description": (
        "Call this when the conversation has reached a good stopping point "
        "and the user is ready to move to the next stage. "
        "Use this after 2-4 meaningful exchanges, or when the user indicates readiness."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}


def _build_system_prompt(
    current_stage: Stage,
    previous_stage: Stage | None,
    previous_content: str | None,
) -> str:
    """Build the system prompt based on current stage and context."""

    base = """You are a Socratic tutor helping someone learn about AI safety.

Your role:
- Ask probing questions to help them think deeply
- Challenge their assumptions constructively
- Keep responses concise (2-3 sentences typically)
- After 2-4 meaningful exchanges, use the transition_to_next tool

Do NOT:
- Give long lectures
- Simply agree with everything they say
"""

    if isinstance(current_stage, ChatStage):
        # Active chat stage - use authored context
        prompt = base + f"\n\nContext for this conversation:\n{current_stage.context}"

        if current_stage.include_previous_content and previous_content:
            prompt += f"\n\nThe user just engaged with this content:\n---\n{previous_content}\n---"

    elif isinstance(current_stage, (ArticleStage, VideoStage)):
        # User is consuming content - be helpful but brief
        content_type = "reading an article" if isinstance(current_stage, ArticleStage) else "watching a video"
        prompt = f"""You are an AI tutor. The user is currently {content_type}.

Keep responses brief - the user should focus on the content.
Answer questions if asked, but don't initiate lengthy discussion.
"""
        if previous_content:
            prompt += f"\n\nCurrent content:\n---\n{previous_content}\n---"

    else:
        prompt = base

    return prompt


def get_stage_content(stage: Stage) -> str | None:
    """Get the text content for a stage (article text or video transcript)."""

    if isinstance(stage, ArticleStage):
        try:
            full_content = load_article(stage.source_url)
            return extract_article_section(full_content, stage.from_text, stage.to_text)
        except FileNotFoundError:
            return None

    elif isinstance(stage, VideoStage):
        # TODO: Load video transcript
        return None

    return None


async def send_message(
    messages: list[dict],
    current_stage: Stage,
    previous_stage: Stage | None = None,
    previous_content: str | None = None,
) -> AsyncIterator[dict]:
    """
    Send messages to Claude and stream the response.

    Args:
        messages: List of {"role": "user"|"assistant", "content": str}
        current_stage: The current lesson stage
        previous_stage: The previous stage (for context)
        previous_content: Content from previous stage (if includePreviousContent)

    Yields:
        Dicts with either:
        - {"type": "text", "content": str} for text chunks
        - {"type": "tool_use", "name": str} for tool calls
        - {"type": "done"} when complete
    """
    client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    system = _build_system_prompt(current_stage, previous_stage, previous_content)

    # Only include transition tool for chat stages
    tools = [TRANSITION_TOOL] if isinstance(current_stage, ChatStage) else []

    async with client.messages.stream(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system,
        messages=messages,
        tools=tools if tools else None,
    ) as stream:
        async for event in stream:
            if event.type == "content_block_start":
                if event.content_block.type == "tool_use":
                    yield {"type": "tool_use", "name": event.content_block.name}
            elif event.type == "content_block_delta":
                if event.delta.type == "text_delta":
                    yield {"type": "text", "content": event.delta.text}

        yield {"type": "done"}
```

**Step 2: Update init**

Add to `core/lessons/__init__.py`:

```python
from .chat import send_message as send_lesson_message, get_stage_content
```

**Step 3: Verify imports**

Run: `python -c "from core.lessons import send_lesson_message, get_stage_content; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
jj describe -m "feat(core): add stage-aware lesson chat"
```

---

## Task 9: Lesson API Routes

**Files:**
- Create: `web_api/routes/lessons.py`
- Modify: `main.py`

**Step 1: Create lessons router**

```python
# web_api/routes/lessons.py
"""
Lesson API routes.

Endpoints:
- GET /api/lessons - List available lessons
- GET /api/lessons/{id} - Get lesson definition
- POST /api/lesson-sessions - Start a new session
- GET /api/lesson-sessions/{id} - Get session state
- POST /api/lesson-sessions/{id}/message - Send message
- POST /api/lesson-sessions/{id}/advance - Move to next stage
"""

import json
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.lessons import (
    load_lesson,
    get_available_lessons,
    LessonNotFoundError,
    create_session,
    get_session,
    add_message,
    advance_stage,
    complete_session,
    SessionNotFoundError,
    send_lesson_message,
    get_stage_content,
)
from web_api.auth import get_current_user

router = APIRouter(prefix="/api", tags=["lessons"])


# --- Lesson Definition Endpoints ---

@router.get("/lessons")
async def list_lessons():
    """List available lessons."""
    lesson_ids = get_available_lessons()
    lessons = []
    for lid in lesson_ids:
        try:
            lesson = load_lesson(lid)
            lessons.append({"id": lesson.id, "title": lesson.title})
        except LessonNotFoundError:
            pass
    return {"lessons": lessons}


@router.get("/lessons/{lesson_id}")
async def get_lesson(lesson_id: str):
    """Get a lesson definition."""
    try:
        lesson = load_lesson(lesson_id)
        return {
            "id": lesson.id,
            "title": lesson.title,
            "stages": [
                {
                    "type": s.type,
                    **({"source_url": s.source_url, "from": s.from_text, "to": s.to_text}
                       if s.type == "article" else {}),
                    **({"videoId": s.video_id, "from": s.from_seconds, "to": s.to_seconds}
                       if s.type == "video" else {}),
                    **({"context": s.context, "includePreviousContent": s.include_previous_content}
                       if s.type == "chat" else {}),
                }
                for s in lesson.stages
            ],
        }
    except LessonNotFoundError:
        raise HTTPException(status_code=404, detail="Lesson not found")


# --- Session Endpoints ---

class CreateSessionRequest(BaseModel):
    lesson_id: str


@router.post("/lesson-sessions")
async def start_session(request: CreateSessionRequest, user: dict = Depends(get_current_user)):
    """Start a new lesson session."""
    try:
        load_lesson(request.lesson_id)  # Verify lesson exists
    except LessonNotFoundError:
        raise HTTPException(status_code=404, detail="Lesson not found")

    session = await create_session(user["user_id"], request.lesson_id)
    return {"session_id": session["session_id"]}


@router.get("/lesson-sessions/{session_id}")
async def get_session_state(session_id: int, user: dict = Depends(get_current_user)):
    """Get current session state."""
    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your session")

    # Load lesson to include stage info
    lesson = load_lesson(session["lesson_id"])
    current_stage = lesson.stages[session["current_stage_index"]] if session["current_stage_index"] < len(lesson.stages) else None

    return {
        "session_id": session["session_id"],
        "lesson_id": session["lesson_id"],
        "lesson_title": lesson.title,
        "current_stage_index": session["current_stage_index"],
        "total_stages": len(lesson.stages),
        "current_stage": {
            "type": current_stage.type,
            **({"source_url": current_stage.source_url, "from": current_stage.from_text, "to": current_stage.to_text}
               if current_stage and current_stage.type == "article" else {}),
            **({"videoId": current_stage.video_id, "from": current_stage.from_seconds, "to": current_stage.to_seconds}
               if current_stage and current_stage.type == "video" else {}),
        } if current_stage else None,
        "messages": session["messages"],
        "completed": session["completed_at"] is not None,
    }


class SendMessageRequest(BaseModel):
    content: str


@router.post("/lesson-sessions/{session_id}/message")
async def send_message_endpoint(
    session_id: int,
    request: SendMessageRequest,
    user: dict = Depends(get_current_user),
):
    """Send a message and stream the response."""
    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your session")

    # Load lesson and current stage
    lesson = load_lesson(session["lesson_id"])
    stage_index = session["current_stage_index"]
    current_stage = lesson.stages[stage_index]
    previous_stage = lesson.stages[stage_index - 1] if stage_index > 0 else None

    # Get previous content if needed
    previous_content = None
    if previous_stage:
        previous_content = get_stage_content(previous_stage)

    # Add user message to session
    await add_message(session_id, "user", request.content)

    # Build messages list
    messages = session["messages"] + [{"role": "user", "content": request.content}]

    async def event_generator():
        assistant_content = ""
        try:
            async for chunk in send_lesson_message(
                messages, current_stage, previous_stage, previous_content
            ):
                if chunk["type"] == "text":
                    assistant_content += chunk["content"]
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Save assistant response
            if assistant_content:
                await add_message(session_id, "assistant", assistant_content)
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/lesson-sessions/{session_id}/advance")
async def advance_session(session_id: int, user: dict = Depends(get_current_user)):
    """Move to the next stage."""
    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your session")

    lesson = load_lesson(session["lesson_id"])

    if session["current_stage_index"] >= len(lesson.stages) - 1:
        # Complete the session
        await complete_session(session_id)
        return {"completed": True}

    await advance_stage(session_id)
    return {"completed": False, "new_stage_index": session["current_stage_index"] + 1}
```

**Step 2: Add router to main.py**

Add import:
```python
from web_api.routes.lessons import router as lessons_router
```

Add include:
```python
app.include_router(lessons_router)
```

**Step 3: Add SPA route**

Add to the SPA routes section:
```python
@app.get("/lesson/{lesson_id}")
async def spa_lesson():
    """Serve React SPA for lesson page."""
    return FileResponse(spa_path / "index.html")
```

**Step 4: Verify routes**

Run: `python main.py --no-bot --port 8000 &`
Run: `curl http://localhost:8000/api/lessons`
Expected: JSON response with lessons array

**Step 5: Commit**

```bash
jj describe -m "feat(api): add lesson and session endpoints"
```

---

## Task 10: Frontend Types

**Files:**
- Create: `web_frontend/src/types/unified-lesson.ts`

**Step 1: Create TypeScript types**

```typescript
// web_frontend/src/types/unified-lesson.ts
/**
 * Types for unified lesson feature.
 */

export type ArticleStage = {
  type: "article";
  source_url: string;
  from: string | null;
  to: string | null;
};

export type VideoStage = {
  type: "video";
  videoId: string;
  from: number;
  to: number | null;
};

export type ChatStage = {
  type: "chat";
  context: string;
  includePreviousContent: boolean;
};

export type Stage = ArticleStage | VideoStage | ChatStage;

export type Lesson = {
  id: string;
  title: string;
  stages: Stage[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SessionState = {
  session_id: number;
  lesson_id: string;
  lesson_title: string;
  current_stage_index: number;
  total_stages: number;
  current_stage: Stage | null;
  messages: ChatMessage[];
  completed: boolean;
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(frontend): add unified lesson types"
```

---

## Task 11: Frontend API Client

**Files:**
- Create: `web_frontend/src/api/lessons.ts`

**Step 1: Create API client**

```typescript
// web_frontend/src/api/lessons.ts
/**
 * API client for lesson endpoints.
 */

import type { Lesson, SessionState } from "../types/unified-lesson";

const API_BASE = "";

export async function listLessons(): Promise<{ id: string; title: string }[]> {
  const res = await fetch(`${API_BASE}/api/lessons`);
  if (!res.ok) throw new Error("Failed to fetch lessons");
  const data = await res.json();
  return data.lessons;
}

export async function getLesson(lessonId: string): Promise<Lesson> {
  const res = await fetch(`${API_BASE}/api/lessons/${lessonId}`);
  if (!res.ok) throw new Error("Failed to fetch lesson");
  return res.json();
}

export async function createSession(lessonId: string): Promise<number> {
  const res = await fetch(`${API_BASE}/api/lesson-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ lesson_id: lessonId }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  const data = await res.json();
  return data.session_id;
}

export async function getSession(sessionId: number): Promise<SessionState> {
  const res = await fetch(`${API_BASE}/api/lesson-sessions/${sessionId}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch session");
  return res.json();
}

export async function advanceStage(
  sessionId: number
): Promise<{ completed: boolean; new_stage_index?: number }> {
  const res = await fetch(
    `${API_BASE}/api/lesson-sessions/${sessionId}/advance`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  if (!res.ok) throw new Error("Failed to advance stage");
  return res.json();
}

export async function* sendMessage(
  sessionId: number,
  content: string
): AsyncGenerator<{ type: string; content?: string; name?: string }> {
  const res = await fetch(
    `${API_BASE}/api/lesson-sessions/${sessionId}/message`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ content }),
    }
  );

  if (!res.ok) throw new Error("Failed to send message");

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        yield data;
      } catch {
        // Skip invalid JSON
      }
    }
  }
}
```

**Step 2: Commit**

```bash
jj describe -m "feat(frontend): add lesson API client"
```

---

## Task 12: ChatPanel Component

**Files:**
- Create: `web_frontend/src/components/unified-lesson/ChatPanel.tsx`

**Step 1: Create ChatPanel component**

```typescript
// web_frontend/src/components/unified-lesson/ChatPanel.tsx
import { useState, useRef, useEffect } from "react";
import type { ChatMessage, Stage } from "../../types/unified-lesson";

type ChatPanelProps = {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  isLoading: boolean;
  streamingContent: string;
  currentStage: Stage | null;
  pendingTransition: boolean;
  onConfirmTransition: () => void;
  onContinueChatting: () => void;
  disabled?: boolean;
};

export default function ChatPanel({
  messages,
  onSendMessage,
  isLoading,
  streamingContent,
  currentStage,
  pendingTransition,
  onConfirmTransition,
  onContinueChatting,
  disabled = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading && !disabled) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  const isContentStage = currentStage?.type === "article" || currentStage?.type === "video";

  return (
    <div className={`flex flex-col h-full ${isContentStage ? "opacity-60" : ""}`}>
      {/* Header indicator for content stages */}
      {isContentStage && (
        <div className="bg-gray-100 px-4 py-2 text-sm text-gray-600 border-b">
          {currentStage.type === "article" ? "Reading article..." : "Watching video..."}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg ${
              msg.role === "assistant"
                ? "bg-blue-50 text-gray-800"
                : "bg-gray-100 text-gray-800 ml-8"
            }`}
          >
            <div className="text-xs text-gray-500 mb-1">
              {msg.role === "assistant" ? "Tutor" : "You"}
            </div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}

        {/* Streaming message */}
        {isLoading && streamingContent && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Tutor</div>
            <div className="whitespace-pre-wrap">{streamingContent}</div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streamingContent && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Tutor</div>
            <div className="text-gray-500">Thinking...</div>
          </div>
        )}

        {/* Transition prompt */}
        {pendingTransition && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
            <p className="text-yellow-800 mb-3">Ready to continue to the next part?</p>
            <div className="flex gap-2">
              <button
                onClick={onConfirmTransition}
                className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
              >
                Continue
              </button>
              <button
                onClick={onContinueChatting}
                className="bg-white text-yellow-700 px-4 py-2 rounded border border-yellow-300 hover:bg-yellow-50"
              >
                Keep chatting
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-gray-200">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? "Move to a chat section to discuss..." : "Type your response..."}
          disabled={isLoading || disabled}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim() || disabled}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj describe -m "feat(frontend): add ChatPanel component"
```

---

## Task 13: ContentPanel Component

**Files:**
- Create: `web_frontend/src/components/unified-lesson/ContentPanel.tsx`

**Step 1: Create ContentPanel component**

```typescript
// web_frontend/src/components/unified-lesson/ContentPanel.tsx
import type { Stage } from "../../types/unified-lesson";
import ArticlePanel from "../article/ArticlePanel";
import VideoPlayer from "../lesson/VideoPlayer";

type ContentPanelProps = {
  stage: Stage | null;
  articleContent?: string;
  onVideoEnded: () => void;
  onNextClick: () => void;
};

export default function ContentPanel({
  stage,
  articleContent,
  onVideoEnded,
  onNextClick,
}: ContentPanelProps) {
  if (!stage) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Lesson complete!</p>
      </div>
    );
  }

  if (stage.type === "chat") {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 p-8">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">💬</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Discussion Time</h2>
          <p className="text-gray-600 mb-6">
            Use the chat on the left to discuss what you've learned.
          </p>
          <button
            onClick={onNextClick}
            className="text-gray-500 hover:text-gray-700 underline text-sm"
          >
            Skip to next section
          </button>
        </div>
      </div>
    );
  }

  if (stage.type === "article") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ArticlePanel
            content={articleContent || "Loading..."}
            blurred={false}
          />
        </div>
        <div className="p-4 border-t bg-white">
          <button
            onClick={onNextClick}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (stage.type === "video") {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <VideoPlayer
          videoId={stage.videoId}
          start={stage.from}
          end={stage.to || 9999}
          onEnded={onVideoEnded}
          onSkip={onNextClick}
        />
      </div>
    );
  }

  return null;
}
```

**Step 2: Commit**

```bash
jj describe -m "feat(frontend): add ContentPanel component"
```

---

## Task 14: UnifiedLesson Page

**Files:**
- Create: `web_frontend/src/pages/UnifiedLesson.tsx`

**Step 1: Create the main page component**

```typescript
// web_frontend/src/pages/UnifiedLesson.tsx
import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import type { SessionState, ChatMessage } from "../types/unified-lesson";
import { createSession, getSession, advanceStage, sendMessage } from "../api/lessons";
import ChatPanel from "../components/unified-lesson/ChatPanel";
import ContentPanel from "../components/unified-lesson/ContentPanel";

export default function UnifiedLesson() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingTransition, setPendingTransition] = useState(false);
  const [articleContent, setArticleContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Initialize session
  useEffect(() => {
    if (!lessonId) return;

    async function init() {
      try {
        const sid = await createSession(lessonId);
        setSessionId(sid);
        const state = await getSession(sid);
        setSession(state);
        setMessages(state.messages);

        // Load initial article content if needed
        if (state.current_stage?.type === "article") {
          await loadArticleContent(state.current_stage.source_url);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start lesson");
      }
    }

    init();
  }, [lessonId]);

  const loadArticleContent = async (sourceUrl: string) => {
    try {
      // For now, just show placeholder - actual content loading TBD
      setArticleContent("Loading article content...");
    } catch (e) {
      console.error("Failed to load article:", e);
    }
  };

  const handleSendMessage = useCallback(async (content: string) => {
    if (!sessionId) return;

    const userMessage: ChatMessage = { role: "user", content };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingContent("");
    setPendingTransition(false);

    try {
      let assistantContent = "";
      let shouldTransition = false;

      for await (const chunk of sendMessage(sessionId, content)) {
        if (chunk.type === "text" && chunk.content) {
          assistantContent += chunk.content;
          setStreamingContent(assistantContent);
        } else if (chunk.type === "tool_use" && chunk.name === "transition_to_next") {
          shouldTransition = true;
        }
      }

      setMessages(prev => [...prev, { role: "assistant", content: assistantContent }]);
      setStreamingContent("");

      if (shouldTransition) {
        setPendingTransition(true);
      }
    } catch (e) {
      setMessages(prev => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const handleAdvanceStage = useCallback(async () => {
    if (!sessionId) return;

    try {
      const result = await advanceStage(sessionId);
      setPendingTransition(false);

      if (result.completed) {
        setSession(prev => prev ? { ...prev, completed: true, current_stage: null } : null);
      } else {
        const state = await getSession(sessionId);
        setSession(state);

        if (state.current_stage?.type === "article") {
          await loadArticleContent(state.current_stage.source_url);
        }
      }
    } catch (e) {
      console.error("Failed to advance:", e);
    }
  }, [sessionId]);

  const handleContinueChatting = useCallback(() => {
    setPendingTransition(false);
  }, []);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/" className="text-blue-600 hover:underline">Go home</a>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading lesson...</p>
      </div>
    );
  }

  const isChatStage = session.current_stage?.type === "chat";

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{session.lesson_title}</h1>
          <p className="text-sm text-gray-500">
            Stage {session.current_stage_index + 1} of {session.total_stages}
          </p>
        </div>
        {!isChatStage && (
          <button
            onClick={handleAdvanceStage}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            Skip →
          </button>
        )}
      </header>

      {/* Main content - split panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat panel - left */}
        <div className="w-1/2 border-r border-gray-200 bg-white">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            streamingContent={streamingContent}
            currentStage={session.current_stage}
            pendingTransition={pendingTransition}
            onConfirmTransition={handleAdvanceStage}
            onContinueChatting={handleContinueChatting}
            disabled={!isChatStage}
          />
        </div>

        {/* Content panel - right */}
        <div className="w-1/2 bg-white">
          <ContentPanel
            stage={session.current_stage}
            articleContent={articleContent}
            onVideoEnded={handleAdvanceStage}
            onNextClick={handleAdvanceStage}
          />
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj describe -m "feat(frontend): add UnifiedLesson page"
```

---

## Task 15: Add Route to React Router

**Files:**
- Modify: `web_frontend/src/App.tsx` (or router config)

**Step 1: Add route**

Find the router configuration and add:

```typescript
import UnifiedLesson from "./pages/UnifiedLesson";

// In routes:
{
  path: "/lesson/:lessonId",
  element: <UnifiedLesson />,
}
```

**Step 2: Verify route works**

Start dev server and navigate to `/lesson/intro-to-ai-safety`

**Step 3: Commit**

```bash
jj describe -m "feat(frontend): add unified lesson route"
```

---

## Task 16: Integration Testing

**Files:**
- Manual testing checklist

**Step 1: Start the server**

```bash
python main.py --dev --no-bot
```

**Step 2: Test the flow**

1. Navigate to `/lesson/intro-to-ai-safety`
2. Verify session is created (check console/network)
3. Verify article content shows on right
4. Click "Continue" to move to chat stage
5. Send a message, verify streaming response
6. Verify transition prompt appears
7. Click "Continue" to move to video stage
8. Verify video plays
9. Click "Continue" when prompted
10. Verify lesson completes

**Step 3: Commit final integration**

```bash
jj describe -m "feat: complete unified lesson page implementation"
```

---

## Summary of Files Created/Modified

**Created:**
- `core/lessons/types.py`
- `core/lessons/__init__.py`
- `core/lessons/loader.py`
- `core/lessons/content.py`
- `core/lessons/sessions.py`
- `core/lessons/chat.py`
- `core/lessons/tests/test_loader.py`
- `core/lessons/tests/test_content.py`
- `core/content/lessons/intro-to-ai-safety.json`
- `core/content/articles/four-background-claims.md`
- `web_api/routes/lessons.py`
- `web_frontend/src/types/unified-lesson.ts`
- `web_frontend/src/api/lessons.ts`
- `web_frontend/src/components/unified-lesson/ChatPanel.tsx`
- `web_frontend/src/components/unified-lesson/ContentPanel.tsx`
- `web_frontend/src/pages/UnifiedLesson.tsx`
- `alembic/versions/*_add_lesson_sessions.py`

**Modified:**
- `core/tables.py`
- `main.py`
- `web_frontend/src/App.tsx` (router)
