# core/lessons/tests/test_loader.py
"""Tests for lesson loader.

These tests verify that the loader retrieves lessons from the cache.
"""

import pytest
from datetime import datetime

from core.content import ContentCache, set_cache, clear_cache
from core.lessons.loader import (
    load_narrative_lesson,
    LessonNotFoundError,
    get_available_lessons,
)
from core.lessons.markdown_parser import ParsedLesson, ChatSection


class TestLoadNarrativeLessonFromCache:
    """Test loading narrative lessons from cache."""

    def setup_method(self):
        """Set up test cache."""
        # Create a minimal parsed lesson
        test_lesson = ParsedLesson(
            slug="test-lesson",
            title="Test Lesson",
            sections=[
                ChatSection(
                    instructions="Test instructions",
                    show_user_previous_content=True,
                    show_tutor_previous_content=True,
                )
            ],
        )

        another_lesson = ParsedLesson(
            slug="another-lesson",
            title="Another Lesson",
            sections=[],
        )

        cache = ContentCache(
            courses={},
            lessons={
                "test-lesson": test_lesson,
                "another-lesson": another_lesson,
            },
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

    def teardown_method(self):
        """Clear cache after test."""
        clear_cache()

    def test_load_lesson_from_cache(self):
        """Should load lesson from cache."""
        lesson = load_narrative_lesson("test-lesson")
        assert lesson.slug == "test-lesson"
        assert lesson.title == "Test Lesson"
        assert len(lesson.sections) == 1
        assert lesson.sections[0].type == "chat"

    def test_load_lesson_not_found(self):
        """Should raise error for missing lesson."""
        with pytest.raises(LessonNotFoundError):
            load_narrative_lesson("nonexistent")

    def test_get_available_lessons(self):
        """Should return list of lesson slugs from cache."""
        lessons = get_available_lessons()
        assert isinstance(lessons, list)
        assert "test-lesson" in lessons
        assert "another-lesson" in lessons
        assert len(lessons) == 2
