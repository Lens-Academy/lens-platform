"""Tests for content cache."""

import pytest
from datetime import datetime

from core.content.cache import (
    ContentCache,
    get_cache,
    set_cache,
    clear_cache,
    CacheNotInitializedError,
)


class TestContentCache:
    """Test cache operations."""

    def setup_method(self):
        """Clear cache before each test."""
        clear_cache()

    def test_get_cache_raises_when_not_initialized(self):
        """Should raise error when cache not initialized."""
        with pytest.raises(CacheNotInitializedError):
            get_cache()

    def test_set_and_get_cache(self):
        """Should store and retrieve cache."""
        cache = ContentCache(
            courses={},
            lessons={},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        retrieved = get_cache()
        assert retrieved is cache

    def test_clear_cache(self):
        """Should clear the cache."""
        cache = ContentCache(
            courses={},
            lessons={},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)
        clear_cache()

        with pytest.raises(CacheNotInitializedError):
            get_cache()

    def test_cache_stores_lessons(self):
        """Should store and retrieve lessons from cache."""
        from core.lessons.markdown_parser import ParsedLesson, ChatSection

        test_lesson = ParsedLesson(
            slug="test-lesson",
            title="Test Lesson",
            sections=[
                ChatSection(
                    instructions="Test instructions",
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
                )
            ],
        )

        cache = ContentCache(
            courses={},
            lessons={"test-lesson": test_lesson},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        retrieved = get_cache()
        assert "test-lesson" in retrieved.lessons
        assert retrieved.lessons["test-lesson"].title == "Test Lesson"

    def test_cache_stores_articles(self):
        """Should store and retrieve articles from cache."""
        cache = ContentCache(
            courses={},
            lessons={},
            articles={"articles/test.md": "# Test Article\n\nSome content."},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        retrieved = get_cache()
        assert "articles/test.md" in retrieved.articles
        assert "# Test Article" in retrieved.articles["articles/test.md"]

    def test_cache_stores_video_transcripts(self):
        """Should store and retrieve video transcripts from cache."""
        cache = ContentCache(
            courses={},
            lessons={},
            articles={},
            video_transcripts={"video_transcripts/test.md": "Transcript content"},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        retrieved = get_cache()
        assert "video_transcripts/test.md" in retrieved.video_transcripts

    def test_cache_last_refreshed(self):
        """Should track when cache was last refreshed."""
        refresh_time = datetime(2026, 1, 18, 12, 0, 0)
        cache = ContentCache(
            courses={},
            lessons={},
            articles={},
            video_transcripts={},
            last_refreshed=refresh_time,
        )
        set_cache(cache)

        retrieved = get_cache()
        assert retrieved.last_refreshed == refresh_time
