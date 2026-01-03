# core/lessons/loader.py
"""Load lesson definitions from YAML files."""

import yaml
from pathlib import Path

from .types import Lesson, ArticleStage, VideoStage, ChatStage, Stage


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
        )
    elif stage_type == "video":
        return VideoStage(
            type="video",
            source=data["source"],
            from_seconds=_parse_time(data.get("from", "0:00")),
            to_seconds=_parse_time(data.get("to")),
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


def load_lesson(lesson_id: str) -> Lesson:
    """
    Load a lesson by ID from the lessons directory.

    Args:
        lesson_id: The lesson ID (filename without .yaml extension)

    Returns:
        Lesson dataclass with parsed stages

    Raises:
        LessonNotFoundError: If lesson file doesn't exist
    """
    lesson_path = LESSONS_DIR / f"{lesson_id}.yaml"

    if not lesson_path.exists():
        raise LessonNotFoundError(f"Lesson not found: {lesson_id}")

    with open(lesson_path) as f:
        data = yaml.safe_load(f)

    stages = [_parse_stage(s) for s in data["stages"]]

    return Lesson(
        id=data["id"],
        title=data["title"],
        stages=stages,
    )


def get_available_lessons() -> list[str]:
    """
    Get list of available lesson IDs.

    Returns:
        List of lesson IDs (filenames without .yaml extension)
    """
    if not LESSONS_DIR.exists():
        return []

    return [f.stem for f in LESSONS_DIR.glob("*.yaml")]
