# core/modules/tests/test_course_overview.py
"""Tests for build_course_overview."""

from datetime import datetime
from uuid import uuid4

import pytest

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import (
    FlattenedModule,
    MeetingMarker,
    ModuleRef,
    ParsedCourse,
)
from core.modules.prompts import build_course_overview


def _make_module(slug, title, sections):
    return FlattenedModule(slug=slug, title=title, content_id=None, sections=sections)


SECTION_A1_ID = str(uuid4())
SECTION_A2_ID = str(uuid4())
SECTION_B1_ID = str(uuid4())

MOD_A = _make_module(
    "mod-a",
    "Module A",
    [
        {
            "meta": {"title": "Section A1"},
            "tldr": "First topic",
            "contentId": SECTION_A1_ID,
        },
        {
            "meta": {"title": "Section A2"},
            "tldr": "Second topic",
            "contentId": SECTION_A2_ID,
        },
    ],
)

MOD_B = _make_module(
    "mod-b",
    "Module B",
    [
        {
            "meta": {"title": "Section B1"},
            "tldr": "Third topic",
            "contentId": SECTION_B1_ID,
        },
    ],
)


@pytest.fixture()
def simple_course():
    return ParsedCourse(
        slug="intro-ais",
        title="Intro to AI Safety",
        progression=[
            ModuleRef(slug="mod-a"),
            ModuleRef(slug="mod-b", optional=True),
        ],
    )


@pytest.fixture()
def course_with_meeting():
    return ParsedCourse(
        slug="intro-ais",
        title="Intro to AI Safety",
        progression=[
            ModuleRef(slug="mod-a"),
            MeetingMarker(name="Week 1 Discussion"),
            ModuleRef(slug="mod-b"),
        ],
    )


@pytest.fixture(autouse=True)
def _cache():
    cache = ContentCache(
        courses={},
        flattened_modules={"mod-a": MOD_A, "mod-b": MOD_B},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    yield
    clear_cache()


class TestCourseOverview:
    def test_includes_module_titles_and_intro(self, simple_course):
        result = build_course_overview(simple_course)
        assert "Module A/" in result

    def test_includes_section_tldrs(self, simple_course):
        result = build_course_overview(simple_course)
        assert "First topic" in result
        assert "Second topic" in result

    def test_no_user_specific_markers(self, simple_course):
        result = build_course_overview(simple_course)
        assert "✓" not in result
        assert "you are here" not in result

    def test_meeting_creates_unit_boundary(self, course_with_meeting):
        result = build_course_overview(course_with_meeting)
        assert "--- Unit 1 ---" in result
        assert "--- Unit 2 ---" in result

    def test_handles_missing_module(self):
        course = ParsedCourse(
            slug="test",
            title="Test Course",
            progression=[ModuleRef(slug="nonexistent")],
        )
        result = build_course_overview(course)
        assert "nonexistent" in result
        assert "unavailable" in result

    def test_optional_module_marked(self, simple_course):
        result = build_course_overview(simple_course)
        lines = result.split("\n")
        mod_b_line = [line for line in lines if "Module B" in line][0]
        assert "(optional)" in mod_b_line

    @patch("core.modules.loader.load_flattened_module")
    def test_prefers_summary_for_tutor_over_tldr(self, mock_load):
        mod = _make_module(
            "mod-x",
            "Module X",
            [
                {
                    "meta": {"title": "Section X1"},
                    "tldr": "Hooky marketing text",
                    "summaryForTutor": "Dry informative summary",
                    "contentId": str(uuid4()),
                },
            ],
        )
        mock_load.return_value = mod
        course = ParsedCourse(
            slug="test",
            title="Test",
            progression=[ModuleRef(slug="mod-x")],
        )
        result = build_course_overview(course, "mod-x", 0, set())
        assert "Dry informative summary" in result
        assert "Hooky marketing text" not in result
