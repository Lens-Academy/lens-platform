# core/modules/tests/test_content.py
"""Tests for content extraction."""

from datetime import datetime
from pathlib import Path

import pytest

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.content import (
    extract_article_section,
    parse_frontmatter,
    list_article_summaries,
    build_article_module,
)

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


def test_parse_frontmatter_yaml_list_authors():
    """Should join YAML list authors with comma and space."""
    text = '---\ntitle: "AI Is Grown"\nauthor:\n  - "Eliezer Yudkowsky"\n  - "Nate Soares"\nsource_url: https://example.com\npublished: 2024-01-01\n---\n\nBody content.\n'

    metadata, content = parse_frontmatter(text)

    assert metadata.author == "Eliezer Yudkowsky, Nate Soares"
    assert metadata.title == "AI Is Grown"
    assert "Body content." in content


def test_parse_frontmatter_comma_separated_authors():
    """Should preserve comma-separated authors as-is."""
    text = '---\ntitle: Test\nauthor: "Alice, Bob"\nsource_url: https://example.com\npublished: 2024-01-01\n---\n\nBody.\n'

    metadata, _ = parse_frontmatter(text)

    assert metadata.author == "Alice, Bob"


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


# --- Article browsing tests ---

ARTICLE_WITH_ALL_FIELDS = """\
---
title: Test Article One
author: Alice Author
source_url: https://example.com/article-one
published: 2024-01-15
---

This is the body of article one.
"""

ARTICLE_MINIMAL = """\
---
title: Minimal Article
---

Just a body, no author or source_url.
"""


@pytest.fixture
def article_cache():
    """Set up a ContentCache with test articles."""
    cache = ContentCache(
        courses={},
        flattened_modules={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={
            "articles/test-article-one.md": ARTICLE_WITH_ALL_FIELDS,
            "articles/minimal.md": ARTICLE_MINIMAL,
        },
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    yield cache
    clear_cache()


@pytest.fixture
def empty_cache():
    """Set up a ContentCache with no articles."""
    cache = ContentCache(
        courses={},
        flattened_modules={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    yield cache
    clear_cache()


# list_article_summaries tests


def test_list_article_summaries_returns_metadata(article_cache):
    """Should parse frontmatter and return slug, title, author for each article."""
    summaries = list_article_summaries()
    assert len(summaries) == 2

    # Should be sorted by slug
    assert summaries[0]["slug"] == "minimal"
    assert summaries[0]["title"] == "Minimal Article"
    assert summaries[0]["author"] is None

    assert summaries[1]["slug"] == "test-article-one"
    assert summaries[1]["title"] == "Test Article One"
    assert summaries[1]["author"] == "Alice Author"


def test_list_article_summaries_empty_cache(empty_cache):
    """Should return empty list when no articles in cache."""
    summaries = list_article_summaries()
    assert summaries == []


def test_list_article_summaries_slug_derived_from_path(article_cache):
    """articles/my-article.md -> slug 'my-article'."""
    summaries = list_article_summaries()
    slugs = [s["slug"] for s in summaries]
    assert "test-article-one" in slugs
    assert "minimal" in slugs


# build_article_module tests


def test_build_article_module_returns_flattened_format(article_cache):
    """Should return dict matching FlattenedModule shape with lens section."""
    result = build_article_module("test-article-one")

    assert result["slug"] == "article/test-article-one"
    assert result["title"] == "Test Article One"
    assert len(result["sections"]) == 1

    section = result["sections"][0]
    assert section["type"] == "lens"
    assert section["meta"]["title"] == "Test Article One"

    assert len(section["segments"]) == 1
    segment = section["segments"][0]
    assert segment["type"] == "article"
    assert "This is the body of article one." in segment["content"]
    assert segment["title"] == "Test Article One"
    assert segment["author"] == "Alice Author"
    assert segment["sourceUrl"] == "https://example.com/article-one"
    assert segment["published"] == "2024-01-15"


def test_build_article_module_not_found(article_cache):
    """Should raise FileNotFoundError for unknown slug."""
    with pytest.raises(FileNotFoundError):
        build_article_module("nonexistent")


def test_build_article_module_strips_frontmatter(article_cache):
    """Content in segment should be article body without YAML frontmatter."""
    result = build_article_module("test-article-one")
    segment = result["sections"][0]["segments"][0]
    assert "---" not in segment["content"]
    assert "title:" not in segment["content"]
