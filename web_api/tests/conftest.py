# web_api/tests/conftest.py
"""Pytest fixtures for web API tests.

Sets up a test cache with realistic course/module data so that API tests
can run without requiring actual content files or GitHub access.
"""

import pytest
from datetime import datetime
from uuid import UUID

from core.content import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import (
    FlattenedModule,
    ParsedCourse,
    ModuleRef,
    MeetingMarker,
)


@pytest.fixture(autouse=True)
def api_test_cache():
    """Set up a test cache with a 'default' course for API tests.

    This fixture runs automatically for all tests in web_api/tests/.
    It provides a realistic course structure with multiple modules,
    meetings, and both required and optional modules.
    """
    # Create test modules using flattened types (sections are dicts)
    flattened_modules = {
        "introduction": FlattenedModule(
            slug="introduction",
            title="Introduction to AI Safety",
            content_id=UUID("00000000-0000-0000-0000-000000000101"),
            sections=[
                {
                    "type": "video",
                    "contentId": "00000000-0000-0000-0000-000000000102",
                    "learningOutcomeId": "00000000-0000-0000-0000-000000000150",
                    "videoId": "intro123",
                    "meta": {"title": "Intro Video", "channel": "AI Safety Channel"},
                    "segments": [],
                    "optional": False,
                },
                {
                    "type": "page",
                    "contentId": "00000000-0000-0000-0000-000000000103",
                    "title": "Discussion",
                    "segments": [
                        {
                            "type": "chat",
                            "instructions": "Discuss what you learned from the introduction video.",
                        }
                    ],
                },
            ],
        ),
        "core-concepts": FlattenedModule(
            slug="core-concepts",
            title="Core Concepts in AI Alignment",
            content_id=UUID("00000000-0000-0000-0000-000000000201"),
            sections=[
                {
                    "type": "article",
                    "contentId": "00000000-0000-0000-0000-000000000202",
                    "learningOutcomeId": "00000000-0000-0000-0000-000000000250",
                    "meta": {
                        "title": "Core Concepts Article",
                        "author": "AI Safety Researcher",
                        "sourceUrl": "https://example.com/core-concepts",
                    },
                    "segments": [],
                    "optional": False,
                },
                {
                    "type": "page",
                    "contentId": "00000000-0000-0000-0000-000000000203",
                    "title": "Discussion",
                    "segments": [
                        {
                            "type": "chat",
                            "instructions": "Explain the core concepts in your own words.",
                        }
                    ],
                },
            ],
        ),
        "advanced-topics": FlattenedModule(
            slug="advanced-topics",
            title="Advanced Topics",
            content_id=UUID("00000000-0000-0000-0000-000000000301"),
            sections=[
                {
                    "type": "page",
                    "contentId": "00000000-0000-0000-0000-000000000302",
                    "title": "Deep Dive",
                    "segments": [
                        {
                            "type": "chat",
                            "instructions": "Deep dive into advanced alignment topics.",
                        }
                    ],
                },
            ],
        ),
        "supplementary-reading": FlattenedModule(
            slug="supplementary-reading",
            title="Supplementary Reading",
            content_id=UUID("00000000-0000-0000-0000-000000000401"),
            sections=[
                {
                    "type": "article",
                    "contentId": "00000000-0000-0000-0000-000000000402",
                    "learningOutcomeId": None,  # Uncategorized
                    "meta": {
                        "title": "Supplementary Article",
                        "author": "Guest Author",
                        "sourceUrl": "https://example.com/supplementary",
                    },
                    "segments": [],
                    "optional": True,
                },
            ],
        ),
        "final-discussion": FlattenedModule(
            slug="final-discussion",
            title="Final Discussion",
            content_id=UUID("00000000-0000-0000-0000-000000000501"),
            sections=[
                {
                    "type": "page",
                    "contentId": "00000000-0000-0000-0000-000000000502",
                    "title": "Synthesis",
                    "segments": [
                        {
                            "type": "chat",
                            "instructions": "Synthesize everything you've learned.",
                        }
                    ],
                },
            ],
        ),
    }

    # Create test course with structure that exercises various test cases:
    # - module -> module (introduction -> core-concepts)
    # - module -> meeting (core-concepts -> Meeting 1)
    # - optional module (supplementary-reading)
    # - end of course (final-discussion)
    courses = {
        "default": ParsedCourse(
            slug="default",
            title="AI Safety Fundamentals",
            progression=[
                ModuleRef(path="modules/introduction"),
                ModuleRef(path="modules/core-concepts"),
                MeetingMarker(number=1),
                ModuleRef(path="modules/advanced-topics"),
                ModuleRef(path="modules/supplementary-reading", optional=True),
                MeetingMarker(number=2),
                ModuleRef(path="modules/final-discussion"),
            ],
        ),
    }

    cache = ContentCache(
        courses=courses,
        flattened_modules=flattened_modules,
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)

    yield cache

    clear_cache()
