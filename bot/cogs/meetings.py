"""
Meetings Cog
Handles meeting creation, scheduling, reminders, and attendance tracking.
"""

import discord
from discord import app_commands
from discord.ext import commands
import asyncio
from datetime import datetime, timezone, timedelta


class MeetingsCog(commands.Cog):
    """Cog for meeting management and attendance tracking."""

    def __init__(self, bot):
        self.bot = bot
        # Track active meetings for attendance
        # channel_id -> {"attendees": set(), "attendee_names": {}, "report_channel": id, "creator": id}
        self.active_meetings = {}

    @commands.Cog.listener()
    async def on_voice_state_update(self, member, before, after):
        """Track when users join voice channels for meeting attendance."""
        # User joined a voice channel
        if after.channel and after.channel.id in self.active_meetings:
            self.active_meetings[after.channel.id]["attendees"].add(member.id)
            self.active_meetings[after.channel.id]["attendee_names"][member.id] = member.display_name

    @app_commands.command(name="test-reminder", description="Test meeting reminder (creates Discord event with voice channel)")
    async def test_reminder(self, interaction: discord.Interaction):
        """Create a test Discord scheduled event with a voice channel to join."""
        if not interaction.guild:
            await interaction.response.send_message(
                "This command must be used in a server!",
                ephemeral=True
            )
            return

        try:
            # Create a voice channel for the meeting
            voice_channel = await interaction.guild.create_voice_channel(
                name="Test Cohort Meeting",
                reason="Created for test cohort meeting"
            )

            # Create scheduled event starting in 10 seconds
            start_time = datetime.now(timezone.utc) + timedelta(seconds=10)
            end_time = start_time + timedelta(minutes=30)

            event = await interaction.guild.create_scheduled_event(
                name="Test Cohort Meeting",
                description=f"Test meeting created by {interaction.user.display_name}\n\nThis is a demo of the cohort scheduling system.\n\nClick the voice channel to join!",
                start_time=start_time,
                end_time=end_time,
                entity_type=discord.EntityType.voice,
                channel=voice_channel,
                privacy_level=discord.PrivacyLevel.guild_only
            )

            await interaction.response.send_message(
                f"📅 **Discord Event Created!**\n\n"
                f"**Event:** {event.name}\n"
                f"**Voice Channel:** {voice_channel.mention}\n"
                f"**Starts:** <t:{int(start_time.timestamp())}:R>\n"
                f"**Duration:** 30 minutes\n\n"
                f"Click the voice channel or check the Events tab to join!",
                ephemeral=True
            )

            # Register meeting for attendance tracking
            self.active_meetings[voice_channel.id] = {
                "attendees": set(),
                "attendee_names": {},
                "report_channel": interaction.channel_id,
                "creator": interaction.user.id
            }

            # Wait and send a reminder with clickable voice channel
            await asyncio.sleep(5)
            await interaction.followup.send(
                f"⏰ **Reminder:** {interaction.user.mention}\n"
                f"Your **{event.name}** starts <t:{int(start_time.timestamp())}:R>!\n\n"
                f"👉 **Join here:** {voice_channel.mention}",
                ephemeral=False
            )

            # Wait for meeting to end (30 seconds for testing, would be 30 minutes in production)
            await asyncio.sleep(30)

            # Generate attendance report
            meeting_data = self.active_meetings.pop(voice_channel.id, None)
            if meeting_data:
                attendees = meeting_data["attendee_names"]

                if attendees:
                    attendee_list = "\n".join([f"• {name}" for name in attendees.values()])
                    report = (
                        f"📊 **Meeting Attendance Report**\n\n"
                        f"**Event:** {event.name}\n"
                        f"**Total Attendees:** {len(attendees)}\n\n"
                        f"**Who joined:**\n{attendee_list}"
                    )
                else:
                    report = (
                        f"📊 **Meeting Attendance Report**\n\n"
                        f"**Event:** {event.name}\n"
                        f"**Total Attendees:** 0\n\n"
                        f"No one joined the meeting."
                    )

                await interaction.followup.send(report, ephemeral=False)

            # Clean up - delete the voice channel
            try:
                await voice_channel.delete(reason="Meeting ended")
            except:
                pass

        except discord.Forbidden:
            await interaction.response.send_message(
                "❌ Missing permissions to create events or voice channels!",
                ephemeral=True
            )
        except Exception as e:
            await interaction.response.send_message(
                f"❌ Error creating event: {e}",
                ephemeral=True
            )


async def setup(bot):
    await bot.add_cog(MeetingsCog(bot))
