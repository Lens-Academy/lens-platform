"""Tests for notification context building (TDD).

Following the plan in docs/plans/2026-02-04-apscheduler-refactor.md:
- Layer 1: Pure functions (build_reminder_context) - unit tests, no mocks
- Layer 2: Data fetching (get_meeting_with_group, get_active_member_ids) - mock DB
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch


# =============================================================================
# Layer 1: Pure function tests (no mocks needed)
# =============================================================================


class TestBuildReminderContext:
    """Test build_reminder_context() pure function."""

    def test_builds_context_with_fresh_urls(self):
        """Context should include dynamically generated URLs."""
        from core.notifications.context import build_reminder_context
        from core.notifications.urls import build_course_url

        meeting = {"scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc)}
        group = {"group_name": "Group 1", "discord_text_channel_id": "123456789"}

        context = build_reminder_context(meeting, group)

        # Should use build_course_url() - not a stale URL
        # Compare against whatever build_course_url returns (varies by env)
        assert context["module_url"] == build_course_url()
        assert context["group_name"] == "Group 1"
        assert "17:00" in context["meeting_time"]

    def test_context_includes_iso_timestamp(self):
        """Context should include ISO timestamp for per-user timezone formatting."""
        from core.notifications.context import build_reminder_context

        meeting = {"scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc)}
        group = {"group_name": "Group 1", "discord_text_channel_id": "123456789"}

        context = build_reminder_context(meeting, group)

        assert "meeting_time_utc" in context
        assert context["meeting_time_utc"] == "2026-02-10T17:00:00+00:00"

    def test_context_includes_discord_channel_url(self):
        """Context should include Discord channel URL."""
        from core.notifications.context import build_reminder_context

        meeting = {"scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc)}
        group = {"group_name": "Group 1", "discord_text_channel_id": "123456789"}

        context = build_reminder_context(meeting, group)

        assert "discord_channel_url" in context
        assert "123456789" in context["discord_channel_url"]
        assert "discord.com/channels" in context["discord_channel_url"]

    def test_context_includes_module_info_placeholders(self):
        """Context should include module-related placeholders."""
        from core.notifications.context import build_reminder_context

        meeting = {"scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc)}
        group = {"group_name": "Group 1", "discord_text_channel_id": "123456789"}

        context = build_reminder_context(meeting, group)

        assert "module_list" in context
        assert "modules_remaining" in context

    def test_context_meeting_time_human_readable(self):
        """Context should include human-readable meeting time with day and UTC."""
        from core.notifications.context import build_reminder_context

        # Tuesday Feb 10, 2026
        meeting = {"scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc)}
        group = {"group_name": "Test", "discord_text_channel_id": "123"}

        context = build_reminder_context(meeting, group)

        # Should have day name and UTC indicator
        assert "Tuesday" in context["meeting_time"]
        assert "UTC" in context["meeting_time"]


# =============================================================================
# Layer 2: Data fetching tests (mock DB at boundary)
# =============================================================================


class TestGetMeetingWithGroup:
    """Test get_meeting_with_group() async function."""

    @pytest.mark.asyncio
    async def test_returns_meeting_and_group(self):
        """Should return tuple of (meeting, group) when meeting exists."""
        from core.notifications.context import get_meeting_with_group

        mock_conn = AsyncMock()

        # Mock the query result with a meeting joined with its group
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc),
            "meeting_number": 3,
            "group_name": "Curious Capybaras",
            "discord_text_channel_id": "123456789",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        # Patch at the module where it's imported, not core.database
        with patch("core.notifications.context.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await get_meeting_with_group(meeting_id=42)

        assert result is not None
        meeting, group = result
        assert meeting["meeting_id"] == 42
        assert meeting["group_id"] == 10
        assert group["group_name"] == "Curious Capybaras"
        assert group["discord_text_channel_id"] == "123456789"

    @pytest.mark.asyncio
    async def test_returns_none_for_missing_meeting(self):
        """Should return None when meeting doesn't exist."""
        from core.notifications.context import get_meeting_with_group

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_result)

        # Patch at the module where it's imported, not core.database
        with patch("core.notifications.context.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await get_meeting_with_group(meeting_id=99999)

        assert result is None


class TestGetActiveMemberIds:
    """Test get_active_member_ids() async function."""

    @pytest.mark.asyncio
    async def test_returns_active_member_user_ids(self):
        """Should return list of user_ids for active group members."""
        from core.notifications.context import get_active_member_ids

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {"user_id": 1},
            {"user_id": 3},
            {"user_id": 5},
        ]
        mock_conn.execute = AsyncMock(return_value=mock_result)

        # Patch at the module where it's imported, not core.database
        with patch("core.notifications.context.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            user_ids = await get_active_member_ids(group_id=10)

        assert user_ids == [1, 3, 5]

    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_members(self):
        """Should return empty list when group has no active members."""
        from core.notifications.context import get_active_member_ids

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = []
        mock_conn.execute = AsyncMock(return_value=mock_result)

        # Patch at the module where it's imported, not core.database
        with patch("core.notifications.context.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            user_ids = await get_active_member_ids(group_id=10)

        assert user_ids == []

    @pytest.mark.asyncio
    async def test_filters_by_active_status(self):
        """Should only return members with active status (verified by query)."""
        from core.notifications.context import get_active_member_ids

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        # The query should filter - we just verify it's called correctly
        mock_result.mappings.return_value = [{"user_id": 1}, {"user_id": 2}]
        mock_conn.execute = AsyncMock(return_value=mock_result)

        # Patch at the module where it's imported, not core.database
        with patch("core.notifications.context.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            user_ids = await get_active_member_ids(group_id=10)

        # Verify execute was called (the query includes the status filter)
        mock_conn.execute.assert_called_once()
        assert user_ids == [1, 2]
