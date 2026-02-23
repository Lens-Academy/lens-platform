# web_api/tests/test_user_meetings_api.py
"""Tests for GET /api/users/me/meetings endpoint.

Tests cover:
- Returns 200 with meetings list when user has an active group
- Returns empty meetings list when user has no active group
- Returns 404 when user not found
"""

import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

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


class TestGetMyMeetings:
    """GET /api/users/me/meetings"""

    def test_returns_upcoming_meetings(self, client, mock_db_user):
        """User with an active group gets their upcoming meetings."""
        group_row = {"group_id": 5}
        meeting_rows = [
            {
                "meeting_id": 10,
                "meeting_number": 3,
                "scheduled_at": datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc),
                "group_name": "Group Alpha",
            },
            {
                "meeting_id": 11,
                "meeting_number": 4,
                "scheduled_at": datetime(2026, 3, 22, 14, 0, tzinfo=timezone.utc),
                "group_name": "Group Alpha",
            },
        ]

        mock_conn = AsyncMock()

        # First execute: groups_users query -> returns group_row
        # Second execute: meetings query -> returns meeting rows
        group_result = MagicMock()
        group_result.mappings.return_value.first.return_value = group_row

        meetings_result = MagicMock()
        meetings_result.mappings.return_value = meeting_rows

        mock_conn.execute = AsyncMock(side_effect=[group_result, meetings_result])

        with (
            patch(
                "web_api.routes.users.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.users.get_connection",
            ) as mock_conn_ctx,
        ):
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.get("/api/users/me/meetings")

        assert response.status_code == 200
        data = response.json()
        assert "meetings" in data
        assert len(data["meetings"]) == 2
        assert data["meetings"][0]["meeting_id"] == 10
        assert data["meetings"][0]["group_name"] == "Group Alpha"
        assert data["meetings"][0]["scheduled_at"] == "2026-03-15T14:00:00+00:00"
        assert data["meetings"][1]["meeting_id"] == 11

    def test_returns_empty_when_no_active_group(self, client, mock_db_user):
        """User with no active group gets an empty meetings list."""
        mock_conn = AsyncMock()

        # groups_users query returns no rows
        group_result = MagicMock()
        group_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=group_result)

        with (
            patch(
                "web_api.routes.users.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=mock_db_user,
            ),
            patch(
                "web_api.routes.users.get_connection",
            ) as mock_conn_ctx,
        ):
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.get("/api/users/me/meetings")

        assert response.status_code == 200
        data = response.json()
        assert data == {"meetings": []}

    def test_returns_404_when_user_not_found(self, client):
        """Returns 404 when the authenticated user has no DB record."""
        mock_conn = AsyncMock()

        with (
            patch(
                "web_api.routes.users.get_user_by_discord_id",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "web_api.routes.users.get_connection",
            ) as mock_conn_ctx,
        ):
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            response = client.get("/api/users/me/meetings")

        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
