"""Tests for sync operations (TDD)."""

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
        from core.sync import sync_group_discord_permissions

        with patch("core.notifications.channels.discord._bot", None):
            result = await sync_group_discord_permissions(group_id=1)

        assert result == {"error": "bot_unavailable"}

    @pytest.mark.asyncio
    async def test_returns_error_when_group_has_no_channel(self):
        """Should return error if group has no Discord channel."""
        from core.sync import sync_group_discord_permissions

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
        from core.sync import sync_group_discord_permissions

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


class TestSyncGroupCalendar:
    """Test group calendar sync wrapper."""

    @pytest.mark.asyncio
    async def test_returns_zero_counts_when_no_future_meetings(self):
        """Should return zero counts when group has no future meetings."""
        from core.sync import sync_group_calendar

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = []  # No meetings
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group_calendar(group_id=1)

        assert result == {
            "meetings": 0,
            "created": 0,
            "patched": 0,
            "unchanged": 0,
            "failed": 0,
        }


class TestSyncGroupReminders:
    """Test group reminders sync wrapper."""

    @pytest.mark.asyncio
    async def test_returns_zero_meetings_when_no_future_meetings(self):
        """Should return zero count when group has no future meetings."""
        from core.sync import sync_group_reminders

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
        from core.sync import sync_group_reminders

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
        from core.sync import sync_group_rsvps

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
        from core.sync import sync_group_rsvps

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


class TestSyncGroup:
    """Test unified sync_group function."""

    @pytest.mark.asyncio
    async def test_sync_group_calls_all_sub_syncs(self):
        """Should call all four sub-sync functions for a group."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
        ):
            mock_discord.return_value = {
                "granted": 1,
                "revoked": 0,
                "unchanged": 0,
                "failed": 0,
            }
            mock_calendar.return_value = {
                "meetings": 5,
                "created": 0,
                "patched": 2,
                "unchanged": 3,
                "failed": 0,
            }
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            result = await sync_group(group_id=123)

            mock_discord.assert_called_once_with(123)
            mock_calendar.assert_called_once_with(123)
            mock_reminders.assert_called_once_with(123)
            mock_rsvps.assert_called_once_with(123)

            assert result["discord"] == {
                "granted": 1,
                "revoked": 0,
                "unchanged": 0,
                "failed": 0,
            }
            assert result["calendar"]["patched"] == 2
            assert result["reminders"]["meetings"] == 5
            assert result["rsvps"]["meetings"] == 5

    @pytest.mark.asyncio
    async def test_sync_group_returns_errors_without_raising(self):
        """Should capture errors in results without raising exceptions."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
        ):
            mock_discord.side_effect = Exception("Discord error")
            mock_calendar.return_value = {"error": "quota_exceeded"}
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            result = await sync_group(group_id=123)

            assert "error" in result["discord"]
            assert result["calendar"]["error"] == "quota_exceeded"
            assert result["reminders"]["meetings"] == 5

    @pytest.mark.asyncio
    async def test_sync_group_schedules_retries_on_failure(self):
        """Should schedule retries for failed syncs."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch("core.notifications.scheduler.schedule_sync_retry") as mock_retry,
        ):
            mock_discord.return_value = {
                "granted": 0,
                "revoked": 0,
                "unchanged": 0,
                "failed": 2,
            }
            mock_calendar.return_value = {
                "meetings": 5,
                "created": 0,
                "patched": 0,
                "unchanged": 0,
                "failed": 5,
            }
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            await sync_group(group_id=123)

            # Should schedule retries for discord and calendar (both had failures)
            calls = mock_retry.call_args_list
            sync_types = [call[1]["sync_type"] for call in calls]
            assert "discord" in sync_types
            assert "calendar" in sync_types


class TestSyncAfterGroupChange:
    """Tests for sync_after_group_change()."""

    @pytest.mark.asyncio
    async def test_sends_notification_for_direct_join(self):
        """sync_after_group_change should send member_joined notification when user_id provided."""
        with (
            patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync,
            patch(
                "core.notifications.actions.notify_member_joined",
                new_callable=AsyncMock,
            ) as mock_notify,
            patch("core.database.get_connection") as mock_conn_ctx,
            patch(
                "core.queries.groups.get_group_member_names", new_callable=AsyncMock
            ) as mock_names,
            patch(
                "core.queries.groups.get_group_with_details", new_callable=AsyncMock
            ) as mock_details,
        ):
            mock_sync.return_value = {"discord": {"granted": 1}}
            mock_names.return_value = ["Alice", "Bob"]
            mock_details.return_value = {
                "group_name": "Test Group",
                "recurring_meeting_time_utc": "Wednesday 15:00",
                "discord_text_channel_id": "123456",
            }
            mock_notify.return_value = {"email": "sent", "discord": "sent"}

            # Mock user query
            mock_conn = AsyncMock()
            mock_conn_ctx.return_value.__aenter__.return_value = mock_conn
            mock_user_result = MagicMock()
            mock_user_result.mappings.return_value.first.return_value = {
                "discord_id": "999888",
            }
            mock_conn.execute.return_value = mock_user_result

            from core.sync import sync_after_group_change

            result = await sync_after_group_change(
                group_id=1,
                previous_group_id=None,
                user_id=123,
            )

            mock_notify.assert_called_once()
            call_kwargs = mock_notify.call_args.kwargs
            assert call_kwargs["user_id"] == 123
            assert call_kwargs["group_name"] == "Test Group"
            assert call_kwargs["discord_channel_id"] == "123456"
            assert result["notification"] is not None

    @pytest.mark.asyncio
    async def test_no_notification_without_user_id(self):
        """sync_after_group_change should NOT send notification when user_id is None."""
        with (
            patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync,
            patch(
                "core.notifications.actions.notify_member_joined",
                new_callable=AsyncMock,
            ) as mock_notify,
        ):
            mock_sync.return_value = {"discord": {"granted": 1}}

            from core.sync import sync_after_group_change

            result = await sync_after_group_change(
                group_id=1,
                previous_group_id=None,
                user_id=None,
            )

            mock_notify.assert_not_called()
            assert result["notification"] is None
