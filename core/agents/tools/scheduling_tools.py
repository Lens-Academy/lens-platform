"""Scheduling tools: schedule_reminder, list_my_reminders, cancel_reminder."""

import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

from sqlalchemy import select, update, func, insert

from core.database import get_connection, get_transaction
from core.tables import coach_scheduled_jobs

logger = logging.getLogger(__name__)

MAX_PENDING_JOBS = 20
MAX_FUTURE_DAYS = 90


SCHEDULING_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "schedule_reminder",
            "description": (
                "Schedule a future check-in with the user. "
                "At the scheduled time, you'll get a full turn to decide what to say."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "fire_at": {
                        "type": "string",
                        "description": "When to fire (ISO 8601 UTC), e.g. '2026-04-26T18:00:00Z'",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why this reminder exists (you'll see this at fire time)",
                    },
                },
                "required": ["fire_at", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_my_reminders",
            "description": "List all pending reminders for the current user.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_reminder",
            "description": "Cancel a pending reminder by its job ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {
                        "type": "string",
                        "description": "The job ID to cancel",
                    },
                },
                "required": ["job_id"],
            },
        },
    },
]


async def execute_schedule_reminder(user_id: int, fire_at: str, reason: str) -> str:
    try:
        dt = datetime.fromisoformat(fire_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return f"Invalid date format: {fire_at}. Use ISO 8601 (e.g., '2026-04-26T18:00:00Z')."

    now = datetime.now(timezone.utc)
    if dt <= now:
        return "Can't schedule in the past."

    if dt > now + timedelta(days=MAX_FUTURE_DAYS):
        return f"Can't schedule more than {MAX_FUTURE_DAYS} days in the future."

    async with get_connection() as conn:
        result = await conn.execute(
            select(func.count()).select_from(coach_scheduled_jobs).where(
                coach_scheduled_jobs.c.user_id == user_id,
                coach_scheduled_jobs.c.status == "pending",
            )
        )
        pending_count = result.scalar()

    if pending_count >= MAX_PENDING_JOBS:
        return f"You have {MAX_PENDING_JOBS} pending reminders. Cancel some before scheduling more."

    async with get_transaction() as conn:
        result = await conn.execute(
            insert(coach_scheduled_jobs)
            .values(user_id=user_id, fire_at=dt, reason=reason)
            .returning(coach_scheduled_jobs.c.job_id)
        )
        job_id = result.scalar()

    date_str = dt.strftime("%A %B %d at %I:%M %p UTC")
    return f"Scheduled reminder {job_id} for {date_str}."


async def execute_list_my_reminders(user_id: int) -> str:
    async with get_connection() as conn:
        result = await conn.execute(
            select(
                coach_scheduled_jobs.c.job_id,
                coach_scheduled_jobs.c.fire_at,
                coach_scheduled_jobs.c.reason,
            )
            .where(
                coach_scheduled_jobs.c.user_id == user_id,
                coach_scheduled_jobs.c.status == "pending",
            )
            .order_by(coach_scheduled_jobs.c.fire_at)
        )
        rows = result.fetchall()

    if not rows:
        return "No pending reminders."

    lines = ["Pending reminders:"]
    for row in rows:
        date_str = row.fire_at.strftime("%a %b %d at %I:%M %p UTC")
        lines.append(f"  [{row.job_id}] {date_str} — {row.reason}")

    return "\n".join(lines)


async def execute_cancel_reminder(user_id: int, job_id: str) -> str:
    try:
        job_uuid = UUID(job_id)
    except ValueError:
        return f"Invalid job ID: {job_id}"

    async with get_transaction() as conn:
        result = await conn.execute(
            update(coach_scheduled_jobs)
            .where(
                coach_scheduled_jobs.c.job_id == job_uuid,
                coach_scheduled_jobs.c.user_id == user_id,
                coach_scheduled_jobs.c.status == "pending",
            )
            .values(status="cancelled", resolved_at=func.now())
        )

    if result.rowcount == 0:
        return "Reminder not found (it may have already fired or been cancelled)."

    return "Cancelled."
