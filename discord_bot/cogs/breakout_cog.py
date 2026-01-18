"""
Breakout Rooms Cog

Allows facilitators to split voice channel participants into temporary
breakout rooms and collect them back.
"""

import discord
from discord import app_commands
from discord.ext import commands
from dataclasses import dataclass, field
import random

from test_bot_manager import test_bot_manager


@dataclass
class BreakoutSession:
    """Tracks an active breakout session for a guild."""

    source_channel_id: int
    breakout_channel_ids: list[int] = field(default_factory=list)
    facilitator_id: int = 0


class BreakoutView(discord.ui.View):
    """GUI for breakout room configuration."""

    def __init__(self, cog: "BreakoutCog"):
        super().__init__(timeout=60)
        self.cog = cog
        self.include_bots = False

    @discord.ui.button(
        label="Include Bots: Off", style=discord.ButtonStyle.secondary, row=0
    )
    async def toggle_bots(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        self.include_bots = not self.include_bots
        button.label = f"Include Bots: {'On' if self.include_bots else 'Off'}"
        button.style = (
            discord.ButtonStyle.success
            if self.include_bots
            else discord.ButtonStyle.secondary
        )
        await interaction.response.edit_message(view=self)

    async def do_breakout(self, interaction: discord.Interaction, group_size: int):
        """Execute breakout with the selected settings."""
        await self.cog.run_breakout(interaction, group_size, self.include_bots)
        self.stop()

    @discord.ui.button(label="Groups of 2", style=discord.ButtonStyle.primary, row=1)
    async def size_2(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.do_breakout(interaction, 2)

    @discord.ui.button(label="Groups of 3", style=discord.ButtonStyle.primary, row=1)
    async def size_3(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.do_breakout(interaction, 3)

    @discord.ui.button(label="Groups of 4", style=discord.ButtonStyle.primary, row=1)
    async def size_4(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.do_breakout(interaction, 4)

    @discord.ui.button(label="Groups of 5", style=discord.ButtonStyle.primary, row=1)
    async def size_5(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.do_breakout(interaction, 5)


class CollectView(discord.ui.View):
    """Button to collect everyone from breakout rooms."""

    def __init__(self, cog: "BreakoutCog"):
        super().__init__(timeout=None)  # No timeout - button stays active
        self.cog = cog

    @discord.ui.button(
        label="Collect Everyone", style=discord.ButtonStyle.danger, emoji="📢"
    )
    async def collect_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        await self.cog.run_collect(interaction)
        button.disabled = True
        button.label = "Collected"
        button.style = discord.ButtonStyle.secondary
        await interaction.message.edit(view=self)
        self.stop()


class BreakoutCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self._active_sessions: dict[int, BreakoutSession] = {}

    async def _send_response(
        self,
        interaction: discord.Interaction,
        content: str,
        ephemeral: bool = True,
    ):
        """Send a response, using followup if the interaction was already responded to."""
        if interaction.response.is_done():
            await interaction.followup.send(content, ephemeral=ephemeral)
        else:
            await interaction.response.send_message(content, ephemeral=ephemeral)

    async def run_breakout(
        self,
        interaction: discord.Interaction,
        group_size: int,
        include_bots: bool = False,
    ):
        """Core breakout logic - can be called from command or GUI."""
        guild = interaction.guild
        member = interaction.user

        # Validate caller is in a voice channel
        if not member.voice or not member.voice.channel:
            await self._send_response(interaction, "You must be in a voice channel.")
            return

        source_channel = member.voice.channel

        # Check for existing session
        if guild.id in self._active_sessions:
            await self._send_response(
                interaction,
                "A breakout session is already active. Use `/collect` first.",
            )
            return

        # Get other users in the channel (exclude facilitator, optionally include bots)
        other_members = [
            m
            for m in source_channel.members
            if m.id != member.id and (include_bots or not m.bot)
        ]

        if not other_members:
            await self._send_response(
                interaction, "There are no other users in the voice channel to split."
            )
            return

        # Defer if not already done
        if not interaction.response.is_done():
            await interaction.response.defer()

        # Shuffle and chunk users into groups
        random.shuffle(other_members)
        groups = []
        for i in range(0, len(other_members), group_size):
            groups.append(other_members[i : i + group_size])

        # Merge last group if it has only 1 person (no solo breakouts)
        if len(groups) > 1 and len(groups[-1]) == 1:
            groups[-2].extend(groups[-1])
            groups.pop()

        # Create breakout channels in the same category
        category = source_channel.category
        breakout_channels = []
        room_assignments = []

        try:
            for i, group in enumerate(groups, 1):
                channel = await guild.create_voice_channel(
                    name=f"Breakout {i}",
                    category=category,
                    reason=f"Breakout room created by {member.display_name}",
                )
                breakout_channels.append(channel)

                # Move members to breakout channel
                member_names = []
                for m in group:
                    try:
                        await m.move_to(channel)
                        member_names.append(m.display_name)
                    except discord.HTTPException:
                        # Member may have left, skip
                        pass

                if member_names:
                    room_assignments.append(
                        f"**Breakout {i}:** {', '.join(member_names)}"
                    )

            # Store session
            self._active_sessions[guild.id] = BreakoutSession(
                source_channel_id=source_channel.id,
                breakout_channel_ids=[c.id for c in breakout_channels],
                facilitator_id=member.id,
            )

            # Build response
            embed = discord.Embed(
                title="Breakout Rooms Created",
                description=f"Split {len(other_members)} users into {len(groups)} rooms.",
                color=discord.Color.green(),
            )
            embed.add_field(
                name="Room Assignments",
                value="\n".join(room_assignments)
                if room_assignments
                else "No assignments",
                inline=False,
            )
            embed.set_footer(text="Click the button below to collect everyone")

            await interaction.followup.send(embed=embed, view=CollectView(self))

        except discord.Forbidden:
            # Clean up any channels we created
            for channel in breakout_channels:
                try:
                    await channel.delete()
                except discord.HTTPException:
                    pass  # Channel may already be deleted
            await interaction.followup.send(
                "I don't have permission to create channels or move members.",
                ephemeral=True,
            )

    @app_commands.command(
        name="breakout", description="Split voice channel users into breakout rooms"
    )
    @app_commands.describe(
        group_size="Target number of people per breakout room",
        include_bots="Include bots in breakout (for testing)",
    )
    async def breakout(
        self,
        interaction: discord.Interaction,
        group_size: int,
        include_bots: bool = False,
    ):
        """Split users in the caller's voice channel into breakout rooms."""
        await self.run_breakout(interaction, group_size, include_bots)

    @app_commands.command(
        name="breakout-gui", description="Show breakout room controls"
    )
    async def breakout_gui(self, interaction: discord.Interaction):
        """Show a GUI for configuring and starting breakout rooms."""
        member = interaction.user

        if not member.voice or not member.voice.channel:
            await interaction.response.send_message(
                "You must be in a voice channel to use this command.", ephemeral=True
            )
            return

        channel = member.voice.channel
        member_count = len(
            [m for m in channel.members if m.id != member.id and not m.bot]
        )
        bot_count = len([m for m in channel.members if m.bot])

        embed = discord.Embed(
            title="Breakout Room Controls",
            description=f"**Channel:** {channel.name}\n**Members:** {member_count} users, {bot_count} bots",
            color=discord.Color.blue(),
        )
        embed.add_field(
            name="Instructions",
            value="Toggle 'Include Bots' if testing, then select group size.",
            inline=False,
        )

        view = BreakoutView(self)
        await interaction.response.send_message(embed=embed, view=view)

    async def run_collect(self, interaction: discord.Interaction):
        """Core collect logic - can be called from command or button."""
        guild = interaction.guild
        member = interaction.user

        # Check for active session
        if guild.id not in self._active_sessions:
            await self._send_response(
                interaction, "No active breakout session to collect."
            )
            return

        session = self._active_sessions[guild.id]

        # Defer if not already done
        if not interaction.response.is_done():
            await interaction.response.defer()

        # Try to get the source channel
        source_channel = guild.get_channel(session.source_channel_id)
        if not source_channel:
            try:
                source_channel = await guild.fetch_channel(session.source_channel_id)
            except discord.NotFound:
                source_channel = None

        # If source channel is gone, use caller's current channel
        if not source_channel and member.voice and member.voice.channel:
            source_channel = member.voice.channel

        # Collect members from breakout channels
        collected_count = 0
        for channel_id in session.breakout_channel_ids:
            channel = guild.get_channel(channel_id)
            if not channel:
                try:
                    channel = await guild.fetch_channel(channel_id)
                except discord.NotFound:
                    continue

            # Move all members back
            if source_channel:
                for m in channel.members:
                    try:
                        await m.move_to(source_channel)
                        collected_count += 1
                    except discord.HTTPException:
                        pass

            # Delete the breakout channel
            try:
                await channel.delete(reason="Breakout session ended")
            except discord.HTTPException:
                pass

        # Remove session
        del self._active_sessions[guild.id]

        # Response
        if source_channel:
            await interaction.followup.send(
                f"Collected {collected_count} users back to **{source_channel.name}**. "
                f"Breakout rooms deleted."
            )
        else:
            await interaction.followup.send(
                "Breakout rooms deleted. Could not move users (original channel not found)."
            )

    @app_commands.command(
        name="collect", description="Bring everyone back from breakout rooms"
    )
    async def collect(self, interaction: discord.Interaction):
        """Move all users from breakout channels back and clean up."""
        await self.run_collect(interaction)

    @app_commands.command(
        name="test-joinvc", description="Have the bot join your voice channel"
    )
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    async def joinvc(self, interaction: discord.Interaction):
        """Have the bot join the caller's voice channel (for testing)."""
        member = interaction.user
        if not member.voice or not member.voice.channel:
            await interaction.response.send_message(
                "You must be in a voice channel.", ephemeral=True
            )
            return

        channel = member.voice.channel

        # If already connected somewhere, move instead of erroring
        if interaction.guild.voice_client:
            await interaction.guild.voice_client.move_to(channel)
        else:
            await channel.connect()

        await interaction.response.send_message(
            f"Joined **{channel.name}**", ephemeral=True
        )

    @app_commands.command(name="test-leavevc", description="Have the bot leave voice")
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    async def leavevc(self, interaction: discord.Interaction):
        """Have the bot leave voice channel."""
        if interaction.guild.voice_client:
            await interaction.guild.voice_client.disconnect()
            await interaction.response.send_message(
                "Left voice channel.", ephemeral=True
            )
        else:
            await interaction.response.send_message(
                "Not in a voice channel.", ephemeral=True
            )

    @app_commands.command(
        name="test-voicebots", description="Control voice bots for breakout testing"
    )
    @app_commands.default_permissions(administrator=True)
    @app_commands.checks.has_permissions(administrator=True)
    @app_commands.describe(
        action="join or leave voice channel",
        count="Number of bots to join (for join action)",
    )
    @app_commands.choices(
        action=[
            app_commands.Choice(name="join", value="join"),
            app_commands.Choice(name="leave", value="leave"),
        ]
    )
    async def voicebots(
        self, interaction: discord.Interaction, action: str, count: int = 1
    ):
        """Control voice bots for breakout room testing."""
        if action == "join":
            if not interaction.user.voice or not interaction.user.voice.channel:
                await interaction.response.send_message(
                    "You must be in a voice channel.", ephemeral=True
                )
                return

            channel = interaction.user.voice.channel
            available = test_bot_manager.count

            if available == 0:
                await interaction.response.send_message(
                    "No test bots configured. Add TEST_BOT_TOKENS to .env",
                    ephemeral=True,
                )
                return

            await interaction.response.defer()
            joined = await test_bot_manager.join_voice(channel, min(count, available))
            await interaction.followup.send(
                f"{joined} test bot(s) joined **{channel.name}** ({available} available)"
            )
        else:
            await interaction.response.defer()
            left = await test_bot_manager.leave_voice(interaction.guild.id)
            await interaction.followup.send(f"{left} test bot(s) left voice.")


async def setup(bot):
    await bot.add_cog(BreakoutCog(bot))
