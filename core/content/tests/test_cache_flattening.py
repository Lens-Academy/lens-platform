# core/content/tests/test_cache_flattening.py
"""Tests for cache structure with flattened modules."""

from datetime import datetime
from uuid import UUID

from core.content.cache import ContentCache
from core.modules.flattened_types import FlattenedModule


def test_cache_stores_flattened_modules():
    """Cache should store FlattenedModule objects, not ParsedModule."""
    cache = ContentCache(
        courses={},
        flattened_modules={
            "intro": FlattenedModule(
                slug="intro",
                title="Introduction",
                content_id=UUID("00000000-0000-0000-0000-000000000001"),
                sections=[
                    {
                        "type": "lens",
                        "contentId": "00000000-0000-0000-0000-000000000002",
                        "title": "Welcome",
                        "segments": [],
                    },
                ],
            ),
        },
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )

    assert "intro" in cache.flattened_modules
    assert cache.flattened_modules["intro"].sections[0]["type"] == "lens"
