"""
Context building for notification reminders.

This module extracts the "build context for a meeting reminder" logic
so it can be reused by the scheduler at execution time.

The key insight: store only meeting_id in scheduler jobs, then fetch
fresh context when executing the reminder. This avoids stale data.
"""

from sqlalchemy import select

from core.database import get_connection
from core.enums import GroupUserStatus
from core.notifications.urls import build_course_url, build_discord_channel_url
from core.tables import groups, groups_users, meetings


async def get_meeting_with_group(meeting_id: int) -> tuple[dict, dict] | None:
    """
    Fetch meeting and its group from the database.

    Args:
        meeting_id: The meeting ID to look up

    Returns:
        Tuple of (meeting_dict, group_dict) if found, None if meeting doesn't exist.
        Both dicts contain the relevant fields needed for reminder context.
    """
    async with get_connection() as conn:
        query = (
            select(
                meetings.c.meeting_id,
                meetings.c.group_id,
                meetings.c.scheduled_at,
                meetings.c.meeting_number,
                groups.c.group_name,
                groups.c.discord_text_channel_id,
            )
            .select_from(
                meetings.join(groups, meetings.c.group_id == groups.c.group_id)
            )
            .where(meetings.c.meeting_id == meeting_id)
        )
        result = await conn.execute(query)
        row = result.mappings().first()

        if not row:
            return None

        # Split into meeting and group dicts for cleaner API
        meeting = {
            "meeting_id": row["meeting_id"],
            "group_id": row["group_id"],
            "scheduled_at": row["scheduled_at"],
            "meeting_number": row["meeting_number"],
        }
        group = {
            "group_id": row["group_id"],
            "group_name": row["group_name"],
            "discord_text_channel_id": row["discord_text_channel_id"],
        }
        return meeting, group


async def get_active_member_ids(group_id: int) -> list[int]:
    """
    Get user_ids of active group members.

    Args:
        group_id: The group to query

    Returns:
        List of user_ids for members with active status
    """
    async with get_connection() as conn:
        query = (
            select(groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        result = await conn.execute(query)
        return [row["user_id"] for row in result.mappings()]


def build_reminder_context(meeting: dict, group: dict) -> dict:
    """
    Build notification context from fresh database data.

    This is a pure function that takes meeting and group dicts
    and returns a context dict suitable for notification templates.

    Args:
        meeting: Dict with scheduled_at (datetime) and other meeting fields
        group: Dict with group_name, discord_text_channel_id

    Returns:
        Context dict with all fields needed for meeting reminder templates
    """
    scheduled_at = meeting["scheduled_at"]

    return {
        "group_name": group["group_name"],
        # ISO timestamp for per-user timezone formatting
        "meeting_time_utc": scheduled_at.isoformat(),
        "meeting_date_utc": scheduled_at.isoformat(),
        # Human-readable UTC fallback for channel messages (no user context)
        "meeting_time": scheduled_at.strftime("%A at %H:%M UTC"),
        "meeting_date": scheduled_at.strftime("%A, %B %d"),
        # Fresh URL - not stale like the old module_url bug!
        "module_url": build_course_url(),
        "discord_channel_url": build_discord_channel_url(
            channel_id=group["discord_text_channel_id"]
        ),
        # Placeholders for module-related info
        # TODO: Could be enhanced to fetch actual module progress
        "module_list": "- Check your course dashboard for assigned modules",
        "modules_remaining": "some",
    }
