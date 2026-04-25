"""Build per-turn context injection block for the coach.

A small programmatic block (~50 tokens) injected as a system message
near the tail of the message array. Contains progress, next meeting,
and last study activity. NOT about time — timestamps handle that.
"""

import logging
from datetime import datetime, timezone

from core.database import get_connection
from core.modules.progress import get_completed_content_ids
from core.modules.course_loader import load_course
from core.modules.loader import load_flattened_module, ModuleNotFoundError
from core.modules.flattened_types import MeetingMarker
from core.queries.meetings import get_meeting_dates_for_user
from core.agents.tools.progress_tools import get_user_course_slug

logger = logging.getLogger(__name__)


def _iter_modules(course) -> list:
    """Return progression items that are modules (not meeting markers)."""
    return [item for item in course.progression if not isinstance(item, MeetingMarker)]


async def build_context_block(user_id: int) -> str:
    """Build the per-turn context injection string.

    Returns a short text block for injection as a system message.
    Never raises — returns minimal context on any error.
    """
    try:
        return await _build_context_inner(user_id)
    except Exception:
        logger.exception("context_injection_failed", extra={"user_id": user_id})
        return "(Course context unavailable.)"


async def _build_context_inner(user_id: int) -> str:
    course_slug = await get_user_course_slug(user_id)
    if not course_slug:
        return "(User not enrolled in a course.)"

    course = load_course(course_slug)
    modules = _iter_modules(course)

    async with get_connection() as conn:
        completed_ids = await get_completed_content_ids(conn, user_id)
        meeting_dates = await get_meeting_dates_for_user(conn, user_id)

    # Compute progress
    total_lenses = 0
    total_done = 0
    current_module_title = None

    for mod_ref in modules:
        try:
            flat = load_flattened_module(mod_ref.slug)
        except ModuleNotFoundError:
            continue
        lens_sections = [s for s in flat.sections if s.get("type") == "lens"]
        lens_count = len(lens_sections)
        done_count = sum(1 for s in lens_sections if s.get("contentId") in completed_ids)
        total_lenses += lens_count
        total_done += done_count
        if 0 < done_count < lens_count and current_module_title is None:
            current_module_title = flat.title

    parts = []
    pct = round(total_done / total_lenses * 100) if total_lenses else 0

    if current_module_title:
        parts.append(f"Progress: {total_done}/{total_lenses} lenses ({pct}%) — working on {current_module_title}")
    else:
        parts.append(f"Progress: {total_done}/{total_lenses} lenses ({pct}%)")

    # Next meeting
    now = datetime.now(timezone.utc)
    future_meetings = sorted(
        (
            (num, datetime.fromisoformat(iso))
            for num, iso in meeting_dates.items()
            if datetime.fromisoformat(iso) > now
        ),
        key=lambda x: x[1],
    )

    if future_meetings:
        meeting_num, meeting_dt = future_meetings[0]
        delta = meeting_dt - now
        if delta.days == 0:
            time_str = "today"
        elif delta.days == 1:
            time_str = "tomorrow"
        else:
            time_str = f"in {delta.days} days"
        date_str = meeting_dt.strftime("%a %b %d at %I:%M %p UTC")
        parts.append(f"Next meeting: Meeting {meeting_num}, {date_str} ({time_str})")

    return "\n".join(parts)
