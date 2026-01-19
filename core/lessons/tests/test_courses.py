# core/lessons/tests/test_courses.py
"""Tests for course loader.

Tests use cache fixtures instead of file system patching.
Content validation tests are in test_content_validation.py.
"""

import pytest
from datetime import datetime

from core.content import ContentCache, set_cache, clear_cache
from core.lessons.course_loader import (
    load_course,
    get_next_lesson,
    get_all_lesson_slugs,
    get_lessons,
    get_required_lessons,
    get_due_by_meeting,
    CourseNotFoundError,
    _extract_slug_from_path,
)
from core.lessons.markdown_parser import (
    ParsedCourse,
    ParsedLesson,
    LessonRef,
    MeetingMarker,
    ChatSection,
)


@pytest.fixture
def test_cache():
    """Set up a test cache with courses and lessons."""
    # Create test lessons
    lessons = {
        "lesson-a": ParsedLesson(
            slug="lesson-a",
            title="Lesson A",
            sections=[
                ChatSection(instructions="Lesson A instructions"),
            ],
        ),
        "lesson-b": ParsedLesson(
            slug="lesson-b",
            title="Lesson B",
            sections=[
                ChatSection(instructions="Lesson B instructions"),
            ],
        ),
        "lesson-c": ParsedLesson(
            slug="lesson-c",
            title="Lesson C",
            sections=[
                ChatSection(instructions="Lesson C instructions"),
            ],
        ),
        "lesson-d": ParsedLesson(
            slug="lesson-d",
            title="Lesson D",
            sections=[
                ChatSection(instructions="Lesson D instructions"),
            ],
        ),
    }

    # Create test course (matches old test-course.yaml structure)
    courses = {
        "test-course": ParsedCourse(
            slug="test-course",
            title="Test Course",
            progression=[
                LessonRef(path="lessons/lesson-a"),
                LessonRef(path="lessons/lesson-b"),
                MeetingMarker(number=1),
                LessonRef(path="lessons/lesson-c", optional=True),
                MeetingMarker(number=2),
                LessonRef(path="lessons/lesson-d"),
            ],
        ),
    }

    cache = ContentCache(
        courses=courses,
        lessons=lessons,
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)

    yield cache

    clear_cache()


@pytest.fixture
def empty_cache():
    """Set up an empty cache for testing not-found errors."""
    cache = ContentCache(
        courses={},
        lessons={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)

    yield cache

    clear_cache()


def test_load_existing_course(test_cache):
    """Should load a course from cache."""
    course = load_course("test-course")
    assert course.slug == "test-course"
    assert course.title == "Test Course"
    assert len(course.progression) == 6  # 4 lessons + 2 meetings


def test_load_nonexistent_course(empty_cache):
    """Should raise CourseNotFoundError for unknown course."""
    with pytest.raises(CourseNotFoundError):
        load_course("nonexistent-course")


def test_get_next_lesson_within_module(test_cache):
    """Should return unit_complete when next item is a meeting."""
    # lesson-b is followed by meeting 1 in test-course
    result = get_next_lesson("test-course", "lesson-b")
    assert result is not None
    assert result["type"] == "unit_complete"
    assert result["unit_number"] == 1


def test_get_next_lesson_returns_lesson(test_cache):
    """Should return next lesson when there's no meeting in between."""
    # lesson-a is followed by lesson-b in test-course
    result = get_next_lesson("test-course", "lesson-a")
    assert result is not None
    assert result["type"] == "lesson"
    assert result["slug"] == "lesson-b"
    assert result["title"] == "Lesson B"


def test_get_next_lesson_end_of_course(test_cache):
    """Should return None at end of course."""
    # lesson-d is the last item in test-course
    result = get_next_lesson("test-course", "lesson-d")
    assert result is None


def test_get_next_lesson_unknown_lesson(test_cache):
    """Should return None for lesson not in course."""
    result = get_next_lesson("test-course", "nonexistent-lesson")
    assert result is None


def test_get_all_lesson_slugs(test_cache):
    """Should return flat list of all lesson slugs in order."""
    lesson_slugs = get_all_lesson_slugs("test-course")
    assert lesson_slugs == ["lesson-a", "lesson-b", "lesson-c", "lesson-d"]


# --- Tests for helper functions ---


def test_extract_slug_from_path():
    """_extract_slug_from_path should extract slug from path."""
    assert _extract_slug_from_path("lessons/introduction") == "introduction"
    assert _extract_slug_from_path("lessons/nested/path") == "path"
    assert _extract_slug_from_path("simple") == "simple"


def test_get_lessons():
    """get_lessons should return all LessonRefs excluding MeetingMarkers."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(path="lessons/lesson-1"),
            LessonRef(path="lessons/lesson-2", optional=True),
            MeetingMarker(number=1),
            LessonRef(path="lessons/lesson-3"),
        ],
    )
    lessons = get_lessons(course)
    assert len(lessons) == 3
    assert _extract_slug_from_path(lessons[0].path) == "lesson-1"
    assert _extract_slug_from_path(lessons[1].path) == "lesson-2"
    assert _extract_slug_from_path(lessons[2].path) == "lesson-3"


def test_get_required_lessons():
    """get_required_lessons should return only non-optional LessonRefs."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(path="lessons/lesson-1"),
            LessonRef(path="lessons/lesson-2", optional=True),
            MeetingMarker(number=1),
            LessonRef(path="lessons/lesson-3"),
            LessonRef(path="lessons/lesson-4", optional=True),
        ],
    )
    required = get_required_lessons(course)
    assert len(required) == 2
    assert _extract_slug_from_path(required[0].path) == "lesson-1"
    assert _extract_slug_from_path(required[1].path) == "lesson-3"


def test_get_due_by_meeting():
    """get_due_by_meeting should return the meeting number following a lesson."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(path="lessons/lesson-1"),
            LessonRef(path="lessons/lesson-2"),
            MeetingMarker(number=1),
            LessonRef(path="lessons/lesson-3"),
            MeetingMarker(number=2),
        ],
    )
    assert get_due_by_meeting(course, "lesson-1") == 1
    assert get_due_by_meeting(course, "lesson-2") == 1
    assert get_due_by_meeting(course, "lesson-3") == 2


def test_get_due_by_meeting_no_following_meeting():
    """Lessons after the last meeting should return None for due_by_meeting."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(path="lessons/lesson-1"),
            MeetingMarker(number=1),
            LessonRef(path="lessons/lesson-2"),
        ],
    )
    assert get_due_by_meeting(course, "lesson-1") == 1
    assert get_due_by_meeting(course, "lesson-2") is None


def test_get_due_by_meeting_unknown_lesson():
    """Unknown lesson slugs should return None for due_by_meeting."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            LessonRef(path="lessons/lesson-1"),
            MeetingMarker(number=1),
        ],
    )
    assert get_due_by_meeting(course, "nonexistent-lesson") is None


# --- Tests for course loader with progression format ---


def test_load_course_parses_progression_types(test_cache):
    """load_course should correctly parse LessonRefs and MeetingMarkers from cache."""
    course = load_course("test-course")

    lesson_refs = [item for item in course.progression if isinstance(item, LessonRef)]
    meetings = [item for item in course.progression if isinstance(item, MeetingMarker)]

    assert len(lesson_refs) == 4
    assert len(meetings) == 2

    # Check lesson refs - now use path instead of slug
    assert _extract_slug_from_path(lesson_refs[0].path) == "lesson-a"
    assert lesson_refs[2].optional is True  # lesson-c is optional

    # Check meetings
    assert meetings[0].number == 1
    assert meetings[1].number == 2
