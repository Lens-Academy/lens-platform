"""
AI Safety Education Platform - Discord Bot
Main entry point for the bot.

This bot helps manage cohort enrollment, scheduling, and meetings
for AI safety education courses.
"""

import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
from test_bot_manager import test_bot_manager


def create_bot() -> commands.Bot:
    """Create and configure the bot instance."""
    intents = discord.Intents.default()
    intents.message_content = True
    intents.voice_states = True  # Required for tracking voice channel joins
    intents.presences = True  # Required for presence/activity data
    intents.members = True  # Required for full member data

    bot = commands.Bot(command_prefix="!", intents=intents)
    return bot


bot = create_bot()


# List of cogs to load (refactored as thin adapters, business logic in core/)
COGS = [
    "cogs.ping_cog",
    "cogs.courses_cog",
    "cogs.enrollment_cog",
    "cogs.scheduler_cog",
    "cogs.cohorts_cog",
    "cogs.breakout_cog",
    "cogs.sync_cog",
    "cogs.stampy_cog",
    "cogs.test_nickname_cog",
    "discord_bot.cogs.nickname_cog",  # Full path so web_api gets same module instance
    # "cogs.meetings_cog",  # Temporarily disabled
]


@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: discord.app_commands.AppCommandError):
    """Global error handler for slash commands."""
    if isinstance(error, discord.app_commands.MissingPermissions):
        msg = f"❌ You need **{', '.join(error.missing_permissions)}** permission(s) to use this command."
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)
    else:
        raise error


@bot.event
async def on_ready():
    """Called when the bot is ready and connected to Discord."""
    print(f"Bot is ready! Logged in as {bot.user}")

    # Start test bots for breakout testing
    await test_bot_manager.start_all()

    # Load all cogs
    for cog in COGS:
        try:
            if cog not in bot.extensions:
                await bot.load_extension(cog)
                print(f"  ✓ Loaded {cog}")
            else:
                print(f"  - {cog} already loaded")
        except Exception as e:
            import traceback
            print(f"  ✗ Error loading {cog}: {e}")
            traceback.print_exc()

    # Slash commands are synced manually via !sync command
    # This avoids conflicts with Discord Activities Entry Point
    print("\nRun !sync in Discord to register slash commands")


def main():
    """Main entry point for the bot."""
    # Load environment variables
    load_dotenv()

    # Get token from environment
    token = os.getenv('DISCORD_BOT_TOKEN')

    if not token:
        print("Error: DISCORD_BOT_TOKEN environment variable not set!")
        print("Set it in your .env file or with: set DISCORD_BOT_TOKEN=your_token_here")
        exit(1)

    # Run the bot
    bot.run(token)


if __name__ == "__main__":
    main()
