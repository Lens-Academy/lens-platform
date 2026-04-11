# core/discord_outbound/messages.py
import asyncio

from .bot import get_bot, get_dm_semaphore


async def send_dm(discord_id: str, message: str) -> str | None:
    """Send a DM to a user. Rate-limited to ~1/second.

    Returns the message ID as string on success, or None on failure.
    """
    bot = get_bot()
    if not bot:
        return None
    try:
        semaphore = get_dm_semaphore()
        if semaphore:
            async with semaphore:
                user = await bot.fetch_user(int(discord_id))
                msg = await user.send(message)
                await asyncio.sleep(1)
        else:
            user = await bot.fetch_user(int(discord_id))
            msg = await user.send(message)
        return str(msg.id)
    except Exception:
        return None


async def edit_dm(discord_id: str, message_id: str, content: str) -> bool:
    """Edit an existing DM message. Returns True on success."""
    bot = get_bot()
    if not bot:
        return False
    try:
        user = await bot.fetch_user(int(discord_id))
        dm_channel = user.dm_channel or await user.create_dm()
        message = await dm_channel.fetch_message(int(message_id))
        await message.edit(content=content)
        return True
    except Exception:
        return False


async def send_channel_message(channel_id: str, message: str) -> str | None:
    """Send a message to a channel. Returns the message ID as string, or None on failure."""
    bot = get_bot()
    if not bot:
        return None
    try:
        channel = await bot.fetch_channel(int(channel_id))
        msg = await channel.send(message)
        return str(msg.id)
    except Exception:
        return None


async def edit_channel_message(channel_id: str, message_id: str, content: str) -> bool:
    """Edit an existing message in a channel. Returns True on success."""
    bot = get_bot()
    if not bot:
        return False
    try:
        channel = await bot.fetch_channel(int(channel_id))
        message = await channel.fetch_message(int(message_id))
        await message.edit(content=content)
        return True
    except Exception:
        return False
