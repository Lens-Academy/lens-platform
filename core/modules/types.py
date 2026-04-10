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
    hide_previous_content_from_user: bool = (
        False  # Hide previous article/video from user in UI
    )
    hide_previous_content_from_tutor: bool = (
        False  # Exclude previous content from tutor's context
    )


Stage = ArticleStage | VideoStage | ChatStage


# --- Narrative Module Types ---


@dataclass
class TextSegment:
    """Standalone authored text."""

    type: Literal["text"]
    content: str


@dataclass
class ArticleSegment:
    """Article content segment."""

    type: Literal["article"]
    from_text: str
    to_text: str
    title: str | None = None
    author: str | None = None
    sourceUrl: str | None = None
    published: str | None = None


@dataclass
class VideoSegment:
    """Video content segment."""

    type: Literal["video"]
    from_seconds: int
    to_seconds: int
    title: str | None = None
    channel: str | None = None
    videoId: str | None = None


@dataclass
class ChatSegment:
    """Interactive chat within a section."""

    type: Literal["chat"]
    instructions: str
    hide_previous_content_from_user: bool = False
    hide_previous_content_from_tutor: bool = False


@dataclass
class RoleplaySegment:
    """Interactive roleplay scenario with AI character."""

    type: Literal["roleplay"]
    id: str  # UUID for session isolation
    content: str  # Student-facing scenario briefing
    ai_instructions: str  # Character behavior + personality
    opening_message: str | None = None  # Optional first message
    assessment_instructions: str | None = None  # Optional scoring rubric
    optional: bool = False


@dataclass
class EmbedSegment:
    """External embedded interactive content (e.g. iframe)."""

    type: Literal["embed"]
    url: str
    height: str | None = None
    width: str | None = None
    aspect_ratio: str | None = None
    summary: str | None = None
    sandbox: str | None = None
    cached_content: str | None = None
    optional: bool = False


NarrativeSegment = (
    TextSegment | ArticleSegment | VideoSegment | ChatSegment | RoleplaySegment | EmbedSegment
)


@dataclass
class LensSection:
    """Lens section with segments."""

    type: Literal["lens"]
    segments: list[NarrativeSegment]


NarrativeSection = LensSection


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

    name: str


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
