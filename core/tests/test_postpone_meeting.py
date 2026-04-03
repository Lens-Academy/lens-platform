"""Tests for the postpone_meeting orchestrator.

Mocks get_transaction to reuse the rollback db_conn fixture,
and mocks external side effects (reminders, calendar).
"""

import pytest
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from sqlalchemy import insert

from core.tables import users, cohorts, groups, meetings
from core.meetings import postpone_meeting
from core.queries.meetings import get_meetings_for_group


# ============================================================================
# Test Data Helpers
# ============================================================================

BASE_TIME = datetime(2026, 3, 1, 18, 0, tzinfo=timezone.utc)


async def create_test_user(conn, discord_id: str) -> dict:
    result = await conn.execute(
        insert(users)
        .values(discord_id=discord_id, discord_username=f"user_{discord_id}")
        .returning(users)
    )
    return dict(result.mappings().first())


async def create_test_cohort(conn) -> dict:
    from datetime import date

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


async def create_test_group(
    conn, cohort_id: int, gcal_event_id: str | None = None
) -> dict:
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name="Test Group",
            status="active",
            gcal_recurring_event_id=gcal_event_id,
        )
        .returning(groups)
    )
    return dict(result.mappings().first())


async def create_test_meeting(
    conn, group_id: int, cohort_id: int, meeting_number: int, scheduled_at: datetime
) -> dict:
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


async def setup_group_with_meetings(conn, num=5, gcal_event_id=None):
    """Create cohort, group, and N weekly meetings."""
    cohort = await create_test_cohort(conn)
    group = await create_test_group(conn, cohort["cohort_id"], gcal_event_id)
    mtgs = []
    for i in range(1, num + 1):
        mtg = await create_test_meeting(
            conn,
            group["group_id"],
            cohort["cohort_id"],
            meeting_number=i,
            scheduled_at=BASE_TIME + timedelta(weeks=i - 1),
        )
        mtgs.append(mtg)
    return cohort, group, mtgs


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_transaction(db_conn):
    """Mock get_transaction to yield the rollback db_conn."""

    @asynccontextmanager
    async def _fake_transaction():
        yield db_conn

    with patch("core.meetings.get_transaction", _fake_transaction):
        yield


@pytest.fixture
def mock_reminders():
    """Mock cancel/schedule meeting reminders."""
    with (
        patch("core.meetings.cancel_meeting_reminders") as mock_cancel,
        patch("core.meetings.schedule_meeting_reminders") as mock_schedule,
    ):
        yield mock_cancel, mock_schedule


@pytest.fixture
def mock_calendar():
    """Mock postpone_meeting_in_recurring_event."""
    with patch(
        "core.meetings.postpone_meeting_in_recurring_event"
    ) as mock_postpone_cal:
        mock_postpone_cal.return_value = True
        yield mock_postpone_cal


@pytest.fixture
def mock_zoom():
    """Mock Zoom API calls used by postpone_meeting."""
    with (
        patch("core.zoom.hosts.find_available_host", return_value=None) as mock_find_host,
        patch("core.zoom.meetings.delete_meeting") as mock_delete,
        patch("core.zoom.meetings.create_meeting") as mock_create,
    ):
        yield mock_find_host, mock_delete, mock_create


# ============================================================================
# Tests
# ============================================================================


class TestPostponeMeeting:
    """Tests for postpone_meeting orchestrator."""

    @pytest.mark.asyncio
    async def test_happy_path(
        self, db_conn, mock_transaction, mock_reminders, mock_calendar, mock_zoom
    ):
        """Postpone meeting 3 of 5: delete 3, shift 4→3 5→4, add new meeting 5."""
        _, group, mtgs = await setup_group_with_meetings(db_conn)
        meeting_3_id = mtgs[2]["meeting_id"]
        old_meeting_5_time = mtgs[4]["scheduled_at"]

        result = await postpone_meeting(meeting_3_id)

        # Check return value
        assert result["deleted_meeting_number"] == 3
        assert result["new_meeting_number"] == 5
        expected_new_time = old_meeting_5_time + timedelta(weeks=1)
        assert result["new_meeting_time"] == expected_new_time.isoformat()

        # Verify DB state: still 5 meetings, numbered 1-5
        remaining = await get_meetings_for_group(db_conn, group["group_id"])
        numbers = [m["meeting_number"] for m in remaining]
        assert numbers == [1, 2, 3, 4, 5]

        # Meetings 1, 2 unchanged
        assert remaining[0]["meeting_id"] == mtgs[0]["meeting_id"]
        assert remaining[1]["meeting_id"] == mtgs[1]["meeting_id"]
        # Old meeting 4 is now meeting 3
        assert remaining[2]["meeting_id"] == mtgs[3]["meeting_id"]
        # Old meeting 5 is now meeting 4
        assert remaining[3]["meeting_id"] == mtgs[4]["meeting_id"]
        # New meeting 5
        assert remaining[4]["meeting_id"] == result["new_meeting_id"]
        assert remaining[4]["scheduled_at"] == expected_new_time

    @pytest.mark.asyncio
    async def test_meeting_not_found_raises(
        self, db_conn, mock_transaction, mock_reminders, mock_calendar, mock_zoom
    ):
        with pytest.raises(ValueError, match="Meeting not found"):
            await postpone_meeting(999999)

    @pytest.mark.asyncio
    async def test_cancels_old_and_schedules_new_reminders(
        self, db_conn, mock_transaction, mock_reminders, mock_calendar, mock_zoom
    ):
        mock_cancel, mock_schedule = mock_reminders
        _, _, mtgs = await setup_group_with_meetings(db_conn)
        meeting_3_id = mtgs[2]["meeting_id"]

        result = await postpone_meeting(meeting_3_id)

        mock_cancel.assert_called_once_with(meeting_3_id)
        mock_schedule.assert_called_once_with(
            meeting_id=result["new_meeting_id"],
            meeting_time=datetime.fromisoformat(result["new_meeting_time"]),
        )

    @pytest.mark.asyncio
    async def test_calls_calendar_when_gcal_event_exists(
        self, db_conn, mock_transaction, mock_reminders, mock_calendar, mock_zoom
    ):
        _, group, mtgs = await setup_group_with_meetings(
            db_conn, gcal_event_id="recurring_abc123"
        )
        meeting_3_id = mtgs[2]["meeting_id"]
        meeting_3_time = mtgs[2]["scheduled_at"]

        await postpone_meeting(meeting_3_id)

        mock_calendar.assert_called_once_with(
            recurring_event_id="recurring_abc123",
            instance_start=meeting_3_time,
        )

    @pytest.mark.asyncio
    async def test_skips_calendar_when_no_gcal_event(
        self, db_conn, mock_transaction, mock_reminders, mock_calendar, mock_zoom
    ):
        _, _, mtgs = await setup_group_with_meetings(db_conn, gcal_event_id=None)

        await postpone_meeting(mtgs[2]["meeting_id"])

        mock_calendar.assert_not_called()

    @pytest.mark.asyncio
    async def test_postpone_first_meeting(
        self, db_conn, mock_transaction, mock_reminders, mock_calendar, mock_zoom
    ):
        """Postpone meeting 1 of 5: all others shift down, new meeting 5 added."""
        _, group, mtgs = await setup_group_with_meetings(db_conn)
        old_meeting_5_time = mtgs[4]["scheduled_at"]

        result = await postpone_meeting(mtgs[0]["meeting_id"])

        assert result["deleted_meeting_number"] == 1
        assert result["new_meeting_number"] == 5

        remaining = await get_meetings_for_group(db_conn, group["group_id"])
        numbers = [m["meeting_number"] for m in remaining]
        assert numbers == [1, 2, 3, 4, 5]

        # Old meetings 2-5 shifted to 1-4
        assert remaining[0]["meeting_id"] == mtgs[1]["meeting_id"]
        assert remaining[1]["meeting_id"] == mtgs[2]["meeting_id"]
        assert remaining[2]["meeting_id"] == mtgs[3]["meeting_id"]
        assert remaining[3]["meeting_id"] == mtgs[4]["meeting_id"]
        # New meeting 5
        assert remaining[4]["meeting_id"] == result["new_meeting_id"]
        assert remaining[4]["scheduled_at"] == old_meeting_5_time + timedelta(weeks=1)

    @pytest.mark.asyncio
    async def test_postpone_last_meeting(
        self, db_conn, mock_transaction, mock_reminders, mock_calendar, mock_zoom
    ):
        """Postpone meeting 5 of 5: no renumbering, new meeting 5 at +1 week."""
        _, group, mtgs = await setup_group_with_meetings(db_conn)
        old_meeting_5_time = mtgs[4]["scheduled_at"]

        result = await postpone_meeting(mtgs[4]["meeting_id"])

        assert result["deleted_meeting_number"] == 5
        assert result["new_meeting_number"] == 5

        remaining = await get_meetings_for_group(db_conn, group["group_id"])
        numbers = [m["meeting_number"] for m in remaining]
        assert numbers == [1, 2, 3, 4, 5]

        # Meetings 1-4 unchanged
        for i in range(4):
            assert remaining[i]["meeting_id"] == mtgs[i]["meeting_id"]

        # New meeting 5 replaces old one, scheduled 1 week later
        assert remaining[4]["meeting_id"] == result["new_meeting_id"]
        assert remaining[4]["scheduled_at"] == old_meeting_5_time + timedelta(weeks=1)
