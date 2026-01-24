"""Tests for high-level notification actions."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock
from zoneinfo import ZoneInfo


class TestNotifyGroupAssigned:
    @pytest.mark.asyncio
    async def test_sends_notification(self):
        """Test that notify_group_assigned sends email and Discord notifications."""
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})

        with patch("core.notifications.actions.send_notification", mock_send):
            result = await notify_group_assigned(
                user_id=1,
                group_name="Curious Capybaras",
                meeting_time_utc="Wednesday 15:00",
                member_names=["Alice", "Bob"],
                discord_channel_id="123456",
            )

        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args[1]
        assert call_kwargs["message_type"] == "group_assigned"
        assert call_kwargs["context"]["group_name"] == "Curious Capybaras"
        assert result == {"email": True, "discord": True}


class TestScheduleMeetingReminders:
    def test_schedules_24h_and_1h_reminders(self):
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=2)

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
                user_ids=[1, 2, 3],
                group_name="Test Group",
                discord_channel_id="123456",
            )

        # Should schedule 4 jobs: 24h, 1h, 3d module nudge, 1d module nudge
        assert mock_schedule.call_count == 4


class TestScheduleMeetingRemindersContext:
    def test_context_includes_iso_timestamp(self):
        """Context should include meeting_time_utc as ISO string for per-user formatting."""
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
                user_ids=[1, 2, 3],
                group_name="Test Group",
                discord_channel_id="123456",
            )

        # Get the context from the first call (24h reminder)
        call_kwargs = mock_schedule.call_args_list[0][1]
        context = call_kwargs["context"]

        # Should have ISO timestamp for per-user formatting
        assert "meeting_time_utc" in context
        assert context["meeting_time_utc"] == "2024-01-10T15:00:00+00:00"

        # Should still have UTC fallback for channel messages
        assert "meeting_time" in context
        assert "UTC" in context["meeting_time"]
