"""
Nickname Cog - Syncs display name between web signup and Discord server nickname.

Discord is the source of truth. Database is a cached copy to avoid API rate limits.
"""

import discord
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.tables import users
from sqlalchemy import select, update as sql_update


# Module-level reference to bot, set during cog setup
_bot = None


async def update_nickname_in_discord(discord_id: str, nickname: str | None) -> bool:
    """
    Update user's nickname in Discord server(s) if they're a member.
    Called by web API via core.nickname_sync wrapper.

    Returns True if nickname was updated in at least one guild.
    """
    if _bot is None or not _bot.is_ready():
        return False

    user_id = int(discord_id)
    updated = False

    for guild in _bot.guilds:
        try:
            member = guild.get_member(user_id)
            if not member:
                try:
                    member = await guild.fetch_member(user_id)
                except discord.NotFound:
                    continue

            await member.edit(nick=nickname)
            updated = True
        except discord.Forbidden:
            pass
        except discord.HTTPException:
            pass

    return updated


class NicknameCog(commands.Cog):
    """Cog for syncing nicknames between web signup and Discord."""

    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        """Apply stored display name when user joins (if they have no nickname set)."""
        if member.nick:
            return  # User already has a nickname, don't override

        discord_id = str(member.id)

        # Look up user in database
        async with get_connection() as conn:
            result = await conn.execute(
                select(users.c.nickname).where(users.c.discord_id == discord_id)
            )
            row = result.mappings().first()

        if not row or not row["nickname"]:
            return  # No stored name

        # Apply stored name as nickname
        try:
            await member.edit(nick=row["nickname"])
        except discord.Forbidden:
            pass  # Silently fail if we can't set nickname

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        """Sync nickname changes from Discord to database."""
        # Only care about nickname changes
        if before.nick == after.nick:
            return

        discord_id = str(after.id)
        # If nickname deleted, fall back to Discord username
        new_name = after.nick if after.nick else after.name

        # Update database to match Discord
        async with get_connection() as conn:
            await conn.execute(
                sql_update(users)
                .where(users.c.discord_id == discord_id)
                .values(nickname=new_name)
            )
            await conn.commit()


async def setup(bot):
    global _bot
    _bot = bot
    await bot.add_cog(NicknameCog(bot))
