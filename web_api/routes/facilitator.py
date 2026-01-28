"""
Facilitator panel API routes.

Endpoints:
- GET /api/facilitator/groups - List accessible groups
- GET /api/facilitator/groups/{group_id}/members - List group members with progress
- GET /api/facilitator/groups/{group_id}/users/{user_id}/progress - User progress detail
- GET /api/facilitator/groups/{group_id}/users/{user_id}/chats - User chat sessions
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.queries.facilitator import (
    can_access_group,
    get_accessible_groups,
    is_admin,
)

# TODO: progress.py removed - old progress tracking system deleted
# These functions need to be reimplemented using the new user_content_progress tables:
# from core.queries.progress import (
#     get_group_members_summary,
#     get_user_progress_for_group,
#     get_user_chat_sessions,
# )
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
    """
    List members of a group with progress summary.

    TODO: Reimplement using new user_content_progress tables.
    Old implementation used module_sessions which has been removed.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

    # TODO: Reimplement get_group_members_summary for new progress system
    raise HTTPException(501, "Progress tracking is being migrated to a new system")


@router.get("/groups/{group_id}/users/{target_user_id}/progress")
async def get_user_progress(
    group_id: int,
    target_user_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get detailed progress for a specific user within a group context.

    TODO: Reimplement using new user_content_progress tables.
    Old implementation used module_sessions which has been removed.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

    # TODO: Reimplement get_user_progress_for_group for new progress system
    raise HTTPException(501, "Progress tracking is being migrated to a new system")


@router.get("/groups/{group_id}/users/{target_user_id}/chats")
async def get_user_chats(
    group_id: int,
    target_user_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get chat sessions for a specific user.

    TODO: Reimplement using new chat_sessions table.
    Old implementation used module_sessions which has been removed.
    """
    discord_id = user["sub"]
    db_user = await get_db_user_or_403(discord_id)

    async with get_connection() as conn:
        if not await can_access_group(conn, db_user["user_id"], group_id):
            raise HTTPException(403, "Access denied to this group")

    # TODO: Reimplement get_user_chat_sessions for new chat_sessions table
    raise HTTPException(501, "Chat sessions are being migrated to a new system")
