"""
High-level notification actions.

These functions are called by business logic (cogs, routes) to send notifications.
They handle building context and scheduling reminders.
"""

from datetime import datetime, timedelta

from core.notifications.dispatcher import send_notification
from core.notifications.scheduler import schedule_reminder, cancel_reminders
from core.notifications.urls import (
    build_profile_url,
    build_discord_channel_url,
    build_discord_invite_url,
    build_lesson_url,
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
    )


def schedule_meeting_reminders(
    meeting_id: int,
    meeting_time: datetime,
    user_ids: list[int],
    group_name: str,
    discord_channel_id: str,
    lesson_url: str | None = None,
) -> None:
    """
    Schedule all reminders for a meeting.

    Schedules:
    - 24h before: meeting reminder
    - 1h before: meeting reminder
    - 3d before: lesson nudge (if <50% done)
    - 1d before: lesson nudge (if <100% done)
    """
    context = {
        "group_name": group_name,
        "meeting_time": meeting_time.strftime("%A at %H:%M UTC"),
        "meeting_date": meeting_time.strftime("%A, %B %d"),
        "lesson_url": lesson_url or build_lesson_url("next"),
        "discord_channel_url": build_discord_channel_url(channel_id=discord_channel_id),
        "lesson_list": "- Check your course dashboard for assigned lessons",
        "lessons_remaining": "some",
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

    # 3d lesson nudge (conditional: <50% complete)
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_lesson_nudge_3d",
        run_at=meeting_time - timedelta(days=3),
        message_type="lesson_nudge",
        user_ids=user_ids,
        context=context,
        condition={
            "type": "lesson_progress",
            "meeting_id": meeting_id,
            "threshold": 0.5,
        },
    )

    # 1d lesson nudge (conditional: <100% complete)
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_lesson_nudge_1d",
        run_at=meeting_time - timedelta(days=1),
        message_type="lesson_nudge",
        user_ids=user_ids,
        context=context,
        condition={
            "type": "lesson_progress",
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
