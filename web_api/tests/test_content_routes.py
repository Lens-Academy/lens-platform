# web_api/tests/test_content_routes.py
"""Tests for content management API endpoints."""

import hashlib
import hmac
import json
import sys
from pathlib import Path
from unittest.mock import patch, AsyncMock

# Ensure we import from root main.py, not web_api/main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402


client = TestClient(app)


# --- Helper functions ---


def compute_signature(payload: bytes, secret: str) -> str:
    """Compute GitHub webhook signature for testing."""
    sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


def make_push_payload(
    commit_sha: str = "abc123def456",
    ref: str = "refs/heads/staging",
) -> dict:
    """Create a mock GitHub push webhook payload."""
    return {
        "ref": ref,
        "after": commit_sha,
        "repository": {"full_name": "lucbrinkman/lens-educational-content"},
    }


# --- Webhook endpoint tests ---


def test_webhook_valid_signature_succeeds():
    """Webhook with valid signature and correct branch triggers refresh."""
    secret = "test-webhook-secret"
    payload = make_push_payload(commit_sha="abc123def456", ref="refs/heads/staging")
    payload_bytes = json.dumps(payload).encode()
    signature = compute_signature(payload_bytes, secret)

    with patch.dict(
        "os.environ",
        {"GITHUB_WEBHOOK_SECRET": secret, "EDUCATIONAL_CONTENT_BRANCH": "staging"},
    ):
        with patch(
            "web_api.routes.content.handle_content_update", new_callable=AsyncMock
        ) as mock_handler:
            mock_handler.return_value = {
                "status": "ok",
                "message": "Cache refreshed (1 refresh(es))",
                "commit_sha": "abc123def456",
            }

            response = client.post(
                "/api/content/webhook",
                content=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Hub-Signature-256": signature,
                    "X-GitHub-Event": "push",
                },
            )

            assert response.status_code == 200
            assert response.json()["status"] == "ok"
            mock_handler.assert_called_once_with("abc123def456")


def test_webhook_invalid_signature_returns_401():
    """Webhook with invalid signature returns 401 Unauthorized."""
    secret = "test-webhook-secret"
    payload = make_push_payload()
    payload_bytes = json.dumps(payload).encode()
    # Use wrong secret to compute signature
    wrong_signature = compute_signature(payload_bytes, "wrong-secret")

    with patch.dict(
        "os.environ",
        {"GITHUB_WEBHOOK_SECRET": secret, "EDUCATIONAL_CONTENT_BRANCH": "staging"},
    ):
        response = client.post(
            "/api/content/webhook",
            content=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": wrong_signature,
                "X-GitHub-Event": "push",
            },
        )

        assert response.status_code == 401
        assert "verification failed" in response.json()["detail"].lower()


def test_webhook_missing_signature_returns_401():
    """Webhook without signature header returns 401."""
    secret = "test-webhook-secret"
    payload = make_push_payload()
    payload_bytes = json.dumps(payload).encode()

    with patch.dict(
        "os.environ",
        {"GITHUB_WEBHOOK_SECRET": secret, "EDUCATIONAL_CONTENT_BRANCH": "staging"},
    ):
        response = client.post(
            "/api/content/webhook",
            content=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "X-GitHub-Event": "push",
            },
        )

        assert response.status_code == 401
        assert "invalid signature" in response.json()["detail"].lower()


def test_webhook_missing_secret_returns_401():
    """Webhook without GITHUB_WEBHOOK_SECRET configured returns 401."""
    payload = make_push_payload()
    payload_bytes = json.dumps(payload).encode()
    # Some signature (doesn't matter since secret isn't configured)
    signature = "sha256=abcdef123456"

    # Make sure GITHUB_WEBHOOK_SECRET is not set
    with patch.dict(
        "os.environ", {"EDUCATIONAL_CONTENT_BRANCH": "staging"}, clear=False
    ):
        # Remove the key if it exists
        import os

        original = os.environ.pop("GITHUB_WEBHOOK_SECRET", None)
        try:
            response = client.post(
                "/api/content/webhook",
                content=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Hub-Signature-256": signature,
                    "X-GitHub-Event": "push",
                },
            )

            assert response.status_code == 401
            assert "not configured" in response.json()["detail"].lower()
        finally:
            if original:
                os.environ["GITHUB_WEBHOOK_SECRET"] = original


def test_webhook_wrong_branch_ignored():
    """Push to non-watched branch is ignored."""
    secret = "test-webhook-secret"
    # Push to 'main' but watching 'staging'
    payload = make_push_payload(commit_sha="abc123", ref="refs/heads/main")
    payload_bytes = json.dumps(payload).encode()
    signature = compute_signature(payload_bytes, secret)

    with patch.dict(
        "os.environ",
        {"GITHUB_WEBHOOK_SECRET": secret, "EDUCATIONAL_CONTENT_BRANCH": "staging"},
    ):
        response = client.post(
            "/api/content/webhook",
            content=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": signature,
                "X-GitHub-Event": "push",
            },
        )

        assert response.status_code == 200
        assert response.json()["status"] == "ignored"
        assert "staging" in response.json()["message"]


def test_webhook_non_push_event_ignored():
    """Non-push events are ignored."""
    secret = "test-webhook-secret"
    payload = {"action": "created"}  # Not a push payload
    payload_bytes = json.dumps(payload).encode()
    signature = compute_signature(payload_bytes, secret)

    with patch.dict(
        "os.environ",
        {"GITHUB_WEBHOOK_SECRET": secret, "EDUCATIONAL_CONTENT_BRANCH": "staging"},
    ):
        response = client.post(
            "/api/content/webhook",
            content=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": signature,
                "X-GitHub-Event": "issues",  # Not 'push'
            },
        )

        assert response.status_code == 200
        assert response.json()["status"] == "ignored"
        assert "issues" in response.json()["message"]


def test_webhook_missing_commit_sha_returns_400():
    """Push payload without 'after' SHA returns 400."""
    secret = "test-webhook-secret"
    payload = {"ref": "refs/heads/staging"}  # Missing 'after'
    payload_bytes = json.dumps(payload).encode()
    signature = compute_signature(payload_bytes, secret)

    with patch.dict(
        "os.environ",
        {"GITHUB_WEBHOOK_SECRET": secret, "EDUCATIONAL_CONTENT_BRANCH": "staging"},
    ):
        response = client.post(
            "/api/content/webhook",
            content=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": signature,
                "X-GitHub-Event": "push",
            },
        )

        assert response.status_code == 400
        assert "commit SHA" in response.json()["detail"]


def test_webhook_handler_failure_returns_500():
    """Handler failure returns 500."""
    secret = "test-webhook-secret"
    payload = make_push_payload(commit_sha="abc123", ref="refs/heads/staging")
    payload_bytes = json.dumps(payload).encode()
    signature = compute_signature(payload_bytes, secret)

    with patch.dict(
        "os.environ",
        {"GITHUB_WEBHOOK_SECRET": secret, "EDUCATIONAL_CONTENT_BRANCH": "staging"},
    ):
        with patch(
            "web_api.routes.content.handle_content_update", new_callable=AsyncMock
        ) as mock_handler:
            mock_handler.side_effect = Exception("GitHub API error")

            response = client.post(
                "/api/content/webhook",
                content=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Hub-Signature-256": signature,
                    "X-GitHub-Event": "push",
                },
            )

            assert response.status_code == 500
            assert "GitHub API error" in response.json()["detail"]


# --- Manual refresh endpoint tests ---


def test_manual_refresh_succeeds():
    """Manual refresh endpoint works."""
    with patch(
        "web_api.routes.content.refresh_cache", new_callable=AsyncMock
    ) as mock_refresh:
        response = client.post("/api/content/refresh")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        mock_refresh.assert_called_once()


def test_manual_refresh_failure_returns_500():
    """Manual refresh failure returns 500."""
    with patch(
        "web_api.routes.content.refresh_cache", new_callable=AsyncMock
    ) as mock_refresh:
        mock_refresh.side_effect = Exception("Network error")

        response = client.post("/api/content/refresh")

        assert response.status_code == 500
        assert "Network error" in response.json()["detail"]
