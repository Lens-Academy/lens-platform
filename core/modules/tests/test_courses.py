# core/modules/tests/test_courses.py
"""Tests for course loader.

Tests use cache fixtures instead of file system patching.
Content validation tests are in test_content_validation.py.
"""

import pytest
from datetime import datetime
from uuid import UUID

from core.content import ContentCache, set_cache, clear_cache
from core.modules.course_loader import (
    load_course,
    get_next_module,
    get_all_module_slugs,
    get_modules,
    get_required_modules,
    get_due_by_meeting,
    CourseNotFoundError,
)
from core.modules.flattened_types import (
    FlattenedModule,
    ParsedCourse,
    ModuleRef,
    MeetingMarker,
)


@pytest.fixture
def test_cache():
    """Set up a test cache with courses and modules."""
    # Create test modules using flattened types
    flattened_modules = {
        "module-a": FlattenedModule(
            slug="module-a",
            title="Module A",
            content_id=UUID("00000000-0000-0000-0000-000000000001"),
            sections=[
                {
                    "type": "lens",
                    "contentId": "00000000-0000-0000-0000-000000000011",
                    "title": "Module A Page",
                    "segments": [
                        {"type": "chat", "instructions": "Module A instructions"}
                    ],
                },
            ],
        ),
        "module-b": FlattenedModule(
            slug="module-b",
            title="Module B",
            content_id=UUID("00000000-0000-0000-0000-000000000002"),
            sections=[
                {
                    "type": "lens",
                    "contentId": "00000000-0000-0000-0000-000000000021",
                    "title": "Module B Page",
                    "segments": [
                        {"type": "chat", "instructions": "Module B instructions"}
                    ],
                },
            ],
        ),
        "module-c": FlattenedModule(
            slug="module-c",
            title="Module C",
            content_id=UUID("00000000-0000-0000-0000-000000000003"),
            sections=[
                {
                    "type": "lens",
                    "contentId": "00000000-0000-0000-0000-000000000031",
                    "title": "Module C Page",
                    "segments": [
                        {"type": "chat", "instructions": "Module C instructions"}
                    ],
                },
            ],
        ),
        "module-d": FlattenedModule(
            slug="module-d",
            title="Module D",
            content_id=UUID("00000000-0000-0000-0000-000000000004"),
            sections=[
                {
                    "type": "lens",
                    "contentId": "00000000-0000-0000-0000-000000000041",
                    "title": "Module D Page",
                    "segments": [
                        {"type": "chat", "instructions": "Module D instructions"}
                    ],
                },
            ],
        ),
    }

    # Create test course (matches old test-course.yaml structure)
    courses = {
        "test-course": ParsedCourse(
            slug="test-course",
            title="Test Course",
            progression=[
                ModuleRef(slug="module-a"),
                ModuleRef(slug="module-b"),
                MeetingMarker(name="Week 1"),
                ModuleRef(slug="module-c", optional=True),
                MeetingMarker(name="Week 2"),
                ModuleRef(slug="module-d"),
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


@pytest.fixture
def empty_cache():
    """Set up an empty cache for testing not-found errors."""
    cache = ContentCache(
        courses={},
        flattened_modules={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
    )
    set_cache(cache)

    yield cache

    clear_cache()


def test_load_existing_course(test_cache):
    """Should load a course from cache."""
    course = load_course("test-course")
    assert course.slug == "test-course"
    assert course.title == "Test Course"
    assert len(course.progression) == 6  # 4 modules + 2 meetings


def test_load_nonexistent_course(empty_cache):
    """Should raise CourseNotFoundError for unknown course."""
    with pytest.raises(CourseNotFoundError):
        load_course("nonexistent-course")


def test_get_next_module_within_unit(test_cache):
    """Should return unit_complete when next item is a meeting."""
    # module-b is followed by meeting 1 in test-course
    result = get_next_module("test-course", "module-b")
    assert result is not None
    assert result["type"] == "unit_complete"
    assert result["unit_number"] == 1


def test_get_next_module_returns_module(test_cache):
    """Should return next module when there's no meeting in between."""
    # module-a is followed by module-b in test-course
    result = get_next_module("test-course", "module-a")
    assert result is not None
    assert result["type"] == "module"
    assert result["slug"] == "module-b"
    assert result["title"] == "Module B"


def test_get_next_module_end_of_course(test_cache):
    """Should return None at end of course."""
    # module-d is the last item in test-course
    result = get_next_module("test-course", "module-d")
    assert result is None


def test_get_next_module_unknown_module(test_cache):
    """Should return None for module not in course."""
    result = get_next_module("test-course", "nonexistent-module")
    assert result is None


def test_get_all_module_slugs(test_cache):
    """Should return flat list of all module slugs in order."""
    module_slugs = get_all_module_slugs("test-course")
    assert module_slugs == ["module-a", "module-b", "module-c", "module-d"]


# --- Tests for helper functions ---


def test_get_modules():
    """get_modules should return all ModuleRefs excluding MeetingMarkers."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            ModuleRef(slug="module-1"),
            ModuleRef(slug="module-2", optional=True),
            MeetingMarker(name="Week 1"),
            ModuleRef(slug="module-3"),
        ],
    )
    modules = get_modules(course)
    assert len(modules) == 3
    assert modules[0].slug == "module-1"
    assert modules[1].slug == "module-2"
    assert modules[2].slug == "module-3"


def test_get_required_modules():
    """get_required_modules should return only non-optional ModuleRefs."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            ModuleRef(slug="module-1"),
            ModuleRef(slug="module-2", optional=True),
            MeetingMarker(name="Week 1"),
            ModuleRef(slug="module-3"),
            ModuleRef(slug="module-4", optional=True),
        ],
    )
    required = get_required_modules(course)
    assert len(required) == 2
    assert required[0].slug == "module-1"
    assert required[1].slug == "module-3"


def test_get_due_by_meeting():
    """get_due_by_meeting should return the meeting number following a module."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            ModuleRef(slug="module-1"),
            ModuleRef(slug="module-2"),
            MeetingMarker(name="Week 1"),
            ModuleRef(slug="module-3"),
            MeetingMarker(name="Week 2"),
        ],
    )
    assert get_due_by_meeting(course, "module-1") == 1
    assert get_due_by_meeting(course, "module-2") == 1
    assert get_due_by_meeting(course, "module-3") == 2


def test_get_due_by_meeting_no_following_meeting():
    """Modules after the last meeting should return None for due_by_meeting."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            ModuleRef(slug="module-1"),
            MeetingMarker(name="Week 1"),
            ModuleRef(slug="module-2"),
        ],
    )
    assert get_due_by_meeting(course, "module-1") == 1
    assert get_due_by_meeting(course, "module-2") is None


def test_get_due_by_meeting_unknown_module():
    """Unknown module slugs should return None for due_by_meeting."""
    course = ParsedCourse(
        slug="test",
        title="Test Course",
        progression=[
            ModuleRef(slug="module-1"),
            MeetingMarker(name="Week 1"),
        ],
    )
    assert get_due_by_meeting(course, "nonexistent-module") is None


# --- Tests for course loader with progression format ---


def test_load_course_parses_progression_types(test_cache):
    """load_course should correctly parse ModuleRefs and MeetingMarkers from cache."""
    course = load_course("test-course")

    module_refs = [item for item in course.progression if isinstance(item, ModuleRef)]
    meetings = [item for item in course.progression if isinstance(item, MeetingMarker)]

    assert len(module_refs) == 4
    assert len(meetings) == 2

    # Check module refs
    assert module_refs[0].slug == "module-a"
    assert module_refs[2].optional is True  # module-c is optional

    # Check meetings
    assert meetings[0].name == "Week 1"
    assert meetings[1].name == "Week 2"


@pytest.fixture
def cache_with_aliases():
    """Set up a cache with a course that has slug aliases."""
    courses = {
        "navigating-asi": ParsedCourse(
            slug="navigating-asi",
            title="Navigating ASI",
            progression=[ModuleRef(slug="module-a")],
            slug_aliases=["default", "old-course-name"],
        ),
    }

    cache = ContentCache(
        courses=courses,
        flattened_modules={
            "module-a": FlattenedModule(
                slug="module-a",
                title="Module A",
                content_id=None,
                sections=[],
            ),
        },
        parsed_learning_outcomes={},
        parsed_lenses={},
        articles={},
        video_transcripts={},
        last_refreshed=datetime.now(),
        course_slug_aliases={
            "default": "navigating-asi",
            "old-course-name": "navigating-asi",
        },
    )
    set_cache(cache)
    yield cache
    clear_cache()


def test_load_course_by_alias(cache_with_aliases):
    """Should resolve alias to canonical course."""
    course = load_course("default")
    assert course.slug == "navigating-asi"
    assert course.title == "Navigating ASI"


def test_load_course_by_second_alias(cache_with_aliases):
    """Should resolve any alias to canonical course."""
    course = load_course("old-course-name")
    assert course.slug == "navigating-asi"


def test_load_course_canonical_still_works(cache_with_aliases):
    """Canonical slug should still work when aliases exist."""
    course = load_course("navigating-asi")
    assert course.slug == "navigating-asi"


def test_load_course_nonexistent_with_aliases(cache_with_aliases):
    """Non-existent slug that isn't an alias should use single-course fallback."""
    # Only one course exists, so fallback should return it
    course = load_course("totally-unknown")
    assert course.slug == "navigating-asi"
