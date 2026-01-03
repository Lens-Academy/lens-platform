"""
User profile routes.

Endpoints:
- PATCH /api/users/me - Update current user's profile
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent))

from core import update_user_profile
from core.nickname_sync import update_nickname_in_discord
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])


class UserProfileUpdate(BaseModel):
    """Schema for updating user profile."""

    nickname: str | None = None
    email: str | None = None
    timezone: str | None = None
    availability_local: str | None = None


@router.patch("/me")
async def update_my_profile(
    updates: UserProfileUpdate,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Update the current user's profile.

    Only allows updating specific fields: nickname, email, timezone, availability_local.
    If email is changed, clears email_verified_at (handled in core).
    """
    discord_id = user["sub"]

    # Update profile via core function (handles email verification clearing)
    updated_user = await update_user_profile(
        discord_id,
        nickname=updates.nickname,
        email=updates.email,
        timezone_str=updates.timezone,
        availability_local=updates.availability_local,
    )

    if not updated_user:
        raise HTTPException(404, "User not found")

    # Sync nickname to Discord if it was updated
    if updates.nickname is not None:
        await update_nickname_in_discord(discord_id, updates.nickname)

    return {"status": "updated", "user": updated_user}
