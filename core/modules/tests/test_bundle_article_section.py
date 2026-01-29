# core/modules/tests/test_bundle_article_section.py
"""Tests for bundle_article_section() function."""

from datetime import datetime

import pytest

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.content import bundle_article_section
from core.modules.markdown_parser import (
    ArticleSection,
    ArticleExcerptSegment,
    TextSegment,
    ChatSegment,
)


# Synthetic test content - A through L on separate lines
SAMPLE_ARTICLE = """---
title: Test Article
author: Test Author
source_url: https://example.com/article
---

A
B
C
D
E
F
G
H
I
J
K
L"""

# Wiki-link format used in tests
TEST_ARTICLE_SOURCE = "[[../articles/test-article]]"


@pytest.fixture(autouse=True)
def setup_cache():
    """Set up a minimal cache with test article content."""
    cache = ContentCache(
        courses={},
        flattened_modules={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={"articles/test-article.md": SAMPLE_ARTICLE},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    yield
    clear_cache()


class TestBundleArticleSection:
    """Tests for bundle_article_section()."""

    def test_single_excerpt_with_content_before_and_after(self):
        """Single excerpt should have collapsed_before and collapsed_after."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="D", to_text="F"),
            ],
        )

        result = bundle_article_section(section)

        assert result["type"] == "article"
        assert len(result["segments"]) == 1

        excerpt = result["segments"][0]
        assert excerpt["type"] == "article-excerpt"
        assert "D" in excerpt["content"]
        assert "F" in excerpt["content"]
        # Content before D (A, B, C)
        assert excerpt["collapsed_before"] is not None
        assert "A" in excerpt["collapsed_before"]
        assert "C" in excerpt["collapsed_before"]
        # Content after F (G through L)
        assert excerpt["collapsed_after"] is not None
        assert "G" in excerpt["collapsed_after"]
        assert "L" in excerpt["collapsed_after"]

    def test_multiple_excerpts_with_gaps(self):
        """Multiple excerpts with gaps should have collapsed_before on following excerpts."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="B", to_text="C"),
                ArticleExcerptSegment(from_text="G", to_text="H"),
                ArticleExcerptSegment(from_text="K", to_text="L"),
            ],
        )

        result = bundle_article_section(section)

        assert len(result["segments"]) == 3

        # First excerpt: collapsed_before = A, collapsed_after = None
        first = result["segments"][0]
        assert "B" in first["content"] and "C" in first["content"]
        assert first["collapsed_before"] is not None
        assert "A" in first["collapsed_before"]
        assert first["collapsed_after"] is None

        # Second excerpt: collapsed_before = D,E,F (gap), collapsed_after = None
        second = result["segments"][1]
        assert "G" in second["content"] and "H" in second["content"]
        assert second["collapsed_before"] is not None
        assert "D" in second["collapsed_before"]
        assert "F" in second["collapsed_before"]
        assert second["collapsed_after"] is None

        # Third (last) excerpt: collapsed_before = I,J (gap), collapsed_after = None (nothing after L)
        third = result["segments"][2]
        assert "K" in third["content"] and "L" in third["content"]
        assert third["collapsed_before"] is not None
        assert "I" in third["collapsed_before"]
        assert "J" in third["collapsed_before"]
        # L is at the end, so no collapsed_after
        assert third["collapsed_after"] is None

    def test_adjacent_excerpts_no_gap(self):
        """Adjacent excerpts should have collapsed_before = None."""
        # B-C immediately followed by D-E (no gap)
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="B", to_text="C"),
                ArticleExcerptSegment(from_text="D", to_text="E"),
            ],
        )

        result = bundle_article_section(section)

        first = result["segments"][0]
        second = result["segments"][1]

        # First has collapsed_before (A)
        assert first["collapsed_before"] is not None
        assert "A" in first["collapsed_before"]

        # Second should have collapsed_before = None (adjacent to first, only whitespace between C and D)
        # Note: There's a newline between C and D, but that's just whitespace
        assert second["collapsed_before"] is None

    def test_whitespace_only_gap_is_null(self):
        """Gaps that are whitespace-only should result in collapsed_before = None."""
        # Article with extra whitespace - need to temporarily update cache
        article_with_whitespace = """---
title: Test Article
author: Test Author
source_url: https://example.com/article
---

A


B


C"""
        from core.content.cache import get_cache

        cache = get_cache()
        cache.articles["articles/test-article.md"] = article_with_whitespace

        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="A", to_text="A"),
                ArticleExcerptSegment(from_text="B", to_text="C"),
            ],
        )

        result = bundle_article_section(section)

        first = result["segments"][0]
        second = result["segments"][1]

        # First starts at beginning, so no collapsed_before
        assert first["collapsed_before"] is None

        # Gap between A and B is just whitespace (\n\n\n), should be None
        assert second["collapsed_before"] is None

    def test_interleaved_with_text_segments(self):
        """Non-excerpt segments should be preserved in order."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="B", to_text="C"),
                TextSegment(content="Commentary here"),
                ArticleExcerptSegment(from_text="G", to_text="H"),
            ],
        )

        result = bundle_article_section(section)

        assert len(result["segments"]) == 3

        # First is excerpt
        assert result["segments"][0]["type"] == "article-excerpt"
        assert "B" in result["segments"][0]["content"]

        # Second is text
        assert result["segments"][1]["type"] == "text"
        assert result["segments"][1]["content"] == "Commentary here"

        # Third is excerpt
        assert result["segments"][2]["type"] == "article-excerpt"
        assert "G" in result["segments"][2]["content"]

    def test_interleaved_with_chat_segments(self):
        """Chat segments should be preserved in order."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="B", to_text="C"),
                ChatSegment(instructions="Discuss this"),
                ArticleExcerptSegment(from_text="G", to_text="H"),
            ],
        )

        result = bundle_article_section(section)

        assert len(result["segments"]) == 3
        assert result["segments"][0]["type"] == "article-excerpt"
        assert result["segments"][1]["type"] == "chat"
        assert result["segments"][1]["instructions"] == "Discuss this"
        assert result["segments"][2]["type"] == "article-excerpt"

    def test_last_excerpt_gets_collapsed_after(self):
        """Last excerpt should have collapsed_after if there's trailing content."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="B", to_text="C"),
            ],
        )

        result = bundle_article_section(section)

        excerpt = result["segments"][0]
        # After C, there's D through L
        assert excerpt["collapsed_after"] is not None
        assert "D" in excerpt["collapsed_after"]
        assert "L" in excerpt["collapsed_after"]

    def test_excerpt_at_end_no_collapsed_after(self):
        """Excerpt ending at document end should have collapsed_after = None."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="K", to_text="L"),
            ],
        )

        result = bundle_article_section(section)

        excerpt = result["segments"][0]
        # L is the last character, so nothing after
        assert excerpt["collapsed_after"] is None

    def test_excerpt_at_start_no_collapsed_before(self):
        """Excerpt starting at document start should have collapsed_before = None."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="A", to_text="B"),
            ],
        )

        result = bundle_article_section(section)

        excerpt = result["segments"][0]
        # A is at the start, so nothing before
        assert excerpt["collapsed_before"] is None

    def test_metadata_is_included(self):
        """Result should include article metadata."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="A", to_text="B"),
            ],
        )

        result = bundle_article_section(section)

        assert result["meta"]["title"] == "Test Article"
        assert result["meta"]["author"] == "Test Author"
        assert result["meta"]["sourceUrl"] == "https://example.com/article"

    def test_optional_field_is_included(self):
        """Result should include optional field."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[ArticleExcerptSegment(from_text="A", to_text="B")],
            optional=True,
        )

        result = bundle_article_section(section)

        assert result["optional"] is True

    def test_full_article_no_excerpts(self):
        """Section with no article-excerpt segments should still work."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                TextSegment(content="Just commentary"),
            ],
        )

        result = bundle_article_section(section)

        assert len(result["segments"]) == 1
        assert result["segments"][0]["type"] == "text"

    def test_chat_segment_uses_hide_fields(self):
        """Chat segments should use hidePreviousContentFromUser/Tutor, not show* fields."""
        section = ArticleSection(
            source=TEST_ARTICLE_SOURCE,
            segments=[
                ArticleExcerptSegment(from_text="A", to_text="B"),
                ChatSegment(
                    instructions="Discuss this",
                    hide_previous_content_from_user=True,
                    hide_previous_content_from_tutor=False,
                ),
            ],
        )

        result = bundle_article_section(section)

        chat_seg = result["segments"][1]
        assert chat_seg["type"] == "chat"
        # Should have hide* fields, not show* fields
        assert "hidePreviousContentFromUser" in chat_seg
        assert "hidePreviousContentFromTutor" in chat_seg
        assert chat_seg["hidePreviousContentFromUser"] is True
        assert chat_seg["hidePreviousContentFromTutor"] is False
        # Should NOT have show* fields
        assert "showUserPreviousContent" not in chat_seg
        assert "showTutorPreviousContent" not in chat_seg
