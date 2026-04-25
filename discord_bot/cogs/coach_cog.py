"""Discord cog that handles DM messages via the AI coach agent dispatcher."""

import logging

import discord
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.agents.dispatcher import handle_message, HandleResult
from core.agents.identity import PlatformIdentity
from core.speech import transcribe_audio

logger = logging.getLogger(__name__)

DISCORD_MAX_LENGTH = 2000
AUDIO_CONTENT_TYPES = {"audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"}


def _get_voice_attachment(message: discord.Message) -> discord.Attachment | None:
    """Return the first audio attachment if present, else None."""
    for attachment in message.attachments:
        if attachment.content_type and attachment.content_type.split(";")[0] in AUDIO_CONTENT_TYPES:
            return attachment
    return None


def _should_handle(message: discord.Message) -> bool:
    """Return True if this message should be handled by the coach cog."""
    if message.author.bot:
        return False
    if not isinstance(message.channel, discord.DMChannel):
        return False
    if not message.content.strip() and not _get_voice_attachment(message):
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
                # Transcribe voice messages to text
                voice = _get_voice_attachment(message)
                if voice:
                    audio_bytes = await voice.read()
                    text = await transcribe_audio(audio_bytes, voice.filename or "voice.ogg")
                    if message.content.strip():
                        text = message.content.strip() + "\n\n" + text
                else:
                    text = message.content

                result: HandleResult = await handle_message(identity, text)
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
