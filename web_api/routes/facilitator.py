"""
Facilitator panel API routes.

Endpoints:
- GET /api/facilitator/groups - List accessible groups
- GET /api/facilitator/groups/{group_id}/members - List group members with progress
- GET /api/facilitator/groups/{group_id}/users/{user_id}/progress - User progress detail
- GET /api/facilitator/groups/{group_id}/users/{user_id}/chats - User chat sessions
"""

import json
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.modules.loader import get_available_modules, load_flattened_module
from core.queries.facilitator import (
    can_access_group,
    get_accessible_groups,
    get_group_members_with_progress,
    get_user_all_progress,
    get_user_chat_sessions_for_facilitator,
    is_admin,
    is_user_in_group,
)
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/facilitator", tags=["facilitator"])


async def get_db_user_or_403(discord_id: str):
    """Get database user, raise 403 if not found or not facilitator/admin."""
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(403, "User not found in database")

        # Check if user is admin or facilitator
        from core.queries.facilitator import get_facilitator_group_ids

        admin = await is_admin(conn, db_user["user_id"])
        facilitator_groups = await get_facilitator_group_ids(conn, db_user["user_id"])

        if not admin and not facilitator_groups:
            raise HTTPException(403, "Access denied: not an admin or facilitator")

        return db_user


@router.get("/groups")
async def list_groups(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    List groups accessible to the current user.

    Admins see all groups, facilitators see only their groups.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        groups = await get_accessible_groups(conn, db_user["user_id"])
        admin = await is_admin(conn, db_user["user_id"])

    return {
        "groups": groups,
        "is_admin": admin,
    }


@router.get("/groups/{group_id}/members")
async def list_group_members(
    group_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """List members of a group with progress summary."""
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

        members = await get_group_members_with_progress(conn, group_id)

    return {"members": members}


@router.get("/groups/{group_id}/users/{target_user_id}/progress")
async def get_user_progress(
    group_id: int,
    target_user_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Get detailed progress for a specific user within a group context."""
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

        if not await is_user_in_group(conn, target_user_id, group_id):
            raise HTTPException(404, "User not found in this group")

        progress_rows = await get_user_all_progress(conn, target_user_id)

    # Build content_id -> progress map
    progress_map: dict[str, dict] = {}
    for row in progress_rows:
        cid = str(row["content_id"])
        progress_map[cid] = row

    # Build per-module progress
    module_slugs = get_available_modules()
    modules_out = []
    overall_time = 0
    overall_last_active = None

    for slug in module_slugs:
        try:
            module = load_flattened_module(slug)
        except Exception:
            continue

        sections_out = []
        completed_count = 0
        total_count = 0
        module_time = 0

        for section in module.sections:
            content_id_str = section.get("contentId")
            title = (
                section.get("meta", {}).get("title")
                or section.get("title")
                or "Untitled"
            )
            section_type = section.get("type", "page")
            is_optional = section.get("optional", False)

            completed = False
            time_spent = 0

            if content_id_str and content_id_str in progress_map:
                prog = progress_map[content_id_str]
                completed = prog.get("completed_at") is not None
                time_spent = prog.get("total_time_spent_s", 0)

            sections_out.append(
                {
                    "content_id": content_id_str,
                    "title": title,
                    "type": section_type,
                    "completed": completed,
                    "time_spent_seconds": time_spent,
                }
            )

            if not is_optional:
                total_count += 1
                if completed:
                    completed_count += 1

            module_time += time_spent

        # Determine module status
        if completed_count == 0:
            status = "not_started"
        elif completed_count >= total_count:
            status = "completed"
        else:
            status = "in_progress"

        modules_out.append(
            {
                "slug": slug,
                "title": module.title,
                "status": status,
                "completed_count": completed_count,
                "total_count": total_count,
                "time_spent_seconds": module_time,
                "sections": sections_out,
            }
        )
        overall_time += module_time

    # Find the overall last_active_at from progress rows
    for row in progress_rows:
        started = row.get("started_at")
        if started is not None:
            if overall_last_active is None or started > overall_last_active:
                overall_last_active = started

    return {
        "modules": modules_out,
        "total_time_seconds": overall_time,
        "last_active_at": (
            overall_last_active.isoformat() if overall_last_active else None
        ),
    }


@router.get("/groups/{group_id}/users/{target_user_id}/chats")
async def get_user_chats(
    group_id: int,
    target_user_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Get chat sessions for a specific user."""
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

        if not await is_user_in_group(conn, target_user_id, group_id):
            raise HTTPException(404, "User not found in this group")

        sessions = await get_user_chat_sessions_for_facilitator(conn, target_user_id)

    # Build content_id -> module info map from content cache
    content_to_module: dict[str, dict[str, str]] = {}
    for slug in get_available_modules():
        try:
            module = load_flattened_module(slug)
        except Exception:
            continue
        # Map module-level content_id
        if module.content_id:
            content_to_module[str(module.content_id)] = {
                "slug": slug,
                "title": module.title,
            }
        # Map section-level content_ids
        for section in module.sections:
            cid = section.get("contentId")
            if cid:
                content_to_module[cid] = {"slug": slug, "title": module.title}

    chats_out = []
    for session in sessions:
        content_id = session.get("content_id")
        content_id_str = str(content_id) if content_id else None
        module_info = (
            content_to_module.get(content_id_str or "") if content_id_str else None
        )

        started_at = session.get("started_at")
        last_active = session.get("last_active_at")
        archived_at = session.get("archived_at")

        chats_out.append(
            {
                "session_id": session["session_id"],
                "content_id": content_id_str,
                "module_slug": module_info["slug"] if module_info else None,
                "module_title": module_info["title"] if module_info else None,
                "messages": json.loads(session["messages"])
                if isinstance(session.get("messages"), str)
                else session.get("messages", []),
                "started_at": started_at.isoformat() if started_at else None,
                "last_active_at": last_active.isoformat() if last_active else None,
                "is_archived": archived_at is not None,
            }
        )

    return {"chats": chats_out}
