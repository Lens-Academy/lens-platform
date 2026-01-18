# core/lessons/loader.py
"""Load lesson definitions from YAML files."""

import yaml
from pathlib import Path

from .types import (
    Lesson,
    ArticleStage,
    VideoStage,
    ChatStage,
    Stage,
    NarrativeLesson,
    NarrativeSection,
    NarrativeSegment,
    TextSection,
    ArticleSection,
    VideoSection,
    TextSegment,
    ArticleExcerptSegment,
    VideoExcerptSegment,
    ChatSegment,
)


class LessonNotFoundError(Exception):
    """Raised when a lesson cannot be found."""

    pass


# Path to lesson JSON files (educational_content at project root)
LESSONS_DIR = Path(__file__).parent.parent.parent / "educational_content" / "lessons"


def _parse_time(value: str | None) -> int | None:
    """Parse a time string "M:SS" into seconds.

    Args:
        value: Time as "M:SS" (e.g., "1:30") or None

    Returns:
        Seconds as int, or None
    """
    if value is None:
        return None
    parts = value.split(":")
    minutes = int(parts[0])
    seconds = int(parts[1])
    return minutes * 60 + seconds


def _parse_stage(data: dict) -> Stage:
    """Parse a stage dict into a Stage dataclass."""
    stage_type = data["type"]

    if stage_type == "article":
        return ArticleStage(
            type="article",
            source=data["source"],
            from_text=data.get("from"),
            to_text=data.get("to"),
            optional=data.get("optional", False),
            introduction=data.get("introduction"),
        )
    elif stage_type == "video":
        return VideoStage(
            type="video",
            source=data["source"],
            from_seconds=_parse_time(data.get("from", "0:00")),
            to_seconds=_parse_time(data.get("to")),
            optional=data.get("optional", False),
            introduction=data.get("introduction"),
        )
    elif stage_type == "chat":
        # Support new separate fields, with backwards compat for old includePreviousContent
        if "showUserPreviousContent" in data or "showTutorPreviousContent" in data:
            show_user = data.get("showUserPreviousContent", True)
            show_tutor = data.get("showTutorPreviousContent", True)
        else:
            # Backwards compatibility: old field sets both
            legacy_value = data.get("includePreviousContent", True)
            show_user = legacy_value
            show_tutor = legacy_value

        return ChatStage(
            type="chat",
            instructions=data["instructions"],
            show_user_previous_content=show_user,
            show_tutor_previous_content=show_tutor,
        )
    else:
        raise ValueError(f"Unknown stage type: {stage_type}")


def _parse_narrative_segment(data: dict) -> NarrativeSegment:
    """Parse a narrative segment dict into a segment dataclass."""
    segment_type = data["type"]

    if segment_type == "text":
        return TextSegment(type="text", content=data["content"])
    elif segment_type == "article-excerpt":
        return ArticleExcerptSegment(
            type="article-excerpt",
            from_text=data["from"],
            to_text=data["to"],
        )
    elif segment_type == "video-excerpt":
        return VideoExcerptSegment(
            type="video-excerpt",
            from_seconds=data["from"],
            to_seconds=data["to"],
        )
    elif segment_type == "chat":
        return ChatSegment(
            type="chat",
            instructions=data.get("instructions", ""),
            show_user_previous_content=data.get("showUserPreviousContent", True),
            show_tutor_previous_content=data.get("showTutorPreviousContent", True),
        )
    else:
        raise ValueError(f"Unknown narrative segment type: {segment_type}")


def _parse_narrative_section(data: dict) -> NarrativeSection:
    """Parse a narrative section dict into a section dataclass."""
    section_type = data["type"]

    if section_type == "text":
        return TextSection(type="text", content=data["content"])
    elif section_type == "article":
        segments = [_parse_narrative_segment(s) for s in data.get("segments", [])]
        return ArticleSection(
            type="article",
            source=data["source"],
            segments=segments,
        )
    elif section_type == "video":
        segments = [_parse_narrative_segment(s) for s in data.get("segments", [])]
        return VideoSection(
            type="video",
            source=data["source"],
            segments=segments,
        )
    else:
        raise ValueError(f"Unknown narrative section type: {section_type}")


def load_lesson(lesson_slug: str) -> Lesson:
    """
    Load a lesson by slug from the lessons directory.

    Args:
        lesson_slug: The lesson slug (filename without .yaml extension)

    Returns:
        Lesson dataclass with parsed stages

    Raises:
        LessonNotFoundError: If lesson file doesn't exist
    """
    lesson_path = LESSONS_DIR / f"{lesson_slug}.yaml"

    if not lesson_path.exists():
        raise LessonNotFoundError(f"Lesson not found: {lesson_slug}")

    with open(lesson_path) as f:
        data = yaml.safe_load(f)

    stages = [_parse_stage(s) for s in data["stages"]]

    return Lesson(
        slug=data["slug"],
        title=data["title"],
        stages=stages,
    )


def load_narrative_lesson(lesson_slug: str) -> NarrativeLesson:
    """
    Load a narrative lesson by slug from the lessons directory.

    Args:
        lesson_slug: The lesson slug (filename without .yaml extension)

    Returns:
        NarrativeLesson dataclass with parsed sections

    Raises:
        LessonNotFoundError: If lesson file doesn't exist
    """
    lesson_path = LESSONS_DIR / f"{lesson_slug}.yaml"

    if not lesson_path.exists():
        raise LessonNotFoundError(f"Lesson not found: {lesson_slug}")

    with open(lesson_path) as f:
        data = yaml.safe_load(f)

    sections = [_parse_narrative_section(s) for s in data["sections"]]

    return NarrativeLesson(
        slug=data["slug"],
        title=data["title"],
        sections=sections,
    )


def get_available_lessons() -> list[str]:
    """
    Get list of available lesson slugs.

    Returns:
        List of lesson slugs (filenames without .yaml extension)
    """
    if not LESSONS_DIR.exists():
        return []

    return [f.stem for f in LESSONS_DIR.glob("*.yaml")]
