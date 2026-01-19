"""Fetch educational content from GitHub repository."""

import os
from datetime import datetime

import httpx

from core.lessons.markdown_parser import (
    parse_lesson,
    parse_course,
    ParsedLesson,
    ParsedCourse,
)
from .cache import ContentCache, set_cache


class ContentBranchNotConfiguredError(Exception):
    """Raised when EDUCATIONAL_CONTENT_BRANCH is not set."""

    pass


class GitHubFetchError(Exception):
    """Raised when fetching from GitHub fails."""

    pass


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


def _get_api_url(path: str) -> str:
    """Get GitHub API URL for listing directory contents."""
    branch = get_content_branch()
    return f"https://api.github.com/repos/{CONTENT_REPO}/contents/{path}?ref={branch}"


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
        path: Path relative to repo root (e.g., "lessons/introduction.md")

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
        path: Directory path relative to repo root (e.g., "lessons")

    Returns:
        List of file paths (e.g., ["lessons/intro.md", "lessons/advanced.md"])

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


async def fetch_all_content() -> ContentCache:
    """Fetch all educational content from GitHub.

    Returns:
        ContentCache with all content loaded

    Raises:
        GitHubFetchError: If any fetch fails
    """
    async with httpx.AsyncClient() as client:
        # List all files in each directory
        lesson_files = await _list_directory_with_client(client, "lessons")
        course_files = await _list_directory_with_client(client, "courses")
        article_files = await _list_directory_with_client(client, "articles")
        transcript_files = await _list_directory_with_client(
            client, "video_transcripts"
        )

        # Fetch and parse lessons
        lessons: dict[str, ParsedLesson] = {}
        for path in lesson_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                parsed = parse_lesson(content)
                lessons[parsed.slug] = parsed

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
            lessons=lessons,
            articles=articles,
            video_transcripts=video_transcripts,
            last_refreshed=datetime.now(),
        )


async def _fetch_file_with_client(client: httpx.AsyncClient, path: str) -> str:
    """Fetch a file using an existing client."""
    url = _get_raw_url(path)
    headers = _get_headers(for_api=False)
    response = await client.get(url, headers=headers)
    if response.status_code != 200:
        raise GitHubFetchError(f"Failed to fetch {path}: HTTP {response.status_code}")
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
    print(f"  Loaded {len(cache.lessons)} lessons")
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
