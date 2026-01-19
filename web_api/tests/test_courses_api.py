# web_api/tests/test_courses_api.py
"""Tests for course API endpoints.

These tests dynamically discover course structure rather than hardcoding
specific lesson names. This makes tests resilient to content changes.
"""

import sys
from pathlib import Path

# Ensure we import from root main.py, not web_api/main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

import pytest
from fastapi.testclient import TestClient
from main import app
from core.lessons.course_loader import load_course, _extract_slug_from_path
from core.lessons.markdown_parser import LessonRef, MeetingMarker

client = TestClient(app)


# --- Helper functions for dynamic course discovery ---


def get_first_lesson_before_meeting(course_slug: str) -> str | None:
    """Find first lesson that's followed by a meeting."""
    course = load_course(course_slug)
    for i, item in enumerate(course.progression[:-1]):
        if isinstance(item, LessonRef) and isinstance(
            course.progression[i + 1], MeetingMarker
        ):
            return _extract_slug_from_path(item.path)
    return None


def get_first_lesson_before_lesson(course_slug: str) -> str | None:
    """Find first lesson that's followed by another lesson."""
    course = load_course(course_slug)
    for i, item in enumerate(course.progression[:-1]):
        if isinstance(item, LessonRef) and isinstance(
            course.progression[i + 1], LessonRef
        ):
            return _extract_slug_from_path(item.path)
    return None


def get_last_lesson(course_slug: str) -> str | None:
    """Find the last lesson in the course."""
    course = load_course(course_slug)
    for item in reversed(course.progression):
        if isinstance(item, LessonRef):
            return _extract_slug_from_path(item.path)
    return None


# --- API Tests ---


def test_get_next_lesson_returns_unit_complete():
    """Should return completedUnit when next item is a meeting."""
    lesson_slug = get_first_lesson_before_meeting("default")
    if lesson_slug is None:
        pytest.skip("No lesson→meeting pattern in default course")

    response = client.get(f"/api/courses/default/next-lesson?current={lesson_slug}")
    assert response.status_code == 200
    data = response.json()
    assert "completedUnit" in data
    assert isinstance(data["completedUnit"], int)


def test_get_next_lesson_returns_lesson():
    """Should return next lesson info when no meeting in between."""
    lesson_slug = get_first_lesson_before_lesson("default")
    if lesson_slug is None:
        pytest.skip("No lesson→lesson pattern in default course")

    response = client.get(f"/api/courses/default/next-lesson?current={lesson_slug}")
    assert response.status_code == 200
    data = response.json()
    assert "nextLessonSlug" in data
    assert "nextLessonTitle" in data
    assert isinstance(data["nextLessonSlug"], str)
    assert isinstance(data["nextLessonTitle"], str)


def test_get_next_lesson_end_of_course():
    """Should return 204 No Content for the last lesson in course."""
    last_lesson = get_last_lesson("default")
    if last_lesson is None:
        pytest.skip("No lessons found in default course")

    response = client.get(f"/api/courses/default/next-lesson?current={last_lesson}")
    # End of course returns 204 No Content
    assert response.status_code == 204


def test_get_next_lesson_invalid_course():
    """Should return 404 for invalid course."""
    response = client.get("/api/courses/nonexistent/next-lesson?current=any-lesson")
    assert response.status_code == 404


def test_get_next_lesson_invalid_lesson():
    """Should return 204 No Content for lesson not in course (same as end of course)."""
    response = client.get("/api/courses/default/next-lesson?current=nonexistent-lesson")
    # API returns 204 No Content when lesson not found in course
    # (same behavior as reaching end of course)
    assert response.status_code == 204


def test_get_course_progress_returns_units():
    """Should return course progress with units."""
    response = client.get("/api/courses/default/progress")
    assert response.status_code == 200
    data = response.json()

    # Should have course info
    assert "course" in data
    assert "slug" in data["course"]
    assert "title" in data["course"]
    assert data["course"]["slug"] == "default"
    assert isinstance(data["course"]["title"], str)
    assert len(data["course"]["title"]) > 0

    # Should have units, not modules
    assert "units" in data
    assert "modules" not in data

    # Should have at least one unit
    assert len(data["units"]) >= 1

    # First unit should have expected structure
    unit = data["units"][0]
    assert "meetingNumber" in unit
    assert isinstance(unit["meetingNumber"], int)
    assert "lessons" in unit
    assert len(unit["lessons"]) >= 1

    # Each lesson should have required fields
    lesson = unit["lessons"][0]
    assert "slug" in lesson
    assert "title" in lesson
    assert "optional" in lesson
    assert isinstance(lesson["slug"], str)
    assert isinstance(lesson["title"], str)
    assert isinstance(lesson["optional"], bool)


def test_get_course_progress_invalid_course():
    """Should return 404 for invalid course."""
    response = client.get("/api/courses/nonexistent/progress")
    assert response.status_code == 404
