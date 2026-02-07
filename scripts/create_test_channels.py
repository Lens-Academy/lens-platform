"""Create test category + channels in dev guild to test breakout room permissions."""

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

        # Find existing Test Cohort category
        category = discord.utils.get(guild.categories, name="Test Cohort")
        if not category:
            print("Category 'Test Cohort' not found!")
            await client.close()
            return
        print(f"Found category: {category.name}")

        # Find existing cohort channel
        cohort_channel = discord.utils.get(
            category.text_channels, name="general-test-cohort"
        )
        if not cohort_channel:
            print("Cohort channel not found!")
            await client.close()
            return

        # Create Group B role
        role_b = await guild.create_role(
            name="Test Cohort - Group B",
            reason="Test setup for breakout room permissions",
        )
        print(f"Created role: {role_b.name}")

        # Give Group B access to cohort channel
        await cohort_channel.set_permissions(
            role_b,
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            reason="Group role access to cohort channel",
        )
        print(f"Added {role_b.name} to cohort channel")

        # Create Group B text channel
        text_channel_b = await guild.create_text_channel(
            name="group-b",
            category=category,
            reason="Test group text channel",
        )
        await text_channel_b.set_permissions(
            role_b,
            view_channel=True,
            send_messages=True,
            read_message_history=True,
            reason="Group role access",
        )
        print(f"Created group text channel: {text_channel_b.name}")

        # Create Group B voice channel
        voice_channel_b = await guild.create_voice_channel(
            name="Group B Voice",
            category=category,
            reason="Test group voice channel",
        )
        await voice_channel_b.set_permissions(
            role_b,
            view_channel=True,
            connect=True,
            speak=True,
            reason="Group role access",
        )
        print(f"Created group voice channel: {voice_channel_b.name}")

        print(f"\nDone! Assign the '{role_b.name}' role to test bots.")
        print(f"Role ID: {role_b.id}")

        await client.close()

    await client.start(token)


asyncio.run(main())
