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


def create_bot() -> commands.Bot:
    """Create and configure the bot instance."""
    intents = discord.Intents.default()
    intents.message_content = True
    intents.voice_states = True  # Required for tracking voice channel joins

    bot = commands.Bot(command_prefix="!", intents=intents)
    return bot


bot = create_bot()


# List of cogs to load
COGS = [
    "cogs.courses",
    "cogs.enrollment",
    "cogs.scheduler",
    "cogs.cohorts",
    # "cogs.meetings",  # Temporarily disabled
]


@bot.event
async def on_ready():
    """Called when the bot is ready and connected to Discord."""
    print(f"Bot is ready! Logged in as {bot.user}")

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

    # Sync slash commands with Discord
    try:
        synced = await bot.tree.sync()
        print(f"\nSynced {len(synced)} command(s):")
        for cmd in bot.tree.get_commands():
            print(f"  /{cmd.name}")
    except Exception as e:
        import traceback
        print(f"Error syncing commands: {e}")
        traceback.print_exc()


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
