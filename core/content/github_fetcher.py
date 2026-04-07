"""Fetch educational content from GitHub repository.

Uses local git clone (via git_fetcher) instead of GitHub API for content I/O.
GitHub API is still used for commit comparison (frontend diff display) and
as a fallback for latest commit SHA when clone doesn't exist yet.
"""

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

import httpx

from core.modules.flattened_types import (
    FlattenedModule,
    ParsedCourse,
    ModuleRef,
    MeetingMarker,
)
from core.content.typescript_processor import (
    process_content_typescript,
    TypeScriptProcessorError,
)
from core.content import git_fetcher
from .cache import ContentCache, set_cache, get_cache


def _convert_ts_course_to_parsed_course(ts_course: dict) -> ParsedCourse:
    """Convert TypeScript course output to ParsedCourse with proper dataclass instances.

    TypeScript outputs progression items as dicts:
        {"type": "module", "slug": "intro", "optional": false}
        {"type": "meeting", "name": "Introduction"}

    This function converts them to ModuleRef and MeetingMarker instances.
    """
    progression = []
    for item in ts_course.get("progression", []):
        if item.get("type") == "module":
            progression.append(
                ModuleRef(
                    slug=item["slug"],
                    optional=item.get("optional", False),
                )
            )
        elif item.get("type") == "meeting":
            progression.append(MeetingMarker(name=item["name"]))

    return ParsedCourse(
        slug=ts_course["slug"],
        title=ts_course["title"],
        progression=progression,
        slug_aliases=ts_course.get("slugAliases", []),
    )


logger = logging.getLogger(__name__)


class ContentBranchNotConfiguredError(Exception):
    """Raised when EDUCATIONAL_CONTENT_BRANCH is not set."""

    pass


class GitHubFetchError(Exception):
    """Raised when fetching from GitHub fails."""

    pass


@dataclass
class ChangedFile:
    """Represents a file changed between two commits."""

    path: str
    status: Literal["added", "modified", "removed", "renamed"]
    previous_path: str | None = None  # For renamed files
    additions: int = 0
    deletions: int = 0
    patch: str | None = None


@dataclass
class CommitComparison:
    """Result of comparing two commits."""

    files: list[ChangedFile]
    is_truncated: bool  # True if GitHub's 300 file limit exceeded


CONTENT_REPO = "Lens-Academy/lens-edu-relay"


def _try_parse_uuid(value: str | None) -> UUID | None:
    """Parse a UUID string, returning None if missing or malformed."""
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError:
        logger.warning("Invalid UUID in content: %s", value)
        return None


def get_content_branch() -> str:
    """Get the content branch from environment.

    Raises:
        ContentBranchNotConfiguredError: If EDUCATIONAL_CONTENT_BRANCH not set.
    """
    branch = os.getenv("EDUCATIONAL_CONTENT_BRANCH")
    if not branch:
        raise ContentBranchNotConfiguredError(
            "EDUCATIONAL_CONTENT_BRANCH environment variable is required. "
            "Set to 'staging' for dev/staging or 'main' for production."
        )
    return branch


def _get_github_token() -> str | None:
    """Get optional GitHub token for API requests."""
    return os.getenv("GITHUB_TOKEN")


def _get_clone_dir() -> Path:
    """Get workspace-specific clone directory."""
    branch = get_content_branch()
    port = os.getenv("API_PORT", "8000")
    return Path(f"/tmp/lens-edu-relay-{branch}-{port}")


def _get_repo_url() -> str:
    """Get authenticated git URL for cloning."""
    token = _get_github_token()
    if token:
        return f"https://x-access-token:{token}@github.com/{CONTENT_REPO}.git"
    return f"https://github.com/{CONTENT_REPO}.git"


def _get_commit_api_url() -> str:
    """Get GitHub API URL for fetching latest commit on the content branch."""
    branch = get_content_branch()
    return f"https://api.github.com/repos/{CONTENT_REPO}/commits/{branch}"


def _get_compare_api_url(base_sha: str, head_sha: str) -> str:
    """Get GitHub API URL for comparing two commits."""
    return (
        f"https://api.github.com/repos/{CONTENT_REPO}/compare/{base_sha}...{head_sha}"
    )


def _get_headers(for_api: bool = False) -> dict[str, str]:
    """Get HTTP headers for GitHub requests."""
    headers = {}
    if for_api:
        headers["Accept"] = "application/vnd.github.v3+json"
    token = _get_github_token()
    if token:
        headers["Authorization"] = f"token {token}"
    return headers


async def fetch_file(path: str) -> str:
    """Fetch a single file from the content repo. Reads from local git clone.

    Args:
        path: Path relative to repo root (e.g., "modules/introduction.md")

    Returns:
        File content as string

    Raises:
        GitHubFetchError: If file not found
    """
    clone_dir = _get_clone_dir()
    file_path = clone_dir / path
    if file_path.exists():
        return file_path.read_text(encoding="utf-8")
    raise GitHubFetchError(f"File not found: {path} (clone dir: {clone_dir})")


async def get_latest_commit_sha() -> str:
    """Get the SHA of the latest commit on the content branch.

    Uses local git clone if available, falls back to GitHub API.

    Raises:
        GitHubFetchError: If both methods fail
    """
    clone_dir = _get_clone_dir()
    if not (clone_dir / ".git").exists():
        # Not cloned yet — fall back to API
        async with httpx.AsyncClient() as client:
            return await _get_latest_commit_sha_with_client(client)
    branch = get_content_branch()
    return await git_fetcher.fetch_latest_sha(clone_dir, branch)


async def compare_commits(base_sha: str, head_sha: str) -> CommitComparison:
    """Compare two commits and return changed files.

    Uses: GET /repos/{owner}/{repo}/compare/{base}...{head}

    Args:
        base_sha: The older commit SHA
        head_sha: The newer commit SHA

    Returns:
        CommitComparison with:
        - files: list of ChangedFile (path, status)
        - is_truncated: True if >300 files (check if len(files) >= 300)

    Raises:
        GitHubFetchError: If API call fails
    """
    url = _get_compare_api_url(base_sha, head_sha)
    headers = _get_headers(for_api=True)

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            raise GitHubFetchError(
                f"Failed to compare commits {base_sha}...{head_sha}: "
                f"HTTP {response.status_code}"
            )

        data = response.json()
        files_data = data.get("files", [])

        changed_files = []
        for file_info in files_data:
            # Map GitHub status to our status type
            status = file_info.get("status", "modified")
            # GitHub uses "removed" for deleted files
            if status not in ("added", "modified", "removed", "renamed"):
                status = "modified"  # Default fallback

            previous_path = None
            if status == "renamed":
                previous_path = file_info.get("previous_filename")

            changed_files.append(
                ChangedFile(
                    path=file_info["filename"],
                    status=status,
                    previous_path=previous_path,
                    additions=file_info.get("additions", 0),
                    deletions=file_info.get("deletions", 0),
                    patch=file_info.get("patch"),
                )
            )

        # GitHub's Compare API has a 300 file limit
        is_truncated = len(changed_files) >= 300

        return CommitComparison(files=changed_files, is_truncated=is_truncated)


def _parse_frontmatter(content: str) -> dict:
    """Parse YAML frontmatter from markdown content."""
    match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}

    metadata = {}
    for line in match.group(1).split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip()
    return metadata


async def fetch_all_content() -> ContentCache:
    """Fetch all educational content via git clone.

    Modules are flattened by TypeScript subprocess - all Learning Outcome and
    Uncategorized references are resolved to lens-video/lens-article sections.

    Returns:
        ContentCache with all content loaded, including latest commit SHA

    Raises:
        GitHubFetchError: If any fetch fails
    """
    clone_dir = _get_clone_dir()
    branch = get_content_branch()
    repo_url = _get_repo_url()

    # Clone if not exists, otherwise fetch+reset
    if not (clone_dir / ".git").exists():
        await git_fetcher.clone_repo(repo_url, branch, clone_dir)
    else:
        await git_fetcher.fetch_and_reset(clone_dir, branch)

    commit_sha = await git_fetcher.get_head_sha(clone_dir)

    # Read all files from disk
    all_files = await git_fetcher.read_all_files(clone_dir)
    logger.info("Read %d files from local clone", len(all_files))

    # Extract articles and video_transcripts into separate dicts
    articles: dict[str, str] = {
        path: content
        for path, content in all_files.items()
        if path.startswith("articles/") and path.endswith(".md")
    }

    video_transcripts: dict[str, str] = {
        path: content
        for path, content in all_files.items()
        if path.startswith("video_transcripts/") and path.endswith(".md")
    }

    # Parse timestamp files
    video_timestamps: dict[str, list[dict]] = {}
    for path, content in all_files.items():
        if path.endswith(".timestamps.json"):
            try:
                timestamps_data = json.loads(content)
                md_path = path.replace(".timestamps.json", ".md")
                if md_path in video_transcripts:
                    metadata = _parse_frontmatter(video_transcripts[md_path])
                    video_id = metadata.get("video_id", "")
                    if not video_id and metadata.get("url"):
                        url = metadata["url"].strip("\"'")
                        match = re.search(
                            r"(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)",
                            url,
                        )
                        if match:
                            video_id = match.group(1)
                    if video_id:
                        video_timestamps[video_id] = timestamps_data
            except Exception as e:
                logger.warning(f"Failed to parse timestamps {path}: {e}")

    # Process all content with TypeScript subprocess
    try:
        ts_result = await process_content_typescript(all_files)
    except TypeScriptProcessorError as e:
        logger.error(f"TypeScript processing failed: {e}")
        raise GitHubFetchError(f"Content processing failed: {e}")

    # Convert TypeScript result to Python cache format
    flattened_modules: dict[str, FlattenedModule] = {}
    for mod in ts_result.get("modules", []):
        flattened_modules[mod["slug"]] = FlattenedModule(
            slug=mod["slug"],
            title=mod["title"],
            content_id=_try_parse_uuid(mod.get("contentId")),
            sections=mod["sections"],
            source_path=mod.get("sourcePath"),
            error=mod.get("error"),
            parent_slug=mod.get("parentSlug"),
            parent_title=mod.get("parentTitle"),
        )

    # Convert courses from TypeScript result
    courses: dict[str, ParsedCourse] = {}
    for course in ts_result.get("courses", []):
        courses[course["slug"]] = _convert_ts_course_to_parsed_course(course)

    course_slug_aliases: dict[str, str] = {}
    for course in courses.values():
        for alias in course.slug_aliases:
            course_slug_aliases[alias] = course.slug

    # Extract validation errors from TypeScript result
    validation_errors = ts_result.get("errors", [])

    # Build and return cache
    now = datetime.now(UTC)
    cache = ContentCache(
        courses=courses,
        course_slug_aliases=course_slug_aliases,
        flattened_modules=flattened_modules,
        parsed_learning_outcomes={},  # No longer needed - TS handles
        parsed_lenses={},  # No longer needed - TS handles
        articles=articles,
        video_transcripts=video_transcripts,
        video_timestamps=video_timestamps,
        last_refreshed=now,
        last_commit_sha=commit_sha,
        known_sha=commit_sha,
        known_sha_timestamp=now,
        fetched_sha=commit_sha,
        fetched_sha_timestamp=now,
        processed_sha=commit_sha,
        processed_sha_timestamp=now,
        raw_files=all_files,  # Store for incremental updates
        validation_errors=validation_errors,
    )
    set_cache(cache)
    return cache


async def _get_latest_commit_sha_with_client(client: httpx.AsyncClient) -> str:
    """Get the latest commit SHA using an existing client."""
    url = _get_commit_api_url()
    headers = _get_headers(for_api=True)
    response = await client.get(url, headers=headers)
    if response.status_code != 200:
        raise GitHubFetchError(
            f"Failed to get latest commit: HTTP {response.status_code}"
        )
    data = response.json()
    return data["sha"]


async def initialize_cache() -> None:
    """Fetch all content and initialize the cache.

    Called on server startup.

    Raises:
        ContentBranchNotConfiguredError: If branch not configured
        GitHubFetchError: If fetch fails
    """
    print(f"Fetching educational content from GitHub ({CONTENT_REPO})...")
    branch = get_content_branch()
    print(f"  Branch: {branch}")

    cache = await fetch_all_content()
    set_cache(cache)

    print(f"  Loaded {len(cache.courses)} courses")
    print(f"  Loaded {len(cache.flattened_modules)} modules (flattened)")
    print(f"  Loaded {len(cache.articles)} articles")
    print(f"  Loaded {len(cache.video_transcripts)} video transcripts")
    print(f"  Loaded {len(cache.video_timestamps)} video timestamps")
    print("Content cache initialized (TypeScript processor handles LO/lens parsing)")


async def refresh_cache() -> list[dict]:
    """Re-fetch all content and update the cache.

    Called by webhook endpoint.

    Returns:
        List of validation errors/warnings from content processing.
    """
    print("Refreshing educational content cache...")
    cache = await fetch_all_content()
    set_cache(cache)
    errors = cache.validation_errors or []
    error_count = len([e for e in errors if e.get("severity") == "error"])
    warning_count = len([e for e in errors if e.get("severity") == "warning"])
    print(
        f"Cache refreshed at {cache.last_refreshed} ({error_count} errors, {warning_count} warnings)"
    )
    return errors


# Tracked directories for incremental updates
TRACKED_DIRECTORIES = (
    "modules/",
    "courses/",
    "articles/",
    "video_transcripts/",
    "Learning Outcomes/",
    "Lenses/",
)


def _get_tracked_directory(path: str) -> str | None:
    """Get the tracked directory prefix for a path, or None if not tracked."""
    for prefix in TRACKED_DIRECTORIES:
        if path.startswith(prefix):
            return prefix.rstrip("/")
    return None


async def incremental_refresh(new_commit_sha: str) -> list[dict]:
    """Refresh cache incrementally based on changed files.

    Strategy:
    1. Update local clone via git fetch+reset
    2. Use GitHub Compare API for frontend diff display
    3. Re-read all files from disk
    4. Re-run TypeScript processing on all files
    5. Update cache with new results

    Falls back to full refresh if:
    - Cache not initialized
    - No previous commit SHA
    - No raw_files in cache (old cache format)
    - Any error during processing

    Args:
        new_commit_sha: The SHA of the commit to update to

    Returns:
        List of validation errors/warnings from content processing.
    """
    try:
        cache = get_cache()
    except Exception:
        logger.info("Cache not initialized, performing full refresh")
        return await refresh_cache()

    # Fallback: no previous SHA (first run or cache was cleared)
    if not cache.last_commit_sha:
        logger.info("No previous commit SHA, performing full refresh")
        return await refresh_cache()

    # Fallback: no raw_files (old cache format)
    if cache.raw_files is None:
        logger.info("No raw_files in cache, performing full refresh")
        return await refresh_cache()

    # Same commit, return cached errors without reprocessing
    if cache.last_commit_sha == new_commit_sha:
        print(f"Cache already at commit {new_commit_sha[:8]}, returning cached errors")
        logger.info(
            f"Cache already at commit {new_commit_sha}, returning cached errors"
        )
        return cache.validation_errors or []

    try:
        clone_dir = _get_clone_dir()
        branch = get_content_branch()

        # Update the local clone
        await git_fetcher.fetch_and_reset(clone_dir, branch)

        # Get diff data for frontend display (GitHub Compare API — 1 call)
        diff_data = []
        tracked_change_count = 0
        try:
            comparison = await compare_commits(cache.last_commit_sha, new_commit_sha)
            diff_data = [
                {
                    "filename": c.path,
                    "status": c.status,
                    "additions": c.additions,
                    "deletions": c.deletions,
                    "patch": c.patch,
                }
                for c in comparison.files
            ]
            tracked_change_count = sum(
                1
                for c in comparison.files
                if _get_tracked_directory(c.path) is not None
            )
        except Exception as e:
            logger.warning("Failed to get diff for frontend: %s", e)
            tracked_change_count = -1  # Unknown — assume changes exist

        # Optimization: skip re-read + TypeScript if no tracked files changed
        if tracked_change_count == 0:
            now = datetime.now(UTC)
            cache.last_commit_sha = new_commit_sha
            cache.fetched_sha = new_commit_sha
            cache.fetched_sha_timestamp = now
            cache.processed_sha = new_commit_sha
            cache.processed_sha_timestamp = now
            cache.last_diff = diff_data
            cache.last_refreshed = now
            return cache.validation_errors or []

        cache.fetched_sha = new_commit_sha
        cache.fetched_sha_timestamp = datetime.now(UTC)

        # Read ALL files fresh from disk
        raw_files = await git_fetcher.read_all_files(clone_dir)

        # Re-run TypeScript processing on all files
        logger.info(f"Re-processing {len(raw_files)} files with TypeScript...")
        try:
            ts_result = await process_content_typescript(raw_files)
        except TypeScriptProcessorError as e:
            logger.error(f"TypeScript processing failed: {e}")
            raise GitHubFetchError(f"Content processing failed: {e}")

        # Update cache with new results
        flattened_modules: dict[str, FlattenedModule] = {}
        for mod in ts_result.get("modules", []):
            flattened_modules[mod["slug"]] = FlattenedModule(
                slug=mod["slug"],
                title=mod["title"],
                content_id=_try_parse_uuid(mod.get("contentId")),
                sections=mod["sections"],
                source_path=mod.get("sourcePath"),
                error=mod.get("error"),
                parent_slug=mod.get("parentSlug"),
                parent_title=mod.get("parentTitle"),
            )

        courses: dict[str, ParsedCourse] = {}
        for course in ts_result.get("courses", []):
            courses[course["slug"]] = _convert_ts_course_to_parsed_course(course)

        # Update articles and video_transcripts dicts
        articles = {
            path: content
            for path, content in raw_files.items()
            if path.startswith("articles/") and path.endswith(".md")
        }

        video_transcripts = {
            path: content
            for path, content in raw_files.items()
            if path.startswith("video_transcripts/") and path.endswith(".md")
        }

        # Parse timestamp files
        video_timestamps: dict[str, list[dict]] = {}
        for path, content in raw_files.items():
            if path.endswith(".timestamps.json"):
                try:
                    timestamps_data = json.loads(content)
                    md_path = path.replace(".timestamps.json", ".md")
                    if md_path in video_transcripts:
                        metadata = _parse_frontmatter(video_transcripts[md_path])
                        video_id = metadata.get("video_id", "")
                        if not video_id and metadata.get("url"):
                            url = metadata["url"].strip("\"'")
                            match = re.search(
                                r"(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)",
                                url,
                            )
                            if match:
                                video_id = match.group(1)
                        if video_id:
                            video_timestamps[video_id] = timestamps_data
                except Exception as e:
                    logger.warning(f"Failed to parse timestamps {path}: {e}")

        # Extract validation errors from TypeScript result
        validation_errors = ts_result.get("errors", [])

        # Update cache in place
        cache.courses = courses
        course_slug_aliases: dict[str, str] = {}
        for course in courses.values():
            for alias in course.slug_aliases:
                course_slug_aliases[alias] = course.slug
        cache.course_slug_aliases = course_slug_aliases
        cache.flattened_modules = flattened_modules
        cache.articles = articles
        cache.video_transcripts = video_transcripts
        cache.video_timestamps = video_timestamps
        cache.raw_files = raw_files
        cache.last_commit_sha = new_commit_sha
        cache.processed_sha = new_commit_sha
        cache.processed_sha_timestamp = datetime.now(UTC)
        cache.last_diff = diff_data
        cache.last_refreshed = datetime.now(UTC)
        cache.validation_errors = validation_errors

        error_count = len(
            [e for e in validation_errors if e.get("severity") == "error"]
        )
        warning_count = len(
            [e for e in validation_errors if e.get("severity") == "warning"]
        )
        print(
            f"Incremental refresh complete, now at commit {new_commit_sha[:8]} ({error_count} errors, {warning_count} warnings)"
        )
        logger.info(f"Incremental refresh complete, now at commit {new_commit_sha[:8]}")

        return validation_errors

    except Exception as e:
        logger.warning(f"Incremental refresh failed, falling back to full refresh: {e}")
        return await refresh_cache()
