"""
Test helper functions for creating test data.
"""

from datetime import date, timedelta

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.tables import cohorts, users, signups, groups
from core.enums import CohortRole


async def create_test_cohort(
    conn: AsyncConnection,
    course_slug: str = "default",
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
            course_slug=course_slug,
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
    availability: str = '{"Monday": ["09:00-09:30", "09:30-10:00"]}',
    role: str = "participant",
) -> dict:
    """
    Create a user with a signup for a cohort for testing.

    Args:
        conn: Database connection
        cohort_id: Cohort to sign up for
        discord_id: Discord ID (should be unique per test)
        availability: Availability JSON string (e.g., '{"Monday": ["09:00-09:30"]}')
        role: "participant" or "facilitator"

    Returns:
        The created user record as a dict
    """
    # Create user
    user_result = await conn.execute(
        insert(users)
        .values(
            discord_id=discord_id,
            discord_username=f"testuser_{discord_id}",
            availability_local=availability,
            timezone="UTC",
        )
        .returning(users)
    )
    user = dict(user_result.mappings().first())

    # Map string role to enum
    role_enum = (
        CohortRole.facilitator if role == "facilitator" else CohortRole.participant
    )

    # Create signup for cohort
    await conn.execute(
        insert(signups).values(
            user_id=user["user_id"],
            cohort_id=cohort_id,
            role=role_enum,
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
    status: str = None,
) -> dict:
    """Create a group for testing."""
    values = {
        "cohort_id": cohort_id,
        "group_name": group_name,
        "recurring_meeting_time_utc": meeting_time,
        "discord_text_channel_id": discord_text_channel_id,
        "discord_voice_channel_id": discord_voice_channel_id,
    }
    if status:
        values["status"] = status
    result = await conn.execute(insert(groups).values(**values).returning(groups))
    return dict(result.mappings().first())
