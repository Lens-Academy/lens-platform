# core/modules/tests/test_prompts.py
"""Tests for shared prompt assembly."""

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
            "Base\n\nThe user just engaged with this content:\n---\nSome content\n---"
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


class TestDefaultBasePrompt:
    def test_contains_tutor(self):
        assert "tutor" in DEFAULT_BASE_PROMPT

    def test_contains_ai_safety(self):
        assert "AI safety" in DEFAULT_BASE_PROMPT
