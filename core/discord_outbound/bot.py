# core/discord_outbound/bot.py
import asyncio

import discord
from discord import Client, Guild, Member

_bot: Client | None = None
_dm_semaphore: asyncio.Semaphore | None = None


def set_bot(bot: Client) -> None:
    """Set the Discord bot instance. Called by main.py on startup."""
    global _bot, _dm_semaphore
    _bot = bot
    _dm_semaphore = asyncio.Semaphore(1)


def get_bot() -> Client | None:
    """Get the Discord bot instance."""
    return _bot


def get_dm_semaphore() -> asyncio.Semaphore | None:
    """Get the DM rate limit semaphore."""
    return _dm_semaphore


async def get_or_fetch_member(guild: Guild, discord_id: int) -> Member | None:
    """Get member from cache, falling back to API fetch."""
    member = guild.get_member(discord_id)
    if member:
        return member
    try:
        return await guild.fetch_member(discord_id)
    except discord.NotFound:
        return None
