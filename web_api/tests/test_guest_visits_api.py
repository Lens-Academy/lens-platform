# web_api/tests/test_guest_visits_api.py
"""Tests for guest visit API endpoints.

Tests cover:
- GET /api/guest-visits/options - Find alternative meetings
- POST /api/guest-visits - Create a guest visit
- DELETE /api/guest-visits/{host_meeting_id} - Cancel a guest visit
- GET /api/guest-visits - List user's guest visits
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

# Ensure we import from root main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from main import app
from web_api.auth import get_current_user


@pytest.fixture(autouse=True)
def _jwt_secret():
    """Ensure JWT_SECRET is set so verify_jwt can attempt decoding."""
    with patch("web_api.auth.JWT_SECRET", "test-secret"):
        yield


@pytest.fixture
def auth_user():
    """Mock authenticated user returning discord_id as 'sub'."""
    return {"sub": "123456789", "username": "testuser"}


@pytest.fixture
def client(auth_user):
    """Create a test client with auth overridden."""

    async def override_get_current_user():
        return auth_user

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def mock_db_user():
    """A fake database user row."""
    return {
        "user_id": 42,
        "discord_id": "123456789",
        "email": "test@example.com",
        "discord_username": "testuser",
    }


class TestGetOptions:
    """GET /api/guest-visits/options?meeting_id={id}"""

    def test_returns_alternatives(self, client, mock_db_user):
        alternatives = [
            {
                "meeting_id": 10,
                "group_id": 2,
                "scheduled_at": "2026-03-01T15:00:00+00:00",
                "meeting_number": 1,
                "group_name": "Group Beta",
                "facilitator_name": "Alice",
            },
        ]
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.guest_visits.find_alternative_meetings",
                new_callable=AsyncMock,
                return_value=alternatives,
            ) as mock_find,
            patch(
                "web_api.routes.guest_visits.get_connection",
            ) as mock_conn_ctx,
        ):
            mock_conn = AsyncMock()
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.get("/api/guest-visits/options?meeting_id=5")

        assert response.status_code == 200
        data = response.json()
        assert "alternatives" in data
        assert len(data["alternatives"]) == 1
        assert data["alternatives"][0]["group_name"] == "Group Beta"
        mock_find.assert_called_once_with(mock_conn, 42, 5)

    def test_returns_404_when_user_not_found(self, client):
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "web_api.routes.guest_visits.get_connection",
            ) as mock_conn_ctx,
        ):
            mock_conn = AsyncMock()
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.get("/api/guest-visits/options?meeting_id=5")

        assert response.status_code == 404


class TestCreateGuestVisit:
    """POST /api/guest-visits"""

    def test_creates_guest_visit(self, client, mock_db_user):
        create_result = {
            "host_meeting_id": 10,
            "host_group_id": 2,
            "host_scheduled_at": "2026-03-01T15:00:00+00:00",
            "home_group_id": 1,
        }
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.guest_visits.create_guest_visit",
                new_callable=AsyncMock,
                return_value=create_result,
            ) as mock_create,
            patch(
                "web_api.routes.guest_visits.get_transaction",
            ) as mock_tx_ctx,
            patch(
                "web_api.routes.guest_visits.sync_group_discord_permissions",
                new_callable=AsyncMock,
                return_value={"granted_discord_ids": [], "revoked_discord_ids": []},
            ),
            patch(
                "web_api.routes.guest_visits.notify_guest_role_changes",
                new_callable=AsyncMock,
            ),
            patch(
                "web_api.routes.guest_visits.schedule_guest_sync",
            ),
            patch(
                "web_api.routes.guest_visits._sync_guest_calendar",
                new_callable=AsyncMock,
            ),
        ):
            mock_conn = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.post(
                "/api/guest-visits",
                json={"home_meeting_id": 5, "host_meeting_id": 10},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["host_meeting_id"] == 10
        assert data["host_group_id"] == 2
        mock_create.assert_called_once_with(mock_conn, 42, 5, 10)

    def test_returns_400_on_validation_error(self, client, mock_db_user):
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.guest_visits.create_guest_visit",
                new_callable=AsyncMock,
                side_effect=ValueError("own group"),
            ),
            patch(
                "web_api.routes.guest_visits.get_transaction",
            ) as mock_tx_ctx,
        ):
            mock_conn = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.post(
                "/api/guest-visits",
                json={"home_meeting_id": 5, "host_meeting_id": 10},
            )

        assert response.status_code == 400
        assert "own group" in response.json()["detail"]

    def test_returns_404_when_user_not_found(self, client):
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "web_api.routes.guest_visits.get_transaction",
            ) as mock_tx_ctx,
        ):
            mock_conn = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.post(
                "/api/guest-visits",
                json={"home_meeting_id": 5, "host_meeting_id": 10},
            )

        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]


class TestDeleteGuestVisit:
    """DELETE /api/guest-visits/{host_meeting_id}"""

    def test_cancels_guest_visit(self, client, mock_db_user):
        cancel_result = {
            "host_group_id": 2,
            "home_group_id": 1,
        }
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.guest_visits.cancel_guest_visit",
                new_callable=AsyncMock,
                return_value=cancel_result,
            ) as mock_cancel,
            patch(
                "web_api.routes.guest_visits.get_transaction",
            ) as mock_tx_ctx,
            patch(
                "web_api.routes.guest_visits.sync_group_discord_permissions",
                new_callable=AsyncMock,
                return_value={"granted_discord_ids": [], "revoked_discord_ids": []},
            ),
            patch(
                "web_api.routes.guest_visits.notify_guest_role_changes",
                new_callable=AsyncMock,
            ),
            patch(
                "web_api.routes.guest_visits._sync_guest_calendar",
                new_callable=AsyncMock,
            ),
        ):
            mock_conn = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.delete("/api/guest-visits/10")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cancelled"
        mock_cancel.assert_called_once_with(mock_conn, 42, 10)

    def test_returns_400_on_validation_error(self, client, mock_db_user):
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.guest_visits.cancel_guest_visit",
                new_callable=AsyncMock,
                side_effect=ValueError("already started"),
            ),
            patch(
                "web_api.routes.guest_visits.get_transaction",
            ) as mock_tx_ctx,
        ):
            mock_conn = AsyncMock()
            mock_tx_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.delete("/api/guest-visits/10")

        assert response.status_code == 400
        assert "already started" in response.json()["detail"]


class TestListGuestVisits:
    """GET /api/guest-visits"""

    def test_returns_visits(self, client, mock_db_user):
        visits = [
            {
                "attendance_id": 1,
                "meeting_id": 10,
                "group_id": 2,
                "scheduled_at": "2026-03-01T15:00:00+00:00",
                "meeting_number": 1,
                "group_name": "Group Beta",
                "is_past": False,
                "can_cancel": True,
            },
        ]
        with (
            patch(
                "web_api.routes.guest_visits.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.guest_visits.get_user_guest_visits",
                new_callable=AsyncMock,
                return_value=visits,
            ) as mock_get_visits,
            patch(
                "web_api.routes.guest_visits.get_connection",
            ) as mock_conn_ctx,
        ):
            mock_conn = AsyncMock()
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.get("/api/guest-visits")

        assert response.status_code == 200
        data = response.json()
        assert "visits" in data
        assert len(data["visits"]) == 1
        assert data["visits"][0]["group_name"] == "Group Beta"
        mock_get_visits.assert_called_once_with(mock_conn, 42)
