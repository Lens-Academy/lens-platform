"""Daily study activity messages for group channels.

Posts one Discord message per group per day that builds up as members
complete sections, showing real-time study activity with early-bird callouts.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select, and_, cast, Date, func
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import (
    users,
    groups,
    groups_users,
    user_content_progress,
    meetings,
    cohorts,
)
from core.enums import GroupUserStatus
from core.modules.loader import load_flattened_module
from core.modules.course_loader import load_course, get_due_by_meeting

from core.database import get_connection
from core.discord_outbound import send_channel_message
from core.discord_outbound.messages import edit_channel_message

logger = logging.getLogger(__name__)


def render_study_activity_message(entries: list[dict]) -> str | None:
    """Render the study activity message from structured entry data.

    Args:
        entries: List of dicts with keys: discord_id, display_name,
                 module_title, sections_completed, sections_total,
                 module_completed, early_bird_days

    Returns:
        Formatted Discord message string, or None if no entries.
    """
    if not entries:
        return None

    # Sort: completed first, then in-progress
    sorted_entries = sorted(entries, key=lambda e: (not e["module_completed"],))

    lines = ["\U0001f4da **Today's Study Activity**", ""]

    for entry in sorted_entries:
        mention = f"<@{entry['discord_id']}>"
        name = entry["display_name"]
        module = f"*{entry['module_title']}*"
        sections = f"{entry['sections_completed']}/{entry['sections_total']} sections"

        if entry["module_completed"]:
            line = f"\U0001f389 {mention} {name} \u2014 completed {module}! ({sections}"
            if entry.get("early_bird_days") and entry["early_bird_days"] >= 2:
                line += f" \u00b7 early bird \u2014 {entry['early_bird_days']} days before meeting"
            line += ")"
        else:
            line = f"\U0001f4d6 {mention} {name} \u2014 studying {module} ({sections})"

        lines.append(line)

    return "\n".join(lines)


async def get_user_group_info(conn: AsyncConnection, user_id: int) -> dict | None:
    """Get user's active group with Discord channel and course info."""
    query = (
        select(
            groups.c.group_id,
            groups.c.discord_text_channel_id,
            groups.c.cohort_id,
            func.coalesce(groups.c.course_slug_override, cohorts.c.course_slug).label(
                "course_slug"
            ),
        )
        .select_from(
            groups_users.join(
                groups, groups_users.c.group_id == groups.c.group_id
            ).join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        )
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    if not row or not row["discord_text_channel_id"]:
        return None
    return dict(row)


async def gather_group_study_data(
    conn: AsyncConnection,
    *,
    group_id: int,
    module_slug: str,
    today: date,
) -> list[dict]:
    """Query today's study progress for all members of a group on a specific module.

    IMPORTANT: The progress query is filtered to only count completions of
    sections belonging to this module (by content ID).
    """
    try:
        module = load_flattened_module(module_slug)
    except Exception:
        logger.warning(f"Module {module_slug} not found for study activity")
        return []

    required_sections = [s for s in module.sections if not s.get("optional", False)]
    total_sections = len(required_sections)
    section_content_ids = [
        UUID(s["contentId"]) for s in required_sections if s.get("contentId")
    ]

    if not section_content_ids:
        return []

    # Get group members
    members_query = (
        select(
            users.c.user_id,
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
        )
        .select_from(
            groups_users.join(users, groups_users.c.user_id == users.c.user_id)
        )
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.status == GroupUserStatus.active)
    )
    members_result = await conn.execute(members_query)
    members = members_result.mappings().fetchall()

    if not members:
        return []

    member_user_ids = [m["user_id"] for m in members]

    # Get today's completions filtered by this module's sections
    progress_query = select(user_content_progress).where(
        and_(
            user_content_progress.c.user_id.in_(member_user_ids),
            user_content_progress.c.content_id.in_(section_content_ids),
            user_content_progress.c.content_type == "lens",
            user_content_progress.c.completed_at.isnot(None),
            cast(user_content_progress.c.completed_at, Date) == today,
        )
    )
    progress_result = await conn.execute(progress_query)
    completions = progress_result.mappings().fetchall()

    if not completions:
        return []

    # Count per user
    user_completion_count: dict[int, int] = {}
    for row in completions:
        uid = row["user_id"]
        user_completion_count[uid] = user_completion_count.get(uid, 0) + 1

    # Check module completion
    module_completed_users: set[int] = set()
    if module.content_id:
        module_progress_query = select(user_content_progress.c.user_id).where(
            and_(
                user_content_progress.c.user_id.in_(list(user_completion_count.keys())),
                user_content_progress.c.content_id == module.content_id,
                user_content_progress.c.content_type == "module",
                user_content_progress.c.completed_at.isnot(None),
            )
        )
        module_result = await conn.execute(module_progress_query)
        module_completed_users = {
            row["user_id"] for row in module_result.mappings().fetchall()
        }

    # Build entries
    members_by_id = {m["user_id"]: m for m in members}
    entries = []
    for uid, count in user_completion_count.items():
        member = members_by_id.get(uid)
        if not member or not member["discord_id"]:
            continue
        display_name = member["nickname"] or member["discord_username"] or "Unknown"
        entries.append(
            {
                "discord_id": member["discord_id"],
                "display_name": display_name,
                "module_title": module.title,
                "sections_completed": min(count, total_sections),
                "sections_total": total_sections,
                "module_completed": uid in module_completed_users,
                "early_bird_days": None,
            }
        )

    return entries


async def compute_early_bird_days(
    conn: AsyncConnection,
    *,
    group_id: int,
    module_slug: str,
    course_slug: str,
) -> int | None:
    """Compute days until the meeting this module is due for.

    Returns number of days until meeting (if >= 2), or None.
    """
    try:
        course = load_course(course_slug)
    except Exception:
        return None

    due_by_meeting = get_due_by_meeting(course, module_slug)
    if due_by_meeting is None:
        return None

    query = select(meetings.c.scheduled_at).where(
        and_(
            meetings.c.group_id == group_id,
            meetings.c.meeting_number == due_by_meeting,
        )
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    if not row:
        return None

    meeting_dt = row["scheduled_at"]
    now = datetime.now(timezone.utc)
    delta = (meeting_dt - now).days
    return delta if delta >= 2 else None


# In-memory storage: (group_id, date) -> discord_message_id
_daily_messages: dict[tuple[int, date], str] = {}


def _prune_old_messages() -> None:
    """Remove entries older than 2 days to prevent unbounded memory growth."""
    cutoff = date.today() - timedelta(days=2)
    stale_keys = [k for k in _daily_messages if k[1] < cutoff]
    for k in stale_keys:
        del _daily_messages[k]


async def update_study_activity(
    user_id: int,
    module_slug: str,
) -> None:
    """Main entry point: update the daily study activity message for a user's group.

    Called after a section is marked complete. Looks up the user's group,
    gathers today's study data, renders the message, and creates or edits
    the Discord message.

    Runs as a fire-and-forget asyncio task. All exceptions are caught and
    logged to prevent "Task exception was never retrieved" warnings.
    """
    try:
        today = date.today()
        _prune_old_messages()

        async with get_connection() as conn:
            group_info = await get_user_group_info(conn, user_id)
            if not group_info:
                return

            group_id = group_info["group_id"]
            channel_id = group_info["discord_text_channel_id"]
            course_slug = group_info["course_slug"]

            entries = await gather_group_study_data(
                conn,
                group_id=group_id,
                module_slug=module_slug,
                today=today,
            )
            if not entries:
                return

            # Compute early bird for completed modules
            for entry in entries:
                if entry["module_completed"]:
                    days = await compute_early_bird_days(
                        conn,
                        group_id=group_id,
                        module_slug=module_slug,
                        course_slug=course_slug,
                    )
                    entry["early_bird_days"] = days

            content = render_study_activity_message(entries)
            if not content:
                return

            key = (group_id, today)
            existing_msg_id = _daily_messages.get(key)

            if existing_msg_id:
                success = await edit_channel_message(
                    channel_id, existing_msg_id, content
                )
                if not success:
                    new_id = await send_channel_message(channel_id, content)
                    if new_id:
                        _daily_messages[key] = new_id
            else:
                new_id = await send_channel_message(channel_id, content)
                if new_id:
                    _daily_messages[key] = new_id

    except Exception:
        logger.exception("Failed to update study activity message")
