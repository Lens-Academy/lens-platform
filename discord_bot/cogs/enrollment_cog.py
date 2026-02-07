"""
Enrollment Cog - Discord adapter for user profile management.
"""

import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import (
    get_user_profile,
    toggle_facilitator,
)


class EnrollmentCog(commands.Cog):
    """Cog for user enrollment and profile management."""

    def __init__(self, bot):
        self.bot = bot

    # TODO: Probably remove this command. I think it is an old trial that presumes facilitator privileges are set within the Discord guild, instead of in our DB.
    @app_commands.command(
        name="toggle-facilitator", description="Toggle your facilitator status"
    )
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    async def toggle_facilitator_cmd(self, interaction: discord.Interaction):
        """Toggle whether you are marked as a facilitator."""
        user_id = str(interaction.user.id)
        user_data = await get_user_profile(user_id)

        if not user_data:
            await interaction.response.send_message(
                "You haven't signed up yet! Use `/signup` first.", ephemeral=True
            )
            return

        await interaction.response.defer(ephemeral=True)

        # Use core function to toggle (now async)
        new_status = await toggle_facilitator(user_id)

        role_message = ""
        if interaction.guild:
            facilitator_role = discord.utils.get(
                interaction.guild.roles, name="Facilitator"
            )

            if not facilitator_role:
                try:
                    facilitator_role = await interaction.guild.create_role(
                        name="Facilitator",
                        color=discord.Color.gold(),
                        reason="Created by scheduler bot",
                    )
                    role_message = "\n(Created Facilitator role)"
                except discord.Forbidden:
                    role_message = (
                        "\n(Couldn't create/assign role - missing permissions)"
                    )
                    facilitator_role = None

            if facilitator_role:
                try:
                    if new_status:
                        await interaction.user.add_roles(facilitator_role)
                        role_message = "\nFacilitator role added"
                    else:
                        await interaction.user.remove_roles(facilitator_role)
                        role_message = "\nFacilitator role removed"
                except discord.Forbidden:
                    role_message = "\n(Couldn't assign role - missing permissions)"

        status_str = "Facilitator" if new_status else "Not a facilitator"
        await interaction.followup.send(
            f"Your status has been updated: **{status_str}**{role_message}"
        )


async def setup(bot):
    await bot.add_cog(EnrollmentCog(bot))
