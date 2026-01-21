"""Queries for facilitator panel access control."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import groups, groups_users, users, cohorts


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
