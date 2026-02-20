"""Tests that facilitator queries exclude guest attendance records.

These tests verify that the actual SQL queries built by the facilitator
functions include is_guest filtering. We call each function with a mock
connection, capture the executed SQLAlchemy query objects, compile them
to SQL strings, and check for the is_guest filter.
"""

import pytest
from unittest.mock import AsyncMock, Mock
from sqlalchemy.dialects import postgresql

from core.queries.facilitator import (
    get_group_members_with_progress,
    get_group_completion_data,
    get_user_meeting_attendance,
)


def _make_mapping_result(rows):
    """Helper to create a mock result supporting .mappings() and iteration."""
    mock_result = Mock()
    mock_mappings = Mock()
    if rows:
        mock_mappings.first.return_value = rows[0]
        mock_mappings.all.return_value = rows
        mock_mappings.__iter__ = Mock(return_value=iter(rows))
    else:
        mock_mappings.first.return_value = None
        mock_mappings.all.return_value = []
        mock_mappings.__iter__ = Mock(return_value=iter([]))
    mock_result.mappings.return_value = mock_mappings
    mock_result.rowcount = len(rows)
    mock_result.__iter__ = Mock(return_value=iter(rows))
    return mock_result


def _compile_sql(query) -> str:
    """Compile a SQLAlchemy query to SQL string for inspection."""
    return str(
        query.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


class TestGuestFiltering:
    """Verify facilitator queries include is_guest filter in compiled SQL."""

    @pytest.mark.asyncio
    async def test_meetings_attended_subquery_excludes_guests(self):
        """get_group_members_with_progress query should filter on is_guest."""
        conn = AsyncMock()
        conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        await get_group_members_with_progress(conn, group_id=1)

        # Capture the query that was executed and compile to SQL
        assert conn.execute.called, "Function should execute a query"
        query_arg = conn.execute.call_args[0][0]
        sql = _compile_sql(query_arg)
        assert "is_guest" in sql, (
            f"Query must filter on is_guest to exclude guest check-ins.\nSQL: {sql}"
        )

    @pytest.mark.asyncio
    async def test_completion_data_excludes_guests(self):
        """get_group_completion_data attendance query should filter on is_guest."""
        from datetime import datetime, timezone

        # The function calls conn.execute 3 times:
        #   1. completions query (can be empty)
        #   2. meetings query (needs rows so attendance branch runs)
        #   3. attendance query (the one we want to inspect)
        fake_meeting = Mock()
        fake_meeting.meeting_id = 1
        fake_meeting.meeting_number = 1
        fake_meeting.scheduled_at = datetime(2020, 1, 1, tzinfo=timezone.utc)

        empty_result = _make_mapping_result([])
        meetings_result = Mock()
        meetings_result.mappings = Mock(return_value=Mock(all=Mock(return_value=[])))
        meetings_result.__iter__ = Mock(return_value=iter([fake_meeting]))

        conn = AsyncMock()
        conn.execute = AsyncMock(
            side_effect=[empty_result, meetings_result, empty_result]
        )

        try:
            await get_group_completion_data(conn, group_id=1)
        except Exception:
            pass  # May fail with mock data; we only need query capture

        # Find any executed query that touches attendances and verify is_guest
        found = False
        for call in conn.execute.call_args_list:
            if call.args:
                try:
                    sql = _compile_sql(call.args[0])
                    if "attendances" in sql and "is_guest" in sql:
                        found = True
                        break
                except Exception:
                    continue
        assert found, "Attendance query must filter on is_guest"

    @pytest.mark.asyncio
    async def test_user_meeting_attendance_excludes_guests(self):
        """get_user_meeting_attendance outerjoin should filter on is_guest."""
        conn = AsyncMock()
        conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        await get_user_meeting_attendance(conn, user_id=1, group_id=1)

        assert conn.execute.called, "Function should execute a query"
        query_arg = conn.execute.call_args[0][0]
        sql = _compile_sql(query_arg)
        assert "is_guest" in sql, (
            f"Outerjoin must filter on is_guest to exclude guest records.\nSQL: {sql}"
        )
