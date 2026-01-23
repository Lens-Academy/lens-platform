"""Tests for group joining business logic (TDD)."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

from core.group_joining import _calculate_next_meeting, get_user_current_group


class TestCalculateNextMeeting:
    """Test meeting time calculation."""

    def test_returns_first_meeting_if_in_future(self):
        """Should return first_meeting_at if it's in the future."""
        future = datetime.now(timezone.utc) + timedelta(days=7)
        result = _calculate_next_meeting("Wednesday 15:00", future)
        assert result == future.isoformat()

    def test_returns_none_for_empty_recurring_time(self):
        """Should return None if no recurring time provided."""
        result = _calculate_next_meeting("", None)
        assert result is None

    def test_returns_none_for_invalid_format(self):
        """Should return None for invalid recurring time format."""
        result = _calculate_next_meeting("invalid", None)
        assert result is None

    def test_calculates_next_wednesday(self):
        """Should calculate next occurrence from recurring time."""
        result = _calculate_next_meeting("Wednesday 15:00", None)
        assert result is not None
        parsed = datetime.fromisoformat(result)
        assert parsed.weekday() == 2  # Wednesday
        assert parsed.hour == 15
        assert parsed.minute == 0


class TestGetUserCurrentGroup:
    """Test getting user's current group."""

    @pytest.mark.asyncio
    async def test_returns_none_when_user_has_no_group(self):
        """Should return None if user is not in any group for the cohort."""
        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_current_group(mock_conn, user_id=1, cohort_id=10)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_group_when_user_is_member(self):
        """Should return group info when user is an active member."""
        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 5,
            "group_name": "Test Group",
            "recurring_meeting_time_utc": "Wednesday 15:00",
            "group_user_id": 100,
            "role": "participant",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_current_group(mock_conn, user_id=1, cohort_id=10)

        assert result is not None
        assert result["group_id"] == 5
        assert result["group_name"] == "Test Group"
