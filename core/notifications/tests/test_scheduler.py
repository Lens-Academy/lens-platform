"""Tests for notification scheduler."""

from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock


class TestScheduleReminder:
    def test_schedules_job(self):
        from core.notifications.scheduler import schedule_reminder

        mock_scheduler = MagicMock()

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_reminder(
                job_id="meeting_123_reminder_24h",
                run_at=datetime.utcnow() + timedelta(hours=24),
                message_type="meeting_reminder_24h",
                user_ids=[1, 2, 3],
                context={"meeting_time": "3pm UTC"},
            )

        mock_scheduler.add_job.assert_called_once()
        call_kwargs = mock_scheduler.add_job.call_args[1]
        assert call_kwargs["id"] == "meeting_123_reminder_24h"


class TestCancelReminders:
    def test_cancels_matching_jobs(self):
        from core.notifications.scheduler import cancel_reminders

        mock_scheduler = MagicMock()
        mock_job1 = MagicMock()
        mock_job1.id = "meeting_123_reminder_24h"
        mock_job2 = MagicMock()
        mock_job2.id = "meeting_123_reminder_1h"
        mock_job3 = MagicMock()
        mock_job3.id = "meeting_456_reminder_24h"
        mock_scheduler.get_jobs.return_value = [mock_job1, mock_job2, mock_job3]

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            count = cancel_reminders("meeting_123_*")

        assert count == 2
        mock_job1.remove.assert_called_once()
        mock_job2.remove.assert_called_once()
        mock_job3.remove.assert_not_called()
