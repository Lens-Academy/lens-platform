"""
User profile routes.

Endpoints:
- PATCH /api/users/me - Update current user's profile
"""

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update as sql_update

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import get_transaction
from core.nickname_sync import update_nickname_in_discord
from core.tables import users
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])


class UserProfileUpdate(BaseModel):
    """Schema for updating user profile."""

    nickname: str | None = None
    email: str | None = None
    timezone: str | None = None
    availability_utc: str | None = None


@router.patch("/me")
async def update_my_profile(
    updates: UserProfileUpdate,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Update the current user's profile.

    Only allows updating specific fields: first_name, last_name, email, timezone, availability_utc.
    If email is changed, clears email_verified_at.
    """
    discord_id = user["sub"]

    # Build update dict with only non-None values
    update_data: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}

    if updates.nickname is not None:
        update_data["nickname"] = updates.nickname
    if updates.timezone is not None:
        update_data["timezone"] = updates.timezone
    if updates.availability_utc is not None:
        update_data["availability_utc"] = updates.availability_utc

    # Update in database
    async with get_transaction() as conn:
        # If email is being updated, check if it changed and clear verification
        if updates.email is not None:
            current_user = await conn.execute(
                select(users.c.email).where(users.c.discord_id == discord_id)
            )
            current_row = current_user.mappings().first()
            if current_row and current_row["email"] != updates.email:
                update_data["email"] = updates.email
                update_data["email_verified_at"] = None

        result = await conn.execute(
            sql_update(users)
            .where(users.c.discord_id == discord_id)
            .values(**update_data)
            .returning(users)
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(404, "User not found")

    # Sync nickname to Discord if it was updated
    if "nickname" in update_data:
        await update_nickname_in_discord(discord_id, update_data["nickname"])

    return {"status": "updated", "user": dict(row)}
