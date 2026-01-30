"""
FakeInteraction for E2E testing with real Discord.

Wraps a real guild but captures/redirects response messages.
"""

import discord
from typing import Optional, Any


class FakeInteraction:
    """
    Minimal interaction mock that wraps a real Discord guild.

    Usage:
        guild = bot.get_guild(DEV_GUILD_ID)
        test_channel = guild.get_channel(TEST_CHANNEL_ID)
        interaction = FakeInteraction(guild, test_channel)
        await cog.realize_cohort(interaction, cohort_id)
    """

    def __init__(
        self,
        guild: discord.Guild,
        response_channel: Optional[discord.TextChannel] = None,
    ):
        self.guild = guild
        self.user = guild.me
        self._response_channel = response_channel
        self._deferred = False
        self.response = self._Response(self)
        self.followup = self._Followup(response_channel)

        # Store responses for assertions
        self.responses: list[Any] = []

    class _Response:
        """Mock for interaction.response."""

        def __init__(self, parent: "FakeInteraction"):
            self._parent = parent

        async def defer(self, ephemeral: bool = False):
            self._parent._deferred = True

        async def send_message(
            self, content: str = None, embed: discord.Embed = None, **kwargs
        ):
            self._parent.responses.append({"content": content, "embed": embed})
            self._parent._deferred = True

        def is_done(self) -> bool:
            return self._parent._deferred

    class _Followup:
        """Mock for interaction.followup."""

        def __init__(self, channel: Optional[discord.TextChannel]):
            self._channel = channel
            self.last_message: Optional[discord.Message] = None
            self.messages: list[Any] = []

        async def send(
            self,
            content: str = None,
            embed: discord.Embed = None,
            ephemeral: bool = False,
            **kwargs,
        ) -> "FakeMessage":
            """
            Capture the message and optionally send to test channel.
            Returns a FakeMessage that can be edited.
            """
            msg_data = {"content": content, "embed": embed}
            self.messages.append(msg_data)

            fake_msg = FakeMessage(content, embed, self._channel)
            self.last_message = fake_msg

            # Optionally send to real channel for visibility
            if self._channel:
                real_msg = await self._channel.send(content=content, embed=embed)
                fake_msg._real_message = real_msg

            return fake_msg


class FakeMessage:
    """Mock message that can be edited."""

    def __init__(
        self,
        content: str = None,
        embed: discord.Embed = None,
        channel: discord.TextChannel = None,
    ):
        self.content = content
        self.embed = embed
        self._channel = channel
        self._real_message: Optional[discord.Message] = None

    async def edit(self, content: str = None, embed: discord.Embed = None, **kwargs):
        """Edit the message content."""
        if content is not None:
            self.content = content
        if embed is not None:
            self.embed = embed

        # Edit real message if exists
        if self._real_message:
            await self._real_message.edit(content=content, embed=embed)
