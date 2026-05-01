"""
High-level notification actions.

These functions are called by business logic (cogs, routes) to send notifications.
They handle building context and scheduling reminders.
"""

import logging
from datetime import datetime

from core.enums import NotificationReferenceType
from core.notifications.dispatcher import send_notification
from core.notifications.scheduler import (
    schedule_reminder,
    cancel_reminders,
    REMINDER_CONFIG,
)
from core.notifications.urls import (
    build_profile_url,
    build_discord_channel_url,
    build_discord_invite_url,
)
from core.timezone import (
    format_recurring_time_utc,
    parse_recurring_meeting_time,
)

logger = logging.getLogger(__name__)


def _build_meeting_time_context(
    recurring_meeting_time_utc: str,
    next_meeting_at: datetime | None,
) -> dict:
    """Build the meeting-time slice of the notification context.

    Three cases:

    1. ``next_meeting_at`` provided: pass an ISO timestamp via
       ``meeting_time_utc`` so the dispatcher converts to the user's
       timezone using the actual date (correct DST offset).

    2. Recurring string parseable: pass the string via
       ``meeting_time_recurring_utc`` so the dispatcher localizes it
       against ``now()``.

    3. Recurring string unparseable: log a warning and ensure the
       fallback carries an explicit UTC marker so the user can
       interpret the time correctly. ("TBD"-style non-time strings
       pass through unchanged.)
    """
    if next_meeting_at is not None:
        if next_meeting_at.tzinfo is None:
            from datetime import timezone

            next_meeting_at = next_meeting_at.replace(tzinfo=timezone.utc)
        parsed = parse_recurring_meeting_time(recurring_meeting_time_utc)
        if parsed:
            day_name, hour, minute = parsed
            fallback = format_recurring_time_utc(day_name, hour, minute)
        else:
            fallback = next_meeting_at.strftime("%A at %H:%M UTC")
        return {
            "meeting_time_utc": next_meeting_at.isoformat(),
            "meeting_time": fallback,
        }

    parsed = parse_recurring_meeting_time(recurring_meeting_time_utc)
    if parsed:
        day_name, hour, minute = parsed
        return {
            "meeting_time_recurring_utc": recurring_meeting_time_utc,
            "meeting_time": format_recurring_time_utc(day_name, hour, minute),
        }

    fallback = recurring_meeting_time_utc
    if fallback and any(c.isdigit() for c in fallback):
        # Time-shaped but unparseable — surface the bad data and at least mark UTC
        logger.warning(
            "Could not parse recurring meeting time %r; falling back with UTC marker",
            recurring_meeting_time_utc,
        )
        if "UTC" not in fallback.upper():
            fallback = f"{fallback} UTC"
    return {"meeting_time": fallback}


async def notify_welcome(user_id: int) -> dict:
    """
    Send welcome notification when user enrolls in a cohort.

    Args:
        user_id: Database user ID

    Returns:
        Delivery status dict
    """
    return await send_notification(
        user_id=user_id,
        message_type="welcome",
        context={
            "profile_url": build_profile_url(),
            "discord_invite_url": build_discord_invite_url(),
        },
    )


async def notify_group_assigned(
    user_id: int,
    group_name: str,
    recurring_meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    zoom_join_url: str = "",
    reference_type: NotificationReferenceType | None = None,
    reference_id: int | None = None,
    next_meeting_at: datetime | None = None,
) -> dict:
    """
    Send notification when user is assigned to a group.

    Args:
        user_id: Database user ID
        group_name: Name of the assigned group
        recurring_meeting_time_utc: Recurring weekly slot string from
            ``groups.recurring_meeting_time_utc`` (e.g. "Wednesday 15:00").
        member_names: List of group member names
        discord_channel_id: Discord channel ID for the group
        zoom_join_url: Zoom join URL for the meeting
        reference_type: Type of entity this notification references
        reference_id: ID of the referenced entity (for deduplication)
        next_meeting_at: Concrete datetime of the next upcoming meeting,
            used for DST-correct timezone formatting. Falls back to the
            recurring string when not provided.
    """
    return await send_notification(
        user_id=user_id,
        message_type="group_assigned",
        context={
            "group_name": group_name,
            **_build_meeting_time_context(recurring_meeting_time_utc, next_meeting_at),
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(
                channel_id=discord_channel_id
            ),
            "zoom_join_url": zoom_join_url,
        },
        reference_type=reference_type,
        reference_id=reference_id,
    )


async def notify_member_joined(
    user_id: int,
    group_name: str,
    recurring_meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    discord_user_id: str,
    zoom_join_url: str = "",
    next_meeting_at: datetime | None = None,
) -> dict:
    """
    Send notification when a user directly joins a group.

    Unlike notify_group_assigned (used during realization), this is for
    users who join an existing group via the web UI. It sends:
    - Email to the joining user
    - Discord message to the group channel (welcoming the new member)

    See ``notify_group_assigned`` for the meaning of meeting-time params.
    """
    return await send_notification(
        user_id=user_id,
        message_type="member_joined",
        context={
            "group_name": group_name,
            **_build_meeting_time_context(recurring_meeting_time_utc, next_meeting_at),
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(
                channel_id=discord_channel_id
            ),
            "member_mention": f"<@{discord_user_id}>",
            "zoom_join_url": zoom_join_url,
        },
        channel_id=discord_channel_id,  # dispatcher expects channel_id
    )


async def notify_member_left(
    discord_channel_id: str,
    discord_user_id: str,
) -> dict:
    """
    Send notification to a group channel when a member leaves.

    Only sends a Discord channel message (no email to the leaving user).

    Args:
        discord_channel_id: Discord channel ID for the group they left
        discord_user_id: Discord user ID for mention in channel message
    """
    from core.discord_outbound import send_channel_message
    from core.notifications.templates import get_message

    context = {"member_mention": f"<@{discord_user_id}>"}
    message = get_message("member_left", "discord_channel", context)

    result = await send_channel_message(discord_channel_id, message)
    return {"discord_channel": result}


def schedule_meeting_reminders(
    meeting_id: int,
    meeting_time: datetime,
) -> None:
    """
    Schedule all reminders for a meeting.

    Only needs meeting_id and meeting_time - everything else is fetched
    fresh at execution time. This avoids stale data issues.

    Reminder types and timing are defined in REMINDER_CONFIG (scheduler.py).

    Args:
        meeting_id: Database meeting ID
        meeting_time: When the meeting is scheduled
    """
    for reminder_type, config in REMINDER_CONFIG.items():
        schedule_reminder(
            meeting_id=meeting_id,
            reminder_type=reminder_type,
            run_at=meeting_time + config["offset"],
        )


def cancel_meeting_reminders(meeting_id: int) -> int:
    """
    Cancel all reminders for a meeting.

    Call this when a meeting is deleted or rescheduled.

    Returns:
        Number of jobs cancelled
    """
    return cancel_reminders(f"meeting_{meeting_id}_*")


def reschedule_meeting_reminders(
    meeting_id: int,
    new_meeting_time: datetime,
) -> None:
    """
    Reschedule all reminders for a meeting.

    Cancels existing reminders and schedules new ones.

    Args:
        meeting_id: Database meeting ID
        new_meeting_time: New scheduled time for the meeting
    """
    cancel_meeting_reminders(meeting_id)
    schedule_meeting_reminders(
        meeting_id=meeting_id,
        meeting_time=new_meeting_time,
    )
