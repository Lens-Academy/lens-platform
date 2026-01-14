# core/lessons/tests/test_courses.py
"""Tests for course loader."""

import pytest
from core.lessons.course_loader import (
    load_course,
    get_next_lesson,
    get_all_lesson_slugs,
    get_lessons,
    get_required_lessons,
    get_due_by_meeting,
    CourseNotFoundError,
)
from core.lessons.types import Course, LessonRef, Meeting


def test_load_existing_course():
    """Should load a course from YAML file."""
    course = load_course("default")
    assert course.slug == "default"
    assert course.title == "AI Safety Fundamentals"
    assert len(course.progression) > 0


def test_load_nonexistent_course():
    """Should raise CourseNotFoundError for unknown course."""
    with pytest.raises(CourseNotFoundError):
        load_course("nonexistent-course")


def test_get_next_lesson_within_module():
    """Should return next lesson in same module."""
    result = get_next_lesson("default", "intro-to-ai-safety")
    assert result is not None
    assert result.lesson_slug == "intelligence-feedback-loop"


def test_get_next_lesson_end_of_course():
    """Should return None at end of course."""
    # Get the last lesson slug
    all_lessons = get_all_lesson_slugs("default")
    last_lesson = all_lessons[-1]
    result = get_next_lesson("default", last_lesson)
    assert result is None


def test_get_next_lesson_unknown_lesson():
    """Should return None for lesson not in course."""
    result = get_next_lesson("default", "nonexistent-lesson")
    assert result is None


def test_get_all_lesson_slugs():
    """Should return flat list of all lesson slugs in order."""
    lesson_slugs = get_all_lesson_slugs("default")
    assert isinstance(lesson_slugs, list)
    assert "intro-to-ai-safety" in lesson_slugs
    assert "intelligence-feedback-loop" in lesson_slugs
    # Order should be intro first
    assert lesson_slugs.index("intro-to-ai-safety") < lesson_slugs.index(
        "intelligence-feedback-loop"
    )


from core.lessons.loader import get_available_lessons, load_lesson


def test_all_lessons_have_unique_slugs():
    """All lesson YAML files should have unique slugs."""
    lesson_files = get_available_lessons()
    slugs_seen = {}

    for lesson_file in lesson_files:
        lesson = load_lesson(lesson_file)
        if lesson.slug in slugs_seen:
            pytest.fail(
                f"Duplicate lesson slug '{lesson.slug}' found in "
                f"'{lesson_file}.yaml' and '{slugs_seen[lesson.slug]}.yaml'"
            )
        slugs_seen[lesson.slug] = lesson_file


def test_course_manifest_references_existing_lessons():
    """All lesson slugs in course manifest should exist as files."""
    course = load_course("default")
    available = set(get_available_lessons())

    for item in course.progression:
        if isinstance(item, LessonRef):
            if item.slug not in available:
                pytest.fail(
                    f"Course 'default' references non-existent lesson: '{item.slug}'"
                )


# --- Tests for new helper functions (Task 2) ---


def test_get_lessons():
    """get_lessons should return all LessonRefs excluding Meetings."""
    course = Course(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(slug="lesson-1"),
            LessonRef(slug="lesson-2", optional=True),
            Meeting(number=1),
            LessonRef(slug="lesson-3"),
        ],
    )
    lessons = get_lessons(course)
    assert len(lessons) == 3
    assert lessons[0].slug == "lesson-1"
    assert lessons[1].slug == "lesson-2"
    assert lessons[2].slug == "lesson-3"


def test_get_required_lessons():
    """get_required_lessons should return only non-optional LessonRefs."""
    course = Course(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(slug="lesson-1"),
            LessonRef(slug="lesson-2", optional=True),
            Meeting(number=1),
            LessonRef(slug="lesson-3"),
            LessonRef(slug="lesson-4", optional=True),
        ],
    )
    required = get_required_lessons(course)
    assert len(required) == 2
    assert required[0].slug == "lesson-1"
    assert required[1].slug == "lesson-3"


def test_get_due_by_meeting():
    """get_due_by_meeting should return the meeting number following a lesson."""
    course = Course(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(slug="lesson-1"),
            LessonRef(slug="lesson-2"),
            Meeting(number=1),
            LessonRef(slug="lesson-3"),
            Meeting(number=2),
        ],
    )
    assert get_due_by_meeting(course, "lesson-1") == 1
    assert get_due_by_meeting(course, "lesson-2") == 1
    assert get_due_by_meeting(course, "lesson-3") == 2


def test_get_due_by_meeting_no_following_meeting():
    """Lessons after the last meeting should return None for due_by_meeting."""
    course = Course(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(slug="lesson-1"),
            Meeting(number=1),
            LessonRef(slug="lesson-2"),
        ],
    )
    assert get_due_by_meeting(course, "lesson-1") == 1
    assert get_due_by_meeting(course, "lesson-2") is None


def test_get_due_by_meeting_unknown_lesson():
    """Unknown lesson slugs should return None for due_by_meeting."""
    course = Course(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(slug="lesson-1"),
            Meeting(number=1),
        ],
    )
    assert get_due_by_meeting(course, "nonexistent-lesson") is None


# --- Tests for course loader with progression format (Task 3) ---


def test_load_course_parses_progression_types():
    """load_course should correctly parse LessonRefs and Meetings from YAML.

    Tests parsing logic, not specific course content.
    """
    course = load_course("default")

    # Should have a non-empty progression
    assert len(course.progression) > 0

    # Progression should contain both LessonRefs and Meetings
    lesson_refs = [item for item in course.progression if isinstance(item, LessonRef)]
    meetings = [item for item in course.progression if isinstance(item, Meeting)]

    assert len(lesson_refs) > 0, "Course should have at least one lesson"
    assert len(meetings) > 0, "Course should have at least one meeting"

    # Each LessonRef should have a slug
    for ref in lesson_refs:
        assert ref.slug, "LessonRef should have a non-empty slug"

    # Each Meeting should have a number
    for meeting in meetings:
        assert meeting.number >= 1, "Meeting should have a positive number"
