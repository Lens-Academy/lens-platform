"""
Context building for notification reminders.

This module extracts the "build context for a meeting reminder" logic
so it can be reused by the scheduler at execution time.

The key insight: store only meeting_id in scheduler jobs, then fetch
fresh context when executing the reminder. This avoids stale data.
"""

import logging
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.sql import func

from core.database import get_connection
from core.enums import GroupUserStatus
from core.notifications.urls import (
    build_course_url,
    build_discord_channel_url,
    build_module_url,
)
from core.tables import cohorts, groups, groups_users, meetings, user_content_progress

logger = logging.getLogger(__name__)


async def get_meeting_with_group(meeting_id: int) -> tuple[dict, dict] | None:
    """
    Fetch meeting and its group from the database.

    Args:
        meeting_id: The meeting ID to look up

    Returns:
        Tuple of (meeting_dict, group_dict) if found, None if meeting doesn't exist.
        Both dicts contain the relevant fields needed for reminder context.
    """
    async with get_connection() as conn:
        query = (
            select(
                meetings.c.meeting_id,
                meetings.c.group_id,
                meetings.c.scheduled_at,
                meetings.c.meeting_number,
                groups.c.group_name,
                groups.c.discord_text_channel_id,
                func.coalesce(
                    groups.c.course_slug_override, cohorts.c.course_slug
                ).label("course_slug"),
            )
            .select_from(
                meetings.join(groups, meetings.c.group_id == groups.c.group_id).join(
                    cohorts, groups.c.cohort_id == cohorts.c.cohort_id
                )
            )
            .where(meetings.c.meeting_id == meeting_id)
        )
        result = await conn.execute(query)
        row = result.mappings().first()

        if not row:
            return None

        # Split into meeting and group dicts for cleaner API
        meeting = {
            "meeting_id": row["meeting_id"],
            "group_id": row["group_id"],
            "scheduled_at": row["scheduled_at"],
            "meeting_number": row["meeting_number"],
        }
        group = {
            "group_id": row["group_id"],
            "group_name": row["group_name"],
            "discord_text_channel_id": row["discord_text_channel_id"],
            "course_slug": row["course_slug"],
        }
        return meeting, group


async def get_active_member_ids(group_id: int) -> list[int]:
    """
    Get user_ids of active group members.

    Args:
        group_id: The group to query

    Returns:
        List of user_ids for members with active status
    """
    async with get_connection() as conn:
        query = (
            select(groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        result = await conn.execute(query)
        return [row["user_id"] for row in result.mappings()]


def build_reminder_context(meeting: dict, group: dict) -> dict:
    """
    Build notification context from fresh database data.

    This is a pure function that takes meeting and group dicts
    and returns a context dict suitable for notification templates.

    Args:
        meeting: Dict with scheduled_at (datetime) and other meeting fields
        group: Dict with group_name, discord_text_channel_id, course_slug

    Returns:
        Context dict with all fields needed for meeting reminder templates
    """
    scheduled_at = meeting["scheduled_at"]

    # Try to resolve the specific module due for this meeting
    module_url = build_course_url()
    module_list = "- Check your course page for the next module"
    modules_remaining = "some"
    first_section_title = ""
    module_title = ""

    course_slug = group.get("course_slug")
    meeting_number = meeting.get("meeting_number")
    if course_slug and meeting_number:
        try:
            from core.modules.course_loader import (
                load_course,
                get_due_by_meeting,
                get_required_modules,
            )
            from core.modules.loader import load_flattened_module

            course = load_course(course_slug)
            required = get_required_modules(course)

            # Find modules due AT this meeting (not cumulative from prior meetings)
            due_slugs = []
            for m in required:
                due_by = get_due_by_meeting(course, m.slug)
                if due_by is not None and due_by == meeting_number:
                    due_slugs.append(m.slug)

            if due_slugs:
                # Count total non-optional sections across due modules
                section_titles = []
                first_section_slug = None
                for slug in due_slugs:
                    try:
                        mod = load_flattened_module(slug)
                        if not module_title:
                            module_title = mod.title
                        for s in mod.sections:
                            if not s.get("optional", False):
                                title = s.get("title") or s.get("meta", {}).get("title")
                                if title:
                                    section_titles.append(f"- {title}")
                                    if not first_section_title:
                                        first_section_title = title
                                        first_section_slug = slug
                    except Exception:
                        pass

                # Link to the module containing the first section (matches CTA text)
                cta_slug = first_section_slug or due_slugs[0]
                module_url = build_module_url(course_slug, cta_slug)

                if section_titles:
                    modules_remaining = str(len(section_titles))
                    module_list = "\n".join(section_titles)
        except Exception:
            logger.debug("Could not resolve module info for reminder", exc_info=True)

    # Build CTA text
    if first_section_title and module_title:
        cta_text = f"Read '{first_section_title}' from '{module_title}' now"
    else:
        cta_text = "Continue where you left off"

    return {
        "group_name": group["group_name"],
        # ISO timestamp for per-user timezone formatting
        "meeting_time_utc": scheduled_at.isoformat(),
        "meeting_date_utc": scheduled_at.isoformat(),
        # Human-readable UTC fallback for channel messages (no user context)
        "meeting_time": scheduled_at.strftime("%A at %H:%M UTC"),
        "meeting_date": scheduled_at.strftime("%A, %B %d"),
        "module_url": module_url,
        "discord_channel_url": build_discord_channel_url(
            channel_id=group["discord_text_channel_id"]
        ),
        "module_list": module_list,
        "modules_remaining": modules_remaining,
        "cta_text": cta_text,
    }


async def get_per_user_section_progress(
    meeting_id: int, user_ids: list[int]
) -> dict[int, dict]:
    """Get per-user progress for modules due at a meeting.

    Returns personalized CTA info so each user sees their first uncompleted section.

    Args:
        meeting_id: Meeting to check modules for
        user_ids: Users to check progress for

    Returns:
        Dict mapping user_id to {"remaining": int, "cta_text": str, "module_url": str}.
        Users not in the dict have no trackable sections (module has no content IDs).
        Users with remaining=0 have completed all sections.
    """
    if not meeting_id or not user_ids:
        return {}

    try:
        from core.modules.course_loader import (
            load_course,
            get_due_by_meeting,
            get_required_modules,
        )
        from core.modules.loader import load_flattened_module, ModuleNotFoundError

        async with get_connection() as conn:
            # Get meeting info
            query = (
                select(
                    meetings.c.meeting_number,
                    func.coalesce(
                        groups.c.course_slug_override, cohorts.c.course_slug
                    ).label("course_slug"),
                )
                .select_from(
                    meetings.join(
                        groups, meetings.c.group_id == groups.c.group_id
                    ).join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
                )
                .where(meetings.c.meeting_id == meeting_id)
            )
            result = await conn.execute(query)
            row = result.mappings().first()
            if not row:
                return {}

            meeting_number = row["meeting_number"]
            course_slug = row["course_slug"]

            # Load course and find modules due at this meeting
            try:
                course = load_course(course_slug)
            except Exception:
                return {}

            required = get_required_modules(course)
            due_slugs = []
            for m in required:
                due_by = get_due_by_meeting(course, m.slug)
                if due_by is not None and due_by == meeting_number:
                    due_slugs.append(m.slug)

            if not due_slugs:
                return {}

            # Build ordered list of (content_id, section_title, module_title, module_slug)
            # preserving section order within each module and module order in progression
            ordered_sections: list[tuple[UUID, str, str, str]] = []
            for slug in due_slugs:
                try:
                    mod = load_flattened_module(slug)
                    for s in mod.sections:
                        if not s.get("optional", False) and s.get("contentId"):
                            title = s.get("title") or s.get("meta", {}).get("title", "")
                            ordered_sections.append(
                                (UUID(s["contentId"]), title, mod.title, slug)
                            )
                except (ModuleNotFoundError, Exception):
                    continue

            if not ordered_sections:
                return {}

            all_content_ids = [cid for cid, _, _, _ in ordered_sections]

            # Query completed content_ids per user (not COUNT)
            progress_query = select(
                user_content_progress.c.user_id,
                user_content_progress.c.content_id,
            ).where(
                and_(
                    user_content_progress.c.user_id.in_(user_ids),
                    user_content_progress.c.content_id.in_(all_content_ids),
                    user_content_progress.c.content_type == "lens",
                    user_content_progress.c.completed_at.isnot(None),
                )
            )

            result = await conn.execute(progress_query)
            completed_by_user: dict[int, set[UUID]] = {}
            for r in result.mappings():
                completed_by_user.setdefault(r["user_id"], set()).add(r["content_id"])

            # Build per-user progress with personalized CTA
            total = len(ordered_sections)
            user_progress: dict[int, dict] = {}
            for user_id in user_ids:
                completed_ids = completed_by_user.get(user_id, set())
                remaining = total - len(completed_ids)

                # Find first uncompleted section for CTA
                cta_text = "Continue where you left off"
                module_url = build_course_url()
                for content_id, section_title, mod_title, mod_slug in ordered_sections:
                    if content_id not in completed_ids:
                        if section_title:
                            cta_text = f"Read '{section_title}' from '{mod_title}' now"
                        module_url = build_module_url(course_slug, mod_slug)
                        break

                user_progress[user_id] = {
                    "remaining": remaining,
                    "cta_text": cta_text,
                    "module_url": module_url,
                }

            return user_progress

    except Exception as e:
        logger.error(f"Error getting per-user section progress: {e}")
        return {}
