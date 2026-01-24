"""
Groups Cog - Discord adapter for realizing groups from database.
Creates Discord channels, scheduled events, and welcome messages.
"""

import logging
import sys
from pathlib import Path
from datetime import datetime, timedelta

import discord
import pytz
from discord import app_commands
from discord.ext import commands

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection, get_transaction
from core.queries.cohorts import get_realizable_cohorts, save_cohort_category_id
from core.queries.groups import (
    get_cohort_groups_for_realization,
    save_discord_channel_ids,
    get_realized_groups_for_discord_user,
    get_group_with_details,
    get_group_member_names,
)
from core.meetings import create_meetings_for_group
from core.sync import sync_group
from core.notifications.dispatcher import was_notification_sent
from core.notifications.actions import notify_group_assigned
from core.enums import NotificationReferenceType

logger = logging.getLogger(__name__)


class GroupsCog(commands.Cog):
    """Cog for realizing groups in Discord from database."""

    def __init__(self, bot):
        self.bot = bot

    async def _grant_channel_permissions(
        self,
        member: discord.Member,
        text_channel: discord.TextChannel,
        voice_channel: discord.VoiceChannel,
    ):
        """Grant standard group channel permissions to a member."""
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

    async def _sync_group_lifecycle(
        self,
        group_id: int,
        user_ids: list[int],
    ) -> None:
        """
        Sync all external systems for a newly realized group.

        Uses the unified sync_group() function from core, then sends
        notifications to users who haven't been notified yet.
        """
        # Sync all external systems using unified function
        print(f"Group {group_id}: Running sync_group()...")
        result = await sync_group(group_id)
        print(f"Group {group_id}: Sync result: {result}")

        # Send notifications (with deduplication)
        async with get_connection() as conn:
            group_details = await get_group_with_details(conn, group_id)
            member_names = await get_group_member_names(conn, group_id)

        if not group_details:
            return

        for user_id in user_ids:
            already_notified = await was_notification_sent(
                user_id=user_id,
                message_type="group_assigned",
                reference_type=NotificationReferenceType.group_id,
                reference_id=group_id,
            )
            if not already_notified:
                await notify_group_assigned(
                    user_id=user_id,
                    group_name=group_details["group_name"],
                    meeting_time_utc=group_details["recurring_meeting_time_utc"],
                    member_names=member_names,
                    discord_channel_id=group_details.get("discord_text_channel_id", ""),
                    reference_type=NotificationReferenceType.group_id,
                    reference_id=group_id,
                )

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
        name="realize-groups",
        description="Create Discord channels for a cohort's groups",
    )
    @app_commands.default_permissions(administrator=True)
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

        # Create category if it doesn't exist
        category = None
        if cohort_data["discord_category_id"]:
            try:
                category = await interaction.guild.fetch_channel(
                    int(cohort_data["discord_category_id"])
                )
            except discord.NotFound:
                category = None

        if not category:
            await progress_msg.edit(content="Creating category...")
            category_name = (
                f"{cohort_data['course_name']} - {cohort_data['cohort_name']}"[:100]
            )
            category = await interaction.guild.create_category(
                name=category_name, reason=f"Realizing cohort {cohort}"
            )
            # Hide from everyone by default
            await category.set_permissions(
                interaction.guild.default_role, view_channel=False
            )

            # Save category ID
            async with get_transaction() as conn:
                await save_cohort_category_id(conn, cohort, str(category.id))

        # Create channels for each group
        created_count = 0
        failed_count = 0
        for group_data in cohort_data["groups"]:
            # Skip if already realized (not in preview status)
            if group_data.get("status") != "preview":
                print(
                    f"[realize] Skipping {group_data['group_name']} (status={group_data.get('status')})"
                )
                continue

            group_name = group_data["group_name"]
            group_id = group_data["group_id"]
            print(f"Processing group {group_id}: {group_name}")

            try:
                await progress_msg.edit(
                    content=f"Creating channels for {group_name}..."
                )

                # Create text channel
                print(f"Group {group_id}: Creating text channel...")
                text_channel = await interaction.guild.create_text_channel(
                    name=group_name.lower().replace(" ", "-"),
                    category=category,
                    reason=f"Group channel for {group_name}",
                )
                print(f"Group {group_id}: Text channel created: {text_channel.id}")

                # Create voice channel
                print(f"Group {group_id}: Creating voice channel...")
                voice_channel = await interaction.guild.create_voice_channel(
                    name=f"{group_name} Voice",
                    category=category,
                    reason=f"Voice channel for {group_name}",
                )
                print(f"Group {group_id}: Voice channel created: {voice_channel.id}")

                # Create scheduled events
                await progress_msg.edit(content=f"Creating events for {group_name}...")

                print(f"Group {group_id}: Creating scheduled events...")
                events, first_meeting = await self._create_scheduled_events(
                    interaction.guild,
                    voice_channel,
                    group_data,
                    cohort_data,
                )
                print(f"Group {group_id}: Created {len(events)} events")

                # Create meeting records in database
                num_meetings = cohort_data.get("number_of_group_meetings", 8)
                if first_meeting:
                    print(f"Group {group_id}: Creating meeting records...")
                    await create_meetings_for_group(
                        group_id=group_id,
                        cohort_id=cohort_data["cohort_id"],
                        group_name=group_name,
                        first_meeting=first_meeting,
                        num_meetings=num_meetings,
                        discord_voice_channel_id=str(voice_channel.id),
                        discord_events=events,
                        discord_text_channel_id=str(text_channel.id),
                    )

                # Save channel IDs to database
                print(f"Group {group_id}: Saving channel IDs...")
                async with get_transaction() as conn:
                    await save_discord_channel_ids(
                        conn,
                        group_id,
                        str(text_channel.id),
                        str(voice_channel.id),
                    )

                # Send welcome message
                print(f"Group {group_id}: Sending welcome message...")
                await self._send_welcome_message(
                    text_channel,
                    group_data,
                    cohort_data,
                    events[0].url if events else None,
                )

                # Sync permissions, calendar, reminders, and notifications via lifecycle functions
                # This uses the same code path as direct group joining
                print(f"Group {group_id}: Running lifecycle sync...")
                user_ids = [m["user_id"] for m in group_data["members"]]
                await self._sync_group_lifecycle(
                    group_id=group_id,
                    user_ids=user_ids,
                )

                created_count += 1
                print(f"Group {group_id}: Realized successfully")

            except Exception as e:
                print(f"Group {group_id}: Failed to realize: {e}")
                failed_count += 1
                await progress_msg.edit(
                    content=f"Error with {group_name}: {str(e)[:100]}. Continuing..."
                )
                continue

        # Summary
        print(f"Realize complete: {created_count} created, {failed_count} failed")
        color = discord.Color.green() if failed_count == 0 else discord.Color.orange()
        embed = discord.Embed(
            title=f"Groups Realized: {cohort_data['cohort_name']}",
            color=color,
        )
        summary = f"**Category:** {category.name}\n**Groups created:** {created_count}\n**Total groups:** {len(cohort_data['groups'])}"
        if failed_count > 0:
            summary += f"\n**Failed:** {failed_count}"
        embed.add_field(
            name="Summary",
            value=summary,
            inline=False,
        )
        embed.set_footer(
            text="Members not in the guild will get access automatically when they join."
        )

        await progress_msg.edit(content=None, embed=embed)

    async def _create_scheduled_events(
        self,
        guild: discord.Guild,
        voice_channel: discord.VoiceChannel,
        group_data: dict,
        cohort_data: dict,
    ) -> tuple[list[discord.ScheduledEvent], datetime | None]:
        """Create scheduled events for group meetings.

        Returns:
            Tuple of (list of Discord scheduled events, first meeting datetime)
        """
        events = []

        # Parse meeting time (e.g., "Wednesday 15:00-16:00")
        meeting_time_str = group_data.get("recurring_meeting_time_utc", "")
        if not meeting_time_str or meeting_time_str == "TBD":
            return events, None

        # Extract day and hour from format like "Wednesday 15:00-16:00"
        day_names = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]
        day_num = None
        hour = None
        minute = None

        for i, day in enumerate(day_names):
            if day in meeting_time_str:
                day_num = i
                # Extract hour and minute
                parts = meeting_time_str.split()
                for part in parts:
                    if ":" in part:
                        time_parts = part.split(":")
                        hour = int(time_parts[0])
                        minute = int(time_parts[1])
                        break
                break

        if day_num is None or hour is None:
            return events, None

        # Calculate first meeting date
        start_date = cohort_data["cohort_start_date"]
        if isinstance(start_date, str):
            start_date = datetime.fromisoformat(start_date)

        # Find first occurrence of the meeting day
        first_meeting = datetime.combine(start_date, datetime.min.time())
        first_meeting = first_meeting.replace(hour=hour, minute=minute, tzinfo=pytz.UTC)

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
                print(
                    f"Creating event {week + 1}/{num_meetings} for {group_data['group_name']}..."
                )
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
                print(f"Created event {week + 1} for {group_data['group_name']}")
            except discord.HTTPException as e:
                print(
                    f"Failed to create event {week + 1} for {group_data['group_name']}: {e}"
                )

        return events, first_meeting

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
            member.get("timezone") or "UTC"
            discord_id = member.get("discord_id")

            # TODO: Convert UTC time to local for each member
            # For now, just show UTC
            if discord_id:
                schedule_lines.append(f"- <@{discord_id}>: {meeting_time} (UTC)")

        event_line = f"\n**First event:** {first_event_url}" if first_event_url else ""

        message = f"""**Welcome to {group_data["group_name"]}!**

**Course:** {cohort_data["course_name"]}
**Cohort:** {cohort_data["cohort_name"]}

**Your group:**
{chr(10).join(member_lines)}

**Meeting time (UTC):** {meeting_time}
**Number of meetings:** {cohort_data.get("number_of_group_meetings", 8)}{event_line}

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
            user_groups = await get_realized_groups_for_discord_user(
                conn, str(member.id)
            )

        if not user_groups:
            return

        # Grant permissions to each group's channels
        granted_groups = []
        for group in user_groups:
            try:
                text_channel = member.guild.get_channel(
                    int(group["discord_text_channel_id"])
                )
                voice_channel = member.guild.get_channel(
                    int(group["discord_voice_channel_id"])
                )

                if text_channel and voice_channel:
                    await self._grant_channel_permissions(
                        member, text_channel, voice_channel
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
            print(
                f"[GroupsCog] Granted {member} access to groups: {', '.join(granted_groups)}"
            )


async def setup(bot):
    await bot.add_cog(GroupsCog(bot))
