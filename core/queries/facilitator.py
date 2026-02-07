"""Queries for facilitator panel access control and data."""

from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import (
    groups,
    groups_users,
    users,
    cohorts,
    user_content_progress,
    chat_sessions,
)


async def is_admin(conn: AsyncConnection, user_id: int) -> bool:
    """Check if user has admin role."""
    result = await conn.execute(
        select(users.c.is_admin).where(users.c.user_id == user_id)
    )
    row = result.first()
    return row is not None and row.is_admin is True


async def get_facilitator_group_ids(conn: AsyncConnection, user_id: int) -> list[int]:
    """Get group IDs where user is a facilitator."""
    result = await conn.execute(
        select(groups_users.c.group_id).where(
            (groups_users.c.user_id == user_id)
            & (groups_users.c.role == "facilitator")
            & (groups_users.c.status == "active")
        )
    )
    return [row.group_id for row in result]


async def get_accessible_groups(
    conn: AsyncConnection, user_id: int
) -> list[dict[str, Any]]:
    """
    Get groups accessible to this user.

    Admins see all groups, facilitators see only their groups.
    """
    admin = await is_admin(conn, user_id)

    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.status,
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
        )
        .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        .where(groups.c.status.in_(["preview", "active", "completed"]))
        .order_by(cohorts.c.cohort_start_date.desc(), groups.c.group_name)
    )

    if not admin:
        # Facilitators only see their groups
        group_ids = await get_facilitator_group_ids(conn, user_id)
        if not group_ids:
            return []
        query = query.where(groups.c.group_id.in_(group_ids))

    result = await conn.execute(query)
    return [dict(row) for row in result.mappings()]


async def can_access_group(conn: AsyncConnection, user_id: int, group_id: int) -> bool:
    """Check if user can access a specific group."""
    if await is_admin(conn, user_id):
        return True

    group_ids = await get_facilitator_group_ids(conn, user_id)
    return group_id in group_ids


async def get_group_members_with_progress(
    conn: AsyncConnection, group_id: int
) -> list[dict[str, Any]]:
    """Get group members (participants) with aggregated progress stats."""
    name_col = func.coalesce(users.c.nickname, users.c.discord_username).label("name")

    query = (
        select(
            groups_users.c.user_id,
            name_col,
            func.count(user_content_progress.c.completed_at).label(
                "sections_completed"
            ),
            func.coalesce(
                func.sum(user_content_progress.c.total_time_spent_s), 0
            ).label("total_time_seconds"),
            func.max(user_content_progress.c.started_at).label("last_active_at"),
        )
        .join(users, groups_users.c.user_id == users.c.user_id)
        .outerjoin(
            user_content_progress,
            groups_users.c.user_id == user_content_progress.c.user_id,
        )
        .where(
            (groups_users.c.group_id == group_id)
            & (groups_users.c.role == "participant")
            & (groups_users.c.status == "active")
        )
        .group_by(groups_users.c.user_id, users.c.nickname, users.c.discord_username)
        .order_by(name_col)
    )

    result = await conn.execute(query)
    rows = []
    for row in result.mappings():
        r = dict(row)
        # Serialize datetime for JSON
        if r["last_active_at"] is not None:
            r["last_active_at"] = r["last_active_at"].isoformat()
        rows.append(r)
    return rows


async def get_user_all_progress(
    conn: AsyncConnection, user_id: int
) -> list[dict[str, Any]]:
    """Get all progress rows for a user."""
    result = await conn.execute(
        select(user_content_progress).where(user_content_progress.c.user_id == user_id)
    )
    return [dict(row) for row in result.mappings()]


async def get_user_chat_sessions_for_facilitator(
    conn: AsyncConnection, user_id: int
) -> list[dict[str, Any]]:
    """Get all chat sessions for a user, ordered by most recent first."""
    result = await conn.execute(
        select(chat_sessions)
        .where(chat_sessions.c.user_id == user_id)
        .order_by(chat_sessions.c.started_at.desc())
    )
    return [dict(row) for row in result.mappings()]


async def is_user_in_group(conn: AsyncConnection, user_id: int, group_id: int) -> bool:
    """Check if a user is an active member of a group."""
    result = await conn.execute(
        select(groups_users.c.group_user_id).where(
            (groups_users.c.user_id == user_id)
            & (groups_users.c.group_id == group_id)
            & (groups_users.c.status == "active")
        )
    )
    return result.first() is not None
