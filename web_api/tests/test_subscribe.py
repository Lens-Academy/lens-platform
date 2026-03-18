"""Tests for POST /api/subscribe — field extraction and routing to register_prospect."""

import pytest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _clear_rate_limit():
    """Reset in-memory rate limiter between tests."""
    from web_api.routes.subscribe import _rate_limit

    _rate_limit.clear()


@pytest.fixture
def mock_register():
    """Mock register_prospect at the route-level import (DB boundary)."""
    with patch(
        "web_api.routes.subscribe.register_prospect", new_callable=AsyncMock
    ) as m:
        m.return_value = True
        yield m


@pytest.fixture
def client():
    from main import app

    return TestClient(app)


class TestSubscribeNavigator:
    """Widget sends subscribe_courses_navigators: true for navigator signups."""

    def test_navigator_subscription_passes_flag_to_register(
        self, client, mock_register
    ):
        """When widget sends navigator=true, register_prospect receives it."""
        response = client.post(
            "/api/subscribe",
            json={
                "email": "nav@example.com",
                "subscribe_courses_learners": False,
                "subscribe_courses_navigators": True,
                "subscribe_substack": False,
            },
        )

        assert response.status_code == 200
        assert response.json() == {"ok": True}

        mock_register.assert_called_once()
        call_kwargs = mock_register.call_args[1]
        assert call_kwargs["subscribe_courses_navigators"] is True
        assert call_kwargs["subscribe_courses_learners"] is False

    def test_learner_subscription_passes_flag_to_register(self, client, mock_register):
        """When widget sends learner=true, register_prospect receives it."""
        response = client.post(
            "/api/subscribe",
            json={
                "email": "learn@example.com",
                "subscribe_courses_learners": True,
                "subscribe_courses_navigators": False,
                "subscribe_substack": False,
            },
        )

        assert response.status_code == 200
        mock_register.assert_called_once()
        call_kwargs = mock_register.call_args[1]
        assert call_kwargs["subscribe_courses_learners"] is True
        assert call_kwargs["subscribe_courses_navigators"] is False


class TestSubscribeLegacyBackwardCompat:
    """Old callers sending subscribe_courses should map to learners."""

    def test_legacy_subscribe_courses_maps_to_learners(self, client, mock_register):
        response = client.post(
            "/api/subscribe",
            json={
                "email": "old@example.com",
                "subscribe_courses": True,
                "subscribe_substack": False,
            },
        )

        assert response.status_code == 200
        mock_register.assert_called_once()
        call_kwargs = mock_register.call_args[1]
        assert call_kwargs["subscribe_courses_learners"] is True
        assert call_kwargs["subscribe_courses_navigators"] is False


class TestSubscribeValidation:
    """Validation rejects requests with no subscriptions selected."""

    def test_no_options_selected_returns_400(self, client, mock_register):
        response = client.post(
            "/api/subscribe",
            json={
                "email": "test@example.com",
                "subscribe_courses_learners": False,
                "subscribe_courses_navigators": False,
                "subscribe_substack": False,
            },
        )

        assert response.status_code == 400
        assert "at least one option" in response.json()["detail"]
        mock_register.assert_not_called()
