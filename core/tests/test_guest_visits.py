"""Tests for guest visit business logic."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock

from core.guest_visits import (
    find_alternative_meetings,
    create_guest_visit,
    cancel_guest_visit,
    get_user_guest_visits,
)


def _make_mapping_result(rows):
    """Helper to create a mock result that supports .mappings().first() and iteration."""
    mock_result = Mock()
    mock_mappings = Mock()
    mock_mappings.first.return_value = rows[0] if rows else None
    mock_mappings.__iter__ = Mock(return_value=iter(rows))
    mock_result.mappings.return_value = mock_mappings
    mock_result.rowcount = len(rows)
    return mock_result


class TestFindAlternativeMeetings:
    """Test find_alternative_meetings()."""

    @pytest.mark.asyncio
    async def test_returns_alternative_meetings_from_other_groups(self):
        """Should return meetings from other groups in same cohort with same meeting_number."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        # Call 1: home meeting lookup
        home_meeting = {
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
        }
        # Call 2: user's active group in cohort
        user_group = {"group_id": 10}
        # Call 3: alternative meetings query
        alt_meeting = {
            "meeting_id": 200,
            "group_id": 20,
            "scheduled_at": future,
            "meeting_number": 3,
            "group_name": "Group B",
            "facilitator_name": "Alice",
        }

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home_meeting]),
                _make_mapping_result([user_group]),
                _make_mapping_result([alt_meeting]),
            ]
        )

        result = await find_alternative_meetings(mock_conn, user_id=1, meeting_id=100)

        assert len(result) == 1
        assert result[0]["meeting_id"] == 200
        assert result[0]["group_name"] == "Group B"
        assert result[0]["facilitator_name"] == "Alice"
        assert result[0]["scheduled_at"] == future.isoformat()

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_alternatives_exist(self):
        """Should return empty list when no other groups have the same meeting_number."""
        mock_conn = AsyncMock()

        home_meeting = {
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
        }
        user_group = {"group_id": 10}

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home_meeting]),
                _make_mapping_result([user_group]),
                _make_mapping_result([]),  # no alternatives
            ]
        )

        result = await find_alternative_meetings(mock_conn, user_id=1, meeting_id=100)

        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_meeting_not_found(self):
        """Should return empty list when the home meeting doesn't exist."""
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        result = await find_alternative_meetings(mock_conn, user_id=1, meeting_id=999)

        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_user_not_in_cohort(self):
        """Should return empty list when user has no active group in the cohort."""
        mock_conn = AsyncMock()

        home_meeting = {
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
        }

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home_meeting]),
                _make_mapping_result([]),  # user has no group
            ]
        )

        result = await find_alternative_meetings(mock_conn, user_id=1, meeting_id=100)

        assert result == []


class TestCreateGuestVisit:
    """Test create_guest_visit()."""

    @pytest.mark.asyncio
    async def test_creates_guest_attendance_and_marks_home_not_attending(self):
        """Should create guest attendance on host and set home to not_attending."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        home = {
            "meeting_id": 100,
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        host = {
            "meeting_id": 200,
            "group_id": 20,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future + timedelta(hours=2),
        }
        membership = {"group_user_id": 50}

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home]),  # home meeting lookup
                _make_mapping_result([host]),  # host meeting lookup
                _make_mapping_result([membership]),  # membership check
                _make_mapping_result([]),  # no existing visit
                Mock(rowcount=1),  # guest insert
                Mock(rowcount=1),  # home upsert
            ]
        )

        result = await create_guest_visit(
            mock_conn, user_id=1, home_meeting_id=100, host_meeting_id=200
        )

        assert result["host_meeting_id"] == 200
        assert result["host_group_id"] == 20
        assert result["home_group_id"] == 10
        assert mock_conn.execute.call_count == 6

    @pytest.mark.asyncio
    async def test_rejects_when_home_and_host_are_same_group(self):
        """Should raise ValueError when home and host meetings are in the same group."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        # Both meetings in group 10
        home = {
            "meeting_id": 100,
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        host = {
            "meeting_id": 200,
            "group_id": 10,  # same group!
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home]),
                _make_mapping_result([host]),
            ]
        )

        with pytest.raises(ValueError, match="own group"):
            await create_guest_visit(
                mock_conn, user_id=1, home_meeting_id=100, host_meeting_id=200
            )

    @pytest.mark.asyncio
    async def test_rejects_cross_cohort_visits(self):
        """Should raise ValueError when meetings are in different cohorts."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        home = {
            "meeting_id": 100,
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        host = {
            "meeting_id": 200,
            "group_id": 20,
            "cohort_id": 2,  # different cohort!
            "meeting_number": 3,
            "scheduled_at": future,
        }

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home]),
                _make_mapping_result([host]),
            ]
        )

        with pytest.raises(ValueError, match="same cohort"):
            await create_guest_visit(
                mock_conn, user_id=1, home_meeting_id=100, host_meeting_id=200
            )

    @pytest.mark.asyncio
    async def test_rejects_different_meeting_numbers(self):
        """Should raise ValueError when meetings have different meeting_numbers."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        home = {
            "meeting_id": 100,
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        host = {
            "meeting_id": 200,
            "group_id": 20,
            "cohort_id": 1,
            "meeting_number": 4,  # different meeting number!
            "scheduled_at": future,
        }

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home]),
                _make_mapping_result([host]),
            ]
        )

        with pytest.raises(ValueError, match="same meeting number"):
            await create_guest_visit(
                mock_conn, user_id=1, home_meeting_id=100, host_meeting_id=200
            )

    @pytest.mark.asyncio
    async def test_rejects_when_user_not_a_member(self):
        """Should raise ValueError when user doesn't belong to home group."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        home = {
            "meeting_id": 100,
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        host = {
            "meeting_id": 200,
            "group_id": 20,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home]),
                _make_mapping_result([host]),
                _make_mapping_result([]),  # no membership
            ]
        )

        with pytest.raises(ValueError, match="not a member"):
            await create_guest_visit(
                mock_conn, user_id=1, home_meeting_id=100, host_meeting_id=200
            )

    @pytest.mark.asyncio
    async def test_rejects_when_existing_visit_for_meeting_number(self):
        """Should raise ValueError when user already has a guest visit for this meeting_number."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        home = {
            "meeting_id": 100,
            "group_id": 10,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        host = {
            "meeting_id": 200,
            "group_id": 20,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        membership = {"group_user_id": 50}
        existing = {"attendance_id": 999}

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([home]),
                _make_mapping_result([host]),
                _make_mapping_result([membership]),
                _make_mapping_result([existing]),  # existing visit!
            ]
        )

        with pytest.raises(ValueError, match="existing visit"):
            await create_guest_visit(
                mock_conn, user_id=1, home_meeting_id=100, host_meeting_id=200
            )


class TestCancelGuestVisit:
    """Test cancel_guest_visit()."""

    @pytest.mark.asyncio
    async def test_deletes_guest_attendance_and_resets_home_rsvp(self):
        """Should delete guest attendance and reset home meeting RSVP to pending."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        mock_conn = AsyncMock()

        guest_attendance = {"attendance_id": 500, "meeting_id": 200}
        host = {
            "meeting_id": 200,
            "group_id": 20,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": future,
        }
        user_group = {"group_id": 10}
        home_meeting = {"meeting_id": 100}

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([guest_attendance]),  # find guest attendance
                _make_mapping_result([host]),  # host meeting details
                Mock(rowcount=1),  # delete guest attendance
                _make_mapping_result([user_group]),  # user's group
                _make_mapping_result([home_meeting]),  # home meeting
                Mock(rowcount=1),  # reset home RSVP
            ]
        )

        result = await cancel_guest_visit(mock_conn, user_id=1, host_meeting_id=200)

        assert result["host_group_id"] == 20
        assert result["home_group_id"] == 10
        assert mock_conn.execute.call_count == 6

    @pytest.mark.asyncio
    async def test_rejects_cancellation_after_meeting_started(self):
        """Should raise ValueError when the meeting has already started."""
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        mock_conn = AsyncMock()

        guest_attendance = {"attendance_id": 500, "meeting_id": 200}
        host = {
            "meeting_id": 200,
            "group_id": 20,
            "cohort_id": 1,
            "meeting_number": 3,
            "scheduled_at": past,  # already started!
        }

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([guest_attendance]),
                _make_mapping_result([host]),
            ]
        )

        with pytest.raises(ValueError, match="already started"):
            await cancel_guest_visit(mock_conn, user_id=1, host_meeting_id=200)

    @pytest.mark.asyncio
    async def test_rejects_when_no_guest_attendance(self):
        """Should raise ValueError when no guest attendance record exists."""
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        with pytest.raises(ValueError, match="guest attendance not found"):
            await cancel_guest_visit(mock_conn, user_id=1, host_meeting_id=200)


class TestGetUserGuestVisits:
    """Test get_user_guest_visits()."""

    @pytest.mark.asyncio
    async def test_returns_visits_with_is_past_and_can_cancel_flags(self):
        """Should return guest visits with computed is_past and can_cancel flags."""
        future = datetime.now(timezone.utc) + timedelta(days=3)
        past = datetime.now(timezone.utc) - timedelta(days=1)
        mock_conn = AsyncMock()

        visits_data = [
            {
                "attendance_id": 500,
                "meeting_id": 200,
                "group_id": 20,
                "scheduled_at": past,
                "meeting_number": 2,
                "group_name": "Group B",
            },
            {
                "attendance_id": 501,
                "meeting_id": 300,
                "group_id": 30,
                "scheduled_at": future,
                "meeting_number": 4,
                "group_name": "Group C",
            },
        ]

        mock_conn.execute = AsyncMock(return_value=_make_mapping_result(visits_data))

        result = await get_user_guest_visits(mock_conn, user_id=1)

        assert len(result) == 2

        # Past visit
        assert result[0]["is_past"] is True
        assert result[0]["can_cancel"] is False
        assert result[0]["scheduled_at"] == past.isoformat()

        # Future visit
        assert result[1]["is_past"] is False
        assert result[1]["can_cancel"] is True
        assert result[1]["scheduled_at"] == future.isoformat()

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_visits(self):
        """Should return empty list when user has no guest visits."""
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        result = await get_user_guest_visits(mock_conn, user_id=1)

        assert result == []
