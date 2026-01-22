"""
Type definitions for module stages and sessions.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass
class ArticleStage:
    """Display a section of a markdown article."""

    type: Literal["article"]
    source: str  # Path to article markdown file
    from_text: str | None = None  # None means full article
    to_text: str | None = None
    optional: bool = False  # Whether this stage can be skipped
    minutes: int | None = (
        None  # Manual override for reading time (auto-calculated if None)
    )
    introduction: str | None = None  # Lens Academy intro note


@dataclass
class VideoStage:
    """Display a YouTube video clip."""

    type: Literal["video"]
    source: str  # Path to transcript markdown file
    from_seconds: int = 0
    to_seconds: int | None = None  # None means to end
    optional: bool = False  # Whether this stage can be skipped
    introduction: str | None = None  # Lens Academy intro note


@dataclass
class ChatStage:
    """Active discussion with AI tutor."""

    type: Literal["chat"]
    instructions: str  # Instructions for the AI tutor
    hide_previous_content_from_user: bool = False  # Hide previous article/video from user in UI
    hide_previous_content_from_tutor: bool = False  # Exclude previous content from tutor's context


Stage = ArticleStage | VideoStage | ChatStage


# --- Narrative Module Types ---


@dataclass
class TextSegment:
    """Standalone authored text."""

    type: Literal["text"]
    content: str


@dataclass
class ArticleExcerptSegment:
    """Extract from parent article."""

    type: Literal["article-excerpt"]
    from_text: str
    to_text: str


@dataclass
class VideoExcerptSegment:
    """Extract from parent video."""

    type: Literal["video-excerpt"]
    from_seconds: int
    to_seconds: int


@dataclass
class ChatSegment:
    """Interactive chat within a section."""

    type: Literal["chat"]
    instructions: str
    hide_previous_content_from_user: bool = False
    hide_previous_content_from_tutor: bool = False


NarrativeSegment = (
    TextSegment | ArticleExcerptSegment | VideoExcerptSegment | ChatSegment
)


@dataclass
class TextSection:
    """Standalone text section (no child segments)."""

    type: Literal["text"]
    content: str


@dataclass
class ArticleSection:
    """Article section with segments."""

    type: Literal["article"]
    source: str
    segments: list[NarrativeSegment]


@dataclass
class VideoSection:
    """Video section with segments."""

    type: Literal["video"]
    source: str
    segments: list[NarrativeSegment]


NarrativeSection = TextSection | ArticleSection | VideoSection


@dataclass
class NarrativeModule:
    """A narrative-format module definition."""

    slug: str
    title: str
    sections: list[NarrativeSection]


@dataclass
class Module:
    """A complete module definition."""

    slug: str
    title: str
    stages: list[Stage]


@dataclass
class ModuleRef:
    """Reference to a module in a course progression."""

    slug: str
    optional: bool = False


@dataclass
class Meeting:
    """A meeting marker in the course progression."""

    number: int


ProgressionItem = ModuleRef | Meeting


@dataclass
class Course:
    """A complete course definition."""

    slug: str
    title: str
    progression: list[ProgressionItem]


@dataclass
class NextModule:
    """Information about the next module."""

    module_slug: str
    module_title: str
