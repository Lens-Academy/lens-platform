"""
Nickname synchronization - database operations.

Discord-specific sync (update_nickname_in_discord) stays in nickname_cog.py
since it needs bot access.
"""

from .database import get_connection, get_transaction
from .tables import users
from sqlalchemy import select, update as sql_update


async def get_user_nickname(discord_id: str) -> str | None:
    """
    Get a user's nickname from the database.

    Args:
        discord_id: Discord user ID

    Returns:
        Nickname string or None if not found/not set
    """
    async with get_connection() as conn:
        result = await conn.execute(
            select(users.c.nickname).where(users.c.discord_id == discord_id)
        )
        row = result.mappings().first()

    if not row:
        return None
    return row["nickname"]


async def update_user_nickname(discord_id: str, nickname: str) -> bool:
    """
    Update a user's nickname in the database.

    Args:
        discord_id: Discord user ID
        nickname: New nickname value

    Returns:
        True if user was found and updated, False otherwise
    """
    async with get_transaction() as conn:
        result = await conn.execute(
            sql_update(users)
            .where(users.c.discord_id == discord_id)
            .values(nickname=nickname)
        )
    return result.rowcount > 0
