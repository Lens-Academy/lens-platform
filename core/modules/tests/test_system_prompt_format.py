# core/modules/tests/test_system_prompt_format.py
"""Golden-file tests for build_course_overview output format."""

from unittest.mock import patch
from uuid import uuid4

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
    "Introduction to AI Safety",
    [
        {
            "meta": {"title": "The Alignment Problem"},
            "tldr": "Why aligning AI with human values is hard",
            "contentId": SECTION_A1_ID,
        },
        {
            "meta": {"title": "Risks from AI"},
            "tldr": "Overview of catastrophic and existential risks",
            "contentId": SECTION_A2_ID,
        },
    ],
)

MOD_B = _make_module(
    "mod-b",
    "Advanced Topics",
    [
        {
            "meta": {"title": "Deceptive Alignment"},
            "tldr": "When AI systems appear aligned but aren't",
            "contentId": SECTION_B1_ID,
        },
    ],
)


def _mock_load(slug):
    modules = {"mod-a": MOD_A, "mod-b": MOD_B}
    if slug not in modules:
        from core.modules import ModuleNotFoundError

        raise ModuleNotFoundError(slug)
    return modules[slug]


class TestBuildCourseOverviewFormat:
    """Golden-file tests asserting the exact expected markdown output."""

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_golden_basic_no_status(self, _mock):
        """No completions, current is mod-a section 0 — check complete output."""
        course = ParsedCourse(
            slug="intro-ais",
            title="Intro to AI Safety",
            progression=[
                ModuleRef(slug="mod-a"),
                ModuleRef(slug="mod-b", optional=True),
            ],
        )
        result = build_course_overview(course, "mod-a", 0, set())
        expected = (
            "The course contains lenses (articles, videos, discussions) organized into modules. "
            "The student can navigate between them.\n"
            "\n"
            "## Introduction to AI Safety\n"
            "\n"
            "- **The Alignment Problem** ← you are here\n"
            "  TLDR: Why aligning AI with human values is hard\n"
            "- **Risks from AI**\n"
            "  TLDR: Overview of catastrophic and existential risks\n"
            "\n"
            "## Advanced Topics (optional)\n"
            "\n"
            "- **Deceptive Alignment**\n"
            "  TLDR: When AI systems appear aligned but aren't\n"
        )
        assert result == expected

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_golden_with_completed_and_current(self, _mock):
        """Section A1 completed, current is mod-a section 1."""
        course = ParsedCourse(
            slug="intro-ais",
            title="Intro to AI Safety",
            progression=[
                ModuleRef(slug="mod-a"),
                ModuleRef(slug="mod-b", optional=True),
            ],
        )
        result = build_course_overview(course, "mod-a", 1, {SECTION_A1_ID})
        expected = (
            "The course contains lenses (articles, videos, discussions) organized into modules. "
            "The student can navigate between them.\n"
            "\n"
            "## Introduction to AI Safety\n"
            "\n"
            "- **The Alignment Problem** ✓\n"
            "  TLDR: Why aligning AI with human values is hard\n"
            "- **Risks from AI** ← you are here\n"
            "  TLDR: Overview of catastrophic and existential risks\n"
            "\n"
            "## Advanced Topics (optional)\n"
            "\n"
            "- **Deceptive Alignment**\n"
            "  TLDR: When AI systems appear aligned but aren't\n"
        )
        assert result == expected

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_golden_with_meeting_marker(self, _mock):
        """Meeting marker between modules renders as --- Name ---."""
        course = ParsedCourse(
            slug="intro-ais",
            title="Intro to AI Safety",
            progression=[
                ModuleRef(slug="mod-a"),
                MeetingMarker(name="Week 1 Discussion"),
                ModuleRef(slug="mod-b"),
            ],
        )
        result = build_course_overview(course, "mod-a", 0, set())
        expected = (
            "The course contains lenses (articles, videos, discussions) organized into modules. "
            "The student can navigate between them.\n"
            "\n"
            "## Introduction to AI Safety\n"
            "\n"
            "- **The Alignment Problem** ← you are here\n"
            "  TLDR: Why aligning AI with human values is hard\n"
            "- **Risks from AI**\n"
            "  TLDR: Overview of catastrophic and existential risks\n"
            "\n"
            "--- Week 1 Discussion ---\n"
            "\n"
            "## Advanced Topics\n"
            "\n"
            "- **Deceptive Alignment**\n"
            "  TLDR: When AI systems appear aligned but aren't\n"
        )
        assert result == expected

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_golden_unavailable_module(self, _mock):
        """Unavailable module renders as ## slug (unavailable) with empty body."""
        course = ParsedCourse(
            slug="test",
            title="Test Course",
            progression=[
                ModuleRef(slug="mod-a"),
                ModuleRef(slug="nonexistent"),
            ],
        )
        result = build_course_overview(course, "mod-a", 0, set())
        expected = (
            "The course contains lenses (articles, videos, discussions) organized into modules. "
            "The student can navigate between them.\n"
            "\n"
            "## Introduction to AI Safety\n"
            "\n"
            "- **The Alignment Problem** ← you are here\n"
            "  TLDR: Why aligning AI with human values is hard\n"
            "- **Risks from AI**\n"
            "  TLDR: Overview of catastrophic and existential risks\n"
            "\n"
            "## nonexistent (unavailable)\n"
        )
        assert result == expected

    @patch("core.modules.loader.load_flattened_module", side_effect=_mock_load)
    def test_golden_section_without_tldr(self, _mock):
        """Section with no TLDR omits the TLDR line entirely."""
        mod = _make_module(
            "mod-x",
            "Module X",
            [
                {"meta": {"title": "No TLDR Section"}, "tldr": "", "contentId": str(uuid4())},
            ],
        )

        def mock_load_x(slug):
            if slug == "mod-x":
                return mod
            raise Exception("not found")

        course = ParsedCourse(
            slug="test",
            title="Test",
            progression=[ModuleRef(slug="mod-x")],
        )
        with patch("core.modules.loader.load_flattened_module", side_effect=mock_load_x):
            result = build_course_overview(course, "mod-x", 0, set())

        expected = (
            "The course contains lenses (articles, videos, discussions) organized into modules. "
            "The student can navigate between them.\n"
            "\n"
            "## Module X\n"
            "\n"
            "- **No TLDR Section** ← you are here\n"
        )
        assert result == expected
