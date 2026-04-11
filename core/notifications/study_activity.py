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
    chat_sessions,
    meetings,
    cohorts,
)
from core.enums import GroupUserStatus
from core.modules.loader import load_flattened_module
from core.modules.course_loader import (
    load_course,
    get_due_by_meeting,
    get_all_module_slugs,
)

from core.database import get_connection
from core.discord_outbound import send_channel_message, send_dm
from core.discord_outbound.messages import edit_channel_message, edit_dm

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

    # Count today's completions per user (used to decide who appears in the message)
    user_completion_count: dict[int, int] = {}
    for row in completions:
        uid = row["user_id"]
        user_completion_count[uid] = user_completion_count.get(uid, 0) + 1

    # Get all-time completions for users who studied today
    all_time_query = select(user_content_progress).where(
        and_(
            user_content_progress.c.user_id.in_(list(user_completion_count.keys())),
            user_content_progress.c.content_id.in_(section_content_ids),
            user_content_progress.c.content_type == "lens",
            user_content_progress.c.completed_at.isnot(None),
        )
    )
    all_time_result = await conn.execute(all_time_query)
    all_time_completions = all_time_result.mappings().fetchall()

    user_total_count: dict[int, int] = {}
    for row in all_time_completions:
        uid = row["user_id"]
        user_total_count[uid] = user_total_count.get(uid, 0) + 1

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
                "sections_completed": min(
                    user_total_count.get(uid, count), total_sections
                ),
                "sections_total": total_sections,
                "module_completed": uid in module_completed_users,
                "early_bird_days": None,
                "_module_slug": module_slug,
                "_user_id": uid,
                "_module_content_id": module.content_id,
                "_section_content_ids": section_content_ids,
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


async def gather_user_engagement_stats(
    conn: AsyncConnection,
    *,
    user_id: int,
    module_infos: list[dict],
) -> list[dict]:
    """Per-module time spent and AI message count for a user.

    Args:
        conn: Database connection.
        user_id: The user's ID.
        module_infos: List of dicts with keys: title, content_id (module UUID),
                      section_content_ids (list of section UUIDs).

    Returns:
        List of dicts with keys: module_title, time_spent_s, ai_messages.
        Only modules with nonzero activity are included.
    """
    if not module_infos:
        return []

    # Collect all section content IDs and map back to module index
    all_section_ids: list[UUID] = []
    section_to_module_idx: dict[UUID, int] = {}
    module_content_ids: list[UUID] = []

    for idx, info in enumerate(module_infos):
        if info.get("content_id"):
            module_content_ids.append(info["content_id"])
        for sid in info.get("section_content_ids", []):
            all_section_ids.append(sid)
            section_to_module_idx[sid] = idx

    # Query 1: Time spent per section, grouped by content_id
    time_per_module = [0] * len(module_infos)
    if all_section_ids:
        time_query = (
            select(
                user_content_progress.c.content_id,
                func.sum(user_content_progress.c.total_time_spent_s).label(
                    "total_time"
                ),
            )
            .where(
                and_(
                    user_content_progress.c.user_id == user_id,
                    user_content_progress.c.content_id.in_(all_section_ids),
                )
            )
            .group_by(user_content_progress.c.content_id)
        )
        time_result = await conn.execute(time_query)
        for row in time_result.mappings().fetchall():
            idx = section_to_module_idx.get(row["content_id"])
            if idx is not None:
                time_per_module[idx] += row["total_time"] or 0

    # Query 2: AI messages per module from chat_sessions
    messages_per_module = [0] * len(module_infos)
    if module_content_ids:
        chat_query = select(
            chat_sessions.c.module_id,
            chat_sessions.c.messages,
        ).where(
            and_(
                chat_sessions.c.user_id == user_id,
                chat_sessions.c.module_id.in_(module_content_ids),
            )
        )
        chat_result = await conn.execute(chat_query)
        # Map module_id -> index
        module_id_to_idx = {
            info["content_id"]: idx
            for idx, info in enumerate(module_infos)
            if info.get("content_id")
        }
        for row in chat_result.mappings().fetchall():
            idx = module_id_to_idx.get(row["module_id"])
            if idx is not None:
                msgs = row["messages"] or []
                user_msg_count = sum(1 for m in msgs if m.get("role") == "user")
                messages_per_module[idx] += user_msg_count

    # Build results, only including modules with nonzero activity
    results = []
    for idx, info in enumerate(module_infos):
        time_s = time_per_module[idx]
        ai_msgs = messages_per_module[idx]
        if time_s > 0 or ai_msgs > 0:
            stat = {
                "module_title": info["title"],
                "time_spent_s": time_s,
                "ai_messages": ai_msgs,
            }
            if "sections_completed" in info:
                stat["sections_completed"] = info["sections_completed"]
                stat["sections_total"] = info["sections_total"]
            results.append(stat)

    return results


def _format_time(seconds: int) -> str:
    """Format seconds as ~Xh Ym or ~Xm."""
    if seconds < 60:
        return "~1min"
    minutes = round(seconds / 60)
    if minutes >= 60:
        hours = minutes // 60
        remaining_mins = minutes % 60
        if remaining_mins:
            return f"~{hours}h {remaining_mins}min"
        return f"~{hours}h"
    return f"~{minutes}min"


def render_engagement_dm(stats: list[dict]) -> str | None:
    """Render personal engagement stats as a DM message.

    Args:
        stats: List of dicts with keys: module_title, time_spent_s, ai_messages.

    Returns:
        Formatted Discord message string, or None if no stats.
    """
    if not stats:
        return None

    lines = ["\U0001f4ca **Your study stats**", ""]

    for stat in stats:
        time_str = _format_time(stat["time_spent_s"])
        msgs = stat["ai_messages"]
        title = f"*{stat['module_title']}*"
        parts = [f"\u23f1\ufe0f {time_str}"]
        if "sections_completed" in stat:
            parts.append(
                f"\U0001f4d6 {stat['sections_completed']}/{stat['sections_total']} sections"
            )
        parts.append(f"\U0001f4ac {msgs} messages")
        line = " \u00b7 ".join(parts) + f" \u2014 {title}"
        lines.append(line)

    lines.append("")
    lines.append("If anything looks off, let us know!")

    return "\n".join(lines)


# In-memory storage: (group_id, date) -> discord_message_id
_daily_messages: dict[tuple[int, date], str] = {}

# In-memory storage: (discord_id, date) -> dm_message_id
_daily_dm_messages: dict[tuple[str, date], str] = {}


def _prune_old_messages() -> None:
    """Remove entries older than 2 days to prevent unbounded memory growth."""
    cutoff = date.today() - timedelta(days=2)
    stale_keys = [k for k in _daily_messages if k[1] < cutoff]
    for k in stale_keys:
        del _daily_messages[k]
    stale_dm_keys = [k for k in _daily_dm_messages if k[1] < cutoff]
    for k in stale_dm_keys:
        del _daily_dm_messages[k]


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

            all_entries = []
            for slug in get_all_module_slugs(course_slug):
                entries = await gather_group_study_data(
                    conn,
                    group_id=group_id,
                    module_slug=slug,
                    today=today,
                )
                all_entries.extend(entries)

            if not all_entries:
                return

            # Compute early bird for completed modules
            for entry in all_entries:
                if entry["module_completed"]:
                    days = await compute_early_bird_days(
                        conn,
                        group_id=group_id,
                        module_slug=entry["_module_slug"],
                        course_slug=course_slug,
                    )
                    entry["early_bird_days"] = days
            content = render_study_activity_message(all_entries)
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

            # DM each user their personal engagement stats
            unique_users: dict[str, tuple[int, list[dict]]] = {}
            for entry in all_entries:
                discord_id = entry["discord_id"]
                if discord_id not in unique_users:
                    unique_users[discord_id] = (entry["_user_id"], [])
                unique_users[discord_id][1].append(entry)

            for discord_id, (uid, user_entries) in unique_users.items():
                # Deduplicate module infos by content_id
                seen_content_ids: set[UUID | None] = set()
                module_infos = []
                for e in user_entries:
                    cid = e.get("_module_content_id")
                    if cid not in seen_content_ids:
                        seen_content_ids.add(cid)
                        module_infos.append(
                            {
                                "title": e["module_title"],
                                "content_id": cid,
                                "section_content_ids": e.get(
                                    "_section_content_ids", []
                                ),
                                "sections_completed": e["sections_completed"],
                                "sections_total": e["sections_total"],
                            }
                        )

                stats = await gather_user_engagement_stats(
                    conn,
                    user_id=uid,
                    module_infos=module_infos,
                )
                dm_content = render_engagement_dm(stats)
                if not dm_content:
                    continue

                dm_key = (discord_id, today)
                existing_dm_id = _daily_dm_messages.get(dm_key)
                if existing_dm_id:
                    success = await edit_dm(discord_id, existing_dm_id, dm_content)
                    if not success:
                        new_id = await send_dm(discord_id, dm_content)
                        if new_id:
                            _daily_dm_messages[dm_key] = new_id
                else:
                    new_id = await send_dm(discord_id, dm_content)
                    if new_id:
                        _daily_dm_messages[dm_key] = new_id

    except Exception:
        logger.exception("Failed to update study activity message")
