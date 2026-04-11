"""Attendance tracking cog — records voice channel joins as meeting attendance."""

import logging
import sys
from pathlib import Path

import discord
from discord.ext import commands

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import record_voice_attendance

logger = logging.getLogger(__name__)


class AttendanceCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.Cog.listener()
    async def on_voice_state_update(
        self,
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState,
    ):
        """Track voice channel joins for attendance."""
        # Ignore bots
        if member.bot:
            return

        # Only care about channel joins (not leaves, mutes, or same-channel changes)
        if after.channel is None or after.channel == before.channel:
            return

        try:
            result = await record_voice_attendance(
                discord_id=str(member.id),
                voice_channel_id=str(after.channel.id),
            )

            if result and result.get("recorded"):
                await after.channel.send(
                    f"**{member.display_name}** joined the meeting. Attendance recorded."
                )
        except Exception:
            logger.exception(
                f"Error recording attendance for {member.id} in {after.channel.id}"
            )


async def setup(bot):
    await bot.add_cog(AttendanceCog(bot))
