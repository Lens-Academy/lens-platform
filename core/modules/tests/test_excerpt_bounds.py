# core/modules/tests/test_excerpt_bounds.py
"""Tests for find_excerpt_bounds() function."""

import pytest

from core.modules.content import (
    find_excerpt_bounds,
    AnchorNotFoundError,
    AnchorNotUniqueError,
)


# Synthetic test content - NOT real educational content
SAMPLE_ARTICLE = """# Introduction

This is the introduction paragraph.
It contains some background information.

## Section One

Section one has important content.
We discuss key concepts here.

## Section Two

Section two continues the discussion.
More detailed analysis follows.

## Conclusion

The conclusion wraps everything up.
Final thoughts are presented here.
"""


class TestFindExcerptBounds:
    """Tests for find_excerpt_bounds()."""

    def test_both_anchors_provided(self):
        """Should return correct positions when both anchors provided."""
        start, end = find_excerpt_bounds(
            SAMPLE_ARTICLE,
            from_text="## Section One",
            to_text="concepts here.",
        )

        extracted = SAMPLE_ARTICLE[start:end]
        assert "## Section One" in extracted
        assert "concepts here." in extracted
        assert "Introduction" not in extracted
        assert "Section Two" not in extracted

    def test_from_text_none_starts_at_beginning(self):
        """Should start at position 0 when from_text is None."""
        start, end = find_excerpt_bounds(
            SAMPLE_ARTICLE,
            from_text=None,
            to_text="background information.",
        )

        assert start == 0
        extracted = SAMPLE_ARTICLE[start:end]
        assert "# Introduction" in extracted
        assert "background information." in extracted

    def test_to_text_none_ends_at_document_end(self):
        """Should end at document length when to_text is None."""
        start, end = find_excerpt_bounds(
            SAMPLE_ARTICLE,
            from_text="## Conclusion",
            to_text=None,
        )

        assert end == len(SAMPLE_ARTICLE)
        extracted = SAMPLE_ARTICLE[start:end]
        assert "## Conclusion" in extracted
        assert "Final thoughts" in extracted

    def test_both_anchors_none_returns_full_document(self):
        """Should return (0, len) when both anchors are None."""
        start, end = find_excerpt_bounds(
            SAMPLE_ARTICLE,
            from_text=None,
            to_text=None,
        )

        assert start == 0
        assert end == len(SAMPLE_ARTICLE)

    def test_anchor_not_found_raises_error(self):
        """Should raise AnchorNotFoundError when anchor not found."""
        with pytest.raises(AnchorNotFoundError):
            find_excerpt_bounds(
                SAMPLE_ARTICLE,
                from_text="nonexistent text that is not in the article",
                to_text=None,
            )

    def test_to_anchor_not_found_raises_error(self):
        """Should raise AnchorNotFoundError when to_text not found."""
        with pytest.raises(AnchorNotFoundError):
            find_excerpt_bounds(
                SAMPLE_ARTICLE,
                from_text="## Section One",
                to_text="this text does not exist anywhere",
            )

    def test_anchor_not_unique_raises_error(self):
        """Should raise AnchorNotUniqueError when anchor appears multiple times."""
        # "Section" appears multiple times in the content
        with pytest.raises(AnchorNotUniqueError):
            find_excerpt_bounds(
                SAMPLE_ARTICLE,
                from_text="Section",
                to_text=None,
            )

    def test_case_insensitive_matching(self):
        """Should match anchors case-insensitively."""
        # Use lowercase when actual content has mixed case
        start, end = find_excerpt_bounds(
            SAMPLE_ARTICLE,
            from_text="## section one",  # lowercase
            to_text="CONCEPTS HERE.",  # uppercase
        )

        extracted = SAMPLE_ARTICLE[start:end]
        assert "## Section One" in extracted
        assert "concepts here." in extracted

    def test_end_position_includes_anchor_text(self):
        """End position should be after the to_text anchor."""
        content = "AAA BBB CCC DDD"
        start, end = find_excerpt_bounds(
            content,
            from_text="BBB",
            to_text="CCC",
        )

        # End should be right after "CCC"
        extracted = content[start:end]
        assert extracted == "BBB CCC"

    def test_start_position_at_anchor_beginning(self):
        """Start position should be at the beginning of from_text."""
        content = "AAA BBB CCC DDD"
        start, end = find_excerpt_bounds(
            content,
            from_text="BBB",
            to_text="CCC",
        )

        assert start == content.find("BBB")
