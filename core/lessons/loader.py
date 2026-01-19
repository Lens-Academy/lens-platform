# core/lessons/loader.py
"""Load lesson definitions from cache."""

from core.content import get_cache
from core.lessons.markdown_parser import ParsedLesson


class LessonNotFoundError(Exception):
    """Raised when a lesson cannot be found."""

    pass


def load_narrative_lesson(lesson_slug: str) -> ParsedLesson:
    """
    Load a narrative lesson by slug from the cache.

    Args:
        lesson_slug: The lesson slug

    Returns:
        ParsedLesson dataclass

    Raises:
        LessonNotFoundError: If lesson not in cache
    """
    cache = get_cache()

    if lesson_slug not in cache.lessons:
        raise LessonNotFoundError(f"Lesson not found: {lesson_slug}")

    return cache.lessons[lesson_slug]


def get_available_lessons() -> list[str]:
    """
    Get list of available lesson slugs.

    Returns:
        List of lesson slugs
    """
    cache = get_cache()
    return list(cache.lessons.keys())


# Legacy function - redirect to narrative lesson
def load_lesson(lesson_slug: str) -> ParsedLesson:
    """Load a lesson (legacy - redirects to narrative format)."""
    return load_narrative_lesson(lesson_slug)
