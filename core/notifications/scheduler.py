"""
APScheduler-based job scheduler for notifications.

Jobs are persisted to PostgreSQL so they survive restarts.

This module implements lightweight jobs - storing only meeting_id and reminder_type,
then fetching fresh context at execution time. This avoids stale data issues.
"""

import fnmatch
import logging
import os
import random
from datetime import datetime, timedelta, timezone

from apscheduler.jobstores.base import JobLookupError
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)


_scheduler: AsyncIOScheduler | None = None


# =============================================================================
# Reminder type mappings
# =============================================================================

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


# =============================================================================
# Scheduler initialization and shutdown
# =============================================================================


def _get_database_url() -> str:
    """Get sync database URL for APScheduler (it uses sync SQLAlchemy)."""
    database_url = os.environ.get("DATABASE_URL", "")
    # APScheduler needs sync URL (not asyncpg)
    if "postgresql+asyncpg://" in database_url:
        database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")

    # Add connection timeout to prevent hanging when DB is unavailable
    if database_url and "?" not in database_url:
        database_url += "?connect_timeout=5"
    elif database_url and "connect_timeout" not in database_url:
        database_url += "&connect_timeout=5"

    return database_url


def init_scheduler(skip_if_db_unavailable: bool = True) -> AsyncIOScheduler | None:
    """
    Initialize and start the APScheduler.

    Call this during app startup (in FastAPI lifespan).

    Args:
        skip_if_db_unavailable: If True, gracefully skip scheduler when DB is unreachable
                                instead of blocking. Defaults to True.
    """
    global _scheduler

    if _scheduler is not None:
        return _scheduler

    database_url = _get_database_url()

    # Try to initialize with database persistence
    jobstores = {}
    if database_url:
        jobstores["default"] = SQLAlchemyJobStore(
            url=database_url,
            tablename="apscheduler_jobs",
        )

    _scheduler = AsyncIOScheduler(
        jobstores=jobstores,
        job_defaults={
            "coalesce": True,  # Combine missed runs into one
            "max_instances": 1,
            "misfire_grace_time": 3600,  # Allow 1 hour late execution
        },
    )

    try:
        _scheduler.start()
        print("Notification scheduler started")
    except Exception as e:
        if skip_if_db_unavailable and "timeout" in str(e).lower():
            # Database unavailable - fall back to in-memory scheduler
            print(
                "Warning: Could not connect to database for scheduler: timeout expired"
            )
            print("  └─ Scheduler running in memory-only mode (jobs won't persist)")
            _scheduler = AsyncIOScheduler(
                jobstores={},  # No persistence
                job_defaults={
                    "coalesce": True,
                    "max_instances": 1,
                    "misfire_grace_time": 3600,
                },
            )
            _scheduler.start()
            print("Notification scheduler started (memory-only)")
        else:
            raise

    return _scheduler


def shutdown_scheduler() -> None:
    """
    Shutdown the scheduler gracefully.

    Call this during app shutdown.
    """
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        print("Notification scheduler stopped")


# =============================================================================
# Job scheduling - lightweight jobs
# =============================================================================


def schedule_reminder(
    meeting_id: int,
    reminder_type: str,
    run_at: datetime,
) -> None:
    """
    Schedule a lightweight reminder job.

    Only stores meeting_id and reminder_type - fresh context is fetched at execution time.

    Args:
        meeting_id: Meeting ID to send reminder for
        reminder_type: One of "reminder_24h", "reminder_1h", "module_nudge_3d"
        run_at: When to send the notification
    """
    if not _scheduler:
        logger.warning("Scheduler not initialized, cannot schedule reminder")
        return

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


def cancel_reminders(pattern: str) -> int:
    """
    Cancel scheduled reminders matching a pattern.

    Args:
        pattern: Glob pattern to match job IDs (e.g., "meeting_123_*")

    Returns:
        Number of jobs cancelled
    """
    if not _scheduler:
        return 0

    cancelled = 0
    for job in _scheduler.get_jobs():
        if fnmatch.fnmatch(job.id, pattern):
            job.remove()
            cancelled += 1

    return cancelled


# =============================================================================
# Job execution - fetches fresh context
# =============================================================================


async def _execute_reminder(meeting_id: int, reminder_type: str) -> None:
    """
    Execute a reminder with fresh context from DB.

    This is the job function called by APScheduler.

    Args:
        meeting_id: Meeting ID to send reminder for
        reminder_type: Type of reminder (determines message template)
    """
    # Import here to avoid circular imports
    from core.notifications.context import (
        get_meeting_with_group,
        get_active_member_ids,
        build_reminder_context,
    )
    from core.notifications.dispatcher import (
        send_notification,
        send_channel_notification,
    )

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
            logger.info(
                f"Condition not met for {reminder_type} on meeting {meeting_id}"
            )
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


# =============================================================================
# Diff-based sync
# =============================================================================


async def sync_meeting_reminders(meeting_id: int) -> dict:
    """
    Diff-based sync: ensure correct jobs exist for a meeting.

    Creates missing jobs, removes orphaned jobs.
    Idempotent and self-healing.

    Returns dict with created/deleted/unchanged counts, or error key on failure.
    """
    from core.notifications.context import get_meeting_with_group

    # Early return if scheduler not available
    if not _scheduler:
        return {"created": 0, "deleted": 0, "unchanged": 0}

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
                reminder_type = job.id[len(prefix) :]
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


# =============================================================================
# Condition checking
# =============================================================================


async def _check_condition(
    condition: dict, user_ids: list[int], meeting_id: int | None = None
) -> bool:
    """
    Check if a reminder condition is met.

    Used for conditional reminders like module progress nudges.

    Args:
        condition: Dict with condition type and parameters
        user_ids: Users to check
        meeting_id: Optional meeting ID for context

    Returns:
        True if condition is met and reminder should send
    """
    condition_type = condition.get("type")

    if condition_type == "module_progress":
        # Check if user hasn't completed required modules
        condition.get("meeting_id")
        condition.get("threshold", 1.0)  # 1.0 = 100%
        # TODO: Implement module progress check
        # For now, always return True
        return True

    return True


# =============================================================================
# Sync retries
# =============================================================================


def get_retry_delay(attempt: int, include_jitter: bool = True) -> float:
    """
    Calculate retry delay using exponential backoff with cap.

    Args:
        attempt: Zero-based attempt number (0 = first retry)
        include_jitter: Add random jitter to prevent thundering herd

    Returns:
        Delay in seconds (1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 1800, 1800...)
    """
    base_delay = min(2**attempt, 1800)  # Cap at 30 minutes
    if include_jitter:
        # Jitter scales with delay to spread out retries
        jitter = random.uniform(0, min(base_delay * 0.1, 60))
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
    run_at = datetime.now(timezone.utc) + timedelta(seconds=delay)

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
    logger.info(
        f"Scheduled {sync_type} sync retry for group {group_id} in {delay:.1f}s (attempt {attempt + 1})"
    )


MAX_SYNC_RETRY_ATTEMPTS = 12  # ~6 hours with exponential backoff (caps at 30min)


async def _execute_sync_retry(
    sync_type: str,
    group_id: int,
    attempt: int,
    previous_group_id: int | None = None,
) -> None:
    """
    Execute a sync retry. Called by APScheduler.

    If sync fails again, schedules another retry (up to MAX_SYNC_RETRY_ATTEMPTS).
    """
    import sentry_sdk
    from core.sync import (
        sync_group_calendar,
        sync_group_discord_permissions,
        sync_group_reminders,
        sync_group_rsvps,
    )

    # Check if we've exceeded max retries
    if attempt > MAX_SYNC_RETRY_ATTEMPTS:
        logger.error(
            f"Sync {sync_type} for group {group_id} exceeded max retries ({MAX_SYNC_RETRY_ATTEMPTS}), giving up"
        )
        sentry_sdk.capture_message(
            f"Sync permanently failed after {MAX_SYNC_RETRY_ATTEMPTS} attempts: {sync_type} group {group_id}"
        )
        return

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
            logger.warning(
                f"Sync {sync_type} for group {group_id} had failures, scheduling retry (attempt {attempt})"
            )
            schedule_sync_retry(sync_type, group_id, attempt, previous_group_id)
        else:
            logger.info(
                f"Sync {sync_type} for group {group_id} succeeded on attempt {attempt}"
            )

    except Exception as e:
        logger.error(f"Sync {sync_type} for group {group_id} failed: {e}")
        sentry_sdk.capture_exception(e)
        schedule_sync_retry(sync_type, group_id, attempt, previous_group_id)
