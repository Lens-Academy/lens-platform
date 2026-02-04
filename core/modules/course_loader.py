# core/modules/course_loader.py
"""Load course definitions from cache."""

from core.content import get_cache
from core.modules.flattened_types import ParsedCourse, ModuleRef, MeetingMarker
from .loader import load_narrative_module, ModuleNotFoundError


class CourseNotFoundError(Exception):
    """Raised when a course cannot be found."""

    pass


def load_course(course_slug: str) -> ParsedCourse:
    """Load a course by slug from the cache.

    If the requested course doesn't exist but there's only one course
    in the cache, returns that course as a graceful fallback. This prevents
    frontend breakage if the course slug changes (e.g., frontend hardcodes
    'default' but actual course has a different slug).

    Raises CourseNotFoundError if course not found AND multiple courses exist.
    """
    cache = get_cache()

    # Exact match - return it
    if course_slug in cache.courses:
        return cache.courses[course_slug]

    # Fallback: if only one course exists, return it regardless of slug
    if len(cache.courses) == 1:
        only_course = next(iter(cache.courses.values()))
        return only_course

    # Multiple courses but slug not found - that's a real 404
    raise CourseNotFoundError(f"Course not found: {course_slug}")


def _extract_slug_from_path(path: str) -> str:
    """Extract module slug from path like 'modules/introduction' -> 'introduction'."""
    return path.split("/")[-1]


def get_all_module_slugs(course_slug: str) -> list[str]:
    """Get flat list of all module slugs in course order."""
    course = load_course(course_slug)
    return [
        _extract_slug_from_path(item.path)
        for item in course.progression
        if isinstance(item, ModuleRef)
    ]


def get_next_module(course_slug: str, current_module_slug: str) -> dict | None:
    """Get what comes after the current module in the progression.

    Returns:
        - {"type": "module", "slug": str, "title": str} if next item is a module
        - {"type": "unit_complete", "unit_number": int} if next item is a meeting
        - None if end of course or module not found
    """
    course = load_course(course_slug)

    # Find the current module's index in progression
    current_index = None
    for i, item in enumerate(course.progression):
        if isinstance(item, ModuleRef):
            # Extract slug from path (e.g., "modules/introduction" -> "introduction")
            item_slug = _extract_slug_from_path(item.path)
            if item_slug == current_module_slug:
                current_index = i
                break

    if current_index is None:
        return None  # Module not in this course

    # Look at the next item in progression
    next_index = current_index + 1
    if next_index >= len(course.progression):
        return None  # End of course

    next_item = course.progression[next_index]

    if isinstance(next_item, MeetingMarker):
        return {"type": "unit_complete", "unit_number": next_item.number}

    if isinstance(next_item, ModuleRef):
        next_slug = _extract_slug_from_path(next_item.path)
        try:
            next_module = load_narrative_module(next_slug)
            return {
                "type": "module",
                "slug": next_slug,
                "title": next_module.title,
            }
        except ModuleNotFoundError:
            return None

    return None


def get_modules(course: ParsedCourse) -> list[ModuleRef]:
    """Get all module references from a course, excluding meetings.

    Args:
        course: The course to get modules from.

    Returns:
        List of ModuleRef objects in progression order.
    """
    return [item for item in course.progression if isinstance(item, ModuleRef)]


def get_required_modules(course: ParsedCourse) -> list[ModuleRef]:
    """Get only required (non-optional) module references from a course.

    Args:
        course: The course to get required modules from.

    Returns:
        List of non-optional ModuleRef objects in progression order.
    """
    return [
        item
        for item in course.progression
        if isinstance(item, ModuleRef) and not item.optional
    ]


def get_due_by_meeting(course: ParsedCourse, module_slug: str) -> int | None:
    """Get the meeting number by which a module should be completed.

    Modules are due by the next meeting that follows them in the progression.
    If there is no meeting after a module, returns None.

    Args:
        course: The course containing the module.
        module_slug: The slug of the module to check.

    Returns:
        Meeting number if there's a following meeting, None otherwise.
    """
    found_module = False

    for item in course.progression:
        if isinstance(item, ModuleRef):
            item_slug = _extract_slug_from_path(item.path)
            if item_slug == module_slug:
                found_module = True
        elif found_module and isinstance(item, MeetingMarker):
            return item.number

    return None
