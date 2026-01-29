"""Module management package."""

# Stage types for chat context (v1 chat system)
from .types import (
    ArticleStage,
    VideoStage,
    ChatStage,
    Stage,
)
from .loader import (
    load_module,
    load_narrative_module,
    load_flattened_module,
    get_available_modules,
    ModuleNotFoundError,
)
from .content import (
    load_article,
    extract_article_section,
    load_video_transcript,
    load_video_transcript_with_metadata,
    load_article_with_metadata,
    ArticleContent,
    ArticleMetadata,
    VideoTranscriptContent,
    VideoTranscriptMetadata,
)
from .chat import send_module_message, get_stage_content
from .context import gather_section_context
from .llm import DEFAULT_PROVIDER
from .course_loader import (
    load_course,
    get_next_module,
    get_all_module_slugs,
    get_modules,
    get_required_modules,
    get_due_by_meeting,
    CourseNotFoundError,
)

__all__ = [
    # Stage types for chat context
    "ArticleStage",
    "VideoStage",
    "ChatStage",
    "Stage",
    # Module loading
    "load_module",
    "load_narrative_module",
    "load_flattened_module",
    "get_available_modules",
    "ModuleNotFoundError",
    # Content loading
    "load_article",
    "extract_article_section",
    "load_video_transcript",
    "load_video_transcript_with_metadata",
    "load_article_with_metadata",
    "ArticleContent",
    "ArticleMetadata",
    "VideoTranscriptContent",
    "VideoTranscriptMetadata",
    # Chat
    "send_module_message",
    "get_stage_content",
    "DEFAULT_PROVIDER",
    # Context gathering
    "gather_section_context",
    # Course
    "load_course",
    "get_next_module",
    "get_all_module_slugs",
    "get_modules",
    "get_required_modules",
    "get_due_by_meeting",
    "CourseNotFoundError",
]
