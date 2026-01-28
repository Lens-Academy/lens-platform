# V2 Content Flattening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement cache-time flattening of v2 content (Learning Outcomes → Lenses → sections) so the API returns a flat list of page/lens-video/lens-article sections.

**Architecture:** Parse all files at fetch time, flatten modules by resolving LO and Lens references, cache the flattened result. API serves cached data directly.

**Tech Stack:** Python (FastAPI, dataclasses), TypeScript (React)

**Design Doc:** `docs/plans/2026-01-28-v2-content-section-types.md`

---

## Task 1: Add Flattened Section Types

**Files:**
- Create: `core/modules/flattened_types.py`
- Test: `core/modules/tests/test_flattened_types.py`

**Step 1: Write the failing test**

```python
# core/modules/tests/test_flattened_types.py
"""Tests for flattened section types."""
from uuid import UUID

from core.modules.flattened_types import (
    FlatPageSection,
    FlatLensVideoSection,
    FlatLensArticleSection,
    FlattenedModule,
)


def test_flat_page_section_has_required_fields():
    section = FlatPageSection(
        content_id=UUID("12345678-1234-1234-1234-123456789abc"),
        title="Welcome",
        segments=[],
    )
    assert section.type == "page"
    assert section.content_id == UUID("12345678-1234-1234-1234-123456789abc")
    assert section.title == "Welcome"
    assert section.segments == []


def test_flat_lens_video_section_has_learning_outcome_id():
    section = FlatLensVideoSection(
        content_id=UUID("12345678-1234-1234-1234-123456789abc"),
        learning_outcome_id=UUID("87654321-4321-4321-4321-cba987654321"),
        title="AI Safety Intro",
        video_id="dQw4w9WgXcQ",
        channel="Kurzgesagt",
        segments=[],
        optional=False,
    )
    assert section.type == "lens-video"
    assert section.learning_outcome_id == UUID("87654321-4321-4321-4321-cba987654321")
    assert section.video_id == "dQw4w9WgXcQ"


def test_flat_lens_article_section_has_metadata():
    section = FlatLensArticleSection(
        content_id=UUID("12345678-1234-1234-1234-123456789abc"),
        learning_outcome_id=None,  # Uncategorized
        title="Deep Dive",
        author="Jane Doe",
        source_url="https://example.com/article",
        segments=[],
        optional=True,
    )
    assert section.type == "lens-article"
    assert section.learning_outcome_id is None
    assert section.author == "Jane Doe"
    assert section.optional is True


def test_flattened_module_contains_flat_sections():
    module = FlattenedModule(
        slug="introduction",
        title="Introduction",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[
            FlatPageSection(
                content_id=UUID("00000000-0000-0000-0000-000000000002"),
                title="Welcome",
                segments=[],
            ),
        ],
    )
    assert module.slug == "introduction"
    assert len(module.sections) == 1
    assert module.sections[0].type == "page"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_flattened_types.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.modules.flattened_types'`

**Step 3: Write minimal implementation**

```python
# core/modules/flattened_types.py
"""Flattened section types for API responses.

These types represent the final, resolved structure that the API returns.
Learning Outcomes and Uncategorized sections are expanded into their
constituent lens-video and lens-article sections.
"""
from dataclasses import dataclass, field
from uuid import UUID


@dataclass
class FlatPageSection:
    """A page section with text/chat segments."""

    content_id: UUID
    title: str
    segments: list[dict]  # Serialized segments
    type: str = "page"


@dataclass
class FlatLensVideoSection:
    """A lens section containing video content."""

    content_id: UUID  # Lens UUID
    learning_outcome_id: UUID | None  # LO UUID, or None if uncategorized
    title: str
    video_id: str
    channel: str | None
    segments: list[dict]  # Serialized segments
    optional: bool = False
    type: str = "lens-video"


@dataclass
class FlatLensArticleSection:
    """A lens section containing article content."""

    content_id: UUID  # Lens UUID
    learning_outcome_id: UUID | None  # LO UUID, or None if uncategorized
    title: str
    author: str | None
    source_url: str | None
    segments: list[dict]  # Serialized segments
    optional: bool = False
    type: str = "lens-article"


FlatSection = FlatPageSection | FlatLensVideoSection | FlatLensArticleSection


@dataclass
class FlattenedModule:
    """A module with all sections flattened and resolved."""

    slug: str
    title: str
    content_id: UUID | None
    sections: list[FlatSection] = field(default_factory=list)
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_flattened_types.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/modules/flattened_types.py core/modules/tests/test_flattened_types.py
git commit -m "$(cat <<'EOF'
feat: add flattened section types for v2 content

Adds FlatPageSection, FlatLensVideoSection, FlatLensArticleSection,
and FlattenedModule types for the cache-time flattening approach.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Wiki-Link Path Resolution

**Files:**
- Create: `core/modules/path_resolver.py`
- Test: `core/modules/tests/test_path_resolver.py`

**Step 1: Write the failing test**

```python
# core/modules/tests/test_path_resolver.py
"""Tests for wiki-link path resolution."""
from core.modules.path_resolver import resolve_wiki_link, extract_filename_stem


def test_extract_filename_stem_simple():
    assert extract_filename_stem("Lenses/Video Lens") == "Video Lens"


def test_extract_filename_stem_with_parent_refs():
    assert extract_filename_stem("../Learning Outcomes/Some Outcome") == "Some Outcome"


def test_extract_filename_stem_with_extension():
    assert extract_filename_stem("../Lenses/My Lens.md") == "My Lens"


def test_resolve_wiki_link_learning_outcome():
    result = resolve_wiki_link("[[../Learning Outcomes/AI Risks]]")
    assert result == ("learning_outcomes", "AI Risks")


def test_resolve_wiki_link_lens():
    result = resolve_wiki_link("[[../Lenses/Video Intro]]")
    assert result == ("lenses", "Video Intro")


def test_resolve_wiki_link_video_transcript():
    result = resolve_wiki_link("[[../video_transcripts/kurzgesagt]]")
    assert result == ("video_transcripts", "kurzgesagt")


def test_resolve_wiki_link_article():
    result = resolve_wiki_link("[[../articles/deep_dive]]")
    assert result == ("articles", "deep_dive")


def test_resolve_wiki_link_embed_syntax():
    # ![[...]] is embed syntax, should work the same
    result = resolve_wiki_link("![[../Lenses/My Lens]]")
    assert result == ("lenses", "My Lens")
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_path_resolver.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write minimal implementation**

```python
# core/modules/path_resolver.py
"""Resolve wiki-link paths to cache keys."""
import re


def extract_filename_stem(path: str) -> str:
    """Extract the filename stem (without extension) from a path.

    Examples:
        "Lenses/Video Lens" -> "Video Lens"
        "../Learning Outcomes/Some Outcome" -> "Some Outcome"
        "../Lenses/My Lens.md" -> "My Lens"
    """
    # Get the last path component
    filename = path.split("/")[-1]
    # Remove .md extension if present
    if filename.endswith(".md"):
        filename = filename[:-3]
    return filename


def resolve_wiki_link(wiki_link: str) -> tuple[str, str]:
    """Resolve a wiki-link to (content_type, cache_key).

    Args:
        wiki_link: A wiki-link like "[[../Learning Outcomes/AI Risks]]"

    Returns:
        Tuple of (content_type, cache_key) where:
        - content_type is one of: "learning_outcomes", "lenses", "video_transcripts", "articles"
        - cache_key is the filename stem used as the cache dictionary key

    Raises:
        ValueError: If the wiki-link format is not recognized
    """
    # Extract path from [[...]] or ![[...]]
    match = re.search(r"!?\[\[([^\]]+)\]\]", wiki_link)
    if not match:
        raise ValueError(f"Invalid wiki-link format: {wiki_link}")

    path = match.group(1)

    # Determine content type from path
    path_lower = path.lower()
    if "learning outcomes" in path_lower or "learning_outcomes" in path_lower:
        content_type = "learning_outcomes"
    elif "lenses" in path_lower:
        content_type = "lenses"
    elif "video_transcripts" in path_lower:
        content_type = "video_transcripts"
    elif "articles" in path_lower:
        content_type = "articles"
    else:
        raise ValueError(f"Unknown content type in path: {path}")

    cache_key = extract_filename_stem(path)
    return (content_type, cache_key)
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_path_resolver.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/modules/path_resolver.py core/modules/tests/test_path_resolver.py
git commit -m "$(cat <<'EOF'
feat: add wiki-link path resolution for content lookup

Resolves wiki-links like [[../Learning Outcomes/X]] to cache keys.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Flattening Logic

**Files:**
- Create: `core/modules/flattener.py`
- Test: `core/modules/tests/test_flattener.py`

**Step 1: Write the failing test**

```python
# core/modules/tests/test_flattener.py
"""Tests for module flattening logic."""
from uuid import UUID

import pytest

from core.modules.flattener import flatten_module, ContentLookup
from core.modules.markdown_parser import (
    ParsedModule,
    ParsedLearningOutcome,
    ParsedLens,
    PageSection,
    LearningOutcomeRef,
    UncategorizedSection,
    LensRef,
    LensVideoSection,
    LensArticleSection,
    TextSegment,
)
from core.modules.flattened_types import (
    FlatPageSection,
    FlatLensVideoSection,
    FlatLensArticleSection,
)


class MockContentLookup(ContentLookup):
    """Mock content lookup for testing."""

    def __init__(
        self,
        learning_outcomes: dict[str, ParsedLearningOutcome] | None = None,
        lenses: dict[str, ParsedLens] | None = None,
        video_transcripts: dict[str, dict] | None = None,
        articles: dict[str, dict] | None = None,
    ):
        self._learning_outcomes = learning_outcomes or {}
        self._lenses = lenses or {}
        self._video_transcripts = video_transcripts or {}
        self._articles = articles or {}

    def get_learning_outcome(self, key: str) -> ParsedLearningOutcome:
        if key not in self._learning_outcomes:
            raise KeyError(f"Learning outcome not found: {key}")
        return self._learning_outcomes[key]

    def get_lens(self, key: str) -> ParsedLens:
        if key not in self._lenses:
            raise KeyError(f"Lens not found: {key}")
        return self._lenses[key]

    def get_video_metadata(self, key: str) -> dict:
        if key not in self._video_transcripts:
            raise KeyError(f"Video transcript not found: {key}")
        return self._video_transcripts[key]

    def get_article_metadata(self, key: str) -> dict:
        if key not in self._articles:
            raise KeyError(f"Article not found: {key}")
        return self._articles[key]


def test_flatten_module_with_page_section():
    """Page sections pass through with type 'page'."""
    module = ParsedModule(
        slug="intro",
        title="Introduction",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[
            PageSection(
                title="Welcome",
                content_id=UUID("00000000-0000-0000-0000-000000000002"),
                segments=[TextSegment(content="Hello world")],
            ),
        ],
    )

    lookup = MockContentLookup()
    result = flatten_module(module, lookup)

    assert result.slug == "intro"
    assert len(result.sections) == 1
    assert result.sections[0].type == "page"
    assert result.sections[0].title == "Welcome"


def test_flatten_module_expands_learning_outcome():
    """Learning outcome refs are expanded into lens sections."""
    lo = ParsedLearningOutcome(
        content_id=UUID("00000000-0000-0000-0000-000000000010"),
        lenses=[LensRef(source="[[../Lenses/Video Lens]]", optional=False)],
    )

    lens = ParsedLens(
        content_id=UUID("00000000-0000-0000-0000-000000000020"),
        sections=[
            LensVideoSection(
                title="AI Safety Intro",
                source="[[../video_transcripts/kurzgesagt]]",
                segments=[],
            ),
        ],
    )

    module = ParsedModule(
        slug="intro",
        title="Introduction",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[
            LearningOutcomeRef(source="[[../Learning Outcomes/AI Risks]]", optional=False),
        ],
    )

    lookup = MockContentLookup(
        learning_outcomes={"AI Risks": lo},
        lenses={"Video Lens": lens},
        video_transcripts={"kurzgesagt": {"video_id": "abc123", "channel": "Kurzgesagt"}},
    )

    result = flatten_module(module, lookup)

    assert len(result.sections) == 1
    assert result.sections[0].type == "lens-video"
    assert result.sections[0].learning_outcome_id == UUID("00000000-0000-0000-0000-000000000010")
    assert result.sections[0].video_id == "abc123"


def test_flatten_module_expands_uncategorized():
    """Uncategorized sections expand lenses with learning_outcome_id=None."""
    lens = ParsedLens(
        content_id=UUID("00000000-0000-0000-0000-000000000020"),
        sections=[
            LensArticleSection(
                title="Background Reading",
                source="[[../articles/background]]",
                segments=[],
            ),
        ],
    )

    module = ParsedModule(
        slug="intro",
        title="Introduction",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[
            UncategorizedSection(
                lenses=[LensRef(source="[[../Lenses/Background]]", optional=True)],
            ),
        ],
    )

    lookup = MockContentLookup(
        lenses={"Background": lens},
        articles={"background": {"title": "Background", "author": "Jane", "source_url": "https://example.com"}},
    )

    result = flatten_module(module, lookup)

    assert len(result.sections) == 1
    assert result.sections[0].type == "lens-article"
    assert result.sections[0].learning_outcome_id is None  # Uncategorized
    assert result.sections[0].optional is True


def test_flatten_module_fails_on_missing_reference():
    """Missing references raise KeyError (fail fast)."""
    module = ParsedModule(
        slug="intro",
        title="Introduction",
        content_id=UUID("00000000-0000-0000-0000-000000000001"),
        sections=[
            LearningOutcomeRef(source="[[../Learning Outcomes/Missing]]", optional=False),
        ],
    )

    lookup = MockContentLookup()  # Empty

    with pytest.raises(KeyError, match="Learning outcome not found"):
        flatten_module(module, lookup)
```

**Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_flattener.py -v`
Expected: FAIL with `ModuleNotFoundError`

**Step 3: Write minimal implementation**

```python
# core/modules/flattener.py
"""Flatten parsed modules by resolving Learning Outcome and Lens references."""
from abc import ABC, abstractmethod
from uuid import UUID

from core.modules.markdown_parser import (
    ParsedModule,
    ParsedLearningOutcome,
    ParsedLens,
    Section,
    PageSection,
    LearningOutcomeRef,
    UncategorizedSection,
    LensRef,
    LensVideoSection,
    LensArticleSection,
    TextSegment,
    ChatSegment,
    VideoExcerptSegment,
    ArticleExcerptSegment,
    LensSegment,
)
from core.modules.flattened_types import (
    FlattenedModule,
    FlatSection,
    FlatPageSection,
    FlatLensVideoSection,
    FlatLensArticleSection,
)
from core.modules.path_resolver import resolve_wiki_link, extract_filename_stem


class ContentLookup(ABC):
    """Abstract interface for looking up content by cache key."""

    @abstractmethod
    def get_learning_outcome(self, key: str) -> ParsedLearningOutcome:
        """Get a parsed learning outcome by filename stem."""
        pass

    @abstractmethod
    def get_lens(self, key: str) -> ParsedLens:
        """Get a parsed lens by filename stem."""
        pass

    @abstractmethod
    def get_video_metadata(self, key: str) -> dict:
        """Get video metadata (video_id, channel) by transcript filename stem."""
        pass

    @abstractmethod
    def get_article_metadata(self, key: str) -> dict:
        """Get article metadata (title, author, source_url) by filename stem."""
        pass


def _serialize_segment(segment: TextSegment | ChatSegment | VideoExcerptSegment | ArticleExcerptSegment | LensSegment) -> dict:
    """Serialize a segment to a dictionary for the API response."""
    if hasattr(segment, 'content') and segment.type == "text":
        return {"type": "text", "content": segment.content}
    elif segment.type == "chat":
        return {
            "type": "chat",
            "instructions": segment.instructions,
            "hidePreviousContentFromUser": segment.hide_previous_content_from_user,
            "hidePreviousContentFromTutor": segment.hide_previous_content_from_tutor,
        }
    elif segment.type == "video-excerpt":
        return {
            "type": "video-excerpt",
            "from": segment.from_time,
            "to": segment.to_time,
        }
    elif segment.type == "article-excerpt":
        return {
            "type": "article-excerpt",
            "from": segment.from_text,
            "to": segment.to_text,
        }
    return {}


def _flatten_lens(
    lens: ParsedLens,
    learning_outcome_id: UUID | None,
    optional: bool,
    lookup: ContentLookup,
) -> list[FlatSection]:
    """Flatten a lens into one or more flat sections.

    Note: Per design doc, one lens = exactly one video or article.
    We take the first section and raise if there are multiple.
    """
    if len(lens.sections) == 0:
        raise ValueError(f"Lens {lens.content_id} has no sections")
    if len(lens.sections) > 1:
        raise ValueError(f"Lens {lens.content_id} has multiple sections (expected exactly 1)")

    section = lens.sections[0]
    segments = [_serialize_segment(s) for s in section.segments]

    if isinstance(section, LensVideoSection):
        # Resolve video source to get metadata
        # section.source is already extracted path (no brackets)
        video_key = extract_filename_stem(section.source)
        video_meta = lookup.get_video_metadata(video_key)

        return [FlatLensVideoSection(
            content_id=lens.content_id,
            learning_outcome_id=learning_outcome_id,
            title=section.title,
            video_id=video_meta.get("video_id", ""),
            channel=video_meta.get("channel"),
            segments=segments,
            optional=optional,
        )]

    elif isinstance(section, LensArticleSection):
        # Resolve article source to get metadata
        # section.source is already extracted path (no brackets)
        article_key = extract_filename_stem(section.source)
        article_meta = lookup.get_article_metadata(article_key)

        return [FlatLensArticleSection(
            content_id=lens.content_id,
            learning_outcome_id=learning_outcome_id,
            title=section.title,
            author=article_meta.get("author"),
            source_url=article_meta.get("source_url"),
            segments=segments,
            optional=optional,
        )]

    return []


def _flatten_learning_outcome(
    lo_ref: LearningOutcomeRef,
    lookup: ContentLookup,
) -> list[FlatSection]:
    """Flatten a learning outcome reference into flat sections."""
    _, lo_key = resolve_wiki_link(lo_ref.source)
    lo = lookup.get_learning_outcome(lo_key)

    sections = []
    for lens_ref in lo.lenses:
        _, lens_key = resolve_wiki_link(lens_ref.source)
        lens = lookup.get_lens(lens_key)
        sections.extend(_flatten_lens(
            lens,
            learning_outcome_id=lo.content_id,
            optional=lens_ref.optional or lo_ref.optional,
            lookup=lookup,
        ))

    return sections


def _flatten_uncategorized(
    uncategorized: UncategorizedSection,
    lookup: ContentLookup,
) -> list[FlatSection]:
    """Flatten an uncategorized section into flat sections."""
    sections = []
    for lens_ref in uncategorized.lenses:
        _, lens_key = resolve_wiki_link(lens_ref.source)
        lens = lookup.get_lens(lens_key)
        sections.extend(_flatten_lens(
            lens,
            learning_outcome_id=None,  # Uncategorized has no LO
            optional=lens_ref.optional,
            lookup=lookup,
        ))

    return sections


def _flatten_page(page: PageSection) -> FlatPageSection:
    """Convert a PageSection to a FlatPageSection."""
    segments = [_serialize_segment(s) for s in page.segments]
    return FlatPageSection(
        content_id=page.content_id,
        title=page.title,
        segments=segments,
    )


def flatten_module(module: ParsedModule, lookup: ContentLookup) -> FlattenedModule:
    """Flatten a parsed module by resolving all references.

    Args:
        module: The parsed module with LearningOutcomeRef and UncategorizedSection
        lookup: Interface for looking up referenced content

    Returns:
        FlattenedModule with all sections resolved to page/lens-video/lens-article

    Raises:
        KeyError: If any referenced content is not found (fail fast)
        ValueError: If a lens has zero or multiple sections
    """
    flat_sections: list[FlatSection] = []

    for section in module.sections:
        if isinstance(section, PageSection):
            flat_sections.append(_flatten_page(section))

        elif isinstance(section, LearningOutcomeRef):
            flat_sections.extend(_flatten_learning_outcome(section, lookup))

        elif isinstance(section, UncategorizedSection):
            flat_sections.extend(_flatten_uncategorized(section, lookup))

        # Skip other section types (Text, Article, Video, Chat - v1 types not supported)

    return FlattenedModule(
        slug=module.slug,
        title=module.title,
        content_id=module.content_id,
        sections=flat_sections,
    )
```

**Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_flattener.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/modules/flattener.py core/modules/tests/test_flattener.py
git commit -m "$(cat <<'EOF'
feat: add module flattening logic

Resolves Learning Outcome and Uncategorized sections into flat
lens-video and lens-article sections at cache time.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update Cache Structure

**Files:**
- Modify: `core/content/cache.py`
- Modify: `core/content/github_fetcher.py`
- Test: `core/content/tests/test_cache_flattening.py`

**Step 1: Write the failing test**

```python
# core/content/tests/test_cache_flattening.py
"""Tests for cache structure with flattened modules."""
from datetime import datetime
from uuid import UUID

from core.content.cache import ContentCache
from core.modules.flattened_types import FlattenedModule, FlatPageSection


def test_cache_stores_flattened_modules():
    """Cache should store FlattenedModule objects, not ParsedModule."""
    cache = ContentCache(
        courses={},
        flattened_modules={
            "intro": FlattenedModule(
                slug="intro",
                title="Introduction",
                content_id=UUID("00000000-0000-0000-0000-000000000001"),
                sections=[
                    FlatPageSection(
                        content_id=UUID("00000000-0000-0000-0000-000000000002"),
                        title="Welcome",
                        segments=[],
                    ),
                ],
            ),
        },
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )

    assert "intro" in cache.flattened_modules
    assert cache.flattened_modules["intro"].sections[0].type == "page"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/content/tests/test_cache_flattening.py -v`
Expected: FAIL (ContentCache doesn't have `flattened_modules` field yet)

**Step 3: Write minimal implementation**

Update `core/content/cache.py`:

```python
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
    parsed_learning_outcomes: dict[str, ParsedLearningOutcome]  # filename stem -> parsed LO
    parsed_lenses: dict[str, ParsedLens]  # filename stem -> parsed lens
    articles: dict[str, str]  # path -> raw markdown (for metadata extraction)
    video_transcripts: dict[str, str]  # path -> raw markdown (for metadata extraction)
    last_refreshed: datetime
    last_commit_sha: str | None = None


# Global cache singleton
_cache: ContentCache | None = None


def get_cache() -> ContentCache:
    """Get the content cache."""
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

**Step 4: Run test to verify it passes**

Run: `pytest core/content/tests/test_cache_flattening.py -v`
Expected: PASS

**Step 5: Migrate existing tests**

Existing tests in `core/content/tests/test_cache.py` and `core/content/tests/test_github_fetcher.py` use the old `ContentCache` fields. Update them:

1. Replace `cache.modules` with `cache.flattened_modules`
2. Replace `cache.learning_outcomes` with `cache.parsed_learning_outcomes`
3. Replace `cache.lenses` with `cache.parsed_lenses`
4. Update test fixtures to create `FlattenedModule` instead of `ParsedModule`

Run full test suite to find all breaking tests:
```bash
pytest core/content/tests/ -v
```

Fix each failing test before proceeding.

**Step 6: Commit**

```bash
git add core/content/cache.py core/content/tests/
git commit -m "$(cat <<'EOF'
refactor: update cache structure for flattened modules

Cache now stores FlattenedModule (resolved sections) instead of
ParsedModule (with unresolved references).

Also updates existing tests to use new field names.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update GitHub Fetcher to Flatten at Cache Time

**Files:**
- Modify: `core/content/github_fetcher.py`
- Test: Integration test with mock data

**Step 1: Write the failing test**

```python
# core/content/tests/test_github_fetcher_flattening.py
"""Tests for GitHub fetcher flattening integration."""
import pytest
from unittest.mock import AsyncMock, patch
from datetime import datetime

from core.content.github_fetcher import fetch_all_content


@pytest.mark.asyncio
async def test_fetch_all_content_flattens_modules():
    """fetch_all_content should return cache with flattened modules."""
    # This test verifies the integration - modules should be flattened
    # We'll mock the HTTP calls to return test content

    module_md = '''---
id: 00000000-0000-0000-0000-000000000001
slug: intro
title: Introduction
---

# Page: Welcome
id:: 00000000-0000-0000-0000-000000000002
## Text
content:: Hello world
'''

    lo_md = '''---
id: 00000000-0000-0000-0000-000000000010
---
## Lens:
source:: [[../Lenses/Video Lens]]
'''

    lens_md = '''---
id: 00000000-0000-0000-0000-000000000020
---
### Video: AI Safety
source:: [[../video_transcripts/kurzgesagt]]

#### Text
content:: Watch this video.
'''

    transcript_md = '''---
video_id: abc123
title: AI Safety
channel: Kurzgesagt
---
Transcript content here.
'''

    with patch('core.content.github_fetcher._list_directory_with_client') as mock_list:
        with patch('core.content.github_fetcher._fetch_file_with_client') as mock_fetch:
            with patch('core.content.github_fetcher._get_latest_commit_sha_with_client') as mock_sha:
                mock_sha.return_value = "abc123"

                # Configure mock to return different files for different directories
                async def list_dir(client, path):
                    if path == "modules":
                        return ["modules/intro.md"]
                    elif path == "courses":
                        return []
                    elif path == "articles":
                        return []
                    elif path == "video_transcripts":
                        return ["video_transcripts/kurzgesagt.md"]
                    elif path == "Learning Outcomes":
                        return ["Learning Outcomes/AI Risks.md"]
                    elif path == "Lenses":
                        return ["Lenses/Video Lens.md"]
                    return []

                async def fetch_file(client, path, ref=None):
                    if "intro.md" in path:
                        return module_md
                    elif "AI Risks.md" in path:
                        return lo_md
                    elif "Video Lens.md" in path:
                        return lens_md
                    elif "kurzgesagt.md" in path:
                        return transcript_md
                    return ""

                mock_list.side_effect = list_dir
                mock_fetch.side_effect = fetch_file

                cache = await fetch_all_content()

                assert "intro" in cache.flattened_modules
                module = cache.flattened_modules["intro"]
                assert module.title == "Introduction"
                assert len(module.sections) == 1
                assert module.sections[0].type == "page"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/content/tests/test_github_fetcher_flattening.py -v`
Expected: FAIL (github_fetcher still uses old cache structure)

**Step 3: Update implementation**

Update `core/content/github_fetcher.py` to:
1. Parse LOs and Lenses (not just store raw markdown)
2. Flatten modules after parsing
3. Return new cache structure

Key changes to `fetch_all_content()`:

```python
async def fetch_all_content() -> ContentCache:
    """Fetch all educational content from GitHub."""
    async with httpx.AsyncClient() as client:
        commit_sha = await _get_latest_commit_sha_with_client(client)

        # List all files
        module_files = await _list_directory_with_client(client, "modules")
        course_files = await _list_directory_with_client(client, "courses")
        article_files = await _list_directory_with_client(client, "articles")
        transcript_files = await _list_directory_with_client(client, "video_transcripts")
        lo_files = await _list_directory_with_client(client, "Learning Outcomes")
        lens_files = await _list_directory_with_client(client, "Lenses")

        # Fetch and parse courses
        courses: dict[str, ParsedCourse] = {}
        for path in course_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                parsed = parse_course(content)
                courses[parsed.slug] = parsed

        # Fetch raw articles (for metadata extraction later)
        articles: dict[str, str] = {}
        for path in article_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                articles[path] = content

        # Fetch raw video transcripts (for metadata extraction later)
        video_transcripts: dict[str, str] = {}
        for path in transcript_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                video_transcripts[path] = content

        # Parse Learning Outcomes (store by filename stem)
        parsed_los: dict[str, ParsedLearningOutcome] = {}
        for path in lo_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                parsed = parse_learning_outcome(content)
                stem = _extract_stem(path)
                parsed_los[stem] = parsed

        # Parse Lenses (store by filename stem)
        parsed_lenses: dict[str, ParsedLens] = {}
        for path in lens_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                parsed = parse_lens(content)
                stem = _extract_stem(path)
                parsed_lenses[stem] = parsed

        # Parse modules (raw, before flattening)
        raw_modules: dict[str, ParsedModule] = {}
        for path in module_files:
            if path.endswith(".md"):
                content = await _fetch_file_with_client(client, path)
                parsed = parse_module(content)
                raw_modules[parsed.slug] = parsed

        # Create content lookup for flattening
        lookup = CacheContentLookup(
            learning_outcomes=parsed_los,
            lenses=parsed_lenses,
            video_transcripts=video_transcripts,
            articles=articles,
        )

        # Flatten all modules
        flattened_modules: dict[str, FlattenedModule] = {}
        for slug, module in raw_modules.items():
            flattened = flatten_module(module, lookup)
            flattened_modules[slug] = flattened

        return ContentCache(
            courses=courses,
            flattened_modules=flattened_modules,
            parsed_learning_outcomes=parsed_los,
            parsed_lenses=parsed_lenses,
            articles=articles,
            video_transcripts=video_transcripts,
            last_refreshed=datetime.now(),
            last_commit_sha=commit_sha,
        )
```

Also add `CacheContentLookup` class and `_extract_stem` helper:

```python
def _extract_stem(path: str) -> str:
    """Extract filename stem from a path.

    Examples:
        "Learning Outcomes/AI Risks.md" -> "AI Risks"
        "Lenses/Video Lens.md" -> "Video Lens"
    """
    filename = path.split("/")[-1]
    if filename.endswith(".md"):
        return filename[:-3]
    return filename


def _parse_video_frontmatter(content: str) -> dict:
    """Parse video transcript frontmatter to extract metadata."""
    import re
    match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}

    metadata = {}
    for line in match.group(1).split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip()
    return metadata


def _parse_article_frontmatter(content: str) -> dict:
    """Parse article frontmatter to extract metadata."""
    import re
    match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}

    metadata = {}
    for line in match.group(1).split("\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip()
    return metadata


class CacheContentLookup(ContentLookup):
    """Content lookup implementation using cache dictionaries."""

    def __init__(
        self,
        learning_outcomes: dict[str, ParsedLearningOutcome],
        lenses: dict[str, ParsedLens],
        video_transcripts: dict[str, str],
        articles: dict[str, str],
    ):
        self._learning_outcomes = learning_outcomes  # stem -> ParsedLearningOutcome
        self._lenses = lenses  # stem -> ParsedLens
        self._video_transcripts = video_transcripts  # path -> raw markdown
        self._articles = articles  # path -> raw markdown

    def get_learning_outcome(self, key: str) -> ParsedLearningOutcome:
        if key not in self._learning_outcomes:
            raise KeyError(f"Learning outcome not found: {key}")
        return self._learning_outcomes[key]

    def get_lens(self, key: str) -> ParsedLens:
        if key not in self._lenses:
            raise KeyError(f"Lens not found: {key}")
        return self._lenses[key]

    def get_video_metadata(self, key: str) -> dict:
        """Get video metadata by searching for matching transcript file."""
        for path, content in self._video_transcripts.items():
            stem = _extract_stem(path)
            if stem == key or key in path:
                metadata = _parse_video_frontmatter(content)
                return {
                    "video_id": metadata.get("video_id", ""),
                    "channel": metadata.get("channel"),
                }
        raise KeyError(f"Video transcript not found: {key}")

    def get_article_metadata(self, key: str) -> dict:
        """Get article metadata by searching for matching article file."""
        for path, content in self._articles.items():
            stem = _extract_stem(path)
            if stem == key or key in path:
                metadata = _parse_article_frontmatter(content)
                return {
                    "title": metadata.get("title", ""),
                    "author": metadata.get("author"),
                    "source_url": metadata.get("source_url") or metadata.get("url"),
                }
        raise KeyError(f"Article not found: {key}")
```

**Step 4: Run test to verify it passes**

Run: `pytest core/content/tests/test_github_fetcher_flattening.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/content/github_fetcher.py core/content/tests/test_github_fetcher_flattening.py
git commit -m "$(cat <<'EOF'
feat: flatten modules at cache time in GitHub fetcher

Modules are now flattened during fetch, resolving all Learning Outcome
and Lens references. API serves pre-flattened data.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5b: Update incremental_refresh() for New Cache Structure

**Files:**
- Modify: `core/content/github_fetcher.py`
- Test: Update existing tests in `core/content/tests/test_github_fetcher.py`

**Problem:** The current `incremental_refresh()` updates individual fields in the cache when GitHub webhooks fire. With the new flattened structure:
1. Field names have changed (`modules` → `flattened_modules`, etc.)
2. Modifying an LO or Lens file requires re-flattening all modules that reference it

**Solution (MVP):** Fall back to full refresh when LO or Lens files change. Only apply incremental updates for articles and transcripts.

**Step 1: Update incremental_refresh implementation**

Key changes to `_apply_file_change()`:
- Update field names to match new cache structure
- For LO/Lens changes, trigger full re-flattening of affected modules
- For simplicity in MVP: any LO/Lens change → full refresh

```python
async def _apply_file_change(
    client: httpx.AsyncClient,
    cache: ContentCache,
    change: ChangedFile,
    ref: str | None = None,
) -> bool:
    """Apply a single file change to the cache.

    Returns True if a full refresh is needed (LO/Lens changed).
    """
    tracked_dir = _get_tracked_directory(change.path)
    if tracked_dir is None:
        return False

    # LO or Lens changes require re-flattening all modules
    if tracked_dir in ("Learning Outcomes", "Lenses"):
        logger.info(f"LO/Lens change detected ({change.path}), full refresh needed")
        return True  # Signal caller to do full refresh

    # Handle article/transcript changes as before...
    # (keep existing logic but update field names)

    return False  # No full refresh needed
```

Update `incremental_refresh()` to handle the return value and trigger full refresh when needed.

**Step 2: Update tests**

Update tests in `test_github_fetcher.py` to use new field names (`flattened_modules`, `parsed_learning_outcomes`, etc.).

**Step 3: Run tests**

Run: `pytest core/content/tests/test_github_fetcher.py -v`
Expected: PASS

**Step 4: Commit**

```bash
git add core/content/github_fetcher.py core/content/tests/test_github_fetcher.py
git commit -m "$(cat <<'EOF'
fix: update incremental_refresh for new cache structure

LO/Lens changes now trigger full refresh since they require
re-flattening all dependent modules.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update API to Serve Flattened Modules

**Files:**
- Modify: `web_api/routes/modules.py`
- Modify: `core/modules/content.py` (simplify or remove bundling)

**Step 1: Write the failing test**

```python
# web_api/tests/test_modules_v2.py
"""Tests for v2 module API responses."""
import pytest
from unittest.mock import patch
from datetime import datetime
from uuid import UUID

from fastapi.testclient import TestClient

from core.content.cache import ContentCache, set_cache
from core.modules.flattened_types import (
    FlattenedModule,
    FlatPageSection,
    FlatLensVideoSection,
)


@pytest.fixture
def mock_cache():
    """Set up a mock cache with flattened module data."""
    cache = ContentCache(
        courses={},
        flattened_modules={
            "intro": FlattenedModule(
                slug="intro",
                title="Introduction",
                content_id=UUID("00000000-0000-0000-0000-000000000001"),
                sections=[
                    FlatPageSection(
                        content_id=UUID("00000000-0000-0000-0000-000000000002"),
                        title="Welcome",
                        segments=[{"type": "text", "content": "Hello"}],
                    ),
                    FlatLensVideoSection(
                        content_id=UUID("00000000-0000-0000-0000-000000000003"),
                        learning_outcome_id=UUID("00000000-0000-0000-0000-000000000010"),
                        title="AI Safety Intro",
                        video_id="abc123",
                        channel="Kurzgesagt",
                        segments=[],
                        optional=False,
                    ),
                ],
            ),
        },
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    return cache


def test_get_module_returns_flattened_sections(mock_cache):
    """GET /api/modules/{slug} should return flattened sections."""
    from main import app
    client = TestClient(app)

    response = client.get("/api/modules/intro")
    assert response.status_code == 200

    data = response.json()
    assert data["slug"] == "intro"
    assert data["title"] == "Introduction"
    assert len(data["sections"]) == 2

    # First section is a page
    assert data["sections"][0]["type"] == "page"
    assert data["sections"][0]["contentId"] == "00000000-0000-0000-0000-000000000002"

    # Second section is a lens-video with learningOutcomeId
    assert data["sections"][1]["type"] == "lens-video"
    assert data["sections"][1]["learningOutcomeId"] == "00000000-0000-0000-0000-000000000010"
    assert data["sections"][1]["videoId"] == "abc123"
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_modules_v2.py -v`
Expected: FAIL (API still returns old format)

**Step 3: Update implementation**

Update `web_api/routes/modules.py`:

```python
@router.get("/modules/{module_slug}")
async def get_module(module_slug: str):
    """Get a module definition with flattened sections."""
    from core.content.cache import get_cache

    cache = get_cache()

    if module_slug not in cache.flattened_modules:
        raise HTTPException(status_code=404, detail="Module not found")

    module = cache.flattened_modules[module_slug]
    return serialize_flattened_module(module)


def serialize_flattened_module(module: FlattenedModule) -> dict:
    """Serialize a flattened module to JSON."""
    return {
        "slug": module.slug,
        "title": module.title,
        "sections": [serialize_flat_section(s) for s in module.sections],
    }


def serialize_flat_section(section: FlatSection) -> dict:
    """Serialize a flat section to JSON."""
    if section.type == "page":
        return {
            "type": "page",
            "contentId": str(section.content_id) if section.content_id else None,
            "meta": {"title": section.title},
            "segments": section.segments,
        }
    elif section.type == "lens-video":
        return {
            "type": "lens-video",
            "contentId": str(section.content_id),
            "learningOutcomeId": str(section.learning_outcome_id) if section.learning_outcome_id else None,
            "videoId": section.video_id,
            "meta": {"title": section.title, "channel": section.channel},
            "segments": section.segments,
            "optional": section.optional,
        }
    elif section.type == "lens-article":
        return {
            "type": "lens-article",
            "contentId": str(section.content_id),
            "learningOutcomeId": str(section.learning_outcome_id) if section.learning_outcome_id else None,
            "meta": {
                "title": section.title,
                "author": section.author,
                "sourceUrl": section.source_url,
            },
            "segments": section.segments,
            "optional": section.optional,
        }
    return {}
```

**Step 4: Run test to verify it passes**

Run: `pytest web_api/tests/test_modules_v2.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add web_api/routes/modules.py web_api/tests/test_modules_v2.py
git commit -m "$(cat <<'EOF'
feat: update module API to serve flattened sections

API now returns flattened sections (page, lens-video, lens-article)
with learningOutcomeId for progress context.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6b: Update Progress Tracking Endpoint

**Files:**
- Modify: `web_api/routes/modules.py` (GET /api/modules/{slug}/progress)
- Test: `web_api/tests/test_modules_progress_v2.py`

**Problem:** The `/api/modules/{slug}/progress` endpoint uses `load_narrative_module()` which returns `ParsedModule`. It needs to use `flattened_modules` instead.

**Step 1: Write the failing test**

```python
# web_api/tests/test_modules_progress_v2.py
"""Tests for v2 module progress endpoint."""
import pytest
from datetime import datetime
from uuid import UUID

from fastapi.testclient import TestClient

from core.content.cache import ContentCache, set_cache
from core.modules.flattened_types import (
    FlattenedModule,
    FlatPageSection,
    FlatLensVideoSection,
)


@pytest.fixture
def mock_cache_for_progress():
    cache = ContentCache(
        courses={},
        flattened_modules={
            "intro": FlattenedModule(
                slug="intro",
                title="Introduction",
                content_id=UUID("00000000-0000-0000-0000-000000000001"),
                sections=[
                    FlatPageSection(
                        content_id=UUID("00000000-0000-0000-0000-000000000002"),
                        title="Welcome",
                        segments=[],
                    ),
                    FlatLensVideoSection(
                        content_id=UUID("00000000-0000-0000-0000-000000000003"),
                        learning_outcome_id=UUID("00000000-0000-0000-0000-000000000010"),
                        title="AI Safety Intro",
                        video_id="abc123",
                        channel="Kurzgesagt",
                        segments=[],
                        optional=False,
                    ),
                ],
            ),
        },
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)
    return cache


def test_progress_endpoint_uses_flattened_modules(mock_cache_for_progress):
    """GET /api/modules/{slug}/progress should use flattened module data."""
    from main import app
    client = TestClient(app)

    # Need to provide auth header or anonymous token
    response = client.get(
        "/api/modules/intro/progress",
        headers={"X-Anonymous-Token": "12345678-1234-1234-1234-123456789abc"}
    )
    assert response.status_code == 200

    data = response.json()
    assert data["module"]["slug"] == "intro"
    assert len(data["lenses"]) == 2  # Page + LensVideo

    # Check lens data includes learning outcome info
    lens_video = next(l for l in data["lenses"] if l["type"] == "lens-video")
    assert lens_video["id"] == "00000000-0000-0000-0000-000000000003"
```

**Step 2: Update implementation**

```python
@router.get("/modules/{module_slug}/progress")
async def get_module_progress_endpoint(
    module_slug: str,
    request: Request,
    x_anonymous_token: str | None = Header(None),
):
    """Get detailed progress for a single module."""
    from core.content.cache import get_cache

    cache = get_cache()

    if module_slug not in cache.flattened_modules:
        raise HTTPException(404, "Module not found")

    module = cache.flattened_modules[module_slug]

    # Get user identity
    user = await get_optional_user(request)
    user_id = user["user_id"] if user else None
    anonymous_token = None
    if not user_id and x_anonymous_token:
        try:
            anonymous_token = UUID(x_anonymous_token)
        except ValueError:
            pass

    if not user_id and not anonymous_token:
        raise HTTPException(401, "Authentication required")

    # Collect content IDs from flattened sections
    content_ids = [s.content_id for s in module.sections if s.content_id]

    async with get_connection() as conn:
        progress_map = await get_module_progress(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            lens_ids=content_ids,
        )

        chat_session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module.content_id,
            content_type="module",
        )

    # Build lens list from flattened sections
    lenses = []
    for section in module.sections:
        lens_data = {
            "id": str(section.content_id) if section.content_id else None,
            "title": section.title,
            "type": section.type,
            "optional": getattr(section, "optional", False),
            "completed": False,
            "completedAt": None,
            "timeSpentS": 0,
        }
        if section.content_id and section.content_id in progress_map:
            prog = progress_map[section.content_id]
            lens_data["completed"] = prog.get("completed_at") is not None
            lens_data["completedAt"] = (
                prog["completed_at"].isoformat() if prog.get("completed_at") else None
            )
            lens_data["timeSpentS"] = prog.get("total_time_spent_s", 0)
        lenses.append(lens_data)

    # Calculate status
    required = [l for l in lenses if not l["optional"]]
    completed_count = sum(1 for l in required if l["completed"])
    total_count = len(required)

    if completed_count == 0:
        status = "not_started"
    elif completed_count >= total_count:
        status = "completed"
    else:
        status = "in_progress"

    return {
        "module": {
            "id": str(module.content_id) if module.content_id else None,
            "slug": module.slug,
            "title": module.title,
        },
        "status": status,
        "progress": {"completed": completed_count, "total": total_count},
        "lenses": lenses,
        "chatSession": {
            "sessionId": chat_session["session_id"],
            "hasMessages": len(chat_session.get("messages", [])) > 0,
        },
    }
```

**Step 3: Run tests**

Run: `pytest web_api/tests/test_modules_progress_v2.py -v`
Expected: PASS

**Step 4: Commit**

```bash
git add web_api/routes/modules.py web_api/tests/test_modules_progress_v2.py
git commit -m "$(cat <<'EOF'
fix: update progress endpoint to use flattened modules

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update Frontend TypeScript Types

**Files:**
- Modify: `web_frontend/src/types/module.ts`

**Step 1: Update types**

```typescript
// web_frontend/src/types/module.ts

// v2 section types
export type PageSection = {
  type: "page";
  meta: { title: string | null };
  segments: ModuleSegment[];
  contentId?: string | null;
};

export type LensVideoSection = {
  type: "lens-video";
  contentId: string;
  learningOutcomeId: string | null;
  videoId: string;
  meta: { title: string; channel: string | null };
  segments: ModuleSegment[];
  optional: boolean;
};

export type LensArticleSection = {
  type: "lens-article";
  contentId: string;
  learningOutcomeId: string | null;
  meta: { title: string; author: string | null; sourceUrl: string | null };
  segments: ModuleSegment[];
  optional: boolean;
};

export type ModuleSection =
  | PageSection
  | LensVideoSection
  | LensArticleSection;

// Remove old v1 types: TextSection, ArticleSection, VideoSection, ChatSection,
// LearningOutcomeSection, UncategorizedSection
```

**Step 2: Run TypeScript check**

Run: `cd web_frontend && npm run build`
Expected: Type errors in components using old types

**Step 3: Fix type errors in components**

Update `Module.tsx` and other components to handle new types.

**Step 4: Verify build passes**

Run: `cd web_frontend && npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add web_frontend/src/types/module.ts
git commit -m "$(cat <<'EOF'
feat: update frontend types for v2 sections

Adds LensVideoSection, LensArticleSection with learningOutcomeId.
Removes obsolete v1 section types.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update Frontend Rendering

**Files:**
- Modify: `web_frontend/src/components/Module.tsx`
- Modify: `web_frontend/src/components/SectionDivider.tsx`

This task updates the frontend to render the new section types. Follow the same TDD pattern:
1. Update rendering logic for `lens-video` and `lens-article`
2. Update `SectionDivider` to show appropriate icons
3. Test manually in browser

---

## Task 9: Clean Up Old Code

**Files:**
- Remove or simplify: `core/modules/content.py` (bundling logic)
- Update: `core/modules/loader.py` (if still used)

Remove dead code that's no longer needed with the new flattening approach.

---

## Verification Checklist

Before marking complete:

- [ ] All new functions have tests
- [ ] `pytest` passes
- [ ] `ruff check .` passes
- [ ] `ruff format --check .` passes
- [ ] `cd web_frontend && npm run lint` passes
- [ ] `cd web_frontend && npm run build` passes
- [ ] Manual test: navigate to module, see flattened sections
- [ ] Manual test: sections show correct learningOutcomeId
