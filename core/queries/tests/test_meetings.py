"""Tests for meeting database queries.

Uses real database with rollback fixture (integration tests).
"""

import pytest
from datetime import datetime, timezone, timedelta

from sqlalchemy import insert, select

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.tables import users, cohorts, groups, meetings, attendances
from core.queries.meetings import (
    delete_meeting,
    renumber_meetings_after_delete,
    get_last_meeting_for_group,
    get_group_for_meeting,
)


# ============================================================================
# Test Data Helpers
# ============================================================================


async def create_test_user(conn, discord_id: str) -> dict:
    """Create a test user and return the row."""
    result = await conn.execute(
        insert(users)
        .values(
            discord_id=discord_id,
            discord_username=f"user_{discord_id}",
        )
        .returning(users)
    )
    return dict(result.mappings().first())


async def create_test_cohort(conn, name: str = "Test Cohort") -> dict:
    """Create a test cohort and return the row."""
    from datetime import date

    result = await conn.execute(
        insert(cohorts)
        .values(
            cohort_name=name,
            course_slug="test-course",
            cohort_start_date=date.today() + timedelta(days=30),
            duration_days=56,
            number_of_group_meetings=8,
        )
        .returning(cohorts)
    )
    return dict(result.mappings().first())


async def create_test_group(conn, cohort_id: int, name: str = "Test Group") -> dict:
    """Create a test group and return the row."""
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name=name,
            status="active",
        )
        .returning(groups)
    )
    return dict(result.mappings().first())


async def create_test_meeting(
    conn, group_id: int, cohort_id: int, meeting_number: int, scheduled_at: datetime
) -> dict:
    """Create a test meeting and return the row."""
    result = await conn.execute(
        insert(meetings)
        .values(
            group_id=group_id,
            cohort_id=cohort_id,
            meeting_number=meeting_number,
            scheduled_at=scheduled_at,
        )
        .returning(meetings)
    )
    return dict(result.mappings().first())


async def create_test_attendance(conn, meeting_id: int, user_id: int) -> dict:
    """Create a test attendance record and return the row."""
    result = await conn.execute(
        insert(attendances)
        .values(
            meeting_id=meeting_id,
            user_id=user_id,
        )
        .returning(attendances)
    )
    return dict(result.mappings().first())


# ============================================================================
# Setup helper: create a group with N meetings
# ============================================================================

BASE_TIME = datetime(2026, 3, 1, 18, 0, tzinfo=timezone.utc)


async def setup_group_with_meetings(conn, num_meetings: int = 5):
    """Create a cohort, group, and N weekly meetings. Returns (cohort, group, meetings_list)."""
    cohort = await create_test_cohort(conn)
    group = await create_test_group(conn, cohort["cohort_id"])
    mtgs = []
    for i in range(1, num_meetings + 1):
        mtg = await create_test_meeting(
            conn,
            group_id=group["group_id"],
            cohort_id=cohort["cohort_id"],
            meeting_number=i,
            scheduled_at=BASE_TIME + timedelta(weeks=i - 1),
        )
        mtgs.append(mtg)
    return cohort, group, mtgs


# ============================================================================
# Tests
# ============================================================================


class TestDeleteMeeting:
    """Tests for delete_meeting query."""

    @pytest.mark.asyncio
    async def test_deletes_meeting_row(self, db_conn):
        _, group, mtgs = await setup_group_with_meetings(db_conn)

        await delete_meeting(db_conn, mtgs[2]["meeting_id"])

        result = await db_conn.execute(
            select(meetings).where(meetings.c.meeting_id == mtgs[2]["meeting_id"])
        )
        assert result.first() is None

    @pytest.mark.asyncio
    async def test_cascades_to_attendance_records(self, db_conn):
        user = await create_test_user(db_conn, "cascade_test_user")
        _, group, mtgs = await setup_group_with_meetings(db_conn)
        meeting_id = mtgs[0]["meeting_id"]

        # Create attendance for this meeting
        att = await create_test_attendance(db_conn, meeting_id, user["user_id"])

        # Delete the meeting
        await delete_meeting(db_conn, meeting_id)

        # Attendance should be gone (CASCADE)
        result = await db_conn.execute(
            select(attendances).where(
                attendances.c.attendance_id == att["attendance_id"]
            )
        )
        assert result.first() is None


class TestRenumberMeetingsAfterDelete:
    """Tests for renumber_meetings_after_delete query."""

    @pytest.mark.asyncio
    async def test_decrements_meetings_after_deleted_number(self, db_conn):
        _, group, mtgs = await setup_group_with_meetings(db_conn, 5)
        group_id = group["group_id"]

        # Delete meeting 3, then renumber
        await delete_meeting(db_conn, mtgs[2]["meeting_id"])
        await renumber_meetings_after_delete(db_conn, group_id, deleted_meeting_number=3)

        # Meetings 4 and 5 should now be 3 and 4
        result = await db_conn.execute(
            select(meetings.c.meeting_id, meetings.c.meeting_number)
            .where(meetings.c.group_id == group_id)
            .order_by(meetings.c.meeting_number)
        )
        rows = [(r.meeting_id, r.meeting_number) for r in result]

        assert rows == [
            (mtgs[0]["meeting_id"], 1),
            (mtgs[1]["meeting_id"], 2),
            (mtgs[3]["meeting_id"], 3),  # was 4
            (mtgs[4]["meeting_id"], 4),  # was 5
        ]

    @pytest.mark.asyncio
    async def test_meetings_before_deleted_unchanged(self, db_conn):
        _, group, mtgs = await setup_group_with_meetings(db_conn, 5)
        group_id = group["group_id"]

        await delete_meeting(db_conn, mtgs[3]["meeting_id"])  # delete meeting 4
        await renumber_meetings_after_delete(db_conn, group_id, deleted_meeting_number=4)

        # Meetings 1-3 should be unchanged
        for i in range(3):
            result = await db_conn.execute(
                select(meetings.c.meeting_number).where(
                    meetings.c.meeting_id == mtgs[i]["meeting_id"]
                )
            )
            assert result.scalar_one() == i + 1

    @pytest.mark.asyncio
    async def test_does_not_touch_meeting_at_deleted_number(self, db_conn):
        """Renumber should only affect meetings AFTER the deleted number, not AT it.

        Tests the query in isolation (without deleting first) to verify
        the boundary condition (> vs >=).
        """
        _, group, mtgs = await setup_group_with_meetings(db_conn, 5)
        group_id = group["group_id"]

        # Call renumber WITHOUT deleting meeting 3 first
        await renumber_meetings_after_delete(db_conn, group_id, deleted_meeting_number=3)

        # Meeting 3 itself should NOT have been decremented
        result = await db_conn.execute(
            select(meetings.c.meeting_number).where(
                meetings.c.meeting_id == mtgs[2]["meeting_id"]
            )
        )
        assert result.scalar_one() == 3

        # Meetings 4 and 5 should be decremented
        result = await db_conn.execute(
            select(meetings.c.meeting_number).where(
                meetings.c.meeting_id == mtgs[3]["meeting_id"]
            )
        )
        assert result.scalar_one() == 3  # was 4

        result = await db_conn.execute(
            select(meetings.c.meeting_number).where(
                meetings.c.meeting_id == mtgs[4]["meeting_id"]
            )
        )
        assert result.scalar_one() == 4  # was 5


class TestGetLastMeetingForGroup:
    """Tests for get_last_meeting_for_group query."""

    @pytest.mark.asyncio
    async def test_returns_highest_meeting_number(self, db_conn):
        _, group, mtgs = await setup_group_with_meetings(db_conn, 5)

        result = await get_last_meeting_for_group(db_conn, group["group_id"])

        assert result is not None
        assert result["meeting_id"] == mtgs[4]["meeting_id"]
        assert result["meeting_number"] == 5

    @pytest.mark.asyncio
    async def test_returns_none_for_group_with_no_meetings(self, db_conn):
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(conn=db_conn, cohort_id=cohort["cohort_id"])

        result = await get_last_meeting_for_group(db_conn, group["group_id"])

        assert result is None


class TestGetGroupForMeeting:
    """Tests for get_group_for_meeting query."""

    @pytest.mark.asyncio
    async def test_returns_correct_group(self, db_conn):
        _, group, mtgs = await setup_group_with_meetings(db_conn)

        result = await get_group_for_meeting(db_conn, mtgs[0]["meeting_id"])

        assert result is not None
        assert result["group_id"] == group["group_id"]
        assert result["group_name"] == "Test Group"

    @pytest.mark.asyncio
    async def test_returns_none_for_nonexistent_meeting(self, db_conn):
        result = await get_group_for_meeting(db_conn, 999999)

        assert result is None
