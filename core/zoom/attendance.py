"""Zoom attendance sync — set checked_in_at from Zoom Reports API data."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.database import get_connection, get_transaction
from core.tables import attendances, meetings, users

from .participants import get_meeting_participants

logger = logging.getLogger(__name__)


async def sync_meeting_attendance(meeting_id: int, zoom_meeting_id: int) -> dict:
    """
    Sync attendance for a single meeting from Zoom Reports API.

    Fetches participant list, matches by email to users, and sets
    checked_in_at on attendance records (creating them if needed).

    Returns:
        {"participants_found": N, "matched": N, "already_checked_in": N, "checked_in": N}
        or {"skipped": "not_ended"} if report not available yet.
    """
    participants = await get_meeting_participants(zoom_meeting_id)
    if participants is None:
        return {"skipped": "not_ended"}

    # Collect unique lowercased emails
    email_to_join_time: dict[str, str] = {}
    for p in participants:
        email = p.get("user_email", "").lower()
        if email and email not in email_to_join_time:
            email_to_join_time[email] = p.get("join_time", "")

    result = {
        "participants_found": len(participants),
        "matched": 0,
        "already_checked_in": 0,
        "checked_in": 0,
    }

    if not email_to_join_time:
        return result

    async with get_transaction() as conn:
        # Batch-lookup users by email
        user_rows = await conn.execute(
            select(users.c.user_id, users.c.email).where(
                users.c.email.in_(list(email_to_join_time.keys()))
            )
        )
        email_to_user_id = {row.email.lower(): row.user_id for row in user_rows}

        result["matched"] = len(email_to_user_id)

        # Upsert attendance for each matched user
        for email, user_id in email_to_user_id.items():
            join_time = email_to_join_time.get(email)
            checked_in_at = (
                _parse_zoom_time(join_time) if join_time else datetime.now(timezone.utc)
            )

            stmt = pg_insert(attendances).values(
                meeting_id=meeting_id,
                user_id=user_id,
                checked_in_at=checked_in_at,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="attendances_meeting_user_unique",
                set_={"checked_in_at": checked_in_at},
                where=attendances.c.checked_in_at.is_(None),
            )
            db_result = await conn.execute(stmt)
            if db_result.rowcount > 0:
                result["checked_in"] += 1
            else:
                result["already_checked_in"] += 1

    return result


async def sync_zoom_attendance() -> dict:
    """
    Sync attendance for all recently-ended Zoom meetings.

    Polls meetings where scheduled_at is between 30 minutes and 48 hours ago
    and zoom_meeting_id is set. Called periodically by APScheduler.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=48)
    window_end = now - timedelta(minutes=30)

    result = {
        "meetings_polled": 0,
        "meetings_not_ended": 0,
        "meetings_synced": 0,
        "meetings_failed": 0,
        "total_checked_in": 0,
    }

    async with get_connection() as conn:
        rows = await conn.execute(
            select(meetings.c.meeting_id, meetings.c.zoom_meeting_id).where(
                meetings.c.zoom_meeting_id.isnot(None),
                meetings.c.scheduled_at >= window_start,
                meetings.c.scheduled_at <= window_end,
            )
        )
        meeting_rows = rows.all()

    for row in meeting_rows:
        result["meetings_polled"] += 1
        try:
            sync_result = await sync_meeting_attendance(
                row.meeting_id, row.zoom_meeting_id
            )
            if sync_result.get("skipped") == "not_ended":
                result["meetings_not_ended"] += 1
            else:
                result["meetings_synced"] += 1
                result["total_checked_in"] += sync_result.get("checked_in", 0)
        except Exception:
            logger.exception(
                f"Failed to sync attendance for meeting {row.meeting_id} "
                f"(zoom_id={row.zoom_meeting_id})"
            )
            result["meetings_failed"] += 1

    logger.info(f"Zoom attendance sync complete: {result}")
    return result


def _parse_zoom_time(time_str: str) -> datetime:
    """Parse a Zoom ISO 8601 timestamp."""
    # Zoom uses format like "2026-04-07T18:02:00Z"
    return datetime.fromisoformat(time_str.replace("Z", "+00:00"))
