"""
Groups Cog - Discord adapter for group creation.
Handles manual group creation with Discord channels and scheduled events.
"""

import json
import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timedelta
import pytz

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import (
    get_user_profile, get_course, is_facilitator,
    CohortNameGenerator,
    find_availability_overlap, format_local_time
)


# TODO: Refactor this cog.
# We have switched to using the DB and the scheduler to initiate group creation.
# But I can imagine a cog like this could then make the actual channels in Discord, for example.
# Ask user for input on how to do this.
class GroupsCog(commands.Cog):
    """Cog for creating and managing groups."""

    def __init__(self, bot):
        self.bot = bot
        self.name_generator = CohortNameGenerator()

    @app_commands.command(name="group", description="Create a group from selected members")
    @app_commands.checks.has_permissions(administrator=True)
    async def create_group(
        self,
        interaction: discord.Interaction,
        course: str,
        member1: discord.Member,
        member2: discord.Member = None,
        member3: discord.Member = None,
        member4: discord.Member = None,
        member5: discord.Member = None,
        member6: discord.Member = None,
        member7: discord.Member = None,
        member8: discord.Member = None,
        member9: discord.Member = None,
        member10: discord.Member = None,
    ):
        """Create a group with the specified members."""
        await interaction.response.defer()

        # Collect all members (filter None)
        members = [m for m in [member1, member2, member3, member4, member5,
                               member6, member7, member8, member9, member10] if m]

        # Check all members have signed up and get their data
        missing_signup = []
        member_data = {}  # discord_id -> user profile
        for member in members:
            user_data = await get_user_profile(str(member.id))
            if not user_data:
                missing_signup.append(member.mention)
            else:
                # Parse availability to check if it exists
                availability_str = user_data.get("availability_utc")
                availability = json.loads(availability_str) if availability_str else {}
                if not availability:
                    missing_signup.append(member.mention)
                else:
                    member_data[str(member.id)] = user_data

        if missing_signup:
            await interaction.followup.send(
                f"These members haven't completed signup:\n{', '.join(missing_signup)}\n\n"
                f"They need to use `/signup` first."
            )
            return

        # Validate course exists and has weeks (still uses JSON)
        course_data = get_course(course)
        if not course_data:
            await interaction.followup.send(
                f"Course `{course}` not found!\n"
                f"Use `/list-courses` to see available courses."
            )
            return

        num_weeks = len(course_data.get("weeks", []))
        if num_weeks == 0:
            await interaction.followup.send(
                f"Course `{course}` has no weeks defined!\n"
                f"Use `/add-week` to add weeks to the course first."
            )
            return

        # Find overlapping availability using core function (now async)
        member_ids = [str(m.id) for m in members]
        overlap = await find_availability_overlap(member_ids)
        if not overlap:
            await interaction.followup.send(
                f"No overlapping availability found for these {len(members)} members.\n"
                f"Consider adjusting their availability with `/signup`."
            )
            return

        utc_day, utc_hour = overlap

        # Generate group name
        group_word = self.name_generator.next_name()
        group_name = f"{group_word} - {course}"

        # Create category for group
        category = await interaction.guild.create_category(
            name=f"{group_name}",
            reason=f"Group created by {interaction.user}"
        )

        # Create text channel
        text_channel = await interaction.guild.create_text_channel(
            name=f"group-{group_word.lower()}-{course.lower()}",
            category=category,
            reason=f"{group_name} text channel"
        )

        # Create voice channel
        voice_channel = await interaction.guild.create_voice_channel(
            name=f"Group {group_word} Voice",
            category=category,
            reason=f"{group_name} voice channel"
        )

        # Set permissions - only group members can see
        try:
            await category.set_permissions(
                interaction.guild.default_role,
                view_channel=False
            )

            for member in members:
                await category.set_permissions(
                    member,
                    view_channel=True,
                    send_messages=True,
                    connect=True,
                    speak=True
                )
        except discord.Forbidden:
            await interaction.followup.send(
                "Bot lacks permission to manage channel permissions.\n"
                "Please ensure the bot has **Manage Channels** and **Manage Roles** permissions, "
                "and that its role is above the members' roles in the hierarchy."
            )
            return

        # Calculate first meeting date (next occurrence of the day)
        day_to_weekday = {
            "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
            "Friday": 4, "Saturday": 5, "Sunday": 6
        }

        now = datetime.now(pytz.UTC)
        target_weekday = day_to_weekday[utc_day]
        days_ahead = target_weekday - now.weekday()
        if days_ahead <= 0:
            days_ahead += 7

        first_meeting = now + timedelta(days=days_ahead)
        first_meeting = first_meeting.replace(hour=utc_hour, minute=0, second=0, microsecond=0)

        # Create Discord scheduled events (one per week of the course)
        events = []
        for week_num in range(num_weeks):
            meeting_time = first_meeting + timedelta(weeks=week_num)
            week_data = course_data["weeks"][week_num] if week_num < len(course_data["weeks"]) else None
            week_title = week_data["title"] if week_data else f"Week {week_num + 1}"

            event = await interaction.guild.create_scheduled_event(
                name=f"{group_name} - Week {week_num + 1}: {week_title}",
                start_time=meeting_time,
                end_time=meeting_time + timedelta(hours=1),
                channel=voice_channel,
                description=f"Week {week_num + 1} meeting for {group_name}",
                entity_type=discord.EntityType.voice,
                privacy_level=discord.PrivacyLevel.guild_only
            )
            events.append(event)

        # Build welcome message
        # Find facilitator (if any)
        facilitator = None
        for member in members:
            if await is_facilitator(str(member.id)):
                facilitator = member
                break

        # Member list
        member_list = []
        for member in members:
            if member == facilitator:
                member_list.append(f"- {member.mention} (Facilitator)")
            else:
                member_list.append(f"- {member.mention}")

        # Schedule with each member's timezone using core function
        schedule_lines = []
        for member in members:
            user_data = member_data.get(str(member.id), {})
            tz_name = user_data.get("timezone") or "UTC"

            # Get city name from timezone (simplified)
            city = tz_name.split("/")[-1].replace("_", " ")

            local_day, time_str = format_local_time(utc_day, utc_hour, tz_name)
            schedule_lines.append(f"- {member.mention} ({city}): {time_str}")

        # UTC reference
        utc_hour_12 = utc_hour if utc_hour <= 12 else utc_hour - 12
        utc_ampm = "am" if utc_hour < 12 else "pm"
        utc_end = utc_hour + 1
        utc_end_12 = utc_end if utc_end <= 12 else utc_end - 12
        utc_end_ampm = "am" if utc_end < 12 else "pm"
        utc_reference = f"{utc_day}s {utc_hour_12}:00{utc_ampm}-{utc_end_12}:00{utc_end_ampm} UTC"

        # Format first meeting date
        first_meeting_str = first_meeting.strftime("%B %d, %Y")

        welcome_message = f"""**Welcome to {group_name}!**

**Your group:**
{chr(10).join(member_list)}

**Meeting Schedule:**
{chr(10).join(schedule_lines)}

**UTC Reference:** {utc_reference}

**First Meeting:** {first_meeting_str}

**Action Items:**
1. Introduce yourself below!
2. Read Week 1 materials in the course library
3. Check your scheduled events ({num_weeks} meetings): {events[0].url}
4. Join {voice_channel.mention} when it's meeting time

Questions? Just ask! We're here to help each other learn.

---
**Code of Conduct:** Be respectful, assume good faith, welcome all questions.
"""

        await text_channel.send(welcome_message)

        # Notify admin
        events_summary = "\n".join([f"- Week {i+1}: {event.url}" for i, event in enumerate(events)])
        await interaction.followup.send(
            f"**{group_name}** created!\n\n"
            f"**Members:** {len(members)}\n"
            f"**Meeting:** {utc_day}s at {utc_hour}:00 UTC\n"
            f"**Channel:** {text_channel.mention}\n"
            f"**Events ({num_weeks} meetings):**\n{events_summary}"
        )


async def setup(bot):
    await bot.add_cog(GroupsCog(bot))
