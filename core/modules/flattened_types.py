# core/modules/flattened_types.py
"""Flattened module types for API responses.

These types represent the final, resolved structure that the API returns.
Learning Outcomes and Uncategorized sections are expanded into their
constituent video and article sections.

Section types in the sections list (all dicts):
- type: "page" - Page with text/chat segments
- type: "video" - Video section with transcript excerpts
- type: "article" - Article section with collapsed content support

Video and article sections from lenses include:
- contentId: Lens UUID
- learningOutcomeId: Learning Outcome UUID (or null if uncategorized)
"""

from dataclasses import dataclass, field
from typing import Union
from uuid import UUID


@dataclass
class FlattenedModule:
    """A module with all sections flattened and resolved."""

    slug: str
    title: str
    content_id: UUID | None
    sections: list[dict] = field(default_factory=list)
    error: str | None = None


@dataclass
class ModuleRef:
    """Reference to a module in a course progression."""

    path: str  # Wiki-link path like "modules/introduction"
    optional: bool = False


@dataclass
class MeetingMarker:
    """A meeting marker in the course progression."""

    number: int


# Type alias for progression items
ProgressionItem = Union[ModuleRef, MeetingMarker]


@dataclass
class ParsedCourse:
    """A parsed course definition."""

    slug: str
    title: str
    progression: list[ProgressionItem] = field(default_factory=list)
