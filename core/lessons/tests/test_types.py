# core/lessons/tests/test_types.py
"""Tests for lesson types."""

from core.lessons.types import LessonRef, Meeting, Course


def test_lesson_ref_defaults():
    """LessonRef should default optional to False."""
    ref = LessonRef(slug="test-lesson")
    assert ref.slug == "test-lesson"
    assert ref.optional is False


def test_lesson_ref_optional():
    """LessonRef should accept optional flag."""
    ref = LessonRef(slug="test-lesson", optional=True)
    assert ref.optional is True


def test_meeting_number():
    """Meeting should store its number."""
    meeting = Meeting(number=1)
    assert meeting.number == 1


def test_course_with_progression():
    """Course should have progression list."""
    course = Course(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(slug="lesson-1"),
            LessonRef(slug="lesson-2", optional=True),
            Meeting(number=1),
        ]
    )
    assert len(course.progression) == 3
