"""
Group joining business logic.

All logic for direct group joining lives here. API endpoints delegate to this module.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .enums import GroupUserStatus
from .tables import cohorts, groups, groups_users, meetings


# Constants for group size thresholds
MIN_BADGE_SIZE = 3  # Groups with 3-4 members get "best size" badge
MAX_BADGE_SIZE = 4
MAX_JOINABLE_SIZE = 7  # Groups with 8+ members are hidden (8 is max capacity)


def _calculate_next_meeting(
    recurring_time_utc: str, first_meeting_at: datetime | None
) -> str | None:
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

        days = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]
        target_day = days.index(day_name)

        now = datetime.now(timezone.utc)
        current_day = now.weekday()
        days_until = (target_day - current_day) % 7
        if days_until == 0 and (
            now.hour > hours or (now.hour == hours and now.minute >= minutes)
        ):
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


def assign_group_badge(member_count: int) -> str | None:
    """Assign badge based on member count. Backend decides all badges."""
    if MIN_BADGE_SIZE <= member_count <= MAX_BADGE_SIZE:
        return "best_size"
    return None


async def get_joinable_groups(
    conn: AsyncConnection,
    cohort_id: int,
    user_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Get groups available for direct joining in a cohort.

    Backend handles ALL filtering, sorting, and badge assignment:
    - Filters out full groups (7+ members)
    - Filters out groups whose first meeting has passed (unless user already has a group)
    - Sorts by member count (smallest first, to encourage balanced groups)
    - Adds badge field ("best_size" for 3-4 member groups)
    - Adds is_current field if user is already in this group
    - Calculates next_meeting_at as ISO datetime

    Args:
        cohort_id: The cohort to get groups for
        user_id: Current user's ID (for is_current flag and joining rules)

    Returns:
        List of group dicts, pre-filtered and pre-sorted, ready for frontend display
    """
    now = datetime.now(timezone.utc)

    # Check if user already has a group in this cohort (affects joining rules)
    user_current_group_id = None
    if user_id:
        current = await get_user_current_group(conn, user_id, cohort_id)
        if current:
            user_current_group_id = current["group_id"]

    # Subquery for member count per group (only active members)
    member_count_subq = (
        select(
            groups_users.c.group_id,
            func.count().label("member_count"),
        )
        .where(groups_users.c.status == GroupUserStatus.active)
        .group_by(groups_users.c.group_id)
        .subquery()
    )

    # Subquery for first meeting time per group
    first_meeting_subq = (
        select(
            meetings.c.group_id,
            func.min(meetings.c.scheduled_at).label("first_meeting_at"),
        )
        .group_by(meetings.c.group_id)
        .subquery()
    )

    # Base query with joins
    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            groups.c.status,
            func.coalesce(member_count_subq.c.member_count, 0).label("member_count"),
            first_meeting_subq.c.first_meeting_at,
        )
        .outerjoin(member_count_subq, groups.c.group_id == member_count_subq.c.group_id)
        .outerjoin(
            first_meeting_subq, groups.c.group_id == first_meeting_subq.c.group_id
        )
        .where(groups.c.cohort_id == cohort_id)
        .where(groups.c.status.in_(["preview", "active"]))
        # Filter: member count < 8 (8 is max capacity)
        .where(func.coalesce(member_count_subq.c.member_count, 0) < 8)
        # Sort: smallest groups first (nudge toward balanced sizes)
        .order_by(func.coalesce(member_count_subq.c.member_count, 0))
    )

    # Joining rule: if user has NO current group, filter out groups that have started
    # If user HAS a group, they can switch to any group (even after first meeting)
    if not user_current_group_id:
        query = query.where(
            (first_meeting_subq.c.first_meeting_at.is_(None))
            | (first_meeting_subq.c.first_meeting_at > now)
        )

    result = await conn.execute(query)
    groups_list = []

    for row in result.mappings():
        group = dict(row)

        # Add badge (backend decides)
        member_count = group["member_count"]
        if MIN_BADGE_SIZE <= member_count <= MAX_BADGE_SIZE:
            group["badge"] = "best_size"
        else:
            group["badge"] = None

        # Add is_current flag
        group["is_current"] = group["group_id"] == user_current_group_id

        # Calculate next_meeting_at as ISO datetime string
        # (so frontend doesn't need to parse "Wednesday 15:00")
        group["next_meeting_at"] = _calculate_next_meeting(
            group["recurring_meeting_time_utc"],
            group["first_meeting_at"],
        )

        # Convert first_meeting_at to ISO string if present
        if group["first_meeting_at"]:
            group["first_meeting_at"] = group["first_meeting_at"].isoformat()

        # Add has_started for informational purposes
        if group["first_meeting_at"]:
            group["has_started"] = (
                datetime.fromisoformat(group["first_meeting_at"]) <= now
            )
        else:
            group["has_started"] = False

        groups_list.append(group)

    return groups_list


async def join_group(
    conn: AsyncConnection,
    user_id: int,
    group_id: int,
    role: str = "participant",
) -> dict[str, Any]:
    """
    Join a group (or switch to a different group).

    This is THE single function for joining groups. ALL lifecycle operations
    happen here:
    1. Database: Update groups_users
    2. Discord: Grant/revoke channel permissions (TODO: implement in lifecycle module)
    3. Calendar: Send/cancel meeting invites (TODO: implement in lifecycle module)
    4. Reminders: Add/remove user from meeting reminder jobs (TODO: implement in lifecycle module)

    Args:
        conn: Database connection (should be in a transaction)
        user_id: User joining the group
        group_id: Target group
        role: "participant" or "facilitator"

    Returns:
        {"success": True, "group_id": int, "previous_group_id": int | None}
        or {"success": False, "error": str} on failure
    """
    from .queries.groups import add_user_to_group

    # Query 1: Check user's current group status
    # This query returns: group_id, group_name, recurring_meeting_time_utc, group_user_id, role
    # or None if user has no group
    current_group_query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            groups.c.cohort_id,
            groups_users.c.group_user_id,
            groups_users.c.role,
        )
        .join(groups_users, groups.c.group_id == groups_users.c.group_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
    )
    current_result = await conn.execute(current_group_query)
    current_group = current_result.mappings().first()
    current_group = dict(current_group) if current_group else None

    # Query 2: Get the target group with first meeting time and member count
    member_count_subq = (
        select(
            groups_users.c.group_id,
            func.count().label("member_count"),
        )
        .where(groups_users.c.status == GroupUserStatus.active)
        .group_by(groups_users.c.group_id)
        .subquery()
    )

    first_meeting_subq = (
        select(
            meetings.c.group_id,
            func.min(meetings.c.scheduled_at).label("first_meeting_at"),
        )
        .group_by(meetings.c.group_id)
        .subquery()
    )

    group_query = (
        select(
            groups.c.group_id,
            groups.c.cohort_id,
            groups.c.group_name,
            groups.c.status,
            first_meeting_subq.c.first_meeting_at,
            func.coalesce(member_count_subq.c.member_count, 0).label("member_count"),
        )
        .outerjoin(
            first_meeting_subq, groups.c.group_id == first_meeting_subq.c.group_id
        )
        .outerjoin(member_count_subq, groups.c.group_id == member_count_subq.c.group_id)
        .where(groups.c.group_id == group_id)
    )
    group_result = await conn.execute(group_query)
    target_group = group_result.mappings().first()

    if not target_group:
        return {"success": False, "error": "group_not_found"}

    # Check if group is full (8 is max capacity)
    if target_group["member_count"] >= 8:
        return {"success": False, "error": "group_full"}

    first_meeting_at = target_group.get("first_meeting_at")

    # Check if user is already in this group
    if current_group and current_group["group_id"] == group_id:
        return {"success": False, "error": "already_in_group"}

    # If user has no current group and group has started, reject
    now = datetime.now(timezone.utc)
    if not current_group and first_meeting_at and first_meeting_at < now:
        return {"success": False, "error": "group_already_started"}

    # === LEAVE OLD GROUP (if switching) ===
    previous_group_id = None
    if current_group:
        previous_group_id = current_group["group_id"]

        # Update database: mark old membership as removed
        await conn.execute(
            update(groups_users)
            .where(groups_users.c.group_user_id == current_group["group_user_id"])
            .values(
                status=GroupUserStatus.removed,
                left_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )

    # === JOIN NEW GROUP ===
    await add_user_to_group(conn, group_id, user_id, role)

    # TODO: Lifecycle operations (Discord, Calendar, Reminders) will be added
    # when the lifecycle module is implemented

    return {
        "success": True,
        "group_id": group_id,
        "previous_group_id": previous_group_id,
    }


async def get_user_group_info(
    conn: AsyncConnection,
    user_id: int,
) -> dict[str, Any]:
    """
    Get user's cohort and group information for the /group page.

    Returns:
        {
            "is_enrolled": bool,
            "cohort_id": int | None,
            "cohort_name": str | None,
            "current_group": {...} | None,
        }
    """
    from .tables import signups

    # Get user's most recent signup
    signup_query = (
        select(signups, cohorts)
        .join(cohorts, signups.c.cohort_id == cohorts.c.cohort_id)
        .where(signups.c.user_id == user_id)
        .order_by(cohorts.c.cohort_start_date.desc())
        .limit(1)
    )
    result = await conn.execute(signup_query)
    signup = result.mappings().first()

    if not signup:
        return {"is_enrolled": False}

    cohort_id = signup["cohort_id"]

    # Get current group if any
    current_group = await get_user_current_group(conn, user_id, cohort_id)

    return {
        "is_enrolled": True,
        "cohort_id": cohort_id,
        "cohort_name": signup["cohort_name"],
        "current_group": {
            "group_id": current_group["group_id"],
            "group_name": current_group["group_name"],
            "recurring_meeting_time_utc": current_group["recurring_meeting_time_utc"],
        }
        if current_group
        else None,
    }
