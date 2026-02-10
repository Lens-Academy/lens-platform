"""Voice attendance tracking — record check-ins from Discord voice joins."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, and_, func
from sqlalchemy.dialects.postgresql import insert

from core.database import get_connection, get_transaction
from core.tables import meetings, attendances, users

logger = logging.getLogger(__name__)

# Time window: 15 min before to 60 min after scheduled meeting time
WINDOW_BEFORE = timedelta(minutes=15)
WINDOW_AFTER = timedelta(minutes=60)


async def record_voice_attendance(
    discord_id: str,
    voice_channel_id: str,
) -> dict | None:
    """
    Record attendance for a user joining a meeting voice channel.

    Checks if the voice channel matches a meeting within the time window,
    looks up the user, and atomically inserts an attendance record using
    ON CONFLICT DO NOTHING (safe against concurrent joins).

    Args:
        discord_id: The user's Discord ID (as string).
        voice_channel_id: The Discord voice channel ID (as string).

    Returns:
        {"recorded": True, "meeting_id": ..., "user_id": ...} if recorded,
        None if no matching meeting, unknown user, or already recorded.
    """
    now = datetime.now(timezone.utc)

    # Read phase: find matching meeting and user
    async with get_connection() as conn:
        # 1. Find a meeting matching this voice channel within the time window
        meeting_query = (
            select(meetings.c.meeting_id, meetings.c.scheduled_at)
            .where(
                and_(
                    meetings.c.discord_voice_channel_id == voice_channel_id,
                    meetings.c.scheduled_at >= now - WINDOW_AFTER,
                    meetings.c.scheduled_at <= now + WINDOW_BEFORE,
                )
            )
            .order_by(meetings.c.scheduled_at)
            .limit(1)
        )
        meeting_result = await conn.execute(meeting_query)
        meeting_row = meeting_result.mappings().first()

        if not meeting_row:
            return None

        meeting_id = meeting_row["meeting_id"]

        # 2. Look up user by Discord ID
        user_query = select(users.c.user_id).where(users.c.discord_id == discord_id)
        user_result = await conn.execute(user_query)
        user_row = user_result.mappings().first()

        if not user_row:
            return None

        user_id = user_row["user_id"]

    # Write phase: atomic upsert with ON CONFLICT DO NOTHING
    async with get_transaction() as conn:
        stmt = insert(attendances).values(
            meeting_id=meeting_id,
            user_id=user_id,
            checked_in_at=func.now(),
        )
        stmt = stmt.on_conflict_do_nothing(
            constraint="attendances_meeting_user_unique",
        )
        result = await conn.execute(stmt)

        if result.rowcount == 0:
            # Already had an attendance record (concurrent join or breakout rejoin)
            return None

    logger.info(
        f"Attendance recorded: user {user_id} checked in to meeting {meeting_id}"
    )

    return {"recorded": True, "meeting_id": meeting_id, "user_id": user_id}
