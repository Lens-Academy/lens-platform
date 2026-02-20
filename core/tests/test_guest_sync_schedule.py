"""Tests for guest visit sync scheduling (grant + revoke)."""

import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta, timezone

from core.notifications.scheduler import schedule_guest_sync


class TestScheduleGuestSync:

    def test_schedules_two_jobs_for_grant_and_revoke(self):
        """Should schedule a grant job at meeting-6d and revoke job at meeting+3d."""
        meeting_time = datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc)

        mock_scheduler = MagicMock()
        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_guest_sync(group_id=42, meeting_scheduled_at=meeting_time)

        assert mock_scheduler.add_job.call_count == 2
        calls = mock_scheduler.add_job.call_args_list

        # First call: grant (meeting - 6 days)
        grant_kwargs = calls[0].kwargs
        assert grant_kwargs["trigger"] == "date"
        assert grant_kwargs["run_date"] == meeting_time - timedelta(days=6)
        assert grant_kwargs["kwargs"] == {"group_id": 42}
        assert "grant" in grant_kwargs["id"]

        # Second call: revoke (meeting + 3 days)
        revoke_kwargs = calls[1].kwargs
        assert revoke_kwargs["trigger"] == "date"
        assert revoke_kwargs["run_date"] == meeting_time + timedelta(days=3)
        assert revoke_kwargs["kwargs"] == {"group_id": 42}
        assert "revoke" in revoke_kwargs["id"]

    def test_does_nothing_when_scheduler_not_initialized(self):
        """Should not raise when scheduler is None."""
        with patch("core.notifications.scheduler._scheduler", None):
            schedule_guest_sync(
                group_id=42,
                meeting_scheduled_at=datetime.now(timezone.utc),
            )

    def test_job_ids_include_group_and_meeting_timestamp(self):
        """Job IDs should be unique per group+meeting to avoid collisions."""
        meeting_time = datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc)
        mock_scheduler = MagicMock()
        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_guest_sync(group_id=42, meeting_scheduled_at=meeting_time)

        calls = mock_scheduler.add_job.call_args_list
        grant_id = calls[0].kwargs["id"]
        revoke_id = calls[1].kwargs["id"]
        assert "42" in grant_id
        assert "42" in revoke_id
        assert grant_id != revoke_id
