"""Tests for calendar sync operations."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta


class TestSyncGroupCalendar:
    """Test unified sync_group_calendar function."""

    @pytest.mark.asyncio
    async def test_creates_events_for_meetings_without_calendar_ids(self):
        """Should batch create events for meetings without google_calendar_event_id."""
        from core.sync import sync_group_calendar

        # Meetings without calendar event IDs
        mock_meetings = [
            {
                "meeting_id": 1,
                "google_calendar_event_id": None,
                "scheduled_at": datetime.now(timezone.utc) + timedelta(days=1),
                "group_name": "Test Group",
            },
            {
                "meeting_id": 2,
                "google_calendar_event_id": None,
                "scheduled_at": datetime.now(timezone.utc) + timedelta(days=8),
                "group_name": "Test Group",
            },
        ]

        with patch("core.database.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_get_conn.return_value.__aenter__.return_value = mock_conn

            mock_result = MagicMock()
            mock_result.mappings.return_value = mock_meetings
            mock_conn.execute.return_value = mock_result

            with patch("core.sync._get_group_member_emails") as mock_emails:
                mock_emails.return_value = {"user@test.com"}

                with patch("core.calendar.client.batch_create_events") as mock_create:
                    mock_create.return_value = {
                        1: {"success": True, "event_id": "gcal_1", "error": None},
                        2: {"success": True, "event_id": "gcal_2", "error": None},
                    }

                    with patch("core.calendar.client.batch_get_events") as mock_get:
                        mock_get.return_value = {}

                        with patch(
                            "core.calendar.client.batch_patch_events"
                        ) as mock_patch:
                            mock_patch.return_value = {}

                            with patch(
                                "core.database.get_transaction"
                            ) as mock_get_trans:
                                mock_trans_conn = AsyncMock()
                                mock_get_trans.return_value.__aenter__.return_value = (
                                    mock_trans_conn
                                )

                                await sync_group_calendar(group_id=1)

                                # Should call batch_create for both meetings
                                mock_create.assert_called_once()
                                create_args = mock_create.call_args[0][0]
                                assert len(create_args) == 2

    @pytest.mark.asyncio
    async def test_patches_existing_events_with_attendee_changes(self):
        """Should batch patch existing events that have attendee diffs."""
        from core.sync import sync_group_calendar

        mock_meetings = [
            {
                "meeting_id": 1,
                "google_calendar_event_id": "gcal_1",
                "scheduled_at": datetime.now(timezone.utc) + timedelta(days=1),
                "group_name": "Test",
            },
            {
                "meeting_id": 2,
                "google_calendar_event_id": "gcal_2",
                "scheduled_at": datetime.now(timezone.utc) + timedelta(days=8),
                "group_name": "Test",
            },
        ]

        with patch("core.database.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            mock_result = MagicMock()
            mock_result.mappings.return_value = mock_meetings
            mock_conn.execute.return_value = mock_result

            with patch("core.sync._get_group_member_emails") as mock_emails:
                mock_emails.return_value = {"new@test.com"}

                with patch("core.calendar.client.batch_create_events") as mock_create:
                    mock_create.return_value = {}

                    with patch("core.calendar.client.batch_get_events") as mock_get:
                        mock_get.return_value = {
                            "gcal_1": {"attendees": [{"email": "old@test.com"}]},
                            "gcal_2": {
                                "attendees": [{"email": "new@test.com"}]
                            },  # Already correct
                        }

                        with patch(
                            "core.calendar.client.batch_patch_events"
                        ) as mock_patch:
                            mock_patch.return_value = {"gcal_1": {"success": True}}

                            await sync_group_calendar(group_id=1)

                            # Only gcal_1 should be patched (gcal_2 already has correct attendees)
                            mock_patch.assert_called_once()
                            patch_args = mock_patch.call_args[0][0]
                            event_ids = [u["event_id"] for u in patch_args]
                            assert "gcal_1" in event_ids
                            assert "gcal_2" not in event_ids

    @pytest.mark.asyncio
    async def test_uses_send_updates_all_for_additions_none_for_removals(self):
        """Should send notifications only when adding attendees."""
        from core.sync import sync_group_calendar

        # Test scenario:
        # - gcal_add: has no attendees, expected has new@test.com -> pure addition -> "all"
        # - gcal_remove: has old@test.com AND new@test.com, expected has only new@test.com -> pure removal -> "none"
        mock_meetings = [
            {
                "meeting_id": 1,
                "google_calendar_event_id": "gcal_add",
                "scheduled_at": datetime.now(timezone.utc) + timedelta(days=1),
                "group_name": "Test",
            },
            {
                "meeting_id": 2,
                "google_calendar_event_id": "gcal_remove",
                "scheduled_at": datetime.now(timezone.utc) + timedelta(days=8),
                "group_name": "Test",
            },
        ]

        with patch("core.database.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            mock_result = MagicMock()
            mock_result.mappings.return_value = mock_meetings
            mock_conn.execute.return_value = mock_result

            with patch("core.sync._get_group_member_emails") as mock_emails:
                mock_emails.return_value = {"new@test.com"}

                with patch("core.calendar.client.batch_create_events", return_value={}):
                    with patch("core.calendar.client.batch_get_events") as mock_get:
                        mock_get.return_value = {
                            # Pure addition: no attendees -> add new@test.com
                            "gcal_add": {"attendees": []},
                            # Pure removal: has both old and new -> remove old, new stays
                            "gcal_remove": {
                                "attendees": [
                                    {"email": "old@test.com"},
                                    {"email": "new@test.com"},
                                ]
                            },
                        }

                        with patch(
                            "core.calendar.client.batch_patch_events"
                        ) as mock_patch:
                            mock_patch.return_value = {}

                            await sync_group_calendar(group_id=1)

                            patch_args = mock_patch.call_args[0][0]
                            by_id = {u["event_id"]: u for u in patch_args}

                            assert by_id["gcal_add"]["send_updates"] == "all"
                            assert by_id["gcal_remove"]["send_updates"] == "none"
