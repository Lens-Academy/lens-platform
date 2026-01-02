"""
Groups Cog - Discord adapter for realizing groups from database.
Creates Discord channels, scheduled events, and welcome messages.
"""

import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timedelta
import pytz

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection, get_transaction
from core.queries.cohorts import get_realizable_cohorts, save_cohort_category_id
from core.queries.groups import (
    get_cohort_groups_for_realization,
    save_discord_channel_ids,
    get_group_welcome_data,
    get_realized_groups_for_discord_user,
)
from core.cohorts import format_local_time


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
                    app_commands.Choice(name=display_name[:100], value=cohort["cohort_id"])
                )

        return choices[:25]

    @app_commands.command(name="realize-groups", description="Create Discord channels for a cohort's groups")
    @app_commands.checks.has_permissions(administrator=True)
    @app_commands.describe(cohort="The cohort to create Discord channels for")
    @app_commands.autocomplete(cohort=cohort_autocomplete)
    async def realize_groups(
        self,
        interaction: discord.Interaction,
        cohort: int,
    ):
        """Create Discord category, channels, events, and welcome messages for cohort groups."""
        await interaction.response.defer()

        progress_msg = await interaction.followup.send(
            "Loading cohort data...",
            ephemeral=False
        )

        # Get cohort groups data
        async with get_connection() as conn:
            cohort_data = await get_cohort_groups_for_realization(conn, cohort)

        if not cohort_data:
            await progress_msg.edit(content="Cohort not found!")
            return

        if not cohort_data["groups"]:
            await progress_msg.edit(content="No groups found for this cohort. Run /schedule first.")
            return

        # Create category if it doesn't exist
        category = None
        if cohort_data["discord_category_id"]:
            try:
                category = await interaction.guild.fetch_channel(int(cohort_data["discord_category_id"]))
            except discord.NotFound:
                category = None

        if not category:
            await progress_msg.edit(content="Creating category...")
            category_name = f"{cohort_data['course_name']} - {cohort_data['cohort_name']}"[:100]
            category = await interaction.guild.create_category(
                name=category_name,
                reason=f"Realizing cohort {cohort}"
            )
            # Hide from everyone by default
            await category.set_permissions(interaction.guild.default_role, view_channel=False)

            # Save category ID
            async with get_transaction() as conn:
                await save_cohort_category_id(conn, cohort, str(category.id))

        # Create channels for each group
        created_count = 0
        skipped_members = []  # Track members not in guild
        for group_data in cohort_data["groups"]:
            # Skip if already realized
            if group_data["discord_text_channel_id"]:
                continue

            await progress_msg.edit(content=f"Creating channels for {group_data['group_name']}...")

            # Create text channel
            text_channel = await interaction.guild.create_text_channel(
                name=group_data["group_name"].lower().replace(" ", "-"),
                category=category,
                reason=f"Group channel for {group_data['group_name']}"
            )

            # Create voice channel
            voice_channel = await interaction.guild.create_voice_channel(
                name=f"{group_data['group_name']} Voice",
                category=category,
                reason=f"Voice channel for {group_data['group_name']}"
            )

            # Set member permissions (channels inherit @everyone denial from category)
            for member_data in group_data["members"]:
                discord_id = member_data.get("discord_id")
                if discord_id:
                    try:
                        member = await interaction.guild.fetch_member(int(discord_id))
                        await text_channel.set_permissions(
                            member,
                            view_channel=True,
                            send_messages=True,
                            read_message_history=True,
                        )
                        await voice_channel.set_permissions(
                            member,
                            view_channel=True,
                            connect=True,
                            speak=True,
                        )
                    except discord.NotFound:
                        # Member not in guild - track for reporting
                        skipped_members.append({
                            "discord_id": discord_id,
                            "group_name": group_data["group_name"],
                        })

            # Create scheduled events
            await progress_msg.edit(content=f"Creating events for {group_data['group_name']}...")

            events = await self._create_scheduled_events(
                interaction.guild,
                voice_channel,
                group_data,
                cohort_data,
            )

            # Save channel IDs to database
            async with get_transaction() as conn:
                await save_discord_channel_ids(
                    conn,
                    group_data["group_id"],
                    str(text_channel.id),
                    str(voice_channel.id),
                )

            # Send welcome message
            await self._send_welcome_message(
                text_channel,
                group_data,
                cohort_data,
                events[0].url if events else None,
            )

            created_count += 1

        # Summary
        embed = discord.Embed(
            title=f"Groups Realized: {cohort_data['cohort_name']}",
            color=discord.Color.green() if not skipped_members else discord.Color.yellow()
        )
        embed.add_field(
            name="Summary",
            value=f"**Category:** {category.name}\n"
                  f"**Groups created:** {created_count}\n"
                  f"**Total groups:** {len(cohort_data['groups'])}",
            inline=False
        )

        if skipped_members:
            # Group skipped members by group
            skipped_by_group = {}
            for sm in skipped_members:
                group_name = sm["group_name"]
                if group_name not in skipped_by_group:
                    skipped_by_group[group_name] = []
                skipped_by_group[group_name].append(f"<@{sm['discord_id']}>")

            skipped_lines = []
            for group_name, members in skipped_by_group.items():
                skipped_lines.append(f"**{group_name}:** {', '.join(members)}")

            embed.add_field(
                name=f"⚠️ Members Not in Guild ({len(skipped_members)})",
                value="\n".join(skipped_lines)[:1024],  # Discord field limit
                inline=False
            )
            embed.set_footer(text="These members will get access automatically when they join the server.")

        await progress_msg.edit(content=None, embed=embed)

    async def _create_scheduled_events(
        self,
        guild: discord.Guild,
        voice_channel: discord.VoiceChannel,
        group_data: dict,
        cohort_data: dict,
    ) -> list[discord.ScheduledEvent]:
        """Create scheduled events for group meetings."""
        events = []

        # Parse meeting time (e.g., "Wednesday 15:00-16:00")
        meeting_time_str = group_data.get("recurring_meeting_time_utc", "")
        if not meeting_time_str or meeting_time_str == "TBD":
            return events

        # Extract day and hour from format like "Wednesday 15:00-16:00"
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day_num = None
        hour = None

        for i, day in enumerate(day_names):
            if day in meeting_time_str:
                day_num = i
                # Extract hour
                parts = meeting_time_str.split()
                for part in parts:
                    if ":" in part:
                        hour = int(part.split(":")[0])
                        break
                break

        if day_num is None or hour is None:
            return events

        # Calculate first meeting date
        start_date = cohort_data["cohort_start_date"]
        if isinstance(start_date, str):
            start_date = datetime.fromisoformat(start_date)

        # Find first occurrence of the meeting day
        first_meeting = datetime.combine(start_date, datetime.min.time())
        first_meeting = first_meeting.replace(hour=hour, minute=0, tzinfo=pytz.UTC)

        days_ahead = day_num - first_meeting.weekday()
        if days_ahead < 0:
            days_ahead += 7
        first_meeting += timedelta(days=days_ahead)

        # Create events for each meeting
        num_meetings = cohort_data.get("number_of_group_meetings", 8)
        for week in range(num_meetings):
            meeting_time = first_meeting + timedelta(weeks=week)

            # Skip if in the past
            if meeting_time < datetime.now(pytz.UTC):
                continue

            try:
                event = await guild.create_scheduled_event(
                    name=f"{group_data['group_name']} - Week {week + 1}",
                    start_time=meeting_time,
                    end_time=meeting_time + timedelta(hours=1),
                    channel=voice_channel,
                    description=f"Weekly meeting for {group_data['group_name']}",
                    entity_type=discord.EntityType.voice,
                    privacy_level=discord.PrivacyLevel.guild_only,
                )
                events.append(event)
            except discord.HTTPException:
                pass  # Skip if event creation fails

        return events

    async def _send_welcome_message(
        self,
        channel: discord.TextChannel,
        group_data: dict,
        cohort_data: dict,
        first_event_url: str | None,
    ):
        """Send welcome message to group channel."""
        # Build member list
        member_lines = []
        for member in group_data["members"]:
            discord_id = member.get("discord_id")
            role = member.get("role", "participant")
            role_badge = " (Facilitator)" if role == "facilitator" else ""

            if discord_id:
                member_lines.append(f"- <@{discord_id}>{role_badge}")
            else:
                member_lines.append(f"- {member.get('name', 'Unknown')}{role_badge}")

        # Build schedule with local times
        schedule_lines = []
        meeting_time = group_data.get("recurring_meeting_time_utc", "TBD")

        for member in group_data["members"]:
            tz = member.get("timezone") or "UTC"
            discord_id = member.get("discord_id")

            # TODO: Convert UTC time to local for each member
            # For now, just show UTC
            if discord_id:
                schedule_lines.append(f"- <@{discord_id}>: {meeting_time} (UTC)")

        event_line = f"\n**First event:** {first_event_url}" if first_event_url else ""

        message = f"""**Welcome to {group_data['group_name']}!**

**Course:** {cohort_data['course_name']}
**Cohort:** {cohort_data['cohort_name']}

**Your group:**
{chr(10).join(member_lines)}

**Meeting time (UTC):** {meeting_time}
**Number of meetings:** {cohort_data.get('number_of_group_meetings', 8)}{event_line}

**Getting started:**
1. Introduce yourself!
2. Check your scheduled events
3. Prepare for Week 1

Questions? Ask in this channel. We're here to help each other learn!
"""
        await channel.send(message)

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        """
        Grant channel permissions when a user joins the guild.

        If the user is in any realized groups (groups with Discord channels),
        automatically grant them access to those channels.
        """
        # Check if this user has any realized groups
        async with get_connection() as conn:
            user_groups = await get_realized_groups_for_discord_user(conn, str(member.id))

        if not user_groups:
            return

        # Grant permissions to each group's channels
        granted_groups = []
        for group in user_groups:
            try:
                text_channel = member.guild.get_channel(int(group["discord_text_channel_id"]))
                voice_channel = member.guild.get_channel(int(group["discord_voice_channel_id"]))

                if text_channel:
                    await text_channel.set_permissions(
                        member,
                        view_channel=True,
                        send_messages=True,
                        read_message_history=True,
                    )
                if voice_channel:
                    await voice_channel.set_permissions(
                        member,
                        view_channel=True,
                        connect=True,
                        speak=True,
                    )

                granted_groups.append(group["group_name"])

                # Send welcome message to the text channel
                if text_channel:
                    await text_channel.send(
                        f"Welcome {member.mention}! You now have access to this group channel."
                    )

            except discord.HTTPException:
                pass  # Channel may have been deleted

        if granted_groups:
            print(f"[GroupsCog] Granted {member} access to groups: {', '.join(granted_groups)}")


async def setup(bot):
    await bot.add_cog(GroupsCog(bot))
