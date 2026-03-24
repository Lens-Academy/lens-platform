# core/modules/tests/test_course_overview.py
"""Tests for build_course_overview."""

from unittest.mock import patch
from uuid import uuid4

import pytest

from core.modules.flattened_types import (
    FlattenedModule,
    MeetingMarker,
    ModuleRef,
    ParsedCourse,
)
from core.modules.prompts import build_course_overview


def _make_module(slug, title, sections):
    return FlattenedModule(slug=slug, title=title, content_id=None, sections=sections)


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


SECTION_A1_ID = str(uuid4())
SECTION_A2_ID = str(uuid4())
SECTION_B1_ID = str(uuid4())

MOD_A = _make_module(
    "mod-a",
    "Module A",
    [
        {"meta": {"title": "Section A1"}, "tldr": "First topic", "contentId": SECTION_A1_ID},
        {"meta": {"title": "Section A2"}, "tldr": "Second topic", "contentId": SECTION_A2_ID},
    ],
)

MOD_B = _make_module(
    "mod-b",
    "Module B",
    [
        {"meta": {"title": "Section B1"}, "tldr": "Third topic", "contentId": SECTION_B1_ID},
    ],
)


def _mock_load(slug):
    modules = {"mod-a": MOD_A, "mod-b": MOD_B}
    if slug not in modules:
        from core.modules import ModuleNotFoundError

        raise ModuleNotFoundError(slug)
    return modules[slug]


class TestCourseOverview:
    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_includes_course_title(self, _mock, simple_course):
        result = build_course_overview(simple_course, "mod-a", 0, set())
        assert "Course Overview: Intro to AI Safety" in result

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_includes_section_tldrs(self, _mock, simple_course):
        result = build_course_overview(simple_course, "mod-a", 0, set())
        assert "First topic" in result
        assert "Second topic" in result

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_marks_current_module_and_section(self, _mock, simple_course):
        result = build_course_overview(simple_course, "mod-a", 1, set())
        assert "CURRENT:" in result
        assert "Module A" in result
        assert "you are here" in result
        # Section A2 (index 1) should be marked
        lines = result.split("\n")
        a2_line = [l for l in lines if "Section A2" in l][0]
        assert "you are here" in a2_line
        # Section A1 should NOT be marked as current
        a1_line = [l for l in lines if "Section A1" in l][0]
        assert "you are here" not in a1_line

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_marks_completed_sections(self, _mock, simple_course):
        completed = {SECTION_A1_ID}
        result = build_course_overview(simple_course, "mod-b", 0, completed)
        lines = result.split("\n")
        a1_line = [l for l in lines if "Section A1" in l][0]
        assert "\u2713" in a1_line  # checkmark

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_includes_meeting_markers(self, _mock, course_with_meeting):
        result = build_course_overview(course_with_meeting, "mod-a", 0, set())
        assert "--- Week 1 Discussion ---" in result

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_handles_missing_module(self, _mock):
        course = ParsedCourse(
            slug="test",
            title="Test Course",
            progression=[ModuleRef(slug="nonexistent")],
        )
        result = build_course_overview(course, "nonexistent", 0, set())
        assert "nonexistent" in result
        assert "unavailable" in result

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_optional_module_marked(self, _mock, simple_course):
        result = build_course_overview(simple_course, "mod-a", 0, set())
        lines = result.split("\n")
        mod_b_line = [l for l in lines if "Module B" in l][0]
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
