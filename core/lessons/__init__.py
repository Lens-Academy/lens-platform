"""Lesson management module."""

from .types import (
    ArticleStage,
    VideoStage,
    ChatStage,
    Stage,
    Lesson,
)
from .loader import (
    load_lesson,
    get_available_lessons,
    LessonNotFoundError,
)
from .content import (
    load_article,
    extract_article_section,
    load_video_transcript,
)
from .sessions import (
    create_session,
    get_session,
    get_user_sessions,
    add_message,
    advance_stage,
    complete_session,
    SessionNotFoundError,
)
from .chat import send_message as send_lesson_message, get_stage_content

__all__ = [
    "ArticleStage",
    "VideoStage",
    "ChatStage",
    "Stage",
    "Lesson",
    "load_lesson",
    "get_available_lessons",
    "LessonNotFoundError",
    "load_article",
    "extract_article_section",
    "load_video_transcript",
    "create_session",
    "get_session",
    "get_user_sessions",
    "add_message",
    "advance_stage",
    "complete_session",
    "SessionNotFoundError",
    "send_lesson_message",
    "get_stage_content",
]
