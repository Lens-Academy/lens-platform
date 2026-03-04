# web_api/tests/test_courses_api.py
"""Tests for course API endpoints.

These tests dynamically discover course structure rather than hardcoding
specific module names. This makes tests resilient to content changes.
"""

import sys
from pathlib import Path

# Ensure we import from root main.py, not web_api/main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

import pytest
from fastapi.testclient import TestClient
from main import app
from core.modules.course_loader import load_course
from core.modules.flattened_types import ModuleRef, MeetingMarker

client = TestClient(app)


# --- Helper functions for dynamic course discovery ---


def get_first_module_before_meeting(course_slug: str) -> str | None:
    """Find first module that's followed by a meeting."""
    course = load_course(course_slug)
    for i, item in enumerate(course.progression[:-1]):
        if isinstance(item, ModuleRef) and isinstance(
            course.progression[i + 1], MeetingMarker
        ):
            return item.slug
    return None


def get_first_module_before_module(course_slug: str) -> str | None:
    """Find first module that's followed by another module."""
    course = load_course(course_slug)
    for i, item in enumerate(course.progression[:-1]):
        if isinstance(item, ModuleRef) and isinstance(
            course.progression[i + 1], ModuleRef
        ):
            return item.slug
    return None


def get_last_module(course_slug: str) -> str | None:
    """Find the last module in the course."""
    course = load_course(course_slug)
    for item in reversed(course.progression):
        if isinstance(item, ModuleRef):
            return item.slug
    return None


# --- API Tests ---


def test_get_next_module_returns_unit_complete():
    """Should return completedUnit when next item is a meeting."""
    module_slug = get_first_module_before_meeting("default")
    if module_slug is None:
        pytest.skip("No module→meeting pattern in default course")

    response = client.get(f"/api/courses/default/next-module?current={module_slug}")
    assert response.status_code == 200
    data = response.json()
    assert "completedUnit" in data
    assert isinstance(data["completedUnit"], int)


def test_get_next_module_returns_module():
    """Should return next module info when no meeting in between."""
    module_slug = get_first_module_before_module("default")
    if module_slug is None:
        pytest.skip("No module→module pattern in default course")

    response = client.get(f"/api/courses/default/next-module?current={module_slug}")
    assert response.status_code == 200
    data = response.json()
    assert "nextModuleSlug" in data
    assert "nextModuleTitle" in data
    assert isinstance(data["nextModuleSlug"], str)
    assert isinstance(data["nextModuleTitle"], str)


def test_get_next_module_end_of_course():
    """Should return 204 No Content for the last module in course."""
    last_module = get_last_module("default")
    if last_module is None:
        pytest.skip("No modules found in default course")

    response = client.get(f"/api/courses/default/next-module?current={last_module}")
    # End of course returns 204 No Content
    assert response.status_code == 204


def test_get_next_module_invalid_course():
    """Should return 404 for invalid course when multiple courses exist.

    Note: When only one course exists, the API returns that course for any slug
    (graceful fallback). This test sets up multiple courses to test 404 behavior.
    """
    from datetime import datetime
    from core.content.cache import ContentCache, set_cache, get_cache
    from core.modules.flattened_types import ParsedCourse

    # Save current cache
    original_cache = get_cache()

    # Set up cache with multiple courses
    cache = ContentCache(
        courses={
            "course-one": ParsedCourse(
                slug="course-one", title="Course One", progression=[]
            ),
            "course-two": ParsedCourse(
                slug="course-two", title="Course Two", progression=[]
            ),
        },
        flattened_modules=original_cache.flattened_modules,
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        video_timestamps={},
        last_refreshed=datetime.now(),
        last_commit_sha="test",
        raw_files={},
    )
    set_cache(cache)

    try:
        response = client.get("/api/courses/nonexistent/next-module?current=any-module")
        assert response.status_code == 404
    finally:
        # Restore original cache
        set_cache(original_cache)


def test_get_next_module_invalid_module():
    """Should return 204 No Content for module not in course (same as end of course)."""
    response = client.get("/api/courses/default/next-module?current=nonexistent-module")
    # API returns 204 No Content when module not found in course
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

    # Should have units (each containing modules)
    assert "units" in data

    # Should have at least one unit
    assert len(data["units"]) >= 1

    # First unit should have expected structure
    unit = data["units"][0]
    assert "meetingNumber" in unit
    assert isinstance(unit["meetingNumber"], int)
    assert "modules" in unit
    assert len(unit["modules"]) >= 1

    # Each module should have required fields
    module = unit["modules"][0]
    assert "slug" in module
    assert "title" in module
    assert "optional" in module
    assert isinstance(module["slug"], str)
    assert isinstance(module["title"], str)
    assert isinstance(module["optional"], bool)


def test_get_course_progress_includes_meeting_dates():
    """Should include meetingDate in units when user has meeting dates."""
    from unittest.mock import AsyncMock, patch

    mock_meeting_dates = {1: "2026-03-06T15:00:00+00:00"}

    with (
        patch(
            "web_api.routes.courses.get_optional_user",
            new_callable=AsyncMock,
            return_value={"sub": "test_discord_id"},
        ),
        patch(
            "web_api.routes.courses.get_or_create_user",
            new_callable=AsyncMock,
            return_value={"user_id": 42},
        ),
        patch(
            "web_api.routes.courses.get_meeting_dates_for_user",
            new_callable=AsyncMock,
            return_value=mock_meeting_dates,
        ),
    ):
        response = client.get("/api/courses/default/progress")

    assert response.status_code == 200
    data = response.json()
    units = data["units"]

    # Unit 1 (meetingNumber=1) should have meetingDate set
    unit1 = next((u for u in units if u["meetingNumber"] == 1), None)
    assert unit1 is not None
    assert unit1["meetingDate"] == "2026-03-06T15:00:00+00:00"

    # Unit 2 (meetingNumber=2) should have meetingDate null
    unit2 = next((u for u in units if u["meetingNumber"] == 2), None)
    if unit2:
        assert unit2["meetingDate"] is None


def test_get_course_progress_invalid_course():
    """Should return 404 for invalid course when multiple courses exist.

    Note: When only one course exists, the API returns that course for any slug
    (graceful fallback). This test sets up multiple courses to test 404 behavior.
    """
    from datetime import datetime
    from core.content.cache import ContentCache, set_cache, get_cache
    from core.modules.flattened_types import ParsedCourse

    # Save current cache
    original_cache = get_cache()

    # Set up cache with multiple courses
    cache = ContentCache(
        courses={
            "course-one": ParsedCourse(
                slug="course-one", title="Course One", progression=[]
            ),
            "course-two": ParsedCourse(
                slug="course-two", title="Course Two", progression=[]
            ),
        },
        flattened_modules={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        video_timestamps={},
        last_refreshed=datetime.now(),
        last_commit_sha="test",
        raw_files={},
    )
    set_cache(cache)

    try:
        response = client.get("/api/courses/nonexistent/progress")
        assert response.status_code == 404
    finally:
        # Restore original cache
        set_cache(original_cache)
