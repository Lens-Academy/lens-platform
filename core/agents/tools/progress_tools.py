"""Progress tools: get_my_progress, get_my_upcoming_deadlines.

Let the coach see the user's course progress and upcoming deadlines.
user_id is injected by the dispatcher — never exposed to the LLM.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select, func

from core.database import get_connection
from core.modules.progress import get_completed_content_ids
from core.modules.course_loader import load_course, get_due_by_meeting
from core.modules.loader import load_flattened_module, ModuleNotFoundError
from core.modules.flattened_types import MeetingMarker
from core.queries.meetings import get_meeting_dates_for_user
from core.tables import groups_users, groups, cohorts

logger = logging.getLogger(__name__)


PROGRESS_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_my_progress",
            "description": (
                "Get the current user's course progress. "
                "Returns which modules they've completed, which they're working on, "
                "and overall completion percentage."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_upcoming_deadlines",
            "description": (
                "Get the current user's upcoming deadlines: next group meeting, "
                "and which modules are due before each meeting."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


async def get_user_course_slug(user_id: int) -> str | None:
    """Get the course_slug for a user's active group. Returns None if unenrolled."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(
                func.coalesce(
                    groups.c.course_slug_override, cohorts.c.course_slug
                ).label("course_slug")
            )
            .select_from(
                groups_users.join(groups, groups_users.c.group_id == groups.c.group_id)
                .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
            )
            .where(groups_users.c.user_id == user_id)
            .where(groups_users.c.status == "active")
        )
        row = result.first()
    return row.course_slug if row else None


def _iter_modules(course) -> list:
    """Yield progression items that are modules (not meeting markers)."""
    return [item for item in course.progression if not isinstance(item, MeetingMarker)]


async def execute_get_my_progress(user_id: int) -> str:
    """Format the user's course progress as a readable summary."""
    course_slug = await get_user_course_slug(user_id)
    if not course_slug:
        return "You're not currently enrolled in an active cohort. Visit the web platform to sign up!"

    try:
        course = load_course(course_slug)
    except Exception:
        logger.exception("Failed to load course", extra={"course_slug": course_slug})
        return "Sorry, I couldn't load the course information right now."

    async with get_connection() as conn:
        completed_ids = await get_completed_content_ids(conn, user_id)

    modules = _iter_modules(course)
    lines = [f"Course: {course.title}"]
    total_lenses = 0
    total_completed = 0

    for mod_ref in modules:
        try:
            flat = load_flattened_module(mod_ref.slug)
        except ModuleNotFoundError:
            lines.append(f"  {mod_ref.slug} — (module not found)")
            continue

        lens_sections = [s for s in flat.sections if s.get("type") == "lens"]
        lens_count = len(lens_sections)
        done_count = sum(1 for s in lens_sections if s.get("contentId") in completed_ids)
        total_lenses += lens_count
        total_completed += done_count

        if done_count == lens_count and lens_count > 0:
            status = "completed ✓"
        elif done_count > 0:
            status = "in progress"
        else:
            status = "not started"

        optional = " (optional)" if mod_ref.optional else ""
        lines.append(f"  {flat.title}{optional} — {done_count}/{lens_count} lenses ({status})")

    pct = round(total_completed / total_lenses * 100) if total_lenses else 0
    lines.insert(1, f"Overall: {total_completed}/{total_lenses} lenses completed ({pct}%)")
    lines.insert(2, "")

    return "\n".join(lines)


async def execute_get_my_upcoming_deadlines(user_id: int) -> str:
    """Format the user's upcoming deadlines as a readable summary."""
    course_slug = await get_user_course_slug(user_id)
    if not course_slug:
        return "You're not currently enrolled in an active cohort. Visit the web platform to sign up!"

    async with get_connection() as conn:
        meeting_dates = await get_meeting_dates_for_user(conn, user_id)

    if not meeting_dates:
        return "No meetings scheduled for your group yet."

    now = datetime.now(timezone.utc)
    future_meetings = {
        num: iso_date
        for num, iso_date in meeting_dates.items()
        if datetime.fromisoformat(iso_date) > now
    }

    if not future_meetings:
        return "All your group meetings have passed. Check with your facilitator for next steps."

    try:
        course = load_course(course_slug)
    except Exception:
        logger.exception("Failed to load course", extra={"course_slug": course_slug})
        return "Sorry, I couldn't load the course information right now."

    modules = _iter_modules(course)
    lines = []

    for meeting_num in sorted(future_meetings.keys()):
        iso_date = future_meetings[meeting_num]
        dt = datetime.fromisoformat(iso_date)
        date_str = dt.strftime("%A %B %d at %I:%M %p UTC")

        due_modules = []
        for mod_ref in modules:
            due_meeting = get_due_by_meeting(course, mod_ref.slug)
            if due_meeting == meeting_num:
                try:
                    flat = load_flattened_module(mod_ref.slug)
                    due_modules.append(flat.title)
                except ModuleNotFoundError:
                    due_modules.append(mod_ref.slug)

        lines.append(f"Meeting {meeting_num}: {date_str}")
        if due_modules:
            for mod_title in due_modules:
                lines.append(f"  Due: {mod_title}")
        lines.append("")

    return "\n".join(lines).strip()
