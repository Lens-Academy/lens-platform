"""
Test helper functions for creating test data.
"""

from datetime import date, timedelta

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.tables import courses, cohorts, users, courses_users, groups, groups_users
from core.enums import CohortRole, GroupingStatus, GroupUserRole, GroupUserStatus


async def create_test_course(
    conn: AsyncConnection,
    name: str = "Test Course",
) -> dict:
    """Create a course for testing."""
    result = await conn.execute(
        insert(courses)
        .values(course_name=name)
        .returning(courses)
    )
    return dict(result.mappings().first())


async def create_test_cohort(
    conn: AsyncConnection,
    course_id: int,
    name: str = "Test Cohort",
    num_meetings: int = 8,
    start_date: date = None,
) -> dict:
    """Create a cohort for testing."""
    if start_date is None:
        start_date = date.today() + timedelta(days=7)

    result = await conn.execute(
        insert(cohorts)
        .values(
            cohort_name=name,
            course_id=course_id,
            cohort_start_date=start_date,
            duration_days=56,
            number_of_group_meetings=num_meetings,
        )
        .returning(cohorts)
    )
    return dict(result.mappings().first())


async def create_test_user(
    conn: AsyncConnection,
    cohort_id: int,
    discord_id: str,
    availability: str = "M09:00 M10:00",
    cohort_role: str = "participant",
    course_id: int = None,
) -> dict:
    """
    Create a user enrolled in a cohort for testing.

    Args:
        conn: Database connection
        cohort_id: Cohort to enroll user in
        discord_id: Discord ID (should be unique per test)
        availability: Availability string in day-time format
        cohort_role: "participant" or "facilitator"
        course_id: Course ID (required for courses_users, will be fetched from cohort if not provided)

    Returns:
        The created user record as a dict
    """
    from sqlalchemy import select

    # Create user
    user_result = await conn.execute(
        insert(users)
        .values(
            discord_id=discord_id,
            discord_username=f"testuser_{discord_id}",
            availability_utc=availability,
            timezone="UTC",
        )
        .returning(users)
    )
    user = dict(user_result.mappings().first())

    # Get course_id from cohort if not provided
    if course_id is None:
        cohort_result = await conn.execute(
            select(cohorts.c.course_id).where(cohorts.c.cohort_id == cohort_id)
        )
        course_id = cohort_result.scalar_one()

    # Map string role to enum
    role_enum = CohortRole.facilitator if cohort_role == "facilitator" else CohortRole.participant

    # Enroll in cohort (courses_users requires course_id)
    await conn.execute(
        insert(courses_users)
        .values(
            user_id=user["user_id"],
            course_id=course_id,
            cohort_id=cohort_id,
            grouping_status=GroupingStatus.awaiting_grouping,
            cohort_role=role_enum,
        )
    )

    return user


async def create_test_group(
    conn: AsyncConnection,
    cohort_id: int,
    group_name: str = "Test Group",
    meeting_time: str = "Monday 09:00-10:00",
    discord_text_channel_id: str = None,
    discord_voice_channel_id: str = None,
) -> dict:
    """Create a group for testing."""
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name=group_name,
            recurring_meeting_time_utc=meeting_time,
            discord_text_channel_id=discord_text_channel_id,
            discord_voice_channel_id=discord_voice_channel_id,
        )
        .returning(groups)
    )
    return dict(result.mappings().first())
