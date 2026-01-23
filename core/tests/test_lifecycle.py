"""Tests for lifecycle operations (TDD)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestSyncMeetingReminders:
    """Test reminder sync logic."""

    @pytest.mark.asyncio
    async def test_updates_job_user_ids_from_database(self):
        """Should update job kwargs with current group members from DB."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Mock the scheduler
        mock_job = MagicMock()
        mock_job.kwargs = {"user_ids": [1, 2], "meeting_id": 5}

        mock_scheduler = MagicMock()
        mock_scheduler.get_job.return_value = mock_job

        # Mock DB to return new member list
        mock_conn = AsyncMock()

        # First query: get group_id from meeting
        mock_meeting_result = MagicMock()
        mock_meeting_result.mappings.return_value.first.return_value = {"group_id": 10}

        # Second query: get active members
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {"user_id": 1},
            {"user_id": 3},
            {"user_id": 4},
        ]

        mock_conn.execute = AsyncMock(
            side_effect=[mock_meeting_result, mock_members_result]
        )

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                await sync_meeting_reminders(meeting_id=5)

        # Verify job was updated with new user_ids
        mock_scheduler.modify_job.assert_called()
        call_args = mock_scheduler.modify_job.call_args
        assert call_args[1]["kwargs"]["user_ids"] == [1, 3, 4]

    @pytest.mark.asyncio
    async def test_removes_job_when_no_members_left(self):
        """Should remove job if group has no active members."""
        from core.notifications.scheduler import sync_meeting_reminders

        mock_job = MagicMock()
        mock_job.kwargs = {"user_ids": [1, 2], "meeting_id": 5}

        mock_scheduler = MagicMock()
        mock_scheduler.get_job.return_value = mock_job

        mock_conn = AsyncMock()
        mock_meeting_result = MagicMock()
        mock_meeting_result.mappings.return_value.first.return_value = {"group_id": 10}

        # Empty member list
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = []

        mock_conn.execute = AsyncMock(
            side_effect=[mock_meeting_result, mock_members_result]
        )

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                await sync_meeting_reminders(meeting_id=5)

        # Job should be removed
        mock_job.remove.assert_called()

    @pytest.mark.asyncio
    async def test_does_nothing_when_scheduler_unavailable(self):
        """Should exit gracefully if scheduler is not initialized."""
        from core.notifications.scheduler import sync_meeting_reminders

        with patch("core.notifications.scheduler._scheduler", None):
            # Should not raise
            await sync_meeting_reminders(meeting_id=5)


class TestSyncGroupDiscordPermissions:
    """Test Discord permissions sync logic."""

    @pytest.mark.asyncio
    async def test_returns_error_when_bot_unavailable(self):
        """Should return error dict if bot is not initialized."""
        from core.lifecycle import sync_group_discord_permissions

        with patch("core.notifications.channels.discord._bot", None):
            result = await sync_group_discord_permissions(group_id=1)

        assert result == {"error": "bot_unavailable"}

    @pytest.mark.asyncio
    async def test_returns_error_when_group_has_no_channel(self):
        """Should return error if group has no Discord channel."""
        from core.lifecycle import sync_group_discord_permissions

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "discord_text_channel_id": None,
            "discord_voice_channel_id": None,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_bot = MagicMock()

        with patch("core.notifications.channels.discord._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await sync_group_discord_permissions(group_id=1)

        assert result == {"error": "no_channel"}

    @pytest.mark.asyncio
    async def test_returns_error_when_channel_not_found_in_discord(self):
        """Should return error if Discord channel is not found."""
        from core.lifecycle import sync_group_discord_permissions

        mock_conn = AsyncMock()
        # First query: get group channels
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "discord_text_channel_id": "123456789",
            "discord_voice_channel_id": None,
        }
        # Second query: get active members
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [{"discord_id": "111"}]

        mock_conn.execute = AsyncMock(
            side_effect=[mock_group_result, mock_members_result]
        )

        mock_bot = MagicMock()
        mock_bot.get_channel.return_value = None  # Channel not found

        with patch("core.notifications.channels.discord._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await sync_group_discord_permissions(group_id=1)

        assert result == {"error": "channel_not_found"}


class TestSyncMeetingCalendar:
    """Test calendar sync logic."""

    @pytest.mark.asyncio
    async def test_returns_error_when_calendar_unavailable(self):
        """Should return error if calendar service is not configured."""
        from core.lifecycle import sync_meeting_calendar

        with patch("core.calendar.client.get_calendar_service", return_value=None):
            result = await sync_meeting_calendar(meeting_id=1)

        assert result == {"error": "calendar_unavailable"}

    @pytest.mark.asyncio
    async def test_returns_error_when_meeting_not_found(self):
        """Should return error if meeting doesn't exist."""
        from core.lifecycle import sync_meeting_calendar

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_service = MagicMock()

        with patch(
            "core.calendar.client.get_calendar_service", return_value=mock_service
        ):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await sync_meeting_calendar(meeting_id=999)

        assert result == {"error": "meeting_not_found"}


class TestSyncGroupCalendar:
    """Test group calendar sync wrapper."""

    @pytest.mark.asyncio
    async def test_returns_no_meetings_error_when_no_future_meetings(self):
        """Should return error when group has no future meetings."""
        from core.lifecycle import sync_group_calendar

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = []  # No meetings
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group_calendar(group_id=1)

        assert result == {"meetings": 0, "error": "no_future_meetings"}

    @pytest.mark.asyncio
    async def test_calls_sync_meeting_calendar_for_each_meeting(self):
        """Should call sync_meeting_calendar for each future meeting."""
        from core.lifecycle import sync_group_calendar

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {"meeting_id": 1},
            {"meeting_id": 2},
        ]
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch("core.lifecycle.sync_meeting_calendar") as mock_sync:
                mock_sync.return_value = {
                    "created": False,
                    "added": 1,
                    "removed": 0,
                    "unchanged": 2,
                }
                result = await sync_group_calendar(group_id=1)

        assert mock_sync.call_count == 2
        assert result["meetings"] == 2
        assert result["added"] == 2


class TestSyncGroupReminders:
    """Test group reminders sync wrapper."""

    @pytest.mark.asyncio
    async def test_returns_zero_meetings_when_no_future_meetings(self):
        """Should return zero count when group has no future meetings."""
        from core.lifecycle import sync_group_reminders

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = []  # No meetings
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group_reminders(group_id=1)

        assert result == {"meetings": 0}

    @pytest.mark.asyncio
    async def test_calls_sync_meeting_reminders_for_each_meeting(self):
        """Should call sync_meeting_reminders for each future meeting."""
        from core.lifecycle import sync_group_reminders

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {"meeting_id": 1},
            {"meeting_id": 2},
            {"meeting_id": 3},
        ]
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.notifications.scheduler.sync_meeting_reminders"
            ) as mock_sync:
                mock_sync.return_value = None
                result = await sync_group_reminders(group_id=1)

        assert mock_sync.call_count == 3
        assert result == {"meetings": 3}


class TestSyncGroupRsvps:
    """Test group RSVPs sync wrapper."""

    @pytest.mark.asyncio
    async def test_returns_zero_meetings_when_no_future_meetings(self):
        """Should return zero count when group has no future meetings."""
        from core.lifecycle import sync_group_rsvps

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = []  # No meetings
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group_rsvps(group_id=1)

        assert result == {"meetings": 0}

    @pytest.mark.asyncio
    async def test_calls_sync_meeting_rsvps_for_each_meeting(self):
        """Should call sync_meeting_rsvps for each future meeting."""
        from core.lifecycle import sync_group_rsvps

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {"meeting_id": 1},
            {"meeting_id": 2},
        ]
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch("core.calendar.rsvp.sync_meeting_rsvps") as mock_sync:
                mock_sync.return_value = {}
                result = await sync_group_rsvps(group_id=1)

        assert mock_sync.call_count == 2
        assert result == {"meetings": 2}
