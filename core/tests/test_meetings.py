"""Tests for meeting service (create, calendar invites, reminders)."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch, AsyncMock

from core.meetings import (
    create_meetings_for_group,
    send_calendar_invites_for_group,
)


class TestCreateMeetingsForGroup:
    """Test meeting record creation."""

    @pytest.mark.asyncio
    async def test_creates_correct_number_of_meetings(self):
        """Should create one meeting per week."""
        with patch("core.meetings.get_transaction") as mock_tx:
            mock_conn = AsyncMock()
            mock_conn.execute = AsyncMock(
                return_value=Mock(scalar_one=Mock(side_effect=[1, 2, 3]))
            )
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            meeting_ids = await create_meetings_for_group(
                group_id=1,
                cohort_id=1,
                group_name="Test Group",
                first_meeting=datetime.now(timezone.utc),
                num_meetings=3,
                discord_voice_channel_id="123456",
            )

            assert len(meeting_ids) == 3
            assert mock_conn.execute.call_count == 3


class TestSendCalendarInvites:
    """Test Google Calendar invite sending."""

    @pytest.mark.asyncio
    async def test_sends_invites_to_all_members(self):
        """Should create calendar events for each meeting."""
        with (
            patch("core.meetings.get_connection") as mock_conn_ctx,
            patch("core.meetings.get_transaction") as mock_tx,
            patch("core.meetings.is_calendar_configured", return_value=True),
            patch(
                "core.meetings.create_meeting_event", new_callable=AsyncMock
            ) as mock_create_event,
            patch("core.meetings.get_group_member_emails") as mock_get_emails,
            patch("core.meetings.get_meetings_for_group") as mock_get_meetings,
        ):
            # Setup mocks
            mock_get_emails.return_value = ["alice@example.com", "bob@example.com"]
            mock_get_meetings.return_value = [
                {
                    "meeting_id": 1,
                    "meeting_number": 1,
                    "scheduled_at": datetime.now(timezone.utc),
                },
                {
                    "meeting_id": 2,
                    "meeting_number": 2,
                    "scheduled_at": datetime.now(timezone.utc) + timedelta(weeks=1),
                },
            ]
            mock_create_event.return_value = "google-event-id-123"

            mock_conn = AsyncMock()
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock()

            mock_tx_conn = AsyncMock()
            mock_tx.return_value.__aenter__ = AsyncMock(return_value=mock_tx_conn)
            mock_tx.return_value.__aexit__ = AsyncMock()

            sent = await send_calendar_invites_for_group(
                group_id=1,
                group_name="Test Group",
                meeting_ids=[1, 2],
            )

            assert sent == 2
            assert mock_create_event.call_count == 2
            # Verify attendees were passed correctly
            call_args = mock_create_event.call_args_list[0]
            assert call_args.kwargs["attendee_emails"] == [
                "alice@example.com",
                "bob@example.com",
            ]

    @pytest.mark.asyncio
    async def test_skips_when_calendar_not_configured(self):
        """Should gracefully skip when Google Calendar is not set up."""
        with patch("core.meetings.is_calendar_configured", return_value=False):
            sent = await send_calendar_invites_for_group(
                group_id=1,
                group_name="Test Group",
                meeting_ids=[1, 2],
            )

            assert sent == 0

    @pytest.mark.asyncio
    async def test_skips_when_no_member_emails(self):
        """Should skip when no members have email addresses."""
        with (
            patch("core.meetings.get_connection") as mock_conn_ctx,
            patch("core.meetings.is_calendar_configured", return_value=True),
            patch("core.meetings.get_group_member_emails") as mock_get_emails,
        ):
            mock_get_emails.return_value = []  # No emails

            mock_conn = AsyncMock()
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock()

            sent = await send_calendar_invites_for_group(
                group_id=1,
                group_name="Test Group",
                meeting_ids=[1, 2],
            )

            assert sent == 0
