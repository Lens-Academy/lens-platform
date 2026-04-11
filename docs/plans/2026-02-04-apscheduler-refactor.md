# APScheduler Refactor: Lightweight Jobs + Fresh Context

**Date:** 2026-02-04
**Status:** Reviewed ✓
**Estimated Effort:** ~6 hours

## Summary

Refactor APScheduler usage to:
1. Store only `meeting_id` + `reminder_type` (lightweight jobs)
2. Fetch fresh context at execution time
3. Add diff-based sync for self-healing

**No new dependencies. No migration headaches.**

---

## Problem

Current APScheduler jobs store full context at schedule time:

```python
job.kwargs = {
    "message_type": "meeting_reminder_24h",
    "user_ids": [1, 2, 3, 4, 5],           # Stale if members change
    "context": {
        "group_name": "Group 1",
        "meeting_time": "Thursday at 17:00 UTC",
        "module_url": "https://.../module/next",  # BUG: stale URL
        "discord_channel_url": "...",
    },
}
```

**Problems:**
- Context goes stale (e.g., `/module/next` bug)
- Must update jobs when membership changes
- No diff-based sync possible

---

## Solution

### Current vs Target

```
CURRENT                                TARGET
───────────────────────────────────    ───────────────────────────────────
Job stores:                            Job stores:
├─ meeting_id                          ├─ meeting_id
├─ user_ids: [1,2,3,4,5]    ← STALE   └─ reminder_type
├─ context:                  ← STALE
│  ├─ group_name                       Execution fetches:
│  ├─ meeting_time                     ├─ meeting (from DB)
│  ├─ module_url             ← BUG!    ├─ group (from DB)
│  └─ ...                              ├─ members (from DB)
└─ channel_id                          └─ builds fresh context
```

---

## Files to Change

| File | Action | Description |
|------|--------|-------------|
| `core/notifications/scheduler.py` | **Modify** | Lightweight jobs, fresh execution, diff-based sync |
| `core/notifications/actions.py` | **Modify** | Simplify `schedule_meeting_reminders()` |
| `core/notifications/context.py` | **Create** | Extract context-building logic |
| `core/sync.py` | **Verify** | Ensure `sync_group_reminders()` works with new `sync_meeting_reminders()` signature |
| `core/notifications/tests/test_scheduler.py` | **Modify** | Update tests |
| `core/notifications/tests/test_context.py` | **Create** | Test context building |

---

## Architecture

### New Module: `context.py`

Extracts the "build context for a meeting reminder" logic so it can be reused.

```python
# core/notifications/context.py

async def get_meeting_with_group(meeting_id: int) -> tuple[Row, Row] | None:
    """Fetch meeting and its group. Returns None if meeting doesn't exist."""
    ...

async def get_active_member_ids(group_id: int) -> list[int]:
    """Get user_ids of active group members."""
    ...

def build_reminder_context(meeting: Row, group: Row) -> dict:
    """Build notification context from fresh DB data."""
    return {
        "group_name": group["group_name"],
        "meeting_time_utc": meeting["scheduled_at"].isoformat(),
        "meeting_time": meeting["scheduled_at"].strftime("%A at %H:%M UTC"),
        "module_url": build_course_url(),
        "discord_channel_url": build_discord_channel_url(
            channel_id=group["discord_text_channel_id"]
        ),
        "module_list": "- Check your course dashboard for assigned modules",
        "modules_remaining": "some",
    }
```

### Refactored: `scheduler.py`

```python
# core/notifications/scheduler.py

# Message type mapping: reminder_type -> template message_type
REMINDER_MESSAGE_TYPES = {
    "reminder_24h": "meeting_reminder_24h",
    "reminder_1h": "meeting_reminder_1h",
    "module_nudge_3d": "module_nudge",
}

# Conditions for conditional reminders (e.g., only send if user behind on modules)
REMINDER_CONDITIONS = {
    "module_nudge_3d": {"type": "module_progress", "threshold": 0.5},
}


def schedule_reminder(
    meeting_id: int,
    reminder_type: str,
    run_at: datetime,
) -> None:
    """Schedule a lightweight reminder job."""
    job_id = f"meeting_{meeting_id}_{reminder_type}"

    _scheduler.add_job(
        _execute_reminder,
        trigger="date",
        run_date=run_at,
        id=job_id,
        replace_existing=True,
        kwargs={
            "meeting_id": meeting_id,
            "reminder_type": reminder_type,
        },
    )
    logger.info(f"Scheduled {reminder_type} for meeting {meeting_id} at {run_at}")


async def _execute_reminder(meeting_id: int, reminder_type: str) -> None:
    """Execute a reminder with fresh context from DB."""
    from core.notifications.context import (
        get_meeting_with_group,
        get_active_member_ids,
        build_reminder_context,
    )
    from core.notifications.dispatcher import send_notification, send_channel_notification

    # Fetch fresh data
    result = await get_meeting_with_group(meeting_id)
    if not result:
        logger.info(f"Meeting {meeting_id} not found, skipping reminder")
        return

    meeting, group = result

    # Skip if meeting already passed
    if meeting["scheduled_at"] < datetime.now(timezone.utc):
        logger.info(f"Meeting {meeting_id} already passed, skipping reminder")
        return

    # Get current members
    user_ids = await get_active_member_ids(group["group_id"])
    if not user_ids:
        logger.info(f"No active members for meeting {meeting_id}, skipping")
        return

    # Check condition if this reminder type has one
    condition = REMINDER_CONDITIONS.get(reminder_type)
    if condition:
        should_send = await _check_condition(condition, user_ids, meeting_id)
        if not should_send:
            logger.info(f"Condition not met for {reminder_type} on meeting {meeting_id}")
            return

    # Build fresh context
    context = build_reminder_context(meeting, group)

    # Get the template message type
    message_type = REMINDER_MESSAGE_TYPES.get(reminder_type, reminder_type)

    # Send to channel if applicable (meeting reminders, not module nudges)
    if reminder_type in ("reminder_24h", "reminder_1h"):
        channel_id = group["discord_text_channel_id"]
        if channel_id:
            await send_channel_notification(channel_id, message_type, context)

    # Send to each member
    for user_id in user_ids:
        await send_notification(
            user_id=user_id,
            message_type=message_type,
            context=context,
        )


async def sync_meeting_reminders(meeting_id: int) -> dict:
    """
    Diff-based sync: ensure correct jobs exist for a meeting.

    Creates missing jobs, removes orphaned jobs.
    Idempotent and self-healing.

    Returns dict with created/deleted/unchanged counts, or error key on failure.
    """
    from core.notifications.context import get_meeting_with_group

    try:
        result = await get_meeting_with_group(meeting_id)
        now = datetime.now(timezone.utc)

        # Determine expected jobs
        expected: dict[str, datetime] = {}
        if result:
            meeting, group = result
            meeting_time = meeting["scheduled_at"]

            if meeting_time > now:
                expected = {
                    "reminder_24h": meeting_time - timedelta(hours=24),
                    "reminder_1h": meeting_time - timedelta(hours=1),
                    "module_nudge_3d": meeting_time - timedelta(days=3),
                }
                # Filter out jobs scheduled in the past
                expected = {k: v for k, v in expected.items() if v > now}

        # Get current jobs (filter in Python, fine for our scale)
        current: set[str] = set()
        prefix = f"meeting_{meeting_id}_"
        for job in _scheduler.get_jobs():
            if job.id.startswith(prefix):
                reminder_type = job.id[len(prefix):]
                current.add(reminder_type)

        # Diff
        to_create = set(expected.keys()) - current
        to_delete = current - set(expected.keys())

        # Create missing
        for reminder_type in to_create:
            schedule_reminder(meeting_id, reminder_type, expected[reminder_type])

        # Delete orphaned
        for reminder_type in to_delete:
            job_id = f"meeting_{meeting_id}_{reminder_type}"
            try:
                _scheduler.remove_job(job_id)
            except JobLookupError:
                pass  # Already gone

        return {
            "created": len(to_create),
            "deleted": len(to_delete),
            "unchanged": len(current & set(expected.keys())),
        }

    except Exception as e:
        logger.error(f"Failed to sync reminders for meeting {meeting_id}: {e}")
        return {"error": str(e), "created": 0, "deleted": 0, "unchanged": 0}
```

### Simplified: `actions.py`

```python
# core/notifications/actions.py

def schedule_meeting_reminders(meeting_id: int, meeting_time: datetime) -> None:
    """
    Schedule all reminders for a meeting.

    Only needs meeting_id and meeting_time - everything else
    is fetched fresh at execution time.
    """
    from core.notifications.scheduler import schedule_reminder

    schedule_reminder(
        meeting_id=meeting_id,
        reminder_type="reminder_24h",
        run_at=meeting_time - timedelta(hours=24),
    )

    schedule_reminder(
        meeting_id=meeting_id,
        reminder_type="reminder_1h",
        run_at=meeting_time - timedelta(hours=1),
    )

    schedule_reminder(
        meeting_id=meeting_id,
        reminder_type="module_nudge_3d",
        run_at=meeting_time - timedelta(days=3),
    )
```

---

## Testing Strategy (Unit+1)

Per TDD principles: **Use real direct dependencies, mock at the slow/external boundary.**

### Layer 1: Context Building (unit)

Pure functions, no mocks needed.

```python
class TestBuildReminderContext:
    def test_builds_context_with_fresh_urls(self):
        meeting = {"scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=UTC)}
        group = {"group_name": "Group 1", "discord_text_channel_id": "123"}

        context = build_reminder_context(meeting, group)

        assert context["module_url"] == "https://lensacademy.org/course"
        assert context["group_name"] == "Group 1"
        assert "17:00" in context["meeting_time"]
```

### Layer 2: Data Fetching (unit+1)

Real DB, no mocks.

```python
class TestGetMeetingWithGroup:
    async def test_returns_meeting_and_group(self, db_with_meeting):
        meeting_id = db_with_meeting["meeting_id"]

        result = await get_meeting_with_group(meeting_id)

        assert result is not None
        meeting, group = result
        assert meeting["meeting_id"] == meeting_id
        assert group["group_id"] == meeting["group_id"]

    async def test_returns_none_for_missing_meeting(self, db_session):
        result = await get_meeting_with_group(99999)
        assert result is None
```

### Layer 3: Execution (unit+1)

Real DB, mock notification sending.

```python
class TestExecuteReminder:
    async def test_sends_to_all_active_members(self, db_with_meeting_and_members):
        meeting_id = db_with_meeting_and_members["meeting_id"]
        user_ids = db_with_meeting_and_members["user_ids"]

        with patch("core.notifications.dispatcher.send_notification") as mock:
            mock.return_value = {"email": True}
            await _execute_reminder(meeting_id, "reminder_24h")

        assert mock.call_count == len(user_ids)
        called_user_ids = {c.kwargs["user_id"] for c in mock.call_args_list}
        assert called_user_ids == set(user_ids)

    async def test_skips_past_meeting(self, db_with_past_meeting):
        meeting_id = db_with_past_meeting["meeting_id"]

        with patch("core.notifications.dispatcher.send_notification") as mock:
            await _execute_reminder(meeting_id, "reminder_24h")

        mock.assert_not_called()

    async def test_uses_fresh_context(self, db_with_meeting_and_members):
        meeting_id = db_with_meeting_and_members["meeting_id"]

        with patch("core.notifications.dispatcher.send_notification") as mock:
            mock.return_value = {"email": True}
            await _execute_reminder(meeting_id, "reminder_24h")

        context = mock.call_args.kwargs["context"]
        assert context["module_url"] == "https://lensacademy.org/course"
```

### Layer 4: Sync (unit+1)

Real DB, real APScheduler (in-memory for tests).

```python
class TestSyncMeetingReminders:
    async def test_creates_missing_jobs(self, db_with_future_meeting, scheduler):
        meeting_id = db_with_future_meeting["meeting_id"]
        # No jobs exist

        result = await sync_meeting_reminders(meeting_id)

        assert result["created"] == 3
        assert result["deleted"] == 0
        jobs = [j for j in scheduler.get_jobs() if j.id.startswith(f"meeting_{meeting_id}")]
        assert len(jobs) == 3

    async def test_deletes_orphaned_jobs(self, db_with_past_meeting, scheduler):
        meeting_id = db_with_past_meeting["meeting_id"]
        # Manually add a job that shouldn't exist
        scheduler.add_job(lambda: None, "date", id=f"meeting_{meeting_id}_reminder_24h",
                         run_date=datetime.now() + timedelta(days=1))

        result = await sync_meeting_reminders(meeting_id)

        assert result["deleted"] == 1
        jobs = [j for j in scheduler.get_jobs() if j.id.startswith(f"meeting_{meeting_id}")]
        assert len(jobs) == 0

    async def test_idempotent(self, db_with_future_meeting, scheduler):
        meeting_id = db_with_future_meeting["meeting_id"]

        await sync_meeting_reminders(meeting_id)
        result = await sync_meeting_reminders(meeting_id)  # Second call

        assert result["created"] == 0
        assert result["deleted"] == 0
        assert result["unchanged"] == 3

    async def test_returns_error_on_failure(self, scheduler):
        # Force a failure by passing invalid meeting_id that causes DB error
        with patch("core.notifications.context.get_meeting_with_group", side_effect=Exception("DB error")):
            result = await sync_meeting_reminders(999)

        assert "error" in result
        assert result["created"] == 0
```

### Layer 5: Integration with `sync_group_reminders` (unit+1)

Verify the existing `sync_group_reminders` in `core/sync.py` works with the new `sync_meeting_reminders`.

```python
class TestSyncGroupRemindersIntegration:
    async def test_syncs_all_meetings_in_group(self, db_with_group_and_meetings, scheduler):
        group_id = db_with_group_and_meetings["group_id"]
        meeting_ids = db_with_group_and_meetings["meeting_ids"]

        result = await sync_group_reminders(group_id)

        assert result["meetings"] == len(meeting_ids)
        # Each meeting should have 3 jobs
        all_jobs = [j for j in scheduler.get_jobs() if j.id.startswith("meeting_")]
        assert len(all_jobs) == len(meeting_ids) * 3
```

---

## Migration Steps

Since we can nuke the old data:

### Deployment Sequence (IMPORTANT)

The new `_execute_reminder(meeting_id, reminder_type)` has a different signature than the old one. Old jobs in the DB have `{message_type, user_ids, context, ...}` kwargs which won't match. To avoid failures:

**Option A: Maintenance Window (Recommended)**
1. **Implement new code** (with tests via TDD)
2. **Drop old jobs FIRST** (during deploy): `DELETE FROM apscheduler_jobs WHERE id LIKE 'meeting_%'`
3. **Deploy new code**
4. **Run sync** to recreate jobs with new lightweight format

**Option B: Graceful Fallback**
Add a wrapper in the new code that detects old-style kwargs and handles them:
```python
async def _execute_reminder(**kwargs) -> None:
    # Handle old-style calls during transition
    if "message_type" in kwargs:
        logger.warning(f"Old-style reminder job detected, skipping: {kwargs}")
        return

    # New-style: extract meeting_id and reminder_type
    meeting_id = kwargs["meeting_id"]
    reminder_type = kwargs["reminder_type"]
    # ... rest of implementation
```

### Migration Script

```python
# One-time migration script (run after deploy)
# scripts/migrate_reminders.py

from core.database import get_connection
from core.sync import sync_group_reminders
from core.tables import groups
from core.enums import GroupStatus
from sqlalchemy import select

async def migrate_all_reminders():
    """Recreate all meeting reminder jobs with new lightweight format."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(groups.c.group_id).where(groups.c.status == GroupStatus.active)
        )
        group_ids = [row["group_id"] for row in result.mappings()]

    print(f"Syncing reminders for {len(group_ids)} groups...")
    for group_id in group_ids:
        result = await sync_group_reminders(group_id)
        print(f"  Group {group_id}: {result}")

    print("Done!")

if __name__ == "__main__":
    import asyncio
    asyncio.run(migrate_all_reminders())
```

### Verification

After migration, verify job counts match expectations:
```sql
SELECT COUNT(*) FROM apscheduler_jobs WHERE id LIKE 'meeting_%';
-- Should be ~3 jobs per active meeting (24h, 1h, 3d nudge)
```

---

## Estimated Effort

| Task | Estimate |
|------|----------|
| Create `context.py` + tests | ~1 hour |
| Refactor `scheduler.py` + tests | ~2 hours |
| Simplify `actions.py` | ~30 min |
| Verify `core/sync.py` integration | ~15 min |
| Integration testing | ~1 hour |
| Test migration on staging | ~30 min |
| Deploy + migrate production | ~30 min |

**Total: ~6 hours**

---

## Decision Log

### Why not Procrastinate?

We considered migrating to Procrastinate (Postgres-native task queue) but decided against it:

1. **Worker process complexity** - Procrastinate typically requires a separate worker process, adding operational overhead for ~30 jobs
2. **Queryable jobs not critical** - We rarely need to query job internals
3. **Simpler fix available** - Just storing `meeting_id` in APScheduler solves the stale context problem

### Why not custom DB table?

A custom `scheduled_notifications` table + cron would work, but:
1. APScheduler already handles timing, retries, missed jobs
2. More code to write and maintain
3. APScheduler is "good enough" once we fix our usage
