"""
User profile management.

All functions are async and use the database.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any

from .database import get_connection, get_transaction
from .queries import users as user_queries
from .tables import users as users_table
from sqlalchemy import select, update as sql_update


async def get_user_profile(discord_id: str) -> dict[str, Any] | None:
    """
    Get a user's full profile.

    Args:
        discord_id: Discord user ID

    Returns:
        User profile dict or None if not found
    """
    async with get_connection() as conn:
        return await user_queries.get_user_profile(conn, discord_id)


async def save_user_profile(
    discord_id: str,
    nickname: str | None = None,
    timezone_str: str | None = None,
    availability_local: str | None = None,
    if_needed_availability_local: str | None = None,
) -> dict[str, Any]:
    """
    Save or update a user's profile (create or upsert).

    Args:
        discord_id: Discord user ID
        nickname: Display name
        timezone_str: Timezone string (e.g., "America/New_York")
        availability_local: JSON string of day -> list of time slots (in user's local timezone)
        if_needed_availability_local: JSON string of if-needed slots (in user's local timezone)

    Returns:
        Updated user profile
    """
    fields = {}
    if nickname is not None:
        fields["nickname"] = nickname
    if timezone_str is not None:
        fields["timezone"] = timezone_str
    if availability_local is not None:
        fields["availability_local"] = availability_local
    if if_needed_availability_local is not None:
        fields["if_needed_availability_local"] = if_needed_availability_local

    async with get_transaction() as conn:
        return await user_queries.save_user_profile(conn, discord_id, **fields)


async def update_user_profile(
    discord_id: str,
    nickname: str | None = None,
    email: str | None = None,
    timezone_str: str | None = None,
    availability_local: str | None = None,
    tos_accepted: bool | None = None,
) -> dict[str, Any] | None:
    """
    Update a user's profile with email verification handling.

    If email changes, clears email_verified_at.
    If availability or timezone changes, sets availability_last_updated_at.

    Args:
        discord_id: Discord user ID
        nickname: Display name
        email: Email address (clears verification if changed)
        timezone_str: Timezone string
        availability_local: JSON string of day -> list of time slots (in user's local timezone)
        tos_accepted: If True, sets tos_accepted_at to current time (only if not already set)

    Returns:
        Updated user profile dict or None if user not found
    """
    update_data: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}

    if nickname is not None:
        update_data["nickname"] = nickname
    if timezone_str is not None:
        update_data["timezone"] = timezone_str
        # Timezone changes affect when user is available in absolute terms
        update_data["availability_last_updated_at"] = datetime.now(timezone.utc)
    if availability_local is not None:
        update_data["availability_local"] = availability_local
        update_data["availability_last_updated_at"] = datetime.now(timezone.utc)
    if tos_accepted:
        update_data["tos_accepted_at"] = datetime.now(timezone.utc)

    async with get_transaction() as conn:
        # If email is being updated, check if it changed and clear verification
        if email is not None:
            current_user = await conn.execute(
                select(users_table.c.email).where(users_table.c.discord_id == discord_id)
            )
            current_row = current_user.mappings().first()
            if current_row and current_row["email"] != email:
                update_data["email"] = email
                update_data["email_verified_at"] = None

        result = await conn.execute(
            sql_update(users_table)
            .where(users_table.c.discord_id == discord_id)
            .values(**update_data)
            .returning(users_table)
        )
        row = result.mappings().first()

    return dict(row) if row else None


async def get_users_with_availability() -> list[dict[str, Any]]:
    """
    Get all users who have set availability.

    Returns:
        List of user dicts for users with availability
    """
    async with get_connection() as conn:
        return await user_queries.get_all_users_with_availability(conn)


async def get_facilitators() -> list[dict[str, Any]]:
    """
    Get all users marked as facilitators.

    Returns:
        List of user dicts for facilitators
    """
    async with get_connection() as conn:
        return await user_queries.get_facilitators(conn)


async def toggle_facilitator(discord_id: str) -> bool:
    """
    Toggle a user's facilitator status.

    Args:
        discord_id: Discord user ID

    Returns:
        New facilitator status (True/False), or False if user doesn't exist
    """
    async with get_transaction() as conn:
        return await user_queries.toggle_facilitator(conn, discord_id)


async def is_facilitator(discord_id: str) -> bool:
    """
    Check if a user is a facilitator.

    Args:
        discord_id: Discord user ID

    Returns:
        True if user is a facilitator, False otherwise
    """
    async with get_connection() as conn:
        return await user_queries.is_facilitator(conn, discord_id)


async def become_facilitator(discord_id: str) -> bool:
    """
    Add a user to the facilitators table.

    Args:
        discord_id: Discord user ID

    Returns:
        True if successful or already a facilitator.
        False if user doesn't exist.
    """
    from .tables import facilitators
    from sqlalchemy import insert

    async with get_transaction() as conn:
        user = await user_queries.get_user_by_discord_id(conn, discord_id)
        if not user:
            return False

        # Check if already a facilitator
        if await user_queries.is_facilitator_by_user_id(conn, user["user_id"]):
            return True

        # Add to facilitators table
        await conn.execute(
            insert(facilitators).values(user_id=user["user_id"])
        )
        return True


async def enroll_in_cohort(
    discord_id: str,
    cohort_id: int,
    role: str,
) -> dict[str, Any] | None:
    """
    Enroll a user in a cohort by creating a signup.

    Args:
        discord_id: User's Discord ID
        cohort_id: Cohort to enroll in
        role: "participant" or "facilitator"

    Returns:
        The created signup record (with enums converted to strings), or None if user/cohort not found.
    """
    from .queries.cohorts import get_cohort_by_id
    from .tables import signups
    from .enums import CohortRole
    from sqlalchemy import insert

    async with get_transaction() as conn:
        user = await user_queries.get_user_by_discord_id(conn, discord_id)
        if not user:
            return None

        cohort = await get_cohort_by_id(conn, cohort_id)
        if not cohort:
            return None

        role_enum = CohortRole.facilitator if role == "facilitator" else CohortRole.participant

        result = await conn.execute(
            insert(signups)
            .values(
                user_id=user["user_id"],
                cohort_id=cohort_id,
                role=role_enum,
            )
            .returning(signups)
        )
        row = result.mappings().first()
        signup = dict(row)
        # Convert enums to strings for JSON serialization
        signup["role"] = signup["role"].value

    # Send welcome notification (fire and forget)
    asyncio.create_task(_send_welcome_notification(user["user_id"]))

    return signup


async def _send_welcome_notification(user_id: int) -> None:
    """Send welcome notification, logging any errors."""
    try:
        from .notifications import notify_welcome
        await notify_welcome(user_id)
    except Exception as e:
        print(f"[Notifications] Failed to send welcome notification to user {user_id}: {e}")
