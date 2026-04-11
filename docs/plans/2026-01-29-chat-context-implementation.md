# Chat Context Restoration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore chat context so the AI tutor receives video transcripts and article content when users chat, with backend owning chat history.

**Architecture:** Frontend sends position (slug, sectionIndex, segmentIndex) + message. Backend loads module, retrieves/updates chat session from DB, gathers preceding segment content, builds system prompt, calls LLM, and saves response.

**Tech Stack:** Python/FastAPI (backend), TypeScript/React (frontend), PostgreSQL (chat_sessions table), pytest (testing)

---

## Task 1: Fix bundle_article_section show*/hide* Inconsistency

**Files:**
- Modify: `core/modules/content.py:658-666`
- Modify: `core/modules/tests/test_bundle_article_section.py:219-236`

**Step 1: Write the failing test**

Add a test that verifies `hide*` fields are present (not `show*` fields).

```python
# Add to test_bundle_article_section.py after test_full_article_no_excerpts

def test_chat_segment_uses_hide_fields(self):
    """Chat segments should use hidePreviousContentFromUser/Tutor, not show* fields."""
    section = ArticleSection(
        source=TEST_ARTICLE_SOURCE,
        segments=[
            ArticleExcerptSegment(from_text="A", to_text="B"),
            ChatSegment(
                instructions="Discuss this",
                hide_previous_content_from_user=True,
                hide_previous_content_from_tutor=False,
            ),
        ],
    )

    result = bundle_article_section(section)

    chat_seg = result["segments"][1]
    assert chat_seg["type"] == "chat"
    # Should have hide* fields, not show* fields
    assert "hidePreviousContentFromUser" in chat_seg
    assert "hidePreviousContentFromTutor" in chat_seg
    assert chat_seg["hidePreviousContentFromUser"] is True
    assert chat_seg["hidePreviousContentFromTutor"] is False
    # Should NOT have show* fields
    assert "showUserPreviousContent" not in chat_seg
    assert "showTutorPreviousContent" not in chat_seg
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_bundle_article_section.py::TestBundleArticleSection::test_chat_segment_uses_hide_fields -v`

Expected: FAIL with `AssertionError` (show* fields present instead of hide* fields)

**Step 3: Write minimal implementation**

Edit `core/modules/content.py` lines 658-666. Change:

```python
        elif isinstance(seg, (ChatSegment, LensChatSegment)):
            bundled_segments.append(
                {
                    "type": "chat",
                    "instructions": seg.instructions,
                    "hidePreviousContentFromUser": seg.hide_previous_content_from_user,
                    "hidePreviousContentFromTutor": seg.hide_previous_content_from_tutor,
                }
            )
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_bundle_article_section.py::TestBundleArticleSection::test_chat_segment_uses_hide_fields -v`

Expected: PASS

**Step 5: Run all bundle_article_section tests**

Run: `pytest core/modules/tests/test_bundle_article_section.py -v`

Expected: All PASS

**Step 6: Commit**

```bash
jj describe -m "fix: standardize chat segment fields to hide* in bundle_article_section"
```

---

## Task 2: Add gather_section_context Function

**Files:**
- Create: `core/modules/context.py`
- Create: `core/modules/tests/test_context.py`

**Step 1: Write the failing test**

Create `core/modules/tests/test_context.py`:

```python
# core/modules/tests/test_context.py
"""Tests for context gathering from module sections."""

import pytest

from core.modules.context import gather_section_context


class TestGatherSectionContext:
    """Tests for gather_section_context()."""

    def test_gathers_video_transcript(self):
        """Should include video-excerpt transcript in context."""
        section = {
            "type": "video",
            "segments": [
                {"type": "video-excerpt", "transcript": "Hello world from video"},
                {"type": "chat", "instructions": "Discuss", "hidePreviousContentFromTutor": False},
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is not None
        assert "Hello world from video" in context
        assert "[Video transcript]" in context

    def test_gathers_article_content(self):
        """Should include article-excerpt content in context."""
        section = {
            "type": "article",
            "segments": [
                {"type": "article-excerpt", "content": "Article content here"},
                {"type": "chat", "instructions": "Discuss", "hidePreviousContentFromTutor": False},
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is not None
        assert "Article content here" in context

    def test_gathers_text_content(self):
        """Should include text segment content in context."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Some authored text"},
                {"type": "chat", "instructions": "Discuss", "hidePreviousContentFromTutor": False},
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is not None
        assert "Some authored text" in context

    def test_respects_hide_from_tutor_flag(self):
        """Should return None when hidePreviousContentFromTutor is True."""
        section = {
            "type": "video",
            "segments": [
                {"type": "video-excerpt", "transcript": "Secret content"},
                {"type": "chat", "instructions": "Discuss", "hidePreviousContentFromTutor": True},
            ],
        }

        context = gather_section_context(section, segment_index=1)

        assert context is None

    def test_multiple_preceding_segments(self):
        """Should gather all preceding segments separated by dividers."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "First text"},
                {"type": "article-excerpt", "content": "Article bit"},
                {"type": "text", "content": "Second text"},
                {"type": "chat", "instructions": "Discuss", "hidePreviousContentFromTutor": False},
            ],
        }

        context = gather_section_context(section, segment_index=3)

        assert context is not None
        assert "First text" in context
        assert "Article bit" in context
        assert "Second text" in context
        assert "---" in context  # Divider between segments

    def test_skips_chat_segments_in_context(self):
        """Should not include previous chat segments in content context."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Intro text"},
                {"type": "chat", "instructions": "First discussion"},
                {"type": "text", "content": "More text"},
                {"type": "chat", "instructions": "Second discussion", "hidePreviousContentFromTutor": False},
            ],
        }

        context = gather_section_context(section, segment_index=3)

        assert context is not None
        assert "Intro text" in context
        assert "More text" in context
        assert "First discussion" not in context

    def test_empty_preceding_returns_none(self):
        """Should return None when there are no preceding content segments."""
        section = {
            "type": "page",
            "segments": [
                {"type": "chat", "instructions": "Start chatting", "hidePreviousContentFromTutor": False},
            ],
        }

        context = gather_section_context(section, segment_index=0)

        assert context is None

    def test_segment_index_out_of_bounds(self):
        """Should handle segment_index gracefully when out of bounds."""
        section = {
            "type": "article",
            "segments": [
                {"type": "text", "content": "Only segment"},
            ],
        }

        # Index 5 is out of bounds
        context = gather_section_context(section, segment_index=5)

        assert context is None

    def test_skips_empty_transcripts(self):
        """Should skip video-excerpt segments with empty transcripts."""
        section = {
            "type": "video",
            "segments": [
                {"type": "video-excerpt", "transcript": ""},
                {"type": "video-excerpt", "transcript": "Actual content"},
                {"type": "chat", "instructions": "Discuss", "hidePreviousContentFromTutor": False},
            ],
        }

        context = gather_section_context(section, segment_index=2)

        assert context is not None
        assert "Actual content" in context
        # Empty transcript should not add extra dividers
        assert context.count("---") == 0  # Only one segment with content, no dividers needed
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_context.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'core.modules.context'`

**Step 3: Write minimal implementation**

Create `core/modules/context.py`:

```python
# core/modules/context.py
"""Context gathering for chat sessions."""


def gather_section_context(section: dict, segment_index: int) -> str | None:
    """Gather content from preceding segments for chat context.

    Args:
        section: A flattened module section dict with "segments" list
        segment_index: Index of the current chat segment

    Returns:
        Formatted context string, or None if:
        - hidePreviousContentFromTutor is True on current segment
        - No content segments precede the current segment
        - segment_index is out of bounds
    """
    segments = section.get("segments", [])

    # Handle out of bounds
    if segment_index >= len(segments) or segment_index < 0:
        return None

    current_segment = segments[segment_index]

    # Check if this chat hides previous content
    if current_segment.get("hidePreviousContentFromTutor"):
        return None

    # Gather content from segments 0 to segment_index-1
    parts = []
    for i in range(segment_index):
        seg = segments[i]
        seg_type = seg.get("type")

        if seg_type == "text":
            content = seg.get("content", "")
            if content:
                parts.append(content)

        elif seg_type == "video-excerpt":
            transcript = seg.get("transcript", "")
            if transcript:
                parts.append(f"[Video transcript]\n{transcript}")

        elif seg_type == "article-excerpt":
            content = seg.get("content", "")
            if content:
                parts.append(content)

        # Skip chat segments - history captures those

    return "\n\n---\n\n".join(parts) if parts else None
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_context.py -v`

Expected: All PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add gather_section_context for chat context building"
```

---

## Task 3: Add GET /api/chat/module/{slug}/history Endpoint

**Files:**
- Modify: `web_api/routes/module.py`
- Create: `web_api/tests/test_chat_history.py`

**Step 1: Write the failing test**

Create `web_api/tests/test_chat_history.py`:

```python
# web_api/tests/test_chat_history.py
"""Tests for chat history endpoint."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def mock_auth():
    """Mock authentication to return a test user."""
    # Patch at web_api.auth since that's where get_optional_user is defined
    # The implementation imports it, so we need to patch where it's looked up
    with patch("web_api.auth.get_optional_user") as mock:
        mock.return_value = {"sub": "123456789", "username": "testuser"}
        yield mock


@pytest.fixture
def mock_db_user():
    """Mock database user lookup."""
    # Patch at core.queries.users since that's where it's defined
    with patch("core.queries.users.get_user_by_discord_id") as mock:
        mock.return_value = {"user_id": 1, "discord_id": "123456789"}
        yield mock


@pytest.fixture
def mock_module():
    """Mock module loading."""
    mock_mod = MagicMock()
    mock_mod.content_id = uuid.uuid4()
    mock_mod.slug = "test-module"
    mock_mod.title = "Test Module"
    mock_mod.sections = []

    with patch("web_api.routes.module.load_flattened_module") as mock:
        mock.return_value = mock_mod
        yield mock, mock_mod


@pytest.fixture
def mock_chat_session():
    """Mock chat session retrieval."""
    with patch("web_api.routes.module.get_or_create_chat_session") as mock:
        mock.return_value = {
            "session_id": 1,
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi there!"},
            ],
        }
        yield mock


class TestGetChatHistory:
    """Tests for GET /api/chat/module/{slug}/history."""

    def test_returns_chat_history(
        self, client, mock_auth, mock_db_user, mock_module, mock_chat_session
    ):
        """Should return chat history for authenticated user."""
        response = client.get("/api/chat/module/test-module/history")

        assert response.status_code == 200
        data = response.json()
        assert "sessionId" in data
        assert "messages" in data
        assert len(data["messages"]) == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][0]["content"] == "Hello"

    def test_returns_401_when_not_authenticated(self, client, mock_module):
        """Should return 401 when user is not authenticated."""
        with patch("web_api.auth.get_optional_user") as mock:
            mock.return_value = None
            response = client.get("/api/chat/module/test-module/history")

        assert response.status_code == 401

    def test_returns_404_for_unknown_module(self, client, mock_auth):
        """Should return 404 for unknown module slug."""
        from core.modules import ModuleNotFoundError

        with patch("web_api.routes.module.load_flattened_module") as mock:
            mock.side_effect = ModuleNotFoundError("not-found")
            response = client.get("/api/chat/module/not-found/history")

        assert response.status_code == 404

    def test_works_with_anonymous_token(self, client, mock_module, mock_chat_session):
        """Should work with X-Anonymous-Token header for anonymous users."""
        _, _ = mock_module  # Unpack fixture to ensure it's used
        anon_token = str(uuid.uuid4())

        with patch("web_api.auth.get_optional_user") as mock_auth:
            mock_auth.return_value = None
            response = client.get(
                "/api/chat/module/test-module/history",
                headers={"X-Anonymous-Token": anon_token},
            )

        assert response.status_code == 200

    def test_returns_empty_messages_for_new_session(
        self, client, mock_auth, mock_db_user, mock_module
    ):
        """Should return empty messages array for new chat session."""
        with patch("web_api.routes.module.get_or_create_chat_session") as mock:
            mock.return_value = {"session_id": 1, "messages": []}
            response = client.get("/api/chat/module/test-module/history")

        assert response.status_code == 200
        data = response.json()
        assert data["messages"] == []
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_chat_history.py -v`

Expected: FAIL with `404 Not Found` (endpoint doesn't exist)

**Step 3: Write minimal implementation**

Add to `web_api/routes/module.py`:

```python
"""
Module chat API routes.

Endpoints:
- POST /api/chat/module - Send message and stream response
- GET /api/chat/module/{slug}/history - Get chat history for a module
"""

import json
import sys
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.modules.chat import send_module_message
from core.modules.types import ChatStage
from core.modules.loader import load_flattened_module
from core.modules.chat_sessions import get_or_create_chat_session
from core.modules import ModuleNotFoundError
from core.database import get_connection
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/chat", tags=["module"])


# ... existing ChatMessage, ModuleChatRequest, event_generator, chat_module ...


class ChatHistoryResponse(BaseModel):
    """Response for chat history endpoint."""

    sessionId: int
    messages: list[dict]


@router.get("/module/{slug}/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    slug: str,
    request: Request,
    x_anonymous_token: str | None = Header(None),
):
    """
    Get chat history for a module.

    Returns the chat session messages for the current user/anonymous token.
    Creates a new empty session if none exists.
    """
    # Get user or anonymous token
    user = await get_optional_user(request)
    user_id = None
    anonymous_token = None

    if user:
        # Look up database user_id from Discord ID
        async with get_connection() as conn:
            db_user = await get_user_by_discord_id(conn, user["sub"])
            if db_user:
                user_id = db_user["user_id"]

    if not user_id and x_anonymous_token:
        try:
            anonymous_token = UUID(x_anonymous_token)
        except ValueError:
            pass

    if not user_id and not anonymous_token:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Load module to get content_id
    try:
        module = load_flattened_module(slug)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")

    # Get or create chat session
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module.content_id,
            content_type="module",
        )

    return ChatHistoryResponse(
        sessionId=session["session_id"],
        messages=session.get("messages", []),
    )
```

**Step 4: Run test to verify it passes**

Run: `pytest web_api/tests/test_chat_history.py -v`

Expected: All PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add GET /api/chat/module/{slug}/history endpoint"
```

---

## Task 4: Modify POST /api/chat/module Endpoint

**Files:**
- Modify: `web_api/routes/module.py`
- Create: `web_api/tests/test_chat_module.py`

**Step 1: Write the failing test**

Create `web_api/tests/test_chat_module.py`:

```python
# web_api/tests/test_chat_module.py
"""Tests for POST /api/chat/module endpoint."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch, AsyncIterator

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def mock_auth():
    """Mock authentication."""
    # Patch at web_api.auth since that's where get_current_user is defined
    with patch("web_api.auth.get_current_user") as mock:
        mock.return_value = {"sub": "123456789", "username": "testuser"}
        yield mock


@pytest.fixture
def mock_db_user():
    """Mock database user lookup."""
    # Patch at core.queries.users since that's where it's defined
    with patch("core.queries.users.get_user_by_discord_id") as mock:
        mock.return_value = {"user_id": 1, "discord_id": "123456789"}
        yield mock


@pytest.fixture
def mock_module():
    """Mock module loading with segments."""
    mock_mod = MagicMock()
    mock_mod.content_id = uuid.uuid4()
    mock_mod.slug = "test-module"
    mock_mod.sections = [
        {
            "type": "video",
            "segments": [
                {"type": "video-excerpt", "transcript": "Video content here"},
                {"type": "chat", "instructions": "Discuss the video", "hidePreviousContentFromTutor": False},
            ],
        }
    ]

    with patch("web_api.routes.module.load_flattened_module") as mock:
        mock.return_value = mock_mod
        yield mock, mock_mod


@pytest.fixture
def mock_chat_session():
    """Mock chat session operations."""
    session = {"session_id": 1, "messages": []}

    # Mock at module level for get_or_create (imported at top)
    # Mock at original location for add_chat_message (imported inside function)
    with patch("web_api.routes.module.get_or_create_chat_session") as get_mock, \
         patch("core.modules.chat_sessions.add_chat_message") as add_mock:
        get_mock.return_value = session
        yield get_mock, add_mock


@pytest.fixture
def mock_llm():
    """Mock LLM streaming response."""
    async def mock_stream(*args, **kwargs):
        yield {"type": "text", "content": "Hello "}
        yield {"type": "text", "content": "there!"}
        yield {"type": "done"}

    with patch("web_api.routes.module.send_module_message") as mock:
        # Use side_effect to create fresh generator each call (return_value exhausts after first use)
        mock.side_effect = lambda *a, **kw: mock_stream()
        yield mock


class TestPostChatModule:
    """Tests for POST /api/chat/module."""

    def test_accepts_new_request_format(
        self, client, mock_auth, mock_db_user, mock_module, mock_chat_session, mock_llm
    ):
        """Should accept slug, sectionIndex, segmentIndex, message."""
        response = client.post(
            "/api/chat/module",
            json={
                "slug": "test-module",
                "sectionIndex": 0,
                "segmentIndex": 1,
                "message": "What does this mean?",
            },
        )

        assert response.status_code == 200
        # SSE response
        assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

    def test_saves_user_message_to_session(
        self, client, mock_auth, mock_db_user, mock_module, mock_chat_session, mock_llm
    ):
        """Should save user message to chat session."""
        get_mock, add_mock = mock_chat_session

        response = client.post(
            "/api/chat/module",
            json={
                "slug": "test-module",
                "sectionIndex": 0,
                "segmentIndex": 1,
                "message": "My question",
            },
        )

        # Consume response to trigger the generator
        list(response.iter_lines())

        # Verify add_chat_message was called with user message
        calls = add_mock.call_args_list
        user_call = [c for c in calls if c.kwargs.get("role") == "user"]
        assert len(user_call) >= 1
        assert user_call[0].kwargs["content"] == "My question"

    def test_builds_context_from_position(
        self, client, mock_auth, mock_db_user, mock_module, mock_chat_session, mock_llm
    ):
        """Should build context using gather_section_context."""
        with patch("web_api.routes.module.gather_section_context") as ctx_mock:
            ctx_mock.return_value = "Video content here"

            response = client.post(
                "/api/chat/module",
                json={
                    "slug": "test-module",
                    "sectionIndex": 0,
                    "segmentIndex": 1,
                    "message": "Question",
                },
            )
            list(response.iter_lines())

            # Verify context was gathered
            ctx_mock.assert_called_once()
            call_args = ctx_mock.call_args
            assert call_args[0][1] == 1  # segment_index

    def test_returns_401_when_not_authenticated(self, client, mock_module):
        """Should return 401 for unauthenticated requests."""
        with patch("web_api.auth.get_current_user") as mock:
            mock.side_effect = HTTPException(status_code=401, detail="Not authenticated")
            response = client.post(
                "/api/chat/module",
                json={
                    "slug": "test-module",
                    "sectionIndex": 0,
                    "segmentIndex": 1,
                    "message": "Hello",
                },
            )

        assert response.status_code == 401

    def test_returns_404_for_unknown_module(self, client, mock_auth):
        """Should return 404 for unknown module slug."""
        from core.modules import ModuleNotFoundError

        with patch("web_api.routes.module.load_flattened_module") as mock:
            mock.side_effect = ModuleNotFoundError("unknown")
            response = client.post(
                "/api/chat/module",
                json={
                    "slug": "unknown",
                    "sectionIndex": 0,
                    "segmentIndex": 0,
                    "message": "Hello",
                },
            )

        assert response.status_code == 404
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_chat_module.py::TestPostChatModule::test_accepts_new_request_format -v`

Expected: FAIL (old request format doesn't have slug, sectionIndex, segmentIndex)

**Step 3: Write minimal implementation**

Replace the POST endpoint in `web_api/routes/module.py`:

```python
class ModuleChatRequest(BaseModel):
    """Request body for module chat."""

    slug: str
    sectionIndex: int
    segmentIndex: int
    message: str


async def event_generator(
    user_id: int | None,
    anonymous_token: UUID | None,
    module,
    section_index: int,
    segment_index: int,
    user_message: str,
):
    """Generate SSE events from chat interaction."""
    from core.modules.context import gather_section_context
    from core.modules.chat_sessions import add_chat_message

    # Get or create chat session
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module.content_id,
            content_type="module",
        )
        session_id = session["session_id"]
        existing_messages = session.get("messages", [])

        # Save user message
        if user_message:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="user",
                content=user_message,
            )

    # Get section and gather context
    section = module.sections[section_index] if section_index < len(module.sections) else {}
    previous_content = gather_section_context(section, segment_index)

    # Get chat instructions from segment
    segments = section.get("segments", [])
    current_segment = segments[segment_index] if segment_index < len(segments) else {}
    instructions = current_segment.get("instructions", "Help the user learn about AI safety.")

    # Build messages for LLM (existing history + new message)
    llm_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in existing_messages
        if m["role"] in ("user", "assistant")
    ]
    if user_message:
        llm_messages.append({"role": "user", "content": user_message})

    # Create chat stage
    stage = ChatStage(
        type="chat",
        instructions=instructions,
    )

    # Stream response
    assistant_content = ""
    try:
        async for chunk in send_module_message(
            llm_messages, stage, None, previous_content
        ):
            if chunk.get("type") == "text":
                assistant_content += chunk.get("content", "")
            yield f"data: {json.dumps(chunk)}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    # Save assistant response
    if assistant_content:
        async with get_connection() as conn:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="assistant",
                content=assistant_content,
            )


@router.post("/module")
async def chat_module(
    request: ModuleChatRequest,
    user: dict = Depends(get_current_user),
):
    """
    Send a message to the module chat and stream the response.

    Request body:
    - slug: Module identifier
    - sectionIndex: Current section (0-indexed)
    - segmentIndex: Current segment within section (0-indexed)
    - message: User's message

    Returns Server-Sent Events with:
    - {"type": "text", "content": "..."} for text chunks
    - {"type": "done"} when complete
    - {"type": "error", "message": "..."} on error
    """
    # Get database user_id
    user_id = None
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, user["sub"])
        if db_user:
            user_id = db_user["user_id"]

    if not user_id:
        raise HTTPException(status_code=401, detail="User not found")

    # Load module
    try:
        module = load_flattened_module(request.slug)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")

    return StreamingResponse(
        event_generator(
            user_id=user_id,
            anonymous_token=None,
            module=module,
            section_index=request.sectionIndex,
            segment_index=request.segmentIndex,
            user_message=request.message,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
```

**Step 4: Run test to verify it passes**

Run: `pytest web_api/tests/test_chat_module.py -v`

Expected: All PASS

**Step 5: Commit**

```bash
jj describe -m "feat: update POST /api/chat/module to use position-based context"
```

---

## Task 5: Update Frontend sendMessage API

**Files:**
- Modify: `web_frontend/src/api/modules.ts`

**Step 1: Update sendMessage function signature and implementation**

Edit `web_frontend/src/api/modules.ts`. Replace the `sendMessage` function:

```typescript
/**
 * Send a chat message and stream the response.
 *
 * Uses the /api/chat/module endpoint with position-based context.
 * Backend owns chat history; we just send position and message.
 */
export async function* sendMessage(
  slug: string,
  sectionIndex: number,
  segmentIndex: number,
  message: string,
): AsyncGenerator<{ type: string; content?: string; name?: string }> {
  const res = await fetch(`${API_BASE}/api/chat/module`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      slug,
      sectionIndex,
      segmentIndex,
      message,
    }),
  });

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

/**
 * Fetch chat history for a module.
 */
export async function getChatHistory(
  slug: string,
): Promise<{ sessionId: number; messages: Array<{ role: string; content: string }> }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/chat/module/${slug}/history`,
    { credentials: "include" },
  );
  if (!res.ok) {
    if (res.status === 401) {
      return { sessionId: 0, messages: [] };
    }
    throw new Error("Failed to fetch chat history");
  }
  return res.json();
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web_frontend && npm run build`

Expected: Build succeeds (may have type errors in Module.tsx that we fix in next task)

**Step 3: Commit**

```bash
jj describe -m "feat: update sendMessage to use position-based API, add getChatHistory"
```

---

## Task 6: Update Frontend Module.tsx

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Update handleSendMessage to use new API**

Edit `web_frontend/src/views/Module.tsx`. Update the handleSendMessage callback and add history fetching:

```typescript
// Near the top, add getChatHistory import
import {
  sendMessage,
  getChatHistory,
  getNextModule,
  getModule,
  getCourseProgress,
} from "@/api/modules";

// In the component, after module loading effect, add history fetching:
// Fetch chat history when module loads
useEffect(() => {
  if (!module) return;

  // Clear messages when switching modules
  setMessages([]);

  // Track if effect is still active (prevent race condition)
  let cancelled = false;

  async function loadHistory() {
    try {
      const history = await getChatHistory(module!.slug);
      if (cancelled) return;  // Don't update if module changed

      if (history.messages.length > 0) {
        setMessages(
          history.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        );
      }
      // Messages already cleared above if history is empty
    } catch (e) {
      if (!cancelled) {
        console.error("[Module] Failed to load chat history:", e);
      }
    }
  }

  loadHistory();

  return () => { cancelled = true; };
}, [module]);

// Update handleSendMessage:
const handleSendMessage = useCallback(
  async (content: string, sectionIndex: number, segmentIndex: number) => {
    // Track chat activity on message send
    triggerChatActivity();

    // Store position for potential retry
    setLastPosition({ sectionIndex, segmentIndex });

    if (content) {
      setPendingMessage({ content, status: "sending" });
      trackChatMessageSent(moduleId, content.length);
    }
    setIsLoading(true);
    setStreamingContent("");

    try {
      let assistantContent = "";

      // Use new position-based API
      for await (const chunk of sendMessage(
        moduleId,  // slug
        sectionIndex,
        segmentIndex,
        content,
      )) {
        if (chunk.type === "text" && chunk.content) {
          assistantContent += chunk.content;
          setStreamingContent(assistantContent);
        }
      }

      // Update local display state
      setMessages((prev) => [
        ...prev,
        ...(content ? [{ role: "user" as const, content }] : []),
        { role: "assistant" as const, content: assistantContent },
      ]);
      setPendingMessage(null);
      setStreamingContent("");
    } catch {
      if (content) {
        setPendingMessage({ content, status: "failed" });
      }
      setStreamingContent("");
    } finally {
      setIsLoading(false);
    }
  },
  [triggerChatActivity, moduleId],
);
```

**Step 2: Verify build succeeds**

Run: `cd web_frontend && npm run build`

Expected: Build succeeds

**Step 3: Run linter**

Run: `cd web_frontend && npm run lint`

Expected: No new errors

**Step 4: Commit**

```bash
jj describe -m "feat: update Module.tsx to use position-based chat API"
```

---

## Task 7: Integration Test - End to End

**Files:**
- Manual testing

**Step 1: Start the dev server**

Run: `python main.py --dev`

**Step 2: Navigate to a module with chat**

Open browser to `http://localhost:3000/course/default/module/introduction` (or similar)

**Step 3: Test chat functionality**

1. Send a message in a chat segment after a video/article
2. Verify the response mentions content from the video/article
3. Refresh the page
4. Verify chat history is restored

**Step 4: Verify in database**

```bash
# Check chat_sessions table has the messages
psql $DATABASE_URL -c "SELECT session_id, content_type, messages FROM chat_sessions ORDER BY session_id DESC LIMIT 1;"
```

**Step 5: Final commit with all changes**

```bash
jj describe -m "feat: restore chat context for v2 flattened modules

- Fix bundle_article_section to use hide* fields (not show*)
- Add gather_section_context() for building chat context
- Update POST /api/chat/module to accept position (slug, sectionIndex, segmentIndex)
- Add GET /api/chat/module/{slug}/history endpoint
- Update frontend to use new APIs and fetch history on load
- Backend now owns chat history, stored in chat_sessions table"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Fix show*/hide* field inconsistency | `core/modules/content.py` |
| 2 | Add gather_section_context() | `core/modules/context.py` |
| 3 | Add GET history endpoint | `web_api/routes/module.py` |
| 4 | Update POST endpoint | `web_api/routes/module.py` |
| 5 | Update frontend API | `web_frontend/src/api/modules.ts` |
| 6 | Update Module.tsx | `web_frontend/src/views/Module.tsx` |
| 7 | Integration testing | Manual |

**Testing approach:**
- Unit tests for context gathering (pure function)
- Unit+1 integration tests for API endpoints (mock DB and LLM)
- Manual integration test for end-to-end verification
