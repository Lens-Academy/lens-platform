"""Sync RSVP responses from Google Calendar to database."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from core.database import get_connection
from core.tables import meetings, attendances, users
from core.enums import RSVPStatus
from .events import get_event_rsvps


# Map Google Calendar response status to our RSVPStatus enum
GOOGLE_TO_RSVP_STATUS = {
    "needsAction": RSVPStatus.pending,
    "accepted": RSVPStatus.attending,
    "declined": RSVPStatus.not_attending,
    "tentative": RSVPStatus.tentative,
}


async def sync_meeting_rsvps(meeting_id: int) -> dict[str, int]:
    """
    Sync RSVP statuses from Google Calendar to attendances table.

    Args:
        meeting_id: Database meeting ID

    Returns:
        Count of each status: {"attending": 3, "not_attending": 1, ...}
    """
    async with get_connection() as conn:
        # Get meeting's Google event ID
        result = await conn.execute(
            select(meetings.c.google_calendar_event_id).where(
                meetings.c.meeting_id == meeting_id
            )
        )
        row = result.first()

        if not row or not row.google_calendar_event_id:
            return {}

        # Get RSVPs from Google Calendar API
        google_rsvps = await get_event_rsvps(row.google_calendar_event_id)
        if google_rsvps is None:
            return {}

        counts: dict[str, int] = {}

        for attendee in google_rsvps:
            email = attendee["email"]
            google_status = attendee["responseStatus"]
            our_status = GOOGLE_TO_RSVP_STATUS.get(google_status, RSVPStatus.pending)

            counts[our_status.value] = counts.get(our_status.value, 0) + 1

            # Find user by email
            user_result = await conn.execute(
                select(users.c.user_id).where(users.c.email == email)
            )
            user_row = user_result.first()

            if user_row:
                # Upsert attendance record
                stmt = insert(attendances).values(
                    meeting_id=meeting_id,
                    user_id=user_row.user_id,
                    rsvp_status=our_status,
                    rsvp_at=func.now(),
                )
                stmt = stmt.on_conflict_do_update(
                    constraint="attendances_meeting_user_unique",
                    set_={
                        "rsvp_status": our_status,
                        "rsvp_at": func.now(),
                    },
                )
                await conn.execute(stmt)

        await conn.commit()
        return counts


async def sync_upcoming_meeting_rsvps(days_ahead: int = 7) -> int:
    """
    Sync RSVPs for all meetings in the next N days.

    Call this periodically (e.g., every 6 hours) to keep RSVPs current.

    Returns:
        Number of meetings synced
    """
    async with get_connection() as conn:
        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(days=days_ahead)

        result = await conn.execute(
            select(meetings.c.meeting_id)
            .where(meetings.c.scheduled_at > now)
            .where(meetings.c.scheduled_at < cutoff)
            .where(meetings.c.google_calendar_event_id.isnot(None))
        )

        meeting_ids = [row.meeting_id for row in result]

    # Sync each meeting (outside transaction to avoid long locks)
    for meeting_id in meeting_ids:
        try:
            await sync_meeting_rsvps(meeting_id)
        except Exception as e:
            print(f"Failed to sync RSVPs for meeting {meeting_id}: {e}")

    return len(meeting_ids)
