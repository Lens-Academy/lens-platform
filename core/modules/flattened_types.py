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
