"""Tests for content cache."""

import pytest
from datetime import datetime
from uuid import UUID

from core.content.cache import (
    ContentCache,
    get_cache,
    set_cache,
    clear_cache,
    CacheNotInitializedError,
)
from core.modules.flattened_types import FlattenedModule


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
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        retrieved = get_cache()
        assert retrieved is cache

    def test_clear_cache(self):
        """Should clear the cache."""
        cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)
        clear_cache()

        with pytest.raises(CacheNotInitializedError):
            get_cache()

    def test_cache_stores_flattened_modules(self):
        """Should store and retrieve flattened modules from cache."""
        test_module = FlattenedModule(
            slug="test-module",
            title="Test Module",
            content_id=UUID("00000000-0000-0000-0000-000000000001"),
            sections=[
                {
                    "type": "page",
                    "contentId": "00000000-0000-0000-0000-000000000002",
                    "title": "Welcome",
                    "segments": [{"type": "text", "content": "Hello"}],
                }
            ],
        )

        cache = ContentCache(
            courses={},
            flattened_modules={"test-module": test_module},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        retrieved = get_cache()
        assert "test-module" in retrieved.flattened_modules
        assert retrieved.flattened_modules["test-module"].title == "Test Module"

    def test_cache_stores_articles(self):
        """Should store and retrieve articles from cache."""
        cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={"articles/test.md": "# Test Article\n\nSome content."},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
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
            flattened_modules={},
            articles={},
            video_transcripts={"video_transcripts/test.md": "Transcript content"},
            parsed_learning_outcomes={},
            parsed_lenses={},
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
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=refresh_time,
        )
        set_cache(cache)

        retrieved = get_cache()
        assert retrieved.last_refreshed == refresh_time

    def test_cache_stores_three_stage_shas(self):
        """Should store known, fetched, and processed SHAs with timestamps."""
        now = datetime(2026, 2, 6, 12, 0, 0)
        cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=now,
            known_sha="aaa111",
            known_sha_timestamp=now,
            fetched_sha="bbb222",
            fetched_sha_timestamp=now,
            processed_sha="ccc333",
            processed_sha_timestamp=now,
        )
        set_cache(cache)
        retrieved = get_cache()
        assert retrieved.known_sha == "aaa111"
        assert retrieved.known_sha_timestamp == now
        assert retrieved.fetched_sha == "bbb222"
        assert retrieved.fetched_sha_timestamp == now
        assert retrieved.processed_sha == "ccc333"
        assert retrieved.processed_sha_timestamp == now

    # NOTE: Tests for parsed_learning_outcomes and parsed_lenses were removed
    # because the TypeScript processor now handles these - they're always empty dicts.
