"""Sync RSVP responses from Google Calendar to database."""

import logging
from datetime import timezone

from dateutil.parser import isoparse
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from core.database import get_connection
from core.tables import meetings, attendances, users
from core.enums import RSVPStatus
from .events import get_event_instances

logger = logging.getLogger(__name__)


# Map Google Calendar response status to our RSVPStatus enum
GOOGLE_TO_RSVP_STATUS = {
    "needsAction": RSVPStatus.pending,
    "accepted": RSVPStatus.attending,
    "declined": RSVPStatus.not_attending,
    "tentative": RSVPStatus.tentative,
}


async def sync_group_rsvps_from_recurring(
    group_id: int,
    recurring_event_id: str,
) -> dict[str, int]:
    """
    Sync RSVPs for all meetings in a group from recurring event instances.

    Fetches all instances in ONE API call, then matches each instance
    to a meeting by comparing datetime.

    Diff-based: Only updates attendance records where status actually changed.

    Args:
        group_id: Database group ID
        recurring_event_id: Google Calendar recurring event ID

    Returns:
        {"instances_fetched": N, "synced": N, "skipped": N, "rsvps_updated": N}
    """
    # Fetch all instances in one API call
    instances = await get_event_instances(recurring_event_id)
    if instances is None:
        return {"instances_fetched": 0, "synced": 0, "error": "api_failed"}

    result = {
        "instances_fetched": len(instances),
        "synced": 0,
        "skipped": 0,
        "rsvps_updated": 0,  # Actual DB updates (not no-ops)
    }

    async with get_connection() as conn:
        # Get all meetings for the group
        meetings_result = await conn.execute(
            select(meetings.c.meeting_id, meetings.c.scheduled_at).where(
                meetings.c.group_id == group_id
            )
        )
        meetings_by_time = {
            row["scheduled_at"].replace(tzinfo=timezone.utc): row["meeting_id"]
            for row in meetings_result.mappings()
        }

        # Process each instance
        for instance in instances:
            # Parse instance start time with error handling
            start_str = instance.get("start", {}).get("dateTime")
            if not start_str:
                continue

            try:
                instance_time = isoparse(start_str).replace(tzinfo=timezone.utc)
            except (ValueError, TypeError) as e:
                logger.warning(f"Failed to parse instance datetime '{start_str}': {e}")
                result["skipped"] += 1
                continue

            # Find matching meeting
            meeting_id = meetings_by_time.get(instance_time)
            if not meeting_id:
                # No matching meeting (time mismatch)
                result["skipped"] += 1
                continue

            # Sync attendee RSVPs for this instance
            for attendee in instance.get("attendees", []):
                email = attendee.get("email", "").lower()
                google_status = attendee.get("responseStatus", "needsAction")
                our_status = GOOGLE_TO_RSVP_STATUS.get(
                    google_status, RSVPStatus.pending
                )

                # Find user by email
                user_result = await conn.execute(
                    select(users.c.user_id).where(users.c.email == email)
                )
                user_row = user_result.first()

                if user_row:
                    # Upsert attendance record - only update if status changed
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
                        # Only update if status actually changed (diff-based)
                        where=(attendances.c.rsvp_status != our_status),
                    )
                    db_result = await conn.execute(stmt)
                    # Track actual updates (rowcount > 0 means insert or update happened)
                    if db_result.rowcount > 0:
                        result["rsvps_updated"] += 1

            result["synced"] += 1

        await conn.commit()

    return result
