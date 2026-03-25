# Course Content Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tutor LLM two local tools — `search_course_content` and `read_lens` — that let it explore all course content using a path-based namespace (`course/module/lens`).

**Architecture:** Build a `ContentIndex` that walks all courses in the cache at startup, extracts searchable text from every segment, and stores it keyed by path. `search_course_content` does keyword matching with BM25-like term scoring. `read_lens` returns full lens content formatted with `<segment>` tags. Both tools are registered as local tools alongside the existing MCP tools in `get_tools()`.

**Tech Stack:** Python stdlib only (no new dependencies). `re` for tokenization, `math.log` for IDF. Reuses existing `_extract_segment_content()` from `core/modules/context.py` for consistent content extraction.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `core/modules/tools/content_index.py` | **ContentIndex** class: builds path→content mapping from cache, keyword search with ranking, lens reading |
| `core/modules/tools/course_search.py` | Tool definitions (OpenAI format) and execution functions for `search_course_content` and `read_lens` |
| `core/modules/tools/__init__.py` | Extended to register local tools alongside MCP tools |
| `core/modules/prompts.py` | `build_course_overview()` reformatted as path tree |
| `core/modules/tests/test_content_index.py` | Tests for indexing, search, and read |
| `core/modules/tests/test_course_tools.py` | Tests for tool definitions and execution |
| `core/modules/tests/test_tool_registry.py` | Updated: local tools registered alongside MCP |
| `core/modules/tests/test_prompts.py` | Updated: course overview tree format |

---

## Path Namespace

Paths use the format: `{course_title}/{module_title}/{lens_title}`

Example:
```
AGI Safety Fundamentals/
  Artificial Intelligence/
    What is AI
    Machine Learning
  Risks from AI/
    What could go wrong
    Goals and misalignment
```

The course overview in the system prompt will display this tree. Tool results reference these same paths. The LLM navigates from overview → search/read using consistent paths.

Path matching is **case-insensitive** and **slash-normalized** (leading/trailing slashes stripped). Partial paths are not supported for `read_lens` — full `course/module/lens` required.

---

## Task 1: ContentIndex — Build path mapping from cache

Build the core index that walks all courses and creates a path→content mapping.

**Files:**
- Create: `core/modules/tools/content_index.py`
- Create: `core/modules/tests/test_content_index.py`

- [ ] **Step 1: Write failing test for `build_index`**

```python
# core/modules/tests/test_content_index.py
"""Tests for course content indexing."""

from core.modules.tools.content_index import ContentIndex


def _make_cache_data():
    """Minimal cache-like data for testing."""
    from core.modules.flattened_types import FlattenedModule, ParsedCourse, ModuleRef

    modules = {
        "risks-from-ai": FlattenedModule(
            slug="risks-from-ai",
            title="Risks from AI",
            content_id=None,
            sections=[
                {
                    "type": "lens",
                    "meta": {"title": "Goal Misgeneralization"},
                    "segments": [
                        {"type": "text", "content": "Mesa-optimization is when a learned model develops its own objective."},
                        {"type": "article", "content": "Inner alignment failures can cause mesa-optimizers to pursue unintended goals.", "title": "Inner Alignment", "author": "Hubinger"},
                        {"type": "chat", "instructions": "Discuss"},
                    ],
                },
                {
                    "type": "lens",
                    "meta": {"title": "Deceptive Alignment"},
                    "segments": [
                        {"type": "video", "transcript": "A deceptively aligned agent would behave well during training.", "title": "Deceptive AI", "channel": "Robert Miles"},
                        {"type": "chat", "instructions": "Discuss"},
                    ],
                },
            ],
        ),
        "alignment": FlattenedModule(
            slug="alignment",
            title="Alignment Approaches",
            content_id=None,
            sections=[
                {
                    "type": "lens",
                    "meta": {"title": "RLHF Overview"},
                    "segments": [
                        {"type": "text", "content": "Reinforcement learning from human feedback is a technique for aligning language models."},
                        {"type": "chat", "instructions": "Discuss"},
                    ],
                },
            ],
        ),
    }

    courses = {
        "agi-safety": ParsedCourse(
            slug="agi-safety",
            title="AGI Safety Fundamentals",
            progression=[
                ModuleRef(slug="risks-from-ai"),
                ModuleRef(slug="alignment"),
            ],
        ),
    }

    return courses, modules


class TestContentIndexBuild:
    def test_builds_paths_from_course(self):
        """Index should create entries for each lens in each course."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        paths = index.list_paths()
        assert "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization" in paths
        assert "AGI Safety Fundamentals/Risks from AI/Deceptive Alignment" in paths
        assert "AGI Safety Fundamentals/Alignment Approaches/RLHF Overview" in paths

    def test_total_lens_count(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)
        assert len(index.list_paths()) == 3

    def test_skips_modules_not_in_courses(self):
        """Modules not referenced by any course should not be indexed."""
        courses, modules = _make_cache_data()
        # Add a standalone module not in any course
        from core.modules.flattened_types import FlattenedModule
        modules["standalone"] = FlattenedModule(
            slug="standalone",
            title="Standalone Module",
            content_id=None,
            sections=[{"type": "lens", "meta": {"title": "Orphan Lens"}, "segments": [{"type": "text", "content": "Not in course"}]}],
        )
        index = ContentIndex(courses, modules)
        assert not any("Standalone" in p for p in index.list_paths())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_content_index.py::TestContentIndexBuild -v`
Expected: FAIL (ImportError — `content_index` doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```python
# core/modules/tools/content_index.py
"""Index of all course content for search and read tools."""

from __future__ import annotations

from dataclasses import dataclass, field

from core.modules.flattened_types import FlattenedModule, ModuleRef, ParsedCourse
from core.modules.context import _extract_segment_content


@dataclass
class LensEntry:
    """A single lens in the index."""

    path: str  # "Course Title/Module Title/Lens Title"
    course_title: str
    module_title: str
    lens_title: str
    module_slug: str
    section_index: int
    segments: list[tuple[int, str, str]]  # (index, type, content)
    searchable_text: str  # All segment content joined for search


class ContentIndex:
    """Index of all course content, keyed by path."""

    def __init__(
        self,
        courses: dict[str, ParsedCourse],
        modules: dict[str, FlattenedModule],
    ) -> None:
        self._entries: dict[str, LensEntry] = {}  # lowercase path -> entry
        self._build(courses, modules)

    def _build(
        self,
        courses: dict[str, ParsedCourse],
        modules: dict[str, FlattenedModule],
    ) -> None:
        for course in courses.values():
            for item in course.progression:
                if not isinstance(item, ModuleRef):
                    continue
                module = modules.get(item.slug)
                if not module:
                    continue
                for sec_idx, section in enumerate(module.sections):
                    lens_title = section.get("meta", {}).get("title")
                    if not lens_title:
                        continue
                    path = f"{course.title}/{module.title}/{lens_title}"

                    # Extract segment content using existing helper
                    meta = section.get("meta", {})
                    article_title = meta.get("title")
                    article_author = meta.get("author")

                    extracted: list[tuple[int, str, str]] = []
                    text_parts: list[str] = []
                    for i, seg in enumerate(section.get("segments", [])):
                        content = _extract_segment_content(
                            seg, article_title, article_author
                        )
                        if content:
                            seg_type = seg.get("type", "unknown")
                            if seg_type == "article":
                                seg_type = "article-excerpt"
                            elif seg_type == "video":
                                seg_type = "video-excerpt"
                            extracted.append((i, seg_type, content))
                            text_parts.append(content)

                    self._entries[path.lower()] = LensEntry(
                        path=path,
                        course_title=course.title,
                        module_title=module.title,
                        lens_title=lens_title,
                        module_slug=module.slug,
                        section_index=sec_idx,
                        segments=extracted,
                        searchable_text="\n".join(text_parts),
                    )

    def list_paths(self) -> list[str]:
        """Return all indexed paths (original casing)."""
        return [e.path for e in self._entries.values()]

    def get_lens(self, path: str) -> LensEntry | None:
        """Look up a lens by path (case-insensitive)."""
        normalized = path.strip("/").lower()
        return self._entries.get(normalized)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_content_index.py::TestContentIndexBuild -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: ContentIndex builds path mapping from courses"
```

---

## Task 2: ContentIndex — `read_lens` returns formatted content

**Files:**
- Modify: `core/modules/tools/content_index.py`
- Modify: `core/modules/tests/test_content_index.py`

- [ ] **Step 1: Write failing test for `read_lens`**

```python
class TestContentIndexRead:
    def test_read_existing_lens(self):
        """read_lens should return formatted content with segment tags."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens("AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization")
        assert result is not None
        assert '<segment index="1" type="text">' in result
        assert "Mesa-optimization" in result
        assert '<segment index="2" type="article-excerpt">' in result
        assert "Inner alignment failures" in result
        assert '<segment index="3" type="chat">' in result
        assert "</segment>" in result

    def test_read_case_insensitive(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens("agi safety fundamentals/risks from ai/goal misgeneralization")
        assert result is not None
        assert "Mesa-optimization" in result

    def test_read_nonexistent_returns_none(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens("Nonexistent/Path/Here")
        assert result is None

    def test_read_strips_slashes(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        result = index.read_lens("/AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization/")
        assert result is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_content_index.py::TestContentIndexRead -v`
Expected: FAIL (AttributeError — `read_lens` not yet implemented)

- [ ] **Step 3: Write minimal implementation**

Add to `ContentIndex` class:

```python
    def read_lens(self, path: str) -> str | None:
        """Read full lens content formatted with segment tags.

        Returns None if path not found.
        """
        entry = self.get_lens(path)
        if not entry:
            return None

        parts = [f'<lens path="{entry.path}">']
        for seg_idx, seg_type, content in entry.segments:
            idx = seg_idx + 1
            parts.append(f'<segment index="{idx}" type="{seg_type}">')
            parts.append(content)
            parts.append("</segment>")
        parts.append("</lens>")

        return "\n".join(parts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_content_index.py::TestContentIndexRead -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: ContentIndex.read_lens returns formatted segment content"
```

---

## Task 3: ContentIndex — keyword search with ranking

**Files:**
- Modify: `core/modules/tools/content_index.py`
- Modify: `core/modules/tests/test_content_index.py`

- [ ] **Step 1: Write failing tests for `search`**

```python
class TestContentIndexSearch:
    def test_search_finds_matching_content(self):
        """Search should find lenses containing the query terms."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        results = index.search("mesa-optimization")
        assert len(results) >= 1
        assert results[0].path == "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization"

    def test_search_returns_snippets(self):
        """Results should include a text snippet with context."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        results = index.search("RLHF")
        assert len(results) >= 1
        assert "reinforcement learning" in results[0].snippet.lower()

    def test_search_ranks_by_relevance(self):
        """Lenses with more matches should rank higher."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        # "mesa" appears twice in Goal Misgeneralization, not at all in others
        results = index.search("mesa")
        if len(results) > 1:
            assert results[0].path == "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization"

    def test_search_no_results(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        results = index.search("quantum computing blockchain")
        assert results == []

    def test_search_empty_query(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        results = index.search("")
        assert results == []

    def test_search_max_results(self):
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        results = index.search("alignment", max_results=1)
        assert len(results) <= 1

    def test_search_result_has_path_and_segment_type(self):
        """Results should include the lens path and the segment type of the best match."""
        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        results = index.search("deceptively aligned")
        assert len(results) >= 1
        result = results[0]
        assert result.path == "AGI Safety Fundamentals/Risks from AI/Deceptive Alignment"
        assert result.segment_type == "video-excerpt"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_content_index.py::TestContentIndexSearch -v`
Expected: FAIL (AttributeError — `search` not yet implemented)

- [ ] **Step 3: Write minimal implementation**

Add to `content_index.py`:

```python
import math
import re
from dataclasses import dataclass


@dataclass
class SearchResult:
    """A single search result."""

    path: str
    snippet: str
    segment_type: str
    score: float


# Add these methods to ContentIndex class:

    def search(self, query: str, max_results: int = 5) -> list[SearchResult]:
        """Search indexed content by keyword.

        Uses term frequency with IDF weighting. Returns results
        sorted by relevance score, highest first.
        """
        query = query.strip()
        if not query:
            return []

        terms = _tokenize(query)
        if not terms:
            return []

        # Compute IDF for each term
        n_docs = len(self._entries)
        if n_docs == 0:
            return []

        idf: dict[str, float] = {}
        for term in terms:
            doc_freq = sum(
                1 for e in self._entries.values()
                if term in _tokenize(e.searchable_text)
            )
            idf[term] = math.log((n_docs + 1) / (doc_freq + 1)) + 1

        results: list[SearchResult] = []
        for entry in self._entries.values():
            tokens = _tokenize(entry.searchable_text)
            if not tokens:
                continue

            # TF-IDF score
            score = 0.0
            for term in terms:
                tf = tokens.count(term) / len(tokens)
                score += tf * idf.get(term, 0)

            # Title boost: 2x if query term appears in lens title
            title_tokens = _tokenize(entry.lens_title)
            for term in terms:
                if term in title_tokens:
                    score *= 2.0

            if score <= 0:
                continue

            # Find best matching segment for snippet
            snippet, seg_type = _best_snippet(entry, terms)

            results.append(SearchResult(
                path=entry.path,
                snippet=snippet,
                segment_type=seg_type,
                score=score,
            ))

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:max_results]


def _tokenize(text: str) -> list[str]:
    """Lowercase and split on non-alphanumeric characters."""
    return re.findall(r"[a-z0-9]+(?:[-'][a-z0-9]+)*", text.lower())


def _best_snippet(entry: LensEntry, terms: list[str]) -> tuple[str, str]:
    """Find the segment with the most term matches and extract a snippet."""
    best_seg_type = "text"
    best_content = ""
    best_count = -1

    for _, seg_type, content in entry.segments:
        seg_tokens = _tokenize(content)
        count = sum(seg_tokens.count(t) for t in terms)
        if count > best_count:
            best_count = count
            best_content = content
            best_seg_type = seg_type

    # Extract snippet around first term occurrence
    snippet = _extract_snippet(best_content, terms)
    return snippet, best_seg_type


def _extract_snippet(text: str, terms: list[str], max_len: int = 200) -> str:
    """Extract a snippet centered on the first matching term."""
    text_lower = text.lower()
    # Find earliest term position
    earliest = len(text)
    for term in terms:
        pos = text_lower.find(term)
        if 0 <= pos < earliest:
            earliest = pos

    if earliest == len(text):
        # No exact match found, return start of text
        return text[:max_len] + ("..." if len(text) > max_len else "")

    # Center snippet around match
    half = max_len // 2
    start = max(0, earliest - half)
    end = min(len(text), start + max_len)
    start = max(0, end - max_len)

    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."

    return snippet
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_content_index.py::TestContentIndexSearch -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: ContentIndex.search with TF-IDF keyword ranking"
```

---

## Task 4: Tool definitions and execution

Wire up `search_course_content` and `read_lens` as local tools in OpenAI function-calling format.

**Files:**
- Create: `core/modules/tools/course_search.py`
- Create: `core/modules/tests/test_course_tools.py`

**Testing approach (unit+1):** Tests use a real `ContentIndex` (direct dependency) with real test data. The tool call object is a simple `MagicMock` matching the structure used in existing tests (see `test_tool_registry.py`). No mocks on the code under test — we're testing that `execute_tool` dispatches correctly and returns formatted results from the real index.

- [ ] **Step 1: Write failing tests**

```python
# core/modules/tests/test_course_tools.py
"""Tests for course content tool definitions and execution."""

import json
from unittest.mock import MagicMock

from core.modules.tools.course_search import get_tool_definitions, execute_tool


def _make_tool_call(name: str, arguments: dict):
    """Create a tool call object matching LiteLLM's structure.

    Uses MagicMock consistent with existing test patterns in test_tool_registry.py.
    """
    tc = MagicMock()
    tc.function.name = name
    tc.function.arguments = json.dumps(arguments)
    return tc


def _make_index():
    """Build a real ContentIndex from test data."""
    from core.modules.tests.test_content_index import _make_cache_data
    from core.modules.tools.content_index import ContentIndex
    courses, modules = _make_cache_data()
    return ContentIndex(courses, modules)


class TestToolDefinitions:
    def test_returns_two_tools(self):
        tools = get_tool_definitions()
        assert len(tools) == 2

    def test_search_tool_schema(self):
        tools = get_tool_definitions()
        search = next(t for t in tools if t["function"]["name"] == "search_course_content")
        assert search["type"] == "function"
        params = search["function"]["parameters"]
        assert "query" in params["properties"]
        assert "query" in params["required"]

    def test_read_tool_schema(self):
        tools = get_tool_definitions()
        read = next(t for t in tools if t["function"]["name"] == "read_lens")
        assert read["type"] == "function"
        params = read["function"]["parameters"]
        assert "path" in params["properties"]
        assert "path" in params["required"]


class TestExecuteSearch:
    """execute_tool dispatches search_course_content to real ContentIndex."""

    def test_returns_formatted_results(self):
        index = _make_index()
        tc = _make_tool_call("search_course_content", {"query": "mesa-optimization"})
        result = execute_tool(tc, index)
        assert "Goal Misgeneralization" in result
        assert "AGI Safety Fundamentals" in result

    def test_no_results_message(self):
        index = _make_index()
        tc = _make_tool_call("search_course_content", {"query": "quantum blockchain"})
        result = execute_tool(tc, index)
        assert "No results found" in result


class TestExecuteRead:
    """execute_tool dispatches read_lens to real ContentIndex."""

    def test_returns_lens_content(self):
        index = _make_index()
        tc = _make_tool_call("read_lens", {"path": "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization"})
        result = execute_tool(tc, index)
        assert "<lens" in result
        assert "Mesa-optimization" in result

    def test_not_found_message(self):
        index = _make_index()
        tc = _make_tool_call("read_lens", {"path": "Nonexistent/Path/Here"})
        result = execute_tool(tc, index)
        assert "not found" in result.lower()


class TestExecuteUnknown:
    def test_unknown_tool_returns_error(self):
        index = _make_index()
        tc = _make_tool_call("unknown_tool", {})
        result = execute_tool(tc, index)
        assert "unknown" in result.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_course_tools.py -v`
Expected: FAIL (ImportError — `course_search` doesn't exist)

- [ ] **Step 3: Write minimal implementation**

```python
# core/modules/tools/course_search.py
"""Local tool definitions and execution for course content search and reading."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .content_index import ContentIndex


SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_course_content",
        "description": (
            "Search across all course content (articles, videos, text) for relevant excerpts. "
            "Use when the student asks about topics that may be covered elsewhere in the course, "
            "or when you need to find specific content to reference."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search terms to find in course content",
                },
            },
            "required": ["query"],
        },
    },
}

READ_TOOL = {
    "type": "function",
    "function": {
        "name": "read_lens",
        "description": (
            "Read the full content of a specific lens (page) in the course. "
            "Use the path format from the course overview: Course/Module/Lens. "
            "Returns all segments with their content."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": (
                        "Full path to the lens: 'Course Title/Module Title/Lens Title'"
                    ),
                },
            },
            "required": ["path"],
        },
    },
}


def get_tool_definitions() -> list[dict]:
    """Return tool definitions in OpenAI function-calling format."""
    return [SEARCH_TOOL, READ_TOOL]


def execute_tool(tool_call, index: ContentIndex) -> str:
    """Execute a local course content tool and return result as string."""
    name = tool_call.function.name
    args = json.loads(tool_call.function.arguments)

    if name == "search_course_content":
        return _execute_search(args, index)
    elif name == "read_lens":
        return _execute_read(args, index)
    else:
        return f"Error: unknown tool '{name}'"


def _execute_search(args: dict, index: ContentIndex) -> str:
    """Execute search_course_content."""
    query = args.get("query", "")
    results = index.search(query)

    if not results:
        return f'No results found for "{query}".'

    lines = [f'Found {len(results)} result(s) for "{query}":', ""]
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r.path} ({r.segment_type})")
        lines.append(f'   "{r.snippet}"')
        lines.append("")

    return "\n".join(lines)


def _execute_read(args: dict, index: ContentIndex) -> str:
    """Execute read_lens."""
    path = args.get("path", "")
    content = index.read_lens(path)

    if content is None:
        available = index.list_paths()
        suggestion = ""
        # Suggest close matches
        path_lower = path.lower()
        close = [p for p in available if path_lower.split("/")[-1] in p.lower()]
        if close:
            suggestion = f"\n\nDid you mean one of these?\n" + "\n".join(f"- {p}" for p in close[:3])
        return f'Lens not found: "{path}".{suggestion}'

    return content
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_course_tools.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: course search/read tool definitions and execution"
```

---

## Task 5: Register local tools in tool registry

Extend `get_tools()` and `execute_tool()` to include local course content tools alongside MCP tools.

**Files:**
- Modify: `core/modules/tools/__init__.py`
- Modify: `core/modules/tests/test_tool_registry.py`

**Testing approach (unit+1):** Uses real `MCPClientManager` (direct dependency) and real `ContentIndex`. Mocks only the MCP session boundary (external/network). This follows the pattern established in the existing `test_tool_registry.py` tests — real `MCPClientManager(url=None)` for "no MCP" cases, `patch.object(mgr, "get_session")` for "MCP available" cases.

- [ ] **Step 1: Write failing test**

```python
# Add to test_tool_registry.py

class TestLocalToolRegistration:
    """Local course content tools should be included alongside MCP tools."""

    @pytest.fixture
    def content_index(self):
        from core.modules.tests.test_content_index import _make_cache_data
        from core.modules.tools.content_index import ContentIndex
        courses, modules = _make_cache_data()
        return ContentIndex(courses, modules)

    @pytest.mark.asyncio
    async def test_local_tools_available_without_mcp(self, content_index):
        """Local tools should work even when MCP is unavailable."""
        # Real MCPClientManager with no URL — MCP genuinely unavailable
        mgr = MCPClientManager(url=None)
        tools = await get_tools(mgr, content_index=content_index)
        assert tools is not None
        names = [t["function"]["name"] for t in tools]
        assert "search_course_content" in names
        assert "read_lens" in names

    @pytest.mark.asyncio
    async def test_local_tools_included_when_mcp_available(self, content_index):
        """get_tools should return both MCP and local tools."""
        mgr = MCPClientManager(url="http://example.com/mcp")
        mock_session = MagicMock()
        fake_mcp_tools = [{"type": "function", "function": {"name": "search_alignment_research"}}]

        # Mock only the external boundary: MCP session and tool loading
        with (
            patch.object(mgr, "get_session", new_callable=AsyncMock, return_value=mock_session),
            patch(
                "core.modules.tools.alignment_search.load_tools",
                new_callable=AsyncMock,
                return_value=fake_mcp_tools,
            ),
        ):
            tools = await get_tools(mgr, content_index=content_index)

        names = [t["function"]["name"] for t in tools]
        assert "search_alignment_research" in names
        assert "search_course_content" in names
        assert "read_lens" in names

    @pytest.mark.asyncio
    async def test_no_tools_without_index_or_mcp(self):
        """No tools available when both MCP and index are unavailable."""
        mgr = MCPClientManager(url=None)
        tools = await get_tools(mgr, content_index=None)
        assert tools is None


class TestExecuteLocalTool:
    """execute_tool dispatches local tools to course_search, not MCP."""

    @pytest.mark.asyncio
    async def test_dispatches_search_to_local_handler(self):
        """search_course_content should use ContentIndex, not MCP session."""
        from core.modules.tests.test_content_index import _make_cache_data
        from core.modules.tools.content_index import ContentIndex

        courses, modules = _make_cache_data()
        index = ContentIndex(courses, modules)

        # Real MCPClientManager with no URL — proves MCP is not needed
        mgr = MCPClientManager(url=None)

        tool_call = MagicMock()
        tool_call.function.name = "search_course_content"
        tool_call.function.arguments = '{"query": "mesa-optimization"}'

        result = await execute_tool(mgr, tool_call, content_index=index)
        assert "Goal Misgeneralization" in result

    @pytest.mark.asyncio
    async def test_local_tool_without_index_returns_error(self):
        """Local tool with no ContentIndex should return error, not crash."""
        mgr = MCPClientManager(url=None)

        tool_call = MagicMock()
        tool_call.function.name = "search_course_content"
        tool_call.function.arguments = '{"query": "test"}'

        result = await execute_tool(mgr, tool_call, content_index=None)
        assert "not available" in result.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_tool_registry.py::TestLocalToolRegistration -v`
Expected: FAIL (signature mismatch — `content_index` param not yet accepted)

- [ ] **Step 3: Modify `get_tools()` and `execute_tool()`**

**Note:** The existing `TestGetToolsCaching` test asserts `result == fake_tools` (MCP tools only). After this change, `get_tools` returns MCP + local tools when `content_index` is provided. Since that test doesn't pass `content_index`, it will still pass (local tools not included). But verify this — if the test breaks, update it to account for the new signature.

Update `core/modules/tools/__init__.py`:

```python
"""Tool registry for the tutor chat system.

Assembles tools per request and dispatches execution.
"""

import asyncio
import json
import logging

from . import alignment_search
from .mcp_client import MCPClientManager

logger = logging.getLogger(__name__)

# Tool execution timeout in seconds
TOOL_TIMEOUT = 15

# Local tool names (dispatched to course_search, not MCP)
_LOCAL_TOOL_NAMES = {"search_course_content", "read_lens"}


async def get_tools(
    mcp_manager: MCPClientManager,
    content_index=None,
) -> list[dict] | None:
    """Get all available tools in OpenAI function-calling format.

    Combines MCP tools (alignment search) with local tools (course content).
    Returns None when no tools are available at all.
    """
    all_tools: list[dict] = []

    # MCP tools (cached after first load)
    if mcp_manager.tools_cache is not None:
        all_tools.extend(mcp_manager.tools_cache)
    else:
        for attempt in range(2):
            session = await mcp_manager.get_session()
            if not session:
                break
            mcp_tools = await alignment_search.load_tools(session)
            if mcp_tools:
                logger.info("Loaded %d MCP tools", len(mcp_tools))
                mcp_manager.tools_cache = mcp_tools
                all_tools.extend(mcp_tools)
                break
            if attempt == 0:
                logger.info("No MCP tools loaded, resetting session and retrying")
                await mcp_manager.reset()
        else:
            mcp_manager.tools_cache = []

    # Local tools (course content)
    if content_index is not None:
        from .course_search import get_tool_definitions
        all_tools.extend(get_tool_definitions())

    return all_tools or None


async def execute_tool(
    mcp_manager: MCPClientManager,
    tool_call,
    content_index=None,
) -> str:
    """Execute a single tool call and return the result as a string."""
    name = tool_call.function.name

    # Local tools — no MCP needed
    if name in _LOCAL_TOOL_NAMES:
        if content_index is None:
            return "Error: course content index not available"
        from .course_search import execute_tool as execute_local
        return execute_local(tool_call, content_index)

    # MCP tools
    for attempt in range(2):
        try:
            session = await mcp_manager.get_session()
            if not session:
                return "Error: search service unavailable"
            result = await asyncio.wait_for(
                alignment_search.execute(session, tool_call), timeout=TOOL_TIMEOUT
            )
            return result
        except asyncio.TimeoutError:
            logger.warning("Tool %s timed out after %ds", name, TOOL_TIMEOUT)
            return "Tool timed out — respond without this information."
        except Exception as e:
            if attempt == 0:
                logger.info("Tool %s failed, reconnecting: %s", name, e)
                await mcp_manager.reset()
                continue
            logger.warning("Tool %s failed after retry: %s", name, e, exc_info=True)
            await mcp_manager.reset()
            return f"Error: tool unavailable ({e})"

    return "Error: tool unavailable"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_tool_registry.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: register local course tools alongside MCP tools"
```

---

## Task 6: Wire into chat loop and event generator

Pass the `ContentIndex` through the chat pipeline: build at startup, pass to `send_module_message`, pass to tool functions.

**Files:**
- Modify: `core/modules/chat.py` — accept `content_index` param, pass to `get_tools`/`execute_tool`
- Modify: `web_api/routes/module.py` — build index and pass through
- Modify: `main.py` — build index at startup, store on `app.state`

**Testing approach:** This task is pure wiring — adding a parameter and passing it through. The real behavior (search, read, tool dispatch) is fully tested in Tasks 1-5. Adding a mock-based "verify parameter was passed" test would be testing mock behavior (anti-pattern #1), not real behavior. Instead: verify existing tests still pass, then manually verify with `DEBUG=1`.

- [ ] **Step 1: Modify `send_module_message` signature**

In `core/modules/chat.py`, add `content_index=None` parameter to `send_module_message()` and pass it through to `get_tools()` and `execute_tool()` calls:

```python
async def send_module_message(
    messages: list[dict],
    current_stage: Stage,
    current_content: str | None = None,
    provider: str | None = None,
    course_overview: str | None = None,
    mcp_manager=None,
    content_index=None,  # NEW
) -> AsyncIterator[dict]:
    # ...
    tools = await get_tools(mcp_manager, content_index=content_index)
    # ...
    result = await execute_tool(mcp_manager, tc, content_index=content_index)
```

- [ ] **Step 2: Modify `web_api/routes/module.py`**

In `event_generator()`, get the content index from app state and pass to `send_module_message`:

```python
content_index = getattr(app.state, "content_index", None) if app else None

async for chunk in send_module_message(
    llm_messages,
    stage,
    None,
    mcp_manager=mcp_manager,
    course_overview=course_overview,
    content_index=content_index,  # NEW
):
```

- [ ] **Step 3: Build index at startup in `main.py`**

After content cache is initialized, build the index:

```python
from core.modules.tools.content_index import ContentIndex
from core.content import get_cache

# After cache is populated (in lifespan or startup):
try:
    cache = get_cache()
    app.state.content_index = ContentIndex(cache.courses, cache.flattened_modules)
    logger.info("Built content index: %d lenses", len(app.state.content_index.list_paths()))
except Exception as e:
    logger.warning("Failed to build content index: %s", e)
    app.state.content_index = None
```

Also rebuild the index when content is refreshed (after webhook/polling updates).

- [ ] **Step 4: Run all existing tests to verify no regressions**

Run: `pytest core/modules/tests/ -v`
Expected: ALL PASS (existing tests pass `content_index=None` implicitly via default)

- [ ] **Step 5: Commit**

```bash
jj new -m "feat: wire content index through chat pipeline"
```

---

## Task 7: Reformat course overview as path tree

Update `build_course_overview()` to display the course structure as a file-tree using the same path format the tools use.

**Files:**
- Modify: `core/modules/prompts.py`
- Modify: `core/modules/tests/test_prompts.py`
- Modify: `core/modules/tests/fixtures/system_prompt_expected_output.md` (if golden-file test exists)

- [ ] **Step 1: Write failing test**

**Testing approach:** `build_course_overview` calls `load_flattened_module()` internally, which reads from the global content cache. We patch `load_flattened_module` to return test data — this is the correct boundary (it's a cache lookup, and we want to test formatting logic, not cache population).

```python
# In test_prompts.py, add or update:

from unittest.mock import patch
from core.modules.flattened_types import ParsedCourse, ModuleRef, MeetingMarker, FlattenedModule


class TestBuildCourseOverview:
    def _make_course_and_modules(self):
        """Build test course with modules for overview formatting."""
        course = ParsedCourse(
            slug="agi-safety",
            title="AGI Safety Fundamentals",
            progression=[
                ModuleRef(slug="risks"),
                MeetingMarker(name="Week 2"),
                ModuleRef(slug="alignment"),
                ModuleRef(slug="governance", optional=True),
            ],
        )
        modules = {
            "risks": FlattenedModule(
                slug="risks",
                title="Risks from AI",
                content_id=None,
                sections=[
                    {"type": "lens", "meta": {"title": "Goal Misgeneralization"}, "segments": [], "tldr": "How AI goals can diverge"},
                    {"type": "lens", "meta": {"title": "Deceptive Alignment"}, "segments": [], "tldr": ""},
                ],
            ),
            "alignment": FlattenedModule(
                slug="alignment",
                title="Alignment Approaches",
                content_id=None,
                sections=[
                    {"type": "lens", "meta": {"title": "RLHF Overview"}, "segments": [], "tldr": "Training with human feedback"},
                ],
            ),
            "governance": FlattenedModule(
                slug="governance",
                title="AI Governance",
                content_id=None,
                sections=[
                    {"type": "lens", "meta": {"title": "Compute Governance"}, "segments": [], "tldr": ""},
                ],
            ),
        }
        return course, modules

    def test_tree_format_with_course_title(self):
        """Course overview should start with course title as root."""
        course, modules = self._make_course_and_modules()
        with patch("core.modules.prompts.load_flattened_module", side_effect=lambda slug: modules[slug]):
            result = build_course_overview(course)
        assert "AGI Safety Fundamentals/" in result

    def test_tree_shows_modules_indented(self):
        course, modules = self._make_course_and_modules()
        with patch("core.modules.prompts.load_flattened_module", side_effect=lambda slug: modules[slug]):
            result = build_course_overview(course)
        assert "  Risks from AI/" in result
        assert "  Alignment Approaches/" in result

    def test_tree_shows_lenses_indented(self):
        course, modules = self._make_course_and_modules()
        with patch("core.modules.prompts.load_flattened_module", side_effect=lambda slug: modules[slug]):
            result = build_course_overview(course)
        assert "    Goal Misgeneralization" in result
        assert "    RLHF Overview" in result

    def test_tree_includes_tldr(self):
        course, modules = self._make_course_and_modules()
        with patch("core.modules.prompts.load_flattened_module", side_effect=lambda slug: modules[slug]):
            result = build_course_overview(course)
        assert "TLDR: How AI goals can diverge" in result

    def test_tree_shows_optional_marker(self):
        course, modules = self._make_course_and_modules()
        with patch("core.modules.prompts.load_flattened_module", side_effect=lambda slug: modules[slug]):
            result = build_course_overview(course)
        assert "(optional)" in result

    def test_tree_shows_unit_dividers(self):
        course, modules = self._make_course_and_modules()
        with patch("core.modules.prompts.load_flattened_module", side_effect=lambda slug: modules[slug]):
            result = build_course_overview(course)
        assert "Unit 1" in result
        assert "Unit 2" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest core/modules/tests/test_prompts.py::TestBuildCourseOverview -v`

- [ ] **Step 3: Rewrite `build_course_overview()`**

```python
def build_course_overview(course: ParsedCourse) -> str:
    """Build a tree-formatted course overview for the system prompt.

    Uses the same path namespace as the search/read tools:
    CourseTitle/ModuleTitle/LensTitle

    Meetings divide the course into units.
    """
    from .loader import load_flattened_module
    from . import ModuleNotFoundError

    lines = [COURSE_OVERVIEW_INTRO, ""]
    lines.append(f"{course.title}/")

    # Split progression into units (delimited by MeetingMarkers)
    units: list[list[ModuleRef]] = [[]]
    for item in course.progression:
        if isinstance(item, MeetingMarker):
            units.append([])
        elif isinstance(item, ModuleRef):
            units[-1].append(item)

    for unit_num, module_refs in enumerate(units, start=1):
        if not module_refs:
            continue

        lines.append(f"  --- Unit {unit_num} ---")

        for mod_ref in module_refs:
            try:
                module = load_flattened_module(mod_ref.slug)
            except (ModuleNotFoundError, Exception):
                optional = " (optional)" if mod_ref.optional else ""
                lines.append(f"  {mod_ref.slug}/{optional} (unavailable)")
                continue

            optional = " (optional)" if mod_ref.optional else ""
            lines.append(f"  {module.title}/{optional}")

            for section in module.sections:
                title = section.get("meta", {}).get("title", "Untitled")
                tldr = section.get("tldr", "")
                lines.append(f"    {title}")
                if tldr:
                    lines.append(f"      TLDR: {tldr}")

    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest core/modules/tests/test_prompts.py::TestBuildCourseOverview -v`

- [ ] **Step 5: Update golden-file fixture if needed**

If `test_system_prompt_format.py` uses a fixture file, regenerate it.

- [ ] **Step 6: Run all tests**

Run: `pytest core/modules/tests/ -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
jj new -m "refactor: course overview as path tree matching tool namespace"
```

---

## Verification

After all tasks:

```bash
# All module tests pass
pytest core/modules/tests/ -v

# Linting clean
ruff check .
ruff format --check .

# Manual verification with DEBUG=1
# Start server, send a chat message, verify:
# 1. Course overview in system prompt shows tree format
# 2. Tools list includes search_course_content and read_lens
# 3. LLM can call search and get results
# 4. LLM can call read_lens with a path from search results
```
