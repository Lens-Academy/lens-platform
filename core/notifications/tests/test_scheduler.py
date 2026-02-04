"""Tests for notification scheduler.

Following TDD: tests written first, then implementation.

Layers tested:
- Layer 3: Execution (_execute_reminder) - mock notification sending
- Layer 4: Sync (sync_meeting_reminders) - real APScheduler (in-memory)
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock, AsyncMock

import pytest


# =============================================================================
# Existing tests - schedule_reminder and cancel_reminders
# =============================================================================


class TestScheduleReminder:
    """Test schedule_reminder() with new lightweight signature."""

    def test_schedules_job_with_meeting_id_and_reminder_type(self):
        """Should schedule job with only meeting_id and reminder_type."""
        from core.notifications.scheduler import schedule_reminder

        mock_scheduler = MagicMock()

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_reminder(
                meeting_id=123,
                reminder_type="reminder_24h",
                run_at=datetime.now(timezone.utc) + timedelta(hours=24),
            )

        mock_scheduler.add_job.assert_called_once()
        call_kwargs = mock_scheduler.add_job.call_args[1]
        assert call_kwargs["id"] == "meeting_123_reminder_24h"
        assert call_kwargs["kwargs"] == {
            "meeting_id": 123,
            "reminder_type": "reminder_24h",
        }

    def test_logs_job_creation(self, caplog):
        """Should log job creation with meeting_id and reminder_type."""
        from core.notifications.scheduler import schedule_reminder
        import logging

        mock_scheduler = MagicMock()
        run_at = datetime.now(timezone.utc) + timedelta(hours=24)

        with caplog.at_level(logging.INFO):
            with patch("core.notifications.scheduler._scheduler", mock_scheduler):
                schedule_reminder(
                    meeting_id=123,
                    reminder_type="reminder_24h",
                    run_at=run_at,
                )

        # Check log message contains key info
        assert any("reminder_24h" in record.message for record in caplog.records)
        assert any("123" in record.message for record in caplog.records)

    def test_warns_when_scheduler_not_initialized(self, caplog):
        """Should log warning when scheduler not initialized."""
        from core.notifications.scheduler import schedule_reminder
        import logging

        with caplog.at_level(logging.WARNING):
            with patch("core.notifications.scheduler._scheduler", None):
                schedule_reminder(
                    meeting_id=123,
                    reminder_type="reminder_24h",
                    run_at=datetime.now(timezone.utc) + timedelta(hours=24),
                )

        # Should warn about scheduler not initialized
        assert any(
            "not initialized" in record.message.lower() for record in caplog.records
        )


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


# =============================================================================
# Layer 3: Execution tests (_execute_reminder)
# =============================================================================


class TestExecuteReminder:
    """Test _execute_reminder() async function."""

    @pytest.mark.asyncio
    async def test_sends_to_all_active_members(self):
        """Should send notifications to all active group members."""
        from core.notifications.scheduler import _execute_reminder

        # Mock context functions
        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }
        mock_context = {"group_name": "Test Group", "module_url": "http://example.com"}

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.context.get_active_member_ids",
                new_callable=AsyncMock,
                return_value=[1, 2, 3],
            ),
            patch(
                "core.notifications.context.build_reminder_context",
                return_value=mock_context,
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
                return_value={"email": True, "discord": True},
            ) as mock_send,
            patch(
                "core.notifications.dispatcher.send_channel_notification",
                new_callable=AsyncMock,
                return_value=True,
            ),
        ):
            await _execute_reminder(meeting_id=42, reminder_type="reminder_24h")

        # Should send to all 3 members
        assert mock_send.call_count == 3
        called_user_ids = {c.kwargs["user_id"] for c in mock_send.call_args_list}
        assert called_user_ids == {1, 2, 3}

    @pytest.mark.asyncio
    async def test_skips_when_meeting_not_found(self, caplog):
        """Should skip reminder when meeting doesn't exist."""
        from core.notifications.scheduler import _execute_reminder
        import logging

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
            ) as mock_send,
        ):
            with caplog.at_level(logging.INFO):
                await _execute_reminder(meeting_id=99999, reminder_type="reminder_24h")

        mock_send.assert_not_called()
        assert any("not found" in record.message.lower() for record in caplog.records)

    @pytest.mark.asyncio
    async def test_skips_past_meeting(self, caplog):
        """Should skip reminder when meeting has already passed."""
        from core.notifications.scheduler import _execute_reminder
        import logging

        # Meeting in the past
        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
            ) as mock_send,
        ):
            with caplog.at_level(logging.INFO):
                await _execute_reminder(meeting_id=42, reminder_type="reminder_24h")

        mock_send.assert_not_called()
        assert any("passed" in record.message.lower() for record in caplog.records)

    @pytest.mark.asyncio
    async def test_skips_when_no_active_members(self, caplog):
        """Should skip reminder when group has no active members."""
        from core.notifications.scheduler import _execute_reminder
        import logging

        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.context.get_active_member_ids",
                new_callable=AsyncMock,
                return_value=[],  # No members
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
            ) as mock_send,
        ):
            with caplog.at_level(logging.INFO):
                await _execute_reminder(meeting_id=42, reminder_type="reminder_24h")

        mock_send.assert_not_called()
        assert any(
            "no active members" in record.message.lower() for record in caplog.records
        )

    @pytest.mark.asyncio
    async def test_uses_fresh_context(self):
        """Should build context fresh at execution time (not stale)."""
        from core.notifications.scheduler import _execute_reminder

        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Fresh Group Name",
            "discord_text_channel_id": "123456789",
        }
        fresh_context = {
            "group_name": "Fresh Group Name",
            "module_url": "https://lensacademy.org/course",
        }

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.context.get_active_member_ids",
                new_callable=AsyncMock,
                return_value=[1],
            ),
            patch(
                "core.notifications.context.build_reminder_context",
                return_value=fresh_context,
            ) as mock_build,
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
                return_value={"email": True, "discord": True},
            ) as mock_send,
            patch(
                "core.notifications.dispatcher.send_channel_notification",
                new_callable=AsyncMock,
                return_value=True,
            ),
        ):
            await _execute_reminder(meeting_id=42, reminder_type="reminder_24h")

        # Should call build_reminder_context with fresh data
        mock_build.assert_called_once_with(mock_meeting, mock_group)
        # Should use fresh context in send_notification
        context_used = mock_send.call_args.kwargs["context"]
        assert context_used["module_url"] == "https://lensacademy.org/course"

    @pytest.mark.asyncio
    async def test_sends_channel_notification_for_meeting_reminders(self):
        """Should send channel notification for reminder_24h and reminder_1h."""
        from core.notifications.scheduler import _execute_reminder

        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.context.get_active_member_ids",
                new_callable=AsyncMock,
                return_value=[1],
            ),
            patch(
                "core.notifications.context.build_reminder_context",
                return_value={"group_name": "Test"},
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
                return_value={"email": True, "discord": True},
            ),
            patch(
                "core.notifications.dispatcher.send_channel_notification",
                new_callable=AsyncMock,
                return_value=True,
            ) as mock_channel,
        ):
            await _execute_reminder(meeting_id=42, reminder_type="reminder_24h")

        mock_channel.assert_called_once()
        assert mock_channel.call_args[0][0] == "123456789"

    @pytest.mark.asyncio
    async def test_skips_channel_notification_when_no_channel(self):
        """Should gracefully skip channel notification when channel_id is None."""
        from core.notifications.scheduler import _execute_reminder

        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": None,  # No channel
        }

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.context.get_active_member_ids",
                new_callable=AsyncMock,
                return_value=[1],
            ),
            patch(
                "core.notifications.context.build_reminder_context",
                return_value={"group_name": "Test"},
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
                return_value={"email": True, "discord": True},
            ) as mock_send,
            patch(
                "core.notifications.dispatcher.send_channel_notification",
                new_callable=AsyncMock,
                return_value=True,
            ) as mock_channel,
        ):
            await _execute_reminder(meeting_id=42, reminder_type="reminder_24h")

        # Should still send to members
        mock_send.assert_called_once()
        # Should not send to channel
        mock_channel.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_channel_notification_for_module_nudge(self):
        """Should not send channel notification for module_nudge_3d."""
        from core.notifications.scheduler import _execute_reminder

        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.context.get_active_member_ids",
                new_callable=AsyncMock,
                return_value=[1],
            ),
            patch(
                "core.notifications.context.build_reminder_context",
                return_value={"group_name": "Test"},
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
                return_value={"email": True, "discord": True},
            ),
            patch(
                "core.notifications.dispatcher.send_channel_notification",
                new_callable=AsyncMock,
                return_value=True,
            ) as mock_channel,
        ):
            # Module nudge should NOT send to channel
            await _execute_reminder(meeting_id=42, reminder_type="module_nudge_3d")

        # Should not send to channel for module nudges
        mock_channel.assert_not_called()

    @pytest.mark.asyncio
    async def test_uses_correct_message_type_mapping(self):
        """Should use REMINDER_CONFIG to map reminder_type to message_type."""
        from core.notifications.scheduler import (
            _execute_reminder,
            REMINDER_CONFIG,
        )

        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        with (
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
            patch(
                "core.notifications.context.get_active_member_ids",
                new_callable=AsyncMock,
                return_value=[1],
            ),
            patch(
                "core.notifications.context.build_reminder_context",
                return_value={"group_name": "Test"},
            ),
            patch(
                "core.notifications.dispatcher.send_notification",
                new_callable=AsyncMock,
                return_value={"email": True, "discord": True},
            ) as mock_send,
            patch(
                "core.notifications.dispatcher.send_channel_notification",
                new_callable=AsyncMock,
                return_value=True,
            ),
        ):
            await _execute_reminder(meeting_id=42, reminder_type="reminder_24h")

        # Should use the mapped message template from REMINDER_CONFIG
        expected_message_type = REMINDER_CONFIG["reminder_24h"]["message_template"]
        assert mock_send.call_args.kwargs["message_type"] == expected_message_type


# =============================================================================
# Layer 4: Sync tests (sync_meeting_reminders)
# =============================================================================


class TestSyncMeetingReminders:
    """Test sync_meeting_reminders() diff-based sync."""

    @pytest.fixture
    def mock_scheduler(self):
        """Create a mock scheduler for testing."""
        scheduler = MagicMock()
        scheduler.get_jobs.return_value = []
        return scheduler

    @pytest.mark.asyncio
    async def test_creates_missing_jobs_for_future_meeting(self, mock_scheduler):
        """Should create all 3 reminder jobs for a future meeting."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Mock a future meeting
        future_time = datetime.now(timezone.utc) + timedelta(days=7)
        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": future_time,
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        with (
            patch("core.notifications.scheduler._scheduler", mock_scheduler),
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
        ):
            result = await sync_meeting_reminders(meeting_id=42)

        assert result["created"] == 3
        assert result["deleted"] == 0
        assert result["unchanged"] == 0
        # Should have called add_job 3 times
        assert mock_scheduler.add_job.call_count == 3

    @pytest.mark.asyncio
    async def test_deletes_orphaned_jobs_for_past_meeting(self, mock_scheduler):
        """Should delete jobs when meeting has passed."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Mock a past meeting
        past_time = datetime.now(timezone.utc) - timedelta(hours=2)
        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": past_time,
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        # Existing orphan job
        mock_job = MagicMock()
        mock_job.id = "meeting_42_reminder_24h"
        mock_scheduler.get_jobs.return_value = [mock_job]

        with (
            patch("core.notifications.scheduler._scheduler", mock_scheduler),
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
        ):
            result = await sync_meeting_reminders(meeting_id=42)

        assert result["deleted"] == 1
        assert result["created"] == 0
        mock_scheduler.remove_job.assert_called_once_with("meeting_42_reminder_24h")

    @pytest.mark.asyncio
    async def test_idempotent_second_call(self, mock_scheduler):
        """Should return unchanged count on second sync call."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Mock a future meeting
        future_time = datetime.now(timezone.utc) + timedelta(days=7)
        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": future_time,
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        # Simulate existing jobs (as if first sync already ran)
        mock_job_24h = MagicMock()
        mock_job_24h.id = "meeting_42_reminder_24h"
        mock_job_1h = MagicMock()
        mock_job_1h.id = "meeting_42_reminder_1h"
        mock_job_3d = MagicMock()
        mock_job_3d.id = "meeting_42_module_nudge_3d"
        mock_scheduler.get_jobs.return_value = [mock_job_24h, mock_job_1h, mock_job_3d]

        with (
            patch("core.notifications.scheduler._scheduler", mock_scheduler),
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
        ):
            result = await sync_meeting_reminders(meeting_id=42)

        assert result["created"] == 0
        assert result["deleted"] == 0
        assert result["unchanged"] == 3

    @pytest.mark.asyncio
    async def test_deletes_all_jobs_for_deleted_meeting(self, mock_scheduler):
        """Should delete all jobs when meeting doesn't exist."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Existing jobs for deleted meeting
        mock_job = MagicMock()
        mock_job.id = "meeting_42_reminder_24h"
        mock_scheduler.get_jobs.return_value = [mock_job]

        with (
            patch("core.notifications.scheduler._scheduler", mock_scheduler),
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=None,  # Meeting not found
            ),
        ):
            result = await sync_meeting_reminders(meeting_id=42)

        assert result["deleted"] == 1
        assert result["created"] == 0
        mock_scheduler.remove_job.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_error_on_db_failure(self):
        """Should return error dict on database failure."""
        from core.notifications.scheduler import sync_meeting_reminders

        mock_scheduler = MagicMock()

        with (
            patch("core.notifications.scheduler._scheduler", mock_scheduler),
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                side_effect=Exception("DB connection failed"),
            ),
        ):
            result = await sync_meeting_reminders(meeting_id=42)

        assert "error" in result
        assert "DB connection failed" in result["error"]
        assert result["created"] == 0
        assert result["deleted"] == 0

    @pytest.mark.asyncio
    async def test_filters_out_past_scheduled_times(self, mock_scheduler):
        """Should not create jobs scheduled in the past."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Meeting 2 hours from now - 3d nudge would be in the past
        soon_time = datetime.now(timezone.utc) + timedelta(hours=2)
        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": soon_time,
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        with (
            patch("core.notifications.scheduler._scheduler", mock_scheduler),
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
        ):
            result = await sync_meeting_reminders(meeting_id=42)

        # Only 1h reminder should be created (24h and 3d are in the past)
        assert result["created"] == 1
        # Verify it's the 1h reminder
        call_kwargs = mock_scheduler.add_job.call_args[1]
        assert "reminder_1h" in call_kwargs["id"]

    @pytest.mark.asyncio
    async def test_handles_job_lookup_error_gracefully(self, mock_scheduler):
        """Should handle JobLookupError when job already removed."""
        from core.notifications.scheduler import sync_meeting_reminders
        from apscheduler.jobstores.base import JobLookupError

        # Past meeting with orphan job
        past_time = datetime.now(timezone.utc) - timedelta(hours=2)
        mock_meeting = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": past_time,
        }
        mock_group = {
            "group_id": 10,
            "group_name": "Test Group",
            "discord_text_channel_id": "123456789",
        }

        mock_job = MagicMock()
        mock_job.id = "meeting_42_reminder_24h"
        mock_scheduler.get_jobs.return_value = [mock_job]
        # Simulate job already removed
        mock_scheduler.remove_job.side_effect = JobLookupError(
            "meeting_42_reminder_24h"
        )

        with (
            patch("core.notifications.scheduler._scheduler", mock_scheduler),
            patch(
                "core.notifications.context.get_meeting_with_group",
                new_callable=AsyncMock,
                return_value=(mock_meeting, mock_group),
            ),
        ):
            # Should not raise
            result = await sync_meeting_reminders(meeting_id=42)

        # Should still report as deleted (intent was to delete)
        assert result["deleted"] == 1


# =============================================================================
# Test REMINDER_CONFIG (single source of truth)
# =============================================================================


class TestReminderConfig:
    """Test the REMINDER_CONFIG single source of truth."""

    def test_contains_all_expected_reminder_types(self):
        """REMINDER_CONFIG should have all expected reminder types."""
        from core.notifications.scheduler import REMINDER_CONFIG

        assert "reminder_24h" in REMINDER_CONFIG
        assert "reminder_1h" in REMINDER_CONFIG
        assert "module_nudge_3d" in REMINDER_CONFIG

    def test_each_reminder_has_required_fields(self):
        """Each reminder config should have offset, message_template, send_to_channel."""
        from core.notifications.scheduler import REMINDER_CONFIG

        for reminder_type, config in REMINDER_CONFIG.items():
            assert "offset" in config, f"{reminder_type} missing offset"
            assert "message_template" in config, f"{reminder_type} missing message_template"
            assert "send_to_channel" in config, f"{reminder_type} missing send_to_channel"

    def test_module_nudge_has_condition(self):
        """module_nudge_3d should have a condition for module progress."""
        from core.notifications.scheduler import REMINDER_CONFIG

        config = REMINDER_CONFIG["module_nudge_3d"]
        assert "condition" in config
        assert config["condition"]["type"] == "module_progress"
        assert "threshold" in config["condition"]

    def test_offsets_are_negative_timedeltas(self):
        """Offsets should be negative (before meeting time)."""
        from datetime import timedelta
        from core.notifications.scheduler import REMINDER_CONFIG

        for reminder_type, config in REMINDER_CONFIG.items():
            assert config["offset"] < timedelta(0), f"{reminder_type} offset should be negative"


# =============================================================================
# Test _check_module_progress
# =============================================================================


class TestCheckModuleProgress:
    """Test the _check_module_progress function."""

    @pytest.mark.asyncio
    async def test_returns_false_when_no_meeting_id(self):
        """Should return False if meeting_id is None."""
        from core.notifications.scheduler import _check_module_progress

        result = await _check_module_progress(
            user_ids=[1, 2], meeting_id=None, threshold=0.5
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_no_users(self):
        """Should return False if user_ids is empty."""
        from core.notifications.scheduler import _check_module_progress

        result = await _check_module_progress(
            user_ids=[], meeting_id=42, threshold=0.5
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_on_error(self):
        """Should return True (send nudge) on error - conservative behavior."""
        from core.notifications.scheduler import _check_module_progress

        # Patch at the source module where get_connection is defined
        with patch(
            "core.database.get_connection",
            side_effect=Exception("DB error"),
        ):
            result = await _check_module_progress(
                user_ids=[1], meeting_id=99999, threshold=0.5
            )
            # On error, sends nudge anyway (conservative)
            assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_all_users_above_threshold(self):
        """Should return False (no nudge) when all users are above threshold."""
        from core.notifications.scheduler import _check_module_progress
        from uuid import UUID

        mock_module = MagicMock()
        mock_module.content_id = UUID("12345678-1234-1234-1234-123456789012")

        mock_course = MagicMock()

        # Mock the database query
        mock_row = {
            "meeting_number": 1,
            "course_slug_override": None,
            "course_slug": "test-course",
        }

        with (
            patch("core.database.get_connection") as mock_conn_ctx,
            patch(
                "core.modules.course_loader.load_course", return_value=mock_course
            ),
            patch(
                "core.modules.course_loader.get_required_modules",
                return_value=[MagicMock(path="modules/mod1")],
            ),
            patch(
                "core.modules.course_loader.get_due_by_meeting", return_value=1
            ),
            patch(
                "core.modules.course_loader._extract_slug_from_path",
                return_value="mod1",
            ),
            patch(
                "core.modules.loader.load_flattened_module",
                return_value=mock_module,
            ),
            patch(
                "core.modules.progress.get_module_progress",
                new_callable=AsyncMock,
                return_value={
                    mock_module.content_id: {"completed_at": "2026-01-01T00:00:00Z"}
                },
            ),
        ):
            # Mock the async context manager
            mock_conn = AsyncMock()
            mock_result = MagicMock()
            mock_result.mappings.return_value.first.return_value = mock_row
            mock_conn.execute = AsyncMock(return_value=mock_result)
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=None)

            result = await _check_module_progress(
                user_ids=[1], meeting_id=42, threshold=0.5
            )

            # User completed 100% (1/1), above 50% threshold
            assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_when_user_below_threshold(self):
        """Should return True (send nudge) when a user is below threshold."""
        from core.notifications.scheduler import _check_module_progress
        from uuid import UUID

        mock_module = MagicMock()
        mock_module.content_id = UUID("12345678-1234-1234-1234-123456789012")

        mock_course = MagicMock()

        mock_row = {
            "meeting_number": 1,
            "course_slug_override": None,
            "course_slug": "test-course",
        }

        with (
            patch("core.database.get_connection") as mock_conn_ctx,
            patch(
                "core.modules.course_loader.load_course", return_value=mock_course
            ),
            patch(
                "core.modules.course_loader.get_required_modules",
                return_value=[MagicMock(path="modules/mod1")],
            ),
            patch(
                "core.modules.course_loader.get_due_by_meeting", return_value=1
            ),
            patch(
                "core.modules.course_loader._extract_slug_from_path",
                return_value="mod1",
            ),
            patch(
                "core.modules.loader.load_flattened_module",
                return_value=mock_module,
            ),
            patch(
                "core.modules.progress.get_module_progress",
                new_callable=AsyncMock,
                return_value={},  # No completion records = 0%
            ),
        ):
            mock_conn = AsyncMock()
            mock_result = MagicMock()
            mock_result.mappings.return_value.first.return_value = mock_row
            mock_conn.execute = AsyncMock(return_value=mock_result)
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock(return_value=None)

            result = await _check_module_progress(
                user_ids=[1], meeting_id=42, threshold=0.5
            )

            # User completed 0%, below 50% threshold
            assert result is True
