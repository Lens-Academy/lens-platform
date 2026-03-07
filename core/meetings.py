"""
Meeting management service.

Coordinates database, Google Calendar, Discord, and APScheduler operations.
"""

import logging
from datetime import datetime, timedelta

from core.database import get_connection, get_transaction
from core.queries.meetings import (
    create_meeting,
    delete_meeting as db_delete_meeting,
    get_group_for_meeting,
    get_last_meeting_for_group,
    get_meeting,
    get_meetings_for_group,
    renumber_meetings_after_delete,
    reschedule_meeting as db_reschedule_meeting,
)
from core.calendar import update_meeting_event, postpone_meeting_in_recurring_event
from core.notifications.actions import (
    schedule_meeting_reminders,
    cancel_meeting_reminders,
)

logger = logging.getLogger(__name__)


async def create_meetings_for_group(
    group_id: int,
    cohort_id: int,
    group_name: str,
    first_meeting: datetime,
    num_meetings: int,
    discord_voice_channel_id: str,
    discord_events: list | None = None,
    discord_text_channel_id: str | None = None,
) -> list[int]:
    """
    Create all meeting records for a group.

    Called during group realization after Discord channels are created.

    Args:
        group_id: Database group ID
        cohort_id: Database cohort ID
        group_name: Group name (for calendar event titles)
        first_meeting: First meeting datetime (UTC)
        num_meetings: Number of weekly meetings
        discord_voice_channel_id: Voice channel ID
        discord_events: Optional list of Discord scheduled events
        discord_text_channel_id: Text channel for reminders

    Returns:
        List of created meeting_ids
    """
    meeting_ids = []

    async with get_transaction() as conn:
        for week in range(num_meetings):
            meeting_time = first_meeting + timedelta(weeks=week)

            # Get Discord event ID if available
            discord_event_id = None
            if discord_events and week < len(discord_events):
                discord_event_id = str(discord_events[week].id)

            meeting_id = await create_meeting(
                conn,
                group_id=group_id,
                cohort_id=cohort_id,
                scheduled_at=meeting_time,
                meeting_number=week + 1,
                discord_event_id=discord_event_id,
                discord_voice_channel_id=discord_voice_channel_id,
            )
            meeting_ids.append(meeting_id)

    return meeting_ids


async def schedule_reminders_for_group(
    group_id: int,
    meeting_ids: list[int],
) -> None:
    """
    Schedule APScheduler reminders for all meetings in a group.

    With lightweight jobs, we only need meeting_id and meeting_time -
    group membership and context are fetched fresh at execution time.
    """
    async with get_connection() as conn:
        meetings_list = await get_meetings_for_group(conn, group_id)

    for meeting in meetings_list:
        if meeting["meeting_id"] not in meeting_ids:
            continue

        schedule_meeting_reminders(
            meeting_id=meeting["meeting_id"],
            meeting_time=meeting["scheduled_at"],
        )


async def reschedule_meeting(
    meeting_id: int,
    new_time: datetime,
) -> bool:
    """
    Reschedule a single meeting.

    Updates database, Google Calendar, and APScheduler reminders.
    Discord event update is NOT handled here (requires bot context).

    Args:
        meeting_id: Database meeting ID
        new_time: New scheduled time

    Returns:
        True if successful
    """
    async with get_transaction() as conn:
        meeting = await get_meeting(conn, meeting_id)
        if not meeting:
            return False

        # Update database
        await db_reschedule_meeting(conn, meeting_id, new_time)

        # Update Google Calendar (sends notification to attendees)
        if meeting.get("google_calendar_event_id"):
            await update_meeting_event(
                event_id=meeting["google_calendar_event_id"],
                start=new_time,
            )

    # Reschedule APScheduler reminders (lightweight - only needs meeting_id and time)
    cancel_meeting_reminders(meeting_id)
    schedule_meeting_reminders(
        meeting_id=meeting_id,
        meeting_time=new_time,
    )

    return True


async def postpone_meeting(meeting_id: int) -> dict:
    """
    Postpone a meeting: cancel this week's meeting, shift meeting numbers down,
    and add a new meeting at the end of the course.

    Steps:
    1. Delete the meeting row (attendance cascades)
    2. Renumber subsequent meetings (decrement)
    3. Insert new meeting at end (last meeting + 7 days)
    4. Cancel reminders for deleted meeting
    5. Schedule reminders for new meeting
    6. Update Google Calendar (extend series, cancel instance)

    Returns:
        Dict with info about what happened.

    Raises:
        ValueError: If meeting not found or is in the past.
    """
    async with get_transaction() as conn:
        meeting = await get_meeting(conn, meeting_id)
        if not meeting:
            raise ValueError("Meeting not found")

        group = await get_group_for_meeting(conn, meeting_id)
        if not group:
            raise ValueError("Group not found for meeting")

        group_id = group["group_id"]
        deleted_number = meeting["meeting_number"]
        deleted_scheduled_at = meeting["scheduled_at"]

        # Get last meeting before deletion to calculate new end date
        last_meeting = await get_last_meeting_for_group(conn, group_id)
        if not last_meeting:
            raise ValueError("No meetings found for group")

        old_last_number = last_meeting["meeting_number"]
        new_meeting_time = last_meeting["scheduled_at"] + timedelta(weeks=1)

        # Delete the meeting row
        await db_delete_meeting(conn, meeting_id)

        # Renumber subsequent meetings
        await renumber_meetings_after_delete(conn, group_id, deleted_number)

        # Insert new meeting at end (number stays the same as old last,
        # because all numbers shifted down by 1)
        new_meeting_id = await create_meeting(
            conn,
            group_id=group_id,
            cohort_id=meeting["cohort_id"],
            scheduled_at=new_meeting_time,
            meeting_number=old_last_number,
            discord_voice_channel_id=meeting.get("discord_voice_channel_id"),
        )

    # Cancel reminders for deleted meeting
    cancel_meeting_reminders(meeting_id)

    # Schedule reminders for new meeting
    schedule_meeting_reminders(
        meeting_id=new_meeting_id,
        meeting_time=new_meeting_time,
    )

    # Update Google Calendar
    gcal_event_id = group.get("gcal_recurring_event_id")
    if gcal_event_id:
        await postpone_meeting_in_recurring_event(
            recurring_event_id=gcal_event_id,
            instance_start=deleted_scheduled_at,
        )

    return {
        "deleted_meeting_number": deleted_number,
        "new_meeting_id": new_meeting_id,
        "new_meeting_number": old_last_number,
        "new_meeting_time": new_meeting_time.isoformat(),
    }
