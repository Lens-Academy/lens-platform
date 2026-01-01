# core/lessons/tests/test_content.py
"""Tests for content extraction."""

import pytest
from core.lessons.content import extract_article_section, load_article


def test_load_full_article():
    """Should load entire article content."""
    content = load_article("articles/four-background-claims.md")
    assert "Four Background Claims" in content
    assert len(content) > 100


def test_extract_section_with_anchors():
    """Should extract text between from/to anchors."""
    full_text = """
    Some intro text here.

    The first claim is that general intelligence exists.
    This is a very important point to understand.
    It relates to instrumental convergence.

    More text after.
    """

    section = extract_article_section(
        full_text,
        from_text="The first claim is",
        to_text="instrumental convergence."
    )

    assert "The first claim is" in section
    assert "instrumental convergence." in section
    assert "Some intro text" not in section
    assert "More text after" not in section


def test_extract_section_no_anchors():
    """Should return full text when no anchors specified."""
    full_text = "Complete article content here."
    section = extract_article_section(full_text, None, None)
    assert section == full_text
