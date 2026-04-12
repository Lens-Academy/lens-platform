import pytest
from unittest.mock import AsyncMock, MagicMock
import discord
from discord_bot.cogs.coach_cog import _send_in_chunks, _should_handle


def test_should_handle_ignores_bots():
    msg = MagicMock()
    msg.author.bot = True
    assert _should_handle(msg) is False


def test_should_handle_ignores_non_dm():
    msg = MagicMock()
    msg.author.bot = False
    msg.channel = MagicMock(spec=discord.TextChannel)
    assert _should_handle(msg) is False


def test_should_handle_ignores_empty():
    msg = MagicMock()
    msg.author.bot = False
    msg.channel = MagicMock(spec=discord.DMChannel)
    msg.content = "   "
    assert _should_handle(msg) is False


def test_should_handle_accepts_valid_dm():
    msg = MagicMock()
    msg.author.bot = False
    msg.channel = MagicMock(spec=discord.DMChannel)
    msg.content = "Hello coach!"
    assert _should_handle(msg) is True


@pytest.mark.asyncio
async def test_send_in_chunks_short_message():
    channel = AsyncMock()
    await _send_in_chunks(channel, "Short message")
    channel.send.assert_called_once_with("Short message")


@pytest.mark.asyncio
async def test_send_in_chunks_long_message():
    channel = AsyncMock()
    long_text = "a" * 3000
    await _send_in_chunks(channel, long_text)
    assert channel.send.call_count == 2
