# web_api/tests/test_progress_integration.py
"""Integration tests for progress API endpoints.

These tests exercise the full request/response cycle through FastAPI,
testing authentication, request validation, and business logic integration.

Tests are organized by functionality:
- Authentication tests: Verify auth requirements
- Validation tests: Verify request validation
- Mock-based tests: Full endpoint tests with mocked database
"""

import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

# Ensure we import from root main.py, not web_api/main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from main import app

client = TestClient(app)


# --- Helper Functions ---


def random_uuid_str() -> str:
    """Generate a random UUID string for testing."""
    return str(uuid.uuid4())


def make_complete_request(
    content_id: str,
    content_type: str = "lens",
    content_title: str = "Test Lens",
    time_spent_s: int = 60,
    anonymous_token: str | None = None,
    auth_cookie: str | None = None,
    sibling_lens_ids: list[str] | None = None,
):
    """Helper to make POST /api/progress/complete requests."""
    headers = {}
    cookies = {}

    if anonymous_token:
        headers["X-Anonymous-Token"] = anonymous_token
    if auth_cookie:
        cookies["auth_token"] = auth_cookie

    body = {
        "content_id": content_id,
        "content_type": content_type,
        "content_title": content_title,
        "time_spent_s": time_spent_s,
    }
    if sibling_lens_ids:
        body["sibling_lens_ids"] = sibling_lens_ids

    return client.post(
        "/api/progress/complete",
        json=body,
        headers=headers,
        cookies=cookies,
    )


def make_time_request(
    content_id: str,
    time_delta_s: int = 30,
    anonymous_token: str | None = None,
    auth_cookie: str | None = None,
    use_query_param: bool = False,
):
    """Helper to make POST /api/progress/time requests."""
    headers = {}
    cookies = {}
    params = {}

    if anonymous_token:
        if use_query_param:
            params["anonymous_token"] = anonymous_token
        else:
            headers["X-Anonymous-Token"] = anonymous_token
    if auth_cookie:
        cookies["auth_token"] = auth_cookie

    return client.post(
        "/api/progress/time",
        json={
            "content_id": content_id,
            "time_delta_s": time_delta_s,
        },
        headers=headers,
        cookies=cookies,
        params=params,
    )


# --- Mock Database Context Manager ---


@asynccontextmanager
async def mock_db_connection():
    """Create a mock async context manager for database connections."""
    yield MagicMock()


# --- Authentication Tests ---


class TestProgressAuthentication:
    """Tests for authentication handling in progress endpoints."""

    def test_complete_without_auth_returns_401(self):
        """POST /complete without auth or session token should return 401."""
        response = client.post(
            "/api/progress/complete",
            json={
                "content_id": random_uuid_str(),
                "content_type": "lens",
                "content_title": "Test",
                "time_spent_s": 60,
            },
        )
        assert response.status_code == 401
        assert "Authentication required" in response.json()["detail"]

    def test_time_without_auth_returns_401(self):
        """POST /time without auth or session token should return 401."""
        response = client.post(
            "/api/progress/time",
            json={
                "content_id": random_uuid_str(),
                "time_delta_s": 30,
            },
        )
        assert response.status_code == 401


# --- Request Validation Tests ---


class TestProgressValidation:
    """Tests for request validation in progress endpoints."""

    def test_complete_invalid_content_type_returns_400(self):
        """POST /complete with invalid content_type should return 400."""
        anonymous_token = random_uuid_str()
        # Patch both the database connection and the function to avoid actual DB calls
        with patch(
            "web_api.routes.progress.get_transaction", return_value=mock_db_connection()
        ):
            response = make_complete_request(
                content_id=random_uuid_str(),
                content_type="invalid_type",
                anonymous_token=anonymous_token,
            )
        assert response.status_code == 400
        assert "Invalid content_type" in response.json()["detail"]

    def test_complete_invalid_uuid_returns_422(self):
        """POST /complete with invalid content_id should return 422."""
        response = client.post(
            "/api/progress/complete",
            json={
                "content_id": "not-a-uuid",
                "content_type": "lens",
                "content_title": "Test",
                "time_spent_s": 60,
            },
            headers={"X-Anonymous-Token": random_uuid_str()},
        )
        assert response.status_code == 422

    def test_complete_invalid_anonymous_token_format_returns_400(self):
        """POST /complete with malformed session token should return 400."""
        response = client.post(
            "/api/progress/complete",
            json={
                "content_id": random_uuid_str(),
                "content_type": "lens",
                "content_title": "Test",
                "time_spent_s": 60,
            },
            headers={"X-Anonymous-Token": "invalid-not-uuid"},
        )
        assert response.status_code == 400
        assert "Invalid session token format" in response.json()["detail"]

    def test_complete_accepts_all_valid_content_types(self):
        """POST /complete should accept all valid content_types."""
        valid_types = ["module", "lo", "lens", "test"]
        anonymous_token = random_uuid_str()

        for content_type in valid_types:
            with (
                patch(
                    "web_api.routes.progress.get_transaction",
                    return_value=mock_db_connection(),
                ),
                patch(
                    "web_api.routes.progress.mark_content_complete",
                    new_callable=AsyncMock,
                ) as mock_complete,
            ):
                mock_complete.return_value = {"completed_at": None, "id": 1}
                response = make_complete_request(
                    content_id=random_uuid_str(),
                    content_type=content_type,
                    anonymous_token=anonymous_token,
                )
                # Should not return 400 for valid content types
                assert response.status_code != 400, (
                    f"content_type={content_type} returned 400"
                )


# --- Anonymous User Tests ---


class TestAnonymousProgress:
    """Tests for anonymous user progress tracking via session tokens."""

    def test_complete_with_anonymous_token_succeeds(self):
        """Anonymous user with session token can mark content complete."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
        ):
            mock_complete.return_value = {
                "id": 1,
                "completed_at": datetime.now(timezone.utc),
                "time_to_complete_s": 60,
            }

            response = make_complete_request(
                content_id=content_id,
                anonymous_token=anonymous_token,
            )

            assert response.status_code == 200
            data = response.json()
            assert "completed_at" in data
            assert data["completed_at"] is not None

            # Verify the mock was called with anonymous_token
            mock_complete.assert_called_once()
            call_kwargs = mock_complete.call_args.kwargs
            assert call_kwargs["anonymous_token"] == uuid.UUID(anonymous_token)
            assert call_kwargs["user_id"] is None

    def test_time_with_anonymous_token_returns_204(self):
        """Anonymous user with session token can update time spent."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.update_time_spent", new_callable=AsyncMock
            ) as mock_update,
        ):
            response = make_time_request(
                content_id=content_id,
                time_delta_s=30,
                anonymous_token=anonymous_token,
            )

            assert response.status_code == 204
            mock_update.assert_called_once()

    def test_time_with_anonymous_token_query_param(self):
        """Time endpoint should accept anonymous_token as query param (for sendBeacon)."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.update_time_spent", new_callable=AsyncMock
            ) as mock_update,
        ):
            response = make_time_request(
                content_id=content_id,
                time_delta_s=30,
                anonymous_token=anonymous_token,
                use_query_param=True,
            )

            assert response.status_code == 204
            mock_update.assert_called_once()


# --- Authenticated User Tests ---


class TestAuthenticatedProgress:
    """Tests for authenticated user progress tracking."""

    def test_complete_with_auth_succeeds(self):
        """Authenticated user can mark content complete."""
        content_id = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_optional_user", new_callable=AsyncMock
            ) as mock_auth,
            patch(
                "web_api.routes.progress.get_or_create_user", new_callable=AsyncMock
            ) as mock_user,
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
        ):
            mock_auth.return_value = {"sub": "123456789"}
            mock_user.return_value = {"user_id": 42, "discord_id": "123456789"}
            mock_complete.return_value = {
                "id": 1,
                "completed_at": datetime.now(timezone.utc),
                "time_to_complete_s": 60,
            }

            response = client.post(
                "/api/progress/complete",
                json={
                    "content_id": content_id,
                    "content_type": "lens",
                    "content_title": "Test Lens",
                    "time_spent_s": 60,
                },
                cookies={"auth_token": "valid_token"},
            )

            assert response.status_code == 200

            # Verify user_id was passed, not anonymous_token
            mock_complete.assert_called_once()
            call_kwargs = mock_complete.call_args.kwargs
            assert call_kwargs["user_id"] == 42
            assert call_kwargs["anonymous_token"] is None


# --- Module Progress Response Tests ---


class TestModuleProgressResponse:
    """Tests for module status calculation in complete response."""

    def test_complete_with_sibling_ids_returns_module_completed(self):
        """POST /complete with all siblings complete should return module_status=completed."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()
        sibling_ids = [random_uuid_str() for _ in range(3)]

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
            patch(
                "web_api.routes.progress.get_module_progress", new_callable=AsyncMock
            ) as mock_progress,
        ):
            mock_complete.return_value = {
                "id": 1,
                "completed_at": datetime.now(timezone.utc),
            }

            # All siblings completed
            mock_progress.return_value = {
                uuid.UUID(sid): {"completed_at": datetime.now(timezone.utc)}
                for sid in sibling_ids
            }

            response = make_complete_request(
                content_id=content_id,
                anonymous_token=anonymous_token,
                sibling_lens_ids=sibling_ids,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["module_status"] == "completed"
            assert data["module_progress"]["completed"] == 3
            assert data["module_progress"]["total"] == 3

    def test_complete_partial_progress_returns_in_progress(self):
        """Module with some lenses complete should return in_progress."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()
        sibling_ids = [random_uuid_str() for _ in range(4)]

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
            patch(
                "web_api.routes.progress.get_module_progress", new_callable=AsyncMock
            ) as mock_progress,
        ):
            mock_complete.return_value = {
                "id": 1,
                "completed_at": datetime.now(timezone.utc),
            }

            # Only 2 of 4 completed
            mock_progress.return_value = {
                uuid.UUID(sibling_ids[0]): {"completed_at": datetime.now(timezone.utc)},
                uuid.UUID(sibling_ids[1]): {"completed_at": datetime.now(timezone.utc)},
                uuid.UUID(sibling_ids[2]): {"completed_at": None},
            }

            response = make_complete_request(
                content_id=content_id,
                anonymous_token=anonymous_token,
                sibling_lens_ids=sibling_ids,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["module_status"] == "in_progress"
            assert data["module_progress"]["completed"] == 2
            assert data["module_progress"]["total"] == 4

    def test_complete_no_progress_returns_not_started(self):
        """Module with no lenses complete should return not_started."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()
        sibling_ids = [random_uuid_str() for _ in range(3)]

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
            patch(
                "web_api.routes.progress.get_module_progress", new_callable=AsyncMock
            ) as mock_progress,
        ):
            mock_complete.return_value = {
                "id": 1,
                "completed_at": None,  # Not yet completed
            }

            # No siblings have completed_at
            mock_progress.return_value = {}

            response = make_complete_request(
                content_id=content_id,
                anonymous_token=anonymous_token,
                sibling_lens_ids=sibling_ids,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["module_status"] == "not_started"


# --- Edge Cases ---


class TestProgressEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_complete_idempotent(self):
        """Marking already-completed content should be idempotent."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()
        completed_at = datetime.now(timezone.utc)

        # First call
        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
        ):
            mock_complete.return_value = {
                "id": 1,
                "completed_at": completed_at,
                "time_to_complete_s": 60,
            }

            response1 = make_complete_request(
                content_id=content_id,
                anonymous_token=anonymous_token,
            )

        # Second call (same content, new context managers)
        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
        ):
            mock_complete.return_value = {
                "id": 1,
                "completed_at": completed_at,  # Same timestamp
                "time_to_complete_s": 60,
            }

            response2 = make_complete_request(
                content_id=content_id,
                anonymous_token=anonymous_token,
            )

        assert response1.status_code == 200
        assert response2.status_code == 200

        # Both should succeed and return the same completion time
        assert response1.json()["completed_at"] == response2.json()["completed_at"]

    def test_complete_with_zero_time_spent(self):
        """Should accept time_spent_s=0."""
        anonymous_token = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
        ):
            mock_complete.return_value = {"id": 1, "completed_at": None}

            response = make_complete_request(
                content_id=random_uuid_str(),
                time_spent_s=0,
                anonymous_token=anonymous_token,
            )

            assert response.status_code == 200

    def test_time_update_with_zero_delta(self):
        """Should accept time_delta_s=0."""
        anonymous_token = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch("web_api.routes.progress.update_time_spent", new_callable=AsyncMock),
        ):
            response = make_time_request(
                content_id=random_uuid_str(),
                time_delta_s=0,
                anonymous_token=anonymous_token,
            )

            assert response.status_code == 204

    def test_complete_without_sibling_ids_omits_module_status(self):
        """POST /complete without sibling_lens_ids should not return module_status."""
        anonymous_token = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_transaction",
                return_value=mock_db_connection(),
            ),
            patch(
                "web_api.routes.progress.mark_content_complete", new_callable=AsyncMock
            ) as mock_complete,
        ):
            mock_complete.return_value = {
                "id": 1,
                "completed_at": datetime.now(timezone.utc),
            }

            response = make_complete_request(
                content_id=random_uuid_str(),
                anonymous_token=anonymous_token,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["module_status"] is None
            assert data["module_progress"] is None


# --- Module Slug Response Tests ---


class TestModuleSlugResponse:
    """Tests for full module state when module_slug provided."""

    def test_complete_with_module_slug_returns_lenses(self):
        """POST /complete with module_slug should return full lenses array."""
        from dataclasses import dataclass

        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()
        lens_id_1 = random_uuid_str()
        lens_id_2 = random_uuid_str()

        @dataclass
        class MockModule:
            slug: str = "test-module"
            title: str = "Test Module"
            content_id: str | None = None
            sections: list = None

            def __post_init__(self):
                if self.sections is None:
                    self.sections = [
                        {
                            "contentId": lens_id_1,
                            "type": "video",
                            "meta": {"title": "Video Section"},
                            "optional": False,
                        },
                        {
                            "contentId": lens_id_2,
                            "type": "article",
                            "meta": {"title": "Article Section"},
                            "optional": False,
                        },
                    ]

        with (
            patch(
                "web_api.routes.progress.get_transaction",
            ) as mock_transaction,
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "web_api.routes.progress.get_module_progress",
                new_callable=AsyncMock,
            ) as mock_progress,
            patch(
                "core.modules.loader.load_flattened_module",
            ) as mock_load_module,
        ):
            mock_transaction.return_value.__aenter__ = AsyncMock(
                return_value=MagicMock()
            )
            mock_transaction.return_value.__aexit__ = AsyncMock(return_value=None)

            mock_complete.return_value = {
                "id": 1,
                "completed_at": datetime.now(timezone.utc),
            }

            # Lens 1 is completed, lens 2 is not
            mock_progress.return_value = {
                uuid.UUID(lens_id_1): {
                    "completed_at": datetime.now(timezone.utc),
                    "total_time_spent_s": 120,
                },
            }

            mock_load_module.return_value = MockModule()

            response = client.post(
                "/api/progress/complete",
                json={
                    "content_id": content_id,
                    "content_type": "lens",
                    "content_title": "Test Lens",
                    "time_spent_s": 60,
                    "module_slug": "test-module",
                },
                headers={"X-Anonymous-Token": anonymous_token},
            )

            assert response.status_code == 200
            data = response.json()

            # Should have lenses array
            assert data["lenses"] is not None
            assert len(data["lenses"]) == 2

            # First lens should be completed
            assert data["lenses"][0]["id"] == lens_id_1
            assert data["lenses"][0]["completed"] is True
            assert data["lenses"][0]["timeSpentS"] == 120
            assert data["lenses"][0]["type"] == "video"

            # Second lens should not be completed
            assert data["lenses"][1]["id"] == lens_id_2
            assert data["lenses"][1]["completed"] is False

            # Module status should be in_progress (1 of 2 complete)
            assert data["module_status"] == "in_progress"
            assert data["module_progress"]["completed"] == 1
            assert data["module_progress"]["total"] == 2

    def test_complete_with_module_slug_not_found_skips_lenses(self):
        """POST /complete with invalid module_slug should not return lenses."""
        anonymous_token = random_uuid_str()
        content_id = random_uuid_str()

        with (
            patch(
                "web_api.routes.progress.get_transaction",
            ) as mock_transaction,
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "core.modules.loader.load_flattened_module",
            ) as mock_load_module,
        ):
            mock_transaction.return_value.__aenter__ = AsyncMock(
                return_value=MagicMock()
            )
            mock_transaction.return_value.__aexit__ = AsyncMock(return_value=None)

            mock_complete.return_value = {
                "id": 1,
                "completed_at": datetime.now(timezone.utc),
            }

            from core.modules.loader import ModuleNotFoundError

            mock_load_module.side_effect = ModuleNotFoundError("not found")

            response = client.post(
                "/api/progress/complete",
                json={
                    "content_id": content_id,
                    "content_type": "lens",
                    "content_title": "Test Lens",
                    "time_spent_s": 60,
                    "module_slug": "nonexistent-module",
                },
                headers={"X-Anonymous-Token": anonymous_token},
            )

            assert response.status_code == 200
            data = response.json()

            # Should not have lenses (module not found)
            assert data["lenses"] is None
            assert data["module_status"] is None
            assert data["module_progress"] is None
            # But should still have completed_at
            assert data["completed_at"] is not None
