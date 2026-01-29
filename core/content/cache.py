"""In-memory content cache for educational content from GitHub."""

from dataclasses import dataclass
from datetime import datetime

from core.modules.markdown_parser import ParsedCourse, ParsedLearningOutcome, ParsedLens
from core.modules.flattened_types import FlattenedModule


class CacheNotInitializedError(Exception):
    """Raised when trying to access cache before initialization."""

    pass


@dataclass
class ContentCache:
    """Cache for all educational content.

    Modules are stored in flattened form - all Learning Outcome and
    Uncategorized references resolved to lens-video/lens-article sections.
    """

    courses: dict[str, ParsedCourse]  # slug -> parsed course
    flattened_modules: dict[str, FlattenedModule]  # slug -> flattened module
    parsed_learning_outcomes: dict[
        str, ParsedLearningOutcome
    ]  # filename stem -> parsed LO
    parsed_lenses: dict[str, ParsedLens]  # filename stem -> parsed lens
    articles: dict[str, str]  # path -> raw markdown (for metadata extraction)
    video_transcripts: dict[str, str]  # path -> raw markdown (for metadata extraction)
    last_refreshed: datetime
    video_timestamps: dict[str, list[dict]] | None = (
        None  # video_id -> timestamp word list
    )
    last_commit_sha: str | None = None  # Git commit SHA of current cache state


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
