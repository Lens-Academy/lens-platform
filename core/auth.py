"""Auth code generation for Discord-to-Web flow."""

import secrets

from .database import get_transaction
from .queries.auth import (
    create_auth_code as _create_auth_code,
    validate_auth_code as _validate_auth_code,
)
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


async def create_auth_code(discord_id: str, expires_minutes: int = 5) -> str:
    """
    Create a temporary auth code for a Discord user.

    Args:
        discord_id: The Discord user ID
        expires_minutes: How long the code is valid (default 5 minutes)

    Returns:
        The generated code string (to be sent to user in a link)
    """
    code = secrets.token_urlsafe(32)

    async with get_transaction() as conn:
        # Ensure user exists first (auth_codes.user_id is NOT NULL)
        user, _is_new = await _get_or_create_user(conn, discord_id)

        await _create_auth_code(
            conn,
            user_id=user["user_id"],
            discord_id=discord_id,
            code=code,
            expires_minutes=expires_minutes,
        )

    return code


async def validate_and_use_auth_code(code: str) -> tuple[dict | None, str | None]:
    """
    Validate an auth code and mark it as used.

    Args:
        code: The auth code to validate

    Returns:
        Tuple of (auth_code_record, error_string).
        If valid, returns (record, None).
        If invalid, returns (None, error_string).
    """
    async with get_transaction() as conn:
        return await _validate_auth_code(conn, code)
