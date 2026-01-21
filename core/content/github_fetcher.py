"""Fetch educational content from GitHub repository."""

import base64
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import httpx

from core.modules.markdown_parser import (
    parse_module,
    parse_course,
    ParsedModule,
    ParsedCourse,
)
from .cache import ContentCache, set_cache, get_cache

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


CONTENT_REPO = "lucbrinkman/lens-educational-content"


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


async def fetch_all_content() -> ContentCache:
    """Fetch all educational content from GitHub.

    Returns:
        ContentCache with all content loaded, including latest commit SHA

    Raises:
        GitHubFetchError: If any fetch fails
    """
    async with httpx.AsyncClient() as client:
        # Get the latest commit SHA for tracking
        commit_sha = await _get_latest_commit_sha_with_client(client)

        # List all files in each directory
        module_files = await _list_directory_with_client(client, "modules")
        course_files = await _list_directory_with_client(client, "courses")
        article_files = await _list_directory_with_client(client, "articles")
        transcript_files = await _list_directory_with_client(
            client, "video_transcripts"
        )

        # Fetch and parse modules
        modules: dict[str, ParsedModule] = {}
        for path in module_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                parsed = parse_module(content)
                modules[parsed.slug] = parsed

        # Fetch and parse courses
        courses: dict[str, ParsedCourse] = {}
        for path in course_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                parsed = parse_course(content)
                courses[parsed.slug] = parsed

        # Fetch articles (raw markdown)
        articles: dict[str, str] = {}
        for path in article_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                # Store with path relative to repo root
                articles[path] = content

        # Fetch video transcripts (raw markdown)
        video_transcripts: dict[str, str] = {}
        for path in transcript_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                video_transcripts[path] = content

        return ContentCache(
            courses=courses,
            modules=modules,
            articles=articles,
            video_transcripts=video_transcripts,
            last_refreshed=datetime.now(),
            last_commit_sha=commit_sha,
        )


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
    print(f"  Loaded {len(cache.modules)} modules")
    print(f"  Loaded {len(cache.articles)} articles")
    print(f"  Loaded {len(cache.video_transcripts)} video transcripts")
    print("Content cache initialized")


async def refresh_cache() -> None:
    """Re-fetch all content and update the cache.

    Called by webhook endpoint.
    """
    print("Refreshing educational content cache...")
    cache = await fetch_all_content()
    set_cache(cache)
    print(f"Cache refreshed at {cache.last_refreshed}")


# Tracked directories for incremental updates
TRACKED_DIRECTORIES = ("modules/", "courses/", "articles/", "video_transcripts/")


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
) -> None:
    """Apply a single file change to the cache.

    Args:
        client: HTTP client for fetching file content
        cache: The content cache to update
        change: The file change to apply
        ref: Commit SHA for cache-busting when fetching files

    For modules and courses: parse and store by slug
    For articles and video_transcripts: store raw markdown by path
    """
    tracked_dir = _get_tracked_directory(change.path)
    if tracked_dir is None:
        # File is not in a tracked directory, skip it
        return

    # Handle removals first
    if change.status == "removed":
        if tracked_dir == "modules":
            # For simplicity, we'll delete by checking if the filename matches slug
            # e.g., modules/intro.md -> slug might be "intro"
            # Note: This assumes filename (without .md) matches the slug, which is
            # the common convention. A more robust solution would track path->slug mapping.
            filename = change.path.split("/")[-1]
            if filename.endswith(".md"):
                potential_slug = filename[:-3]  # Remove .md extension
                if potential_slug in cache.modules:
                    del cache.modules[potential_slug]
                    logger.info(f"Removed module: {potential_slug}")

        elif tracked_dir == "courses":
            filename = change.path.split("/")[-1]
            if filename.endswith(".md"):
                potential_slug = filename[:-3]
                if potential_slug in cache.courses:
                    del cache.courses[potential_slug]
                    logger.info(f"Removed course: {potential_slug}")

        elif tracked_dir == "articles":
            if change.path in cache.articles:
                del cache.articles[change.path]
                logger.info(f"Removed article: {change.path}")

        elif tracked_dir == "video_transcripts":
            if change.path in cache.video_transcripts:
                del cache.video_transcripts[change.path]
                logger.info(f"Removed video transcript: {change.path}")

        return

    # Handle renamed files - delete old path first
    if change.status == "renamed" and change.previous_path:
        prev_tracked_dir = _get_tracked_directory(change.previous_path)
        if prev_tracked_dir == "modules":
            filename = change.previous_path.split("/")[-1]
            if filename.endswith(".md"):
                potential_slug = filename[:-3]
                if potential_slug in cache.modules:
                    del cache.modules[potential_slug]
                    logger.info(f"Removed renamed module: {potential_slug}")

        elif prev_tracked_dir == "courses":
            filename = change.previous_path.split("/")[-1]
            if filename.endswith(".md"):
                potential_slug = filename[:-3]
                if potential_slug in cache.courses:
                    del cache.courses[potential_slug]
                    logger.info(f"Removed renamed course: {potential_slug}")

        elif prev_tracked_dir == "articles":
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
            return

        try:
            content = await _fetch_file_with_client(client, change.path, ref=ref)

            if tracked_dir == "modules":
                parsed = parse_module(content)
                cache.modules[parsed.slug] = parsed
                logger.info(f"Updated module: {parsed.slug}")

            elif tracked_dir == "courses":
                parsed = parse_course(content)
                cache.courses[parsed.slug] = parsed
                logger.info(f"Updated course: {parsed.slug}")

            elif tracked_dir == "articles":
                cache.articles[change.path] = content
                logger.info(f"Updated article: {change.path}")

            elif tracked_dir == "video_transcripts":
                cache.video_transcripts[change.path] = content
                logger.info(f"Updated video transcript: {change.path}")

        except Exception as e:
            logger.warning(f"Failed to fetch/parse {change.path}: {e}")
            # Continue with other files, don't fail the entire refresh


async def incremental_refresh(new_commit_sha: str) -> None:
    """Refresh cache incrementally based on changed files.

    1. Get current cache's last_commit_sha
    2. If None, do full refresh (first run)
    3. Compare commits to get changed files
    4. If truncated, do full refresh
    5. For each changed file:
       - added/modified: fetch and update cache (parse modules/courses, store articles/transcripts raw)
       - removed: delete from cache
       - renamed: delete old path, fetch new path
    6. Update last_commit_sha and last_refreshed

    Falls back to full refresh on any error.

    Args:
        new_commit_sha: The SHA of the commit to update to
    """
    try:
        cache = get_cache()
    except Exception:
        # Cache not initialized - do full refresh
        logger.info("Cache not initialized, performing full refresh")
        await refresh_cache()
        return

    # Fallback: no previous SHA (first run or cache was cleared)
    if not cache.last_commit_sha:
        logger.info("No previous commit SHA, performing full refresh")
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

        # Apply incremental changes
        print(
            f"Applying {len(comparison.files)} file changes "
            f"({cache.last_commit_sha[:8]}...{new_commit_sha[:8]})"
        )
        logger.info(
            f"Applying {len(comparison.files)} file changes "
            f"({cache.last_commit_sha[:8]}...{new_commit_sha[:8]})"
        )

        async with httpx.AsyncClient() as client:
            for change in comparison.files:
                await _apply_file_change(client, cache, change, ref=new_commit_sha)

        # Update cache metadata
        cache.last_commit_sha = new_commit_sha
        cache.last_refreshed = datetime.now()

        print(f"Incremental refresh complete, now at commit {new_commit_sha[:8]}")
        logger.info(f"Incremental refresh complete, now at commit {new_commit_sha[:8]}")

    except Exception as e:
        logger.warning(f"Incremental refresh failed, falling back to full refresh: {e}")
        await refresh_cache()
