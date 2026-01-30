"""Tests for Google Calendar event operations.

These tests mock the Google API client to avoid requiring credentials.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from core.calendar.events import (
    create_meeting_event,
    update_meeting_event,
    cancel_meeting_event,
    get_event_rsvps,
    create_recurring_event,
    get_event_instances,
)


@pytest.fixture
def mock_calendar_service():
    """Mock Google Calendar service."""
    with patch("core.calendar.events.get_calendar_service") as mock_get:
        mock_service = Mock()
        mock_get.return_value = mock_service
        yield mock_service


@pytest.fixture
def mock_calendar_email():
    """Mock calendar email."""
    with patch("core.calendar.events.get_calendar_email") as mock:
        mock.return_value = "test@example.com"
        yield mock


class TestCreateMeetingEvent:
    @pytest.mark.asyncio
    async def test_creates_event_with_correct_params(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().insert().execute.return_value = {
            "id": "event123"
        }

        result = await create_meeting_event(
            title="Test Meeting",
            description="Test description",
            start=datetime(2026, 1, 20, 15, 0, tzinfo=timezone.utc),
            attendee_emails=["user1@example.com", "user2@example.com"],
        )

        assert result == "event123"

        # Verify insert was called with correct body
        call_kwargs = mock_calendar_service.events().insert.call_args
        body = call_kwargs.kwargs["body"]

        assert body["summary"] == "Test Meeting"
        assert body["guestsCanSeeOtherGuests"] is False
        assert len(body["attendees"]) == 2

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await create_meeting_event(
                title="Test",
                description="Test",
                start=datetime.now(timezone.utc),
                attendee_emails=["test@example.com"],
            )
            assert result is None


class TestUpdateMeetingEvent:
    @pytest.mark.asyncio
    async def test_updates_event_successfully(
        self, mock_calendar_service, mock_calendar_email
    ):
        # Mock get() to return existing event
        mock_calendar_service.events().get().execute.return_value = {
            "summary": "Old Title",
            "start": {"dateTime": "2026-01-20T15:00:00+00:00", "timeZone": "UTC"},
            "end": {"dateTime": "2026-01-20T16:00:00+00:00", "timeZone": "UTC"},
        }
        # Mock update()
        mock_calendar_service.events().update().execute.return_value = {}

        result = await update_meeting_event(
            event_id="event123",
            start=datetime(2026, 1, 21, 15, 0, tzinfo=timezone.utc),
            title="New Title",
        )

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await update_meeting_event(event_id="event123")
            assert result is False


class TestCancelMeetingEvent:
    @pytest.mark.asyncio
    async def test_cancels_event_successfully(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().delete().execute.return_value = None

        result = await cancel_meeting_event("event123")

        assert result is True
        mock_calendar_service.events().delete.assert_called()

    @pytest.mark.asyncio
    async def test_returns_false_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await cancel_meeting_event("event123")
            assert result is False


class TestGetEventRsvps:
    @pytest.mark.asyncio
    async def test_returns_attendee_statuses(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().get().execute.return_value = {
            "attendees": [
                {"email": "user1@example.com", "responseStatus": "accepted"},
                {"email": "user2@example.com", "responseStatus": "declined"},
            ]
        }

        result = await get_event_rsvps("event123")

        assert len(result) == 2
        assert result[0]["email"] == "user1@example.com"
        assert result[0]["responseStatus"] == "accepted"

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await get_event_rsvps("event123")
            assert result is None


class TestCreateRecurringEvent:
    @pytest.mark.asyncio
    async def test_creates_recurring_event_with_rrule(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().insert().execute.return_value = {
            "id": "recurring123"
        }

        result = await create_recurring_event(
            title="Study Group Alpha",
            description="Weekly AI Safety study group",
            first_meeting=datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc),
            duration_minutes=60,
            num_occurrences=8,
            attendee_emails=["user1@example.com", "user2@example.com"],
        )

        assert result == "recurring123"

        # Verify RRULE was included
        call_kwargs = mock_calendar_service.events().insert.call_args
        body = call_kwargs.kwargs["body"]

        assert body["summary"] == "Study Group Alpha"
        assert "recurrence" in body
        assert body["recurrence"] == ["RRULE:FREQ=WEEKLY;COUNT=8"]
        assert len(body["attendees"]) == 2

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await create_recurring_event(
                title="Test",
                description="Test",
                first_meeting=datetime.now(timezone.utc),
                duration_minutes=60,
                num_occurrences=8,
                attendee_emails=["test@example.com"],
            )
            assert result is None


class TestGetEventInstances:
    @pytest.mark.asyncio
    async def test_returns_all_instances(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().instances().execute.return_value = {
            "items": [
                {
                    "id": "recurring123_20260201T180000Z",
                    "start": {"dateTime": "2026-02-01T18:00:00Z"},
                    "attendees": [
                        {"email": "user1@example.com", "responseStatus": "accepted"},
                    ],
                },
                {
                    "id": "recurring123_20260208T180000Z",
                    "start": {"dateTime": "2026-02-08T18:00:00Z"},
                    "attendees": [
                        {"email": "user1@example.com", "responseStatus": "tentative"},
                    ],
                },
            ]
        }

        result = await get_event_instances("recurring123")

        assert len(result) == 2
        assert result[0]["id"] == "recurring123_20260201T180000Z"
        assert result[0]["attendees"][0]["responseStatus"] == "accepted"
        assert result[1]["id"] == "recurring123_20260208T180000Z"

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await get_event_instances("recurring123")
            assert result is None
