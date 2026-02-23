"""Queries for facilitator panel access control and data."""

from typing import Any

from sqlalchemy import select, func, literal_column
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import (
    groups,
    groups_users,
    users,
    cohorts,
    user_content_progress,
    chat_sessions,
    meetings,
    attendances,
)


async def is_admin(conn: AsyncConnection, user_id: int) -> bool:
    """Check if user has admin role."""
    result = await conn.execute(
        select(users.c.is_admin).where(users.c.user_id == user_id)
    )
    row = result.first()
    return row is not None and row.is_admin is True


async def get_facilitator_group_ids(conn: AsyncConnection, user_id: int) -> list[int]:
    """Get group IDs where user is a facilitator."""
    result = await conn.execute(
        select(groups_users.c.group_id).where(
            (groups_users.c.user_id == user_id)
            & (groups_users.c.role == "facilitator")
            & (groups_users.c.status == "active")
        )
    )
    return [row.group_id for row in result]


async def get_accessible_groups(
    conn: AsyncConnection, user_id: int
) -> list[dict[str, Any]]:
    """
    Get groups accessible to this user.

    Admins see all groups, facilitators see only their groups.
    """
    admin = await is_admin(conn, user_id)

    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.status,
            groups.c.discord_text_channel_id,
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
        )
        .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        .where(groups.c.status.in_(["preview", "active", "completed"]))
        .order_by(cohorts.c.cohort_start_date.desc(), groups.c.group_name)
    )

    if not admin:
        # Facilitators only see their groups
        group_ids = await get_facilitator_group_ids(conn, user_id)
        if not group_ids:
            return []
        query = query.where(groups.c.group_id.in_(group_ids))

    result = await conn.execute(query)
    return [dict(row) for row in result.mappings()]


async def can_access_group(conn: AsyncConnection, user_id: int, group_id: int) -> bool:
    """Check if user can access a specific group."""
    if await is_admin(conn, user_id):
        return True

    group_ids = await get_facilitator_group_ids(conn, user_id)
    return group_id in group_ids


async def get_group_members_with_progress(
    conn: AsyncConnection, group_id: int
) -> list[dict[str, Any]]:
    """Get group members (participants) with aggregated progress stats."""
    name_col = func.coalesce(users.c.nickname, users.c.discord_username).label("name")

    # Subquery: count of past meetings for this group
    meetings_occurred_subq = (
        select(func.count())
        .where(
            (meetings.c.group_id == group_id) & (meetings.c.scheduled_at < func.now())
        )
        .correlate()
        .scalar_subquery()
        .label("meetings_occurred")
    )

    # Subquery: meetings attended per user (checked_in_at is not null)
    meetings_attended_subq = (
        select(func.count())
        .select_from(attendances)
        .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
        .where(
            (meetings.c.group_id == group_id)
            & (meetings.c.scheduled_at < func.now())
            & (attendances.c.user_id == groups_users.c.user_id)
            & (attendances.c.checked_in_at.isnot(None))
            & (attendances.c.is_guest.is_(False))
        )
        .correlate(groups_users)
        .scalar_subquery()
        .label("meetings_attended")
    )

    # Subquery: count user-role messages across all chat sessions
    # Uses PostgreSQL jsonb_array_elements to unnest and count
    ai_message_count_subq = (
        select(func.count())
        .select_from(
            chat_sessions,
            func.jsonb_array_elements(chat_sessions.c.messages).alias("msg"),
        )
        .where(
            (chat_sessions.c.user_id == groups_users.c.user_id)
            & (literal_column("msg.value->>'role'") == "user")
        )
        .correlate(groups_users)
        .scalar_subquery()
        .label("ai_message_count")
    )

    query = (
        select(
            groups_users.c.user_id,
            name_col,
            users.c.discord_id,
            func.count(user_content_progress.c.completed_at).label(
                "sections_completed"
            ),
            func.coalesce(
                func.sum(user_content_progress.c.total_time_spent_s), 0
            ).label("total_time_seconds"),
            func.max(user_content_progress.c.started_at).label("last_active_at"),
            meetings_occurred_subq,
            func.coalesce(meetings_attended_subq, 0).label("meetings_attended"),
            func.coalesce(ai_message_count_subq, 0).label("ai_message_count"),
        )
        .join(users, groups_users.c.user_id == users.c.user_id)
        .outerjoin(
            user_content_progress,
            groups_users.c.user_id == user_content_progress.c.user_id,
        )
        .where(
            (groups_users.c.group_id == group_id)
            & (groups_users.c.role == "participant")
            & (groups_users.c.status == "active")
        )
        .group_by(
            groups_users.c.user_id,
            users.c.nickname,
            users.c.discord_username,
            users.c.discord_id,
        )
        .order_by(name_col)
    )

    result = await conn.execute(query)
    rows = []
    for row in result.mappings():
        r = dict(row)
        # Serialize datetime for JSON
        if r["last_active_at"] is not None:
            r["last_active_at"] = r["last_active_at"].isoformat()
        rows.append(r)
    return rows


async def get_user_all_progress(
    conn: AsyncConnection, user_id: int
) -> list[dict[str, Any]]:
    """Get all progress rows for a user."""
    result = await conn.execute(
        select(user_content_progress).where(user_content_progress.c.user_id == user_id)
    )
    return [dict(row) for row in result.mappings()]


async def get_user_chat_sessions_for_facilitator(
    conn: AsyncConnection, user_id: int
) -> list[dict[str, Any]]:
    """Get all chat sessions for a user, ordered by most recent first."""
    result = await conn.execute(
        select(chat_sessions)
        .where(chat_sessions.c.user_id == user_id)
        .order_by(chat_sessions.c.started_at.desc())
    )
    return [dict(row) for row in result.mappings()]


async def get_user_meeting_attendance(
    conn: AsyncConnection, user_id: int, group_id: int
) -> list[dict[str, Any]]:
    """Get per-meeting attendance for a user in a group."""
    query = (
        select(
            meetings.c.meeting_id,
            meetings.c.meeting_number,
            meetings.c.scheduled_at,
            attendances.c.rsvp_status,
            attendances.c.rsvp_at,
            attendances.c.checked_in_at,
        )
        .outerjoin(
            attendances,
            (meetings.c.meeting_id == attendances.c.meeting_id)
            & (attendances.c.user_id == user_id)
            & (attendances.c.is_guest.is_(False)),
        )
        .where(meetings.c.group_id == group_id)
        .order_by(meetings.c.scheduled_at)
    )
    result = await conn.execute(query)
    rows = []
    for row in result.mappings():
        r = dict(row)
        for key in ("scheduled_at", "rsvp_at", "checked_in_at"):
            if r.get(key) is not None:
                r[key] = r[key].isoformat()
        rows.append(r)
    return rows


async def get_group_completion_data(
    conn: AsyncConnection, group_id: int
) -> tuple[
    dict[int, set[str]],
    dict[int, dict[int, bool]],
    set[int],
    dict[int, dict[int, str]],
    dict[int, set[int]],
]:
    """Get bulk completion and attendance data for all active participants.

    Returns:
        (completions, attendance, past_meeting_numbers, rsvps, guest_elsewhere)
        - completions: user_id -> set of completed content_id strings
        - attendance: user_id -> {meeting_number: attended_bool}
        - past_meeting_numbers: set of meeting numbers that have occurred
        - rsvps: user_id -> {meeting_number: rsvp_status_str}
        - guest_elsewhere: user_id -> set of meeting_numbers where they're visiting another group
    """
    # Completed content_ids per member
    comp_result = await conn.execute(
        select(
            user_content_progress.c.user_id,
            user_content_progress.c.content_id,
        )
        .join(groups_users, user_content_progress.c.user_id == groups_users.c.user_id)
        .where(
            (groups_users.c.group_id == group_id)
            & (groups_users.c.role == "participant")
            & (groups_users.c.status == "active")
            & (user_content_progress.c.completed_at.isnot(None))
        )
    )
    completions: dict[int, set[str]] = {}
    for row in comp_result:
        completions.setdefault(row.user_id, set()).add(str(row.content_id))

    # All meetings for this group (need all for RSVPs, past subset for attendance)
    all_mtg_result = await conn.execute(
        select(
            meetings.c.meeting_id, meetings.c.meeting_number, meetings.c.scheduled_at
        ).where(
            (meetings.c.group_id == group_id) & (meetings.c.meeting_number.isnot(None))
        )
    )
    all_mtg_rows = list(all_mtg_result)
    all_meeting_id_to_num = {r.meeting_id: r.meeting_number for r in all_mtg_rows}
    past_meeting_numbers = {
        r.meeting_number
        for r in all_mtg_rows
        if r.scheduled_at < func.now().compile().params.get("now_1", r.scheduled_at)
    }

    # Determine past meetings by comparing scheduled_at
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    past_meeting_numbers = {
        r.meeting_number for r in all_mtg_rows if r.scheduled_at < now
    }
    past_meeting_ids = {r.meeting_id for r in all_mtg_rows if r.scheduled_at < now}

    # Attendance (past only) + RSVP (all meetings) per member
    attendance: dict[int, dict[int, bool]] = {}
    rsvps: dict[int, dict[int, str]] = {}
    if all_mtg_rows:
        att_result = await conn.execute(
            select(
                attendances.c.user_id,
                attendances.c.meeting_id,
                attendances.c.checked_in_at,
                attendances.c.rsvp_status,
            ).where(
                attendances.c.meeting_id.in_([r.meeting_id for r in all_mtg_rows])
                & (attendances.c.is_guest.is_(False))
            )
        )
        for row in att_result:
            mnum = all_meeting_id_to_num.get(row.meeting_id)
            if mnum is not None:
                # Only record attendance for past meetings
                if row.meeting_id in past_meeting_ids:
                    attendance.setdefault(row.user_id, {})[mnum] = (
                        row.checked_in_at is not None
                    )
                if row.rsvp_status:
                    rsvps.setdefault(row.user_id, {})[mnum] = row.rsvp_status

    # Guest visits: which members are visiting another group for a given meeting_number
    member_user_ids = select(groups_users.c.user_id).where(
        (groups_users.c.group_id == group_id)
        & (groups_users.c.role == "participant")
        & (groups_users.c.status == "active")
    )
    guest_visit_result = await conn.execute(
        select(attendances.c.user_id, meetings.c.meeting_number)
        .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
        .where(
            attendances.c.is_guest.is_(True)
            & attendances.c.user_id.in_(member_user_ids)
            & meetings.c.meeting_number.isnot(None)
        )
    )
    guest_elsewhere: dict[int, set[int]] = {}
    for row in guest_visit_result:
        guest_elsewhere.setdefault(row.user_id, set()).add(row.meeting_number)

    return completions, attendance, past_meeting_numbers, rsvps, guest_elsewhere


async def get_group_time_and_chat_data(
    conn: AsyncConnection, group_id: int
) -> tuple[dict[int, dict[str, int]], dict[int, dict[str, int]]]:
    """Get bulk time-spent and chat-message-count data for all active participants.

    Returns:
        (time_data, chat_data)
        - time_data: user_id -> {content_id_str: total_time_spent_s}
        - chat_data: user_id -> {content_id_str: user_message_count}
    """
    # Time spent per user per content_id
    time_result = await conn.execute(
        select(
            user_content_progress.c.user_id,
            user_content_progress.c.content_id,
            user_content_progress.c.total_time_spent_s,
        )
        .join(groups_users, user_content_progress.c.user_id == groups_users.c.user_id)
        .where(
            (groups_users.c.group_id == group_id)
            & (groups_users.c.role == "participant")
            & (groups_users.c.status == "active")
            & (user_content_progress.c.total_time_spent_s > 0)
        )
    )
    time_data: dict[int, dict[str, int]] = {}
    for row in time_result:
        time_data.setdefault(row.user_id, {})[str(row.content_id)] = (
            row.total_time_spent_s
        )

    # Chat user-message counts per user per content_id
    from sqlalchemy import text

    chat_result = await conn.execute(
        text("""
            SELECT cs.user_id, cs.content_id::text, COUNT(*) as msg_count
            FROM chat_sessions cs
            CROSS JOIN LATERAL jsonb_array_elements(cs.messages) msg
            JOIN groups_users gu ON gu.user_id = cs.user_id
            WHERE gu.group_id = :group_id
            AND gu.role = 'participant'
            AND gu.status = 'active'
            AND cs.content_id IS NOT NULL
            AND msg.value->>'role' = 'user'
            GROUP BY cs.user_id, cs.content_id
        """),
        {"group_id": group_id},
    )
    chat_data: dict[int, dict[str, int]] = {}
    for row in chat_result:
        chat_data.setdefault(row.user_id, {})[str(row.content_id)] = row.msg_count

    return time_data, chat_data


async def is_user_in_group(conn: AsyncConnection, user_id: int, group_id: int) -> bool:
    """Check if a user is an active member of a group."""
    result = await conn.execute(
        select(groups_users.c.group_user_id).where(
            (groups_users.c.user_id == user_id)
            & (groups_users.c.group_id == group_id)
            & (groups_users.c.status == "active")
        )
    )
    return result.first() is not None
