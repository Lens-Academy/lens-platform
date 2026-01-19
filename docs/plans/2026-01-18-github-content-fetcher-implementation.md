# GitHub Content Fetcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace local file-based lesson loading with GitHub-based loading, caching content in memory.

**Architecture:** Fetch all educational content (courses, lessons, articles, video_transcripts) from `lucbrinkman/lens-educational-content` GitHub repo on server startup. Cache in memory. Refresh via webhook on push.

**Tech Stack:** Python 3.12, aiohttp for async HTTP, FastAPI for webhook endpoint

---

## Task 1: Fix Markdown Parser for Real Content

The existing parser needs updates to match the expected output format from our test fixtures.

**Files:**
- Modify: `core/lessons/markdown_parser.py`
- Test: `core/lessons/tests/test_markdown_parser.py`

**Step 1: Write test using real fixture**

Add to `core/lessons/tests/test_markdown_parser.py`:

```python
import json
from pathlib import Path


class TestRealLessonParsing:
    """Test parsing with real lesson fixture from GitHub."""

    def test_parse_introduction_sample(self):
        """Should parse the introduction sample matching expected output."""
        fixtures_dir = Path(__file__).parent / "fixtures"

        # Load markdown input
        md_path = fixtures_dir / "introduction_sample.md"
        md_content = md_path.read_text()

        # Load expected output
        json_path = fixtures_dir / "introduction_sample_expected.json"
        expected = json.loads(json_path.read_text())

        # Parse
        lesson = parse_lesson(md_content)

        # Verify basic fields
        assert lesson.slug == expected["slug"]
        assert lesson.title == expected["title"]
        assert len(lesson.sections) == len(expected["sections"])

        # Verify each section
        for i, (actual, exp) in enumerate(zip(lesson.sections, expected["sections"])):
            assert actual.type == exp["type"], f"Section {i} type mismatch"

            if exp["type"] == "video":
                assert actual.source == exp["source"]
                assert len(actual.segments) == len(exp["segments"])
            elif exp["type"] == "article":
                assert actual.source == exp["source"]
                assert len(actual.segments) == len(exp["segments"])
            elif exp["type"] == "chat":
                assert actual.show_user_previous_content == exp["show_user_previous_content"]
                assert actual.show_tutor_previous_content == exp["show_tutor_previous_content"]
```

**Step 2: Run test to verify it fails**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2
pytest core/lessons/tests/test_markdown_parser.py::TestRealLessonParsing -v
```

Expected: FAIL (parser currently includes `title` field, doesn't strip quotes, etc.)

**Step 3: Update parser - remove title from sections**

In `core/lessons/markdown_parser.py`, modify the section dataclasses to not store title:

```python
@dataclass
class VideoSection:
    """A video-based section with source and segments."""
    type: str = "video"
    source: str = ""
    segments: list[Segment] = field(default_factory=list)
    optional: bool = False


@dataclass
class ArticleSection:
    """An article-based section with source and segments."""
    type: str = "article"
    source: str = ""
    segments: list[Segment] = field(default_factory=list)
    optional: bool = False


@dataclass
class TextSection:
    """A standalone text section (no child segments)."""
    type: str = "text"
    content: str = ""


@dataclass
class ChatSection:
    """A standalone chat section (no child segments)."""
    type: str = "chat"
    instructions: str = ""
    show_user_previous_content: bool = True
    show_tutor_previous_content: bool = True
```

**Step 4: Update parser - add optional field parsing**

In `_parse_section()`, add optional field handling:

```python
def _parse_section(section_type: str, title: str, content: str) -> Section:
    """Parse a section block into the appropriate Section type."""
    fields = _parse_fields(content)
    section_type_lower = section_type.lower()

    # Parse optional flag (default False)
    optional = _parse_bool(fields.get("optional", "false"))

    if section_type_lower == "video":
        source = _extract_wiki_link(fields.get("source", ""))
        segment_data = _split_into_segments(content)
        segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]

        return VideoSection(
            source=source,
            segments=segments,
            optional=optional,
        )

    elif section_type_lower == "article":
        source = _extract_wiki_link(fields.get("source", ""))
        segment_data = _split_into_segments(content)
        segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]

        return ArticleSection(
            source=source,
            segments=segments,
            optional=optional,
        )
    # ... rest unchanged
```

**Step 5: Update parser - strip quotes from from/to values**

In `_parse_segment()`, strip outer quotes:

```python
def _strip_quotes(value: str | None) -> str | None:
    """Strip outer quotes from a value."""
    if value is None:
        return None
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or \
       (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value


def _parse_segment(segment_type: str, content: str) -> Segment:
    """Parse a segment block into the appropriate Segment type."""
    fields = _parse_fields(content)
    segment_type_lower = segment_type.lower()

    # ... existing code ...

    elif segment_type_lower == "article-excerpt":
        return ArticleExcerptSegment(
            from_text=_strip_quotes(fields.get("from")),
            to_text=_strip_quotes(fields.get("to")),
        )

    # ... rest unchanged
```

**Step 6: Run tests to verify they pass**

```bash
pytest core/lessons/tests/test_markdown_parser.py -v
```

Expected: All tests PASS

**Step 7: Commit**

```bash
git add core/lessons/markdown_parser.py core/lessons/tests/test_markdown_parser.py
git commit -m "fix(parser): update markdown parser to match expected output format

- Remove title field from section dataclasses
- Add optional field support for video/article sections
- Strip outer quotes from from/to excerpt values
- Add real fixture test for introduction sample"
```

---

## Task 2: Create Content Cache Module

**Files:**
- Create: `core/content/__init__.py`
- Create: `core/content/cache.py`
- Test: `core/content/tests/__init__.py`
- Test: `core/content/tests/test_cache.py`

**Step 1: Create module structure**

```bash
mkdir -p core/content/tests
touch core/content/__init__.py
touch core/content/tests/__init__.py
```

**Step 2: Write failing test for cache**

Create `core/content/tests/test_cache.py`:

```python
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
```

**Step 3: Run test to verify it fails**

```bash
pytest core/content/tests/test_cache.py -v
```

Expected: FAIL with "No module named 'core.content.cache'"

**Step 4: Implement cache module**

Create `core/content/cache.py`:

```python
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

    courses: dict[str, ParsedCourse]      # slug -> parsed course
    lessons: dict[str, ParsedLesson]      # slug -> parsed lesson
    articles: dict[str, str]              # path -> raw markdown
    video_transcripts: dict[str, str]     # path -> raw markdown
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
```

**Step 5: Update `core/content/__init__.py`**

```python
"""Content fetching and caching from GitHub."""

from .cache import (
    ContentCache,
    CacheNotInitializedError,
    get_cache,
    set_cache,
    clear_cache,
)

__all__ = [
    "ContentCache",
    "CacheNotInitializedError",
    "get_cache",
    "set_cache",
    "clear_cache",
]
```

**Step 6: Run tests to verify they pass**

```bash
pytest core/content/tests/test_cache.py -v
```

Expected: All tests PASS

**Step 7: Commit**

```bash
git add core/content/
git commit -m "feat(content): add in-memory content cache module

- ContentCache dataclass for courses, lessons, articles, transcripts
- get_cache/set_cache/clear_cache functions
- CacheNotInitializedError for fail-fast behavior"
```

---

## Task 3: Create GitHub Fetcher

**Files:**
- Create: `core/content/github_fetcher.py`
- Test: `core/content/tests/test_github_fetcher.py`

**Step 1: Write failing test for config validation**

Create `core/content/tests/test_github_fetcher.py`:

```python
"""Tests for GitHub content fetcher."""

import os
import pytest
from unittest.mock import patch

from core.content.github_fetcher import (
    get_content_branch,
    ContentBranchNotConfiguredError,
    CONTENT_REPO,
)


class TestConfig:
    """Test configuration handling."""

    def test_get_content_branch_raises_when_not_set(self):
        """Should raise error when EDUCATIONAL_CONTENT_BRANCH not set."""
        with patch.dict(os.environ, {}, clear=True):
            # Remove the env var if it exists
            os.environ.pop("EDUCATIONAL_CONTENT_BRANCH", None)

            with pytest.raises(ContentBranchNotConfiguredError):
                get_content_branch()

    def test_get_content_branch_returns_value(self):
        """Should return branch when set."""
        with patch.dict(os.environ, {"EDUCATIONAL_CONTENT_BRANCH": "staging"}):
            assert get_content_branch() == "staging"

    def test_content_repo_is_correct(self):
        """Should have correct repo configured."""
        assert CONTENT_REPO == "lucbrinkman/lens-educational-content"
```

**Step 2: Run test to verify it fails**

```bash
pytest core/content/tests/test_github_fetcher.py::TestConfig -v
```

Expected: FAIL with "No module named 'core.content.github_fetcher'"

**Step 3: Implement config part of fetcher**

Create `core/content/github_fetcher.py`:

```python
"""Fetch educational content from GitHub repository."""

import os
from datetime import datetime

import aiohttp

from core.lessons.markdown_parser import parse_lesson, parse_course, ParsedLesson, ParsedCourse
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


async def _fetch_file(session: aiohttp.ClientSession, path: str) -> str:
    """Fetch a single file from GitHub.

    Args:
        session: aiohttp session
        path: Path relative to repo root (e.g., "lessons/introduction.md")

    Returns:
        File content as string

    Raises:
        GitHubFetchError: If fetch fails
    """
    url = _get_raw_url(path)
    headers = {}
    token = _get_github_token()
    if token:
        headers["Authorization"] = f"token {token}"

    async with session.get(url, headers=headers) as response:
        if response.status != 200:
            raise GitHubFetchError(f"Failed to fetch {path}: HTTP {response.status}")
        return await response.text()


async def _list_directory(session: aiohttp.ClientSession, path: str) -> list[str]:
    """List files in a directory using GitHub API.

    Args:
        session: aiohttp session
        path: Directory path relative to repo root (e.g., "lessons")

    Returns:
        List of file paths (e.g., ["lessons/intro.md", "lessons/advanced.md"])

    Raises:
        GitHubFetchError: If API call fails
    """
    url = _get_api_url(path)
    headers = {"Accept": "application/vnd.github.v3+json"}
    token = _get_github_token()
    if token:
        headers["Authorization"] = f"token {token}"

    async with session.get(url, headers=headers) as response:
        if response.status != 200:
            raise GitHubFetchError(f"Failed to list {path}: HTTP {response.status}")

        data = await response.json()
        return [item["path"] for item in data if item["type"] == "file"]


async def fetch_all_content() -> ContentCache:
    """Fetch all educational content from GitHub.

    Returns:
        ContentCache with all content loaded

    Raises:
        GitHubFetchError: If any fetch fails
    """
    async with aiohttp.ClientSession() as session:
        # List all files in each directory
        lesson_files = await _list_directory(session, "lessons")
        course_files = await _list_directory(session, "courses")
        article_files = await _list_directory(session, "articles")
        transcript_files = await _list_directory(session, "video_transcripts")

        # Fetch and parse lessons
        lessons: dict[str, ParsedLesson] = {}
        for path in lesson_files:
            if path.endswith(".md"):
                content = await _fetch_file(session, path)
                parsed = parse_lesson(content)
                lessons[parsed.slug] = parsed

        # Fetch and parse courses
        courses: dict[str, ParsedCourse] = {}
        for path in course_files:
            if path.endswith(".md"):
                content = await _fetch_file(session, path)
                parsed = parse_course(content)
                courses[parsed.slug] = parsed

        # Fetch articles (raw markdown)
        articles: dict[str, str] = {}
        for path in article_files:
            if path.endswith(".md"):
                content = await _fetch_file(session, path)
                # Store with path relative to repo root
                articles[path] = content

        # Fetch video transcripts (raw markdown)
        video_transcripts: dict[str, str] = {}
        for path in transcript_files:
            if path.endswith(".md"):
                content = await _fetch_file(session, path)
                video_transcripts[path] = content

        return ContentCache(
            courses=courses,
            lessons=lessons,
            articles=articles,
            video_transcripts=video_transcripts,
            last_refreshed=datetime.now(),
        )


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
    print(f"✓ Educational content cache initialized")


async def refresh_cache() -> None:
    """Re-fetch all content and update the cache.

    Called by webhook endpoint.
    """
    print("Refreshing educational content cache...")
    cache = await fetch_all_content()
    set_cache(cache)
    print(f"✓ Cache refreshed at {cache.last_refreshed}")
```

**Step 4: Update `core/content/__init__.py`**

```python
"""Content fetching and caching from GitHub."""

from .cache import (
    ContentCache,
    CacheNotInitializedError,
    get_cache,
    set_cache,
    clear_cache,
)
from .github_fetcher import (
    ContentBranchNotConfiguredError,
    GitHubFetchError,
    initialize_cache,
    refresh_cache,
    get_content_branch,
    CONTENT_REPO,
)

__all__ = [
    "ContentCache",
    "CacheNotInitializedError",
    "get_cache",
    "set_cache",
    "clear_cache",
    "ContentBranchNotConfiguredError",
    "GitHubFetchError",
    "initialize_cache",
    "refresh_cache",
    "get_content_branch",
    "CONTENT_REPO",
]
```

**Step 5: Run tests to verify they pass**

```bash
pytest core/content/tests/test_github_fetcher.py::TestConfig -v
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add core/content/
git commit -m "feat(content): add GitHub content fetcher

- Fetch lessons, courses, articles, video_transcripts from GitHub
- Support GITHUB_TOKEN for authenticated requests
- Require EDUCATIONAL_CONTENT_BRANCH env var (no default)
- initialize_cache() for startup, refresh_cache() for webhook"
```

---

## Task 4: Integrate Cache with Server Startup

**Files:**
- Modify: `main.py:198-258`

**Step 1: Add cache initialization to lifespan**

In `main.py`, add import at top:

```python
from core.content import initialize_cache, CacheNotInitializedError, ContentBranchNotConfiguredError
```

Then modify the `lifespan` function to initialize cache before starting services:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.

    Starts peer services (Discord bot, Vite dev server) as background tasks.
    They run concurrently with FastAPI in the same event loop.
    """
    global _bot_task

    skip_db = os.getenv("SKIP_DB_CHECK", "").lower() in ("true", "1", "yes")

    # Initialize educational content cache from GitHub
    try:
        await initialize_cache()
    except ContentBranchNotConfiguredError as e:
        print(f"✗ Content cache: {e}")
        print("  └─ Set EDUCATIONAL_CONTENT_BRANCH=staging (or main for production)")
        sys.exit(1)
    except Exception as e:
        print(f"✗ Content cache failed: {e}")
        print("  └─ Check GITHUB_TOKEN and network connectivity")
        sys.exit(1)

    # Check database connection (runs in uvicorn's event loop - no issues)
    if not skip_db:
        # ... rest of existing code unchanged ...
```

**Step 2: Test manually**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2
python main.py --no-bot --no-db
```

Expected: Should see "Fetching educational content from GitHub..." and loaded counts, then server starts.

**Step 3: Commit**

```bash
git add main.py
git commit -m "feat(startup): initialize content cache on server startup

Cache is populated from GitHub before server accepts requests.
Fails fast if EDUCATIONAL_CONTENT_BRANCH not set or fetch fails."
```

---

## Task 5: Update Lesson Loader to Use Cache

**Files:**
- Modify: `core/lessons/loader.py`
- Test: `core/lessons/tests/test_loader.py`

**Step 1: Write test for cache-based loading**

Add to `core/lessons/tests/test_loader.py` (create if doesn't exist):

```python
"""Tests for lesson loader."""

import pytest
from datetime import datetime
from unittest.mock import patch

from core.content import ContentCache, set_cache, clear_cache
from core.lessons.loader import load_narrative_lesson, LessonNotFoundError
from core.lessons.markdown_parser import ParsedLesson, VideoSection, ChatSection


class TestLoadNarrativeLessonFromCache:
    """Test loading narrative lessons from cache."""

    def setup_method(self):
        """Set up test cache."""
        # Create a minimal parsed lesson
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

    def teardown_method(self):
        """Clear cache after test."""
        clear_cache()

    def test_load_lesson_from_cache(self):
        """Should load lesson from cache."""
        lesson = load_narrative_lesson("test-lesson")
        assert lesson.slug == "test-lesson"
        assert lesson.title == "Test Lesson"

    def test_load_lesson_not_found(self):
        """Should raise error for missing lesson."""
        with pytest.raises(LessonNotFoundError):
            load_narrative_lesson("nonexistent")
```

**Step 2: Run test to verify it fails**

```bash
pytest core/lessons/tests/test_loader.py::TestLoadNarrativeLessonFromCache -v
```

Expected: FAIL (loader still reads from filesystem)

**Step 3: Update loader to use cache**

Replace `core/lessons/loader.py`:

```python
# core/lessons/loader.py
"""Load lesson and course definitions from cache."""

from core.content import get_cache, CacheNotInitializedError
from core.lessons.markdown_parser import ParsedLesson, ParsedCourse


class LessonNotFoundError(Exception):
    """Raised when a lesson cannot be found."""
    pass


class CourseNotFoundError(Exception):
    """Raised when a course cannot be found."""
    pass


def load_narrative_lesson(lesson_slug: str) -> ParsedLesson:
    """
    Load a narrative lesson by slug from the cache.

    Args:
        lesson_slug: The lesson slug

    Returns:
        ParsedLesson dataclass

    Raises:
        LessonNotFoundError: If lesson not in cache
        CacheNotInitializedError: If cache not initialized
    """
    cache = get_cache()

    if lesson_slug not in cache.lessons:
        raise LessonNotFoundError(f"Lesson not found: {lesson_slug}")

    return cache.lessons[lesson_slug]


def get_available_lessons() -> list[str]:
    """
    Get list of available lesson slugs.

    Returns:
        List of lesson slugs
    """
    cache = get_cache()
    return list(cache.lessons.keys())


# Legacy function - redirect to narrative lesson
def load_lesson(lesson_slug: str) -> ParsedLesson:
    """Load a lesson (legacy - redirects to narrative format)."""
    return load_narrative_lesson(lesson_slug)
```

**Step 4: Run tests to verify they pass**

```bash
pytest core/lessons/tests/test_loader.py::TestLoadNarrativeLessonFromCache -v
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add core/lessons/loader.py core/lessons/tests/test_loader.py
git commit -m "refactor(loader): use cache instead of filesystem

- load_narrative_lesson reads from ContentCache
- Removed YAML file loading code
- Added LessonNotFoundError for missing lessons"
```

---

## Task 6: Update Course Loader to Use Cache

**Files:**
- Modify: `core/lessons/course_loader.py`

**Step 1: Update course loader**

Replace `core/lessons/course_loader.py`:

```python
# core/lessons/course_loader.py
"""Load course definitions from cache."""

from core.content import get_cache
from core.lessons.markdown_parser import ParsedCourse, LessonRef, MeetingMarker
from core.lessons.loader import load_narrative_lesson, LessonNotFoundError


class CourseNotFoundError(Exception):
    """Raised when a course cannot be found."""
    pass


def load_course(course_slug: str) -> ParsedCourse:
    """Load a course by slug from the cache."""
    cache = get_cache()

    if course_slug not in cache.courses:
        raise CourseNotFoundError(f"Course not found: {course_slug}")

    return cache.courses[course_slug]


def get_all_lesson_slugs(course_slug: str) -> list[str]:
    """Get flat list of all lesson slugs in course order."""
    course = load_course(course_slug)
    return [item.path.split("/")[-1] for item in course.progression if isinstance(item, LessonRef)]


def get_next_lesson(course_slug: str, current_lesson_slug: str) -> dict | None:
    """Get what comes after the current lesson in the progression.

    Returns:
        - {"type": "lesson", "slug": str, "title": str} if next item is a lesson
        - {"type": "unit_complete", "unit_number": int} if next item is a meeting
        - None if end of course or lesson not found
    """
    course = load_course(course_slug)

    # Find the current lesson's index in progression
    current_index = None
    for i, item in enumerate(course.progression):
        if isinstance(item, LessonRef):
            # Extract slug from path (e.g., "lessons/introduction" -> "introduction")
            item_slug = item.path.split("/")[-1]
            if item_slug == current_lesson_slug:
                current_index = i
                break

    if current_index is None:
        return None  # Lesson not in this course

    # Look at the next item in progression
    next_index = current_index + 1
    if next_index >= len(course.progression):
        return None  # End of course

    next_item = course.progression[next_index]

    if isinstance(next_item, MeetingMarker):
        return {"type": "unit_complete", "unit_number": next_item.number}

    if isinstance(next_item, LessonRef):
        next_slug = next_item.path.split("/")[-1]
        try:
            next_lesson = load_narrative_lesson(next_slug)
            return {
                "type": "lesson",
                "slug": next_slug,
                "title": next_lesson.title,
            }
        except LessonNotFoundError:
            return None

    return None


def get_lessons(course: ParsedCourse) -> list[LessonRef]:
    """Get all lesson references from a course, excluding meetings."""
    return [item for item in course.progression if isinstance(item, LessonRef)]


def get_required_lessons(course: ParsedCourse) -> list[LessonRef]:
    """Get only required (non-optional) lesson references from a course."""
    return [
        item
        for item in course.progression
        if isinstance(item, LessonRef) and not item.optional
    ]


def get_due_by_meeting(course: ParsedCourse, lesson_slug: str) -> int | None:
    """Get the meeting number by which a lesson should be completed."""
    found_lesson = False

    for item in course.progression:
        if isinstance(item, LessonRef):
            item_slug = item.path.split("/")[-1]
            if item_slug == lesson_slug:
                found_lesson = True
        elif found_lesson and isinstance(item, MeetingMarker):
            return item.number

    return None
```

**Step 2: Run existing tests**

```bash
pytest core/lessons/tests/ -v
```

Expected: Tests should pass (may need to add cache setup to fixtures)

**Step 3: Commit**

```bash
git add core/lessons/course_loader.py
git commit -m "refactor(courses): use cache instead of filesystem

- load_course reads from ContentCache
- Updated to use ParsedCourse and LessonRef from markdown parser
- Removed YAML file loading code"
```

---

## Task 7: Update Content Loader to Use Cache

**Files:**
- Modify: `core/lessons/content.py`

**Step 1: Update article/video loading functions**

In `core/lessons/content.py`, update `load_article` and `load_video_transcript` to use cache:

```python
def load_article(source_path: str) -> str:
    """
    Load article content from cache (without metadata).

    Args:
        source_path: Path like "articles/foo" (without .md extension)

    Returns:
        Full markdown content as string (frontmatter stripped)
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path - add .md if needed, ensure articles/ prefix
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    if not source_path.startswith("articles/"):
        source_path = f"articles/{source_path}"

    if source_path not in cache.articles:
        raise FileNotFoundError(f"Article not found in cache: {source_path}")

    raw_text = cache.articles[source_path]
    _, content = parse_frontmatter(raw_text)
    return content


def load_article_with_metadata(
    source_path: str,
    from_text: str | None = None,
    to_text: str | None = None,
) -> ArticleContent:
    """
    Load article content with metadata from cache.
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    if not source_path.startswith("articles/"):
        source_path = f"articles/{source_path}"

    if source_path not in cache.articles:
        raise FileNotFoundError(f"Article not found in cache: {source_path}")

    raw_text = cache.articles[source_path]
    metadata, full_content = parse_frontmatter(raw_text)

    # Check if we're extracting an excerpt
    is_excerpt = from_text is not None or to_text is not None

    if is_excerpt:
        content = extract_article_section(full_content, from_text, to_text)
    else:
        content = full_content

    return ArticleContent(
        content=content,
        metadata=metadata,
        is_excerpt=is_excerpt,
    )


def load_video_transcript(source_path: str) -> str:
    """
    Load video transcript from cache (without metadata).
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    if not source_path.startswith("video_transcripts/"):
        source_path = f"video_transcripts/{source_path}"

    if source_path not in cache.video_transcripts:
        raise FileNotFoundError(f"Transcript not found in cache: {source_path}")

    raw_text = cache.video_transcripts[source_path]
    _, transcript = parse_video_frontmatter(raw_text)
    return transcript


def load_video_transcript_with_metadata(source_path: str) -> VideoTranscriptContent:
    """
    Load video transcript with metadata from cache.
    """
    from core.content import get_cache

    cache = get_cache()

    # Normalize path
    if not source_path.endswith(".md"):
        source_path = f"{source_path}.md"
    if not source_path.startswith("video_transcripts/"):
        source_path = f"video_transcripts/{source_path}"

    if source_path not in cache.video_transcripts:
        raise FileNotFoundError(f"Transcript not found in cache: {source_path}")

    raw_text = cache.video_transcripts[source_path]
    metadata, transcript = parse_video_frontmatter(raw_text)

    return VideoTranscriptContent(
        transcript=transcript,
        metadata=metadata,
        is_excerpt=False,
    )
```

Also remove the `CONTENT_DIR` constant at the top of the file.

**Step 2: Run tests**

```bash
pytest core/lessons/tests/ -v
```

**Step 3: Commit**

```bash
git add core/lessons/content.py
git commit -m "refactor(content): use cache instead of filesystem

- load_article reads from cache.articles
- load_video_transcript reads from cache.video_transcripts
- Removed CONTENT_DIR constant
- Added path normalization for consistent lookups"
```

---

## Task 8: Add Webhook Endpoint

**Files:**
- Create: `web_api/routes/content.py`
- Modify: `main.py` (add router)

**Step 1: Create webhook endpoint**

Create `web_api/routes/content.py`:

```python
"""Content management API routes."""

from fastapi import APIRouter, Request, HTTPException
from core.content import refresh_cache

router = APIRouter(prefix="/api/content", tags=["content"])


@router.post("/webhook")
async def github_webhook(request: Request):
    """
    Handle GitHub push webhook to refresh content cache.

    Called by GitHub when content repo is pushed to.
    TODO: Add webhook signature verification with GITHUB_WEBHOOK_SECRET
    """
    try:
        await refresh_cache()
        return {"status": "ok", "message": "Cache refreshed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")


@router.post("/refresh")
async def manual_refresh():
    """
    Manually refresh the content cache.

    For local development when webhooks aren't available.
    TODO: Add admin authentication
    """
    try:
        await refresh_cache()
        return {"status": "ok", "message": "Cache refreshed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")
```

**Step 2: Add router to main.py**

In `main.py`, add import:

```python
from web_api.routes.content import router as content_router
```

And add the router after other routers:

```python
app.include_router(content_router)
```

**Step 3: Test manually**

```bash
curl -X POST http://localhost:8000/api/content/refresh
```

Expected: `{"status": "ok", "message": "Cache refreshed"}`

**Step 4: Commit**

```bash
git add web_api/routes/content.py main.py
git commit -m "feat(api): add content webhook and refresh endpoints

- POST /api/content/webhook for GitHub webhooks
- POST /api/content/refresh for manual refresh
- TODO: Add webhook signature verification"
```

---

## Task 9: Rename Deprecated Content Directory

**Files:**
- Rename: `educational_content/` → `educational_content_deprecated/`

**Step 1: Rename directory**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2
mv educational_content educational_content_deprecated
```

**Step 2: Update .gitignore if needed**

Check if educational_content is in .gitignore and update if necessary.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: rename educational_content to _deprecated

Content is now loaded from GitHub repo:
lucbrinkman/lens-educational-content

Old YAML-based content preserved for reference."
```

---

## Task 10: End-to-End Test

**Step 1: Start server**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2
python main.py --dev --no-bot
```

**Step 2: Verify content loads**

```bash
# Check a lesson loads
curl http://localhost:8000/api/lessons/introduction

# Check course loads
curl http://localhost:8000/api/courses/ai-safety-fundamentals/progress
```

**Step 3: Verify refresh works**

```bash
curl -X POST http://localhost:8000/api/content/refresh
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete GitHub content fetcher implementation

Educational content now loaded from external GitHub repo:
- Fetched on server startup
- Cached in memory
- Refreshable via webhook or manual endpoint
- Zero backwards compatibility with local files"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Fix markdown parser | `markdown_parser.py` |
| 2 | Create cache module | `core/content/cache.py` |
| 3 | Create GitHub fetcher | `core/content/github_fetcher.py` |
| 4 | Integrate with startup | `main.py` |
| 5 | Update lesson loader | `core/lessons/loader.py` |
| 6 | Update course loader | `core/lessons/course_loader.py` |
| 7 | Update content loader | `core/lessons/content.py` |
| 8 | Add webhook endpoint | `web_api/routes/content.py` |
| 9 | Rename deprecated dir | `educational_content/` |
| 10 | End-to-end test | Manual verification |
