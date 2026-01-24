"""Discord notification delivery channel (DMs and channel messages)."""

import asyncio
import discord
from discord import Client, Guild, Member


# Set by main.py when bot starts
_bot: Client | None = None

# Rate limiting: 1 DM per second to avoid Discord throttling
_dm_semaphore: asyncio.Semaphore | None = None


def set_bot(bot: Client) -> None:
    """Set the Discord bot instance for sending messages."""
    global _bot, _dm_semaphore
    _bot = bot
    _dm_semaphore = asyncio.Semaphore(1)


async def get_or_fetch_member(guild: Guild, discord_id: int) -> Member | None:
    """
    Get a member from cache, falling back to API if not cached.

    Discord.py's get_member() only checks the local cache, which may not
    have all members (especially offline users in large servers). This
    helper tries the cache first (fast, free) and falls back to fetch_member()
    (API call) if needed.

    Args:
        guild: The Discord guild to get the member from
        discord_id: The Discord user ID

    Returns:
        The Member if found, None if not in the server
    """
    member = guild.get_member(discord_id)
    if member:
        return member

    try:
        return await guild.fetch_member(discord_id)
    except discord.NotFound:
        return None


async def send_discord_dm(discord_id: str, message: str) -> bool:
    """
    Send a direct message to a Discord user.

    Rate-limited to ~1 DM/second to avoid Discord throttling.

    Args:
        discord_id: Discord user ID (as string)
        message: Message content

    Returns:
        True if sent successfully, False otherwise
    """
    if not _bot:
        print("Warning: Discord bot not configured for notifications")
        return False

    try:
        # Rate limit DMs
        if _dm_semaphore:
            async with _dm_semaphore:
                user = await _bot.fetch_user(int(discord_id))
                await user.send(message)
                await asyncio.sleep(1)  # 1 second delay between DMs
        else:
            user = await _bot.fetch_user(int(discord_id))
            await user.send(message)

        return True

    except Exception as e:
        print(f"Failed to send DM to {discord_id}: {e}")
        return False


async def send_discord_channel_message(channel_id: str, message: str) -> bool:
    """
    Send a message to a Discord channel.

    No rate limiting needed for channel messages.

    Args:
        channel_id: Discord channel ID (as string)
        message: Message content

    Returns:
        True if sent successfully, False otherwise
    """
    if not _bot:
        print("Warning: Discord bot not configured for notifications")
        return False

    try:
        channel = await _bot.fetch_channel(int(channel_id))
        await channel.send(message)
        return True

    except Exception as e:
        print(f"Failed to send message to channel {channel_id}: {e}")
        return False
