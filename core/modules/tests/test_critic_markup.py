# core/modules/tests/test_critic_markup.py
"""Tests for critic markup stripping (reject all changes behavior)."""

import pytest

from core.modules.critic_markup import strip_critic_markup


class TestStripCriticMarkup:
    """Test strip_critic_markup function."""

    # Comments: {>>comment<<} → remove entirely
    def test_removes_comment(self):
        text = "Hello{>>this is a comment<<}world"
        assert strip_critic_markup(text) == "Helloworld"

    def test_removes_comment_with_spaces(self):
        text = "Hello {>>comment<<} world"
        assert strip_critic_markup(text) == "Hello  world"

    def test_removes_multiline_comment(self):
        text = "Hello{>>this is\na multiline\ncomment<<}world"
        assert strip_critic_markup(text) == "Helloworld"

    def test_removes_multiple_comments(self):
        text = "A{>>first<<}B{>>second<<}C"
        assert strip_critic_markup(text) == "ABC"

    # Additions: {++addition++} → remove entirely (reject addition)
    def test_removes_addition(self):
        text = "Hello{++new stuff++}world"
        assert strip_critic_markup(text) == "Helloworld"

    def test_removes_addition_with_spaces(self):
        text = "Hello {++added text++} world"
        assert strip_critic_markup(text) == "Hello  world"

    def test_removes_multiline_addition(self):
        text = "Hello{++this is\nadded\ntext++}world"
        assert strip_critic_markup(text) == "Helloworld"

    def test_removes_multiple_additions(self):
        text = "A{++first++}B{++second++}C"
        assert strip_critic_markup(text) == "ABC"

    # Deletions: {--deletion--} → keep inner content (reject deletion)
    def test_keeps_deletion_content(self):
        text = "Hello{--old stuff--}world"
        assert strip_critic_markup(text) == "Helloold stuffworld"

    def test_keeps_deletion_with_spaces(self):
        text = "Hello {--deleted text--} world"
        assert strip_critic_markup(text) == "Hello deleted text world"

    def test_keeps_multiline_deletion(self):
        text = "Hello{--this was\ndeleted\ntext--}world"
        assert strip_critic_markup(text) == "Hellothis was\ndeleted\ntextworld"

    def test_keeps_multiple_deletions(self):
        text = "A{--first--}B{--second--}C"
        assert strip_critic_markup(text) == "AfirstBsecondC"

    # Substitutions: {~~old~>new~~} → keep old (reject substitution)
    def test_keeps_old_in_substitution(self):
        text = "Hello{~~foo~>bar~~}world"
        assert strip_critic_markup(text) == "Hellofooworld"

    def test_keeps_old_with_spaces(self):
        text = "Hello {~~old text~>new text~~} world"
        assert strip_critic_markup(text) == "Hello old text world"

    def test_keeps_old_in_multiline_substitution(self):
        text = "Hello{~~old\ntext~>new\ntext~~}world"
        assert strip_critic_markup(text) == "Helloold\ntextworld"

    def test_keeps_multiple_substitutions(self):
        text = "A{~~one~>1~~}B{~~two~>2~~}C"
        assert strip_critic_markup(text) == "AoneBtwoC"

    # Highlights: {==highlight==} → keep inner content
    def test_keeps_highlight_content(self):
        text = "Hello{==important==}world"
        assert strip_critic_markup(text) == "Helloimportantworld"

    def test_keeps_highlight_with_spaces(self):
        text = "Hello {==highlighted text==} world"
        assert strip_critic_markup(text) == "Hello highlighted text world"

    def test_keeps_multiline_highlight(self):
        text = "Hello{==this is\nhighlighted\ntext==}world"
        assert strip_critic_markup(text) == "Hellothis is\nhighlighted\ntextworld"

    def test_keeps_multiple_highlights(self):
        text = "A{==first==}B{==second==}C"
        assert strip_critic_markup(text) == "AfirstBsecondC"

    # Mixed markup
    def test_handles_mixed_markup(self):
        text = "Start{>>comment<<}{++added++}{--deleted--}{~~old~>new~~}{==highlight==}end"
        assert strip_critic_markup(text) == "Startdeletedoldhighlightend"

    def test_handles_real_world_example(self):
        text = (
            "We begin by examining the potential of AI{>>CGL > This does not "
            "feel like an introduction<<} and the {++new ++}risks{--old --} "
            "that {~~technology~>tech~~} present{==s==} to humanity."
        )
        expected = (
            "We begin by examining the potential of AI and the risks"
            "old  that technology presents to humanity."
        )
        assert strip_critic_markup(text) == expected

    # Edge cases
    def test_returns_empty_string_unchanged(self):
        assert strip_critic_markup("") == ""

    def test_returns_text_without_markup_unchanged(self):
        text = "Normal text without any critic markup."
        assert strip_critic_markup(text) == text

    def test_handles_nested_braces_in_content(self):
        # Content with regular braces should not be affected
        text = "Code: {foo: bar}{>>comment<<}"
        assert strip_critic_markup(text) == "Code: {foo: bar}"

    def test_handles_arrows_in_regular_text(self):
        # Regular arrows should not be affected
        text = "Use -> for arrows and ~> in text{~~old~>new~~}"
        assert strip_critic_markup(text) == "Use -> for arrows and ~> in textold"
