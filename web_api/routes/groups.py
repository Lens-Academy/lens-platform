"""
Group routes.

Endpoints:
- GET /api/cohorts/{cohort_id}/groups - Get joinable groups (pre-filtered, pre-sorted)
- POST /api/groups/join - Join or switch to a group
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_joinable_groups, join_group, sync_after_group_change
from core.database import get_connection, get_transaction
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api", tags=["groups"])


@router.get("/cohorts/{cohort_id}/groups")
async def get_cohort_groups(
    cohort_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get groups available for joining in a cohort.

    Returns pre-filtered, pre-sorted groups with all display info:
    - Filters out full groups (8+ members)
    - Filters out started groups (unless user already has a group)
    - Sorted by member count (smallest first)
    - Includes badge, is_current, next_meeting_at fields

    Frontend should render these directly without additional processing.
    """
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        user_id = db_user["user_id"] if db_user else None

        groups = await get_joinable_groups(conn, cohort_id, user_id)

    return {"groups": groups}


class JoinGroupRequest(BaseModel):
    """Schema for joining a group."""

    group_id: int


@router.post("/groups/join")
async def join_group_endpoint(
    request: JoinGroupRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Join a group (or switch to a different group).

    Returns the joined group_id and previous_group_id if switching.
    """
    discord_id = user["sub"]

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            result = await join_group(conn, db_user["user_id"], request.group_id)
        except ValueError as e:
            raise HTTPException(400, str(e))

    # Transaction committed - now sync external systems
    # This runs AFTER commit so sync functions can see the changes
    if result.get("success"):
        await sync_after_group_change(
            group_id=result["group_id"],
            previous_group_id=result.get("previous_group_id"),
            user_id=db_user["user_id"],  # Pass user_id for direct join notification
        )

    return {"status": "joined", **result}
