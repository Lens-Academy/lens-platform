"""
Meeting management service.

Coordinates database, Google Calendar, Discord, and APScheduler operations.
"""

from datetime import datetime, timedelta

from core.database import get_connection, get_transaction
from core.queries.meetings import (
    create_meeting,
    update_meeting_calendar_id,
    get_meeting,
    get_meetings_for_group,
    reschedule_meeting as db_reschedule_meeting,
    get_group_member_emails,
    get_group_member_user_ids,
)
from core.calendar import (
    create_meeting_event,
    update_meeting_event,
    is_calendar_configured,
)
from core.notifications.actions import (
    schedule_meeting_reminders,
    cancel_meeting_reminders,
)


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


async def send_calendar_invites_for_group(
    group_id: int,
    group_name: str,
    meeting_ids: list[int],
) -> int:
    """
    Send Google Calendar invites for all meetings in a group.

    Returns:
        Number of invites sent successfully
    """
    if not is_calendar_configured():
        print("Google Calendar not configured, skipping invites")
        return 0

    async with get_connection() as conn:
        # Get member emails
        emails = await get_group_member_emails(conn, group_id)

        if not emails:
            print(f"No emails found for group {group_id}, skipping calendar invites")
            return 0

        # Get meetings
        meetings_list = await get_meetings_for_group(conn, group_id)

    sent = 0
    async with get_transaction() as conn:
        for meeting in meetings_list:
            if meeting["meeting_id"] not in meeting_ids:
                continue

            event_id = await create_meeting_event(
                title=f"{group_name} - Week {meeting['meeting_number']}",
                description="Weekly AI Safety study group meeting",
                start=meeting["scheduled_at"],
                attendee_emails=emails,
            )

            if event_id:
                await update_meeting_calendar_id(conn, meeting["meeting_id"], event_id)
                sent += 1

    return sent


async def schedule_reminders_for_group(
    group_id: int,
    group_name: str,
    meeting_ids: list[int],
    discord_channel_id: str,
) -> None:
    """Schedule APScheduler reminders for all meetings in a group."""
    async with get_connection() as conn:
        user_ids = await get_group_member_user_ids(conn, group_id)
        meetings_list = await get_meetings_for_group(conn, group_id)

    for meeting in meetings_list:
        if meeting["meeting_id"] not in meeting_ids:
            continue

        schedule_meeting_reminders(
            meeting_id=meeting["meeting_id"],
            meeting_time=meeting["scheduled_at"],
            user_ids=user_ids,
            group_name=group_name,
            discord_channel_id=discord_channel_id,
        )


async def reschedule_meeting(
    meeting_id: int,
    new_time: datetime,
    group_name: str,
    discord_channel_id: str,
) -> bool:
    """
    Reschedule a single meeting.

    Updates database, Google Calendar, and APScheduler reminders.
    Discord event update is NOT handled here (requires bot context).

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

        # Get user IDs for rescheduling reminders
        user_ids = await get_group_member_user_ids(conn, meeting["group_id"])

    # Reschedule APScheduler reminders
    cancel_meeting_reminders(meeting_id)
    schedule_meeting_reminders(
        meeting_id=meeting_id,
        meeting_time=new_time,
        user_ids=user_ids,
        group_name=group_name,
        discord_channel_id=discord_channel_id,
    )

    return True
