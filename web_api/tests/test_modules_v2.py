# web_api/tests/test_modules_v2.py
"""Tests for v2 module API responses with flattened sections."""

import pytest
from datetime import datetime
from uuid import UUID

from fastapi.testclient import TestClient

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import FlattenedModule


@pytest.fixture
def mock_flattened_cache():
    """Set up a mock cache with flattened module data."""
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
                        "meta": {"title": "Welcome"},
                        "segments": [{"type": "text", "content": "Hello"}],
                    },
                    {
                        "type": "video",
                        "contentId": "00000000-0000-0000-0000-000000000003",
                        "learningOutcomeId": "00000000-0000-0000-0000-000000000010",
                        "videoId": "abc123",
                        "meta": {"title": "AI Safety Intro", "channel": "Kurzgesagt"},
                        "segments": [],
                        "optional": False,
                    },
                    {
                        "type": "article",
                        "contentId": "00000000-0000-0000-0000-000000000004",
                        "learningOutcomeId": None,  # Uncategorized
                        "meta": {
                            "title": "Background Reading",
                            "author": "Jane Doe",
                            "sourceUrl": "https://example.com/article",
                        },
                        "segments": [{"type": "text", "content": "Read this."}],
                        "optional": True,
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
    set_cache(cache)
    yield cache
    clear_cache()


def test_get_module_returns_flattened_sections(mock_flattened_cache):
    """GET /api/modules/{slug} should return flattened sections."""
    from main import app

    client = TestClient(app)

    response = client.get("/api/modules/intro")
    assert response.status_code == 200

    data = response.json()
    assert data["slug"] == "intro"
    assert data["title"] == "Introduction"
    assert len(data["sections"]) == 3

    # First section is a page
    page_section = data["sections"][0]
    assert page_section["type"] == "lens"
    assert page_section["contentId"] == "00000000-0000-0000-0000-000000000002"
    assert page_section["meta"]["title"] == "Welcome"
    assert page_section["segments"] == [{"type": "text", "content": "Hello"}]

    # Second section is a video with learningOutcomeId
    video_section = data["sections"][1]
    assert video_section["type"] == "video"
    assert video_section["contentId"] == "00000000-0000-0000-0000-000000000003"
    assert video_section["learningOutcomeId"] == "00000000-0000-0000-0000-000000000010"
    assert video_section["videoId"] == "abc123"
    assert video_section["meta"]["title"] == "AI Safety Intro"
    assert video_section["meta"]["channel"] == "Kurzgesagt"
    assert video_section["optional"] is False

    # Third section is an article with learningOutcomeId=null (uncategorized)
    article_section = data["sections"][2]
    assert article_section["type"] == "article"
    assert article_section["contentId"] == "00000000-0000-0000-0000-000000000004"
    assert article_section["learningOutcomeId"] is None
    assert article_section["meta"]["title"] == "Background Reading"
    assert article_section["meta"]["author"] == "Jane Doe"
    assert article_section["meta"]["sourceUrl"] == "https://example.com/article"
    assert article_section["optional"] is True


def test_get_module_not_found(mock_flattened_cache):
    """GET /api/modules/{slug} should return 404 for unknown module."""
    from main import app

    client = TestClient(app)

    response = client.get("/api/modules/nonexistent")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_list_modules_returns_all_modules(mock_flattened_cache):
    """GET /api/modules should list all available modules."""
    from main import app

    client = TestClient(app)

    response = client.get("/api/modules")
    assert response.status_code == 200

    data = response.json()
    assert "modules" in data
    assert len(data["modules"]) == 1
    assert data["modules"][0]["slug"] == "intro"
    assert data["modules"][0]["title"] == "Introduction"
