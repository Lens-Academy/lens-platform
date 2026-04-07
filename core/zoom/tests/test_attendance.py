"""Tests for Zoom attendance sync — real DB, mocked Zoom API."""

import pytest
from datetime import datetime, timezone, timedelta

from sqlalchemy import insert, select
from unittest.mock import AsyncMock, patch

from core.tables import users, cohorts, groups, meetings, attendances
from core.enums import RSVPStatus
from core.zoom.attendance import sync_meeting_attendance, sync_zoom_attendance


# ============================================================================
# Test Data Helpers
# ============================================================================

BASE_TIME = datetime(2026, 4, 7, 18, 0, tzinfo=timezone.utc)


async def create_test_user(conn, discord_id: str, email: str) -> dict:
    """Create a test user with an email."""
    result = await conn.execute(
        insert(users)
        .values(
            discord_id=discord_id,
            discord_username=f"user_{discord_id}",
            email=email,
        )
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


async def create_test_group(conn, cohort_id: int) -> dict:
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name="Test Group",
            status="active",
        )
        .returning(groups)
    )
    return dict(result.mappings().first())


async def create_test_meeting(
    conn,
    group_id: int,
    cohort_id: int,
    meeting_number: int,
    scheduled_at: datetime,
    zoom_meeting_id: int | None = None,
) -> dict:
    result = await conn.execute(
        insert(meetings)
        .values(
            group_id=group_id,
            cohort_id=cohort_id,
            meeting_number=meeting_number,
            scheduled_at=scheduled_at,
            zoom_meeting_id=zoom_meeting_id,
        )
        .returning(meetings)
    )
    return dict(result.mappings().first())


def _zoom_participant(email: str, join_time: str = "2026-04-07T18:02:00Z") -> dict:
    """Build a Zoom participant response dict."""
    return {
        "id": "abc123",
        "name": "Test User",
        "user_email": email,
        "join_time": join_time,
        "leave_time": "2026-04-07T19:00:00Z",
        "duration": 3480,
        "status": "in_meeting",
    }


# ============================================================================
# sync_meeting_attendance tests
# ============================================================================


class TestSyncMeetingAttendance:
    @pytest.mark.asyncio
    async def test_sets_checked_in_at_for_matching_users(self, db_conn):
        """Participants matching users by email get checked_in_at set."""
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        meeting = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            1,
            BASE_TIME,
            zoom_meeting_id=111,
        )
        user = await create_test_user(db_conn, "100", "alice@example.com")

        zoom_participants = [_zoom_participant("alice@example.com")]

        with (
            patch(
                "core.zoom.attendance.get_meeting_participants",
                new_callable=AsyncMock,
                return_value=zoom_participants,
            ),
            patch(
                "core.zoom.attendance.get_transaction",
                return_value=_FakeTransaction(db_conn),
            ),
        ):
            result = await sync_meeting_attendance(meeting["meeting_id"], 111)

        assert result["checked_in"] >= 1

        # Verify DB state
        row = await db_conn.execute(
            select(attendances.c.checked_in_at).where(
                (attendances.c.meeting_id == meeting["meeting_id"])
                & (attendances.c.user_id == user["user_id"])
            )
        )
        att = row.first()
        assert att is not None
        assert att.checked_in_at is not None

    @pytest.mark.asyncio
    async def test_preserves_existing_rsvp_data(self, db_conn):
        """Syncing attendance doesn't overwrite rsvp_status or rsvp_at."""
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        meeting = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            1,
            BASE_TIME,
            zoom_meeting_id=222,
        )
        user = await create_test_user(db_conn, "200", "bob@example.com")

        # Pre-create attendance with RSVP data
        rsvp_time = datetime(2026, 4, 6, 12, 0, tzinfo=timezone.utc)
        await db_conn.execute(
            insert(attendances).values(
                meeting_id=meeting["meeting_id"],
                user_id=user["user_id"],
                rsvp_status=RSVPStatus.attending,
                rsvp_at=rsvp_time,
            )
        )

        with (
            patch(
                "core.zoom.attendance.get_meeting_participants",
                new_callable=AsyncMock,
                return_value=[_zoom_participant("bob@example.com")],
            ),
            patch(
                "core.zoom.attendance.get_transaction",
                return_value=_FakeTransaction(db_conn),
            ),
        ):
            await sync_meeting_attendance(meeting["meeting_id"], 222)

        row = (
            await db_conn.execute(
                select(
                    attendances.c.rsvp_status,
                    attendances.c.rsvp_at,
                    attendances.c.checked_in_at,
                ).where(
                    (attendances.c.meeting_id == meeting["meeting_id"])
                    & (attendances.c.user_id == user["user_id"])
                )
            )
        ).first()

        assert row.rsvp_status == RSVPStatus.attending
        assert row.rsvp_at == rsvp_time
        assert row.checked_in_at is not None

    @pytest.mark.asyncio
    async def test_idempotent_does_not_overwrite(self, db_conn):
        """Running sync twice keeps the first checked_in_at value."""
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        meeting = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            1,
            BASE_TIME,
            zoom_meeting_id=333,
        )
        user = await create_test_user(db_conn, "300", "carol@example.com")

        first_join = "2026-04-07T18:01:00Z"
        second_join = "2026-04-07T18:30:00Z"

        with (
            patch(
                "core.zoom.attendance.get_meeting_participants",
                new_callable=AsyncMock,
                return_value=[_zoom_participant("carol@example.com", first_join)],
            ),
            patch(
                "core.zoom.attendance.get_transaction",
                return_value=_FakeTransaction(db_conn),
            ),
        ):
            await sync_meeting_attendance(meeting["meeting_id"], 333)

        first_row = (
            await db_conn.execute(
                select(attendances.c.checked_in_at).where(
                    (attendances.c.meeting_id == meeting["meeting_id"])
                    & (attendances.c.user_id == user["user_id"])
                )
            )
        ).first()
        first_checked_in = first_row.checked_in_at

        # Run again with different join time
        with (
            patch(
                "core.zoom.attendance.get_meeting_participants",
                new_callable=AsyncMock,
                return_value=[_zoom_participant("carol@example.com", second_join)],
            ),
            patch(
                "core.zoom.attendance.get_transaction",
                return_value=_FakeTransaction(db_conn),
            ),
        ):
            await sync_meeting_attendance(meeting["meeting_id"], 333)

        second_row = (
            await db_conn.execute(
                select(attendances.c.checked_in_at).where(
                    (attendances.c.meeting_id == meeting["meeting_id"])
                    & (attendances.c.user_id == user["user_id"])
                )
            )
        ).first()

        # Should keep the first value
        assert second_row.checked_in_at == first_checked_in

    @pytest.mark.asyncio
    async def test_skips_unknown_emails(self, db_conn):
        """Participants with emails not in users table don't create records."""
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        meeting = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            1,
            BASE_TIME,
            zoom_meeting_id=444,
        )

        with (
            patch(
                "core.zoom.attendance.get_meeting_participants",
                new_callable=AsyncMock,
                return_value=[_zoom_participant("stranger@unknown.com")],
            ),
            patch(
                "core.zoom.attendance.get_transaction",
                return_value=_FakeTransaction(db_conn),
            ),
        ):
            result = await sync_meeting_attendance(meeting["meeting_id"], 444)

        assert result["checked_in"] == 0

        # No attendance record created
        count = (
            await db_conn.execute(
                select(attendances.c.attendance_id).where(
                    attendances.c.meeting_id == meeting["meeting_id"]
                )
            )
        ).all()
        assert len(count) == 0

    @pytest.mark.asyncio
    async def test_skips_when_meeting_not_ended(self, db_conn):
        """Returns skip result when Zoom report isn't available yet."""
        with patch(
            "core.zoom.attendance.get_meeting_participants",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await sync_meeting_attendance(999, 555)

        assert result.get("skipped") == "not_ended"

    @pytest.mark.asyncio
    async def test_creates_attendance_for_unrsvpd_user(self, db_conn):
        """User with no prior attendance record gets one created with checked_in_at."""
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        meeting = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            1,
            BASE_TIME,
            zoom_meeting_id=666,
        )
        user = await create_test_user(db_conn, "600", "dave@example.com")

        # No pre-existing attendance record

        with (
            patch(
                "core.zoom.attendance.get_meeting_participants",
                new_callable=AsyncMock,
                return_value=[_zoom_participant("dave@example.com")],
            ),
            patch(
                "core.zoom.attendance.get_transaction",
                return_value=_FakeTransaction(db_conn),
            ),
        ):
            result = await sync_meeting_attendance(meeting["meeting_id"], 666)

        assert result["checked_in"] >= 1

        row = (
            await db_conn.execute(
                select(
                    attendances.c.checked_in_at,
                    attendances.c.rsvp_status,
                ).where(
                    (attendances.c.meeting_id == meeting["meeting_id"])
                    & (attendances.c.user_id == user["user_id"])
                )
            )
        ).first()

        assert row is not None
        assert row.checked_in_at is not None
        # Default rsvp_status for new records
        assert row.rsvp_status == RSVPStatus.pending


# ============================================================================
# sync_zoom_attendance tests
# ============================================================================


class TestSyncZoomAttendance:
    @pytest.mark.asyncio
    async def test_time_window_query(self, db_conn):
        """Only meetings in the 30min–48h window are polled."""
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        now = datetime.now(timezone.utc)

        # Too recent (10 min ago) — should NOT be polled
        too_recent = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            1,
            now - timedelta(minutes=10),
            zoom_meeting_id=1001,
        )
        # In window (2 hours ago) — SHOULD be polled
        in_window = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            2,
            now - timedelta(hours=2),
            zoom_meeting_id=1002,
        )
        # Too old (3 days ago) — should NOT be polled
        too_old = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            3,
            now - timedelta(days=3),
            zoom_meeting_id=1003,
        )
        # No zoom_meeting_id — should NOT be polled
        no_zoom = await create_test_meeting(
            db_conn,
            group["group_id"],
            cohort["cohort_id"],
            4,
            now - timedelta(hours=1),
            zoom_meeting_id=None,
        )

        polled_meeting_ids = []

        async def mock_sync(meeting_id, zoom_meeting_id):
            polled_meeting_ids.append(meeting_id)
            return {
                "checked_in": 0,
                "participants_found": 0,
                "matched": 0,
                "already_checked_in": 0,
            }

        with (
            patch(
                "core.zoom.attendance.sync_meeting_attendance",
                side_effect=mock_sync,
            ),
            patch(
                "core.zoom.attendance.get_connection",
                return_value=_FakeConnection(db_conn),
            ),
        ):
            await sync_zoom_attendance()

        assert in_window["meeting_id"] in polled_meeting_ids
        assert too_recent["meeting_id"] not in polled_meeting_ids
        assert too_old["meeting_id"] not in polled_meeting_ids
        assert no_zoom["meeting_id"] not in polled_meeting_ids


# ============================================================================
# Test helpers
# ============================================================================


class _FakeTransaction:
    """Wraps an existing test connection as an async context manager.

    Lets us patch get_transaction() so the production code does
    `async with get_transaction() as conn:` using the test's rolled-back conn.
    """

    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *args):
        pass


class _FakeConnection:
    """Same as _FakeTransaction but for get_connection()."""

    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *args):
        pass
