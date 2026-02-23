# web_api/tests/test_questions_scoring.py
"""Tests for AI scoring trigger conditions in question response endpoints.

Verifies that enqueue_scoring is called only when a response is marked
complete (completed_at transitions to a timestamp) via PATCH, and never
on draft saves or POST creates. Uses unit+1 style: mocks at the
enqueue_scoring boundary (LLM + DB write behind it).
"""

import sys
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

# Ensure we import from root main.py, not web_api/main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from main import app
from web_api.auth import get_user_or_anonymous

# --- Constants ---

MOCK_USER = (UUID("00000000-0000-0000-0000-000000000001"), None)

MOCK_ROW = {
    "response_id": 42,
    "question_id": "test-module:0:0",
    "module_slug": "test-module",
    "question_text": "What is AI safety?",
    "question_hash": "abc123",
    "answer_text": "My answer",
    "answer_metadata": {},
    "created_at": "2026-01-01T00:00:00",
    "completed_at": "2026-01-01T00:00:00",
    "assessment_instructions": None,
}

MOCK_ROW_DRAFT = {
    **MOCK_ROW,
    "completed_at": None,
}

MOCK_POST_ROW = {
    "response_id": 99,
    "question_id": "test-module:0:0",
    "module_slug": "test-module",
    "question_text": "What is AI safety?",
    "question_hash": "abc123",
    "answer_text": "New answer",
    "answer_metadata": {},
    "created_at": "2026-01-01T00:00:00",
    "completed_at": None,
    "assessment_instructions": None,
}


# --- Mock helpers ---


@asynccontextmanager
async def mock_transaction():
    """Mock async context manager for get_transaction."""
    yield MagicMock()


@asynccontextmanager
async def mock_connection():
    """Mock async context manager for get_connection."""
    yield MagicMock()


# --- Fixtures ---


@pytest.fixture
def client():
    """Create test client with auth override."""
    app.dependency_overrides[get_user_or_anonymous] = lambda: MOCK_USER
    yield TestClient(app)
    app.dependency_overrides.clear()


# --- Tests ---


class TestScoringTrigger:
    """Tests for scoring trigger conditions on PATCH and POST endpoints."""

    @patch("web_api.routes.questions.get_transaction", return_value=mock_transaction())
    @patch("web_api.routes.questions.update_response", new_callable=AsyncMock)
    @patch("web_api.routes.questions.enqueue_scoring")
    def test_patch_with_completed_at_triggers_scoring(
        self, mock_enqueue, mock_update, mock_tx, client
    ):
        """PATCH with completed_at set should trigger enqueue_scoring."""
        mock_update.return_value = MOCK_ROW

        response = client.patch(
            "/api/questions/responses/42",
            json={"completed_at": "2026-01-01T00:00:00Z"},
        )

        assert response.status_code == 200
        mock_enqueue.assert_called_once_with(
            response_id=42,
            question_context={
                "question_id": "test-module:0:0",
                "module_slug": "test-module",
                "answer_text": "My answer",
                "question_text": "What is AI safety?",
                "assessment_instructions": None,
            },
        )

    @patch("web_api.routes.questions.get_transaction", return_value=mock_transaction())
    @patch("web_api.routes.questions.update_response", new_callable=AsyncMock)
    @patch("web_api.routes.questions.enqueue_scoring")
    def test_patch_without_completed_at_does_not_trigger_scoring(
        self, mock_enqueue, mock_update, mock_tx, client
    ):
        """PATCH with only answer_text (draft save) should NOT trigger scoring."""
        mock_update.return_value = MOCK_ROW_DRAFT

        response = client.patch(
            "/api/questions/responses/42",
            json={"answer_text": "updated draft"},
        )

        assert response.status_code == 200
        mock_enqueue.assert_not_called()

    @patch("web_api.routes.questions.get_transaction", return_value=mock_transaction())
    @patch("web_api.routes.questions.update_response", new_callable=AsyncMock)
    @patch("web_api.routes.questions.enqueue_scoring")
    def test_patch_with_empty_completed_at_does_not_trigger_scoring(
        self, mock_enqueue, mock_update, mock_tx, client
    ):
        """PATCH with completed_at="" (clearing) should NOT trigger scoring."""
        mock_update.return_value = MOCK_ROW_DRAFT

        response = client.patch(
            "/api/questions/responses/42",
            json={"completed_at": ""},
        )

        assert response.status_code == 200
        mock_enqueue.assert_not_called()

    @patch("web_api.routes.questions.get_transaction", return_value=mock_transaction())
    @patch("web_api.routes.questions.submit_response", new_callable=AsyncMock)
    @patch("web_api.routes.questions.enqueue_scoring")
    def test_post_does_not_trigger_scoring(
        self, mock_enqueue, mock_submit, mock_tx, client
    ):
        """POST (create new response) should NOT trigger scoring."""
        mock_submit.return_value = MOCK_POST_ROW

        response = client.post(
            "/api/questions/responses",
            json={
                "question_id": "test-module:0:0",
                "module_slug": "test-module",
                "question_text": "What is AI safety?",
                "answer_text": "New answer",
                "answer_metadata": {},
            },
        )

        assert response.status_code == 201
        mock_enqueue.assert_not_called()

    @patch("web_api.routes.questions.get_transaction", return_value=mock_transaction())
    @patch("web_api.routes.questions.update_response", new_callable=AsyncMock)
    @patch("web_api.routes.questions.enqueue_scoring")
    def test_patch_returns_without_waiting_for_scoring(
        self, mock_enqueue, mock_update, mock_tx, client
    ):
        """PATCH with completed_at should return 200 immediately; enqueue_scoring is sync (fire-and-forget)."""
        mock_update.return_value = MOCK_ROW

        response = client.patch(
            "/api/questions/responses/42",
            json={"completed_at": "2026-01-01T00:00:00Z"},
        )

        assert response.status_code == 200
        # enqueue_scoring is a sync function (creates asyncio.Task internally)
        # so the response returns without waiting for scoring
        mock_enqueue.assert_called_once()
        # Verify response body is present (not blocked)
        data = response.json()
        assert data["response_id"] == 42
