# web_api/tests/test_chat_history.py
"""Tests for GET /api/chat/module/{slug}/history endpoint."""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import FlattenedModule


@pytest.fixture
def mock_chat_history_cache():
    """Set up a mock cache with flattened module data for chat history tests."""
    cache = ContentCache(
        courses={},
        flattened_modules={
            "test-module": FlattenedModule(
                slug="test-module",
                title="Test Module",
                content_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
                sections=[
                    {
                        "type": "page",
                        "contentId": "00000000-0000-0000-0000-000000000002",
                        "title": "Discussion",
                        "segments": [
                            {
                                "type": "chat",
                                "instructions": "Discuss the topic.",
                            }
                        ],
                    },
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
    from main import app

    return TestClient(app)


class TestGetChatHistory:
    """Tests for GET /api/chat/module/{slug}/history."""

    def test_returns_chat_history(self, client, mock_chat_history_cache):
        """Should return chat history for authenticated user."""
        # Patch where functions are used (routes.module) not where defined
        with (
            patch(
                "web_api.routes.module.get_optional_user",
                return_value={"sub": "123456789", "username": "testuser"},
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
            patch(
                "web_api.routes.module.get_or_create_chat_session",
                return_value={
                    "session_id": 1,
                    "messages": [
                        {"role": "user", "content": "Hello"},
                        {"role": "assistant", "content": "Hi there!"},
                    ],
                },
            ),
        ):
            response = client.get("/api/chat/module/test-module/history")

            assert response.status_code == 200
            data = response.json()
            assert "sessionId" in data
            assert "messages" in data
            assert len(data["messages"]) == 2
            assert data["messages"][0]["role"] == "user"
            assert data["messages"][0]["content"] == "Hello"

    def test_returns_401_when_not_authenticated(self, client, mock_chat_history_cache):
        """Should return 401 when user is not authenticated and no anonymous token."""
        with patch("web_api.routes.module.get_optional_user", return_value=None):
            response = client.get("/api/chat/module/test-module/history")

        assert response.status_code == 401

    def test_returns_404_for_unknown_module(self, client, mock_chat_history_cache):
        """Should return 404 for unknown module slug."""
        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_optional_user",
                return_value={"sub": "123456789", "username": "testuser"},
            ),
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_user_by_discord_id",
                return_value={"user_id": 1, "discord_id": "123456789"},
            ),
        ):
            response = client.get("/api/chat/module/not-found/history")

        assert response.status_code == 404

    def test_works_with_anonymous_token(self, client, mock_chat_history_cache):
        """Should work with X-Anonymous-Token header for anonymous users."""
        anon_token = str(uuid.uuid4())

        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch("web_api.routes.module.get_optional_user", return_value=None),
            patch(
                "web_api.routes.module.get_connection",
                return_value=mock_conn,
            ),
            patch(
                "web_api.routes.module.get_or_create_chat_session",
                return_value={"session_id": 1, "messages": []},
            ),
        ):
            response = client.get(
                "/api/chat/module/test-module/history",
                headers={"X-Anonymous-Token": anon_token},
            )

        assert response.status_code == 200

    def test_returns_empty_messages_for_new_session(
        self, client, mock_chat_history_cache
    ):
        """Should return empty messages array for new chat session."""
        # Create a mock connection context manager
        mock_conn = MagicMock()
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=None)

        with (
            patch(
                "web_api.routes.module.get_optional_user",
                return_value={"sub": "123456789", "username": "testuser"},
            ),
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
        ):
            response = client.get("/api/chat/module/test-module/history")

        assert response.status_code == 200
        data = response.json()
        assert data["messages"] == []
