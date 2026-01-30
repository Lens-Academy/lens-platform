"""Tests for chat sessions service."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from core.modules.chat_sessions import (
    get_or_create_chat_session,
    add_chat_message,
    archive_chat_session,
    claim_chat_sessions,
    get_chat_session,
)
from core.database import get_transaction


@pytest.fixture
def content_id():
    """Generate a random content UUID for testing."""
    return uuid.uuid4()


@pytest.fixture
def anonymous_token():
    """Generate a random session token UUID for testing."""
    return uuid.uuid4()


@pytest.fixture
def mock_conn():
    """Create a mock async database connection."""
    return AsyncMock()


# ============================================
# Unit Tests (with mocks - no DB required)
# ============================================


@pytest.mark.asyncio
async def test_get_or_create_requires_identity_unit(mock_conn, content_id):
    """get_or_create_chat_session should raise error when neither user_id nor anonymous_token provided."""
    with pytest.raises(ValueError, match="Either user_id or anonymous_token"):
        await get_or_create_chat_session(
            mock_conn,
            user_id=None,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )


@pytest.mark.asyncio
async def test_get_or_create_creates_new_session_unit(mock_conn, content_id):
    """get_or_create_chat_session should create new session when none exists (unit test)."""
    user_id = 123
    session_id = 1

    # Mock: no existing session found
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    mock_conn.execute.return_value = mock_result

    # Mock: insert returns new session
    mock_row = MagicMock()
    mock_row._mapping = {
        "session_id": session_id,
        "user_id": user_id,
        "anonymous_token": None,
        "content_id": content_id,
        "content_type": "module",
        "messages": [],
        "started_at": None,
        "last_active_at": None,
        "archived_at": None,
    }

    def execute_side_effect(*args, **kwargs):
        result = MagicMock()
        # First call is SELECT (returns None)
        # Second call is INSERT (returns the new row)
        if mock_conn.execute.call_count == 1:
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = mock_row
        return result

    mock_conn.execute.side_effect = execute_side_effect

    result = await get_or_create_chat_session(
        mock_conn,
        user_id=user_id,
        anonymous_token=None,
        content_id=content_id,
        content_type="module",
    )

    assert result["session_id"] == session_id
    assert result["user_id"] == user_id
    assert result["content_id"] == content_id
    assert result["messages"] == []


# ============================================
# Integration Tests (require database)
# ============================================


@pytest.mark.asyncio
async def test_get_or_create_creates_new_session(test_user_id, content_id):
    """get_or_create_chat_session should create new session when none exists."""
    async with get_transaction() as conn:
        result = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    assert result["user_id"] == test_user_id
    assert result["content_id"] == content_id
    assert result["content_type"] == "module"
    assert result["messages"] == []
    assert result["archived_at"] is None


@pytest.mark.asyncio
async def test_get_or_create_returns_existing_session(test_user_id, content_id):
    """get_or_create_chat_session should return existing active session."""
    # Create first session
    async with get_transaction() as conn:
        session1 = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    # Call again - should return same session
    async with get_transaction() as conn:
        session2 = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    assert session1["session_id"] == session2["session_id"]


@pytest.mark.asyncio
async def test_get_or_create_requires_identity():
    """get_or_create_chat_session should raise error when neither user_id nor anonymous_token provided."""
    content_id = uuid.uuid4()

    async with get_transaction() as conn:
        with pytest.raises(ValueError, match="Either user_id or anonymous_token"):
            await get_or_create_chat_session(
                conn,
                user_id=None,
                anonymous_token=None,
                content_id=content_id,
                content_type="module",
            )


@pytest.mark.asyncio
async def test_get_or_create_anonymous_session(anonymous_token, content_id):
    """get_or_create_chat_session should work with anonymous_token for anonymous users."""
    async with get_transaction() as conn:
        result = await get_or_create_chat_session(
            conn,
            user_id=None,
            anonymous_token=anonymous_token,
            content_id=content_id,
            content_type="lens",
        )

    assert result["user_id"] is None
    assert result["anonymous_token"] == anonymous_token
    assert result["content_id"] == content_id


@pytest.mark.asyncio
async def test_get_or_create_no_content_id(test_user_id):
    """get_or_create_chat_session should work without content_id (general chat)."""
    async with get_transaction() as conn:
        result = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=None,
            content_type=None,
        )

    assert result["user_id"] == test_user_id
    assert result["content_id"] is None
    assert result["content_type"] is None


@pytest.mark.asyncio
async def test_add_chat_message(test_user_id, content_id):
    """add_chat_message should append message to session."""
    async with get_transaction() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    async with get_transaction() as conn:
        await add_chat_message(
            conn,
            session_id=session["session_id"],
            role="user",
            content="Hello, AI!",
        )

    async with get_transaction() as conn:
        await add_chat_message(
            conn,
            session_id=session["session_id"],
            role="assistant",
            content="Hello, human!",
        )

    async with get_transaction() as conn:
        updated = await get_chat_session(conn, session_id=session["session_id"])

    assert len(updated["messages"]) == 2
    assert updated["messages"][0]["role"] == "user"
    assert updated["messages"][0]["content"] == "Hello, AI!"
    assert updated["messages"][1]["role"] == "assistant"
    assert updated["messages"][1]["content"] == "Hello, human!"


@pytest.mark.asyncio
async def test_add_chat_message_with_icon(test_user_id, content_id):
    """add_chat_message should include icon when provided."""
    async with get_transaction() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    async with get_transaction() as conn:
        await add_chat_message(
            conn,
            session_id=session["session_id"],
            role="system",
            content="Read this article",
            icon="article",
        )

    async with get_transaction() as conn:
        updated = await get_chat_session(conn, session_id=session["session_id"])

    assert updated["messages"][0]["icon"] == "article"


@pytest.mark.asyncio
async def test_archive_chat_session(test_user_id, content_id):
    """archive_chat_session should set archived_at timestamp."""
    async with get_transaction() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    async with get_transaction() as conn:
        await archive_chat_session(conn, session_id=session["session_id"])

    async with get_transaction() as conn:
        archived = await get_chat_session(conn, session_id=session["session_id"])

    assert archived["archived_at"] is not None


@pytest.mark.asyncio
async def test_get_or_create_after_archive_creates_new(test_user_id, content_id):
    """get_or_create_chat_session should create new session after archiving old one."""
    # Create and archive first session
    async with get_transaction() as conn:
        session1 = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    async with get_transaction() as conn:
        await archive_chat_session(conn, session_id=session1["session_id"])

    # Get or create should create new session
    async with get_transaction() as conn:
        session2 = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    assert session1["session_id"] != session2["session_id"]
    assert session2["archived_at"] is None


@pytest.mark.asyncio
async def test_claim_chat_sessions(test_user_id, anonymous_token, content_id):
    """claim_chat_sessions should transfer anonymous sessions to user."""
    # Create anonymous sessions
    async with get_transaction() as conn:
        await get_or_create_chat_session(
            conn,
            user_id=None,
            anonymous_token=anonymous_token,
            content_id=content_id,
            content_type="module",
        )

    content_id2 = uuid.uuid4()
    async with get_transaction() as conn:
        await get_or_create_chat_session(
            conn,
            user_id=None,
            anonymous_token=anonymous_token,
            content_id=content_id2,
            content_type="lens",
        )

    # Claim sessions
    async with get_transaction() as conn:
        count = await claim_chat_sessions(
            conn,
            anonymous_token=anonymous_token,
            user_id=test_user_id,
        )

    assert count == 2

    # Verify sessions are now owned by user
    async with get_transaction() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    # Should return existing session (now owned by user)
    assert session["user_id"] == test_user_id
    assert session["anonymous_token"] is None


@pytest.mark.asyncio
async def test_claim_chat_sessions_no_records(test_user_id):
    """claim_chat_sessions with no matching records should return 0."""
    async with get_transaction() as conn:
        count = await claim_chat_sessions(
            conn,
            anonymous_token=uuid.uuid4(),  # Non-existent token
            user_id=test_user_id,
        )

    assert count == 0


@pytest.mark.asyncio
async def test_get_chat_session_not_found():
    """get_chat_session should return None for non-existent session."""
    async with get_transaction() as conn:
        result = await get_chat_session(conn, session_id=999999)

    assert result is None


@pytest.mark.asyncio
async def test_claim_chat_sessions_skips_conflicting_content(
    test_user_id, anonymous_token, content_id
):
    """Claim skips sessions where user already has one for same content."""
    # User already has a session for this content
    async with get_transaction() as conn:
        await get_or_create_chat_session(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="module",
        )

    # Anonymous session for same content
    async with get_transaction() as conn:
        await get_or_create_chat_session(
            conn,
            user_id=None,
            anonymous_token=anonymous_token,
            content_id=content_id,
            content_type="module",
        )

    # Claim should skip the conflicting one (not raise IntegrityError)
    async with get_transaction() as conn:
        count = await claim_chat_sessions(
            conn,
            anonymous_token=anonymous_token,
            user_id=test_user_id,
        )

    assert count == 0
