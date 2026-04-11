"""Tests for sync retry scheduling."""

from unittest.mock import MagicMock, patch

from core.notifications.scheduler import get_retry_delay, schedule_sync_retry


class TestGetRetryDelay:
    """Test exponential backoff calculation."""

    def test_first_attempt_is_1_second(self):
        """First retry should be ~1 second."""
        delay = get_retry_delay(attempt=0)
        assert 1 <= delay <= 2  # 1s + up to 1s jitter

    def test_exponential_growth(self):
        """Delay should double each attempt."""
        delay_0 = get_retry_delay(attempt=0, include_jitter=False)
        delay_1 = get_retry_delay(attempt=1, include_jitter=False)
        delay_2 = get_retry_delay(attempt=2, include_jitter=False)

        assert delay_0 == 1
        assert delay_1 == 2
        assert delay_2 == 4

    def test_caps_at_30_minutes(self):
        """Delay should cap at 1800 seconds (30 minutes)."""
        # At attempt 10: 2^10 = 1024 (below cap)
        delay_10 = get_retry_delay(attempt=10, include_jitter=False)
        assert delay_10 == 1024
        # At attempt 11: 2^11 = 2048, but capped at 1800
        delay_11 = get_retry_delay(attempt=11, include_jitter=False)
        assert delay_11 == 1800
        # At attempt 20: still capped at 1800
        delay_20 = get_retry_delay(attempt=20, include_jitter=False)
        assert delay_20 == 1800

    def test_includes_jitter_by_default(self):
        """Should add random jitter to prevent thundering herd."""
        delays = [get_retry_delay(attempt=3) for _ in range(10)]
        # With jitter, not all delays should be exactly the same
        assert len(set(delays)) > 1


class TestScheduleSyncRetry:
    """Test retry job scheduling."""

    def test_schedules_job_with_correct_delay(self):
        """Should schedule a job for the calculated delay."""
        mock_scheduler = MagicMock()

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_sync_retry(
                sync_type="calendar",
                group_id=123,
                attempt=0,
            )

        mock_scheduler.add_job.assert_called_once()
        call_kwargs = mock_scheduler.add_job.call_args[1]
        assert call_kwargs["id"] == "sync_retry_calendar_123"
        assert call_kwargs["replace_existing"] is True

    def test_does_nothing_when_scheduler_unavailable(self):
        """Should gracefully handle missing scheduler."""
        with patch("core.notifications.scheduler._scheduler", None):
            # Should not raise
            schedule_sync_retry(
                sync_type="discord",
                group_id=456,
                attempt=0,
            )
