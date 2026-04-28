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
)
from core.modules.flattened_types import ModuleRef, MeetingMarker
from core.modules import (
    load_narrative_module,
    ModuleNotFoundError,
)
from core.modules.flattened_types import FlattenedModule
from core.modules.progress import get_module_progress
from core.queries.meetings import get_meeting_dates_for_user
from web_api.auth import get_optional_user
from core import get_or_create_user

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.get("")
async def list_courses():
    """List all courses with their module progressions.

    Returns slug, title, and the ordered module slugs in each course's
    progression — enough for the Prompt Lab live-module picker to build
    cascading dropdowns (course → module → section → segment).
    """
    from core.content.cache import get_cache

    cache = get_cache()
    out = []
    for slug, course in cache.courses.items():
        modules = []
        for item in course.progression:
            if not isinstance(item, ModuleRef):
                continue
            mod = cache.flattened_modules.get(item.slug)
            modules.append(
                {"slug": item.slug, "title": mod.title if mod else item.slug}
            )
        out.append({"slug": slug, "title": course.title, "modules": modules})
    return {"courses": out}


def get_module_status_from_lenses(
    parsed_module: FlattenedModule, progress_map: dict[UUID, dict]
) -> tuple[str, int, int]:
    """Calculate module status from lens completion progress.

    Args:
        parsed_module: The parsed module with sections containing content_ids
        progress_map: Map of content_id -> progress record (with completed_at)

    Returns:
        Tuple of (status, completed_count, total_count)
        status is one of: "not_started", "in_progress", "completed"
    """
    # Collect required lens IDs (non-optional sections with contentId)
    # Sections are dicts with camelCase keys
    required_lens_ids = [
        UUID(section["contentId"])
        for section in parsed_module.sections
        if section.get("contentId") and not section.get("optional", False)
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
        user, _ = await get_or_create_user(discord_id)
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
    parsed_modules: dict[str, FlattenedModule] = {}

    for item in course.progression:
        if isinstance(item, ModuleRef):
            module_slug = item.slug
            try:
                parsed = load_narrative_module(module_slug)
                parsed_modules[module_slug] = parsed

                # Collect lens UUIDs from sections (sections are dicts)
                for section in parsed.sections:
                    content_id_str = section.get("contentId")
                    if content_id_str:
                        all_lens_ids.append(UUID(content_id_str))
            except ModuleNotFoundError:
                continue

    # Query progress and meeting dates
    progress_map: dict[UUID, dict] = {}
    meeting_dates: dict[int, str] = {}
    if user_id is not None or anonymous_token is not None:
        async with get_connection() as conn:
            if all_lens_ids:
                progress_map = await get_module_progress(
                    conn,
                    user_id=user_id,
                    anonymous_token=anonymous_token,
                    lens_ids=all_lens_ids,
                )
            if user_id is not None:
                meeting_dates = await get_meeting_dates_for_user(conn, user_id)

    # Build units by splitting progression on MeetingMarker objects
    units = []
    current_modules = []
    current_meeting_number = None
    meeting_count = 0

    for item in course.progression:
        if isinstance(item, MeetingMarker):
            meeting_count += 1
            # When we hit a meeting, save the current unit if it has modules
            if current_modules:
                units.append(
                    {
                        "meetingNumber": meeting_count,
                        "meetingName": item.name,
                        "meetingDate": meeting_dates.get(meeting_count),
                        "modules": current_modules,
                    }
                )
                current_modules = []
            current_meeting_number = meeting_count
        elif isinstance(item, ModuleRef):
            # Get module slug from progression item
            module_slug = item.slug

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
            # Sections are dicts with camelCase keys
            stages = []
            for section in parsed.sections:
                # Get section title from meta or title key
                section_type = section.get("type", "unknown")
                title = (
                    section.get("meta", {}).get("title")
                    or section.get("title")
                    or section_type.replace("-", " ").title()
                )

                # Check if this specific lens is completed
                content_id_str = section.get("contentId")
                content_id = UUID(content_id_str) if content_id_str else None
                lens_completed = (
                    content_id in progress_map
                    and progress_map[content_id].get("completed_at")
                    if content_id
                    else False
                )

                section_words = section.get("wordCount", 0)
                section_video = section.get("videoDurationSeconds", 0)
                section_dur = round((section_words / 200 + section_video / 60) * 1.5)

                # Collect authors/channels from segments
                attributions = []
                seen = set()
                for seg in section.get("segments", []):
                    name = None
                    if seg.get("type") == "article":
                        name = seg.get("author")
                    elif seg.get("type") == "video":
                        name = seg.get("channel")
                    if name and name not in seen:
                        attributions.append(name)
                        seen.add(name)
                attribution = " & ".join(attributions) if attributions else None

                stage_data = {
                    "type": section_type,
                    "displayType": section.get("displayType"),
                    "title": title,
                    "duration": section_dur or None,
                    "optional": section.get("optional", False),
                    "contentId": content_id_str,
                    "completed": lens_completed,
                    "tldr": section.get("tldr"),
                    "attribution": attribution,
                }
                if section.get("hide"):
                    stage_data["hide"] = True
                stages.append(stage_data)

            # Compute module duration from core (non-optional) content only
            core_sections = [s for s in parsed.sections if not s.get("optional", False)]
            total_words = sum(s.get("wordCount", 0) for s in core_sections)
            total_video_seconds = sum(
                s.get("videoDurationSeconds", 0) for s in core_sections
            )
            reading_minutes = total_words / 200
            video_minutes = total_video_seconds / 60
            duration_minutes = round((reading_minutes + video_minutes) * 1.5)

            current_modules.append(
                {
                    "slug": parsed.slug,
                    "title": parsed.title,
                    "optional": item.optional,
                    "parentSlug": parsed.parent_slug,
                    "parentTitle": parsed.parent_title,
                    "stages": stages,
                    "status": status,
                    "completedLenses": completed_count,
                    "totalLenses": total_count,
                    "duration": duration_minutes or None,
                }
            )

    # Handle any remaining modules after the last meeting (or if no meetings)
    if current_modules:
        # If there were no meetings at all, use meeting number 1 as default
        meeting_num = (current_meeting_number + 1) if current_meeting_number else 1
        units.append(
            {
                "meetingNumber": meeting_num,
                "meetingName": None,
                "meetingDate": meeting_dates.get(meeting_num),
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
