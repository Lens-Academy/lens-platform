"""
Test Bot Manager

Manages multiple test bot clients for breakout room testing.
The main bot controls these via the /testbots command.
"""

import os
import asyncio
import discord


class TestBotManager:
    """Manages test bot clients for breakout room testing."""

    def __init__(self):
        self.bots: list[discord.Client] = []
        self._ready_events: list[asyncio.Event] = []

    async def start_all(self):
        """Start all test bot clients from TEST_BOT_TOKENS env var."""
        tokens_str = os.getenv("TEST_BOT_TOKENS", "")
        if not tokens_str:
            print("  No TEST_BOT_TOKENS found, skipping test bots")
            return

        tokens = [t.strip() for t in tokens_str.split(",") if t.strip()]
        print(f"  Starting {len(tokens)} test bot(s)...")

        for i, token in enumerate(tokens):
            intents = discord.Intents.default()
            intents.voice_states = True

            client = discord.Client(intents=intents)
            ready_event = asyncio.Event()

            @client.event
            async def on_ready(c=client, idx=i, evt=ready_event):
                print(f"    Test bot {idx + 1} connected: {c.user}")
                evt.set()

            self.bots.append(client)
            self._ready_events.append(ready_event)

            # Start in background
            asyncio.create_task(client.start(token))

        # Wait for all bots to be ready (with timeout)
        try:
            await asyncio.wait_for(
                asyncio.gather(*[e.wait() for e in self._ready_events]),
                timeout=30.0
            )
        except asyncio.TimeoutError:
            print("  Warning: Some test bots failed to connect")

    async def join_voice(self, channel: discord.VoiceChannel, count: int) -> int:
        """Have `count` test bots join the voice channel."""
        joined = 0
        for bot in self.bots[:count]:
            try:
                guild = bot.get_guild(channel.guild.id)
                if not guild:
                    continue

                vc = guild.get_channel(channel.id)
                if not vc:
                    continue

                # If already in voice, move; otherwise connect
                if guild.voice_client:
                    await guild.voice_client.move_to(vc)
                else:
                    await vc.connect()
                joined += 1
            except Exception as e:
                print(f"  Error joining voice: {e}")

        return joined

    async def leave_voice(self, guild_id: int) -> int:
        """Have all test bots leave voice in the guild."""
        left = 0
        for bot in self.bots:
            try:
                guild = bot.get_guild(guild_id)
                if guild and guild.voice_client:
                    await guild.voice_client.disconnect()
                    left += 1
            except Exception as e:
                print(f"  Error leaving voice: {e}")

        return left

    @property
    def count(self) -> int:
        """Number of test bots available."""
        return len(self.bots)


# Global instance
test_bot_manager = TestBotManager()
