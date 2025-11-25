"""
Courses Cog
Handles course content library, progress tracking, and week unlocking.
Admins can add courses without code changes - bot auto-discovers them.
"""

import discord
from discord import app_commands
from discord.ext import commands

from utils import (
    get_user_data, save_user_data,
    load_courses, save_courses, get_course
)


class CoursesCog(commands.Cog):
    """Cog for course content library and progress tracking."""

    def __init__(self, bot):
        self.bot = bot

    # ============ ADMIN COMMANDS ============

    @app_commands.command(name="add-course", description="[Admin] Add a new course to the library")
    @app_commands.checks.has_permissions(administrator=True)
    async def add_course(self, interaction: discord.Interaction, course_id: str, name: str, description: str = ""):
        """Create a new course with its category."""
        await interaction.response.defer(ephemeral=True)

        courses = load_courses()

        if course_id in courses:
            await interaction.followup.send(f"Course `{course_id}` already exists!")
            return

        # Create category for the course
        category = await interaction.guild.create_category(
            name=f"📚 {name}",
            reason=f"Course library for {course_id}"
        )

        # Set default permissions - hidden from everyone except admins
        await category.set_permissions(
            interaction.guild.default_role,
            view_channel=False
        )

        # Save course data
        courses[course_id] = {
            "name": name,
            "description": description,
            "category_id": category.id,
            "weeks": []
        }
        save_courses(courses)

        await interaction.followup.send(
            f"✅ Course `{course_id}` created!\n"
            f"**Name:** {name}\n"
            f"**Category:** {category.mention}\n\n"
            f"Now add weeks with `/add-week {course_id} 1 \"Week Title\"`"
        )

    @app_commands.command(name="add-week", description="[Admin] Add a week to a course")
    @app_commands.checks.has_permissions(administrator=True)
    async def add_week(self, interaction: discord.Interaction, course_id: str, week_number: int, title: str):
        """Add a new week channel to a course."""
        await interaction.response.defer(ephemeral=True)

        courses = load_courses()

        if course_id not in courses:
            await interaction.followup.send(f"Course `{course_id}` not found! Use `/add-course` first.")
            return

        course = courses[course_id]

        # Check if week already exists
        for week in course["weeks"]:
            if week["number"] == week_number:
                await interaction.followup.send(f"Week {week_number} already exists in `{course_id}`!")
                return

        # Get category
        category = interaction.guild.get_channel(course["category_id"])
        if not category:
            await interaction.followup.send(f"Course category not found! Was it deleted?")
            return

        # Create week channel
        channel = await interaction.guild.create_text_channel(
            name=f"week-{week_number}-{title.lower().replace(' ', '-')[:20]}",
            category=category,
            reason=f"Week {week_number} for {course_id}"
        )

        # Set permissions - hidden by default
        await channel.set_permissions(
            interaction.guild.default_role,
            view_channel=False
        )

        # Post template content message
        content_message = await channel.send(
            f"# Week {week_number}: {title}\n\n"
            f"## 📖 Core Reading\n"
            f"*Add your readings here*\n\n"
            f"## 🎥 Video Content\n"
            f"*Add video links here*\n\n"
            f"## 💡 Key Concepts\n"
            f"- Concept 1\n"
            f"- Concept 2\n\n"
            f"## 🤔 Discussion Questions\n"
            f"1. Question 1?\n"
            f"2. Question 2?\n\n"
            f"---\n"
            f"## ✅ Mark Complete\n"
            f"React with ✅ to this message when you've completed this week's content.\n"
            f"This will unlock the next week!"
        )

        # Add checkmark reaction for easy clicking
        await content_message.add_reaction("✅")

        # Save week data
        course["weeks"].append({
            "number": week_number,
            "title": title,
            "channel_id": channel.id,
            "message_id": content_message.id
        })

        # Sort weeks by number
        course["weeks"].sort(key=lambda w: w["number"])
        save_courses(courses)

        await interaction.followup.send(
            f"✅ Week {week_number} added to `{course_id}`!\n"
            f"**Channel:** {channel.mention}\n"
            f"**Title:** {title}\n\n"
            f"Edit the channel content as needed. The ✅ reaction tracker is already set up."
        )

    @app_commands.command(name="list-courses", description="List all available courses")
    async def list_courses(self, interaction: discord.Interaction):
        """Show all courses and their weeks."""
        courses = load_courses()

        if not courses:
            await interaction.response.send_message(
                "No courses available yet. Admins can add courses with `/add-course`.",
                ephemeral=True
            )
            return

        embed = discord.Embed(
            title="📚 Course Library",
            color=discord.Color.blue()
        )

        for course_id, course in courses.items():
            weeks_str = f"{len(course['weeks'])} weeks" if course['weeks'] else "No weeks yet"
            embed.add_field(
                name=f"{course_id} - {course['name']}",
                value=f"{course['description']}\n*{weeks_str}*" if course['description'] else f"*{weeks_str}*",
                inline=False
            )

        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="my-progress", description="View your course progress")
    async def my_progress(self, interaction: discord.Interaction):
        """Show user's progress in all enrolled courses."""
        user_id = str(interaction.user.id)
        user_data = get_user_data(user_id)

        if not user_data:
            await interaction.response.send_message(
                "You haven't signed up yet! Use `/signup` to get started.",
                ephemeral=True
            )
            return

        enrolled_courses = user_data.get("courses", [])
        progress = user_data.get("course_progress", {})
        courses = load_courses()

        if not enrolled_courses:
            await interaction.response.send_message(
                "You're not enrolled in any courses. Use `/signup` to enroll.",
                ephemeral=True
            )
            return

        embed = discord.Embed(
            title="📊 Your Course Progress",
            color=discord.Color.green()
        )

        for course_id in enrolled_courses:
            if course_id not in courses:
                continue

            course = courses[course_id]
            total_weeks = len(course["weeks"])

            if course_id in progress:
                completed = progress[course_id].get("completed_weeks", [])
                current = progress[course_id].get("current_week", 1)
            else:
                completed = []
                current = 1

            completed_count = len(completed)

            # Progress bar
            if total_weeks > 0:
                filled = int((completed_count / total_weeks) * 10)
                bar = "▓" * filled + "░" * (10 - filled)
                progress_str = f"{bar} {completed_count}/{total_weeks}"
            else:
                progress_str = "No weeks available"

            embed.add_field(
                name=f"{course['name']}",
                value=f"**Progress:** {progress_str}\n**Current Week:** {current}",
                inline=False
            )

        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="delete-course", description="[Admin] Delete a course and all its channels")
    @app_commands.checks.has_permissions(administrator=True)
    async def delete_course(self, interaction: discord.Interaction, course_id: str):
        """Delete a course and optionally its Discord channels."""
        await interaction.response.defer(ephemeral=True)

        courses = load_courses()

        if course_id not in courses:
            await interaction.followup.send(f"Course `{course_id}` not found!")
            return

        course = courses[course_id]

        # Delete channels
        for week in course["weeks"]:
            channel = interaction.guild.get_channel(week["channel_id"])
            if channel:
                await channel.delete(reason=f"Deleting course {course_id}")

        # Delete category
        category = interaction.guild.get_channel(course["category_id"])
        if category:
            await category.delete(reason=f"Deleting course {course_id}")

        # Remove from data
        del courses[course_id]
        save_courses(courses)

        await interaction.followup.send(f"✅ Course `{course_id}` and all its channels have been deleted.")

    # ============ REACTION TRACKING ============

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        """Track when users complete weeks by reacting with ✅."""
        if payload.emoji.name != "✅":
            return

        # Ignore bot reactions
        if payload.user_id == self.bot.user.id:
            return

        courses = load_courses()

        # Find which course/week this message belongs to
        for course_id, course in courses.items():
            for week in course["weeks"]:
                if week["message_id"] == payload.message_id:
                    await self._handle_week_completion(
                        payload.user_id,
                        payload.guild_id,
                        course_id,
                        course,
                        week["number"]
                    )
                    return

    async def _handle_week_completion(self, user_id: int, guild_id: int, course_id: str, course: dict, week_number: int):
        """Handle a user completing a week."""
        user_id_str = str(user_id)
        user_data = get_user_data(user_id_str)

        if not user_data:
            return

        # Check if user is enrolled in this course
        if course_id not in user_data.get("courses", []):
            return

        # Initialize progress if needed
        if "course_progress" not in user_data:
            user_data["course_progress"] = {}
        if course_id not in user_data["course_progress"]:
            user_data["course_progress"][course_id] = {
                "current_week": 1,
                "completed_weeks": []
            }

        progress = user_data["course_progress"][course_id]

        # Mark week as completed
        if week_number not in progress["completed_weeks"]:
            progress["completed_weeks"].append(week_number)
            progress["completed_weeks"].sort()

        # Update current week to next
        next_week = week_number + 1
        if next_week > progress["current_week"]:
            progress["current_week"] = next_week

        save_user_data(user_id_str, user_data)

        # Unlock next week channel
        guild = self.bot.get_guild(guild_id)
        if not guild:
            return

        member = guild.get_member(user_id)
        if not member:
            return

        # Find next week channel
        for week in course["weeks"]:
            if week["number"] == next_week:
                channel = guild.get_channel(week["channel_id"])
                if channel:
                    await channel.set_permissions(
                        member,
                        view_channel=True,
                        read_message_history=True
                    )

                    # DM user about unlock
                    try:
                        await member.send(
                            f"🎉 **Week {week_number} complete!**\n\n"
                            f"You've unlocked **Week {next_week}: {week['title']}** in {course['name']}.\n"
                            f"Check it out: <#{channel.id}>"
                        )
                    except discord.Forbidden:
                        pass  # User has DMs disabled
                break

    # ============ ENROLLMENT INTEGRATION ============

    async def enroll_user_in_course(self, member: discord.Member, course_id: str):
        """Grant a user access to week 1 of a course."""
        courses = load_courses()

        if course_id not in courses:
            return False

        course = courses[course_id]

        # Initialize user progress
        user_id = str(member.id)
        user_data = get_user_data(user_id)

        if "course_progress" not in user_data:
            user_data["course_progress"] = {}

        if course_id not in user_data["course_progress"]:
            user_data["course_progress"][course_id] = {
                "current_week": 1,
                "completed_weeks": []
            }
            save_user_data(user_id, user_data)

        # Get user's current progress
        progress = user_data["course_progress"][course_id]
        current_week = progress.get("current_week", 1)
        completed_weeks = progress.get("completed_weeks", [])

        # Grant access to all completed weeks plus current week
        for week in course["weeks"]:
            if week["number"] <= current_week or week["number"] in completed_weeks:
                channel = member.guild.get_channel(week["channel_id"])
                if channel:
                    await channel.set_permissions(
                        member,
                        view_channel=True,
                        read_message_history=True
                    )

        return True

    async def unenroll_user_from_course(self, member: discord.Member, course_id: str):
        """Remove a user's access to all course channels."""
        courses = load_courses()

        if course_id not in courses:
            return False

        course = courses[course_id]

        # Remove access to all weeks
        for week in course["weeks"]:
            channel = member.guild.get_channel(week["channel_id"])
            if channel:
                await channel.set_permissions(
                    member,
                    overwrite=None  # Remove all overwrites for this user
                )

        return True

    async def sync_user_courses(self, member: discord.Member, new_courses: list, old_courses: list):
        """Sync a user's course access when they update their enrollment."""
        # Remove access from courses they left
        for course_id in old_courses:
            if course_id not in new_courses:
                await self.unenroll_user_from_course(member, course_id)

        # Add access to new courses
        for course_id in new_courses:
            if course_id not in old_courses:
                await self.enroll_user_in_course(member, course_id)


async def setup(bot):
    await bot.add_cog(CoursesCog(bot))
