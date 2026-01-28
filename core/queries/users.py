"""User-related database queries using SQLAlchemy Core."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..enums import GroupUserStatus
from ..tables import cohorts, facilitators, groups, groups_users, signups, users


async def get_user_by_discord_id(
    conn: AsyncConnection,
    discord_id: str,
) -> dict[str, Any] | None:
    """Get a user by their Discord ID."""
    result = await conn.execute(select(users).where(users.c.discord_id == discord_id))
    row = result.mappings().first()
    return dict(row) if row else None


async def create_user(
    conn: AsyncConnection,
    discord_id: str,
    discord_username: str | None = None,
    discord_avatar: str | None = None,
    email: str | None = None,
    email_verified: bool = False,
) -> dict[str, Any]:
    """Create a new user and return the created record."""
    values = {
        "discord_id": discord_id,
        "discord_username": discord_username or f"User_{discord_id[:8]}",
    }
    if discord_avatar:
        values["discord_avatar"] = discord_avatar
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
    discord_avatar: str | None = None,
    email: str | None = None,
    email_verified: bool = False,
    nickname: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """
    Get or create a user by Discord ID.

    If user exists and new fields are provided, updates them.
    When email changes or is newly set with verification, updates email_verified_at.
    Nickname is only set if the user doesn't already have one (won't overwrite user choice).

    Returns:
        Tuple of (user_dict, is_new_user)
    """
    existing = await get_user_by_discord_id(conn, discord_id)

    if existing:
        # Check if we need to update
        updates = {}
        if discord_username and discord_username != existing.get("discord_username"):
            updates["discord_username"] = discord_username
        if discord_avatar and discord_avatar != existing.get("discord_avatar"):
            updates["discord_avatar"] = discord_avatar
        if email and email != existing.get("email"):
            updates["email"] = email
            # Update verification status when email changes from Discord
            if email_verified:
                updates["email_verified_at"] = datetime.now(timezone.utc)
            else:
                updates["email_verified_at"] = None
        # Only set nickname if user doesn't have one (don't overwrite user choice)
        if nickname and not existing.get("nickname"):
            updates["nickname"] = nickname

        if updates:
            return await update_user(conn, discord_id, **updates), False
        return existing, False

    new_user = await create_user(
        conn, discord_id, discord_username, discord_avatar, email, email_verified
    )
    # Set nickname for new user if provided
    if nickname:
        new_user = await update_user(conn, discord_id, nickname=nickname)
    return new_user, True


async def get_user_profile(
    conn: AsyncConnection,
    discord_id: str,
) -> dict[str, Any] | None:
    """
    Get a user's full profile by Discord ID.

    Returns user data as a dict, or None if not found.
    """
    return await get_user_by_discord_id(conn, discord_id)


async def save_user_profile(
    conn: AsyncConnection,
    discord_id: str,
    **fields: Any,
) -> dict[str, Any]:
    """
    Save or update a user's profile.

    Creates user if they don't exist, otherwise updates.
    Supported fields: nickname, timezone, availability_local, if_needed_availability_local

    Automatically sets availability_last_updated_at when availability or timezone fields change.
    """
    existing = await get_user_by_discord_id(conn, discord_id)

    if existing:
        # Filter to only valid user columns
        valid_fields = {
            k: v
            for k, v in fields.items()
            if k
            in (
                "nickname",
                "timezone",
                "availability_local",
                "if_needed_availability_local",
                "email",
                "discord_username",
            )
        }
        # Set availability_last_updated_at if availability or timezone fields are being updated
        # (timezone changes affect when user is available in absolute terms)
        if any(
            k in valid_fields
            for k in ("availability_local", "if_needed_availability_local", "timezone")
        ):
            valid_fields["availability_last_updated_at"] = datetime.now(timezone.utc)
        if valid_fields:
            return await update_user(conn, discord_id, **valid_fields)
        return existing

    # Create new user with provided fields
    return await create_user(
        conn,
        discord_id,
        discord_username=fields.get("discord_username"),
        email=fields.get("email"),
    )


async def get_all_users_with_availability(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get all users who have set availability.

    Returns list of user dicts where availability_local or if_needed_availability_local is set.
    """
    result = await conn.execute(
        select(users).where(
            (users.c.availability_local.isnot(None))
            | (users.c.if_needed_availability_local.isnot(None))
        )
    )
    return [dict(row) for row in result.mappings()]


async def get_users_by_discord_ids(
    conn: AsyncConnection,
    discord_ids: list[str],
) -> list[dict[str, Any]]:
    """
    Get multiple users by their Discord IDs.

    Returns list of user dicts for found users.
    """
    if not discord_ids:
        return []

    result = await conn.execute(
        select(users).where(users.c.discord_id.in_(discord_ids))
    )
    return [dict(row) for row in result.mappings()]


async def get_facilitators(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get all users who are facilitators.

    Returns list of user dicts with facilitator info joined.
    """
    result = await conn.execute(
        select(users, facilitators.c.facilitator_id, facilitators.c.max_active_groups)
        .join(facilitators, users.c.user_id == facilitators.c.user_id)
        .where(facilitators.c.facilitator_id.isnot(None))
    )
    return [dict(row) for row in result.mappings()]


async def is_facilitator(
    conn: AsyncConnection,
    discord_id: str,
) -> bool:
    """Check if a user is a facilitator by discord_id."""
    user = await get_user_by_discord_id(conn, discord_id)
    if not user:
        return False

    result = await conn.execute(
        select(facilitators).where(facilitators.c.user_id == user["user_id"])
    )
    return result.first() is not None


async def is_facilitator_by_user_id(
    conn: AsyncConnection,
    user_id: int,
) -> bool:
    """Check if a user is a facilitator by user_id."""
    result = await conn.execute(
        select(facilitators).where(facilitators.c.user_id == user_id)
    )
    return result.first() is not None


async def toggle_facilitator(
    conn: AsyncConnection,
    discord_id: str,
) -> bool:
    """
    Toggle a user's facilitator status.

    Returns the new facilitator status (True if now a facilitator, False if removed).
    Returns False if user doesn't exist.
    """
    user = await get_user_by_discord_id(conn, discord_id)
    if not user:
        return False

    user_id = user["user_id"]

    # Check if already a facilitator
    result = await conn.execute(
        select(facilitators).where(facilitators.c.user_id == user_id)
    )
    existing = result.first()

    if existing:
        # Remove facilitator status
        await conn.execute(
            delete(facilitators).where(facilitators.c.user_id == user_id)
        )
        return False
    else:
        # Add facilitator status
        await conn.execute(insert(facilitators).values(user_id=user_id))
        return True


async def search_users(
    conn: AsyncConnection,
    query: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """
    Search users by nickname or discord_username.

    Args:
        conn: Database connection
        query: Search string (case-insensitive substring match)
        limit: Maximum results to return

    Returns:
        List of user dicts with user_id, discord_id, nickname, discord_username
    """
    search_pattern = f"%{query}%"

    result = await conn.execute(
        select(
            users.c.user_id,
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
        )
        .where(
            (users.c.nickname.ilike(search_pattern))
            | (users.c.discord_username.ilike(search_pattern))
        )
        .order_by(users.c.nickname, users.c.discord_username)
        .limit(limit)
    )

    return [dict(row) for row in result.mappings()]


async def get_user_enrollment_status(
    conn: AsyncConnection,
    user_id: int,
) -> dict[str, bool]:
    """
    Get a user's enrollment status in the platform.

    Args:
        conn: Database connection
        user_id: User's database ID

    Returns:
        Dict with:
        - is_in_signups_table: True if user has any signup (enrolled in any cohort)
        - is_in_active_group: True if user is in an active group (groups_users with status='active')
    """
    # Check if user has any signup
    signup_exists = await conn.execute(
        select(signups.c.signup_id).where(signups.c.user_id == user_id).limit(1)
    )
    is_in_signups_table = signup_exists.first() is not None

    # Check if user is in an active group
    active_group_exists = await conn.execute(
        select(groups_users.c.group_user_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .limit(1)
    )
    is_in_active_group = active_group_exists.first() is not None

    return {
        "is_in_signups_table": is_in_signups_table,
        "is_in_active_group": is_in_active_group,
    }


async def get_user_admin_details(
    conn: AsyncConnection,
    user_id: int,
) -> dict[str, Any] | None:
    """
    Get user details for admin panel, including current group membership.

    Returns:
        Dict with user info plus group_id, group_name, cohort_id, cohort_name, group_status
        or None if user not found
    """
    result = await conn.execute(
        select(
            users.c.user_id,
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
            users.c.email,
            groups.c.group_id,
            groups.c.group_name,
            groups.c.status.label("group_status"),
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
        )
        .outerjoin(
            groups_users,
            (users.c.user_id == groups_users.c.user_id)
            & (groups_users.c.status == GroupUserStatus.active),
        )
        .outerjoin(groups, groups_users.c.group_id == groups.c.group_id)
        .outerjoin(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        .where(users.c.user_id == user_id)
    )

    row = result.mappings().first()
    return dict(row) if row else None
