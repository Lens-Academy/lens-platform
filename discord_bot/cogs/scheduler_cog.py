"""
Scheduler Cog - Discord adapter for the scheduling algorithm.
"""

import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import (
    schedule_cohort,
)
from core.database import get_connection
from core.queries.cohorts import get_schedulable_cohorts


class SchedulerCog(commands.Cog):
    """Cog for cohort scheduling functionality."""

    def __init__(self, bot):
        self.bot = bot

    async def cohort_autocomplete(
        self,
        interaction: discord.Interaction,
        current: str,
    ) -> list[app_commands.Choice[int]]:
        """Autocomplete for cohorts with users awaiting grouping."""
        async with get_connection() as conn:
            cohorts = await get_schedulable_cohorts(conn)

        choices = []
        for cohort in cohorts[:25]:  # Discord limit
            display_name = (
                f"{cohort['cohort_name']} ({cohort['pending_users']} pending)"
            )
            if current.lower() in display_name.lower():
                choices.append(
                    app_commands.Choice(
                        name=display_name[:100], value=cohort["cohort_id"]
                    )
                )

        return choices[:25]

    @app_commands.command(name="schedule", description="Run scheduling for a cohort")
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    @app_commands.describe(
        cohort="The cohort to schedule",
        meeting_length="Meeting length in minutes (default: 60)",
        min_people="Minimum people per group (default: 4)",
        max_people="Maximum people per group (default: 8)",
        iterations="Number of iterations to run (default: 1000)",
        balance="Balance group sizes after scheduling (default: True)",
        use_if_needed="Include 'if needed' times in scheduling (default: True)",
    )
    @app_commands.autocomplete(cohort=cohort_autocomplete)
    async def schedule(
        self,
        interaction: discord.Interaction,
        cohort: int,
        meeting_length: int = 60,
        min_people: int = 4,
        max_people: int = 8,
        iterations: int = 1000,
        balance: bool = True,
        use_if_needed: bool = True,
    ):
        """Run the scheduling algorithm for a specific cohort."""
        await interaction.response.defer()

        # Progress message
        progress_msg = await interaction.followup.send(
            "Running scheduling algorithm...", ephemeral=False
        )

        async def update_progress(current, total, best_score, total_people):
            try:
                await progress_msg.edit(
                    content=f"Scheduling...\n"
                    f"Iteration: {current}/{total} | "
                    f"Best: {best_score}/{total_people}"
                )
            except discord.HTTPException:
                pass  # Rate limited or message deleted, expected
            except Exception as e:
                print(f"[SchedulerCog] Progress update failed: {e}")

        # Run scheduling
        try:
            result = await schedule_cohort(
                cohort_id=cohort,
                meeting_length=meeting_length,
                min_people=min_people,
                max_people=max_people,
                num_iterations=iterations,
                balance=balance,
                use_if_needed=use_if_needed,
                progress_callback=update_progress,
            )
        except ValueError as e:
            await progress_msg.edit(content=f"Error: {e}")
            return

        # Build results embed
        total_users = result.users_grouped + result.users_ungroupable
        placement_rate = (
            (result.users_grouped * 100 // total_users) if total_users else 0
        )

        embed = discord.Embed(
            title=f"Scheduling Complete: {result.cohort_name}",
            color=discord.Color.green()
            if placement_rate >= 80
            else discord.Color.yellow(),
        )

        embed.add_field(
            name="Summary",
            value=f"**Groups created:** {result.groups_created}\n"
            f"**Users grouped:** {result.users_grouped}\n"
            f"**Ungroupable:** {result.users_ungroupable}\n"
            f"**Placement rate:** {placement_rate}%",
            inline=False,
        )

        # List groups
        for group in result.groups:
            embed.add_field(
                name=f"{group['group_name']} ({group['member_count']} members)",
                value=f"**Meeting time:** {group['meeting_time']}",
                inline=True,
            )

        # Show DST warnings if any
        if result.warnings:
            warnings_text = "\n".join(f"⚠️ {w}" for w in result.warnings)
            embed.add_field(name="⏰ DST Warnings", value=warnings_text, inline=False)

        embed.set_footer(text="Use /realize-groups to create Discord channels")

        await progress_msg.edit(content=None, embed=embed)


async def setup(bot):
    await bot.add_cog(SchedulerCog(bot))
