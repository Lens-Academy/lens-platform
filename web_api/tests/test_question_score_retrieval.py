# web_api/tests/test_question_score_retrieval.py
"""Tests for question score retrieval endpoint.

Verifies that GET /api/questions/scores?response_id=X returns score data
extracted from JSONB, handles empty results, and validates required parameters.
Uses unit+1 style: mocks at the core query boundary.
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

MOCK_SCORE_ROW = {
    "score_id": 1,
    "response_id": 42,
    "score_data": {
        "overall_score": 4,
        "reasoning": "Good understanding of core concepts",
        "dimensions": {"accuracy": {"score": 4, "note": "Mostly correct"}},
        "key_observations": ["Shows understanding", "Could elaborate more"],
    },
    "model_id": "gpt-4o-mini",
    "prompt_version": "v1",
    "created_at": "2026-01-01T00:00:00",
}

MOCK_EMPTY_SCORE_ROW = {
    "score_id": 2,
    "response_id": 42,
    "score_data": {},
    "model_id": "gpt-4o-mini",
    "prompt_version": "v1",
    "created_at": "2026-01-01T00:00:00",
}


# --- Mock helpers ---


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


class TestScoreRetrieval:
    """Tests for GET /api/questions/scores endpoint."""

    @patch("web_api.routes.questions.get_connection", return_value=mock_connection())
    @patch("web_api.routes.questions.get_scores_for_response", new_callable=AsyncMock)
    def test_get_scores_returns_extracted_fields(
        self, mock_get_scores, mock_conn, client
    ):
        """GET /scores?response_id=42 with one score returns extracted JSONB fields."""
        mock_get_scores.return_value = [MOCK_SCORE_ROW]

        response = client.get("/api/questions/scores?response_id=42")

        assert response.status_code == 200
        data = response.json()
        assert len(data["scores"]) == 1
        score = data["scores"][0]
        assert score["score_id"] == 1
        assert score["response_id"] == 42
        assert score["overall_score"] == 4
        assert score["reasoning"] == "Good understanding of core concepts"
        assert score["dimensions"] == {
            "accuracy": {"score": 4, "note": "Mostly correct"}
        }
        assert score["key_observations"] == [
            "Shows understanding",
            "Could elaborate more",
        ]
        assert score["model_id"] == "gpt-4o-mini"
        assert score["prompt_version"] == "v1"
        assert score["created_at"] == "2026-01-01T00:00:00"

    @patch("web_api.routes.questions.get_connection", return_value=mock_connection())
    @patch("web_api.routes.questions.get_scores_for_response", new_callable=AsyncMock)
    def test_get_scores_returns_empty_list_when_no_scores(
        self, mock_get_scores, mock_conn, client
    ):
        """GET /scores?response_id=42 with no scores returns empty list."""
        mock_get_scores.return_value = []

        response = client.get("/api/questions/scores?response_id=42")

        assert response.status_code == 200
        data = response.json()
        assert data == {"scores": []}

    @patch("web_api.routes.questions.get_connection", return_value=mock_connection())
    @patch("web_api.routes.questions.get_scores_for_response", new_callable=AsyncMock)
    def test_get_scores_handles_missing_jsonb_fields(
        self, mock_get_scores, mock_conn, client
    ):
        """GET /scores with empty score_data returns None for extracted fields."""
        mock_get_scores.return_value = [MOCK_EMPTY_SCORE_ROW]

        response = client.get("/api/questions/scores?response_id=42")

        assert response.status_code == 200
        data = response.json()
        assert len(data["scores"]) == 1
        score = data["scores"][0]
        assert score["overall_score"] is None
        assert score["reasoning"] is None
        assert score["dimensions"] is None
        assert score["key_observations"] is None

    def test_get_scores_requires_response_id_param(self, client):
        """GET /scores without ?response_id returns 422 validation error."""
        response = client.get("/api/questions/scores")

        assert response.status_code == 422
