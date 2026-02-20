"""Tests for feedback chat endpoints."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import app
from web_api.auth import get_user_or_anonymous


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_auth():
    app.dependency_overrides[get_user_or_anonymous] = lambda: (1, None)
    yield (1, None)
    app.dependency_overrides.clear()


@pytest.fixture
def mock_auth_anonymous():
    anon_token = uuid.uuid4()
    app.dependency_overrides[get_user_or_anonymous] = lambda: (None, anon_token)
    yield (None, anon_token)
    app.dependency_overrides.clear()


class TestUUID5ContentId:
    """Tests for deterministic UUID5 content_id derivation."""

    def test_uuid5_is_deterministic(self):
        """Same questionId always produces same UUID."""
        id1 = uuid.uuid5(uuid.NAMESPACE_URL, "test-module:0:0")
        id2 = uuid.uuid5(uuid.NAMESPACE_URL, "test-module:0:0")
        assert id1 == id2

    def test_uuid5_differs_for_different_questions(self):
        """Different questionIds produce different UUIDs."""
        id1 = uuid.uuid5(uuid.NAMESPACE_URL, "test-module:0:0")
        id2 = uuid.uuid5(uuid.NAMESPACE_URL, "test-module:0:1")
        assert id1 != id2


class TestPostFeedbackChat:
    """Tests for POST /api/chat/feedback."""

    def test_returns_sse_stream(self, client, mock_auth):
        """Should return 200 with SSE content type."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Here is feedback."}
            yield {"type": "done"}

        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.feedback.get_connection", return_value=mock_conn
            ),
            patch(
                "web_api.routes.feedback.get_or_create_chat_session",
                new_callable=AsyncMock,
                return_value={"session_id": 1, "messages": []},
            ),
            patch("web_api.routes.feedback.add_chat_message", new_callable=AsyncMock),
            patch(
                "web_api.routes.feedback._resolve_question_details",
                return_value={
                    "user_instruction": "Explain X",
                    "assessment_prompt": None,
                    "learning_outcome_name": None,
                    "mode": "socratic",
                },
            ),
            patch(
                "web_api.routes.feedback.send_feedback_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
        ):
            response = client.post(
                "/api/chat/feedback",
                json={
                    "questionId": "test-module:0:0",
                    "moduleSlug": "test-module",
                    "answerText": "My answer",
                    "message": "What did I miss?",
                },
            )
            assert response.status_code == 200
            assert (
                response.headers["content-type"] == "text/event-stream; charset=utf-8"
            )

    def test_streams_text_and_done_events(self, client, mock_auth):
        """Should stream data: events with text content and done signal."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Good "}
            yield {"type": "text", "content": "answer!"}
            yield {"type": "done"}

        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.feedback.get_connection", return_value=mock_conn
            ),
            patch(
                "web_api.routes.feedback.get_or_create_chat_session",
                new_callable=AsyncMock,
                return_value={"session_id": 1, "messages": []},
            ),
            patch("web_api.routes.feedback.add_chat_message", new_callable=AsyncMock),
            patch(
                "web_api.routes.feedback._resolve_question_details",
                return_value={"user_instruction": "Q", "mode": "socratic"},
            ),
            patch(
                "web_api.routes.feedback.send_feedback_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
        ):
            response = client.post(
                "/api/chat/feedback",
                json={
                    "questionId": "test-module:0:0",
                    "moduleSlug": "test-module",
                    "answerText": "My answer",
                    "message": "",
                },
            )
            lines = list(response.iter_lines())
            data_lines = [line for line in lines if line.startswith("data: ")]
            assert len(data_lines) >= 2

    def test_saves_user_and_assistant_messages(self, client, mock_auth):
        """Should save both user message and streamed assistant response."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Feedback here"}
            yield {"type": "done"}

        add_mock = AsyncMock()
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.feedback.get_connection", return_value=mock_conn
            ),
            patch(
                "web_api.routes.feedback.get_or_create_chat_session",
                new_callable=AsyncMock,
                return_value={"session_id": 1, "messages": []},
            ),
            patch("web_api.routes.feedback.add_chat_message", add_mock),
            patch(
                "web_api.routes.feedback._resolve_question_details",
                return_value={"user_instruction": "Q", "mode": "socratic"},
            ),
            patch(
                "web_api.routes.feedback.send_feedback_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
        ):
            response = client.post(
                "/api/chat/feedback",
                json={
                    "questionId": "test-module:0:0",
                    "moduleSlug": "test-module",
                    "answerText": "My answer",
                    "message": "Tell me more",
                },
            )
            list(response.iter_lines())  # consume to trigger generator

            calls = add_mock.call_args_list
            user_calls = [c for c in calls if c.kwargs.get("role") == "user"]
            assistant_calls = [
                c for c in calls if c.kwargs.get("role") == "assistant"
            ]
            assert len(user_calls) >= 1
            assert user_calls[0].kwargs["content"] == "Tell me more"
            assert len(assistant_calls) >= 1
            assert assistant_calls[0].kwargs["content"] == "Feedback here"

    def test_returns_401_when_not_authenticated(self, client):
        """Should return 401 for unauthenticated requests."""

        async def raise_401():
            raise HTTPException(status_code=401, detail="Authentication required")

        app.dependency_overrides[get_user_or_anonymous] = raise_401
        try:
            response = client.post(
                "/api/chat/feedback",
                json={
                    "questionId": "test-module:0:0",
                    "moduleSlug": "test-module",
                    "answerText": "My answer",
                    "message": "Hello",
                },
            )
            assert response.status_code == 401
        finally:
            app.dependency_overrides.clear()


class TestGetFeedbackHistory:
    """Tests for GET /api/chat/feedback/history."""

    def test_returns_existing_conversation(self, client, mock_auth):
        """Should return session messages when history exists."""
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.feedback.get_connection", return_value=mock_conn
            ),
            patch(
                "web_api.routes.feedback.get_or_create_chat_session",
                new_callable=AsyncMock,
                return_value={
                    "session_id": 42,
                    "messages": [
                        {"role": "assistant", "content": "Here is feedback"},
                        {"role": "user", "content": "Tell me more"},
                    ],
                },
            ),
        ):
            response = client.get(
                "/api/chat/feedback/history?questionId=test-module:0:0"
            )
            assert response.status_code == 200
            data = response.json()
            assert data["sessionId"] == 42
            assert len(data["messages"]) == 2

    def test_returns_empty_when_no_session(self, client, mock_auth):
        """Should return sessionId=0 and empty messages when no session exists."""
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.feedback.get_connection", return_value=mock_conn
            ),
            patch(
                "web_api.routes.feedback.get_or_create_chat_session",
                new_callable=AsyncMock,
                return_value={"session_id": 0, "messages": []},
            ),
        ):
            response = client.get(
                "/api/chat/feedback/history?questionId=test-module:0:0"
            )
            assert response.status_code == 200
            data = response.json()
            assert data["sessionId"] == 0
            assert data["messages"] == []

    def test_returns_401_when_not_authenticated(self, client):
        """Should return 401 for unauthenticated requests."""

        async def raise_401():
            raise HTTPException(status_code=401, detail="Authentication required")

        app.dependency_overrides[get_user_or_anonymous] = raise_401
        try:
            response = client.get(
                "/api/chat/feedback/history?questionId=test-module:0:0"
            )
            assert response.status_code == 401
        finally:
            app.dependency_overrides.clear()


class TestPostFeedbackArchive:
    """Tests for POST /api/chat/feedback/archive."""

    def test_returns_ok_when_session_exists(self, client, mock_auth):
        """Should return {ok: true} after archiving."""
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.feedback.get_connection", return_value=mock_conn
            ),
            patch(
                "web_api.routes.feedback.archive_chat_session",
                new_callable=AsyncMock,
                return_value=True,
            ),
            patch(
                "web_api.routes.feedback.find_active_feedback_session",
                new_callable=AsyncMock,
                return_value={"session_id": 1},
            ),
        ):
            response = client.post(
                "/api/chat/feedback/archive",
                json={"questionId": "test-module:0:0"},
            )
            assert response.status_code == 200
            assert response.json() == {"ok": True}

    def test_returns_ok_when_no_session(self, client, mock_auth):
        """Should return {ok: true} even when no session to archive (best-effort)."""
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.feedback.get_connection", return_value=mock_conn
            ),
            patch(
                "web_api.routes.feedback.find_active_feedback_session",
                new_callable=AsyncMock,
                return_value=None,
            ),
        ):
            response = client.post(
                "/api/chat/feedback/archive",
                json={"questionId": "test-module:0:0"},
            )
            assert response.status_code == 200
            assert response.json() == {"ok": True}
