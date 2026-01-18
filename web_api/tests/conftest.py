# web_api/tests/conftest.py
"""Pytest fixtures for web API tests.

Sets up a test cache with realistic course/lesson data so that API tests
can run without requiring actual content files or GitHub access.
"""

import pytest
from datetime import datetime

from core.content import ContentCache, set_cache, clear_cache
from core.lessons.markdown_parser import (
    ParsedCourse,
    ParsedLesson,
    LessonRef,
    MeetingMarker,
    ChatSection,
    VideoSection,
    ArticleSection,
)


@pytest.fixture(autouse=True)
def api_test_cache():
    """Set up a test cache with a 'default' course for API tests.

    This fixture runs automatically for all tests in web_api/tests/.
    It provides a realistic course structure with multiple lessons,
    meetings, and both required and optional lessons.
    """
    # Create test lessons with varied section types
    lessons = {
        "introduction": ParsedLesson(
            slug="introduction",
            title="Introduction to AI Safety",
            sections=[
                VideoSection(
                    source="video_transcripts/intro-video.md",
                    segments=[],
                ),
                ChatSection(
                    instructions="Discuss what you learned from the introduction video.",
                ),
            ],
        ),
        "core-concepts": ParsedLesson(
            slug="core-concepts",
            title="Core Concepts in AI Alignment",
            sections=[
                ArticleSection(
                    source="articles/core-concepts.md",
                    segments=[],
                ),
                ChatSection(
                    instructions="Explain the core concepts in your own words.",
                ),
            ],
        ),
        "advanced-topics": ParsedLesson(
            slug="advanced-topics",
            title="Advanced Topics",
            sections=[
                ChatSection(
                    instructions="Deep dive into advanced alignment topics.",
                ),
            ],
        ),
        "supplementary-reading": ParsedLesson(
            slug="supplementary-reading",
            title="Supplementary Reading",
            sections=[
                ArticleSection(
                    source="articles/supplementary.md",
                    segments=[],
                    optional=True,
                ),
            ],
        ),
        "final-discussion": ParsedLesson(
            slug="final-discussion",
            title="Final Discussion",
            sections=[
                ChatSection(
                    instructions="Synthesize everything you've learned.",
                ),
            ],
        ),
    }

    # Create test course with structure that exercises various test cases:
    # - lesson -> lesson (introduction -> core-concepts)
    # - lesson -> meeting (core-concepts -> Meeting 1)
    # - optional lesson (supplementary-reading)
    # - end of course (final-discussion)
    courses = {
        "default": ParsedCourse(
            slug="default",
            title="AI Safety Fundamentals",
            progression=[
                LessonRef(path="lessons/introduction"),
                LessonRef(path="lessons/core-concepts"),
                MeetingMarker(number=1),
                LessonRef(path="lessons/advanced-topics"),
                LessonRef(path="lessons/supplementary-reading", optional=True),
                MeetingMarker(number=2),
                LessonRef(path="lessons/final-discussion"),
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
