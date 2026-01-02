"""Cohort-related database queries using SQLAlchemy Core."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import cohorts, courses, courses_users


async def get_schedulable_cohorts(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get cohorts that have users awaiting grouping.

    Returns list of dicts with cohort_id, cohort_name, course_name, pending_users count.
    """
    # Subquery to count pending users per cohort
    pending_count = (
        select(
            courses_users.c.cohort_id,
            func.count().label("pending_users")
        )
        .where(courses_users.c.grouping_status == "awaiting_grouping")
        .group_by(courses_users.c.cohort_id)
        .subquery()
    )

    # Join cohorts with courses and pending counts
    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            courses.c.course_name,
            pending_count.c.pending_users,
        )
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .join(pending_count, cohorts.c.cohort_id == pending_count.c.cohort_id)
        .where(pending_count.c.pending_users > 0)
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    return [dict(row) for row in result.mappings()]


async def get_realizable_cohorts(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get cohorts that have groups without Discord channels.

    Returns cohorts where at least one group has NULL discord_text_channel_id.
    """
    from ..tables import groups

    # Subquery: cohorts with unrealized groups
    unrealized = (
        select(groups.c.cohort_id)
        .where(groups.c.discord_text_channel_id.is_(None))
        .distinct()
        .subquery()
    )

    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            courses.c.course_name,
            cohorts.c.number_of_group_meetings,
        )
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .join(unrealized, cohorts.c.cohort_id == unrealized.c.cohort_id)
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    return [dict(row) for row in result.mappings()]


async def get_cohort_by_id(
    conn: AsyncConnection,
    cohort_id: int,
) -> dict[str, Any] | None:
    """Get a cohort by ID with course name."""
    query = (
        select(cohorts, courses.c.course_name)
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .where(cohorts.c.cohort_id == cohort_id)
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    return dict(row) if row else None


async def save_cohort_category_id(
    conn: AsyncConnection,
    cohort_id: int,
    discord_category_id: str,
) -> None:
    """Update cohort with Discord category ID."""
    await conn.execute(
        update(cohorts)
        .where(cohorts.c.cohort_id == cohort_id)
        .values(
            discord_category_id=discord_category_id,
            updated_at=datetime.now(timezone.utc),
        )
    )
