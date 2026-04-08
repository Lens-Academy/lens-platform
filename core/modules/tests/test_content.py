# core/modules/tests/test_content.py
"""Tests for content extraction."""

from datetime import datetime
from pathlib import Path

import pytest

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.content import (
    extract_article_section,
    file_name_to_slug,
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

ARTICLE_WITH_SPECIAL_CHARS = """\
---
title: "1960, The Year The Singularity Was Cancelled"
author: Scott Alexander
source_url: https://example.com/1960
published: 2019-04-22
---

Content about the singularity.
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
            "articles/1960, The Year The Singularity Was Cancelled.md": ARTICLE_WITH_SPECIAL_CHARS,
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


# file_name_to_slug tests


def test_file_name_to_slug_simple():
    """Simple filename without special chars."""
    assert file_name_to_slug("articles/test-article-one.md") == "test-article-one"


def test_file_name_to_slug_spaces_and_commas():
    """Spaces become hyphens, commas stripped."""
    assert (
        file_name_to_slug("articles/1960, The Year The Singularity Was Cancelled.md")
        == "1960-the-year-the-singularity-was-cancelled"
    )


def test_file_name_to_slug_special_chars():
    """Apostrophes, question marks stripped."""
    assert file_name_to_slug("Lenses/What's a Lens?.md") == "whats-a-lens"


def test_file_name_to_slug_collapses_hyphens():
    """Multiple spaces/hyphens collapse to single hyphen."""
    assert file_name_to_slug("articles/Some  --  Article.md") == "some-article"


def test_file_name_to_slug_empty_result():
    """All-punctuation filename yields 'untitled'."""
    assert file_name_to_slug("articles/!!!.md") == "untitled"


# list_article_summaries tests


def test_list_article_summaries_returns_metadata(article_cache):
    """Should parse frontmatter and return slug, title, author for each article."""
    summaries = list_article_summaries()
    assert len(summaries) == 3

    # Should be sorted by slug
    by_slug = {s["slug"]: s for s in summaries}

    assert by_slug["minimal"]["title"] == "Minimal Article"
    assert by_slug["minimal"]["author"] is None

    assert by_slug["test-article-one"]["title"] == "Test Article One"
    assert by_slug["test-article-one"]["author"] == "Alice Author"

    assert (
        by_slug["1960-the-year-the-singularity-was-cancelled"]["title"]
        == "1960, The Year The Singularity Was Cancelled"
    )
    assert (
        by_slug["1960-the-year-the-singularity-was-cancelled"]["author"]
        == "Scott Alexander"
    )


def test_list_article_summaries_empty_cache(empty_cache):
    """Should return empty list when no articles in cache."""
    summaries = list_article_summaries()
    assert summaries == []


def test_list_article_summaries_slugifies_filenames(article_cache):
    """Filenames with spaces/commas should be slugified."""
    summaries = list_article_summaries()
    slugs = [s["slug"] for s in summaries]
    assert "test-article-one" in slugs
    assert "minimal" in slugs
    assert "1960-the-year-the-singularity-was-cancelled" in slugs


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


def test_build_article_module_resolves_slugified_name(article_cache):
    """Should find article by slugified name even when filename has spaces/commas."""
    result = build_article_module("1960-the-year-the-singularity-was-cancelled")

    assert result["slug"] == "article/1960-the-year-the-singularity-was-cancelled"
    assert result["title"] == "1960, The Year The Singularity Was Cancelled"
    segment = result["sections"][0]["segments"][0]
    assert "Content about the singularity." in segment["content"]
    assert segment["author"] == "Scott Alexander"


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
