# core/lessons/course_loader.py
"""Load course definitions from YAML files."""

import yaml
from pathlib import Path

from .types import Course, Module, NextLesson, LessonRef, Meeting
from .loader import load_lesson, LessonNotFoundError


class CourseNotFoundError(Exception):
    """Raised when a course cannot be found."""
    pass


COURSES_DIR = Path(__file__).parent.parent.parent / "educational_content" / "courses"


def load_course(course_slug: str) -> Course:
    """Load a course by slug from the courses directory."""
    course_path = COURSES_DIR / f"{course_slug}.yaml"

    if not course_path.exists():
        raise CourseNotFoundError(f"Course not found: {course_slug}")

    with open(course_path) as f:
        data = yaml.safe_load(f)

    modules = [
        Module(
            id=m["id"],
            title=m["title"],
            lessons=m["lessons"],
            due_by_meeting=m.get("due_by_meeting"),
        )
        for m in data["modules"]
    ]

    return Course(
        slug=data["slug"],
        title=data["title"],
        modules=modules,
    )


def get_all_lesson_slugs(course_slug: str) -> list[str]:
    """Get flat list of all lesson slugs in course order."""
    course = load_course(course_slug)
    lesson_slugs = []
    for module in course.modules:
        lesson_slugs.extend(module.lessons)
    return lesson_slugs


def get_next_lesson(course_slug: str, current_lesson_slug: str) -> NextLesson | None:
    """Get the next lesson after the current one."""
    lesson_slugs = get_all_lesson_slugs(course_slug)

    try:
        current_index = lesson_slugs.index(current_lesson_slug)
    except ValueError:
        return None  # Lesson not in this course

    next_index = current_index + 1
    if next_index >= len(lesson_slugs):
        return None  # End of course

    next_lesson_slug = lesson_slugs[next_index]

    try:
        next_lesson = load_lesson(next_lesson_slug)
        return NextLesson(
            lesson_slug=next_lesson_slug,
            lesson_title=next_lesson.title,
        )
    except LessonNotFoundError:
        return None


def get_lessons(course: Course) -> list[LessonRef]:
    """Get all lesson references from a course, excluding meetings.

    Args:
        course: The course to get lessons from.

    Returns:
        List of LessonRef objects in progression order.
    """
    return [item for item in course.progression if isinstance(item, LessonRef)]


def get_required_lessons(course: Course) -> list[LessonRef]:
    """Get only required (non-optional) lesson references from a course.

    Args:
        course: The course to get required lessons from.

    Returns:
        List of non-optional LessonRef objects in progression order.
    """
    return [
        item for item in course.progression
        if isinstance(item, LessonRef) and not item.optional
    ]


def get_due_by_meeting(course: Course, lesson_slug: str) -> int | None:
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
        if isinstance(item, LessonRef) and item.slug == lesson_slug:
            found_lesson = True
        elif found_lesson and isinstance(item, Meeting):
            return item.number

    return None
