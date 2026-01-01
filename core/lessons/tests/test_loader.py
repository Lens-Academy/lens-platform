# core/lessons/tests/test_loader.py
"""Tests for lesson loader."""

import pytest
from core.lessons.loader import load_lesson, get_available_lessons, LessonNotFoundError


def test_load_existing_lesson():
    """Should load a lesson from JSON file."""
    lesson = load_lesson("intro-to-ai-safety")
    assert lesson.id == "intro-to-ai-safety"
    assert lesson.title == "Introduction to AI Safety"
    assert len(lesson.stages) > 0


def test_load_nonexistent_lesson():
    """Should raise LessonNotFoundError for unknown lesson."""
    with pytest.raises(LessonNotFoundError):
        load_lesson("nonexistent-lesson")


def test_get_available_lessons():
    """Should return list of available lesson IDs."""
    lessons = get_available_lessons()
    assert isinstance(lessons, list)
    assert "intro-to-ai-safety" in lessons
