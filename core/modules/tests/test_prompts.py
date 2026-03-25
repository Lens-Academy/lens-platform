# core/modules/tests/test_prompts.py
"""Tests for shared prompt assembly."""

from core.modules.context import SectionContext
from core.modules.prompts import (
    assemble_chat_prompt,
    build_content_context_message,
    build_location_update_message,
    DEFAULT_BASE_PROMPT,
)


class TestAssembleChatPrompt:
    """Tests for the plain-string assemble_chat_prompt (used by promptlab)."""

    def test_base_only(self):
        result = assemble_chat_prompt("Base prompt")
        assert result == "Base prompt"

    def test_with_instructions(self):
        result = assemble_chat_prompt("Base", instructions="Do this thing")
        assert result == "Base\n\n# Current Instructions\n\nDo this thing"

    def test_with_context(self):
        result = assemble_chat_prompt("Base", context="Some content")
        assert result == (
            "Base\n\n# User's Current Location\n\n"
            "The user previously read this content:\n---\nSome content\n---"
        )

    def test_with_both(self):
        result = assemble_chat_prompt(
            "Base", instructions="Do this", context="Content here"
        )
        assert "# Current Instructions\n\nDo this" in result
        assert "---\nContent here\n---" in result
        assert result.index("# Current Instructions") < result.index("Content here")

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


class TestBuildContentContextMessage:
    """Tests for content context message formatting (conversation history injection)."""

    def test_renders_segments_in_lens_tag(self):
        ctx = SectionContext(
            segments=[
                (0, "text", "<source>Lens Academy</source>\nIntro text"),
                (1, "article-excerpt", "Article content"),
            ],
            segment_index=1,
            total_segments=3,
            module_title="Threat Models",
            section_title="Risks from AI",
        )
        result = build_content_context_message(ctx)
        assert (
            '<lens module_title="Threat Models" lens_title="Risks from AI">' in result
        )
        assert '<segment index="1" type="text">' in result
        assert "<source>Lens Academy</source>\nIntro text" in result
        assert "</segment>" in result
        assert '<segment index="2" type="article-excerpt">' in result
        assert "Article content" in result
        assert "</lens>" in result

    def test_location_marker(self):
        ctx = SectionContext(
            segments=[
                (0, "text", "Text"),
                (1, "article-excerpt", "More text"),
                (2, "chat", "<source>Chat discussion</source>"),
            ],
            segment_index=1,
            total_segments=3,
            section_title="Risks from AI",
        )
        result = build_content_context_message(ctx)
        assert (
            '<student-position>Segment 2 of "Risks from AI"</student-position>'
            in result
        )

    def test_instructions_in_tutor_instructions_tag(self):
        ctx = SectionContext(
            segments=[(0, "text", "Text")],
            segment_index=0,
            total_segments=1,
            section_title="Test Section",
        )
        result = build_content_context_message(ctx, instructions="Ask about alignment.")
        assert "<segment-instructions>" in result
        assert "Ask about alignment." in result
        assert "</segment-instructions>" in result

    def test_no_instructions_omits_tag(self):
        ctx = SectionContext(
            segments=[(0, "text", "Text")],
            segment_index=0,
            total_segments=1,
            section_title="Test",
        )
        result = build_content_context_message(ctx)
        assert "<segment-instructions>" not in result

    def test_no_segments_no_lens_tag(self):
        ctx = SectionContext(segments=[], segment_index=0, total_segments=1)
        result = build_content_context_message(ctx)
        assert "<lens" not in result

    def test_no_section_title_no_location_marker(self):
        ctx = SectionContext(
            segments=[(0, "text", "Text")],
            segment_index=0,
            total_segments=1,
        )
        result = build_content_context_message(ctx)
        assert "<student-position>The student" not in result

    def test_module_title_only_in_lens_attrs(self):
        ctx = SectionContext(
            segments=[(0, "text", "content")],
            segment_index=0,
            total_segments=1,
            module_title="Intro to AI Safety",
        )
        result = build_content_context_message(ctx)
        assert 'module_title="Intro to AI Safety"' in result
        assert "lens_title" not in result


class TestBuildLocationUpdateMessage:
    def test_format(self):
        result = build_location_update_message("Risks from AI", 2)
        assert (
            result
            == '<student-position>Segment 3 of "Risks from AI"</student-position>'
        )

    def test_first_segment(self):
        result = build_location_update_message("Test Section", 0)
        assert (
            result
            == '<student-position>Segment 1 of "Test Section"</student-position>'
        )


class TestDefaultBasePrompt:
    def test_contains_tutor(self):
        assert "tutor" in DEFAULT_BASE_PROMPT

    def test_contains_ai_safety(self):
        assert "AI safety" in DEFAULT_BASE_PROMPT
