"""
Type definitions for lesson stages and sessions.
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
    minutes: int | None = None  # Manual override for reading time (auto-calculated if None)


@dataclass
class VideoStage:
    """Display a YouTube video clip."""
    type: Literal["video"]
    source: str  # Path to transcript markdown file
    from_seconds: int = 0
    to_seconds: int | None = None  # None means to end
    optional: bool = False  # Whether this stage can be skipped


@dataclass
class ChatStage:
    """Active discussion with AI tutor."""
    type: Literal["chat"]
    instructions: str  # Instructions for the AI tutor
    show_user_previous_content: bool = True  # Show previous article/video to user in UI
    show_tutor_previous_content: bool = True  # Include previous content in tutor's context


Stage = ArticleStage | VideoStage | ChatStage


@dataclass
class Lesson:
    """A complete lesson definition."""
    id: str
    title: str
    stages: list[Stage]


@dataclass
class Module:
    """A module within a course."""
    id: str
    title: str
    lessons: list[str]  # List of lesson IDs


@dataclass
class Course:
    """A complete course definition."""
    id: str
    title: str
    modules: list[Module]


@dataclass
class NextLesson:
    """Information about the next lesson."""
    lesson_id: str
    lesson_title: str