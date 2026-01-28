"""Tests for group joining business logic (TDD)."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from core.group_joining import (
    _calculate_next_meeting,
    get_user_current_group,
    assign_group_badge,
    get_joinable_groups,
    join_group,
    get_user_group_info,
)


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


class TestAssignGroupBadge:
    """Test badge assignment logic."""

    def test_assigns_best_size_for_3_members(self):
        """Groups with 3 members get best_size badge."""
        assert assign_group_badge(3) == "best_size"

    def test_assigns_best_size_for_4_members(self):
        """Groups with 4 members get best_size badge."""
        assert assign_group_badge(4) == "best_size"

    def test_no_badge_for_2_members(self):
        """Groups with 2 members get no badge."""
        assert assign_group_badge(2) is None

    def test_no_badge_for_5_members(self):
        """Groups with 5 members get no badge."""
        assert assign_group_badge(5) is None

    def test_no_badge_for_0_members(self):
        """Empty groups get no badge."""
        assert assign_group_badge(0) is None


class TestGetJoinableGroups:
    """Test group listing and filtering."""

    @pytest.mark.asyncio
    async def test_returns_empty_list_for_cohort_with_no_groups(self):
        """Should return empty list if cohort has no groups."""
        mock_conn = AsyncMock()

        # First call: get_user_current_group returns None
        # Second call: main query returns no rows
        mock_result_empty = MagicMock()
        mock_result_empty.mappings.return_value.first.return_value = None
        mock_result_empty.mappings.return_value = []

        mock_conn.execute = AsyncMock(return_value=mock_result_empty)

        result = await get_joinable_groups(mock_conn, cohort_id=1, user_id=None)

        assert result == []

    @pytest.mark.asyncio
    async def test_adds_badge_to_groups_with_3_to_4_members(self):
        """Groups with 3-4 members should get best_size badge."""
        mock_conn = AsyncMock()

        # Mock query results
        mock_groups = MagicMock()
        mock_groups.mappings.return_value = [
            {
                "group_id": 1,
                "group_name": "Group A",
                "recurring_meeting_time_utc": "Wednesday 15:00",
                "status": "active",
                "member_count": 3,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
            {
                "group_id": 2,
                "group_name": "Group B",
                "recurring_meeting_time_utc": "Thursday 16:00",
                "status": "active",
                "member_count": 5,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
        ]

        mock_conn.execute = AsyncMock(return_value=mock_groups)

        result = await get_joinable_groups(mock_conn, cohort_id=1, user_id=None)

        assert len(result) == 2
        assert result[0]["badge"] == "best_size"  # 3 members
        assert result[1]["badge"] is None  # 5 members

    @pytest.mark.asyncio
    async def test_marks_current_group_with_is_current_flag(self):
        """User's current group should have is_current=True."""
        mock_conn = AsyncMock()

        # First call returns user's current group
        mock_current = MagicMock()
        mock_current.mappings.return_value.first.return_value = {"group_id": 1}

        # Second call returns groups list
        mock_groups = MagicMock()
        mock_groups.mappings.return_value = [
            {
                "group_id": 1,
                "group_name": "Current Group",
                "recurring_meeting_time_utc": "Wednesday 15:00",
                "status": "active",
                "member_count": 4,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
            {
                "group_id": 2,
                "group_name": "Other Group",
                "recurring_meeting_time_utc": "Thursday 16:00",
                "status": "active",
                "member_count": 4,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
        ]

        mock_conn.execute = AsyncMock(side_effect=[mock_current, mock_groups])

        result = await get_joinable_groups(mock_conn, cohort_id=1, user_id=99)

        assert result[0]["is_current"] is True
        assert result[1]["is_current"] is False


class TestJoinGroup:
    """Test group joining logic."""

    @pytest.mark.asyncio
    async def test_adds_user_to_new_group(self):
        """Should add user to groups_users when joining first group."""
        mock_conn = AsyncMock()

        # Mock: user has no current group
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None

        # Mock: group exists and is joinable
        mock_group = MagicMock()
        mock_group.mappings.return_value.first.return_value = {
            "group_id": 5,
            "cohort_id": 10,
            "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            "member_count": 4,
        }

        # Mock: insert succeeds
        mock_insert = MagicMock()
        mock_insert.mappings.return_value.first.return_value = {"group_user_id": 99}

        mock_conn.execute = AsyncMock(
            side_effect=[mock_no_group, mock_group, mock_insert]
        )

        result = await join_group(mock_conn, user_id=1, group_id=5)

        assert result["success"] is True
        assert result["group_id"] == 5
        # Note: lifecycle sync is called by the API route AFTER transaction commits,
        # not inside join_group. This ensures sync functions can see committed data.

    @pytest.mark.asyncio
    async def test_switches_user_between_groups(self):
        """Should remove from old group and add to new group when switching."""
        mock_conn = AsyncMock()

        # Mock: user has current group
        mock_current = MagicMock()
        mock_current.mappings.return_value.first.return_value = {
            "group_id": 3,
            "group_user_id": 50,
        }

        # Mock: new group exists
        mock_group = MagicMock()
        mock_group.mappings.return_value.first.return_value = {
            "group_id": 5,
            "cohort_id": 10,
            "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            "member_count": 4,
        }

        # Mock: update old group (mark as removed)
        mock_update = MagicMock()

        # Mock: insert into new group
        mock_insert = MagicMock()
        mock_insert.mappings.return_value.first.return_value = {"group_user_id": 99}

        mock_conn.execute = AsyncMock(
            side_effect=[mock_current, mock_group, mock_update, mock_insert]
        )

        result = await join_group(mock_conn, user_id=1, group_id=5)

        assert result["success"] is True
        assert result["previous_group_id"] == 3
        # Note: lifecycle sync is called by the API route AFTER transaction commits

    @pytest.mark.asyncio
    async def test_rejects_joining_started_group_without_existing_group(self):
        """Should reject if group has started and user has no current group."""
        mock_conn = AsyncMock()

        # Mock: user has no current group
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None

        # Mock: group has already started
        mock_group = MagicMock()
        mock_group.mappings.return_value.first.return_value = {
            "group_id": 5,
            "cohort_id": 10,
            "first_meeting_at": datetime.now(timezone.utc) - timedelta(days=1),  # Past
            "member_count": 4,
        }

        mock_conn.execute = AsyncMock(side_effect=[mock_no_group, mock_group])

        result = await join_group(mock_conn, user_id=1, group_id=5)

        assert result["success"] is False
        assert result["error"] == "group_already_started"

    @pytest.mark.asyncio
    async def test_rejects_nonexistent_group(self):
        """Should return error when group doesn't exist."""
        mock_conn = AsyncMock()
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_no_group)

        result = await join_group(mock_conn, user_id=1, group_id=999)

        assert result["success"] is False
        assert result["error"] == "group_not_found"

    @pytest.mark.asyncio
    async def test_rejects_full_group(self):
        """Should return error when group already has 8 or more members."""
        mock_conn = AsyncMock()

        # Mock: user has no current group
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None

        # Mock: group is full (8 members)
        mock_group = MagicMock()
        mock_group.mappings.return_value.first.return_value = {
            "group_id": 5,
            "cohort_id": 10,
            "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            "member_count": 8,
        }

        mock_conn.execute = AsyncMock(side_effect=[mock_no_group, mock_group])

        result = await join_group(mock_conn, user_id=1, group_id=5)

        assert result["success"] is False
        assert result["error"] == "group_full"


class TestGetUserGroupInfo:
    """Test user group info retrieval."""

    @pytest.mark.asyncio
    async def test_returns_not_enrolled_when_no_signup(self):
        """Should return is_enrolled=False when user has no signup."""
        mock_conn = AsyncMock()

        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_group_info(mock_conn, user_id=1)

        assert result["is_enrolled"] is False
        assert "cohort_id" not in result or result.get("cohort_id") is None

    @pytest.mark.asyncio
    async def test_returns_cohort_info_when_enrolled(self):
        """Should return cohort info when user is enrolled."""
        mock_conn = AsyncMock()

        # First call: signup query
        mock_signup = MagicMock()
        mock_signup.mappings.return_value.first.return_value = {
            "cohort_id": 10,
            "cohort_name": "Test Cohort",
        }

        # Second call: current group query (no group)
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None

        mock_conn.execute = AsyncMock(side_effect=[mock_signup, mock_no_group])

        result = await get_user_group_info(mock_conn, user_id=1)

        assert result["is_enrolled"] is True
        assert result["cohort_id"] == 10
        assert result["cohort_name"] == "Test Cohort"
        assert result["current_group"] is None


class TestSyncAfterGroupChange:
    """Test sync_after_group_change delegates to sync_group correctly."""

    @pytest.mark.asyncio
    async def test_syncs_new_group_only_when_no_previous(self):
        """Should call sync_group for new group only when no previous group."""
        from core.sync import sync_after_group_change

        with patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync:
            mock_sync.return_value = {"discord": {}, "calendar": {}}

            result = await sync_after_group_change(group_id=123)

            mock_sync.assert_called_once_with(123, allow_create=False)
            assert result["new_group"] == {"discord": {}, "calendar": {}}
            assert result["old_group"] is None

    @pytest.mark.asyncio
    async def test_syncs_both_groups_when_switching(self):
        """Should call sync_group for both old and new group when switching."""
        from core.sync import sync_after_group_change

        with patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync:
            mock_sync.side_effect = [
                {"discord": {"revoked": 1}},  # Old group
                {"discord": {"granted": 1}},  # New group
            ]

            result = await sync_after_group_change(group_id=456, previous_group_id=123)

            # Should sync old group first, then new group
            assert mock_sync.call_count == 2
            mock_sync.assert_any_call(123, allow_create=False)  # Old group
            mock_sync.assert_any_call(456, allow_create=False)  # New group

            assert result["old_group"] == {"discord": {"revoked": 1}}
            assert result["new_group"] == {"discord": {"granted": 1}}

    @pytest.mark.asyncio
    async def test_syncs_old_group_first(self):
        """Should sync old group before new group (order matters for permissions)."""
        from core.sync import sync_after_group_change

        call_order = []

        async def track_calls(group_id, allow_create=False):
            call_order.append(group_id)
            return {"discord": {}}

        with patch("core.sync.sync_group", side_effect=track_calls):
            await sync_after_group_change(group_id=456, previous_group_id=123)

            # Old group (123) should be synced before new group (456)
            assert call_order == [123, 456]
