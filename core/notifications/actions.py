"""
High-level notification actions.

These functions are called by business logic (cogs, routes) to send notifications.
They handle building context and scheduling reminders.
"""

from datetime import datetime

from core.enums import NotificationReferenceType
from core.notifications.dispatcher import send_notification
from core.notifications.scheduler import schedule_reminder, cancel_reminders, REMINDER_CONFIG
from core.notifications.urls import (
    build_profile_url,
    build_discord_channel_url,
    build_discord_invite_url,
)


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
    meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    reference_type: NotificationReferenceType | None = None,
    reference_id: int | None = None,
) -> dict:
    """
    Send notification when user is assigned to a group.

    Calendar invites are now sent via Google Calendar API, not email attachments.

    Args:
        user_id: Database user ID
        group_name: Name of the assigned group
        meeting_time_utc: Human-readable meeting time (e.g., "Wednesday 15:00 UTC")
        member_names: List of group member names
        discord_channel_id: Discord channel ID for the group
        reference_type: Type of entity this notification references (for deduplication)
        reference_id: ID of the referenced entity (for deduplication)
    """
    return await send_notification(
        user_id=user_id,
        message_type="group_assigned",
        context={
            "group_name": group_name,
            "meeting_time": meeting_time_utc,
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(
                channel_id=discord_channel_id
            ),
        },
        reference_type=reference_type,
        reference_id=reference_id,
    )


async def notify_member_joined(
    user_id: int,
    group_name: str,
    meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    discord_user_id: str,
) -> dict:
    """
    Send notification when a user directly joins a group.

    Unlike notify_group_assigned (used during realization), this is for
    users who join an existing group via the web UI. It sends:
    - Email to the joining user
    - Discord message to the group channel (welcoming the new member)

    Args:
        user_id: Database user ID of the joining user
        group_name: Name of the group they joined
        meeting_time_utc: Human-readable meeting time
        member_names: List of all group member names (including new member)
        discord_channel_id: Discord channel ID for the group
        discord_user_id: Discord user ID for mention in channel message
    """
    return await send_notification(
        user_id=user_id,
        message_type="member_joined",
        context={
            "group_name": group_name,
            "meeting_time": meeting_time_utc,
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(
                channel_id=discord_channel_id
            ),
            "member_mention": f"<@{discord_user_id}>",
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
