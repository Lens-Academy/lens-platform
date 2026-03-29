"""Tests for /api/referrals/* CRUD and admin endpoints."""

import sys
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

import pytest
from fastapi.testclient import TestClient

from main import app
from web_api.auth import get_current_user, require_admin


# ── Helpers ──────────────────────────────────────────────────


def _fake_user():
    return {"sub": "discord-123", "username": "testuser"}


def _fake_admin():
    return {"sub": "discord-admin", "username": "admin", "is_admin": True}


@asynccontextmanager
async def _fake_connection():
    yield None


@asynccontextmanager
async def _fake_transaction():
    yield None


FAKE_DB_USER = {"user_id": 1, "discord_id": "discord-123"}

FAKE_LINK = {
    "link_id": 10,
    "user_id": 1,
    "slug": "testuser",
    "name": "Test User",
    "is_default": True,
    "deleted_at": None,
    "created_at": "2025-01-01T00:00:00Z",
}

FAKE_CAMPAIGN_LINK = {
    "link_id": 11,
    "user_id": 1,
    "slug": "testuser-summer",
    "name": "Summer 2025",
    "is_default": False,
    "deleted_at": None,
    "created_at": "2025-01-02T00:00:00Z",
}

FAKE_STATS = {"clicks": 5, "signups": 2, "enrolled": 1, "completed": 0}


# ── Fixtures ─────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def override_auth():
    """Override auth dependencies for all tests in this module."""
    app.dependency_overrides[get_current_user] = _fake_user
    app.dependency_overrides[require_admin] = _fake_admin
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(require_admin, None)


client = TestClient(app)


# ── User-facing CRUD tests ──────────────────────────────────


class TestListLinks:
    @patch("web_api.routes.referrals.get_connection", return_value=_fake_connection())
    @patch("web_api.routes.referrals.get_link_stats", new_callable=AsyncMock)
    @patch("web_api.routes.referrals.get_user_links", new_callable=AsyncMock)
    @patch("web_api.routes.referrals.get_user_by_discord_id", new_callable=AsyncMock)
    def test_list_links_returns_links_with_stats(
        self, mock_get_user, mock_get_links, mock_get_stats, mock_conn
    ):
        mock_get_user.return_value = FAKE_DB_USER
        mock_get_links.return_value = [FAKE_LINK]
        mock_get_stats.return_value = FAKE_STATS

        response = client.get("/api/referrals/links")
        assert response.status_code == 200
        data = response.json()
        assert len(data["links"]) == 1
        link = data["links"][0]
        assert link["slug"] == "testuser"
        assert link["clicks"] == 5
        assert link["signups"] == 2


class TestCreateLink:
    @patch("web_api.routes.referrals.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.referrals.create_campaign_link", new_callable=AsyncMock)
    @patch("web_api.routes.referrals.get_user_by_discord_id", new_callable=AsyncMock)
    def test_create_campaign_link(self, mock_get_user, mock_create, mock_txn):
        mock_get_user.return_value = FAKE_DB_USER
        mock_create.return_value = FAKE_CAMPAIGN_LINK

        response = client.post("/api/referrals/links", json={"name": "Summer 2025"})
        assert response.status_code == 200
        data = response.json()
        assert data["link"]["slug"] == "testuser-summer"

    def test_create_link_rejects_invalid_slug(self):
        response = client.post(
            "/api/referrals/links",
            json={"name": "Bad", "slug": "1invalid"},
        )
        assert response.status_code == 400
        assert "Invalid slug" in response.json()["detail"]


class TestUpdateLink:
    @patch("web_api.routes.referrals.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.referrals.update_link", new_callable=AsyncMock)
    @patch("web_api.routes.referrals.get_user_by_discord_id", new_callable=AsyncMock)
    def test_update_link(self, mock_get_user, mock_update, mock_txn):
        mock_get_user.return_value = FAKE_DB_USER
        updated = {**FAKE_CAMPAIGN_LINK, "name": "Winter 2025"}
        mock_update.return_value = updated

        response = client.patch("/api/referrals/links/11", json={"name": "Winter 2025"})
        assert response.status_code == 200
        assert response.json()["link"]["name"] == "Winter 2025"

    def test_update_link_rejects_invalid_slug(self):
        response = client.patch("/api/referrals/links/11", json={"slug": "AB"})
        assert response.status_code == 400
        assert "Invalid slug" in response.json()["detail"]


class TestDeleteLink:
    @patch("web_api.routes.referrals.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.referrals.soft_delete_link", new_callable=AsyncMock)
    @patch("web_api.routes.referrals.get_user_by_discord_id", new_callable=AsyncMock)
    def test_soft_delete_campaign_link(self, mock_get_user, mock_delete, mock_txn):
        mock_get_user.return_value = FAKE_DB_USER
        mock_delete.return_value = None

        response = client.delete("/api/referrals/links/11")
        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    @patch("web_api.routes.referrals.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.referrals.soft_delete_link", new_callable=AsyncMock)
    @patch("web_api.routes.referrals.get_user_by_discord_id", new_callable=AsyncMock)
    def test_delete_refuses_default_link(self, mock_get_user, mock_delete, mock_txn):
        mock_get_user.return_value = FAKE_DB_USER
        mock_delete.side_effect = ValueError("Cannot delete default referral link")

        response = client.delete("/api/referrals/links/10")
        assert response.status_code == 400
        assert "default" in response.json()["detail"]


# ── Admin endpoint tests ─────────────────────────────────────


class TestAdminOverview:
    @patch("web_api.routes.referrals.get_connection", return_value=_fake_connection())
    @patch("web_api.routes.referrals.get_all_referrer_stats", new_callable=AsyncMock)
    def test_admin_overview_returns_totals(self, mock_stats, mock_conn):
        mock_stats.return_value = [
            {
                "user_id": 1,
                "nickname": "Test",
                "discord_username": "testuser",
                "links": 2,
                "clicks": 10,
                "signups": 3,
                "enrolled": 2,
                "completed": 1,
            }
        ]

        response = client.get("/api/admin/referrals/overview")
        assert response.status_code == 200
        data = response.json()
        assert data["total"]["clicks"] == 10
        assert data["total"]["signups"] == 3
        assert data["total"]["referrers"] == 1


class TestAdminReferrerDetail:
    @patch("web_api.routes.referrals.get_connection", return_value=_fake_connection())
    @patch("web_api.routes.referrals.get_link_stats", new_callable=AsyncMock)
    @patch("web_api.routes.referrals.get_user_links", new_callable=AsyncMock)
    def test_referrer_detail_returns_per_link_stats(
        self, mock_get_links, mock_get_stats, mock_conn
    ):
        mock_get_links.return_value = [FAKE_LINK, FAKE_CAMPAIGN_LINK]
        mock_get_stats.return_value = FAKE_STATS

        response = client.get("/api/admin/referrals/referrers/1")
        assert response.status_code == 200
        data = response.json()
        assert len(data["links"]) == 2
        assert data["links"][0]["clicks"] == 5
