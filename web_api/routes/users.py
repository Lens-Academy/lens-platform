"""
User profile routes.

Endpoints:
- PATCH /api/users/me - Update current user's profile
- GET /api/users/me/facilitator-status - Check if user is a facilitator
- POST /api/users/me/become-facilitator - Add user to facilitators table
- GET /api/users/me/group-info - Get current user's group information
- GET /api/users/me/meetings - Get current user's upcoming meetings
"""

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import update_user_profile, enroll_in_cohort
from core import become_facilitator as core_become_facilitator
from core.database import get_connection, get_transaction
from core.enums import GroupUserStatus
from core.queries.users import get_user_by_discord_id, is_facilitator_by_user_id
from core.nickname_sync import update_nickname_in_discord
from core.tables import groups, groups_users, meetings
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])


class UserProfileUpdate(BaseModel):
    """Schema for updating user profile."""

    nickname: str | None = None
    email: str | None = None
    timezone: str | None = None
    availability_local: str | None = None
    cohort_id: int | None = None
    role: str | None = None  # "participant" or "facilitator" for cohort enrollment
    tos_accepted: bool | None = None
    group_id: int | None = None  # Direct group join (for scheduled cohorts)


@router.patch("/me")
async def update_my_profile(
    updates: UserProfileUpdate,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Update the current user's profile.

    Optionally:
    - Enroll in a cohort (cohort_id + role)
    - Join a group directly (group_id) - uses core.join_group
    """
    from core import join_group

    discord_id = user["sub"]

    # Update profile via core function (handles email verification clearing)
    updated_user = await update_user_profile(
        discord_id,
        nickname=updates.nickname,
        email=updates.email,
        timezone_str=updates.timezone,
        availability_local=updates.availability_local,
        tos_accepted=updates.tos_accepted,
    )

    if not updated_user:
        raise HTTPException(404, "User not found")

    # Sync nickname to Discord if it was updated
    if updates.nickname is not None:
        await update_nickname_in_discord(discord_id, updates.nickname)

    # Enroll in cohort if both cohort_id and role are provided
    enrollment = None
    if updates.cohort_id is not None and updates.role is not None:
        enrollment = await enroll_in_cohort(
            discord_id,
            updates.cohort_id,
            updates.role,
        )

    # Direct group join (delegates to core function)
    group_join = None
    if updates.group_id is not None:
        async with get_transaction() as conn:
            db_user = await get_user_by_discord_id(conn, discord_id)
            if not db_user:
                raise HTTPException(404, "User not found")

            try:
                group_join = await join_group(
                    conn, db_user["user_id"], updates.group_id
                )
            except ValueError as e:
                raise HTTPException(400, str(e))

    return {
        "status": "updated",
        "user": updated_user,
        "enrollment": enrollment,
        "group_join": group_join,
    }


@router.get("/me/facilitator-status")
async def get_facilitator_status(
    user: dict = Depends(get_current_user),
) -> dict[str, bool]:
    """Check if current user is a facilitator."""
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            return {"is_facilitator": False}
        is_fac = await is_facilitator_by_user_id(conn, db_user["user_id"])
        return {"is_facilitator": is_fac}


@router.post("/me/become-facilitator")
async def become_facilitator(
    user: dict = Depends(get_current_user),
) -> dict[str, bool]:
    """Add current user to facilitators table."""
    discord_id = user["sub"]
    success = await core_become_facilitator(discord_id)
    return {"success": success}


@router.get("/me/group-info")
async def get_my_group_info(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get current user's cohort and group information.

    Used by /group page for group management.
    """
    from core import get_user_group_info

    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            return {"is_enrolled": False}

        return await get_user_group_info(conn, db_user["user_id"])


@router.get("/me/meetings")
async def get_my_meetings(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Get current user's upcoming meetings from their active group."""
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        # Find user's active group
        group_result = await conn.execute(
            select(groups_users.c.group_id).where(
                groups_users.c.user_id == db_user["user_id"],
                groups_users.c.status == GroupUserStatus.active,
            )
        )
        group_row = group_result.mappings().first()
        if not group_row:
            return {"meetings": []}

        group_id = group_row["group_id"]

        # Get upcoming meetings with group name
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.meeting_number,
                meetings.c.scheduled_at,
                groups.c.group_name,
            )
            .join(groups, meetings.c.group_id == groups.c.group_id)
            .where(
                meetings.c.group_id == group_id,
                meetings.c.scheduled_at > now,
            )
            .order_by(meetings.c.scheduled_at)
        )
        result = []
        for row in meetings_result.mappings():
            r = dict(row)
            r["scheduled_at"] = r["scheduled_at"].isoformat()
            result.append(r)

        return {"meetings": result}
