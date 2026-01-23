"""
APScheduler-based job scheduler for notifications.

Jobs are persisted to PostgreSQL so they survive restarts.
"""

import fnmatch
import logging
import os
import random
from datetime import datetime, timedelta

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)


_scheduler: AsyncIOScheduler | None = None


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


def schedule_reminder(
    job_id: str,
    run_at: datetime,
    message_type: str,
    user_ids: list[int],
    context: dict,
    channel_id: str | None = None,
    condition: dict | None = None,
) -> None:
    """
    Schedule a reminder notification for later.

    Args:
        job_id: Unique job identifier (e.g., "meeting_123_reminder_24h")
        run_at: When to send the notification
        message_type: Message type from messages.yaml
        user_ids: List of user IDs to notify
        context: Template variables
        channel_id: Optional Discord channel for channel messages
        condition: Optional condition to check before sending (e.g., module progress)
    """
    if not _scheduler:
        print("Warning: Scheduler not initialized, cannot schedule reminder")
        return

    _scheduler.add_job(
        _execute_reminder,
        trigger="date",
        run_date=run_at,
        id=job_id,
        replace_existing=True,
        kwargs={
            "message_type": message_type,
            "user_ids": user_ids,
            "context": context,
            "channel_id": channel_id,
            "condition": condition,
        },
    )


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


async def _execute_reminder(
    message_type: str,
    user_ids: list[int],
    context: dict,
    channel_id: str | None = None,
    condition: dict | None = None,
) -> None:
    """
    Execute a scheduled reminder.

    This is the job function called by APScheduler.
    """
    from core.notifications.dispatcher import (
        send_notification,
        send_channel_notification,
    )

    # Check condition if specified (e.g., module progress)
    if condition:
        should_send = await _check_condition(condition, user_ids)
        if not should_send:
            print(f"Skipping reminder {message_type}: condition not met")
            return

    # Send to channel if channel_id provided (for meeting reminders)
    if channel_id:
        await send_channel_notification(channel_id, message_type, context)

    # Send individual notifications to each user
    for user_id in user_ids:
        await send_notification(
            user_id=user_id,
            message_type=message_type,
            context=context,
            channel_id=None,  # Don't send to channel again per-user
        )


async def sync_meeting_reminders(meeting_id: int) -> None:
    """
    Sync reminder job's user_ids with current group membership from DB.

    This is idempotent and self-healing - reads the source of truth (database)
    and updates the APScheduler jobs to match.

    Called when users join or leave a group.
    """
    if not _scheduler:
        return

    from core.database import get_connection
    from core.tables import meetings, groups_users
    from core.enums import GroupUserStatus
    from sqlalchemy import select

    # Get current active members for this meeting's group
    async with get_connection() as conn:
        # First get the group_id for this meeting
        meeting_result = await conn.execute(
            select(meetings.c.group_id).where(meetings.c.meeting_id == meeting_id)
        )
        meeting_row = meeting_result.mappings().first()
        if not meeting_row:
            return

        group_id = meeting_row["group_id"]

        # Get all active members of the group
        members_result = await conn.execute(
            select(groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        user_ids = [row["user_id"] for row in members_result.mappings()]

    # Update all reminder jobs for this meeting
    job_suffixes = ["reminder_24h", "reminder_1h", "module_nudge_3d", "module_nudge_1d"]

    for suffix in job_suffixes:
        job_id = f"meeting_{meeting_id}_{suffix}"
        job = _scheduler.get_job(job_id)
        if job:
            if user_ids:
                # Update with current members
                new_kwargs = {**job.kwargs, "user_ids": user_ids}
                _scheduler.modify_job(job_id, kwargs=new_kwargs)
            else:
                # No users left, remove the job
                job.remove()


async def _check_condition(condition: dict, user_ids: list[int]) -> bool:
    """
    Check if a reminder condition is met.

    Used for conditional reminders like module progress nudges.

    Args:
        condition: Dict with condition type and parameters
        user_ids: Users to check

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
    logger.info(
        f"Scheduled {sync_type} sync retry for group {group_id} in {delay:.1f}s (attempt {attempt + 1})"
    )


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
    from core.sync import (
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
