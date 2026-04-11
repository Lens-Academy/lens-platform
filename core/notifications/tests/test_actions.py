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
    """Test schedule_meeting_reminders() with lightweight signature."""

    def test_schedules_all_reminders(self):
        """Should schedule 3 lightweight reminder jobs."""
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=7)

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
            )

        # Should schedule 3 jobs: 24h, 1h, 3d module nudge
        assert mock_schedule.call_count == 3

    def test_uses_lightweight_kwargs(self):
        """Should only pass meeting_id and reminder_type to schedule_reminder."""
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=7)

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
            )

        # Check first call (24h reminder)
        call_kwargs = mock_schedule.call_args_list[0][1]
        assert call_kwargs["meeting_id"] == 42
        assert call_kwargs["reminder_type"] == "reminder_24h"
        assert "run_at" in call_kwargs
        # Should NOT have old-style kwargs
        assert "user_ids" not in call_kwargs
        assert "context" not in call_kwargs
        assert "channel_id" not in call_kwargs
        assert "job_id" not in call_kwargs

    def test_calculates_correct_run_times(self):
        """Should calculate run times relative to meeting time using REMINDER_CONFIG."""
        from core.notifications.actions import schedule_meeting_reminders
        from core.notifications.scheduler import REMINDER_CONFIG

        mock_schedule = MagicMock()
        meeting_time = datetime(2026, 2, 10, 17, 0, tzinfo=ZoneInfo("UTC"))

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
            )

        # Extract run_at times
        run_times = {
            call[1]["reminder_type"]: call[1]["run_at"]
            for call in mock_schedule.call_args_list
        }

        # Verify each reminder type uses the correct offset from REMINDER_CONFIG
        for reminder_type, config in REMINDER_CONFIG.items():
            expected_time = meeting_time + config["offset"]
            assert run_times[reminder_type] == expected_time, (
                f"{reminder_type} should be at {expected_time}, got {run_times[reminder_type]}"
            )


class TestRescheduleMeetingReminders:
    """Test reschedule_meeting_reminders()."""

    def test_cancels_and_reschedules(self):
        """Should cancel existing reminders and schedule new ones."""
        from core.notifications.actions import reschedule_meeting_reminders

        mock_cancel = MagicMock(return_value=3)
        mock_schedule = MagicMock()
        new_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=7)

        with (
            patch("core.notifications.actions.cancel_reminders", mock_cancel),
            patch("core.notifications.actions.schedule_reminder", mock_schedule),
        ):
            reschedule_meeting_reminders(
                meeting_id=42,
                new_meeting_time=new_time,
            )

        # Should cancel existing
        mock_cancel.assert_called_once_with("meeting_42_*")
        # Should schedule 3 new
        assert mock_schedule.call_count == 3
