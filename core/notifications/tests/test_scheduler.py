"""Tests for notification scheduler.

Following TDD: tests written first, then implementation.

Layers tested:
- Layer 3: Execution (_execute_reminder) - mock notification sending
- Layer 4: Sync (sync_meeting_reminders) - real APScheduler (in-memory)
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock, AsyncMock

import pytest
from dotenv import load_dotenv

# Load env for integration tests
load_dotenv(".env.local")


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
            assert "message_template" in config, (
                f"{reminder_type} missing message_template"
            )
            assert "send_to_channel" in config, (
                f"{reminder_type} missing send_to_channel"
            )

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
            assert config["offset"] < timedelta(0), (
                f"{reminder_type} offset should be negative"
            )


# =============================================================================
# Test _check_module_progress - Unit tests for edge cases
# =============================================================================


class TestCheckModuleProgressEdgeCases:
    """Unit tests for edge cases that don't need database."""

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

        result = await _check_module_progress(user_ids=[], meeting_id=42, threshold=0.5)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_on_db_error(self):
        """Should return True (send nudge) on error - conservative behavior."""
        from core.notifications.scheduler import _check_module_progress

        with patch(
            "core.database.get_connection",
            side_effect=Exception("DB error"),
        ):
            result = await _check_module_progress(
                user_ids=[1], meeting_id=99999, threshold=0.5
            )
            # On error, sends nudge anyway (conservative)
            assert result is True


# =============================================================================
# Test _check_module_progress - Integration tests with real DB
# =============================================================================

import pytest_asyncio
from uuid import UUID
from sqlalchemy import text


@pytest_asyncio.fixture
async def test_cohort_with_meeting():
    """
    Create test cohort, group, and meeting for progress check tests.

    Course progression (from test_cache fixture):
    - module-a (required) -> due by meeting 1
    - module-b (required) -> due by meeting 1
    - meeting 1
    - module-c (optional) -> due by meeting 2
    - meeting 2
    - module-d (required) -> no meeting after

    So for meeting 1: modules a, b are due (2 required modules)
    """
    from core.database import get_transaction

    unique_id = str(uuid.uuid4())[:8]

    async with get_transaction() as conn:
        # Create cohort with test-course
        result = await conn.execute(
            text("""
                INSERT INTO cohorts (cohort_name, course_slug, cohort_start_date, duration_days, number_of_group_meetings)
                VALUES (:name, 'test-course', CURRENT_DATE, 30, 8)
                RETURNING cohort_id
            """),
            {"name": f"test_cohort_{unique_id}"},
        )
        cohort_id = result.fetchone()[0]

        # Create group
        result = await conn.execute(
            text("""
                INSERT INTO groups (group_name, cohort_id, status)
                VALUES (:name, :cohort_id, 'active')
                RETURNING group_id
            """),
            {"name": f"test_group_{unique_id}", "cohort_id": cohort_id},
        )
        group_id = result.fetchone()[0]

        # Create meeting (meeting 1)
        result = await conn.execute(
            text("""
                INSERT INTO meetings (group_id, cohort_id, meeting_number, scheduled_at)
                VALUES (:group_id, :cohort_id, 1, NOW() + INTERVAL '3 days')
                RETURNING meeting_id
            """),
            {"group_id": group_id, "cohort_id": cohort_id},
        )
        meeting_id = result.fetchone()[0]

    yield {"cohort_id": cohort_id, "group_id": group_id, "meeting_id": meeting_id}

    # Cleanup
    async with get_transaction() as conn:
        await conn.execute(
            text("DELETE FROM meetings WHERE meeting_id = :id"), {"id": meeting_id}
        )
        await conn.execute(
            text("DELETE FROM groups WHERE group_id = :id"), {"id": group_id}
        )
        await conn.execute(
            text("DELETE FROM cohorts WHERE cohort_id = :id"), {"id": cohort_id}
        )


@pytest_asyncio.fixture
async def test_user_for_progress():
    """Create a test user for progress tests. Cleans up after test."""
    from core.database import get_transaction

    unique_id = str(uuid.uuid4())[:8]

    async with get_transaction() as conn:
        result = await conn.execute(
            text("""
                INSERT INTO users (discord_id, discord_username)
                VALUES (:discord_id, :username)
                RETURNING user_id
            """),
            {
                "discord_id": f"progress_test_{unique_id}",
                "username": f"progress_user_{unique_id}",
            },
        )
        user_id = result.fetchone()[0]

    yield user_id

    async with get_transaction() as conn:
        await conn.execute(
            text("DELETE FROM users WHERE user_id = :user_id"), {"user_id": user_id}
        )


@pytest.fixture
def test_content_cache():
    """Set up test content cache with courses and modules."""
    from core.content import ContentCache, set_cache, clear_cache
    from core.modules.flattened_types import FlattenedModule
    from core.modules.course_loader import ParsedCourse, ModuleRef, MeetingMarker

    flattened_modules = {
        "module-a": FlattenedModule(
            slug="module-a",
            title="Module A",
            content_id=UUID("00000000-0000-0000-0000-000000000001"),
            sections=[],
        ),
        "module-b": FlattenedModule(
            slug="module-b",
            title="Module B",
            content_id=UUID("00000000-0000-0000-0000-000000000002"),
            sections=[],
        ),
        "module-c": FlattenedModule(
            slug="module-c",
            title="Module C",
            content_id=UUID("00000000-0000-0000-0000-000000000003"),
            sections=[],
        ),
        "module-d": FlattenedModule(
            slug="module-d",
            title="Module D",
            content_id=UUID("00000000-0000-0000-0000-000000000004"),
            sections=[],
        ),
    }

    courses = {
        "test-course": ParsedCourse(
            slug="test-course",
            title="Test Course",
            progression=[
                ModuleRef(path="modules/module-a"),  # required, due by meeting 1
                ModuleRef(path="modules/module-b"),  # required, due by meeting 1
                MeetingMarker(number=1),
                ModuleRef(path="modules/module-c", optional=True),  # optional
                MeetingMarker(number=2),
                ModuleRef(path="modules/module-d"),  # required, no meeting after
            ],
        ),
    }

    cache = ContentCache(
        courses=courses,
        flattened_modules=flattened_modules,
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)

    yield cache

    clear_cache()


@pytest_asyncio.fixture(autouse=True)
async def cleanup_db_engine():
    """Clean up database engine after each test."""
    yield
    from core.database import close_engine

    await close_engine()


class TestCheckModuleProgressIntegration:
    """Integration tests using real database and cache."""

    @pytest.mark.asyncio
    async def test_returns_true_when_user_has_no_progress(
        self, test_cohort_with_meeting, test_user_for_progress, test_content_cache
    ):
        """User with 0% completion should trigger nudge."""
        from core.notifications.scheduler import _check_module_progress

        result = await _check_module_progress(
            user_ids=[test_user_for_progress],
            meeting_id=test_cohort_with_meeting["meeting_id"],
            threshold=0.5,
        )

        # User has 0/2 modules completed (0%), below 50% threshold
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_true_when_user_below_threshold(
        self, test_cohort_with_meeting, test_user_for_progress, test_content_cache
    ):
        """User with 1/2 modules (50%) should trigger nudge at 50% threshold."""
        from core.notifications.scheduler import _check_module_progress
        from core.database import get_transaction

        # Mark module-a as complete (1/2 = 50%)
        async with get_transaction() as conn:
            await conn.execute(
                text("""
                    INSERT INTO user_content_progress
                    (user_id, content_id, content_type, content_title, completed_at)
                    VALUES (:user_id, :content_id, 'module', 'Module A', NOW())
                """),
                {
                    "user_id": test_user_for_progress,
                    "content_id": "00000000-0000-0000-0000-000000000001",
                },
            )

        # At exactly 50%, with threshold 0.5, user is NOT below threshold
        # But let's use threshold 0.6 to ensure they're below
        result = await _check_module_progress(
            user_ids=[test_user_for_progress],
            meeting_id=test_cohort_with_meeting["meeting_id"],
            threshold=0.6,  # 60% threshold
        )

        # User has 1/2 modules (50%), below 60% threshold
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_user_above_threshold(
        self, test_cohort_with_meeting, test_user_for_progress, test_content_cache
    ):
        """User with 2/2 modules (100%) should not trigger nudge."""
        from core.notifications.scheduler import _check_module_progress
        from core.database import get_transaction

        # Mark both modules as complete
        async with get_transaction() as conn:
            await conn.execute(
                text("""
                    INSERT INTO user_content_progress
                    (user_id, content_id, content_type, content_title, completed_at)
                    VALUES
                    (:user_id, '00000000-0000-0000-0000-000000000001', 'module', 'Module A', NOW()),
                    (:user_id, '00000000-0000-0000-0000-000000000002', 'module', 'Module B', NOW())
                """),
                {"user_id": test_user_for_progress},
            )

        result = await _check_module_progress(
            user_ids=[test_user_for_progress],
            meeting_id=test_cohort_with_meeting["meeting_id"],
            threshold=0.5,
        )

        # User has 2/2 modules (100%), above 50% threshold
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_meeting_not_found(
        self, test_cohort_with_meeting, test_content_cache
    ):
        """Should return False when meeting doesn't exist (but DB is available)."""
        from core.notifications.scheduler import _check_module_progress

        result = await _check_module_progress(
            user_ids=[1],
            meeting_id=999999,  # Non-existent meeting
            threshold=0.5,
        )

        # Meeting not found, can't check progress
        assert result is False
