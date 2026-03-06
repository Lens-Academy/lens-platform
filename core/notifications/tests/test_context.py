"""Tests for notification context building.

Two levels:
- build_reminder_context with real content cache (no DB, no mocks)
- get_meeting_with_group / get_active_member_ids (mock DB at boundary)
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import (
    FlattenedModule,
    ModuleRef,
    MeetingMarker,
    ParsedCourse,
)
from core.notifications.context import build_reminder_context
from core.notifications.urls import build_course_url, build_module_url


# =============================================================================
# Fixtures
# =============================================================================


def _make_cache(course_slug="default", modules=None, progression=None):
    """Build a minimal ContentCache with course and modules.

    Args:
        course_slug: Course slug.
        modules: Dict of slug -> FlattenedModule.
        progression: List of ModuleRef/MeetingMarker. If None, auto-builds
                     from modules with a single meeting at the end.
    """
    if modules is None:
        modules = {}
    if progression is None:
        progression = [ModuleRef(slug=s) for s in modules] + [MeetingMarker(number=1)]

    cache = ContentCache(
        courses={
            course_slug: ParsedCourse(
                slug=course_slug,
                title="Test Course",
                progression=progression,
            )
        },
        flattened_modules=modules,
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(timezone.utc),
    )
    set_cache(cache)
    return cache


def _make_module(slug, section_titles, optional_titles=None):
    """Build a FlattenedModule with named sections."""
    sections = []
    for title in section_titles:
        sections.append(
            {
                "type": "lens-article",
                "contentId": str(uuid4()),
                "meta": {"title": title, "author": None, "sourceUrl": None, "published": None},
                "optional": False,
            }
        )
    for title in optional_titles or []:
        sections.append(
            {
                "type": "lens-article",
                "contentId": str(uuid4()),
                "meta": {"title": title, "author": None, "sourceUrl": None, "published": None},
                "optional": True,
            }
        )
    return FlattenedModule(slug=slug, title=slug.replace("-", " ").title(), content_id=uuid4(), sections=sections)


MEETING = {
    "scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc),
    "meeting_number": 1,
}
GROUP = {
    "group_name": "Curious Capybaras",
    "discord_text_channel_id": "123456789",
    "course_slug": "default",
}


# =============================================================================
# build_reminder_context — with real content cache
# =============================================================================


class TestBuildReminderContext:
    """Tests use a real ContentCache — no mocks for course/module logic."""

    def teardown_method(self):
        clear_cache()

    def test_links_to_specific_module(self):
        """module_url should point to the due module, not /course."""
        mod = _make_module("feedback-loops", ["Introduction", "Core Concepts"])
        _make_cache(modules={"feedback-loops": mod})

        context = build_reminder_context(MEETING, GROUP)

        assert context["module_url"] == build_module_url("default", "feedback-loops")
        assert "/course" not in context["module_url"] or "/course/default/module/" in context["module_url"]

    def test_section_titles_in_module_list(self):
        """module_list should contain real section titles from the module."""
        mod = _make_module("feedback-loops", ["Introduction", "Core Concepts", "Summary"])
        _make_cache(modules={"feedback-loops": mod})

        context = build_reminder_context(MEETING, GROUP)

        assert "- Introduction" in context["module_list"]
        assert "- Core Concepts" in context["module_list"]
        assert "- Summary" in context["module_list"]

    def test_modules_remaining_is_section_count(self):
        """modules_remaining should be the number of non-optional sections."""
        mod = _make_module(
            "feedback-loops",
            ["Introduction", "Core Concepts"],
            optional_titles=["Bonus Material"],
        )
        _make_cache(modules={"feedback-loops": mod})

        context = build_reminder_context(MEETING, GROUP)

        assert context["modules_remaining"] == "2"

    def test_optional_sections_excluded_from_list(self):
        """Optional sections should not appear in module_list."""
        mod = _make_module(
            "feedback-loops",
            ["Introduction"],
            optional_titles=["Optional Deep Dive"],
        )
        _make_cache(modules={"feedback-loops": mod})

        context = build_reminder_context(MEETING, GROUP)

        assert "Optional Deep Dive" not in context["module_list"]
        assert "- Introduction" in context["module_list"]

    def test_links_to_last_due_module(self):
        """When multiple modules are due, link to the last one."""
        mod_a = _make_module("intro", ["Welcome"])
        mod_b = _make_module("deep-dive", ["Analysis", "Discussion"])
        _make_cache(
            modules={"intro": mod_a, "deep-dive": mod_b},
            progression=[
                ModuleRef(slug="intro"),
                ModuleRef(slug="deep-dive"),
                MeetingMarker(number=1),
            ],
        )

        context = build_reminder_context(MEETING, GROUP)

        assert context["module_url"] == build_module_url("default", "deep-dive")

    def test_collects_sections_across_modules_due_at_same_meeting(self):
        """module_list should include sections from all modules due AT this meeting."""
        mod_a = _make_module("intro", ["Welcome"])
        mod_b = _make_module("deep-dive", ["Analysis"])
        _make_cache(
            modules={"intro": mod_a, "deep-dive": mod_b},
            progression=[
                ModuleRef(slug="intro"),
                ModuleRef(slug="deep-dive"),
                MeetingMarker(number=1),
            ],
        )

        context = build_reminder_context(MEETING, GROUP)

        assert "- Welcome" in context["module_list"]
        assert "- Analysis" in context["module_list"]
        assert context["modules_remaining"] == "2"

    def test_only_includes_modules_due_at_this_meeting(self):
        """Modules due at meeting 2 should not appear in meeting 1 reminder."""
        mod_a = _make_module("intro", ["Welcome"])
        mod_b = _make_module("advanced", ["Hard Stuff"])
        _make_cache(
            modules={"intro": mod_a, "advanced": mod_b},
            progression=[
                ModuleRef(slug="intro"),
                MeetingMarker(number=1),
                ModuleRef(slug="advanced"),
                MeetingMarker(number=2),
            ],
        )

        context = build_reminder_context(MEETING, GROUP)

        assert "- Welcome" in context["module_list"]
        assert "Hard Stuff" not in context["module_list"]
        assert context["module_url"] == build_module_url("default", "intro")

    def test_prior_meeting_modules_excluded(self):
        """Modules from earlier meetings should not appear in later meeting reminders."""
        mod_a = _make_module("intro", ["Welcome"])
        mod_b = _make_module("advanced", ["Hard Stuff"])
        _make_cache(
            modules={"intro": mod_a, "advanced": mod_b},
            progression=[
                ModuleRef(slug="intro"),
                MeetingMarker(number=1),
                ModuleRef(slug="advanced"),
                MeetingMarker(number=2),
            ],
        )

        meeting_2 = {**MEETING, "meeting_number": 2}
        context = build_reminder_context(meeting_2, GROUP)

        assert "Welcome" not in context["module_list"]
        assert "- Hard Stuff" in context["module_list"]
        assert context["module_url"] == build_module_url("default", "advanced")

    def test_falls_back_without_course_slug(self):
        """Without course_slug, should fall back to generic course URL."""
        group_no_course = {**GROUP, "course_slug": None}

        context = build_reminder_context(MEETING, group_no_course)

        assert context["module_url"] == build_course_url()

    def test_falls_back_without_meeting_number(self):
        """Without meeting_number, should fall back to generic course URL."""
        meeting_no_number = {"scheduled_at": MEETING["scheduled_at"]}

        context = build_reminder_context(meeting_no_number, GROUP)

        assert context["module_url"] == build_course_url()

    def test_falls_back_when_cache_not_initialized(self):
        """Should gracefully fall back if content cache isn't available."""
        clear_cache()

        context = build_reminder_context(MEETING, GROUP)

        assert context["module_url"] == build_course_url()
        assert "module_list" in context

    def test_cta_text_includes_section_and_module(self):
        """CTA should read: Read '<first section>' of '<module title>' now."""
        mod = _make_module("feedback-loops", ["Introduction", "Core Concepts"])
        _make_cache(modules={"feedback-loops": mod})

        context = build_reminder_context(MEETING, GROUP)

        assert context["cta_text"] == "Read 'Introduction' from 'Feedback Loops' now"

    def test_cta_falls_back_without_module_data(self):
        """Without module resolution, CTA should fall back to generic text."""
        clear_cache()

        context = build_reminder_context(MEETING, GROUP)

        assert context["cta_text"] == "Continue where you left off"

    def test_always_includes_base_fields(self):
        """All required template fields should be present regardless of module resolution."""
        mod = _make_module("feedback-loops", ["Intro"])
        _make_cache(modules={"feedback-loops": mod})

        context = build_reminder_context(MEETING, GROUP)

        assert context["group_name"] == "Curious Capybaras"
        assert context["meeting_time_utc"] == "2026-02-10T17:00:00+00:00"
        assert "Tuesday" in context["meeting_time"]
        assert "UTC" in context["meeting_time"]
        assert "123456789" in context["discord_channel_url"]
        assert "cta_text" in context


# =============================================================================
# Data fetching tests (mock DB at boundary)
# =============================================================================


class TestGetMeetingWithGroup:
    """Test get_meeting_with_group() async function."""

    @pytest.mark.asyncio
    async def test_returns_meeting_and_group(self):
        """Should return tuple of (meeting, group) when meeting exists."""
        from core.notifications.context import get_meeting_with_group

        mock_conn = AsyncMock()

        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "meeting_id": 42,
            "group_id": 10,
            "scheduled_at": datetime(2026, 2, 10, 17, 0, tzinfo=timezone.utc),
            "meeting_number": 3,
            "group_name": "Curious Capybaras",
            "discord_text_channel_id": "123456789",
            "course_slug": "default",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.notifications.context.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await get_meeting_with_group(meeting_id=42)

        assert result is not None
        meeting, group = result
        assert meeting["meeting_id"] == 42
        assert meeting["meeting_number"] == 3
        assert group["group_name"] == "Curious Capybaras"
        assert group["discord_text_channel_id"] == "123456789"
        assert group["course_slug"] == "default"

    @pytest.mark.asyncio
    async def test_returns_none_for_missing_meeting(self):
        """Should return None when meeting doesn't exist."""
        from core.notifications.context import get_meeting_with_group

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_result)

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

        with patch("core.notifications.context.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            user_ids = await get_active_member_ids(group_id=10)

        assert user_ids == []
