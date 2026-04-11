# Persistent Sync Retries Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add exponential backoff with persistent retries for group sync operations (Discord, Calendar, RSVPs), ensuring eventual consistency without blocking users.

**Architecture:** When sync operations fail (rate limits, network errors), schedule a retry job via APScheduler. Use exponential backoff (1s, 2s, 4s... up to 60s cap), then retry every 60 seconds indefinitely until success. User sees immediate success after DB update; sync happens in background.

**Tech Stack:** APScheduler (already integrated), existing `core/notifications/scheduler.py` patterns

---

## Background

**Current behavior:** `sync_after_group_change()` calls sync functions fire-and-forget. If they fail, errors are logged but never retried.

**New behavior:** Failed syncs are automatically retried with exponential backoff, capped at 60-second intervals, until they succeed.

**Key insight:** Users shouldn't wait for external API calls. The critical path is the DB update. Everything else can be eventually consistent.

---

## Task 1: Add `schedule_sync_retry` helper to scheduler

**Files:**
- Modify: `core/notifications/scheduler.py`
- Test: `core/tests/test_scheduler_retry.py` (create)

**Step 1: Write the failing test**

Create `core/tests/test_scheduler_retry.py`:

```python
"""Tests for sync retry scheduling."""

from unittest.mock import MagicMock, patch
from datetime import datetime, timedelta

from core.notifications.scheduler import schedule_sync_retry, get_retry_delay


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

    def test_caps_at_60_seconds(self):
        """Delay should never exceed 60 seconds."""
        delay = get_retry_delay(attempt=10, include_jitter=False)
        assert delay == 60

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
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_scheduler_retry.py -v`
Expected: FAIL with "cannot import name 'schedule_sync_retry'"

**Step 3: Write minimal implementation**

Add to `core/notifications/scheduler.py` (at the top, add to existing imports):

```python
import logging
import random
from datetime import timedelta

logger = logging.getLogger(__name__)
```

Then add the following functions:

```python
def get_retry_delay(attempt: int, include_jitter: bool = True) -> float:
    """
    Calculate retry delay using exponential backoff with cap.

    Args:
        attempt: Zero-based attempt number (0 = first retry)
        include_jitter: Add random jitter to prevent thundering herd

    Returns:
        Delay in seconds (1, 2, 4, 8, 16, 32, 60, 60, 60...)
    """
    base_delay = min(2**attempt, 60)  # Cap at 60 seconds
    if include_jitter:
        jitter = random.uniform(0, 1)
        return base_delay + jitter
    return float(base_delay)


def schedule_sync_retry(
    sync_type: str,
    group_id: int,
    attempt: int,
    previous_group_id: int | None = None,
) -> None:
    """
    Schedule a retry for a failed sync operation.

    Args:
        sync_type: One of "discord", "calendar", "reminders", "rsvps"
        group_id: Group to sync
        attempt: Current attempt number (for backoff calculation)
        previous_group_id: For group switches, the old group
    """
    if not _scheduler:
        logger.warning(f"Scheduler not available, cannot retry {sync_type} sync")
        return

    delay = get_retry_delay(attempt)
    run_at = datetime.now() + timedelta(seconds=delay)

    job_id = f"sync_retry_{sync_type}_{group_id}"

    _scheduler.add_job(
        _execute_sync_retry,
        trigger="date",
        run_date=run_at,
        id=job_id,
        replace_existing=True,  # Don't stack retries
        kwargs={
            "sync_type": sync_type,
            "group_id": group_id,
            "attempt": attempt + 1,
            "previous_group_id": previous_group_id,
        },
    )
    logger.info(f"Scheduled {sync_type} sync retry for group {group_id} in {delay:.1f}s (attempt {attempt + 1})")


async def _execute_sync_retry(
    sync_type: str,
    group_id: int,
    attempt: int,
    previous_group_id: int | None = None,
) -> None:
    """
    Execute a sync retry. Called by APScheduler.

    If sync fails again, schedules another retry.
    """
    import sentry_sdk
    from core.lifecycle import (
        sync_group_calendar,
        sync_group_discord_permissions,
        sync_group_reminders,
        sync_group_rsvps,
    )

    sync_functions = {
        "discord": sync_group_discord_permissions,
        "calendar": sync_group_calendar,
        "reminders": sync_group_reminders,
        "rsvps": sync_group_rsvps,
    }

    sync_fn = sync_functions.get(sync_type)
    if not sync_fn:
        logger.error(f"Unknown sync type: {sync_type}")
        return

    try:
        result = await sync_fn(group_id)

        # Check if sync had failures that need retry
        # Note: discord/calendar return {"failed": N}, reminders/rsvps only fail via exception
        if result.get("failed", 0) > 0 or result.get("error"):
            logger.warning(f"Sync {sync_type} for group {group_id} had failures, scheduling retry (attempt {attempt})")
            schedule_sync_retry(sync_type, group_id, attempt, previous_group_id)
        else:
            logger.info(f"Sync {sync_type} for group {group_id} succeeded on attempt {attempt}")

    except Exception as e:
        logger.error(f"Sync {sync_type} for group {group_id} failed: {e}")
        sentry_sdk.capture_exception(e)
        schedule_sync_retry(sync_type, group_id, attempt, previous_group_id)
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_scheduler_retry.py -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(scheduler): add sync retry with exponential backoff"
```

---

## Task 2: Update `sync_after_group_change` to use retries

**Files:**
- Modify: `core/group_joining.py`
- Test: `core/tests/test_group_joining.py` (add test)

**Step 1: Write the failing test**

Add to `core/tests/test_group_joining.py`:

```python
class TestSyncAfterGroupChangeRetry:
    """Test retry scheduling for failed syncs."""

    @pytest.mark.asyncio
    async def test_schedules_retry_when_discord_sync_fails(self):
        """Should schedule retry when Discord sync returns error."""
        from core.group_joining import sync_after_group_change

        with patch("core.group_joining.sync_group_discord_permissions") as mock_discord:
            mock_discord.return_value = {"error": "bot_unavailable"}

            with patch("core.group_joining.sync_group_calendar") as mock_cal:
                mock_cal.return_value = {"created": 0, "failed": 0}

                with patch("core.group_joining.sync_group_reminders") as mock_rem:
                    mock_rem.return_value = {"meetings": 0}

                    with patch("core.group_joining.sync_group_rsvps") as mock_rsvp:
                        mock_rsvp.return_value = {"meetings": 0}

                        with patch("core.group_joining.schedule_sync_retry") as mock_retry:
                            await sync_after_group_change(group_id=123)

                            # Should have scheduled a retry for discord
                            mock_retry.assert_any_call(
                                sync_type="discord",
                                group_id=123,
                                attempt=0,
                                previous_group_id=None,
                            )

    @pytest.mark.asyncio
    async def test_schedules_retry_when_calendar_has_failures(self):
        """Should schedule retry when calendar sync has failed events."""
        from core.group_joining import sync_after_group_change

        with patch("core.group_joining.sync_group_discord_permissions") as mock_discord:
            mock_discord.return_value = {"granted": 1, "failed": 0}

            with patch("core.group_joining.sync_group_calendar") as mock_cal:
                mock_cal.return_value = {"created": 2, "failed": 3}  # Some failures

                with patch("core.group_joining.sync_group_reminders") as mock_rem:
                    mock_rem.return_value = {"meetings": 0}

                    with patch("core.group_joining.sync_group_rsvps") as mock_rsvp:
                        mock_rsvp.return_value = {"meetings": 0}

                        with patch("core.group_joining.schedule_sync_retry") as mock_retry:
                            await sync_after_group_change(group_id=456)

                            # Should have scheduled a retry for calendar
                            mock_retry.assert_any_call(
                                sync_type="calendar",
                                group_id=456,
                                attempt=0,
                                previous_group_id=None,
                            )

    @pytest.mark.asyncio
    async def test_no_retry_when_all_syncs_succeed(self):
        """Should not schedule retry when everything succeeds."""
        from core.group_joining import sync_after_group_change

        with patch("core.group_joining.sync_group_discord_permissions") as mock_discord:
            mock_discord.return_value = {"granted": 1, "failed": 0}

            with patch("core.group_joining.sync_group_calendar") as mock_cal:
                mock_cal.return_value = {"created": 8, "failed": 0}

                with patch("core.group_joining.sync_group_reminders") as mock_rem:
                    mock_rem.return_value = {"meetings": 8}

                    with patch("core.group_joining.sync_group_rsvps") as mock_rsvp:
                        mock_rsvp.return_value = {"meetings": 8}

                        with patch("core.group_joining.schedule_sync_retry") as mock_retry:
                            await sync_after_group_change(group_id=789)

                            # Should not have scheduled any retries
                            mock_retry.assert_not_called()

    @pytest.mark.asyncio
    async def test_schedules_retry_when_sync_raises_exception(self):
        """Should schedule retry when sync function raises an exception."""
        from core.group_joining import sync_after_group_change

        with patch("core.group_joining.sync_group_discord_permissions") as mock_discord:
            mock_discord.side_effect = Exception("Network error")

            with patch("core.group_joining.sync_group_calendar") as mock_cal:
                mock_cal.return_value = {"created": 0, "failed": 0}

                with patch("core.group_joining.sync_group_reminders") as mock_rem:
                    mock_rem.return_value = {"meetings": 0}

                    with patch("core.group_joining.sync_group_rsvps") as mock_rsvp:
                        mock_rsvp.return_value = {"meetings": 0}

                        with patch("core.group_joining.schedule_sync_retry") as mock_retry:
                            with patch("core.group_joining.sentry_sdk"):
                                await sync_after_group_change(group_id=999)

                                # Should have scheduled a retry for discord
                                mock_retry.assert_any_call(
                                    sync_type="discord",
                                    group_id=999,
                                    attempt=0,
                                    previous_group_id=None,
                                )
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_group_joining.py::TestSyncAfterGroupChangeRetry -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Replace `sync_after_group_change` in `core/group_joining.py`:

```python
async def sync_after_group_change(
    group_id: int,
    previous_group_id: int | None = None,
) -> None:
    """
    Sync external systems after a group membership change.

    MUST be called AFTER the database transaction is committed,
    otherwise the sync functions won't see the changes.

    This is a fire-and-forget operation - errors are logged but don't
    block the user's action. Failed syncs are automatically retried
    with exponential backoff.
    """
    import logging
    import sentry_sdk

    logger = logging.getLogger(__name__)

    from .lifecycle import (
        sync_group_calendar,
        sync_group_discord_permissions,
        sync_group_reminders,
        sync_group_rsvps,
    )
    from .notifications.scheduler import schedule_sync_retry

    async def sync_with_retry(name: str, sync_type: str, coro, gid: int):
        """Run sync function, schedule retry if it fails."""
        try:
            result = await coro
            # Check if sync had failures
            if result.get("error") or result.get("failed", 0) > 0:
                logger.warning(f"{name} had failures, scheduling retry")
                schedule_sync_retry(
                    sync_type=sync_type,
                    group_id=gid,
                    attempt=0,
                    previous_group_id=previous_group_id if gid == group_id else None,
                )
            return result
        except Exception as e:
            logger.error(f"Error in {name}: {e}")
            sentry_sdk.capture_exception(e)
            schedule_sync_retry(
                sync_type=sync_type,
                group_id=gid,
                attempt=0,
                previous_group_id=previous_group_id if gid == group_id else None,
            )
            return {"error": str(e)}

    # Sync old group (if switching)
    if previous_group_id:
        await sync_with_retry(
            "sync_group_discord_permissions (old)",
            "discord",
            sync_group_discord_permissions(previous_group_id),
            previous_group_id,
        )
        await sync_with_retry(
            "sync_group_calendar (old)",
            "calendar",
            sync_group_calendar(previous_group_id),
            previous_group_id,
        )
        await sync_with_retry(
            "sync_group_reminders (old)",
            "reminders",
            sync_group_reminders(previous_group_id),
            previous_group_id,
        )
        await sync_with_retry(
            "sync_group_rsvps (old)",
            "rsvps",
            sync_group_rsvps(previous_group_id),
            previous_group_id,
        )

    # Sync new group
    await sync_with_retry(
        "sync_group_discord_permissions",
        "discord",
        sync_group_discord_permissions(group_id),
        group_id,
    )
    await sync_with_retry(
        "sync_group_calendar",
        "calendar",
        sync_group_calendar(group_id),
        group_id,
    )
    await sync_with_retry(
        "sync_group_reminders",
        "reminders",
        sync_group_reminders(group_id),
        group_id,
    )
    await sync_with_retry(
        "sync_group_rsvps",
        "rsvps",
        sync_group_rsvps(group_id),
        group_id,
    )
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_group_joining.py::TestSyncAfterGroupChangeRetry -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(group-joining): schedule retries for failed syncs"
```

---

## Task 3: Update frontend message

**Files:**
- Modify: `web_frontend/src/pages/group/+Page.tsx`

**Step 1: Update success message**

Find the success state in `+Page.tsx` (around line 140) and update the message.

```tsx
// Change from:
<p className="text-gray-600 mb-4">
  You've successfully joined your new group.
</p>

// Change to:
<p className="text-gray-600 mb-4">
  You've successfully joined your new group.
  <br />
  <span className="text-sm text-gray-500">
    Calendar invites and Discord access will be set up in the next few minutes.
  </span>
</p>
```

**Step 2: Verify manually**

1. Start dev server: `python main.py --dev`
2. Go to http://localhost:3000/group
3. Switch groups
4. Verify new message appears

**Step 3: Commit**

```bash
jj describe -m "feat(frontend): clarify that calendar/Discord sync happens in background"
```

---

## Task 4: Run all tests and verify

**Step 1: Run all tests**

```bash
pytest core/tests/ -v
```

Expected: All tests pass

**Step 2: Run linting**

```bash
ruff check .
ruff format --check .
```

Expected: All checks pass

**Step 3: Manual integration test**

1. Start server with bot: `python main.py --dev > /tmp/server.log 2>&1 &`
2. Wait for bot to connect
3. Switch groups
4. Watch logs: `tail -f /tmp/server.log | grep -E "(sync|retry|Sync)"`
5. If rate limited, verify retry is scheduled
6. Verify retry eventually succeeds (may take minutes)

**Step 4: Final commit**

```bash
jj describe -m "feat: persistent sync retries with exponential backoff

When group sync operations fail (Discord, Calendar, RSVPs), they are
automatically retried with exponential backoff (1s, 2s, 4s... capped at 60s).
Retries continue indefinitely until success.

User flow unchanged - they see immediate success after DB update.
Sync happens in background with eventual consistency guarantee."
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Add `schedule_sync_retry` helper | `core/notifications/scheduler.py` |
| 2 | Update `sync_after_group_change` to use retries | `core/group_joining.py` |
| 3 | Update frontend success message | `web_frontend/src/pages/group/+Page.tsx` |
| 4 | Run tests and verify | N/A |

**Behavior change:**
- Before: Failed syncs logged and forgotten
- After: Failed syncs retried every 60s until success

**User experience:**
- Before: "You've successfully joined your new group."
- After: "You've successfully joined your new group. Calendar invites and Discord access will be set up in the next few minutes."
