"""Tests for get_meeting_dates_for_user query.

Uses real database with rollback fixture (unit+1 integration tests).
"""

import pytest
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import insert

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from core.tables import users, cohorts, groups, groups_users, meetings
from core.queries.meetings import get_meeting_dates_for_user


# ============================================================================
# Test Data Helpers
# ============================================================================


async def create_test_user(conn, discord_id: str) -> dict:
    result = await conn.execute(
        insert(users)
        .values(discord_id=discord_id, discord_username=f"user_{discord_id}")
        .returning(users)
    )
    return dict(result.mappings().first())


async def create_test_cohort(conn) -> dict:
    result = await conn.execute(
        insert(cohorts)
        .values(
            cohort_name="Test Cohort",
            course_slug="test-course",
            cohort_start_date=date.today() + timedelta(days=30),
            duration_days=56,
            number_of_group_meetings=8,
        )
        .returning(cohorts)
    )
    return dict(result.mappings().first())


async def create_test_group(conn, cohort_id: int) -> dict:
    result = await conn.execute(
        insert(groups)
        .values(cohort_id=cohort_id, group_name="Test Group", status="active")
        .returning(groups)
    )
    return dict(result.mappings().first())


async def add_user_to_group(conn, user_id: int, group_id: int) -> None:
    await conn.execute(
        insert(groups_users).values(
            user_id=user_id, group_id=group_id, role="participant", status="active"
        )
    )


async def create_meeting(
    conn, group_id: int, cohort_id: int, meeting_number: int, scheduled_at: datetime
) -> None:
    await conn.execute(
        insert(meetings).values(
            group_id=group_id,
            cohort_id=cohort_id,
            meeting_number=meeting_number,
            scheduled_at=scheduled_at,
        )
    )


# ============================================================================
# Tests
# ============================================================================


class TestGetMeetingDatesForUser:
    @pytest.mark.asyncio
    async def test_returns_meeting_dates_for_active_group(self, db_conn):
        """User with active group + meetings → correct {number: iso_date} mapping."""
        user = await create_test_user(db_conn, "meeting_dates_1")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        await add_user_to_group(db_conn, user["user_id"], group["group_id"])

        t1 = datetime(2026, 3, 6, 15, 0, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 3, 13, 15, 0, 0, tzinfo=timezone.utc)
        await create_meeting(db_conn, group["group_id"], cohort["cohort_id"], 1, t1)
        await create_meeting(db_conn, group["group_id"], cohort["cohort_id"], 2, t2)

        result = await get_meeting_dates_for_user(db_conn, user["user_id"])

        assert result == {1: t1.isoformat(), 2: t2.isoformat()}

    @pytest.mark.asyncio
    async def test_returns_empty_for_no_active_group(self, db_conn):
        """User with no active group → empty dict."""
        user = await create_test_user(db_conn, "meeting_dates_2")

        result = await get_meeting_dates_for_user(db_conn, user["user_id"])

        assert result == {}

    @pytest.mark.asyncio
    async def test_returns_empty_for_group_without_meetings(self, db_conn):
        """User with active group but no meetings → empty dict."""
        user = await create_test_user(db_conn, "meeting_dates_3")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        await add_user_to_group(db_conn, user["user_id"], group["group_id"])

        result = await get_meeting_dates_for_user(db_conn, user["user_id"])

        assert result == {}
