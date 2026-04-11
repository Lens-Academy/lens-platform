"""Cohort-related database queries using SQLAlchemy Core."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..enums import GroupStatus
from ..modules.course_loader import load_course
from ..tables import cohorts, signups


async def get_schedulable_cohorts(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get cohorts that have users awaiting grouping.

    Returns list of dicts with cohort_id, cohort_name, course_name, pending_users count.
    """
    # Subquery to count pending users per cohort
    # (row exists in signups = awaiting grouping, ungroupable_reason is NULL = not yet processed)
    pending_count = (
        select(signups.c.cohort_id, func.count().label("pending_users"))
        .where(signups.c.ungroupable_reason.is_(None))
        .group_by(signups.c.cohort_id)
        .subquery()
    )

    # Join cohorts with pending counts
    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.course_slug,
            pending_count.c.pending_users,
        )
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
    Get cohorts that have groups in preview status (not yet realized).

    Returns cohorts where at least one group has status='preview'.
    Each cohort includes course_name loaded from YAML.
    """
    from ..tables import groups

    # Subquery: cohorts with unrealized groups
    unrealized = (
        select(groups.c.cohort_id)
        .where(groups.c.status == GroupStatus.preview)
        .distinct()
        .subquery()
    )

    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.course_slug,
            cohorts.c.number_of_group_meetings,
        )
        .join(unrealized, cohorts.c.cohort_id == unrealized.c.cohort_id)
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    cohort_list = []
    for row in result.mappings():
        cohort = dict(row)
        course = load_course(cohort["course_slug"])
        cohort["course_name"] = course.title
        cohort_list.append(cohort)
    return cohort_list


async def get_cohort_by_id(
    conn: AsyncConnection,
    cohort_id: int,
) -> dict[str, Any] | None:
    """Get a cohort by ID."""
    query = select(cohorts).where(cohorts.c.cohort_id == cohort_id)
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


async def get_all_cohorts_summary(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get all cohorts with course names for admin panel.

    Returns list of dicts with cohort_id, cohort_name, course_slug, status, course_name.
    Ordered by cohort_start_date descending (most recent first).
    """
    query = select(
        cohorts.c.cohort_id,
        cohorts.c.cohort_name,
        cohorts.c.course_slug,
        cohorts.c.status,
    ).order_by(cohorts.c.cohort_start_date.desc())

    result = await conn.execute(query)
    cohort_list = []
    for row in result.mappings():
        cohort = dict(row)
        try:
            course = load_course(cohort["course_slug"])
            cohort["course_name"] = course.title
        except Exception:
            cohort["course_name"] = cohort["course_slug"]
        cohort_list.append(cohort)

    return cohort_list


async def get_available_cohorts(
    conn: AsyncConnection,
    user_id: int | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """
    Get cohorts available for enrollment, separated into enrolled and available.

    Includes cohorts that started up to 7 days ago (late enrollment allowed).
    Includes has_groups flag for each cohort (True if cohort has any groups).
    Maps course_slug to course_name using load_course().
    """
    from datetime import date, timedelta

    from ..tables import groups

    today = date.today()

    # Subquery to check if cohort has groups
    has_groups_subq = (
        select(
            groups.c.cohort_id,
            func.count().label("group_count"),
        )
        .group_by(groups.c.cohort_id)
        .subquery()
    )

    # Get all future active cohorts with has_groups
    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
            cohorts.c.course_slug,
            cohorts.c.duration_days,
            func.coalesce(has_groups_subq.c.group_count, 0).label("group_count"),
        )
        .outerjoin(has_groups_subq, cohorts.c.cohort_id == has_groups_subq.c.cohort_id)
        .where(cohorts.c.cohort_start_date + timedelta(days=7) > today)
        .where(cohorts.c.status == "active")
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    all_cohorts = []
    for row in result.mappings():
        cohort = dict(row)
        cohort["has_groups"] = cohort.pop("group_count") > 0
        # Map course_slug to course_name for frontend compatibility
        course = load_course(cohort["course_slug"])
        cohort["course_name"] = course.title
        all_cohorts.append(cohort)

    if not user_id:
        return {"enrolled": [], "available": all_cohorts}

    # Get user's signups
    enrollment_query = select(
        signups.c.cohort_id,
        signups.c.role,
    ).where(signups.c.user_id == user_id)
    enrollment_result = await conn.execute(enrollment_query)
    enrollments = {
        row["cohort_id"]: row["role"] for row in enrollment_result.mappings()
    }

    enrolled = []
    available = []

    for cohort in all_cohorts:
        if cohort["cohort_id"] in enrollments:
            cohort["role"] = enrollments[cohort["cohort_id"]].value
            enrolled.append(cohort)
        else:
            available.append(cohort)

    return {"enrolled": enrolled, "available": available}
