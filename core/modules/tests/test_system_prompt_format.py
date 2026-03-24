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


class TestFullSystemPromptFormat:
    """Golden-file tests for _build_system_prompt output format."""

    def _make_chat_stage(self, instructions="Be helpful.", hide=False):
        from core.modules.types import ChatStage

        return ChatStage(
            type="chat",
            instructions=instructions,
            hide_previous_content_from_tutor=hide,
        )

    def _make_article_stage(self):
        from core.modules.types import ArticleStage

        return ArticleStage(type="article", source="some/article.md")

    def test_chat_stage_with_overview_and_context(self):
        """Section order: Role, Instructions, Course Overview, Current Context."""
        from core.modules.chat import _build_system_prompt

        ctx = SectionContext(
            segments=[(0, "Some content")],
            segment_index=0,
            total_segments=1,
            module_title="Intro to AI Safety",
            section_title="The Alignment Problem",
        )
        stage = self._make_chat_stage(instructions="Ask the student what they think.")
        overview = "The course contains lenses...\n\n## Module A\n\n- **Section 1**\n"
        result = _build_system_prompt(stage, None, ctx, course_overview=overview)

        # Role header must come first
        assert result.startswith("# Role\n\n")
        # All four sections present
        assert "# Role" in result
        assert "# Instructions" in result
        assert "# Course Overview" in result
        assert "# Current Context" in result
        # Correct ordering
        role_pos = result.index("# Role")
        instructions_pos = result.index("# Instructions")
        overview_pos = result.index("# Course Overview")
        context_pos = result.index("# Current Context")
        assert role_pos < instructions_pos < overview_pos < context_pos
        # Overview content present
        assert "The course contains lenses..." in result

    def test_chat_stage_no_overview(self):
        """Role present, no Course Overview section when overview not provided."""
        from core.modules.chat import _build_system_prompt

        ctx = SectionContext(
            segments=[(0, "Content")],
            segment_index=0,
            total_segments=1,
            module_title="Module A",
            section_title="Section 1",
        )
        stage = self._make_chat_stage()
        result = _build_system_prompt(stage, None, ctx)

        assert result.startswith("# Role\n\n")
        assert "# Course Overview" not in result
        assert "# Instructions" in result
        assert "# Current Context" in result

    def test_article_stage_with_overview(self):
        """Role present, reading an article text, Course Overview present."""
        from core.modules.chat import _build_system_prompt

        stage = self._make_article_stage()
        overview = "The course contains lenses...\n\n## Module A\n\n- **Section 1**\n"
        result = _build_system_prompt(stage, "Article body text.", None, course_overview=overview)

        assert result.startswith("# Role\n\n")
        assert "reading an article" in result
        assert "# Course Overview" in result
        assert "The course contains lenses..." in result
        # Article body present
        assert "Article body text." in result


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
