"""
User profile routes.

Endpoints:
- PATCH /api/users/me - Update current user's profile
- GET /api/users/me/facilitator-status - Check if user is a facilitator
- POST /api/users/me/become-facilitator - Add user to facilitators table
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import update_user_profile, enroll_in_cohort
from core import become_facilitator as core_become_facilitator
from core.database import get_connection
from core.queries.users import get_user_by_discord_id, is_facilitator_by_user_id
from core.nickname_sync import update_nickname_in_discord
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


@router.patch("/me")
async def update_my_profile(
    updates: UserProfileUpdate,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Update the current user's profile.

    Only allows updating specific fields: nickname, email, timezone, availability_local.
    If email is changed, clears email_verified_at (handled in core).
    Optionally enroll in a cohort if cohort_id and role provided.
    """
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

    return {"status": "updated", "user": updated_user, "enrollment": enrollment}


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
