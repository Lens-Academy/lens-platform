"""Tests for study activity message rendering and data gathering."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, date, timedelta
from uuid import UUID


class TestRenderMessage:
    def test_single_user_in_progress(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 3,
                "sections_total": 8,
                "module_completed": False,
                "early_bird_days": None,
            }
        ]

        result = render_study_activity_message(entries)
        assert "Today's Study Activity" in result
        assert "<@123>" in result
        assert "Cognitive Superpowers" in result
        assert "3/8 sections" in result

    def test_completed_module(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": None,
            }
        ]

        result = render_study_activity_message(entries)
        assert "completed" in result.lower()

    def test_early_bird_tag(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": 4,
            }
        ]

        result = render_study_activity_message(entries)
        assert "early bird" in result.lower()
        assert "4 days" in result

    def test_multiple_users_completed_first(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "456",
                "display_name": "Bob",
                "module_title": "Decision Theory",
                "sections_completed": 2,
                "sections_total": 5,
                "module_completed": False,
                "early_bird_days": None,
            },
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": None,
            },
        ]

        result = render_study_activity_message(entries)
        lines = result.strip().split("\n")
        # Find the user lines (skip header)
        user_lines = [line for line in lines if "<@" in line]
        # Completed users should appear before in-progress
        alice_idx = next(i for i, line in enumerate(user_lines) if "Alice" in line)
        bob_idx = next(i for i, line in enumerate(user_lines) if "Bob" in line)
        assert alice_idx < bob_idx, (
            "Completed user (Alice) should appear before in-progress (Bob)"
        )

    def test_empty_entries(self):
        from core.notifications.study_activity import render_study_activity_message

        result = render_study_activity_message([])
        assert result is None


def _mock_execute_results(*results):
    """Helper: create a mock conn.execute that returns results in order."""
    mock_results = []
    for rows in results:
        mock_result = MagicMock()
        mock_result.mappings.return_value.fetchall.return_value = rows
        mock_result.mappings.return_value.first.return_value = rows[0] if rows else None
        mock_results.append(mock_result)
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(side_effect=mock_results)
    return mock_conn


def _mock_module(title="Cognitive Superpowers", num_sections=8, content_id_int=100):
    """Helper: create a mock FlattenedModule."""
    mock = MagicMock()
    mock.title = title
    mock.sections = [
        {"contentId": str(UUID(int=i + 1)), "optional": False}
        for i in range(num_sections)
    ]
    mock.content_id = UUID(int=content_id_int)
    return mock


class TestGatherGroupStudyData:
    @pytest.mark.asyncio
    async def test_returns_entries_for_group_members_who_studied_today(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module(num_sections=8)
        section_ids = [UUID(s["contentId"]) for s in mock_module.sections]

        mock_conn = _mock_execute_results(
            [
                {
                    "user_id": 1,
                    "discord_id": "111",
                    "nickname": "Alice",
                    "discord_username": "alice",
                },
                {
                    "user_id": 2,
                    "discord_id": "222",
                    "nickname": "Bob",
                    "discord_username": "bob",
                },
            ],
            [
                {
                    "user_id": 1,
                    "content_id": section_ids[0],
                    "content_type": "lens",
                    "completed_at": datetime.now(timezone.utc),
                },
                {
                    "user_id": 1,
                    "content_id": section_ids[1],
                    "content_type": "lens",
                    "completed_at": datetime.now(timezone.utc),
                },
                {
                    "user_id": 1,
                    "content_id": section_ids[2],
                    "content_type": "lens",
                    "completed_at": datetime.now(timezone.utc),
                },
            ],
            [],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn,
                group_id=1,
                module_slug="cognitive-superpowers",
                today=date.today(),
            )

        assert len(entries) == 1
        assert entries[0]["discord_id"] == "111"
        assert entries[0]["display_name"] == "Alice"
        assert entries[0]["sections_completed"] == 3
        assert entries[0]["sections_total"] == 8
        assert entries[0]["module_completed"] is False
        assert mock_conn.execute.call_count == 3

    @pytest.mark.asyncio
    async def test_module_completed_flag_set_correctly(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module(num_sections=2)
        section_ids = [UUID(s["contentId"]) for s in mock_module.sections]

        mock_conn = _mock_execute_results(
            [
                {
                    "user_id": 1,
                    "discord_id": "111",
                    "nickname": "Alice",
                    "discord_username": "alice",
                }
            ],
            [
                {
                    "user_id": 1,
                    "content_id": section_ids[0],
                    "content_type": "lens",
                    "completed_at": datetime.now(timezone.utc),
                },
                {
                    "user_id": 1,
                    "content_id": section_ids[1],
                    "content_type": "lens",
                    "completed_at": datetime.now(timezone.utc),
                },
            ],
            [{"user_id": 1}],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn,
                group_id=1,
                module_slug="test",
                today=date.today(),
            )

        assert len(entries) == 1
        assert entries[0]["module_completed"] is True

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_one_studied(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module()
        mock_conn = _mock_execute_results(
            [
                {
                    "user_id": 1,
                    "discord_id": "111",
                    "nickname": "Alice",
                    "discord_username": "alice",
                }
            ],
            [],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn,
                group_id=1,
                module_slug="test",
                today=date.today(),
            )

        assert entries == []
        assert mock_conn.execute.call_count == 2

    @pytest.mark.asyncio
    async def test_uses_nickname_over_discord_username(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module(num_sections=4)
        section_ids = [UUID(s["contentId"]) for s in mock_module.sections]

        mock_conn = _mock_execute_results(
            [
                {
                    "user_id": 1,
                    "discord_id": "111",
                    "nickname": "CustomName",
                    "discord_username": "discord_user",
                }
            ],
            [
                {
                    "user_id": 1,
                    "content_id": section_ids[0],
                    "content_type": "lens",
                    "completed_at": datetime.now(timezone.utc),
                }
            ],
            [],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn,
                group_id=1,
                module_slug="test",
                today=date.today(),
            )

        assert entries[0]["display_name"] == "CustomName"


class TestComputeEarlyBirdDays:
    @pytest.mark.asyncio
    async def test_returns_days_when_meeting_is_far(self):
        from core.notifications.study_activity import compute_early_bird_days

        # Use a meeting time 5 days and 12 hours ahead to avoid edge cases
        # where timedelta.days rounds down
        meeting_time = datetime.now(timezone.utc) + timedelta(days=5, hours=12)
        mock_conn = _mock_execute_results([{"scheduled_at": meeting_time}])

        with (
            patch("core.notifications.study_activity.load_course") as mock_load,
            patch(
                "core.notifications.study_activity.get_due_by_meeting", return_value=2
            ),
        ):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn,
                group_id=1,
                module_slug="test",
                course_slug="ai-safety",
            )

        assert result == 5

    @pytest.mark.asyncio
    async def test_returns_none_when_meeting_is_tomorrow(self):
        from core.notifications.study_activity import compute_early_bird_days

        meeting_time = datetime.now(timezone.utc) + timedelta(days=1)
        mock_conn = _mock_execute_results([{"scheduled_at": meeting_time}])

        with (
            patch("core.notifications.study_activity.load_course") as mock_load,
            patch(
                "core.notifications.study_activity.get_due_by_meeting", return_value=1
            ),
        ):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn,
                group_id=1,
                module_slug="test",
                course_slug="ai-safety",
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_no_meeting_found(self):
        from core.notifications.study_activity import compute_early_bird_days

        mock_conn = _mock_execute_results([])

        with (
            patch("core.notifications.study_activity.load_course") as mock_load,
            patch(
                "core.notifications.study_activity.get_due_by_meeting", return_value=3
            ),
        ):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn,
                group_id=1,
                module_slug="test",
                course_slug="ai-safety",
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_module_not_due_for_any_meeting(self):
        from core.notifications.study_activity import compute_early_bird_days

        mock_conn = AsyncMock()

        with (
            patch("core.notifications.study_activity.load_course") as mock_load,
            patch(
                "core.notifications.study_activity.get_due_by_meeting",
                return_value=None,
            ),
        ):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn,
                group_id=1,
                module_slug="test",
                course_slug="ai-safety",
            )

        assert result is None
        mock_conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_none_when_course_not_found(self):
        from core.notifications.study_activity import compute_early_bird_days

        mock_conn = AsyncMock()

        with patch(
            "core.notifications.study_activity.load_course",
            side_effect=Exception("not found"),
        ):
            result = await compute_early_bird_days(
                mock_conn,
                group_id=1,
                module_slug="test",
                course_slug="bad-slug",
            )

        assert result is None


class TestGetUserGroupInfo:
    @pytest.mark.asyncio
    async def test_returns_group_info_for_active_member(self):
        from core.notifications.study_activity import get_user_group_info

        mock_conn = _mock_execute_results(
            [
                {
                    "group_id": 5,
                    "discord_text_channel_id": "CH999",
                    "cohort_id": 10,
                    "course_slug": "ai-safety",
                }
            ],
        )
        result = await get_user_group_info(mock_conn, user_id=1)

        assert result is not None
        assert result["group_id"] == 5
        assert result["discord_text_channel_id"] == "CH999"
        assert result["course_slug"] == "ai-safety"

    @pytest.mark.asyncio
    async def test_returns_none_when_not_in_group(self):
        from core.notifications.study_activity import get_user_group_info

        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_group_info(mock_conn, user_id=1)
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_group_has_no_channel(self):
        from core.notifications.study_activity import get_user_group_info

        mock_conn = _mock_execute_results(
            [
                {
                    "group_id": 5,
                    "discord_text_channel_id": None,
                    "cohort_id": 10,
                    "course_slug": "ai-safety",
                }
            ],
        )
        result = await get_user_group_info(mock_conn, user_id=1)
        assert result is None
