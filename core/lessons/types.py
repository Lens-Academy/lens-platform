"""
Type definitions for lesson stages and sessions.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass
class ArticleStage:
    """Display a section of a markdown article."""
    type: Literal["article"]
    source_url: str
    from_text: str | None = None  # None means full article
    to_text: str | None = None


@dataclass
class VideoStage:
    """Display a YouTube video clip."""
    type: Literal["video"]
    video_id: str
    from_seconds: int = 0
    to_seconds: int | None = None  # None means to end


@dataclass
class ChatStage:
    """Active discussion with AI tutor."""
    type: Literal["chat"]
    context: str  # Instructions for the AI
    include_previous_content: bool = True


Stage = ArticleStage | VideoStage | ChatStage


@dataclass
class Lesson:
    """A complete lesson definition."""
    id: str
    title: str
    stages: list[Stage]
