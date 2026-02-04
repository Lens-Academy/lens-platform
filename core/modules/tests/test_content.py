# core/modules/tests/test_content.py
"""Tests for content extraction."""

from pathlib import Path
from core.modules.content import extract_article_section, parse_frontmatter

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_parse_frontmatter_strips_metadata():
    """Should strip YAML frontmatter and return only body content."""
    fixture_path = FIXTURES_DIR / "test-article.md"
    raw_text = fixture_path.read_text()

    metadata, content = parse_frontmatter(raw_text)

    # Frontmatter should be parsed into metadata
    assert metadata.title == "Test Article"
    assert metadata.author == "Test Author"

    # Content should not contain frontmatter delimiters
    assert "---" not in content
    assert "title:" not in content
    assert "author:" not in content

    # Content should have the body text
    assert "This is the body content" in content
    assert len(content) > 50


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
        full_text, from_text="The first claim is", to_text="instrumental convergence."
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


# NOTE: test_bundle_narrative_module_includes_optional_field was removed
# because bundle_narrative_module was deleted - content bundling is now
# handled by the TypeScript processor.
