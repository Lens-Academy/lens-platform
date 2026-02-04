# core/content/tests/test_course_progression.py
"""Tests for course progression conversion from TypeScript output."""

from core.modules.flattened_types import ModuleRef, MeetingMarker


class TestCourseProgressionConversion:
    """Test that TypeScript output is properly converted to Python dataclasses."""

    def test_progression_items_are_dataclass_instances(self):
        """Course progression should contain ModuleRef and MeetingMarker instances, not dicts.

        The TypeScript processor outputs:
            {"type": "module", "slug": "intro", "optional": false}
            {"type": "meeting", "number": 1}

        These must be converted to ModuleRef and MeetingMarker dataclass instances
        so that isinstance() checks work in the course progress endpoint.
        """
        # Simulate TypeScript processor output format
        ts_course_output = {
            "slug": "default",
            "title": "AI Safety Course",
            "progression": [
                {"type": "module", "slug": "introduction", "optional": False},
                {"type": "meeting", "number": 1},
                {"type": "module", "slug": "feedback-loops", "optional": False},
                {"type": "module", "slug": "coming-soon", "optional": True},
                {"type": "meeting", "number": 2},
            ],
        }

        # This is how github_fetcher.py currently creates the ParsedCourse
        # (This is the code under test - we're testing the conversion)
        from core.content.github_fetcher import _convert_ts_course_to_parsed_course

        course = _convert_ts_course_to_parsed_course(ts_course_output)

        # Verify progression items are proper dataclass instances
        assert len(course.progression) == 5

        # First item should be a ModuleRef
        assert isinstance(course.progression[0], ModuleRef), (
            f"Expected ModuleRef, got {type(course.progression[0])}"
        )
        assert course.progression[0].path == "modules/introduction"
        assert course.progression[0].optional is False

        # Second item should be a MeetingMarker
        assert isinstance(course.progression[1], MeetingMarker), (
            f"Expected MeetingMarker, got {type(course.progression[1])}"
        )
        assert course.progression[1].number == 1

        # Third item - another ModuleRef
        assert isinstance(course.progression[2], ModuleRef)
        assert course.progression[2].path == "modules/feedback-loops"

        # Fourth item - optional module
        assert isinstance(course.progression[3], ModuleRef)
        assert course.progression[3].optional is True

        # Fifth item - another meeting
        assert isinstance(course.progression[4], MeetingMarker)
        assert course.progression[4].number == 2
