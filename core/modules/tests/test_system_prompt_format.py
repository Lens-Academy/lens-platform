# core/modules/tests/test_system_prompt_format.py
"""Golden-file tests for build_course_overview and assemble_chat_prompt output format."""

from unittest.mock import patch
from uuid import uuid4

from core.modules.context import SectionContext
from core.modules.flattened_types import (
    FlattenedModule,
    MeetingMarker,
    ModuleRef,
    ParsedCourse,
)
from core.modules.prompts import assemble_chat_prompt, build_course_overview


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


class TestAssembleChatPromptFormat:
    """Golden-file tests for assemble_chat_prompt markdown header format."""

    def test_full_prompt_with_instructions_and_context(self):
        """Both instructions and context present — verify headers and order."""
        ctx = SectionContext(
            segments=[(0, "Article content here")],
            segment_index=0,
            total_segments=1,
            module_title="Intro to AI Safety",
            section_title="The Alignment Problem",
        )
        result = assemble_chat_prompt(
            "You are a tutor.",
            instructions="Ask the student what they think about X.\nDo not give away the answer.",
            context=ctx,
        )
        expected = (
            "You are a tutor.\n"
            "\n"
            "# Instructions\n"
            "\n"
            "Ask the student what they think about X.\n"
            "Do not give away the answer.\n"
            "\n"
            "# Current Context\n"
            "\n"
            "Current location: Intro to AI Safety > The Alignment Problem\n"
            "\n"
            "The user is engaging with the following content:\n"
            "\n"
            "Segment 1:\n"
            "Article content here\n"
            "\n"
            "The user is currently at segment 1 (the last segment)."
        )
        assert result == expected
        # Instructions must come before context
        assert result.index("# Instructions") < result.index("# Current Context")

    def test_instructions_only_no_context(self):
        """Instructions present, no context — # Instructions present, # Current Context absent."""
        result = assemble_chat_prompt(
            "You are a tutor.",
            instructions="Be concise.",
        )
        assert "# Instructions\n\nBe concise." in result
        assert "# Current Context" not in result

    def test_context_only_no_instructions(self):
        """Context present, no instructions — # Current Context present, # Instructions absent."""
        ctx = SectionContext(
            segments=[(0, "Some content")],
            segment_index=0,
            total_segments=1,
            module_title="Module A",
            section_title="Section 1",
        )
        result = assemble_chat_prompt("You are a tutor.", context=ctx)
        assert "# Current Context" in result
        assert "# Instructions" not in result
