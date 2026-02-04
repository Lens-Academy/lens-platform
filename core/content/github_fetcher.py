"""Fetch educational content from GitHub repository."""

import base64
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
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
from .cache import ContentCache, set_cache, get_cache


def _convert_ts_course_to_parsed_course(ts_course: dict) -> ParsedCourse:
    """Convert TypeScript course output to ParsedCourse with proper dataclass instances.

    TypeScript outputs progression items as dicts:
        {"type": "module", "slug": "intro", "optional": false}
        {"type": "meeting", "number": 1}

    This function converts them to ModuleRef and MeetingMarker instances.
    """
    progression = []
    for item in ts_course.get("progression", []):
        if item.get("type") == "module":
            progression.append(
                ModuleRef(
                    path=f"modules/{item['slug']}",
                    optional=item.get("optional", False),
                )
            )
        elif item.get("type") == "meeting":
            progression.append(MeetingMarker(number=item["number"]))

    return ParsedCourse(
        slug=ts_course["slug"],
        title=ts_course["title"],
        progression=progression,
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


@dataclass
class CommitComparison:
    """Result of comparing two commits."""

    files: list[ChangedFile]
    is_truncated: bool  # True if GitHub's 300 file limit exceeded


CONTENT_REPO = "Lens-Academy/lens-edu-relay"


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


def _get_raw_url(path: str) -> str:
    """Get raw.githubusercontent.com URL for a file."""
    branch = get_content_branch()
    return f"https://raw.githubusercontent.com/{CONTENT_REPO}/{branch}/{path}"


def _get_contents_api_url(path: str, ref: str | None = None) -> str:
    """Get GitHub API URL for fetching file contents.

    Uses the Contents API which properly respects the ref parameter,
    avoiding CDN caching issues with raw.githubusercontent.com.

    Args:
        path: File path relative to repo root
        ref: Commit SHA or branch name (defaults to configured branch)
    """
    ref = ref or get_content_branch()
    return f"https://api.github.com/repos/{CONTENT_REPO}/contents/{path}?ref={ref}"


def _get_api_url(path: str) -> str:
    """Get GitHub API URL for listing directory contents."""
    branch = get_content_branch()
    return f"https://api.github.com/repos/{CONTENT_REPO}/contents/{path}?ref={branch}"


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
    """Fetch a single file from GitHub.

    Args:
        path: Path relative to repo root (e.g., "modules/introduction.md")

    Returns:
        File content as string

    Raises:
        GitHubFetchError: If fetch fails
    """
    url = _get_raw_url(path)
    headers = _get_headers(for_api=False)

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            raise GitHubFetchError(
                f"Failed to fetch {path}: HTTP {response.status_code}"
            )
        return response.text


async def list_directory(path: str) -> list[str]:
    """List files in a directory using GitHub API.

    Args:
        path: Directory path relative to repo root (e.g., "modules")

    Returns:
        List of file paths (e.g., ["modules/intro.md", "modules/advanced.md"])

    Raises:
        GitHubFetchError: If API call fails
    """
    url = _get_api_url(path)
    headers = _get_headers(for_api=True)

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            raise GitHubFetchError(
                f"Failed to list {path}: HTTP {response.status_code}"
            )

        data = response.json()
        return [item["path"] for item in data if item["type"] == "file"]


async def get_latest_commit_sha() -> str:
    """Get the SHA of the latest commit on the content branch.

    Uses: GET /repos/{owner}/{repo}/commits/{branch}
    Returns just the SHA string.

    Raises:
        GitHubFetchError: If API call fails
    """
    async with httpx.AsyncClient() as client:
        return await _get_latest_commit_sha_with_client(client)


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
    """Fetch all educational content from GitHub.

    Modules are flattened by TypeScript subprocess - all Learning Outcome and
    Uncategorized references are resolved to lens-video/lens-article sections.

    Returns:
        ContentCache with all content loaded, including latest commit SHA

    Raises:
        GitHubFetchError: If any fetch fails
    """
    import asyncio

    async with httpx.AsyncClient() as client:
        # Get the latest commit SHA for tracking
        commit_sha = await _get_latest_commit_sha_with_client(client)

        # List all directories in parallel
        (
            module_files,
            course_files,
            article_files,
            transcript_files,
            learning_outcome_files,
            lens_files,
        ) = await asyncio.gather(
            _list_directory_with_client(client, "modules"),
            _list_directory_with_client(client, "courses"),
            _list_directory_with_client(client, "articles"),
            _list_directory_with_client(client, "video_transcripts"),
            _list_directory_with_client(client, "Learning Outcomes"),
            _list_directory_with_client(client, "Lenses"),
        )

        # Collect all file paths to fetch
        paths_to_fetch: list[str] = []

        for path in module_files:
            if path.endswith(".md"):
                paths_to_fetch.append(path)

        for path in course_files:
            if path.endswith(".md"):
                paths_to_fetch.append(path)

        for path in learning_outcome_files:
            if path.endswith(".md"):
                paths_to_fetch.append(path)

        for path in lens_files:
            if path.endswith(".md"):
                paths_to_fetch.append(path)

        for path in article_files:
            if path.endswith(".md"):
                paths_to_fetch.append(path)

        for path in transcript_files:
            if path.endswith(".md") or path.endswith(".timestamps.json"):
                paths_to_fetch.append(path)

        # Fetch all files in parallel with concurrency limit
        logger.info(f"Fetching {len(paths_to_fetch)} files from GitHub...")
        semaphore = asyncio.Semaphore(20)  # Limit concurrent requests

        async def fetch_with_semaphore(path: str) -> str:
            async with semaphore:
                return await _fetch_file_with_client(client, path, ref=commit_sha)

        contents = await asyncio.gather(
            *[fetch_with_semaphore(path) for path in paths_to_fetch]
        )

        # Build path -> content mapping
        all_files: dict[str, str] = dict(zip(paths_to_fetch, contents))

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
                content_id=UUID(mod["contentId"]) if mod.get("contentId") else None,
                sections=mod["sections"],
                error=mod.get("error"),
            )

        # Convert courses from TypeScript result
        courses: dict[str, ParsedCourse] = {}
        for course in ts_result.get("courses", []):
            courses[course["slug"]] = _convert_ts_course_to_parsed_course(course)

        # Build and return cache
        cache = ContentCache(
            courses=courses,
            flattened_modules=flattened_modules,
            parsed_learning_outcomes={},  # No longer needed - TS handles
            parsed_lenses={},  # No longer needed - TS handles
            articles=articles,
            video_transcripts=video_transcripts,
            video_timestamps=video_timestamps,
            last_refreshed=datetime.now(),
            last_commit_sha=commit_sha,
            raw_files=all_files,  # Store for incremental updates
        )
        set_cache(cache)
        return cache


async def _fetch_file_with_client(
    client: httpx.AsyncClient, path: str, ref: str | None = None
) -> str:
    """Fetch a file using an existing client.

    Args:
        client: HTTP client
        path: File path relative to repo root
        ref: Optional commit SHA - when provided, uses Contents API to avoid CDN cache

    When ref is provided, uses GitHub Contents API which properly respects
    the ref parameter. Without ref, uses raw.githubusercontent.com which is
    faster but has a 5-minute CDN cache.
    """
    if ref:
        # Use Contents API for specific commits (bypasses CDN cache)
        url = _get_contents_api_url(path, ref=ref)
        headers = _get_headers(for_api=True)
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            raise GitHubFetchError(
                f"Failed to fetch {path}: HTTP {response.status_code}"
            )
        data = response.json()
        # Contents API returns base64-encoded content
        return base64.b64decode(data["content"]).decode("utf-8")
    else:
        # Use raw URL for speed (e.g., during full refresh)
        url = _get_raw_url(path)
        headers = _get_headers(for_api=False)
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            raise GitHubFetchError(
                f"Failed to fetch {path}: HTTP {response.status_code}"
            )
        return response.text


async def _list_directory_with_client(
    client: httpx.AsyncClient, path: str
) -> list[str]:
    """List directory contents using an existing client."""
    url = _get_api_url(path)
    headers = _get_headers(for_api=True)
    response = await client.get(url, headers=headers)
    if response.status_code != 200:
        raise GitHubFetchError(f"Failed to list {path}: HTTP {response.status_code}")
    data = response.json()
    return [item["path"] for item in data if item["type"] == "file"]


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


async def refresh_cache() -> None:
    """Re-fetch all content and update the cache.

    Called by webhook endpoint.
    """
    print("Refreshing educational content cache...")
    cache = await fetch_all_content()
    set_cache(cache)
    print(f"Cache refreshed at {cache.last_refreshed}")


# Tracked directories for incremental updates
TRACKED_DIRECTORIES = (
    "modules/",
    "courses/",
    "articles/",
    "video_transcripts/",
    "learning_outcomes/",
    "lenses/",
)


def _get_tracked_directory(path: str) -> str | None:
    """Get the tracked directory prefix for a path, or None if not tracked."""
    for prefix in TRACKED_DIRECTORIES:
        if path.startswith(prefix):
            return prefix.rstrip("/")
    return None


async def _apply_file_change(
    client: httpx.AsyncClient,
    cache: ContentCache,
    change: ChangedFile,
    ref: str | None = None,
) -> bool:
    """Apply a single file change to the cache.

    Args:
        client: HTTP client for fetching file content
        cache: The content cache to update
        change: The file change to apply
        ref: Commit SHA for cache-busting when fetching files

    Returns:
        True if a full refresh is needed (module/LO/Lens changed), False otherwise.

    For modules, LOs, Lenses: changes require full refresh for re-flattening
    For articles and video_transcripts: apply incremental update
    For courses: parse and store by slug
    """
    tracked_dir = _get_tracked_directory(change.path)
    if tracked_dir is None:
        # File is not in a tracked directory, skip it
        return False

    # Module, LO, Lens, and Course changes require full refresh
    # (TypeScript processor handles all content together)
    # Only process markdown files
    if tracked_dir in ("modules", "Learning Outcomes", "Lenses", "courses"):
        if change.path.endswith(".md"):
            logger.info(
                f"Change in {tracked_dir} ({change.path}) requires full refresh"
            )
            return True
        # Non-.md files in these directories don't require any action
        return False

    # Handle removals for articles and video_transcripts
    if change.status == "removed":
        if tracked_dir == "articles":
            if change.path in cache.articles:
                del cache.articles[change.path]
                logger.info(f"Removed article: {change.path}")

        elif tracked_dir == "video_transcripts":
            if change.path in cache.video_transcripts:
                del cache.video_transcripts[change.path]
                logger.info(f"Removed video transcript: {change.path}")

        return False

    # Handle renamed files - delete old path first
    if change.status == "renamed" and change.previous_path:
        prev_tracked_dir = _get_tracked_directory(change.previous_path)

        if prev_tracked_dir == "articles":
            if change.previous_path in cache.articles:
                del cache.articles[change.previous_path]
                logger.info(f"Removed renamed article: {change.previous_path}")

        elif prev_tracked_dir == "video_transcripts":
            if change.previous_path in cache.video_transcripts:
                del cache.video_transcripts[change.previous_path]
                logger.info(f"Removed renamed video transcript: {change.previous_path}")

    # Handle added, modified, or renamed (fetch new content)
    if change.status in ("added", "modified", "renamed"):
        # Only process markdown files
        if not change.path.endswith(".md"):
            return False

        try:
            content = await _fetch_file_with_client(client, change.path, ref=ref)

            if tracked_dir == "articles":
                cache.articles[change.path] = content
                logger.info(f"Updated article: {change.path}")

            elif tracked_dir == "video_transcripts":
                cache.video_transcripts[change.path] = content
                logger.info(f"Updated video transcript: {change.path}")

        except Exception as e:
            logger.warning(f"Failed to fetch/parse {change.path}: {e}")
            # Continue with other files, don't fail the entire refresh

    return False


async def incremental_refresh(new_commit_sha: str) -> None:
    """Refresh cache incrementally based on changed files.

    Strategy:
    1. Fetch only changed files from GitHub
    2. Merge changes into cached raw_files
    3. Re-run TypeScript processing on all files
    4. Update cache with new results

    Falls back to full refresh if:
    - Cache not initialized
    - No previous commit SHA
    - No raw_files in cache (old cache format)
    - Too many changes (GitHub's 300 file limit)
    - Any error during processing

    Args:
        new_commit_sha: The SHA of the commit to update to
    """
    import asyncio

    try:
        cache = get_cache()
    except Exception:
        logger.info("Cache not initialized, performing full refresh")
        await refresh_cache()
        return

    # Fallback: no previous SHA (first run or cache was cleared)
    if not cache.last_commit_sha:
        logger.info("No previous commit SHA, performing full refresh")
        await refresh_cache()
        return

    # Fallback: no raw_files (old cache format)
    if cache.raw_files is None:
        logger.info("No raw_files in cache, performing full refresh")
        await refresh_cache()
        return

    # Same commit, nothing to do
    if cache.last_commit_sha == new_commit_sha:
        print(f"Cache already at commit {new_commit_sha[:8]}, skipping refresh")
        logger.info(f"Cache already at commit {new_commit_sha}, skipping refresh")
        return

    try:
        comparison = await compare_commits(cache.last_commit_sha, new_commit_sha)

        # Fallback: too many changes (GitHub's 300 file limit)
        if comparison.is_truncated:
            logger.warning(
                "Compare result truncated (>= 300 files), performing full refresh"
            )
            await refresh_cache()
            return

        # Filter to only tracked files
        tracked_changes = [
            c for c in comparison.files if _get_tracked_directory(c.path) is not None
        ]

        if not tracked_changes:
            # No tracked files changed, just update commit SHA
            print(
                f"No tracked files changed, updating commit SHA to {new_commit_sha[:8]}"
            )
            cache.last_commit_sha = new_commit_sha
            cache.last_refreshed = datetime.now()
            return

        print(
            f"Incremental update: {len(tracked_changes)} tracked files changed "
            f"({cache.last_commit_sha[:8]}...{new_commit_sha[:8]})"
        )
        logger.info(
            f"Incremental update: {len(tracked_changes)} tracked files changed "
            f"({cache.last_commit_sha[:8]}...{new_commit_sha[:8]})"
        )

        # Fetch changed files in parallel
        files_to_fetch = [
            c for c in tracked_changes if c.status in ("added", "modified", "renamed")
        ]

        async with httpx.AsyncClient() as client:
            if files_to_fetch:
                contents = await asyncio.gather(
                    *[
                        _fetch_file_with_client(client, c.path, ref=new_commit_sha)
                        for c in files_to_fetch
                    ]
                )
                fetched = dict(zip([c.path for c in files_to_fetch], contents))
            else:
                fetched = {}

        # Apply changes to raw_files
        raw_files = dict(cache.raw_files)  # Make a copy

        for change in tracked_changes:
            if change.status == "removed":
                raw_files.pop(change.path, None)
                logger.info(f"Removed: {change.path}")
            elif change.status == "renamed":
                # Remove old path
                if change.previous_path:
                    raw_files.pop(change.previous_path, None)
                # Add new path
                if change.path in fetched:
                    raw_files[change.path] = fetched[change.path]
                logger.info(f"Renamed: {change.previous_path} -> {change.path}")
            else:  # added or modified
                if change.path in fetched:
                    raw_files[change.path] = fetched[change.path]
                logger.info(f"{change.status.title()}: {change.path}")

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
                content_id=UUID(mod["contentId"]) if mod.get("contentId") else None,
                sections=mod["sections"],
                error=mod.get("error"),
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

        # Update cache in place
        cache.courses = courses
        cache.flattened_modules = flattened_modules
        cache.articles = articles
        cache.video_transcripts = video_transcripts
        cache.video_timestamps = video_timestamps
        cache.raw_files = raw_files
        cache.last_commit_sha = new_commit_sha
        cache.last_refreshed = datetime.now()

        print(f"Incremental refresh complete, now at commit {new_commit_sha[:8]}")
        logger.info(f"Incremental refresh complete, now at commit {new_commit_sha[:8]}")

    except Exception as e:
        logger.warning(f"Incremental refresh failed, falling back to full refresh: {e}")
        await refresh_cache()
