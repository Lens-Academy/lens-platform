"""Tests for /ref/{slug} click handler route."""

import sys
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from fastapi.testclient import TestClient

from main import app

client = TestClient(app, follow_redirects=False)


@asynccontextmanager
async def _fake_transaction():
    yield None


MOCK_LINK = {
    "link_id": 42,
    "user_id": 1,
    "slug": "kate-smith",
    "name": "Kate Smith",
    "is_default": True,
    "deleted_at": None,
}


class TestRefClick:
    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_valid_slug_redirects_and_logs_click(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        mock_get_link.return_value = MOCK_LINK
        response = client.get("/ref/kate-smith")
        assert response.status_code == 302
        assert response.headers["location"] == "/?ref=kate-smith"
        mock_log_click.assert_called_once_with(None, 42)

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_invalid_slug_redirects_but_does_not_log(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        mock_get_link.return_value = None
        response = client.get("/ref/nonexistent")
        assert response.status_code == 302
        assert response.headers["location"] == "/?ref=nonexistent"
        mock_log_click.assert_not_called()

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_no_ref_cookie_without_marketing_consent(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        mock_get_link.return_value = MOCK_LINK
        response = client.get("/ref/kate-smith")
        assert "ref" not in response.cookies

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_ref_cookie_set_with_marketing_consent(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        mock_get_link.return_value = MOCK_LINK
        response = client.get(
            "/ref/kate-smith",
            cookies={"marketing-consent": "accepted"},
        )
        assert response.cookies.get("ref") == "kate-smith"

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_no_ref_cookie_for_invalid_slug_even_with_consent(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        mock_get_link.return_value = None
        response = client.get(
            "/ref/nonexistent",
            cookies={"marketing-consent": "accepted"},
        )
        assert "ref" not in response.cookies
