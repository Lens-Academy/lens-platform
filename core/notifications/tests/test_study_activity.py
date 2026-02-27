"""Tests for study activity message rendering and data gathering."""

import contextlib
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


@contextlib.asynccontextmanager
async def _mock_update_context(
    *, group_info, entries, early_bird_days=None, module_slugs=None,
    engagement_stats=None,
):
    """Shared test fixture for update_study_activity tests.

    entries: list of dicts returned by gather_group_study_data (returned for
        every module slug call).
    module_slugs: list of module slugs returned by get_all_module_slugs.
        Defaults to ["mod-a"] so gather is called once.
    engagement_stats: list of dicts returned by gather_user_engagement_stats.
        Defaults to empty list (no DM sent).
    """
    if module_slugs is None:
        module_slugs = ["mod-a"]
    if engagement_stats is None:
        engagement_stats = []

    with (
        patch("core.notifications.study_activity.get_connection") as mock_get_conn,
        patch(
            "core.notifications.study_activity.get_user_group_info",
            new_callable=AsyncMock,
            return_value=group_info,
        ) as mock_group_info,
        patch(
            "core.notifications.study_activity.gather_group_study_data",
            new_callable=AsyncMock,
            return_value=entries,
        ) as mock_gather,
        patch(
            "core.notifications.study_activity.compute_early_bird_days",
            new_callable=AsyncMock,
            return_value=early_bird_days,
        ) as mock_early_bird,
        patch(
            "core.notifications.study_activity.get_all_module_slugs",
            return_value=module_slugs,
        ) as mock_slugs,
        patch(
            "core.notifications.study_activity.send_channel_message",
            new_callable=AsyncMock,
            return_value="MSG456",
        ) as mock_send,
        patch(
            "core.notifications.study_activity.edit_channel_message",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_edit,
        patch(
            "core.notifications.study_activity.gather_user_engagement_stats",
            new_callable=AsyncMock,
            return_value=engagement_stats,
        ) as mock_engagement,
        patch(
            "core.notifications.study_activity.send_dm",
            new_callable=AsyncMock,
            return_value="DM_MSG_123",
        ) as mock_send_dm,
        patch(
            "core.notifications.study_activity.edit_dm",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_edit_dm,
    ):
        mock_conn = AsyncMock()
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=None)

        yield {
            "send": mock_send,
            "edit": mock_edit,
            "gather": mock_gather,
            "group_info": mock_group_info,
            "early_bird": mock_early_bird,
            "slugs": mock_slugs,
            "engagement": mock_engagement,
            "send_dm": mock_send_dm,
            "edit_dm": mock_edit_dm,
        }


_SAMPLE_GROUP_INFO = {
    "group_id": 1,
    "discord_text_channel_id": "CH123",
    "cohort_id": 10,
    "course_slug": "ai-safety",
}

_SAMPLE_ENTRY = {
    "discord_id": "111",
    "display_name": "Alice",
    "module_title": "Cognitive Superpowers",
    "sections_completed": 3,
    "sections_total": 8,
    "module_completed": False,
    "early_bird_days": None,
    "_user_id": 1,
    "_module_content_id": UUID(int=100),
    "_section_content_ids": [UUID(int=1), UUID(int=2), UUID(int=3)],
}


class TestUpdateStudyActivity:
    @pytest.mark.asyncio
    async def test_creates_new_message_when_none_exists(self):
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
        )

        _daily_messages.clear()

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["send"].assert_called_once()
        mocks["edit"].assert_not_called()
        assert len(_daily_messages) == 1

    @pytest.mark.asyncio
    async def test_edits_existing_message(self):
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
        )

        _daily_messages.clear()
        _daily_messages[(1, date.today())] = "EXISTING_MSG"

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["edit"].assert_called_once()
        mocks["send"].assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_user_not_in_group(self):
        from core.notifications.study_activity import update_study_activity

        async with _mock_update_context(group_info=None, entries=[]) as mocks:
            await update_study_activity(user_id=1, module_slug="test")

        mocks["send"].assert_not_called()
        mocks["gather"].assert_not_called()

    @pytest.mark.asyncio
    async def test_creates_new_message_when_edit_fails(self):
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
        )

        _daily_messages.clear()
        _daily_messages[(1, date.today())] = "DELETED_MSG"

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ) as mocks:
            mocks["edit"].return_value = False
            mocks["send"].return_value = "NEW_MSG_ID"
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["edit"].assert_called_once()
        mocks["send"].assert_called_once()
        assert _daily_messages[(1, date.today())] == "NEW_MSG_ID"

    @pytest.mark.asyncio
    async def test_prunes_old_entries_from_daily_messages(self):
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
        )

        _daily_messages.clear()
        old_date = date.today() - timedelta(days=3)
        _daily_messages[(1, old_date)] = "OLD_MSG"
        _daily_messages[(2, old_date)] = "OLD_MSG2"

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ):
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        assert (1, old_date) not in _daily_messages
        assert (2, old_date) not in _daily_messages
        assert (1, date.today()) in _daily_messages

    @pytest.mark.asyncio
    async def test_gathers_data_for_all_modules_in_course(self):
        """gather_group_study_data is called once per module slug."""
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
        )

        _daily_messages.clear()

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO,
            entries=[_SAMPLE_ENTRY],
            module_slugs=["mod-a", "mod-b", "mod-c"],
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="mod-b")

        assert mocks["gather"].call_count == 3
        called_slugs = [
            call.kwargs["module_slug"] for call in mocks["gather"].call_args_list
        ]
        assert called_slugs == ["mod-a", "mod-b", "mod-c"]

    @pytest.mark.asyncio
    async def test_early_bird_uses_per_entry_module_slug(self):
        """compute_early_bird_days receives the module slug from the entry."""
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
        )

        _daily_messages.clear()

        completed_entry = {
            **_SAMPLE_ENTRY,
            "module_completed": True,
            "_module_slug": "decision-theory",
        }

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO,
            entries=[completed_entry],
            module_slugs=["decision-theory"],
            early_bird_days=5,
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="decision-theory")

        mocks["early_bird"].assert_called_once()
        assert mocks["early_bird"].call_args.kwargs["module_slug"] == "decision-theory"

    @pytest.mark.asyncio
    async def test_sends_engagement_dm_to_user(self):
        """DM with engagement stats is sent when stats are available."""
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
            _daily_dm_messages,
        )

        _daily_messages.clear()
        _daily_dm_messages.clear()

        stats = [{"module_title": "Cognitive Superpowers", "time_spent_s": 2700, "ai_messages": 12}]

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO,
            entries=[_SAMPLE_ENTRY],
            engagement_stats=stats,
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["send_dm"].assert_called_once()
        dm_content = mocks["send_dm"].call_args[0][1]
        assert "Your study stats" in dm_content
        assert "Cognitive Superpowers" in dm_content
        assert ("111", date.today()) in _daily_dm_messages

    @pytest.mark.asyncio
    async def test_edits_existing_dm_on_retrigger(self):
        """Second trigger edits the existing DM rather than sending a new one."""
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
            _daily_dm_messages,
        )

        _daily_messages.clear()
        _daily_dm_messages.clear()
        _daily_dm_messages[("111", date.today())] = "EXISTING_DM"

        stats = [{"module_title": "Cognitive Superpowers", "time_spent_s": 3600, "ai_messages": 15}]

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO,
            entries=[_SAMPLE_ENTRY],
            engagement_stats=stats,
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["edit_dm"].assert_called_once()
        mocks["send_dm"].assert_not_called()

    @pytest.mark.asyncio
    async def test_dm_falls_back_to_send_when_edit_fails(self):
        """If editing the DM fails, a new DM is sent."""
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
            _daily_dm_messages,
        )

        _daily_messages.clear()
        _daily_dm_messages.clear()
        _daily_dm_messages[("111", date.today())] = "DELETED_DM"

        stats = [{"module_title": "Cognitive Superpowers", "time_spent_s": 600, "ai_messages": 3}]

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO,
            entries=[_SAMPLE_ENTRY],
            engagement_stats=stats,
        ) as mocks:
            mocks["edit_dm"].return_value = False
            mocks["send_dm"].return_value = "NEW_DM_ID"
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["edit_dm"].assert_called_once()
        mocks["send_dm"].assert_called_once()
        assert _daily_dm_messages[("111", date.today())] == "NEW_DM_ID"

    @pytest.mark.asyncio
    async def test_no_dm_sent_when_no_engagement_stats(self):
        """No DM is sent when engagement stats are empty."""
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_dm_messages,
            _daily_messages,
        )

        _daily_messages.clear()
        _daily_dm_messages.clear()

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO,
            entries=[_SAMPLE_ENTRY],
            engagement_stats=[],
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["send_dm"].assert_not_called()
        mocks["edit_dm"].assert_not_called()

    @pytest.mark.asyncio
    async def test_prunes_old_dm_messages(self):
        """Old DM message entries are pruned alongside channel messages."""
        from core.notifications.study_activity import (
            update_study_activity,
            _daily_messages,
            _daily_dm_messages,
        )

        _daily_messages.clear()
        _daily_dm_messages.clear()
        old_date = date.today() - timedelta(days=3)
        _daily_dm_messages[("111", old_date)] = "OLD_DM"

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO,
            entries=[_SAMPLE_ENTRY],
        ):
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        assert ("111", old_date) not in _daily_dm_messages


class TestRenderEngagementDm:
    def test_single_module_stats(self):
        from core.notifications.study_activity import render_engagement_dm

        stats = [{"module_title": "Cognitive Superpowers", "time_spent_s": 2700, "ai_messages": 12,
                   "sections_completed": 3, "sections_total": 8}]
        result = render_engagement_dm(stats)

        assert "Your study stats" in result
        assert "~45min" in result
        assert "12 messages" in result
        assert "3/8 sections" in result
        assert "Cognitive Superpowers" in result

    def test_multiple_modules(self):
        from core.notifications.study_activity import render_engagement_dm

        stats = [
            {"module_title": "Cognitive Superpowers", "time_spent_s": 2700, "ai_messages": 12,
             "sections_completed": 3, "sections_total": 8},
            {"module_title": "Decision Theory", "time_spent_s": 1200, "ai_messages": 5,
             "sections_completed": 2, "sections_total": 5},
        ]
        result = render_engagement_dm(stats)

        assert "Cognitive Superpowers" in result
        assert "Decision Theory" in result
        assert "~20min" in result
        assert "2/5 sections" in result

    def test_empty_stats_returns_none(self):
        from core.notifications.study_activity import render_engagement_dm

        result = render_engagement_dm([])
        assert result is None

    def test_time_formatting_hours(self):
        from core.notifications.study_activity import render_engagement_dm

        stats = [{"module_title": "Test", "time_spent_s": 5400, "ai_messages": 0}]
        result = render_engagement_dm(stats)
        assert "~1h 30min" in result

    def test_time_formatting_exact_hour(self):
        from core.notifications.study_activity import render_engagement_dm

        stats = [{"module_title": "Test", "time_spent_s": 3600, "ai_messages": 0}]
        result = render_engagement_dm(stats)
        assert "~1h" in result

    def test_time_formatting_very_short(self):
        from core.notifications.study_activity import render_engagement_dm

        stats = [{"module_title": "Test", "time_spent_s": 30, "ai_messages": 1}]
        result = render_engagement_dm(stats)
        assert "~1min" in result

    def test_includes_footer(self):
        from core.notifications.study_activity import render_engagement_dm

        stats = [{"module_title": "Test", "time_spent_s": 600, "ai_messages": 3}]
        result = render_engagement_dm(stats)
        assert "If anything looks off" in result


class TestFormatTime:
    def test_under_minute(self):
        from core.notifications.study_activity import _format_time
        assert _format_time(30) == "~1min"

    def test_minutes_only(self):
        from core.notifications.study_activity import _format_time
        assert _format_time(2700) == "~45min"

    def test_hours_and_minutes(self):
        from core.notifications.study_activity import _format_time
        assert _format_time(5400) == "~1h 30min"

    def test_exact_hours(self):
        from core.notifications.study_activity import _format_time
        assert _format_time(7200) == "~2h"


class TestGatherUserEngagementStats:
    @pytest.mark.asyncio
    async def test_returns_stats_for_active_modules(self):
        from core.notifications.study_activity import gather_user_engagement_stats

        section_ids = [UUID(int=1), UUID(int=2)]
        module_content_id = UUID(int=100)

        mock_conn = _mock_execute_results(
            # Time query result
            [
                {"content_id": UUID(int=1), "total_time": 1800},
                {"content_id": UUID(int=2), "total_time": 900},
            ],
            # Chat query result
            [
                {
                    "module_id": module_content_id,
                    "messages": [
                        {"role": "user", "content": "hi"},
                        {"role": "assistant", "content": "hello"},
                        {"role": "user", "content": "explain"},
                    ],
                },
            ],
        )

        result = await gather_user_engagement_stats(
            mock_conn,
            user_id=1,
            module_infos=[{
                "title": "Cognitive Superpowers",
                "content_id": module_content_id,
                "section_content_ids": section_ids,
            }],
        )

        assert len(result) == 1
        assert result[0]["module_title"] == "Cognitive Superpowers"
        assert result[0]["time_spent_s"] == 2700
        assert result[0]["ai_messages"] == 2

    @pytest.mark.asyncio
    async def test_excludes_modules_with_zero_activity(self):
        from core.notifications.study_activity import gather_user_engagement_stats

        mock_conn = _mock_execute_results(
            [],  # No time data
            [],  # No chat data
        )

        result = await gather_user_engagement_stats(
            mock_conn,
            user_id=1,
            module_infos=[{
                "title": "Empty Module",
                "content_id": UUID(int=200),
                "section_content_ids": [UUID(int=10)],
            }],
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_empty_module_infos(self):
        from core.notifications.study_activity import gather_user_engagement_stats

        mock_conn = AsyncMock()
        result = await gather_user_engagement_stats(
            mock_conn, user_id=1, module_infos=[],
        )

        assert result == []
        mock_conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_multiple_modules(self):
        from core.notifications.study_activity import gather_user_engagement_stats

        mod_a_id = UUID(int=100)
        mod_b_id = UUID(int=200)

        mock_conn = _mock_execute_results(
            # Time query: sections from both modules
            [
                {"content_id": UUID(int=1), "total_time": 600},
                {"content_id": UUID(int=3), "total_time": 1200},
            ],
            # Chat query: only module A has messages
            [
                {
                    "module_id": mod_a_id,
                    "messages": [
                        {"role": "user", "content": "q1"},
                        {"role": "assistant", "content": "a1"},
                    ],
                },
            ],
        )

        result = await gather_user_engagement_stats(
            mock_conn,
            user_id=1,
            module_infos=[
                {
                    "title": "Module A",
                    "content_id": mod_a_id,
                    "section_content_ids": [UUID(int=1), UUID(int=2)],
                },
                {
                    "title": "Module B",
                    "content_id": mod_b_id,
                    "section_content_ids": [UUID(int=3), UUID(int=4)],
                },
            ],
        )

        assert len(result) == 2
        mod_a = next(r for r in result if r["module_title"] == "Module A")
        mod_b = next(r for r in result if r["module_title"] == "Module B")
        assert mod_a["time_spent_s"] == 600
        assert mod_a["ai_messages"] == 1
        assert mod_b["time_spent_s"] == 1200
        assert mod_b["ai_messages"] == 0
