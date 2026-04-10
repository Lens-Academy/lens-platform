"""Tests for Zoom Reports API participant fetching."""

import pytest
from unittest.mock import AsyncMock, patch

import httpx

from core.zoom.participants import get_meeting_participants


ZOOM_MEETING_ID = 12345678901


def _make_participant(email: str, name: str = "Test User") -> dict:
    """Build a realistic Zoom participant dict."""
    return {
        "id": "abc123",
        "name": name,
        "user_email": email,
        "join_time": "2026-04-07T15:00:00Z",
        "leave_time": "2026-04-07T16:00:00Z",
        "duration": 3600,
        "status": "in_meeting",
    }


class TestGetMeetingParticipants:
    @pytest.mark.asyncio
    async def test_returns_participant_list(self):
        """Returns list of participants from a single-page response."""
        participants = [_make_participant("alice@example.com")]
        mock_response = {
            "page_size": 300,
            "total_records": 1,
            "participants": participants,
        }

        with patch(
            "core.zoom.participants.zoom_request",
            new_callable=AsyncMock,
            return_value=mock_response,
        ):
            result = await get_meeting_participants(ZOOM_MEETING_ID)

        assert result is not None
        assert len(result) == 1
        assert result[0]["user_email"] == "alice@example.com"

    @pytest.mark.asyncio
    async def test_returns_none_on_404(self):
        """Returns None when meeting doesn't exist (HTTP 404)."""
        response = httpx.Response(404, request=httpx.Request("GET", "https://test"))
        error = httpx.HTTPStatusError(
            "Not Found", request=response.request, response=response
        )

        with patch(
            "core.zoom.participants.zoom_request",
            new_callable=AsyncMock,
            side_effect=error,
        ):
            result = await get_meeting_participants(ZOOM_MEETING_ID)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_3001(self):
        """Returns None when meeting report not yet available (HTTP 400, code 3001)."""
        response = httpx.Response(
            400,
            json={"code": 3001, "message": "Meeting report is not available."},
            request=httpx.Request("GET", "https://test"),
        )
        error = httpx.HTTPStatusError(
            "Bad Request", request=response.request, response=response
        )

        with patch(
            "core.zoom.participants.zoom_request",
            new_callable=AsyncMock,
            side_effect=error,
        ):
            result = await get_meeting_participants(ZOOM_MEETING_ID)

        assert result is None

    @pytest.mark.asyncio
    async def test_paginates(self):
        """Concatenates participants across multiple pages."""
        page1 = {
            "page_size": 300,
            "next_page_token": "token123",
            "participants": [_make_participant("alice@example.com")],
        }
        page2 = {
            "page_size": 300,
            "next_page_token": "",
            "participants": [_make_participant("bob@example.com")],
        }

        mock_request = AsyncMock(side_effect=[page1, page2])

        with patch("core.zoom.participants.zoom_request", mock_request):
            result = await get_meeting_participants(ZOOM_MEETING_ID)

        assert result is not None
        assert len(result) == 2
        emails = {p["user_email"] for p in result}
        assert emails == {"alice@example.com", "bob@example.com"}

        # Verify pagination triggered a second call
        assert mock_request.call_count == 2

    @pytest.mark.asyncio
    async def test_filters_empty_emails(self):
        """Excludes participants with empty or missing email."""
        participants = [
            _make_participant("alice@example.com"),
            {**_make_participant(""), "name": "No Email"},
            {**_make_participant("bob@example.com")},
        ]
        # Add one with missing user_email key
        no_email = _make_participant("")
        del no_email["user_email"]
        participants.append(no_email)

        mock_response = {
            "page_size": 300,
            "total_records": 4,
            "participants": participants,
        }

        with patch(
            "core.zoom.participants.zoom_request",
            new_callable=AsyncMock,
            return_value=mock_response,
        ):
            result = await get_meeting_participants(ZOOM_MEETING_ID)

        assert result is not None
        assert len(result) == 2
        emails = {p["user_email"] for p in result}
        assert emails == {"alice@example.com", "bob@example.com"}

    @pytest.mark.asyncio
    async def test_returns_none_when_zoom_not_configured(self):
        """Returns None when Zoom credentials are not set."""
        with patch(
            "core.zoom.participants.zoom_request",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await get_meeting_participants(ZOOM_MEETING_ID)

        assert result is None
