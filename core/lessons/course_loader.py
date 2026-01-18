# core/lessons/course_loader.py
"""Load course definitions from cache."""

from core.content import get_cache
from core.lessons.markdown_parser import ParsedCourse, LessonRef, MeetingMarker
from .loader import load_narrative_lesson, LessonNotFoundError


class CourseNotFoundError(Exception):
    """Raised when a course cannot be found."""

    pass


def load_course(course_slug: str) -> ParsedCourse:
    """Load a course by slug from the cache."""
    cache = get_cache()

    if course_slug not in cache.courses:
        raise CourseNotFoundError(f"Course not found: {course_slug}")

    return cache.courses[course_slug]


def _extract_slug_from_path(path: str) -> str:
    """Extract lesson slug from path like 'lessons/introduction' -> 'introduction'."""
    return path.split("/")[-1]


def get_all_lesson_slugs(course_slug: str) -> list[str]:
    """Get flat list of all lesson slugs in course order."""
    course = load_course(course_slug)
    return [
        _extract_slug_from_path(item.path)
        for item in course.progression
        if isinstance(item, LessonRef)
    ]


def get_next_lesson(course_slug: str, current_lesson_slug: str) -> dict | None:
    """Get what comes after the current lesson in the progression.

    Returns:
        - {"type": "lesson", "slug": str, "title": str} if next item is a lesson
        - {"type": "unit_complete", "unit_number": int} if next item is a meeting
        - None if end of course or lesson not found
    """
    course = load_course(course_slug)

    # Find the current lesson's index in progression
    current_index = None
    for i, item in enumerate(course.progression):
        if isinstance(item, LessonRef):
            # Extract slug from path (e.g., "lessons/introduction" -> "introduction")
            item_slug = _extract_slug_from_path(item.path)
            if item_slug == current_lesson_slug:
                current_index = i
                break

    if current_index is None:
        return None  # Lesson not in this course

    # Look at the next item in progression
    next_index = current_index + 1
    if next_index >= len(course.progression):
        return None  # End of course

    next_item = course.progression[next_index]

    if isinstance(next_item, MeetingMarker):
        return {"type": "unit_complete", "unit_number": next_item.number}

    if isinstance(next_item, LessonRef):
        next_slug = _extract_slug_from_path(next_item.path)
        try:
            next_lesson = load_narrative_lesson(next_slug)
            return {
                "type": "lesson",
                "slug": next_slug,
                "title": next_lesson.title,
            }
        except LessonNotFoundError:
            return None

    return None


def get_lessons(course: ParsedCourse) -> list[LessonRef]:
    """Get all lesson references from a course, excluding meetings.

    Args:
        course: The course to get lessons from.

    Returns:
        List of LessonRef objects in progression order.
    """
    return [item for item in course.progression if isinstance(item, LessonRef)]


def get_required_lessons(course: ParsedCourse) -> list[LessonRef]:
    """Get only required (non-optional) lesson references from a course.

    Args:
        course: The course to get required lessons from.

    Returns:
        List of non-optional LessonRef objects in progression order.
    """
    return [
        item
        for item in course.progression
        if isinstance(item, LessonRef) and not item.optional
    ]


def get_due_by_meeting(course: ParsedCourse, lesson_slug: str) -> int | None:
    """Get the meeting number by which a lesson should be completed.

    Lessons are due by the next meeting that follows them in the progression.
    If there is no meeting after a lesson, returns None.

    Args:
        course: The course containing the lesson.
        lesson_slug: The slug of the lesson to check.

    Returns:
        Meeting number if there's a following meeting, None otherwise.
    """
    found_lesson = False

    for item in course.progression:
        if isinstance(item, LessonRef):
            item_slug = _extract_slug_from_path(item.path)
            if item_slug == lesson_slug:
                found_lesson = True
        elif found_lesson and isinstance(item, MeetingMarker):
            return item.number

    return None
