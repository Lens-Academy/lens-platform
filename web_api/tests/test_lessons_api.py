# web_api/tests/test_lessons_api.py
"""Tests for lesson API endpoints."""

import sys
from pathlib import Path

# Ensure we import from root main.py, not web_api/main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from main import app


client = TestClient(app)


# --- Task 4: Claim Endpoint Tests ---


def test_claim_session_success():
    """Authenticated user can claim an anonymous session."""
    # Mock the auth to return a user
    with patch("web_api.routes.lessons.get_current_user") as mock_auth:
        mock_auth.return_value = {"sub": "test_discord_123", "username": "testuser"}

        # Mock get_or_create_user to return a user
        with patch("web_api.routes.lessons.get_or_create_user") as mock_get_user:
            mock_get_user.return_value = {"user_id": 42, "discord_id": "test_discord_123"}

            # Mock claim_session
            with patch("web_api.routes.lessons.claim_session") as mock_claim:
                mock_claim.return_value = {
                    "session_id": 1,
                    "user_id": 42,
                    "lesson_id": "test",
                    "messages": [],
                }

                response = client.post("/api/lesson-sessions/1/claim")

                assert response.status_code == 200
                assert response.json()["claimed"] is True
                mock_claim.assert_called_once_with(1, 42)


def test_claim_session_requires_auth():
    """Cannot claim a session without authentication."""
    from fastapi import HTTPException

    with patch("web_api.routes.lessons.get_current_user") as mock_auth:
        mock_auth.side_effect = HTTPException(status_code=401, detail="Not authenticated")

        response = client.post("/api/lesson-sessions/1/claim")

        # Should fail auth
        assert response.status_code == 401


def test_claim_already_claimed_session():
    """Cannot claim a session that's already claimed."""
    with patch("web_api.routes.lessons.get_current_user") as mock_auth:
        mock_auth.return_value = {"sub": "test_discord_123", "username": "testuser"}

        with patch("web_api.routes.lessons.get_or_create_user") as mock_get_user:
            mock_get_user.return_value = {"user_id": 42, "discord_id": "test_discord_123"}

            with patch("web_api.routes.lessons.claim_session") as mock_claim:
                from core.lessons import SessionAlreadyClaimedError
                mock_claim.side_effect = SessionAlreadyClaimedError("Already claimed")

                response = client.post("/api/lesson-sessions/1/claim")

                assert response.status_code == 403


def test_claim_nonexistent_session():
    """Cannot claim a session that doesn't exist."""
    with patch("web_api.routes.lessons.get_current_user") as mock_auth:
        mock_auth.return_value = {"sub": "test_discord_123", "username": "testuser"}

        with patch("web_api.routes.lessons.get_or_create_user") as mock_get_user:
            mock_get_user.return_value = {"user_id": 42, "discord_id": "test_discord_123"}

            with patch("web_api.routes.lessons.claim_session") as mock_claim:
                from core.lessons import SessionNotFoundError
                mock_claim.side_effect = SessionNotFoundError("Session not found")

                response = client.post("/api/lesson-sessions/1/claim")

                assert response.status_code == 404


# --- Task 5: Anonymous Session Access Tests ---


def test_get_anonymous_session_by_id():
    """Can access an anonymous session without auth if you have the session_id."""
    with patch("web_api.routes.lessons.get_optional_user") as mock_auth:
        mock_auth.return_value = None  # Not authenticated

        with patch("web_api.routes.lessons.get_session") as mock_get:
            mock_get.return_value = {
                "session_id": 1,
                "user_id": None,  # Anonymous
                "lesson_id": "intro-to-ai-safety",
                "current_stage_index": 0,
                "messages": [],
                "completed_at": None,
            }

            with patch("web_api.routes.lessons.load_lesson") as mock_lesson:
                from unittest.mock import MagicMock
                mock_stage = MagicMock()
                mock_stage.type = "chat"
                mock_stage.instructions = "hi"
                mock_stage.show_user_previous_content = True
                mock_stage.show_tutor_previous_content = True

                mock_lesson_obj = MagicMock()
                mock_lesson_obj.title = "Test Lesson"
                mock_lesson_obj.stages = [mock_stage]
                mock_lesson.return_value = mock_lesson_obj

                with patch("web_api.routes.lessons.get_stage_content") as mock_content:
                    mock_content.return_value = None

                    response = client.get("/api/lesson-sessions/1")

                    # Should succeed for anonymous session
                    assert response.status_code == 200


def test_get_session_forbidden_for_wrong_user():
    """Cannot access another user's session."""
    with patch("web_api.routes.lessons.get_optional_user") as mock_auth:
        mock_auth.return_value = {"sub": "test_discord_123", "username": "testuser"}

        with patch("web_api.routes.lessons.get_or_create_user") as mock_get_user:
            mock_get_user.return_value = {"user_id": 42, "discord_id": "test_discord_123"}

            with patch("web_api.routes.lessons.get_session") as mock_get:
                mock_get.return_value = {
                    "session_id": 1,
                    "user_id": 999,  # Different user
                    "lesson_id": "test",
                    "current_stage_index": 0,
                    "messages": [],
                    "completed_at": None,
                }

                response = client.get("/api/lesson-sessions/1")

                # Should fail - not owner's session
                assert response.status_code == 403


# --- Task 6: Anonymous Session Creation Tests ---


def test_create_anonymous_session():
    """Can create a session without authentication."""
    with patch("web_api.routes.lessons.get_optional_user") as mock_auth:
        mock_auth.return_value = None  # Not authenticated

        with patch("web_api.routes.lessons.create_session") as mock_create:
            mock_create.return_value = {
                "session_id": 123,
                "user_id": None,
                "lesson_id": "intro-to-ai-safety",
                "messages": [],
            }

            with patch("web_api.routes.lessons.load_lesson") as mock_lesson:
                from unittest.mock import MagicMock
                mock_lesson_obj = MagicMock()
                mock_lesson_obj.stages = []  # No stages = no started message
                mock_lesson.return_value = mock_lesson_obj

                response = client.post(
                    "/api/lesson-sessions",
                    json={"lesson_id": "intro-to-ai-safety"}
                )

                assert response.status_code == 200
                assert response.json()["session_id"] == 123
                # Verify create_session was called with user_id=None
                mock_create.assert_called_once_with(None, "intro-to-ai-safety")


def test_create_authenticated_session():
    """Authenticated user creates session with their user_id."""
    with patch("web_api.routes.lessons.get_optional_user") as mock_auth:
        mock_auth.return_value = {"sub": "test_discord_123", "username": "testuser"}

        with patch("web_api.routes.lessons.get_or_create_user") as mock_get_user:
            mock_get_user.return_value = {"user_id": 42, "discord_id": "test_discord_123"}

            with patch("web_api.routes.lessons.create_session") as mock_create:
                mock_create.return_value = {
                    "session_id": 456,
                    "user_id": 42,
                    "lesson_id": "intro-to-ai-safety",
                    "messages": [],
                }

                with patch("web_api.routes.lessons.load_lesson") as mock_lesson:
                    from unittest.mock import MagicMock
                    mock_lesson_obj = MagicMock()
                    mock_lesson_obj.stages = []
                    mock_lesson.return_value = mock_lesson_obj

                    response = client.post(
                        "/api/lesson-sessions",
                        json={"lesson_id": "intro-to-ai-safety"}
                    )

                    assert response.status_code == 200
                    assert response.json()["session_id"] == 456
                    # Verify create_session was called with actual user_id
                    mock_create.assert_called_once_with(42, "intro-to-ai-safety")
