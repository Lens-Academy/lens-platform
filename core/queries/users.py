"""User-related database queries using SQLAlchemy Core."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import users


async def get_user_by_discord_id(
    conn: AsyncConnection,
    discord_id: str,
) -> dict[str, Any] | None:
    """Get a user by their Discord ID."""
    result = await conn.execute(
        select(users).where(users.c.discord_id == discord_id)
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def create_user(
    conn: AsyncConnection,
    discord_id: str,
    discord_username: str | None = None,
    email: str | None = None,
    email_verified: bool = False,
) -> dict[str, Any]:
    """Create a new user and return the created record."""
    values = {
        "discord_id": discord_id,
        "discord_username": discord_username or f"User_{discord_id[:8]}",
    }
    if email:
        values["email"] = email
        if email_verified:
            values["email_verified_at"] = datetime.now(timezone.utc)

    result = await conn.execute(insert(users).values(**values).returning(users))
    row = result.mappings().first()
    return dict(row)


async def update_user(
    conn: AsyncConnection,
    discord_id: str,
    **updates: Any,
) -> dict[str, Any] | None:
    """Update a user by Discord ID and return the updated record."""
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await conn.execute(
        update(users)
        .where(users.c.discord_id == discord_id)
        .values(**updates)
        .returning(users)
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def get_or_create_user(
    conn: AsyncConnection,
    discord_id: str,
    discord_username: str | None = None,
    email: str | None = None,
    email_verified: bool = False,
) -> dict[str, Any]:
    """
    Get or create a user by Discord ID.

    If user exists and new fields are provided, updates them.
    When email changes or is newly set with verification, updates email_verified_at.
    """
    existing = await get_user_by_discord_id(conn, discord_id)

    if existing:
        # Check if we need to update
        updates = {}
        if discord_username and discord_username != existing.get("discord_username"):
            updates["discord_username"] = discord_username
        if email and email != existing.get("email"):
            updates["email"] = email
            # Update verification status when email changes from Discord
            if email_verified:
                updates["email_verified_at"] = datetime.now(timezone.utc)
            else:
                updates["email_verified_at"] = None

        if updates:
            return await update_user(conn, discord_id, **updates)
        return existing

    return await create_user(conn, discord_id, discord_username, email, email_verified)
