"""
Cohorts Cog
Handles manual cohort creation with availability matching and Discord events.
"""

import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timedelta
import pytz

from utils import (
    DAY_CODES, DAY_NAMES,
    get_user_data,
    utc_to_local_time,
    CohortNameGenerator,
    get_course
)


class CohortsCog(commands.Cog):
    """Cog for creating and managing cohorts."""

    def __init__(self, bot):
        self.bot = bot
        self.name_generator = CohortNameGenerator()

    def _find_overlap(self, members: list[discord.Member]) -> tuple[str, int] | None:
        """
        Find a 1-hour slot where all members are available.
        Returns (day_name, hour) in UTC or None if no overlap.
        """
        # Collect all availability
        all_available = {}  # {(day, hour): [user_ids who are available]}
        all_if_needed = {}  # {(day, hour): [user_ids who marked if-needed]}

        for member in members:
            user_data = get_user_data(str(member.id))
            if not user_data:
                continue

            availability = user_data.get("availability", {})
            if_needed = user_data.get("if_needed", {})

            for day, slots in availability.items():
                for slot in slots:
                    hour = int(slot.split(":")[0])
                    key = (day, hour)
                    if key not in all_available:
                        all_available[key] = []
                    all_available[key].append(member.id)

            for day, slots in if_needed.items():
                for slot in slots:
                    hour = int(slot.split(":")[0])
                    key = (day, hour)
                    if key not in all_if_needed:
                        all_if_needed[key] = []
                    all_if_needed[key].append(member.id)

        # Find slots where everyone is available (prefer fully available over if-needed)
        member_count = len(members)
        member_ids = {m.id for m in members}

        # First pass: look for slots where everyone is fully available
        for (day, hour), user_ids in all_available.items():
            if set(user_ids) == member_ids:
                return (day, hour)

        # Second pass: look for slots where everyone is available or if-needed
        for (day, hour) in all_available.keys() | all_if_needed.keys():
            available_ids = set(all_available.get((day, hour), []))
            if_needed_ids = set(all_if_needed.get((day, hour), []))
            combined = available_ids | if_needed_ids

            if combined == member_ids:
                return (day, hour)

        return None

    def _get_timezone_abbrev(self, tz_name: str, dt: datetime) -> str:
        """Get timezone abbreviation for a datetime."""
        try:
            tz = pytz.timezone(tz_name)
            return dt.astimezone(tz).strftime('%Z')
        except:
            return tz_name

    def _format_local_time(self, day: str, hour: int, tz_name: str) -> tuple[str, str]:
        """
        Convert UTC day/hour to local time string.
        Returns (day_name, time_string) e.g. ("Wednesday", "3:00-4:00pm EST")
        """
        local_day, local_hour = utc_to_local_time(day, hour, tz_name)

        # Format hour as 12-hour time
        if local_hour == 0:
            start = "12:00am"
            end = "1:00am"
        elif local_hour < 12:
            start = f"{local_hour}:00am"
            end = f"{local_hour + 1}:00am" if local_hour + 1 < 12 else "12:00pm"
        elif local_hour == 12:
            start = "12:00pm"
            end = "1:00pm"
        else:
            start = f"{local_hour - 12}:00pm"
            end_hour = local_hour + 1
            if end_hour == 24:
                end = "12:00am"
            elif end_hour > 12:
                end = f"{end_hour - 12}:00pm"
            else:
                end = f"{end_hour}:00am"

        time_str = f"{start[:-2]}-{end}"

        # Get timezone abbreviation
        now = datetime.now(pytz.UTC)
        abbrev = self._get_timezone_abbrev(tz_name, now)

        return (local_day, f"{local_day}s {time_str} {abbrev}")

    @app_commands.command(name="cohort", description="Create a cohort from selected members")
    @app_commands.checks.has_permissions(administrator=True)
    async def create_cohort(
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
        """Create a cohort with the specified members."""
        await interaction.response.defer()

        # Collect all members (filter None)
        members = [m for m in [member1, member2, member3, member4, member5,
                               member6, member7, member8, member9, member10] if m]

        # Check all members have signed up
        missing_signup = []
        for member in members:
            user_data = get_user_data(str(member.id))
            if not user_data or not user_data.get("availability"):
                missing_signup.append(member.mention)

        if missing_signup:
            await interaction.followup.send(
                f"❌ These members haven't completed signup:\n{', '.join(missing_signup)}\n\n"
                f"They need to use `/signup` first."
            )
            return

        # Validate course exists and has weeks
        course_data = get_course(course)
        if not course_data:
            await interaction.followup.send(
                f"❌ Course `{course}` not found!\n"
                f"Use `/list-courses` to see available courses."
            )
            return

        num_weeks = len(course_data.get("weeks", []))
        if num_weeks == 0:
            await interaction.followup.send(
                f"❌ Course `{course}` has no weeks defined!\n"
                f"Use `/add-week` to add weeks to the course first."
            )
            return

        # Find overlapping availability
        overlap = self._find_overlap(members)
        if not overlap:
            await interaction.followup.send(
                f"❌ No overlapping availability found for these {len(members)} members.\n"
                f"Consider adjusting their availability with `/signup`."
            )
            return

        utc_day, utc_hour = overlap

        # Generate cohort name
        cohort_word = self.name_generator.next_name()
        cohort_name = f"{cohort_word} - {course}"

        # Create category for cohort
        category = await interaction.guild.create_category(
            name=f"🎓 {cohort_name}",
            reason=f"Cohort created by {interaction.user}"
        )

        # Create text channel
        text_channel = await interaction.guild.create_text_channel(
            name=f"cohort-{cohort_word.lower()}-{course.lower()}",
            category=category,
            reason=f"{cohort_name} text channel"
        )

        # Create voice channel
        voice_channel = await interaction.guild.create_voice_channel(
            name=f"Cohort {cohort_word} Voice",
            category=category,
            reason=f"{cohort_name} voice channel"
        )

        # Set permissions - only cohort members can see
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
                "⚠️ Bot lacks permission to manage channel permissions.\n"
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
                name=f"{cohort_name} - Week {week_num + 1}: {week_title}",
                start_time=meeting_time,
                end_time=meeting_time + timedelta(hours=1),
                channel=voice_channel,
                description=f"Week {week_num + 1} meeting for {cohort_name}",
                entity_type=discord.EntityType.voice,
                privacy_level=discord.PrivacyLevel.guild_only
            )
            events.append(event)

        # Build welcome message
        # Find facilitator (if any)
        facilitator = None
        for member in members:
            user_data = get_user_data(str(member.id))
            if user_data and user_data.get("is_facilitator"):
                facilitator = member
                break

        # Member list
        member_list = []
        for member in members:
            if member == facilitator:
                member_list.append(f"• {member.mention} (Facilitator) 🌟")
            else:
                member_list.append(f"• {member.mention}")

        # Schedule with each member's timezone
        schedule_lines = []
        for member in members:
            user_data = get_user_data(str(member.id))
            tz_name = user_data.get("timezone", "UTC")

            # Get city name from timezone (simplified)
            city = tz_name.split("/")[-1].replace("_", " ")

            local_day, time_str = self._format_local_time(utc_day, utc_hour, tz_name)
            schedule_lines.append(f"• {member.mention} ({city}): {time_str}")

        # UTC reference
        utc_hour_12 = utc_hour if utc_hour <= 12 else utc_hour - 12
        utc_ampm = "am" if utc_hour < 12 else "pm"
        utc_end = utc_hour + 1
        utc_end_12 = utc_end if utc_end <= 12 else utc_end - 12
        utc_end_ampm = "am" if utc_end < 12 else "pm"
        utc_reference = f"{utc_day}s {utc_hour_12}:00{utc_ampm}-{utc_end_12}:00{utc_end_ampm} UTC"

        # Format first meeting date
        first_meeting_str = first_meeting.strftime("%B %d, %Y")

        welcome_message = f"""🎉 **Welcome to {cohort_name}!**

**Your cohort:**
{chr(10).join(member_list)}

**Meeting Schedule:**
{chr(10).join(schedule_lines)}

📍 **UTC Reference:** {utc_reference}

**First Meeting:** {first_meeting_str}

**Action Items:**
1. ✅ Introduce yourself below!
2. 📚 Read Week 1 materials in the course library
3. 🗓️ Check your scheduled events ({num_weeks} meetings): {events[0].url}
4. 🎤 Join {voice_channel.mention} when it's meeting time

Questions? Just ask! We're here to help each other learn. 💬

---
📜 **Code of Conduct:** Be respectful, assume good faith, welcome all questions.
"""

        await text_channel.send(welcome_message)

        # Notify admin
        events_summary = "\n".join([f"• Week {i+1}: {event.url}" for i, event in enumerate(events)])
        await interaction.followup.send(
            f"✅ **{cohort_name}** created!\n\n"
            f"**Members:** {len(members)}\n"
            f"**Meeting:** {utc_day}s at {utc_hour}:00 UTC\n"
            f"**Channel:** {text_channel.mention}\n"
            f"**Events ({num_weeks} meetings):**\n{events_summary}"
        )


async def setup(bot):
    await bot.add_cog(CohortsCog(bot))
