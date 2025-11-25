"""
Enrollment Cog
Handles user signup, availability selection, and profile management.
"""

import discord
from discord import app_commands
from discord.ext import commands

from utils import (
    DAY_CODES, DAY_NAMES, TIMEZONES,
    local_to_utc_time, utc_to_local_time,
    get_user_data, save_user_data,
    load_courses
)


# ============ VIEWS ============

class SignupView(discord.ui.View):
    """Initial signup form with course, experience, timezone"""

    def __init__(self, user_id: str, bot=None):
        super().__init__(timeout=300)
        self.user_id = user_id
        self.bot = bot

        # Load existing user data to pre-populate
        existing_data = get_user_data(user_id)
        self.old_courses = existing_data.get("courses", [])
        existing_experience = existing_data.get("experience", "")
        existing_timezone = existing_data.get("timezone", "")

        # Load courses dynamically from courses.json
        courses = load_courses()

        if courses:
            course_options = [
                discord.SelectOption(
                    label=f"{course_id} - {course['name']}",
                    value=course_id,
                    default=course_id in self.old_courses
                )
                for course_id, course in courses.items()
            ]
            max_values = min(len(course_options), 25)
        else:
            # Fallback if no courses defined yet
            course_options = [
                discord.SelectOption(
                    label="No courses available",
                    value="none",
                    default=True
                )
            ]
            max_values = 1

        course_select = discord.ui.Select(
            placeholder="Select your course(s)...",
            options=course_options,
            custom_id="course_select",
            min_values=1,
            max_values=max_values
        )
        course_select.callback = self.course_callback
        self.add_item(course_select)

        # Experience dropdown
        exp_options = [
            discord.SelectOption(
                label="Beginner - New to AI safety",
                value="beginner",
                default=existing_experience == "beginner"
            ),
            discord.SelectOption(
                label="Intermediate - Some background",
                value="intermediate",
                default=existing_experience == "intermediate"
            ),
            discord.SelectOption(
                label="Advanced - Deep knowledge",
                value="advanced",
                default=existing_experience == "advanced"
            ),
        ]
        experience_select = discord.ui.Select(
            placeholder="Select your experience level...",
            options=exp_options,
            custom_id="experience_select"
        )
        experience_select.callback = self.experience_callback
        self.add_item(experience_select)

        # Timezone dropdown
        tz_options = [
            discord.SelectOption(label=tz, value=tz, default=tz == existing_timezone)
            for tz in TIMEZONES
        ]
        tz_select = discord.ui.Select(
            placeholder="Select your timezone...",
            options=tz_options,
            custom_id="timezone_select"
        )
        tz_select.callback = self.timezone_callback
        self.add_item(tz_select)

        # Pre-populate from existing data
        self.courses = self.old_courses if self.old_courses else None
        self.experience = existing_experience if existing_experience else None
        self.timezone = existing_timezone if existing_timezone else None

        # Continue button
        continue_btn = discord.ui.Button(
            label="Continue",
            style=discord.ButtonStyle.primary,
            custom_id="continue_btn",
            row=4
        )
        continue_btn.callback = self.continue_callback
        self.add_item(continue_btn)

    async def course_callback(self, interaction: discord.Interaction):
        self.courses = interaction.data["values"]
        await interaction.response.defer()

    async def experience_callback(self, interaction: discord.Interaction):
        self.experience = interaction.data["values"][0]
        await interaction.response.defer()

    async def timezone_callback(self, interaction: discord.Interaction):
        self.timezone = interaction.data["values"][0]
        await interaction.response.defer()

    async def continue_callback(self, interaction: discord.Interaction):
        if not self.courses:
            await interaction.response.send_message(
                "Please select at least one course.",
                ephemeral=True
            )
            return
        if not self.experience:
            await interaction.response.send_message(
                "Please select your experience level.",
                ephemeral=True
            )
            return
        if not self.timezone:
            await interaction.response.send_message(
                "Please select your timezone.",
                ephemeral=True
            )
            return

        # Save basic info (keep existing availability)
        user_data = get_user_data(self.user_id)
        user_data.update({
            "name": interaction.user.display_name,
            "courses": self.courses,
            "experience": self.experience,
            "timezone": self.timezone,
        })
        if "availability" not in user_data:
            user_data["availability"] = {}
        if "if_needed" not in user_data:
            user_data["if_needed"] = {}
        save_user_data(self.user_id, user_data)

        # Sync course channel permissions
        if self.bot and interaction.guild:
            courses_cog = self.bot.get_cog("CoursesCog")
            if courses_cog:
                await courses_cog.sync_user_courses(
                    interaction.user,
                    self.courses,
                    self.old_courses
                )

        courses_str = ", ".join(self.courses)
        await interaction.response.edit_message(
            content=f"**Basic info saved:**\n"
            f"- Courses: {courses_str}\n"
            f"- Experience: {self.experience}\n"
            f"- Timezone: {self.timezone}\n\n"
            f"Now select which days you're available:",
            view=DaySelectionView(self.user_id)
        )


class DaySelectionView(discord.ui.View):
    """Select which days you're available"""

    def __init__(self, user_id: str):
        super().__init__(timeout=300)
        self.user_id = user_id

        # Load existing availability to pre-select days
        user_data = get_user_data(user_id)
        existing_availability = user_data.get("availability", {})
        existing_if_needed = user_data.get("if_needed", {})

        self.selected_days = set()
        for day in existing_availability.keys():
            if existing_availability[day]:
                self.selected_days.add(day)
        for day in existing_if_needed.keys():
            if existing_if_needed[day]:
                self.selected_days.add(day)

        day_buttons = [
            ("Mon", "Monday", 0),
            ("Tue", "Tuesday", 0),
            ("Wed", "Wednesday", 0),
            ("Thu", "Thursday", 0),
            ("Fri", "Friday", 0),
            ("Sat", "Saturday", 1),
            ("Sun", "Sunday", 1),
        ]

        for label, day_name, row in day_buttons:
            style = discord.ButtonStyle.success if day_name in self.selected_days else discord.ButtonStyle.secondary
            button = discord.ui.Button(label=label, style=style, row=row)
            button.callback = self.make_day_callback(button, day_name)
            self.add_item(button)

        continue_btn = discord.ui.Button(label="Continue", style=discord.ButtonStyle.primary, row=2)
        continue_btn.callback = self.continue_callback
        self.add_item(continue_btn)

    def make_day_callback(self, button: discord.ui.Button, day_name: str):
        async def callback(interaction: discord.Interaction):
            if day_name in self.selected_days:
                self.selected_days.remove(day_name)
                button.style = discord.ButtonStyle.secondary
            else:
                self.selected_days.add(day_name)
                button.style = discord.ButtonStyle.success
            await interaction.response.edit_message(view=self)
        return callback

    async def continue_callback(self, interaction: discord.Interaction):
        if not self.selected_days:
            await interaction.response.send_message(
                "Please select at least one day!",
                ephemeral=True
            )
            return

        sorted_days = sorted(self.selected_days, key=lambda d: list(DAY_CODES.keys()).index(d))
        await interaction.response.edit_message(
            content=f"Selected days: {', '.join(sorted_days)}\n\n"
            f"Now select your available time slots for **{sorted_days[0]}** (in your local timezone).\n"
            f"**Only select hours where you're available for the full hour.**\n"
            f"Click once for 🟢 Available, twice for 🔵 If needed, three times to clear:",
            view=TimeSlotView(self.user_id, sorted_days, 0)
        )


class TimeSlotView(discord.ui.View):
    """Select time slots for a specific day (when2meet style)"""

    def __init__(self, user_id: str, days: list, day_index: int,
                 all_available: dict = None, all_if_needed: dict = None):
        super().__init__(timeout=600)
        self.user_id = user_id
        self.days = days
        self.day_index = day_index
        self.current_day = days[day_index]

        self.all_available = all_available if all_available else {}
        self.all_if_needed = all_if_needed if all_if_needed else {}

        self.selected_slots = set()
        self.if_needed_slots = set()

        user_data = get_user_data(user_id)
        user_tz = user_data.get("timezone", "UTC")

        if self.current_day in self.all_available:
            self.selected_slots = set(self.all_available[self.current_day])
        else:
            for utc_day, slots in user_data.get("availability", {}).items():
                for slot in slots:
                    hour = int(slot.split(":")[0])
                    local_day, local_hour = utc_to_local_time(utc_day, hour, user_tz)
                    if local_day == self.current_day:
                        self.selected_slots.add(f"{local_hour:02d}:00")

        if self.current_day in self.all_if_needed:
            self.if_needed_slots = set(self.all_if_needed[self.current_day])
        else:
            for utc_day, slots in user_data.get("if_needed", {}).items():
                for slot in slots:
                    hour = int(slot.split(":")[0])
                    local_day, local_hour = utc_to_local_time(utc_day, hour, user_tz)
                    if local_day == self.current_day:
                        self.if_needed_slots.add(f"{local_hour:02d}:00")

        for hour in range(24):
            row = hour // 5
            self.add_item(TimeSlotButton(f"{hour:02d}:00", self, row=row))

        save_btn = discord.ui.Button(label="Save", style=discord.ButtonStyle.primary, row=4)
        save_btn.callback = self.save_callback
        self.add_item(save_btn)

    async def save_callback(self, interaction: discord.Interaction):
        self.all_available[self.current_day] = list(self.selected_slots)
        self.all_if_needed[self.current_day] = list(self.if_needed_slots)

        next_index = self.day_index + 1
        if next_index < len(self.days):
            next_day = self.days[next_index]
            await interaction.response.edit_message(
                content=f"Saved {self.current_day}!\n\n"
                        f"Now select your available time slots for **{next_day}** (in your local timezone).\n"
                        f"**Only select hours where you're available for the full hour.**\n"
                        f"🟢 = Available, 🔵 = If needed",
                view=TimeSlotView(self.user_id, self.days, next_index,
                                  self.all_available, self.all_if_needed)
            )
        else:
            user_data = get_user_data(self.user_id)
            user_tz = user_data.get("timezone", "UTC")

            utc_availability = {}
            for day_name, slots in self.all_available.items():
                for slot in slots:
                    hour = int(slot.split(":")[0])
                    utc_day, utc_hour = local_to_utc_time(day_name, hour, user_tz)
                    if utc_day not in utc_availability:
                        utc_availability[utc_day] = []
                    utc_availability[utc_day].append(f"{utc_hour:02d}:00")

            utc_if_needed = {}
            for day_name, slots in self.all_if_needed.items():
                for slot in slots:
                    hour = int(slot.split(":")[0])
                    utc_day, utc_hour = local_to_utc_time(day_name, hour, user_tz)
                    if utc_day not in utc_if_needed:
                        utc_if_needed[utc_day] = []
                    utc_if_needed[utc_day].append(f"{utc_hour:02d}:00")

            user_data["availability"] = utc_availability
            user_data["if_needed"] = utc_if_needed
            save_user_data(self.user_id, user_data)

            await interaction.response.edit_message(
                content="✅ Availability saved!\n\n"
                        "🟢 Available times and 🔵 if-needed times have been recorded.\n"
                        "Use `/view-availability` to see your schedule.",
                view=None
            )


class TimeSlotButton(discord.ui.Button):
    """Individual time slot button with three states"""

    def __init__(self, time: str, parent_view: TimeSlotView, row: int):
        is_available = time in parent_view.selected_slots
        is_if_needed = time in parent_view.if_needed_slots

        if is_available:
            style = discord.ButtonStyle.success
        elif is_if_needed:
            style = discord.ButtonStyle.primary
        else:
            style = discord.ButtonStyle.secondary

        hour = int(time.split(":")[0])
        label = f"{hour}:00"

        super().__init__(label=label, style=style, row=row)
        self.time = time
        self.parent_view = parent_view

    async def callback(self, interaction: discord.Interaction):
        is_available = self.time in self.parent_view.selected_slots
        is_if_needed = self.time in self.parent_view.if_needed_slots

        if not is_available and not is_if_needed:
            self.parent_view.selected_slots.add(self.time)
            self.style = discord.ButtonStyle.success
        elif is_available:
            self.parent_view.selected_slots.remove(self.time)
            self.parent_view.if_needed_slots.add(self.time)
            self.style = discord.ButtonStyle.primary
        else:
            self.parent_view.if_needed_slots.remove(self.time)
            self.style = discord.ButtonStyle.secondary

        await interaction.response.edit_message(view=self.parent_view)


# ============ COG ============

class EnrollmentCog(commands.Cog):
    """Cog for user enrollment and profile management."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="signup", description="Sign up (or edit your signup) - enter your course, experience, and availability")
    async def signup(self, interaction: discord.Interaction):
        """Start the signup process (or update existing signup)"""
        user_id = str(interaction.user.id)
        existing = get_user_data(user_id)

        # Check if any courses exist
        courses = load_courses()
        if not courses:
            await interaction.response.send_message(
                "⚠️ No courses are available yet. Please wait for an admin to add courses.",
                ephemeral=True
            )
            return

        if existing:
            msg = "**Update your signup:**\n\nYour current selections are pre-filled. Change what you need:"
        else:
            msg = "**Welcome to AI Safety Education Platform!**\n\nLet's get you signed up for a cohort.\n\n**Step 1:** Select your course(s), experience level, and timezone below:"

        await interaction.response.send_message(
            msg,
            view=SignupView(user_id, self.bot),
            ephemeral=True
        )

    @app_commands.command(name="view-availability", description="View your current availability in UTC and local time")
    async def view_availability(self, interaction: discord.Interaction):
        """Display user's availability in both UTC and local timezone"""
        await interaction.response.defer(ephemeral=True)

        user_id = str(interaction.user.id)
        user_data = get_user_data(user_id)

        if not user_data or (not user_data.get("availability") and not user_data.get("if_needed")):
            await interaction.followup.send(
                "You haven't set up your availability yet! Use `/signup` to get started."
            )
            return

        name = user_data.get("name", interaction.user.display_name)
        courses = user_data.get("courses", [])
        course_str = ", ".join(courses) if courses else "Not set"
        experience = user_data.get("experience", "Not set")
        user_tz = user_data.get("timezone", "UTC")
        availability = user_data.get("availability", {})
        if_needed = user_data.get("if_needed", {})

        local_slots = []
        utc_slots = []

        for is_if_needed, time_dict in [(False, availability), (True, if_needed)]:
            for day, slots in time_dict.items():
                day_code = DAY_CODES.get(day, day[0])
                for slot in sorted(slots):
                    hour = int(slot.split(":")[0])
                    utc_slots.append((day_code, slot, is_if_needed))

                    local_day, local_hour = utc_to_local_time(day, hour, user_tz)
                    local_day_code = DAY_CODES.get(local_day, local_day[0])
                    local_slots.append((local_day_code, f"{local_hour:02d}:00", is_if_needed))

        def format_slots(slots):
            if not slots:
                return "None"
            day_order = {'M': 0, 'T': 1, 'W': 2, 'R': 3, 'F': 4, 'S': 5, 'U': 6}
            sorted_slots = sorted(slots, key=lambda x: (day_order.get(x[0], 0), x[1]))
            return ", ".join(f"{d}{t}{'*' if is_if else ''}" for d, t, is_if in sorted_slots)

        local_str = format_slots(local_slots)
        utc_str = format_slots(utc_slots)

        embed = discord.Embed(
            title=f"Availability for {name}",
            color=discord.Color.blue()
        )

        embed.add_field(
            name="Profile",
            value=f"**Courses:** {course_str}\n**Experience:** {experience}\n**Timezone:** {user_tz}",
            inline=False
        )

        embed.add_field(
            name=f"Local Time ({user_tz})",
            value=f"```\n{local_str}\n```",
            inline=False
        )

        embed.add_field(
            name="UTC Time",
            value=f"```\n{utc_str}\n```",
            inline=False
        )

        embed.set_footer(text="* = if needed | Day codes: M=Mon, T=Tue, W=Wed, R=Thu, F=Fri, S=Sat, U=Sun")

        await interaction.followup.send(embed=embed)

    @app_commands.command(name="toggle-facilitator", description="Toggle your facilitator status")
    async def toggle_facilitator(self, interaction: discord.Interaction):
        """Toggle whether you are marked as a facilitator."""
        user_id = str(interaction.user.id)
        user_data = get_user_data(user_id)

        if not user_data:
            await interaction.response.send_message(
                "You haven't signed up yet! Use `/signup` first.",
                ephemeral=True
            )
            return

        await interaction.response.defer(ephemeral=True)

        current_status = user_data.get("is_facilitator", False)
        user_data["is_facilitator"] = not current_status
        save_user_data(user_id, user_data)

        role_message = ""
        if interaction.guild:
            facilitator_role = discord.utils.get(interaction.guild.roles, name="Facilitator")

            if not facilitator_role:
                try:
                    facilitator_role = await interaction.guild.create_role(
                        name="Facilitator",
                        color=discord.Color.gold(),
                        reason="Created by scheduler bot"
                    )
                    role_message = "\n(Created Facilitator role)"
                except discord.Forbidden:
                    role_message = "\n⚠️ Couldn't create/assign role (missing permissions)"
                    facilitator_role = None

            if facilitator_role:
                try:
                    if not current_status:
                        await interaction.user.add_roles(facilitator_role)
                        role_message = "\n✅ Facilitator role added"
                    else:
                        await interaction.user.remove_roles(facilitator_role)
                        role_message = "\n✅ Facilitator role removed"
                except discord.Forbidden:
                    role_message = "\n⚠️ Couldn't assign role (missing permissions)"

        new_status = "✅ Facilitator" if not current_status else "❌ Not a facilitator"
        await interaction.followup.send(
            f"Your status has been updated: **{new_status}**{role_message}"
        )


async def setup(bot):
    await bot.add_cog(EnrollmentCog(bot))
