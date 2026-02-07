"""Clean up leftover breakout rooms and restore channel names in dev guild."""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv

load_dotenv()
load_dotenv(".env.local", override=True)

import discord


async def main():
    token = os.environ["DISCORD_BOT_TOKEN"]
    guild_id = int(os.environ["TEST_GUILD_ID"])

    intents = discord.Intents.default()
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        guild = client.get_guild(guild_id)
        if not guild:
            print(f"Guild {guild_id} not found")
            await client.close()
            return

        print(f"Connected to guild: {guild.name}")

        for channel in guild.voice_channels:
            # Delete leftover breakout rooms
            if channel.name.startswith("Breakout "):
                print(f"Deleting breakout room: {channel.name}")
                await channel.delete(reason="Cleanup leftover breakout room")

            # Restore renamed channels
            if channel.name.startswith("⛔ "):
                prefix = "⛔ Not a breakout room. "
                if channel.name.startswith(prefix):
                    original = channel.name[len(prefix) :]
                else:
                    original = channel.name[2:]  # Just strip "⛔ "
                print(f"Restoring channel name: '{channel.name}' -> '{original}'")
                await channel.edit(name=original)

        print("Done!")
        await client.close()

    await client.start(token)


asyncio.run(main())
