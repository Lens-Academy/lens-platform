# web_api/tests/test_modules_progress_v2.py
"""Tests for v2 module progress endpoints.

Tests the POST /api/modules/{slug}/progress endpoint for updating
lens progress via heartbeat/completion.
"""

import pytest
import uuid
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from fastapi.testclient import TestClient

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import FlattenedModule


# --- Helper Functions ---


def random_uuid_str() -> str:
    """Generate a random UUID string for testing."""
    return str(uuid.uuid4())


@asynccontextmanager
async def mock_db_connection():
    """Create a mock async context manager for database connections."""
    yield MagicMock()


@pytest.fixture
def mock_flattened_cache_for_progress():
    """Set up a mock cache with flattened module data for progress tests."""
    cache = ContentCache(
        courses={},
        flattened_modules={
            "intro": FlattenedModule(
                slug="intro",
                title="Introduction",
                content_id=UUID("00000000-0000-0000-0000-000000000001"),
                sections=[
                    {
                        "type": "page",
                        "contentId": "00000000-0000-0000-0000-000000000002",
                        "title": "Welcome",
                        "segments": [],
                    },
                    {
                        "type": "video",
                        "contentId": "00000000-0000-0000-0000-000000000003",
                        "learningOutcomeId": "00000000-0000-0000-0000-000000000010",
                        "videoId": "abc123",
                        "meta": {"title": "AI Safety Intro", "channel": "Kurzgesagt"},
                        "segments": [],
                        "optional": False,
                    },
                    {
                        "type": "article",
                        "contentId": "00000000-0000-0000-0000-000000000004",
                        "learningOutcomeId": None,
                        "meta": {
                            "title": "Background Reading",
                            "author": "Jane Doe",
                            "sourceUrl": "https://example.com",
                        },
                        "segments": [],
                        "optional": True,
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


# --- Authentication Tests ---


class TestModuleProgressAuthentication:
    """Tests for authentication handling in module progress endpoint."""

    def test_post_progress_without_auth_returns_401(
        self, mock_flattened_cache_for_progress
    ):
        """POST /api/modules/{slug}/progress without auth should return 401."""
        from main import app

        client = TestClient(app)

        response = client.post(
            "/api/modules/intro/progress",
            json={
                "contentId": "00000000-0000-0000-0000-000000000003",
                "timeSpentS": 60,
                "completed": False,
            },
        )
        assert response.status_code == 401
        assert "Authentication required" in response.json()["detail"]

    def test_post_progress_with_anonymous_token_succeeds(
        self, mock_flattened_cache_for_progress
    ):
        """POST /api/modules/{slug}/progress with anonymous token should work."""
        from main import app

        client = TestClient(app)
        anonymous_token = random_uuid_str()

        with (
            patch(
                "web_api.routes.modules.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.modules.get_or_create_progress",
                new_callable=AsyncMock,
            ) as mock_progress,
            patch(
                "web_api.routes.modules.update_time_spent",
                new_callable=AsyncMock,
            ),
        ):
            mock_progress.return_value = {
                "id": 1,
                "content_id": UUID("00000000-0000-0000-0000-000000000003"),
                "completed_at": None,
                "total_time_spent_s": 60,
            }

            response = client.post(
                "/api/modules/intro/progress",
                json={
                    "contentId": "00000000-0000-0000-0000-000000000003",
                    "timeSpentS": 60,
                    "completed": False,
                },
                headers={"X-Anonymous-Token": anonymous_token},
            )

            assert response.status_code == 200


# --- Validation Tests ---


class TestModuleProgressValidation:
    """Tests for request validation in module progress endpoint."""

    def test_post_progress_module_not_found_returns_404(
        self, mock_flattened_cache_for_progress
    ):
        """POST to nonexistent module should return 404."""
        from main import app

        client = TestClient(app)
        anonymous_token = random_uuid_str()

        response = client.post(
            "/api/modules/nonexistent/progress",
            json={
                "contentId": random_uuid_str(),
                "timeSpentS": 60,
                "completed": False,
            },
            headers={"X-Anonymous-Token": anonymous_token},
        )
        assert response.status_code == 404

    def test_post_progress_invalid_content_id_returns_400(
        self, mock_flattened_cache_for_progress
    ):
        """POST with contentId not in module should return 400."""
        from main import app

        client = TestClient(app)
        anonymous_token = random_uuid_str()

        response = client.post(
            "/api/modules/intro/progress",
            json={
                "contentId": random_uuid_str(),  # Not in the module
                "timeSpentS": 60,
                "completed": False,
            },
            headers={"X-Anonymous-Token": anonymous_token},
        )
        assert response.status_code == 400
        assert "not found in module" in response.json()["detail"].lower()

    def test_post_progress_invalid_uuid_format_returns_422(
        self, mock_flattened_cache_for_progress
    ):
        """POST with invalid UUID format should return 422."""
        from main import app

        client = TestClient(app)
        anonymous_token = random_uuid_str()

        response = client.post(
            "/api/modules/intro/progress",
            json={
                "contentId": "not-a-uuid",
                "timeSpentS": 60,
                "completed": False,
            },
            headers={"X-Anonymous-Token": anonymous_token},
        )
        assert response.status_code == 422


# --- Progress Update Tests ---


class TestModuleProgressUpdate:
    """Tests for progress update functionality."""

    def test_post_progress_heartbeat_updates_time(
        self, mock_flattened_cache_for_progress
    ):
        """POST with completed=false should update time spent."""
        from main import app

        client = TestClient(app)
        anonymous_token = random_uuid_str()
        content_id = "00000000-0000-0000-0000-000000000003"

        with (
            patch(
                "web_api.routes.modules.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.modules.get_or_create_progress",
                new_callable=AsyncMock,
            ) as mock_get_progress,
            patch(
                "web_api.routes.modules.update_time_spent",
                new_callable=AsyncMock,
            ) as mock_update_time,
        ):
            mock_get_progress.return_value = {
                "id": 1,
                "content_id": UUID(content_id),
                "completed_at": None,
                "total_time_spent_s": 30,
            }

            response = client.post(
                "/api/modules/intro/progress",
                json={
                    "contentId": content_id,
                    "timeSpentS": 30,
                    "completed": False,
                },
                headers={"X-Anonymous-Token": anonymous_token},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["completed"] is False

            # Verify time was updated
            mock_update_time.assert_called_once()

    def test_post_progress_completed_marks_complete(
        self, mock_flattened_cache_for_progress
    ):
        """POST with completed=true should mark lens complete."""
        from main import app

        client = TestClient(app)
        anonymous_token = random_uuid_str()
        content_id = "00000000-0000-0000-0000-000000000003"
        now = datetime.now(timezone.utc)

        with (
            patch(
                "web_api.routes.modules.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.modules.mark_content_complete",
                new_callable=AsyncMock,
            ) as mock_complete,
        ):
            mock_complete.return_value = {
                "id": 1,
                "content_id": UUID(content_id),
                "completed_at": now,
                "total_time_spent_s": 120,
            }

            response = client.post(
                "/api/modules/intro/progress",
                json={
                    "contentId": content_id,
                    "timeSpentS": 120,
                    "completed": True,
                },
                headers={"X-Anonymous-Token": anonymous_token},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["completed"] is True
            assert data["completedAt"] is not None

            # Verify mark_content_complete was called with content_type='lens'
            mock_complete.assert_called_once()
            call_kwargs = mock_complete.call_args.kwargs
            assert call_kwargs["content_type"] == "lens"

    def test_post_progress_returns_section_title(
        self, mock_flattened_cache_for_progress
    ):
        """POST should include the section title in response."""
        from main import app

        client = TestClient(app)
        anonymous_token = random_uuid_str()
        content_id = "00000000-0000-0000-0000-000000000003"

        with (
            patch(
                "web_api.routes.modules.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.modules.get_or_create_progress",
                new_callable=AsyncMock,
            ) as mock_progress,
            patch(
                "web_api.routes.modules.update_time_spent",
                new_callable=AsyncMock,
            ),
        ):
            mock_progress.return_value = {
                "id": 1,
                "content_id": UUID(content_id),
                "completed_at": None,
                "total_time_spent_s": 60,
            }

            response = client.post(
                "/api/modules/intro/progress",
                json={
                    "contentId": content_id,
                    "timeSpentS": 60,
                    "completed": False,
                },
                headers={"X-Anonymous-Token": anonymous_token},
            )

            assert response.status_code == 200
            data = response.json()
            # Section title should be included for frontend display
            assert "contentTitle" in data
            assert data["contentTitle"] == "AI Safety Intro"


# --- Authenticated User Tests ---


class TestModuleProgressAuthenticated:
    """Tests for authenticated user progress tracking."""

    def test_post_progress_with_auth_succeeds(self, mock_flattened_cache_for_progress):
        """Authenticated user can update progress."""
        from main import app

        client = TestClient(app)
        content_id = "00000000-0000-0000-0000-000000000003"

        with (
            patch(
                "web_api.routes.modules.get_optional_user",
                new_callable=AsyncMock,
            ) as mock_auth,
            patch(
                "web_api.routes.modules.get_or_create_user",
                new_callable=AsyncMock,
            ) as mock_get_user,
            patch(
                "web_api.routes.modules.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.modules.get_or_create_progress",
                new_callable=AsyncMock,
            ) as mock_progress,
            patch(
                "web_api.routes.modules.update_time_spent",
                new_callable=AsyncMock,
            ),
        ):
            # JWT only has 'sub' (Discord ID), not 'user_id'
            mock_auth.return_value = {"sub": "123456789"}
            # get_or_create_user looks up/creates the database user
            mock_get_user.return_value = {"user_id": 42}
            mock_progress.return_value = {
                "id": 1,
                "content_id": UUID(content_id),
                "completed_at": None,
                "total_time_spent_s": 60,
            }

            response = client.post(
                "/api/modules/intro/progress",
                json={
                    "contentId": content_id,
                    "timeSpentS": 60,
                    "completed": False,
                },
                cookies={"auth_token": "valid_token"},
            )

            assert response.status_code == 200

            # Verify user_id was passed, not anonymous_token
            call_kwargs = mock_progress.call_args.kwargs
            assert call_kwargs["user_id"] == 42
            assert call_kwargs["anonymous_token"] is None
