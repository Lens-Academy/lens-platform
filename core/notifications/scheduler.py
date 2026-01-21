"""
APScheduler-based job scheduler for notifications.

Jobs are persisted to PostgreSQL so they survive restarts.
"""

import fnmatch
import os
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore


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
