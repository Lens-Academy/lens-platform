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
