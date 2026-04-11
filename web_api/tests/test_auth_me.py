"""Tests for GET /auth/me endpoint behavior."""

import pytest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _jwt_secret():
    """Ensure JWT_SECRET is set so verify_jwt can attempt decoding."""
    with patch("web_api.auth.JWT_SECRET", "test-secret"):
        yield


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    from main import app

    return TestClient(app)


class TestAuthMeUnauthenticated:
    """When no session cookie is present, /auth/me should return 401.

    This enables fetchWithRefresh to trigger the refresh token flow,
    keeping users logged in for the full 30-day refresh token lifetime.
    """

    def test_no_session_cookie_returns_401(self, client):
        """A request with no session cookie should get 401."""
        response = client.get("/auth/me")
        assert response.status_code == 401
        assert response.json()["detail"] == "Not authenticated"

    def test_invalid_jwt_returns_401(self, client):
        """A request with an invalid/expired JWT should get 401."""
        client.cookies.set("session", "invalid.jwt.token")
        response = client.get("/auth/me")
        assert response.status_code == 401
        assert response.json()["detail"] == "Not authenticated"


class TestAuthMeAuthenticated:
    """When a valid JWT is present, /auth/me should return 200 with user data."""

    def test_valid_jwt_but_no_db_user_returns_200_unauthenticated(self, client):
        """Valid JWT but user not in DB returns 200 with authenticated: false.

        This case should NOT return 401 because a refresh wouldn't help —
        the user genuinely doesn't exist in the database.
        """
        with patch(
            "web_api.routes.auth.get_optional_user", new_callable=AsyncMock
        ) as mock_get_user:
            mock_get_user.return_value = {"sub": "123456", "username": "testuser"}
            with patch(
                "web_api.routes.auth.get_user_profile", new_callable=AsyncMock
            ) as mock_profile:
                mock_profile.return_value = None
                response = client.get("/auth/me")
                assert response.status_code == 200
                assert response.json()["authenticated"] is False
