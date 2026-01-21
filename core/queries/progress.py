"""Queries for user progress tracking and aggregation."""

from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import (
    content_events,
    groups,
    groups_users,
    users,
    module_sessions,
)
from ..enums import ContentEventType

HEARTBEAT_INTERVAL_SECONDS = 30


async def get_group_members_summary(
    conn: AsyncConnection, group_id: int
) -> list[dict[str, Any]]:
    """
    Get progress summary for all members of a group.

    Returns list of members with lessons_completed, total_time, last_active.
    """
    # Get group's cohort to scope lesson progress
    group_result = await conn.execute(
        select(groups.c.cohort_id).where(groups.c.group_id == group_id)
    )
    group_row = group_result.first()
    if not group_row:
        return []

    # Subquery: count heartbeats per user
    heartbeat_counts = (
        select(
            content_events.c.user_id,
            func.count(content_events.c.event_id).label("heartbeat_count"),
            func.max(content_events.c.timestamp).label("last_active_at"),
        )
        .where(content_events.c.event_type == ContentEventType.heartbeat)
        .group_by(content_events.c.user_id)
        .subquery()
    )

    # Subquery: count completed lessons per user
    completed_lessons = (
        select(
            module_sessions.c.user_id,
            func.count(module_sessions.c.session_id).label("lessons_completed"),
        )
        .where(module_sessions.c.completed_at.isnot(None))
        .group_by(module_sessions.c.user_id)
        .subquery()
    )

    # Main query: group members with stats
    query = (
        select(
            users.c.user_id,
            users.c.discord_username,
            users.c.nickname,
            func.coalesce(completed_lessons.c.lessons_completed, 0).label(
                "lessons_completed"
            ),
            (
                func.coalesce(heartbeat_counts.c.heartbeat_count, 0)
                * HEARTBEAT_INTERVAL_SECONDS
            ).label("total_time_seconds"),
            func.coalesce(
                heartbeat_counts.c.last_active_at, users.c.last_active_at
            ).label("last_active_at"),
        )
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .outerjoin(heartbeat_counts, users.c.user_id == heartbeat_counts.c.user_id)
        .outerjoin(completed_lessons, users.c.user_id == completed_lessons.c.user_id)
        .where(
            (groups_users.c.group_id == group_id) & (groups_users.c.status == "active")
        )
        .order_by(users.c.discord_username)
    )

    result = await conn.execute(query)
    rows = []
    for row in result.mappings():
        rows.append(
            {
                "user_id": row["user_id"],
                "name": row["nickname"] or row["discord_username"],
                "lessons_completed": row["lessons_completed"],
                "total_time_seconds": row["total_time_seconds"],
                "last_active_at": row["last_active_at"].isoformat()
                if row["last_active_at"]
                else None,
            }
        )
    return rows


async def get_user_progress_for_group(
    conn: AsyncConnection, user_id: int, group_id: int
) -> dict[str, Any]:
    """
    Get detailed progress for a user within a group's cohort context.

    Returns per-module and per-stage breakdowns.
    """
    # Get group's cohort
    group_result = await conn.execute(
        select(groups.c.cohort_id).where(groups.c.group_id == group_id)
    )
    group_row = group_result.first()
    if not group_row:
        return {"modules": [], "total_time_seconds": 0, "last_active_at": None}

    # Get user's module sessions
    sessions_result = await conn.execute(
        select(
            module_sessions.c.session_id,
            module_sessions.c.module_slug,
            module_sessions.c.completed_at,
            module_sessions.c.started_at,
        ).where(module_sessions.c.user_id == user_id)
    )
    sessions = {row.module_slug: dict(row._mapping) for row in sessions_result}

    # Get heartbeat counts per module/stage
    heartbeat_query = (
        select(
            content_events.c.module_slug,
            content_events.c.stage_index,
            content_events.c.stage_type,
            func.count(content_events.c.event_id).label("heartbeat_count"),
        )
        .where(
            (content_events.c.user_id == user_id)
            & (content_events.c.event_type == ContentEventType.heartbeat)
        )
        .group_by(
            content_events.c.module_slug,
            content_events.c.stage_index,
            content_events.c.stage_type,
        )
    )
    heartbeat_result = await conn.execute(heartbeat_query)

    # Organize by module
    modules_map: dict[str, dict] = {}
    total_time = 0

    for row in heartbeat_result.mappings():
        module_slug = row["module_slug"]
        stage_time = row["heartbeat_count"] * HEARTBEAT_INTERVAL_SECONDS
        total_time += stage_time

        if module_slug not in modules_map:
            session = sessions.get(module_slug, {})
            modules_map[module_slug] = {
                "module_slug": module_slug,
                "completed": session.get("completed_at") is not None,
                "time_spent_seconds": 0,
                "stages": [],
            }

        modules_map[module_slug]["time_spent_seconds"] += stage_time
        modules_map[module_slug]["stages"].append(
            {
                "stage_index": row["stage_index"],
                "stage_type": row["stage_type"].value
                if hasattr(row["stage_type"], "value")
                else row["stage_type"],
                "time_spent_seconds": stage_time,
            }
        )

    # Sort stages within each module
    for module in modules_map.values():
        module["stages"].sort(key=lambda s: s["stage_index"])

    # Get last active
    last_active_result = await conn.execute(
        select(func.max(content_events.c.timestamp)).where(
            content_events.c.user_id == user_id
        )
    )
    last_active = last_active_result.scalar()

    return {
        "modules": list(modules_map.values()),
        "total_time_seconds": total_time,
        "last_active_at": last_active.isoformat() if last_active else None,
    }


async def get_user_chat_sessions(
    conn: AsyncConnection, user_id: int, group_id: int
) -> list[dict[str, Any]]:
    """
    Get chat sessions for a user.

    Returns module_sessions with messages, ordered by most recent.
    """
    result = await conn.execute(
        select(
            module_sessions.c.session_id,
            module_sessions.c.module_slug,
            module_sessions.c.messages,
            module_sessions.c.started_at,
            module_sessions.c.completed_at,
            module_sessions.c.last_active_at,
        )
        .where(module_sessions.c.user_id == user_id)
        .order_by(module_sessions.c.last_active_at.desc())
    )

    sessions = []
    for row in result.mappings():
        # Calculate duration from heartbeats
        duration_result = await conn.execute(
            select(func.count(content_events.c.event_id)).where(
                (content_events.c.session_id == row["session_id"])
                & (content_events.c.stage_type == "chat")
                & (content_events.c.event_type == ContentEventType.heartbeat)
            )
        )
        heartbeat_count = duration_result.scalar() or 0

        sessions.append(
            {
                "session_id": row["session_id"],
                "module_slug": row["module_slug"],
                "messages": row["messages"] or [],
                "started_at": row["started_at"].isoformat()
                if row["started_at"]
                else None,
                "completed_at": row["completed_at"].isoformat()
                if row["completed_at"]
                else None,
                "duration_seconds": heartbeat_count * HEARTBEAT_INTERVAL_SECONDS,
            }
        )

    return sessions
