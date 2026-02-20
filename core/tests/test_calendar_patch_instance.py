"""Tests for patching individual Google Calendar event instances."""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from core.calendar.events import patch_event_instance


class TestPatchEventInstance:

    @pytest.mark.asyncio
    async def test_patch_adds_attendee_to_instance(self):
        """Patching an instance should call events().patch() with correct args."""
        mock_service = MagicMock()
        mock_patch = MagicMock()
        mock_service.events.return_value.patch.return_value.execute.return_value = {
            "id": "instance123",
            "attendees": [
                {"email": "existing@test.com"},
                {"email": "guest@test.com"},
            ],
        }
        mock_service.events.return_value.patch.return_value = mock_patch
        mock_patch.execute.return_value = {"id": "instance123"}

        with patch("core.calendar.events.get_calendar_service", return_value=mock_service), \
             patch("core.calendar.events.get_calendar_email", return_value="cal@test.com"):
            result = await patch_event_instance(
                instance_event_id="instance123",
                attendees=[
                    {"email": "existing@test.com"},
                    {"email": "guest@test.com"},
                ],
            )

        assert result is True
        mock_service.events.return_value.patch.assert_called_once()
        call_kwargs = mock_service.events.return_value.patch.call_args
        assert call_kwargs[1]["eventId"] == "instance123"
        assert call_kwargs[1]["body"] == {
            "attendees": [
                {"email": "existing@test.com"},
                {"email": "guest@test.com"},
            ]
        }
        assert call_kwargs[1]["sendUpdates"] == "all"

    @pytest.mark.asyncio
    async def test_returns_false_when_calendar_not_configured(self):
        """Should return False if calendar service is not available."""
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await patch_event_instance("inst123", [])
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_on_api_error(self):
        """Should return False and not raise on API errors."""
        mock_service = MagicMock()
        mock_service.events.return_value.patch.return_value.execute.side_effect = Exception("API error")

        with patch("core.calendar.events.get_calendar_service", return_value=mock_service), \
             patch("core.calendar.events.get_calendar_email", return_value="cal@test.com"):
            result = await patch_event_instance("inst123", [{"email": "a@b.com"}])
        assert result is False
