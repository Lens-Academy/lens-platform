"""
Courses Cog - Discord adapter for course management.
Google Docs backed course management.
"""

import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import (
    load_courses, save_courses, get_course,
    extract_doc_id, fetch_google_doc, parse_doc_tabs,
    mark_week_complete, get_user_progress
)
# User data still on JSON for courses (pending courses DB migration)
from core.data import get_user_data


class CoursesCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="add-course", description="[Admin] Add course from Google Doc URL")
    @app_commands.checks.has_permissions(administrator=True)
    async def add_course(self, interaction: discord.Interaction, url: str, course_id: str = None):
        """Create course from Google Doc. Each tab becomes a week channel."""
        await interaction.response.defer(ephemeral=True)

        doc_id = extract_doc_id(url)
        if not doc_id:
            return await interaction.followup.send("Invalid Google Docs URL")

        doc, error = await fetch_google_doc(doc_id)
        if error:
            return await interaction.followup.send(f"❌ {error}")

        tabs = parse_doc_tabs(doc, url)
        if not tabs:
            return await interaction.followup.send("No tabs found in document")

        name = doc.get("title", "Untitled Course")
        course_id = course_id or name.lower().replace(" ", "-")[:20]
        courses = load_courses()

        if course_id in courses:
            return await interaction.followup.send(f"Course `{course_id}` already exists!")

        # Create category
        category = await interaction.guild.create_category(f"📚 {name}")
        await category.set_permissions(interaction.guild.default_role, view_channel=False)

        # Create week channels from tabs
        weeks = []
        for i, (title, tab_id, tab_url) in enumerate(tabs, 1):
            channel_name = title.lower().replace(" ", "-").replace(":", "")[:50]
            channel = await interaction.guild.create_text_channel(channel_name, category=category)
            await channel.set_permissions(interaction.guild.default_role, view_channel=False)

            # Simple message with title and link to Google Doc tab
            msg_content = f"# {title}\n\n📄 **Read the content here:** {tab_url}\n\n---\nReact ✅ when complete!"
            complete_msg = await channel.send(msg_content)
            await complete_msg.add_reaction("✅")
            weeks.append({"number": i, "title": title, "tab_id": tab_id, "tab_url": tab_url, "channel_id": channel.id, "message_id": complete_msg.id})

        courses[course_id] = {"name": name, "doc_url": url, "category_id": category.id, "weeks": weeks}
        save_courses(courses)

        await interaction.followup.send(f"✅ Created `{course_id}` with {len(weeks)} weeks from Google Doc")

    @app_commands.command(name="sync-course", description="[Admin] Sync course content from Google Doc")
    @app_commands.checks.has_permissions(administrator=True)
    async def sync_course(self, interaction: discord.Interaction, course_id: str):
        """Update channel content from Google Doc."""
        await interaction.response.defer(ephemeral=True)
        courses = load_courses()

        if course_id not in courses:
            return await interaction.followup.send(f"Course `{course_id}` not found")

        course = courses[course_id]
        doc_id = extract_doc_id(course["doc_url"])
        doc, error = await fetch_google_doc(doc_id)
        if error:
            return await interaction.followup.send(f"❌ {error}")

        tabs = parse_doc_tabs(doc, course["doc_url"])
        updated = 0
        for week in course["weeks"]:
            if week["number"] <= len(tabs):
                title, tab_id, tab_url = tabs[week["number"] - 1]
                channel = interaction.guild.get_channel(week["channel_id"])
                if channel:
                    await channel.purge(limit=100)
                    msg_content = f"# {title}\n\n📄 **Read the content here:** {tab_url}\n\n---\nReact ✅ when complete!"
                    complete_msg = await channel.send(msg_content)
                    await complete_msg.add_reaction("✅")
                    week["message_id"] = complete_msg.id
                    week["title"] = title
                    week["tab_id"] = tab_id
                    week["tab_url"] = tab_url
                    updated += 1
        save_courses(courses)
        await interaction.followup.send(f"✅ Synced {updated} weeks")

    @app_commands.command(name="delete-course", description="[Admin] Delete course and channels")
    @app_commands.checks.has_permissions(administrator=True)
    async def delete_course(self, interaction: discord.Interaction, course_id: str):
        await interaction.response.defer(ephemeral=True)
        courses = load_courses()

        if course_id not in courses:
            return await interaction.followup.send(f"Course `{course_id}` not found")

        course = courses[course_id]

        # Delete category and all channels inside it
        try:
            cat = await interaction.guild.fetch_channel(course["category_id"])
            for channel in cat.channels:
                await channel.delete(reason=f"Deleting course {course_id}")
            await cat.delete(reason=f"Deleting course {course_id}")
        except discord.NotFound:
            for week in course["weeks"]:
                try:
                    ch = await interaction.guild.fetch_channel(week["channel_id"])
                    await ch.delete(reason=f"Deleting course {course_id}")
                except discord.NotFound:
                    pass

        del courses[course_id]
        save_courses(courses)
        await interaction.followup.send(f"✅ Deleted `{course_id}`")

    @app_commands.command(name="list-courses", description="List all courses")
    async def list_courses(self, interaction: discord.Interaction):
        courses = load_courses()
        if not courses:
            return await interaction.response.send_message("No courses yet.", ephemeral=True)

        lines = [f"**{cid}** - {c['name']} ({len(c['weeks'])} weeks)" for cid, c in courses.items()]
        await interaction.response.send_message("📚 **Courses**\n" + "\n".join(lines), ephemeral=True)

    @app_commands.command(name="my-progress", description="View your course progress")
    async def my_progress(self, interaction: discord.Interaction):
        user_data = get_user_data(str(interaction.user.id))
        if not user_data or not user_data.get("courses"):
            return await interaction.response.send_message("Not enrolled in any courses.", ephemeral=True)

        courses = load_courses()
        lines = []
        for cid in user_data.get("courses", []):
            if cid not in courses:
                continue
            course = courses[cid]
            prog = get_user_progress(str(interaction.user.id), cid)
            done = len(prog.get("completed_weeks", []))
            total = len(course["weeks"])
            bar = "▓" * done + "░" * (total - done)
            lines.append(f"**{course['name']}**: {bar} {done}/{total}")

        await interaction.response.send_message("📊 **Progress**\n" + "\n".join(lines), ephemeral=True)

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        if payload.emoji.name != "✅" or payload.user_id == self.bot.user.id:
            return

        courses = load_courses()
        for cid, course in courses.items():
            for week in course["weeks"]:
                if week["message_id"] == payload.message_id:
                    await self._complete_week(payload, cid, course, week["number"])
                    return

    async def _complete_week(self, payload, course_id: str, course: dict, week_num: int):
        user_id = str(payload.user_id)
        user_data = get_user_data(user_id)
        if not user_data or course_id not in user_data.get("courses", []):
            return

        # Mark week complete using core function
        mark_week_complete(user_id, course_id, week_num)

        # Unlock next week (Discord-specific)
        guild = self.bot.get_guild(payload.guild_id)
        if not guild:
            return
        try:
            member = await guild.fetch_member(payload.user_id)
        except discord.NotFound:
            return

        for w in course["weeks"]:
            if w["number"] == week_num + 1:
                ch = guild.get_channel(w["channel_id"])
                if ch:
                    await ch.set_permissions(member, view_channel=True, read_message_history=True)
                    try:
                        await member.send(f"🎉 Week {week_num} done! Unlocked **{w['title']}**")
                    except discord.Forbidden:
                        pass
                break

    async def enroll_user_in_course(self, member: discord.Member, course_id: str):
        """Grant user access to week 1 (and any completed weeks)."""
        courses = load_courses()
        if course_id not in courses:
            return False

        course = courses[course_id]
        prog = get_user_progress(str(member.id), course_id)

        for week in course["weeks"]:
            if week["number"] <= prog["current_week"] or week["number"] in prog["completed_weeks"]:
                ch = member.guild.get_channel(week["channel_id"])
                if ch:
                    await ch.set_permissions(member, view_channel=True)
        return True

    async def unenroll_user_from_course(self, member: discord.Member, course_id: str):
        """Remove user access from all course channels."""
        courses = load_courses()
        if course_id not in courses:
            return False
        for week in courses[course_id]["weeks"]:
            ch = member.guild.get_channel(week["channel_id"])
            if ch:
                await ch.set_permissions(member, overwrite=None)
        return True

    async def sync_user_courses(self, member: discord.Member, new_courses: list, old_courses: list):
        """Sync user's course access on enrollment changes."""
        for cid in old_courses:
            if cid not in new_courses:
                await self.unenroll_user_from_course(member, cid)
        for cid in new_courses:
            if cid not in old_courses:
                await self.enroll_user_in_course(member, cid)


async def setup(bot):
    await bot.add_cog(CoursesCog(bot))
