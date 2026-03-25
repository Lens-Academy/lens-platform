# core/modules/tools/content_index.py
"""Index of all course content for search and read tools."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from core.modules.flattened_types import FlattenedModule, ModuleRef, ParsedCourse
from core.modules.context import _extract_segment_content


@dataclass
class SearchResult:
    """A single search result."""

    path: str
    snippet: str
    segment_type: str
    score: float


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

            # Title boost: add extra score if query term appears in lens title
            title_tokens = _tokenize(entry.lens_title)
            for term in terms:
                if term in title_tokens:
                    score += idf.get(term, 1.0)  # flat title hit bonus

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
