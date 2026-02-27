"""Tests for Discord notification channel."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestSendDM:
    @pytest.mark.asyncio
    async def test_sends_dm_to_user(self):
        from core.discord_outbound import send_dm

        mock_bot = MagicMock()
        mock_user = AsyncMock()
        mock_msg = MagicMock()
        mock_msg.id = 999888777
        mock_user.send = AsyncMock(return_value=mock_msg)
        mock_bot.fetch_user = AsyncMock(return_value=mock_user)

        with patch("core.discord_outbound.bot._bot", mock_bot):
            result = await send_dm(
                discord_id="123456789",
                message="Hello!",
            )

        assert result == "999888777"
        mock_bot.fetch_user.assert_called_once_with(123456789)
        mock_user.send.assert_called_once_with("Hello!")

    @pytest.mark.asyncio
    async def test_returns_none_when_bot_not_set(self):
        from core.discord_outbound import send_dm

        with patch("core.discord_outbound.bot._bot", None):
            result = await send_dm(
                discord_id="123456789",
                message="Hello!",
            )

        assert result is None


class TestSendChannelMessage:
    @pytest.mark.asyncio
    async def test_sends_message_to_channel(self):
        from core.discord_outbound import send_channel_message

        mock_bot = MagicMock()
        mock_channel = AsyncMock()
        mock_message = MagicMock()
        mock_message.id = 111222333444
        mock_channel.send = AsyncMock(return_value=mock_message)
        mock_bot.fetch_channel = AsyncMock(return_value=mock_channel)

        with patch("core.discord_outbound.bot._bot", mock_bot):
            result = await send_channel_message(
                channel_id="987654321",
                message="Meeting reminder!",
            )

        assert result == "111222333444"
        mock_bot.fetch_channel.assert_called_once_with(987654321)
        mock_channel.send.assert_called_once_with("Meeting reminder!")

    @pytest.mark.asyncio
    async def test_returns_none_when_bot_not_set(self):
        from core.discord_outbound import send_channel_message

        with patch("core.discord_outbound.bot._bot", None):
            result = await send_channel_message(
                channel_id="987654321",
                message="Hello!",
            )

        assert result is None


class TestEditChannelMessage:
    @pytest.mark.asyncio
    async def test_edits_message_in_channel(self):
        from core.discord_outbound.messages import edit_channel_message

        mock_bot = MagicMock()
        mock_message = AsyncMock()
        mock_channel = AsyncMock()
        mock_channel.fetch_message = AsyncMock(return_value=mock_message)
        mock_bot.fetch_channel = AsyncMock(return_value=mock_channel)

        with patch("core.discord_outbound.bot._bot", mock_bot):
            result = await edit_channel_message(
                channel_id="987654321",
                message_id="111222333444",
                content="Updated content!",
            )

        assert result is True
        mock_bot.fetch_channel.assert_called_once_with(987654321)
        mock_channel.fetch_message.assert_called_once_with(111222333444)
        mock_message.edit.assert_called_once_with(content="Updated content!")

    @pytest.mark.asyncio
    async def test_returns_false_when_bot_not_set(self):
        from core.discord_outbound.messages import edit_channel_message

        with patch("core.discord_outbound.bot._bot", None):
            result = await edit_channel_message(
                channel_id="987654321",
                message_id="111222333444",
                content="Updated!",
            )

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_on_exception(self):
        from core.discord_outbound.messages import edit_channel_message

        mock_bot = MagicMock()
        mock_bot.fetch_channel = AsyncMock(side_effect=Exception("Not found"))

        with patch("core.discord_outbound.bot._bot", mock_bot):
            result = await edit_channel_message(
                channel_id="987654321",
                message_id="111222333444",
                content="Updated!",
            )

        assert result is False
