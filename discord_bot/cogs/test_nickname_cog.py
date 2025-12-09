"""
Test Cog - For testing nickname changes.
"""

import discord
from discord import app_commands
from discord.ext import commands


class TestNicknameCog(commands.Cog):
    """Cog for testing nickname functionality."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="test-nickname", description="Test setting a user's nickname")
    @app_commands.checks.has_permissions(administrator=True)
    async def test_nickname(self, interaction: discord.Interaction):
        """Change Cian Dally's nickname to 'nicknameTest'."""
        await interaction.response.defer()

        target_user_id = 1447518945224691772  # VoiceBot1
        new_nickname = "nicknameTest"

        # Fetch the member from the guild (API call, not just cache)
        try:
            member = await interaction.guild.fetch_member(target_user_id)
        except discord.NotFound:
            member = None

        if not member:
            await interaction.followup.send(f"Could not find user with ID {target_user_id} in this server.")
            return

        try:
            old_nick = member.nick or member.display_name
            await member.edit(nick=new_nickname)
            await interaction.followup.send(
                f"Successfully changed {member.name}'s nickname from '{old_nick}' to '{new_nickname}'"
            )
        except discord.Forbidden:
            await interaction.followup.send(
                "I don't have permission to change this user's nickname. "
                "Make sure I have 'Manage Nicknames' permission and my role is higher than theirs."
            )
        except discord.HTTPException as e:
            await interaction.followup.send(f"Failed to change nickname: {e}")


async def setup(bot):
    await bot.add_cog(TestNicknameCog(bot))
