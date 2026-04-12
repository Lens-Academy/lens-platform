"""Discord cog that handles DM messages via the AI coach agent dispatcher."""

import logging

import discord
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.agents.dispatcher import handle_message, HandleResult
from core.agents.identity import PlatformIdentity

logger = logging.getLogger(__name__)

DISCORD_MAX_LENGTH = 2000


def _should_handle(message: discord.Message) -> bool:
    """Return True if this message should be handled by the coach cog."""
    if message.author.bot:
        return False
    if not isinstance(message.channel, discord.DMChannel):
        return False
    if not message.content.strip():
        return False
    return True


async def _send_in_chunks(channel: discord.abc.Messageable, text: str) -> None:
    """Send a message, splitting into chunks if it exceeds Discord's limit."""
    if len(text) <= DISCORD_MAX_LENGTH:
        await channel.send(text)
        return

    chunks = []
    remaining = text
    while remaining:
        if len(remaining) <= DISCORD_MAX_LENGTH:
            chunks.append(remaining)
            break
        split_at = remaining.rfind("\n", 0, DISCORD_MAX_LENGTH)
        if split_at == -1 or split_at < DISCORD_MAX_LENGTH // 2:
            split_at = DISCORD_MAX_LENGTH
        chunks.append(remaining[:split_at])
        remaining = remaining[split_at:].lstrip("\n")

    for chunk in chunks:
        if chunk.strip():
            await channel.send(chunk)


class CoachCog(commands.Cog):
    """Listens for DM messages and routes them through the AI coach dispatcher."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if not _should_handle(message):
            return

        identity = PlatformIdentity(
            type="discord",
            id=message.author.id,
            platform_name="discord_dm",
        )

        async with message.channel.typing():
            try:
                result: HandleResult = await handle_message(identity, message.content)
            except Exception:
                logger.exception("coach_cog_error", extra={
                    "discord_user_id": message.author.id,
                })
                await message.channel.send(
                    "Sorry, something went wrong on my end. Please try again in a moment."
                )
                return

        await _send_in_chunks(message.channel, result.reply_text)


async def setup(bot: commands.Bot):
    await bot.add_cog(CoachCog(bot))
