# web_api/routes/courses.py
"""Course API routes."""

from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response

from core.database import get_connection
from core.modules.course_loader import (
    load_course,
    get_next_module,
    CourseNotFoundError,
    _extract_slug_from_path,
)
from core.modules.markdown_parser import ModuleRef, MeetingMarker, ParsedModule
from core.modules import (
    load_narrative_module,
    ModuleNotFoundError,
)
from core.modules.markdown_parser import (
    VideoSection,
    ArticleSection,
    TextSection,
    ChatSection,
)
from core.modules.progress import get_module_progress
from web_api.auth import get_optional_user
from core import get_or_create_user

router = APIRouter(prefix="/api/courses", tags=["courses"])


def get_module_status_from_lenses(
    parsed_module: ParsedModule, progress_map: dict[UUID, dict]
) -> tuple[str, int, int]:
    """Calculate module status from lens completion progress.

    Args:
        parsed_module: The parsed module with sections containing content_ids
        progress_map: Map of content_id -> progress record (with completed_at)

    Returns:
        Tuple of (status, completed_count, total_count)
        status is one of: "not_started", "in_progress", "completed"
    """
    # Collect required lens IDs (non-optional sections with content_id)
    required_lens_ids = [
        section.content_id
        for section in parsed_module.sections
        if section.content_id and not getattr(section, "optional", False)
    ]

    if not required_lens_ids:
        return "not_started", 0, 0

    completed = sum(
        1
        for lid in required_lens_ids
        if lid in progress_map and progress_map[lid].get("completed_at")
    )
    total = len(required_lens_ids)

    if completed == 0:
        return "not_started", 0, total
    elif completed >= total:
        return "completed", completed, total
    else:
        return "in_progress", completed, total


@router.get("/{course_slug}/next-module")
async def get_next_module_endpoint(
    course_slug: str,
    current: str = Query(..., description="Current module slug"),
):
    """Get what comes after the current module.

    Returns:
        - 200 with {nextModuleSlug, nextModuleTitle} if next item is a module
        - 200 with {completedUnit: N} if next item is a meeting (unit boundary)
        - 204 No Content if end of course
    """
    try:
        result = get_next_module(course_slug, current)
    except CourseNotFoundError:
        raise HTTPException(status_code=404, detail=f"Course not found: {course_slug}")

    if result is None:
        return Response(status_code=204)

    if result["type"] == "unit_complete":
        return {"completedUnit": result["unit_number"]}

    # result["type"] == "module"
    return {
        "nextModuleSlug": result["slug"],
        "nextModuleTitle": result["title"],
    }


@router.get("/{course_slug}/progress")
async def get_course_progress(
    course_slug: str,
    request: Request,
    x_anonymous_token: str | None = Header(None),
):
    """Get course structure with user progress.

    Returns course modules, lessons, and stages with completion status.
    Supports both authenticated users (via session cookie) and anonymous users
    (via X-Anonymous-Token header).
    """
    # Get user_id if authenticated, or anonymous_token for anonymous users
    user_jwt = await get_optional_user(request)
    user_id = None
    anonymous_token = None

    if user_jwt:
        discord_id = user_jwt["sub"]
        user = await get_or_create_user(discord_id)
        user_id = user["user_id"]
    elif x_anonymous_token:
        try:
            anonymous_token = UUID(x_anonymous_token)
        except ValueError:
            pass  # Invalid token, continue without progress

    # Load course structure
    try:
        course = load_course(course_slug)
    except CourseNotFoundError:
        raise HTTPException(status_code=404, detail=f"Course not found: {course_slug}")

    # First pass: collect all lens UUIDs from parsed modules and load parsed modules
    all_lens_ids: list[UUID] = []
    parsed_modules: dict[str, ParsedModule] = {}

    for item in course.progression:
        if isinstance(item, ModuleRef):
            module_slug = _extract_slug_from_path(item.path)
            try:
                parsed = load_narrative_module(module_slug)
                parsed_modules[module_slug] = parsed

                # Collect lens UUIDs from sections
                for section in parsed.sections:
                    if section.content_id:
                        all_lens_ids.append(section.content_id)
            except ModuleNotFoundError:
                continue

    # Query progress for all lens UUIDs (if user_id or anonymous_token is available)
    progress_map: dict[UUID, dict] = {}
    if all_lens_ids and (user_id is not None or anonymous_token is not None):
        async with get_connection() as conn:
            progress_map = await get_module_progress(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                lens_ids=all_lens_ids,
            )

    # Build units by splitting progression on MeetingMarker objects
    units = []
    current_modules = []
    current_meeting_number = None

    for item in course.progression:
        if isinstance(item, MeetingMarker):
            # When we hit a meeting, save the current unit if it has modules
            if current_modules:
                units.append(
                    {
                        "meetingNumber": item.number,
                        "modules": current_modules,
                    }
                )
                current_modules = []
            current_meeting_number = item.number
        elif isinstance(item, ModuleRef):
            # Extract module slug from path (e.g., "modules/introduction" -> "introduction")
            module_slug = _extract_slug_from_path(item.path)

            # Load module details (use parsed module if available)
            parsed = parsed_modules.get(module_slug)
            if not parsed:
                try:
                    parsed = load_narrative_module(module_slug)
                except ModuleNotFoundError:
                    continue

            # Calculate module status from lens completions
            status, completed_count, total_count = get_module_status_from_lenses(
                parsed, progress_map
            )

            # Build sections info (named "stages" for API compatibility)
            stages = []
            for section in parsed.sections:
                # Get section title based on type
                if isinstance(section, (VideoSection, ArticleSection)):
                    title = (
                        section.source.split("/")[-1]
                        .replace(".md", "")
                        .replace("-", " ")
                        .title()
                    )
                elif isinstance(section, TextSection):
                    title = "Text"
                elif isinstance(section, ChatSection):
                    title = "Discussion"
                else:
                    title = section.type.title()

                # Check if this specific lens is completed
                lens_completed = (
                    section.content_id in progress_map
                    and progress_map[section.content_id].get("completed_at")
                    if section.content_id
                    else False
                )

                stages.append(
                    {
                        "type": section.type,
                        "title": title,
                        "duration": None,  # Duration calculation not available for new format
                        "optional": getattr(section, "optional", False),
                        "contentId": str(section.content_id)
                        if section.content_id
                        else None,
                        "completed": lens_completed,
                    }
                )

            current_modules.append(
                {
                    "slug": parsed.slug,
                    "title": parsed.title,
                    "optional": item.optional,
                    "stages": stages,
                    "status": status,
                    "completedLenses": completed_count,
                    "totalLenses": total_count,
                }
            )

    # Handle any remaining modules after the last meeting (or if no meetings)
    if current_modules:
        # If there were no meetings at all, use meeting number 1 as default
        meeting_num = (current_meeting_number + 1) if current_meeting_number else 1
        units.append(
            {
                "meetingNumber": meeting_num,
                "modules": current_modules,
            }
        )

    return {
        "course": {
            "slug": course.slug,
            "title": course.title,
        },
        "units": units,
    }
