"""In-memory content cache for educational content from GitHub."""

from dataclasses import dataclass
from datetime import datetime

from core.lessons.markdown_parser import ParsedLesson, ParsedCourse


class CacheNotInitializedError(Exception):
    """Raised when trying to access cache before initialization."""

    pass


@dataclass
class ContentCache:
    """Cache for all educational content."""

    courses: dict[str, ParsedCourse]  # slug -> parsed course
    lessons: dict[str, ParsedLesson]  # slug -> parsed lesson
    articles: dict[str, str]  # path -> raw markdown
    video_transcripts: dict[str, str]  # path -> raw markdown
    last_refreshed: datetime


# Global cache singleton
_cache: ContentCache | None = None


def get_cache() -> ContentCache:
    """Get the content cache.

    Raises:
        CacheNotInitializedError: If cache has not been initialized.
    """
    if _cache is None:
        raise CacheNotInitializedError(
            "Content cache not initialized. Call initialize_cache() first."
        )
    return _cache


def set_cache(cache: ContentCache) -> None:
    """Set the content cache (used by fetcher and tests)."""
    global _cache
    _cache = cache


def clear_cache() -> None:
    """Clear the content cache (used by tests and refresh)."""
    global _cache
    _cache = None
