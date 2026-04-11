"""
Nickname Cog - Syncs display name between web signup and Discord server nickname.

Discord is the source of truth. Database is a cached copy to avoid API rate limits.
"""

import os

import discord
from discord.ext import commands

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_user_nickname, update_user_nickname
from core.discord_outbound import get_or_fetch_member


# Module-level reference to bot, set during cog setup
_bot = None


async def update_nickname_in_discord(discord_id: str, nickname: str | None) -> bool:
    """
    Update user's nickname in the configured Discord server.
    Called by web API via core.nickname_sync wrapper.

    Returns True if nickname was updated successfully.
    """
    if _bot is None or not _bot.is_ready():
        return False

    server_id = os.environ.get("DISCORD_SERVER_ID")
    if not server_id:
        print("Warning: DISCORD_SERVER_ID not set, cannot update nickname")
        return False

    guild = _bot.get_guild(int(server_id))
    if not guild:
        print(f"Warning: Bot is not in guild {server_id}")
        return False

    user_id = int(discord_id)

    try:
        member = await get_or_fetch_member(guild, user_id)
        if not member:
            return False

        await member.edit(nick=nickname)
        return True
    except discord.Forbidden:
        return False
    except discord.HTTPException:
        return False


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

        # Look up user nickname via core function
        nickname = await get_user_nickname(discord_id)

        if not nickname:
            return  # No stored name

        # Apply stored name as nickname
        try:
            await member.edit(nick=nickname)
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

        # Update database to match Discord via core function
        await update_user_nickname(discord_id, new_name)


async def setup(bot):
    global _bot
    _bot = bot

    # Register the callback with core so web API can trigger nickname updates
    from core.nickname_sync import register_nickname_callback

    register_nickname_callback(update_nickname_in_discord)

    await bot.add_cog(NicknameCog(bot))
