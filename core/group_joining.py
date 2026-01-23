"""
Group joining business logic.

All logic for direct group joining lives here. API endpoints delegate to this module.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .database import get_connection, get_transaction
from .enums import GroupUserStatus
from .tables import cohorts, groups, groups_users, meetings, users


# Constants for group size thresholds
MIN_BADGE_SIZE = 3  # Groups with 3-4 members get "best size" badge
MAX_BADGE_SIZE = 4
MAX_JOINABLE_SIZE = 7  # Groups with 8+ members are hidden (8 is max capacity)


def _calculate_next_meeting(recurring_time_utc: str, first_meeting_at: datetime | None) -> str | None:
    """
    Calculate the next meeting datetime as ISO string.

    Args:
        recurring_time_utc: e.g., "Wednesday 15:00"
        first_meeting_at: First scheduled meeting datetime

    Returns:
        ISO datetime string for the next occurrence, or None if can't calculate
    """
    if first_meeting_at:
        now = datetime.now(timezone.utc)
        if first_meeting_at > now:
            return first_meeting_at.isoformat()

    if not recurring_time_utc:
        return None

    try:
        day_name, time_str = recurring_time_utc.split(" ")
        hours, minutes = map(int, time_str.split(":"))

        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        target_day = days.index(day_name)

        now = datetime.now(timezone.utc)
        current_day = now.weekday()
        days_until = (target_day - current_day) % 7
        if days_until == 0 and (now.hour > hours or (now.hour == hours and now.minute >= minutes)):
            days_until = 7  # Next week

        next_meeting = now.replace(
            hour=hours,
            minute=minutes,
            second=0,
            microsecond=0,
        ) + timedelta(days=days_until)

        return next_meeting.isoformat()
    except (ValueError, IndexError):
        return None


async def get_user_current_group(
    conn: AsyncConnection,
    user_id: int,
    cohort_id: int,
) -> dict[str, Any] | None:
    """Get user's current active group in a specific cohort, if any."""
    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            groups_users.c.group_user_id,
            groups_users.c.role,
        )
        .join(groups_users, groups.c.group_id == groups_users.c.group_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .where(groups.c.cohort_id == cohort_id)
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    return dict(row) if row else None
