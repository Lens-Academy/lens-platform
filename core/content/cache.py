"""In-memory content cache for educational content from GitHub."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from core.modules.flattened_types import FlattenedModule, ParsedCourse


class CacheNotInitializedError(Exception):
    """Raised when trying to access cache before initialization."""

    pass


@dataclass
class ContentCache:
    """Cache for all educational content.

    Modules are stored in flattened form - all Learning Outcome and
    Uncategorized references resolved to lens-video/lens-article sections
    by the TypeScript processor.
    """

    courses: dict[str, ParsedCourse]  # slug -> parsed course
    flattened_modules: dict[str, FlattenedModule]  # slug -> flattened module
    # Legacy fields - kept for compatibility but always empty (TypeScript handles these)
    parsed_learning_outcomes: dict[str, Any]  # Always {} - TypeScript handles
    parsed_lenses: dict[str, Any]  # Always {} - TypeScript handles
    articles: dict[str, str]  # path -> raw markdown (for metadata extraction)
    video_transcripts: dict[str, str]  # path -> raw markdown (for metadata extraction)
    last_refreshed: datetime
    video_timestamps: dict[str, list[dict]] | None = (
        None  # video_id -> timestamp word list
    )
    # --- Three-stage SHA tracking ---
    # Latest commit we've heard about (from webhook or polling GitHub API)
    known_sha: str | None = None
    known_sha_timestamp: datetime | None = None  # commit's author timestamp
    # Raw files in cache are from this commit
    fetched_sha: str | None = None
    fetched_sha_timestamp: datetime | None = None
    # Validation results (parsed/processed) are from this commit
    processed_sha: str | None = None
    processed_sha_timestamp: datetime | None = None
    # Legacy — keep for backward compat during migration, alias for processed_sha
    last_commit_sha: str | None = None
    # Raw files for incremental updates - all files sent to TypeScript processor
    raw_files: dict[str, str] | None = None  # path -> raw content
    # Validation errors/warnings from last content processing
    validation_errors: list[dict] | None = (
        None  # [{file, line, message, suggestion, severity}]
    )
    # Diff from last incremental refresh (from GitHub Compare API)
    last_diff: list[dict] | None = None


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
