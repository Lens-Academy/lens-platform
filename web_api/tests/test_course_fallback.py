# web_api/tests/test_course_fallback.py
"""Tests for course fallback behavior when only one course exists."""

import pytest
from datetime import datetime

from fastapi.testclient import TestClient

from core.content.cache import ContentCache, set_cache, clear_cache
from core.modules.flattened_types import (
    ParsedCourse,
    FlattenedModule,
    ModuleRef,
    MeetingMarker,
)


@pytest.fixture
def app():
    """Create FastAPI app for testing."""
    from main import app

    return app


@pytest.fixture
def client(app):
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def single_course_cache():
    """Set up cache with a single course named 'actual-course'."""
    course = ParsedCourse(
        slug="actual-course",
        title="The Actual Course",
        progression=[
            ModuleRef(path="modules/intro", optional=False),
            MeetingMarker(number=1),
        ],
    )

    module = FlattenedModule(
        slug="intro",
        title="Introduction",
        content_id=None,
        sections=[],
    )

    cache = ContentCache(
        courses={"actual-course": course},
        flattened_modules={"intro": module},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        video_timestamps={},
        last_refreshed=datetime.now(),
        last_commit_sha="abc123",
        raw_files={},
    )
    set_cache(cache)
    yield cache
    clear_cache()


class TestCourseFallback:
    """Test that single-course systems gracefully handle any slug."""

    def test_returns_only_course_when_slug_not_found(self, client, single_course_cache):
        """When only one course exists, return it regardless of requested slug.

        This prevents frontend breakage if the course slug changes.
        The frontend hardcodes 'default' but should still work if the
        actual course has a different slug.
        """
        # Request a course slug that doesn't exist
        response = client.get("/api/courses/nonexistent-slug/progress")

        # Should NOT return 404
        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )

        data = response.json()

        # Should return the only course we have
        assert data["course"]["slug"] == "actual-course"
        assert data["course"]["title"] == "The Actual Course"
        assert len(data["units"]) > 0

    def test_returns_exact_course_when_slug_matches(self, client, single_course_cache):
        """When requested slug exists, return that exact course."""
        response = client.get("/api/courses/actual-course/progress")

        assert response.status_code == 200
        data = response.json()
        assert data["course"]["slug"] == "actual-course"

    def test_returns_404_when_multiple_courses_and_slug_not_found(self, client):
        """When multiple courses exist, 404 for unknown slugs (no ambiguity)."""
        course1 = ParsedCourse(
            slug="course-one",
            title="Course One",
            progression=[],
        )
        course2 = ParsedCourse(
            slug="course-two",
            title="Course Two",
            progression=[],
        )

        cache = ContentCache(
            courses={"course-one": course1, "course-two": course2},
            flattened_modules={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            articles={},
            video_transcripts={},
            video_timestamps={},
            last_refreshed=datetime.now(),
            last_commit_sha="abc123",
            raw_files={},
        )
        set_cache(cache)

        try:
            response = client.get("/api/courses/nonexistent/progress")
            assert response.status_code == 404
        finally:
            clear_cache()
