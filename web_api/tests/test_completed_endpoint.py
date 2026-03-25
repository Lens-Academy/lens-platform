"""Tests for GET /api/progress/completed endpoint."""

import sys
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

# Ensure we import from root main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from main import app

client = TestClient(app)


def test_returns_completed_ids_for_authenticated_user():
    """Authenticated user gets their completed content IDs."""
    mock_ids = {"aaaa-bbbb", "cccc-dddd"}

    @asynccontextmanager
    async def fake_conn():
        yield AsyncMock()

    with (
        patch(
            "web_api.routes.progress.get_optional_user", new_callable=AsyncMock
        ) as mock_auth,
        patch(
            "web_api.routes.progress.get_or_create_user", new_callable=AsyncMock
        ) as mock_user,
        patch("web_api.routes.progress.get_connection", fake_conn),
        patch(
            "web_api.routes.progress.get_completed_content_ids", new_callable=AsyncMock
        ) as mock_get,
    ):
        mock_auth.return_value = {"sub": "discord-123"}
        mock_user.return_value = {"user_id": 42}
        mock_get.return_value = mock_ids

        resp = client.get("/api/progress/completed")

    assert resp.status_code == 200
    data = resp.json()
    assert set(data["completed"]) == {"aaaa-bbbb", "cccc-dddd"}


def test_returns_401_for_unauthenticated_user():
    """Unauthenticated user gets 401."""
    with patch(
        "web_api.routes.progress.get_optional_user", new_callable=AsyncMock
    ) as mock_auth:
        mock_auth.return_value = None

        resp = client.get("/api/progress/completed")

    assert resp.status_code == 401
