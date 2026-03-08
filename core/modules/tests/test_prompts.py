# core/modules/tests/test_prompts.py
"""Tests for shared prompt assembly."""

from core.modules.context import SectionContext
from core.modules.prompts import assemble_chat_prompt, DEFAULT_BASE_PROMPT


class TestAssembleChatPrompt:
    def test_base_only(self):
        result = assemble_chat_prompt("Base prompt")
        assert result == "Base prompt"

    def test_with_instructions(self):
        result = assemble_chat_prompt("Base", instructions="Do this thing")
        assert result == "Base\n\nInstructions:\nDo this thing"

    def test_with_context(self):
        result = assemble_chat_prompt("Base", context="Some content")
        assert result == (
            "Base\n\nThe user previously read this content:\n---\nSome content\n---"
        )

    def test_with_both(self):
        result = assemble_chat_prompt(
            "Base", instructions="Do this", context="Content here"
        )
        assert "Instructions:\nDo this" in result
        assert "---\nContent here\n---" in result
        assert result.index("Instructions") < result.index("Content here")

    def test_empty_instructions_skipped(self):
        result = assemble_chat_prompt("Base", instructions="")
        assert result == "Base"

    def test_empty_context_skipped(self):
        result = assemble_chat_prompt("Base", context="")
        assert result == "Base"

    def test_none_instructions_skipped(self):
        result = assemble_chat_prompt("Base", instructions=None)
        assert result == "Base"

    def test_none_context_skipped(self):
        result = assemble_chat_prompt("Base", context=None)
        assert result == "Base"


class TestNumberedSegments:
    def test_renders_numbered_segments(self):
        ctx = SectionContext(
            segments=[(0, "[Written by Lens Academy]\nIntro text"), (1, "Article content")],
            segment_index=1,
            total_segments=3,
        )
        result = assemble_chat_prompt("Base", context=ctx)
        assert "Segment 1:\n[Written by Lens Academy]\nIntro text" in result
        assert "Segment 2:\nArticle content" in result

    def test_position_line_mid_section(self):
        ctx = SectionContext(
            segments=[(0, "Text"), (1, "More text"), (2, "[Chat discussion]")],
            segment_index=1,
            total_segments=3,
        )
        result = assemble_chat_prompt("Base", context=ctx)
        assert "currently at segment 2" in result
        assert "not read segments 3\u20133 yet" in result

    def test_position_line_last_segment(self):
        ctx = SectionContext(
            segments=[(0, "Text"), (1, "[Chat discussion]")],
            segment_index=1,
            total_segments=2,
        )
        result = assemble_chat_prompt("Base", context=ctx)
        assert "currently at segment 2 (the last segment)" in result

    def test_position_line_first_segment(self):
        ctx = SectionContext(
            segments=[(0, "First content"), (1, "[Chat discussion]")],
            segment_index=0,
            total_segments=2,
        )
        result = assemble_chat_prompt("Base", context=ctx)
        assert "currently at segment 1" in result
        assert "not read segments 2\u20132 yet" in result


class TestSectionContextBreadcrumb:
    def test_module_and_section(self):
        ctx = SectionContext(
            segments=[(0, "content")],
            segment_index=0,
            total_segments=1,
            module_title="Intro to AI Safety",
            section_title="The Alignment Problem",
        )
        result = assemble_chat_prompt("Base", context=ctx)
        assert "Intro to AI Safety > The Alignment Problem" in result

    def test_no_metadata_no_breadcrumb(self):
        ctx = SectionContext(
            segments=[(0, "content")],
            segment_index=0,
            total_segments=1,
        )
        result = assemble_chat_prompt("Base", context=ctx)
        assert "Current location" not in result

    def test_empty_segments_no_content_block(self):
        ctx = SectionContext(segments=[], segment_index=0, total_segments=1)
        result = assemble_chat_prompt("Base", context=ctx)
        assert "engaging with" not in result


class TestDefaultBasePrompt:
    def test_contains_tutor(self):
        assert "tutor" in DEFAULT_BASE_PROMPT

    def test_contains_ai_safety(self):
        assert "AI safety" in DEFAULT_BASE_PROMPT
