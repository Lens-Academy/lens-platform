"""
Groups Cog - Discord adapter for realizing groups from database.
Creates Discord channels, scheduled events, and welcome messages.
"""

import logging
import sys
from pathlib import Path

import discord
from discord import app_commands
from discord.ext import commands

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.queries.cohorts import get_realizable_cohorts
from core.queries.groups import (
    get_cohort_groups_for_realization,
    get_realized_groups_for_discord_user,
)
from core.sync import sync_group, sync_group_discord_permissions

logger = logging.getLogger(__name__)


class GroupsCog(commands.Cog):
    """Cog for realizing groups in Discord from database."""

    def __init__(self, bot):
        self.bot = bot

    async def cohort_autocomplete(
        self,
        interaction: discord.Interaction,
        current: str,
    ) -> list[app_commands.Choice[int]]:
        """Autocomplete for cohorts with unrealized groups."""
        async with get_connection() as conn:
            cohorts = await get_realizable_cohorts(conn)

        choices = []
        for cohort in cohorts[:25]:
            display_name = f"{cohort['cohort_name']} - {cohort['course_name']}"
            if current.lower() in display_name.lower():
                choices.append(
                    app_commands.Choice(
                        name=display_name[:100], value=cohort["cohort_id"]
                    )
                )

        return choices[:25]

    @app_commands.command(
        name="realize-cohort",
        description="Create Discord channels for a cohort's groups",
    )
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    @app_commands.describe(cohort="The cohort to create Discord channels for")
    @app_commands.autocomplete(cohort=cohort_autocomplete)
    async def realize_cohort(
        self,
        interaction: discord.Interaction,
        cohort: int,
    ):
        """Create Discord category, channels, events, and welcome messages for cohort groups."""
        await interaction.response.defer()

        progress_msg = await interaction.followup.send(
            "Loading cohort data...", ephemeral=False
        )

        # Get cohort groups data
        async with get_connection() as conn:
            cohort_data = await get_cohort_groups_for_realization(conn, cohort)

        if not cohort_data:
            await progress_msg.edit(content="Cohort not found!")
            return

        if not cohort_data["groups"]:
            await progress_msg.edit(
                content="No groups found for this cohort. Run /schedule first."
            )
            return

        # Process each preview group
        created_count = 0
        failed_count = 0
        results = []

        for group_data in cohort_data["groups"]:
            if group_data.get("status") != "preview":
                continue

            group_name = group_data["group_name"]
            group_id = group_data["group_id"]

            await progress_msg.edit(content=f"Processing {group_name}...")

            try:
                result = await sync_group(group_id, allow_create=True)
                results.append({"group": group_name, "result": result})

                if result.get("error") or result.get("needs_infrastructure"):
                    failed_count += 1
                else:
                    created_count += 1
            except Exception as e:
                logger.error(f"Failed to realize group {group_id}: {e}")
                failed_count += 1
                results.append({"group": group_name, "error": str(e)})

        # Summary
        color = discord.Color.green() if failed_count == 0 else discord.Color.orange()
        embed = discord.Embed(
            title=f"Cohort Realized: {cohort_data['cohort_name']}",
            color=color,
        )
        summary = f"**Groups processed:** {created_count + failed_count}\n**Successful:** {created_count}"
        if failed_count > 0:
            summary += f"\n**Failed:** {failed_count}"
        embed.add_field(name="Summary", value=summary, inline=False)
        embed.set_footer(
            text="Members not in the guild will get access automatically when they join."
        )

        await progress_msg.edit(content=None, embed=embed)

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        """
        Grant channel permissions when a user joins the guild.

        If the user is in any realized groups (groups with Discord channels),
        automatically grant them access to those channels via sync.
        """
        # Check if this user has any realized groups
        async with get_connection() as conn:
            user_groups = await get_realized_groups_for_discord_user(
                conn, str(member.id)
            )

        if not user_groups:
            return

        # Sync permissions for each group (will grant access to this user)
        granted_groups = []
        for group in user_groups:
            try:
                result = await sync_group_discord_permissions(group["group_id"])

                if result.get("granted", 0) > 0:
                    granted_groups.append(group["group_name"])

                    # Send welcome message to the text channel
                    text_channel = member.guild.get_channel(
                        int(group["discord_text_channel_id"])
                    )
                    if text_channel:
                        await text_channel.send(
                            f"Welcome {member.mention}! You now have access to this group channel."
                        )

            except Exception as e:
                logger.error(
                    f"Failed to sync group {group['group_id']} for {member}: {e}"
                )

        if granted_groups:
            logger.info(
                f"Granted {member} access to groups: {', '.join(granted_groups)}"
            )


async def setup(bot):
    await bot.add_cog(GroupsCog(bot))
