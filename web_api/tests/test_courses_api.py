# web_api/tests/test_courses_api.py
"""Tests for course API endpoints."""

import sys
from pathlib import Path

# Ensure we import from root main.py, not web_api/main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_get_next_lesson():
    """Should return next lesson info."""
    response = client.get("/api/courses/default/next-lesson?current=intro-to-ai-safety")
    assert response.status_code == 200
    data = response.json()
    assert data["nextLessonSlug"] == "intelligence-feedback-loop"
    assert data["nextLessonTitle"] == "Intelligence Feedback Loop"


def test_get_next_lesson_end_of_course():
    """Should return 204 No Content at end of course."""
    response = client.get("/api/courses/default/next-lesson?current=intelligence-feedback-loop")
    assert response.status_code == 204


def test_get_next_lesson_invalid_course():
    """Should return 404 for invalid course."""
    response = client.get("/api/courses/nonexistent/next-lesson?current=intro-to-ai-safety")
    assert response.status_code == 404


def test_get_course_progress_returns_units():
    """Should return course progress with units instead of modules."""
    response = client.get("/api/courses/default/progress")
    assert response.status_code == 200
    data = response.json()

    # Should have course info
    assert "course" in data
    assert data["course"]["slug"] == "default"
    assert data["course"]["title"] == "AI Safety Fundamentals"

    # Should have units, not modules
    assert "units" in data
    assert "modules" not in data

    # Should have at least one unit
    assert len(data["units"]) >= 1

    # First unit should have meetingNumber and lessons
    unit = data["units"][0]
    assert "meetingNumber" in unit
    assert unit["meetingNumber"] == 1
    assert "lessons" in unit
    assert len(unit["lessons"]) >= 1

    # Each lesson should have optional field
    lesson = unit["lessons"][0]
    assert "slug" in lesson
    assert "title" in lesson
    assert "optional" in lesson
    assert isinstance(lesson["optional"], bool)
