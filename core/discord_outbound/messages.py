# core/discord_outbound/messages.py
import asyncio

from .bot import get_bot, get_dm_semaphore


async def send_dm(discord_id: str, message: str) -> bool:
    """Send a DM to a user. Rate-limited to ~1/second."""
    bot = get_bot()
    if not bot:
        return False
    try:
        semaphore = get_dm_semaphore()
        if semaphore:
            async with semaphore:
                user = await bot.fetch_user(int(discord_id))
                await user.send(message)
                await asyncio.sleep(1)
        else:
            user = await bot.fetch_user(int(discord_id))
            await user.send(message)
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
