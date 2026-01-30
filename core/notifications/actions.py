"""
High-level notification actions.

These functions are called by business logic (cogs, routes) to send notifications.
They handle building context and scheduling reminders.
"""

from datetime import datetime, timedelta

from core.enums import NotificationReferenceType
from core.notifications.dispatcher import send_notification
from core.notifications.scheduler import schedule_reminder, cancel_reminders
from core.notifications.urls import (
    build_profile_url,
    build_discord_channel_url,
    build_discord_invite_url,
    build_course_url,
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
    user_ids: list[int],
    group_name: str,
    discord_channel_id: str,
    module_url: str | None = None,
) -> None:
    """
    Schedule all reminders for a meeting.

    Schedules:
    - 24h before: meeting reminder
    - 1h before: meeting reminder
    - 3d before: module nudge (if <50% done)
    - 1d before: module nudge (if <100% done)
    """
    context = {
        "group_name": group_name,
        # ISO timestamp for per-user timezone formatting
        "meeting_time_utc": meeting_time.isoformat(),
        "meeting_date_utc": meeting_time.isoformat(),
        # UTC fallback for channel messages (no user context)
        "meeting_time": meeting_time.strftime("%A at %H:%M UTC"),
        "meeting_date": meeting_time.strftime("%A, %B %d"),
        "module_url": module_url or build_course_url(),
        "discord_channel_url": build_discord_channel_url(channel_id=discord_channel_id),
        "module_list": "- Check your course dashboard for assigned modules",
        "modules_remaining": "some",
    }

    # 24h reminder
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_reminder_24h",
        run_at=meeting_time - timedelta(hours=24),
        message_type="meeting_reminder_24h",
        user_ids=user_ids,
        context=context,
        channel_id=discord_channel_id,
    )

    # 1h reminder
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_reminder_1h",
        run_at=meeting_time - timedelta(hours=1),
        message_type="meeting_reminder_1h",
        user_ids=user_ids,
        context=context,
        channel_id=discord_channel_id,
    )

    # 3d module nudge (conditional: <50% complete)
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_module_nudge_3d",
        run_at=meeting_time - timedelta(days=3),
        message_type="module_nudge",
        user_ids=user_ids,
        context=context,
        condition={
            "type": "module_progress",
            "meeting_id": meeting_id,
            "threshold": 0.5,
        },
    )

    # 1d module nudge (conditional: <100% complete)
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_module_nudge_1d",
        run_at=meeting_time - timedelta(days=1),
        message_type="module_nudge",
        user_ids=user_ids,
        context=context,
        condition={
            "type": "module_progress",
            "meeting_id": meeting_id,
            "threshold": 1.0,
        },
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
    user_ids: list[int],
    group_name: str,
    discord_channel_id: str,
) -> None:
    """
    Reschedule all reminders for a meeting.

    Cancels existing reminders and schedules new ones.
    """
    cancel_meeting_reminders(meeting_id)
    schedule_meeting_reminders(
        meeting_id=meeting_id,
        meeting_time=new_meeting_time,
        user_ids=user_ids,
        group_name=group_name,
        discord_channel_id=discord_channel_id,
    )
