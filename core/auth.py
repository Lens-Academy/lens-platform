"""Authentication utilities for user management."""

from .database import get_transaction
from .queries.users import get_or_create_user as _get_or_create_user


async def get_or_create_user(
    discord_id: str,
    discord_username: str | None = None,
    discord_avatar: str | None = None,
    email: str | None = None,
    email_verified: bool = False,
    nickname: str | None = None,
) -> dict:
    """
    Get or create a user by Discord ID.

    If user exists and new fields are provided, updates them.
    If user doesn't exist, creates with provided fields.

    Args:
        discord_id: The Discord user ID
        discord_username: Optional username to set/update (actual Discord username, no spaces)
        discord_avatar: Optional avatar hash from Discord
        email: Optional email to set/update
        email_verified: Whether the email is verified (from Discord)
        nickname: Optional nickname to pre-fill (only set if user has no nickname)

    Returns:
        The user record from the database
    """
    async with get_transaction() as conn:
        user, _is_new = await _get_or_create_user(
            conn,
            discord_id,
            discord_username,
            discord_avatar,
            email,
            email_verified,
            nickname,
        )

    return user
