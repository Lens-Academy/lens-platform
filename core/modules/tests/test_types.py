# core/modules/tests/test_types.py
"""Tests for module types."""

from core.modules.types import ModuleRef, Meeting, Course


def test_module_ref_defaults():
    """ModuleRef should default optional to False."""
    ref = ModuleRef(slug="test-module")
    assert ref.slug == "test-module"
    assert ref.optional is False


def test_module_ref_optional():
    """ModuleRef should accept optional flag."""
    ref = ModuleRef(slug="test-module", optional=True)
    assert ref.optional is True


def test_meeting_name():
    """Meeting should store its name."""
    meeting = Meeting(name="Introduction")
    assert meeting.name == "Introduction"


def test_course_with_progression():
    """Course should have progression list."""
    course = Course(
        slug="test",
        title="Test Course",
        progression=[
            ModuleRef(slug="module-1"),
            ModuleRef(slug="module-2", optional=True),
            Meeting(name="Week 1"),
        ],
    )
    assert len(course.progression) == 3
