# web_api/tests/test_chat_module.py
"""Tests for POST /api/chat/module endpoint."""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import FlattenedModule
from main import app
from web_api.auth import get_current_user


@pytest.fixture
def mock_chat_module_cache():
    """Set up a mock cache with flattened module data for chat module tests."""
    cache = ContentCache(
        courses={},
        flattened_modules={
            "test-module": FlattenedModule(
                slug="test-module",
                title="Test Module",
                content_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
                sections=[
                    {
                        "type": "video",
                        "contentId": "00000000-0000-0000-0000-000000000002",
                        "videoId": "test123",
                        "segments": [
                            {
                                "type": "video-excerpt",
                                "transcript": "Video content here",
                            },
                            {
                                "type": "chat",
                                "instructions": "Discuss the video",
                                "hidePreviousContentFromTutor": False,
                            },
                        ],
                    }
                ],
            ),
        },
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    yield cache
    clear_cache()


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def mock_auth():
    """Override the get_current_user dependency to return a test user."""
    test_user = {"sub": "123456789", "username": "testuser"}
    app.dependency_overrides[get_current_user] = lambda: test_user
    yield test_user
    app.dependency_overrides.clear()


class TestPostChatModule:
    """Tests for POST /api/chat/module."""

    def test_accepts_new_request_format(
        self, client, mock_chat_module_cache, mock_auth
    ):
        """Should accept slug, sectionIndex, segmentIndex, message."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Hello "}
            yield {"type": "text", "content": "there!"}
            yield {"type": "done"}

        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
            patch(
                "web_api.routes.module.get_or_create_chat_session",
                return_value={"session_id": 1, "messages": []},
            ),
            patch(
                "web_api.routes.module.add_chat_message",
                new_callable=AsyncMock,
            ),
            patch(
                "web_api.routes.module.send_module_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
        ):
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
            assert (
                response.headers["content-type"] == "text/event-stream; charset=utf-8"
            )

    def test_saves_user_message_to_session(
        self, client, mock_chat_module_cache, mock_auth
    ):
        """Should save user message to chat session."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Response"}
            yield {"type": "done"}

        add_mock = AsyncMock()

        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
            patch(
                "web_api.routes.module.get_or_create_chat_session",
                return_value={"session_id": 1, "messages": []},
            ),
            patch(
                "web_api.routes.module.add_chat_message",
                add_mock,
            ),
            patch(
                "web_api.routes.module.send_module_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
        ):
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
            user_calls = [c for c in calls if c.kwargs.get("role") == "user"]
            assert len(user_calls) >= 1
            assert user_calls[0].kwargs["content"] == "My question"

    def test_builds_context_from_position(
        self, client, mock_chat_module_cache, mock_auth
    ):
        """Should build context using gather_section_context."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Response"}
            yield {"type": "done"}

        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
            patch(
                "web_api.routes.module.get_or_create_chat_session",
                return_value={"session_id": 1, "messages": []},
            ),
            patch(
                "web_api.routes.module.add_chat_message",
                new_callable=AsyncMock,
            ),
            patch(
                "web_api.routes.module.send_module_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
            patch(
                "web_api.routes.module.gather_section_context",
                return_value="Video content here",
            ) as ctx_mock,
        ):
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

    def test_returns_401_when_not_authenticated(self, client, mock_chat_module_cache):
        """Should return 401 for unauthenticated requests."""

        # No mock_auth fixture - no dependency override, so get_current_user will fail
        # But we need to make sure it raises an HTTPException
        async def raise_401():
            raise HTTPException(status_code=401, detail="Not authenticated")

        app.dependency_overrides[get_current_user] = raise_401
        try:
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
        finally:
            app.dependency_overrides.clear()

    def test_returns_404_for_unknown_module(
        self, client, mock_chat_module_cache, mock_auth
    ):
        """Should return 404 for unknown module slug."""
        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
        ):
            response = client.post(
                "/api/chat/module",
                json={
                    "slug": "unknown-module",
                    "sectionIndex": 0,
                    "segmentIndex": 0,
                    "message": "Hello",
                },
            )

        assert response.status_code == 404

    def test_streams_assistant_response(
        self, client, mock_chat_module_cache, mock_auth
    ):
        """Should stream LLM response as SSE events."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Hello "}
            yield {"type": "text", "content": "world!"}
            yield {"type": "done"}

        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
            patch(
                "web_api.routes.module.get_or_create_chat_session",
                return_value={"session_id": 1, "messages": []},
            ),
            patch(
                "web_api.routes.module.add_chat_message",
                new_callable=AsyncMock,
            ),
            patch(
                "web_api.routes.module.send_module_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
        ):
            response = client.post(
                "/api/chat/module",
                json={
                    "slug": "test-module",
                    "sectionIndex": 0,
                    "segmentIndex": 1,
                    "message": "Hello",
                },
            )

            # Collect streamed data
            lines = list(response.iter_lines())
            # Should have data events for text chunks
            data_lines = [line for line in lines if line.startswith("data: ")]
            assert len(data_lines) >= 2  # At least text chunks

    def test_saves_assistant_response_to_session(
        self, client, mock_chat_module_cache, mock_auth
    ):
        """Should save assistant response to chat session."""

        async def mock_stream(*args, **kwargs):
            yield {"type": "text", "content": "Hello "}
            yield {"type": "text", "content": "there!"}
            yield {"type": "done"}

        add_mock = AsyncMock()

        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
            patch(
                "web_api.routes.module.get_or_create_chat_session",
                return_value={"session_id": 1, "messages": []},
            ),
            patch(
                "web_api.routes.module.add_chat_message",
                add_mock,
            ),
            patch(
                "web_api.routes.module.send_module_message",
                side_effect=lambda *a, **kw: mock_stream(),
            ),
        ):
            response = client.post(
                "/api/chat/module",
                json={
                    "slug": "test-module",
                    "sectionIndex": 0,
                    "segmentIndex": 1,
                    "message": "Hello",
                },
            )

            # Consume response to trigger the generator
            list(response.iter_lines())

            # Verify add_chat_message was called with assistant message
            calls = add_mock.call_args_list
            assistant_calls = [c for c in calls if c.kwargs.get("role") == "assistant"]
            assert len(assistant_calls) >= 1
            assert assistant_calls[0].kwargs["content"] == "Hello there!"
