"""
Breakout Rooms Cog

Allows facilitators to split voice channel participants into temporary
breakout rooms and collect them back.
"""

import asyncio
import discord
from discord import app_commands
from discord.ext import commands
from dataclasses import dataclass, field
import random

from test_bot_manager import test_bot_manager

# Countdown before collecting everyone back (seconds)
COLLECT_COUNTDOWN = 20


@dataclass
class BreakoutSession:
    """Tracks an active breakout session for a guild."""

    source_channel_id: int
    breakout_channel_ids: list[int] = field(default_factory=list)
    facilitator_id: int = 0
    timer_task: asyncio.Task | None = None
    original_channel_name: str = ""
    rename_task: asyncio.Task | None = None
    locked_role_ids: list[int] = field(default_factory=list)


# Keycap emoji for numbers 1-9
KEYCAPS = {
    1: "1️⃣",
    2: "2️⃣",
    3: "3️⃣",
    4: "4️⃣",
    5: "5️⃣",
    6: "6️⃣",
    7: "7️⃣",
    8: "8️⃣",
    9: "9️⃣",
}

# Max people per breakout room
MAX_GROUP_SIZE = 5
# Min people per breakout room (no solo groups)
MIN_GROUP_SIZE = 2


def distribute_evenly(n: int, num_groups: int) -> list[int]:
    """Distribute n people into num_groups as evenly as possible.

    Returns list sorted descending (largest groups first).
    """
    if num_groups <= 0 or n < num_groups:
        return []
    base = n // num_groups
    remainder = n % num_groups
    # remainder groups get base+1, rest get base
    groups = [base + 1] * remainder + [base] * (num_groups - remainder)
    return sorted(groups, reverse=True)


def is_valid_distribution(groups: list[int]) -> bool:
    """Check if distribution meets constraints."""
    if len(groups) < 2:  # Need at least 2 groups for breakout
        return False
    if min(groups) < MIN_GROUP_SIZE:  # No tiny groups
        return False
    if max(groups) > MAX_GROUP_SIZE:  # No huge groups
        return False
    return True


def format_distribution_label(groups: list[int]) -> str:
    """Format as '5 rooms (3️⃣3️⃣3️⃣3️⃣2️⃣)' - room count + keycaps showing people per room."""
    num_rooms = len(groups)
    keycaps = "".join(KEYCAPS.get(g, str(g)) for g in sorted(groups, reverse=True))
    return f"{num_rooms} rooms ({keycaps})"


class TimerModal(discord.ui.Modal, title="Custom Timer"):
    """Modal for setting custom breakout room duration."""

    minutes = discord.ui.TextInput(
        label="Timer (minutes)",
        placeholder="Enter number of minutes",
        required=True,
        max_length=3,
    )

    def __init__(
        self,
        cog: "BreakoutCog",
        num_groups: int,
        include_bots: bool,
        include_self: bool,
    ):
        super().__init__()
        self.cog = cog
        self.num_groups = num_groups
        self.include_bots = include_bots
        self.include_self = include_self

    async def on_submit(self, interaction: discord.Interaction):
        # Parse timer value
        timer_minutes = None
        if self.minutes.value.strip():
            try:
                timer_minutes = int(self.minutes.value.strip())
                if timer_minutes <= 0:
                    timer_minutes = None
            except ValueError:
                await interaction.response.send_message(
                    "Invalid timer value. Please enter a number.", ephemeral=True
                )
                return

        await self.cog.run_breakout(
            interaction,
            self.num_groups,
            self.include_bots,
            self.include_self,
            timer_minutes,
        )


class TimerSelectView(discord.ui.View):
    """View for selecting breakout timer duration."""

    def __init__(
        self,
        cog: "BreakoutCog",
        num_groups: int,
        include_bots: bool,
        include_self: bool,
        distribution_label: str,
    ):
        super().__init__(timeout=60)
        self.cog = cog
        self.num_groups = num_groups
        self.include_bots = include_bots
        self.include_self = include_self
        self.distribution_label = distribution_label

    @discord.ui.button(label="4 min", style=discord.ButtonStyle.primary, row=0)
    async def timer_4(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        await self.cog.run_breakout(
            interaction, self.num_groups, self.include_bots, self.include_self, 4
        )
        self.stop()

    @discord.ui.button(label="6 min", style=discord.ButtonStyle.primary, row=0)
    async def timer_6(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        await self.cog.run_breakout(
            interaction, self.num_groups, self.include_bots, self.include_self, 6
        )
        self.stop()

    @discord.ui.button(label="8 min", style=discord.ButtonStyle.primary, row=0)
    async def timer_8(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        await self.cog.run_breakout(
            interaction, self.num_groups, self.include_bots, self.include_self, 8
        )
        self.stop()

    @discord.ui.button(label="Custom", style=discord.ButtonStyle.secondary, row=0)
    async def timer_custom(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        modal = TimerModal(
            self.cog, self.num_groups, self.include_bots, self.include_self
        )
        await interaction.response.send_modal(modal)
        self.stop()

    @discord.ui.button(label="No limit", style=discord.ButtonStyle.secondary, row=0)
    async def timer_none(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        await self.cog.run_breakout(
            interaction, self.num_groups, self.include_bots, self.include_self, None
        )
        self.stop()


class BreakoutView(discord.ui.View):
    """GUI for breakout room configuration."""

    def __init__(
        self,
        cog: "BreakoutCog",
        channel: discord.VoiceChannel,
        facilitator_id: int,
    ):
        super().__init__(timeout=60)
        self.cog = cog
        self.channel = channel
        self.facilitator_id = facilitator_id
        self.include_bots = False
        self.include_self = False

        # Add toggle buttons (row 0)
        self.bots_button = discord.ui.Button(
            label="Include Bots: Off",
            style=discord.ButtonStyle.secondary,
            row=0,
        )
        self.bots_button.callback = self.toggle_bots
        self.add_item(self.bots_button)

        self.self_button = discord.ui.Button(
            label="Include Me: Off",
            style=discord.ButtonStyle.secondary,
            row=0,
        )
        self.self_button.callback = self.toggle_self
        self.add_item(self.self_button)

        # Add distribution buttons (row 1+)
        self._distribution_buttons: list[discord.ui.Button] = []
        self._rebuild_distribution_buttons()

    def _get_participant_count(self) -> int:
        """Get current participant count based on toggle settings."""
        return len(
            [
                m
                for m in self.channel.members
                if (self.include_self or m.id != self.facilitator_id)
                and (self.include_bots or not m.bot)
            ]
        )

    def _rebuild_distribution_buttons(self):
        """Rebuild the distribution buttons based on current settings."""
        # Remove old distribution buttons
        for btn in self._distribution_buttons:
            self.remove_item(btn)
        self._distribution_buttons.clear()

        n = self._get_participant_count()
        if n < 4:
            # Not enough people for 2+ groups of 2+
            btn = discord.ui.Button(
                label="Need 4+ people",
                style=discord.ButtonStyle.secondary,
                disabled=True,
                row=1,
            )
            self._distribution_buttons.append(btn)
            self.add_item(btn)
            return

        # Generate distributions by number of groups
        seen_distributions: set[tuple] = set()
        row = 1
        for num_groups in range(n // MIN_GROUP_SIZE, 1, -1):  # Most rooms first
            dist = distribute_evenly(n, num_groups)
            if not dist or not is_valid_distribution(dist):
                continue

            # Skip duplicates (as tuple for hashability)
            dist_tuple = tuple(dist)
            if dist_tuple in seen_distributions:
                continue
            seen_distributions.add(dist_tuple)

            label = format_distribution_label(dist)
            btn = discord.ui.Button(
                label=label,
                style=discord.ButtonStyle.primary,
                row=row,  # Each button on its own row
            )
            btn.callback = self._make_distribution_callback(num_groups, label)
            self._distribution_buttons.append(btn)
            self.add_item(btn)
            row += 1

            # Discord limit: max 5 rows (0-4), row 0 is toggles
            if row > 4:
                break

    def _make_distribution_callback(self, num_groups: int, label: str):
        """Create a callback for a distribution button."""

        async def callback(interaction: discord.Interaction):
            # Show timer selection view
            embed = discord.Embed(
                title="Select Timer",
                description=f"**Distribution:** {label}\n\nHow long should the breakout last?",
                color=discord.Color.blue(),
            )
            view = TimerSelectView(
                self.cog, num_groups, self.include_bots, self.include_self, label
            )
            await interaction.response.edit_message(embed=embed, view=view)
            self.stop()

        return callback

    async def toggle_bots(self, interaction: discord.Interaction):
        self.include_bots = not self.include_bots
        self.bots_button.label = f"Include Bots: {'On' if self.include_bots else 'Off'}"
        self.bots_button.style = (
            discord.ButtonStyle.success
            if self.include_bots
            else discord.ButtonStyle.secondary
        )
        self._rebuild_distribution_buttons()
        await interaction.response.edit_message(view=self)

    async def toggle_self(self, interaction: discord.Interaction):
        self.include_self = not self.include_self
        self.self_button.label = f"Include Me: {'On' if self.include_self else 'Off'}"
        self.self_button.style = (
            discord.ButtonStyle.success
            if self.include_self
            else discord.ButtonStyle.secondary
        )
        self._rebuild_distribution_buttons()
        await interaction.response.edit_message(view=self)


class CollectView(discord.ui.View):
    """Button to collect everyone from breakout rooms."""

    def __init__(
        self, cog: "BreakoutCog", room_buttons: list[discord.ui.Button] = None
    ):
        super().__init__(timeout=None)  # No timeout - button stays active
        self.cog = cog

        # Add room navigation buttons (link buttons for each breakout room)
        if room_buttons:
            for button in room_buttons:
                self.add_item(button)

    @discord.ui.button(
        label="Collect in 20s", style=discord.ButtonStyle.danger, emoji="📢", row=4
    )
    async def collect_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        # Update button to show countdown is starting
        button.disabled = True
        button.label = f"Collecting in {COLLECT_COUNTDOWN}s..."
        button.style = discord.ButtonStyle.secondary
        await interaction.response.edit_message(view=self)

        # Run collect (sends warnings, waits, then collects)
        await self.cog.run_collect(interaction)

        # Update button to show completion
        button.label = "Collected"
        await interaction.message.edit(view=self)
        self.stop()


class BreakoutCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        # Keyed by source_channel_id (allows concurrent sessions in different channels)
        self._active_sessions: dict[int, BreakoutSession] = {}

    def _find_session_for_channel(self, channel_id: int) -> BreakoutSession | None:
        """Find session by source channel or breakout room."""
        # Direct match on source channel
        if channel_id in self._active_sessions:
            return self._active_sessions[channel_id]
        # Check if it's a breakout room
        for session in self._active_sessions.values():
            if channel_id in session.breakout_channel_ids:
                return session
        return None

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

    def _get_group_roles(self, channel: discord.VoiceChannel) -> list[discord.Role]:
        """Get group roles on a channel (roles with connect=True, excluding staff roles)."""
        roles = []
        for target, overwrite in channel.overwrites.items():
            if not isinstance(target, discord.Role):
                continue
            if target.is_default():
                continue
            # Skip staff roles (admin/mod permissions)
            if (
                target.permissions.administrator
                or target.permissions.manage_guild
                or target.permissions.manage_channels
            ):
                continue
            # Only roles that have explicit connect=True on this channel
            if overwrite.connect is True:
                roles.append(target)
        return roles

    async def _run_timer(
        self,
        guild: discord.Guild,
        source_channel_id: int,
        timer_minutes: int,
    ):
        """Run the breakout timer with countdown messages."""
        total_seconds = timer_minutes * 60
        elapsed = 0

        # Helper to send message to main channel and all breakout rooms
        async def send_countdown(message: str) -> bool:
            session = self._active_sessions.get(source_channel_id)
            if not session:
                return False  # Session ended early

            # Send to main channel
            source_channel = guild.get_channel(source_channel_id)
            if source_channel:
                try:
                    await source_channel.send(message)
                except discord.HTTPException:
                    pass

            # Send to breakout rooms
            for channel_id in session.breakout_channel_ids:
                channel = guild.get_channel(channel_id)
                if channel:
                    try:
                        await channel.send(message)
                    except discord.HTTPException:
                        pass
            return True

        # Halfway message (if timer >= 4 min, so halfway is at least 2 min)
        if timer_minutes >= 4:
            halfway_seconds = total_seconds // 2
            await asyncio.sleep(halfway_seconds)
            elapsed = halfway_seconds

            halfway_min = (total_seconds - elapsed) // 60
            if not await send_countdown(f"Halfway: {halfway_min} min remaining"):
                return

        # 1 minute warning (if timer >= 2 min)
        if timer_minutes >= 2:
            wait_for_1min = total_seconds - 60 - COLLECT_COUNTDOWN - elapsed
            if wait_for_1min > 0:
                await asyncio.sleep(wait_for_1min)
                elapsed += wait_for_1min

                if not await send_countdown("1 minute remaining"):
                    return

                # Wait the remaining minute minus collect countdown
                await asyncio.sleep(60)
                elapsed += 60

        # Wait for remaining time until collect countdown
        remaining = total_seconds - elapsed - COLLECT_COUNTDOWN
        if remaining > 0:
            await asyncio.sleep(remaining)

        # Auto-collect (this will handle the 20s + 5s warnings)
        session = self._active_sessions.get(source_channel_id)
        if session:
            await self._auto_collect(guild, source_channel_id)

    async def _countdown_and_collect(
        self,
        session: BreakoutSession,
        source_channel: discord.VoiceChannel | None,
        breakout_channels: list[discord.VoiceChannel],
        countdown: bool = True,
    ) -> int:
        """Shared collect logic: countdown, move members, cleanup.

        Returns the number of members collected.
        """
        # Countdown warnings
        if countdown and breakout_channels:
            targets = ([source_channel] if source_channel else []) + breakout_channels
            for ch in targets:
                try:
                    await ch.send("20 seconds remaining")
                except discord.HTTPException:
                    pass

            await asyncio.sleep(COLLECT_COUNTDOWN - 5)

            for ch in targets:
                try:
                    await ch.send("5 seconds remaining")
                except discord.HTTPException:
                    pass

            await asyncio.sleep(5)

        # Restore permissions and channel name BEFORE moving people back
        if source_channel:
            # Restore connect on locked group roles
            guild = source_channel.guild
            for role_id in session.locked_role_ids:
                role = guild.get_role(role_id)
                if role:
                    try:
                        await source_channel.set_permissions(
                            role,
                            connect=True,
                            view_channel=True,
                            speak=True,
                            reason="Breakout session ended",
                        )
                    except discord.HTTPException:
                        pass

            # Restore channel name (non-blocking, may be delayed by rate limit)
            if session.rename_task and not session.rename_task.done():
                session.rename_task.cancel()
            if session.original_channel_name:

                async def _restore_name():
                    try:
                        await source_channel.edit(name=session.original_channel_name)
                    except discord.HTTPException as e:
                        print(f"Failed to restore channel name: {e}")

                asyncio.create_task(_restore_name())

        # Move everyone back and delete breakout channels
        collected_count = 0
        for channel in breakout_channels:
            if source_channel:
                for m in channel.members:
                    try:
                        await m.move_to(source_channel)
                        collected_count += 1
                    except discord.HTTPException:
                        pass
            try:
                await channel.delete(reason="Breakout session ended")
            except discord.HTTPException:
                pass

        # Clean up session
        del self._active_sessions[session.source_channel_id]

        return collected_count

    async def _auto_collect(self, guild: discord.Guild, source_channel_id: int):
        """Auto-collect without interaction (called by timer)."""
        session = self._active_sessions.get(source_channel_id)
        if not session:
            return

        source_channel = guild.get_channel(source_channel_id)

        breakout_channels = []
        for channel_id in session.breakout_channel_ids:
            channel = guild.get_channel(channel_id)
            if channel:
                breakout_channels.append(channel)

        collected_count = await self._countdown_and_collect(
            session, source_channel, breakout_channels
        )

        if source_channel:
            try:
                await source_channel.send(
                    f"✅ Breakout ended! Collected {collected_count} users."
                )
            except discord.HTTPException:
                pass

    async def run_breakout(
        self,
        interaction: discord.Interaction,
        num_groups: int,
        include_bots: bool = False,
        include_self: bool = False,
        timer_minutes: int | None = None,
    ):
        """Core breakout logic - can be called from command or GUI."""
        guild = interaction.guild
        member = interaction.user

        # Validate caller is in a voice channel
        if not member.voice or not member.voice.channel:
            await self._send_response(interaction, "You must be in a voice channel.")
            return

        source_channel = member.voice.channel

        # Check for existing session in this channel
        if source_channel.id in self._active_sessions:
            await self._send_response(
                interaction,
                "A breakout session is already active in this channel. Use `/collect` first.",
            )
            return

        # Get members in the channel
        # Optionally exclude facilitator, optionally include bots
        participants = [
            m
            for m in source_channel.members
            if (include_self or m.id != member.id) and (include_bots or not m.bot)
        ]

        if not participants:
            await self._send_response(
                interaction, "There are no users in the voice channel to split."
            )
            return

        # Defer if not already done
        if not interaction.response.is_done():
            await interaction.response.defer()

        # Calculate group sizes and shuffle participants
        random.shuffle(participants)
        group_sizes = distribute_evenly(len(participants), num_groups)

        # Split participants into groups according to calculated sizes
        groups = []
        idx = 0
        for size in group_sizes:
            groups.append(participants[idx : idx + size])
            idx += size

        # Create breakout channels in the same category
        category = source_channel.category
        breakout_channels = []
        room_assignments = []
        room_buttons = []  # Link buttons for navigation

        # Map each user to their assigned group/channel for later movement
        user_assignments: list[tuple[list[discord.Member], discord.VoiceChannel]] = []

        # Copy role overwrites from source channel so breakout rooms
        # have the same visibility/connect permissions as the main voice channel
        role_overwrites = {
            target: overwrite
            for target, overwrite in source_channel.overwrites.items()
            if isinstance(target, discord.Role)
        }

        try:
            # PHASE 1: Create all breakout channels and invites (don't move anyone yet)
            for i, group in enumerate(groups, 1):
                channel = await guild.create_voice_channel(
                    name=f"Breakout {i}",
                    category=category,
                    overwrites=role_overwrites,
                    reason=f"Breakout room created by {member.display_name}",
                )
                breakout_channels.append(channel)

                # Create invite for this channel (for navigation button)
                invite = await channel.create_invite(
                    max_age=3600,  # 1 hour
                    max_uses=0,  # Unlimited uses
                    reason="Breakout room navigation",
                )

                # Store assignment for later movement
                user_assignments.append((group, channel))

                # Build room assignment text and button
                member_names = [m.display_name for m in group]
                room_assignments.append(f"**Breakout {i}:** {', '.join(member_names)}")
                # Create link button for this room
                # Truncate names if too long for button label (max 80 chars)
                names_str = ", ".join(member_names)
                label = f"Breakout {i}: {names_str}"
                if len(label) > 80:
                    label = label[:77] + "..."
                room_buttons.append(
                    discord.ui.Button(
                        label=label,
                        style=discord.ButtonStyle.link,
                        url=invite.url,
                        emoji="🔊",
                        row=min(i - 1, 3),  # Rows 0-3, collect button on row 4
                    )
                )

            # Save original name before any changes
            original_name = source_channel.name

            # PHASE 2: Post the message with navigation buttons (before moving/locking)
            embed = discord.Embed(
                title="Breakout Rooms Starting",
                description=f"Splitting {len(participants)} users into {len(groups)} rooms.\n\n"
                "**Click your room button below to navigate once moved:**",
                color=discord.Color.green(),
            )
            embed.add_field(
                name="Room Assignments",
                value="\n".join(room_assignments)
                if room_assignments
                else "No assignments",
                inline=False,
            )

            await interaction.followup.send(
                embed=embed, view=CollectView(self, room_buttons)
            )

            # Send popup messages before moving (users can still see main room)
            duration_msg = (
                f"{timer_minutes} minute breakout"
                if timer_minutes
                else "Breakout starting"
            )
            try:
                await source_channel.send(f"👋 {duration_msg}!")
                await source_channel.send("Switch your screen to see your group.")
            except discord.HTTPException:
                pass

            # PHASE 3: Lock group roles out of source channel, then move participants
            # Deny connect on group roles (instead of per-member overwrites)
            group_roles = self._get_group_roles(source_channel)
            for role in group_roles:
                try:
                    await source_channel.set_permissions(
                        role,
                        connect=False,
                        view_channel=True,
                        speak=True,
                        reason="Breakout session active",
                    )
                except discord.HTTPException:
                    pass

            # Move participants to breakout channels
            for group, channel in user_assignments:
                for m in group:
                    try:
                        await m.move_to(channel)
                    except discord.HTTPException:
                        pass

            # Store session (keyed by source channel for concurrent support)
            session = BreakoutSession(
                source_channel_id=source_channel.id,
                breakout_channel_ids=[c.id for c in breakout_channels],
                facilitator_id=member.id,
                original_channel_name=original_name,
                locked_role_ids=[r.id for r in group_roles],
            )
            self._active_sessions[source_channel.id] = session

            # Rename source channel in the background.
            # NOTE: Discord rate-limits channel name edits to ~2 per 10 minutes
            # per channel (separate from normal API limits). The restore rename
            # on collect may be silently delayed if the breakout is short.
            async def _rename_source():
                try:
                    await source_channel.edit(
                        name=f"⛔ Not a breakout room. {original_name}"
                    )
                except discord.HTTPException as e:
                    print(f"Failed to rename source channel: {e}")

            session.rename_task = asyncio.create_task(_rename_source())

            # Send duration message to each breakout room
            if timer_minutes:
                for channel in breakout_channels:
                    try:
                        await channel.send(f"{timer_minutes} minute breakout")
                    except discord.HTTPException:
                        pass

            # Start timer if configured
            if timer_minutes:
                session.timer_task = asyncio.create_task(
                    self._run_timer(guild, source_channel.id, timer_minutes)
                )

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

        view = BreakoutView(self, channel, member.id)
        await interaction.response.send_message(embed=embed, view=view)

    async def run_collect(
        self, interaction: discord.Interaction, countdown: bool = True
    ):
        """Core collect logic - can be called from command or button."""
        guild = interaction.guild
        member = interaction.user

        # Find session based on user's current voice channel
        user_channel_id = (
            member.voice.channel.id if member.voice and member.voice.channel else None
        )
        session = (
            self._find_session_for_channel(user_channel_id) if user_channel_id else None
        )

        if not session:
            await self._send_response(
                interaction, "No active breakout session in your channel."
            )
            return

        # Cancel timer if running
        if session.timer_task and not session.timer_task.done():
            session.timer_task.cancel()

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

        # Get all breakout channels
        breakout_channels = []
        for channel_id in session.breakout_channel_ids:
            channel = guild.get_channel(channel_id)
            if not channel:
                try:
                    channel = await guild.fetch_channel(channel_id)
                except discord.NotFound:
                    continue
            breakout_channels.append(channel)

        collected_count = await self._countdown_and_collect(
            session, source_channel, breakout_channels, countdown=countdown
        )

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
    @app_commands.describe(
        immediate="Skip the countdown warning (collect immediately)",
    )
    async def collect(self, interaction: discord.Interaction, immediate: bool = False):
        """Move all users from breakout channels back and clean up."""
        await self.run_collect(interaction, countdown=not immediate)

    @app_commands.command(
        name="breakout-reset-permissions",
        description="Remove user permission overrides from your voice channel",
    )
    async def reset_permissions(self, interaction: discord.Interaction):
        """Reset permissions on a voice channel (cleanup after bot restart)."""
        member = interaction.user
        if not member.voice or not member.voice.channel:
            await interaction.response.send_message(
                "You must be in a voice channel.", ephemeral=True
            )
            return

        channel = member.voice.channel
        await interaction.response.defer(ephemeral=True)

        # Remove member-specific overwrites
        removed_count = 0
        for target, overwrite in list(channel.overwrites.items()):
            if isinstance(target, discord.Member):
                try:
                    await channel.set_permissions(
                        target,
                        overwrite=None,
                        reason=f"Permission reset by {member.display_name}",
                    )
                    removed_count += 1
                except discord.HTTPException:
                    pass

        # Restore connect=True on group roles that may have been locked
        for role in self._get_group_roles(channel):
            overwrite = channel.overwrites_for(role)
            if overwrite.connect is False:
                try:
                    await channel.set_permissions(
                        role,
                        connect=True,
                        view_channel=True,
                        speak=True,
                        reason=f"Permission reset by {member.display_name}",
                    )
                    removed_count += 1
                except discord.HTTPException:
                    pass

        await interaction.followup.send(
            f"Reset {removed_count} permission override(s) on **{channel.name}**.",
            ephemeral=True,
        )

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
