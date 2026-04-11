"""Tests for calendar sync operations.

NOTE: The old per-meeting calendar tests (TestSyncGroupCalendar) have been removed
as part of the recurring events rewrite. The new implementation uses a single
recurring event per group instead of individual events per meeting.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta


class TestSyncGroupCalendarRecurring:
    @pytest.mark.asyncio
    async def test_creates_recurring_event_for_group_without_one(self):
        """When group has no gcal_recurring_event_id, create one."""
        from core.sync import sync_group_calendar

        # Create mock result objects that properly chain
        group_result = MagicMock()
        group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "gcal_recurring_event_id": None,
            "cohort_id": 1,
        }

        meetings_data = [
            {
                "meeting_id": i,
                "scheduled_at": datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc)
                + timedelta(weeks=i - 1),
                "meeting_number": i,
            }
            for i in range(1, 9)
        ]
        meetings_result = MagicMock()
        meetings_result.mappings.return_value = meetings_data

        # _get_group_member_emails returns set of emails
        emails_result = MagicMock()
        emails_result.mappings.return_value = [{"email": "user@example.com"}]

        # Track which query is being executed
        call_count = [0]

        async def mock_execute(query):
            call_count[0] += 1
            if call_count[0] == 1:
                return group_result
            elif call_count[0] == 2:
                # _get_group_member_emails call
                return emails_result
            elif call_count[0] == 3:
                return meetings_result
            return MagicMock()

        conn = AsyncMock()
        conn.execute = mock_execute

        with patch("core.database.get_transaction") as mock_tx:
            mock_tx.return_value.__aenter__.return_value = conn
            with patch(
                "core.calendar.events.create_recurring_event",
                return_value="recurring123",
            ) as mock_create:
                result = await sync_group_calendar(1)

        assert result["created_recurring"] is True
        assert result["recurring_event_id"] == "recurring123"
        mock_create.assert_called_once()

    @pytest.mark.asyncio
    async def test_patches_attendees_on_existing_recurring_event(self):
        """When group has recurring event, patch attendees if changed."""
        from core.sync import sync_group_calendar

        # Create mock result objects
        group_result = MagicMock()
        group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "gcal_recurring_event_id": "recurring123",
            "cohort_id": 1,
        }

        meetings_data = [
            {
                "meeting_id": 1,
                "scheduled_at": datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc),
                "meeting_number": 1,
            }
        ]
        meetings_result = MagicMock()
        meetings_result.mappings.return_value = meetings_data

        # _get_group_member_emails returns set of emails
        emails_result = MagicMock()
        emails_result.mappings.return_value = [
            {"email": "user@example.com"},
            {"email": "new@example.com"},
        ]

        call_count = [0]

        async def mock_execute(query):
            call_count[0] += 1
            if call_count[0] == 1:
                return group_result
            elif call_count[0] == 2:
                # _get_group_member_emails call
                return emails_result
            elif call_count[0] == 3:
                return meetings_result
            return MagicMock()

        conn = AsyncMock()
        conn.execute = mock_execute

        with patch("core.database.get_transaction") as mock_tx:
            mock_tx.return_value.__aenter__.return_value = conn
            with patch("core.calendar.client.batch_get_events") as mock_batch_get:
                mock_batch_get.return_value = {
                    "recurring123": {"attendees": [{"email": "user@example.com"}]}
                }
                with patch(
                    "core.calendar.client.batch_patch_events"
                ) as mock_batch_patch:
                    mock_batch_patch.return_value = {"recurring123": {"success": True}}
                    result = await sync_group_calendar(1)

        assert result["patched"] == 1
