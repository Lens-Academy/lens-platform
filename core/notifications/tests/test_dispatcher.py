"""Tests for notification dispatcher."""

import pytest
from unittest.mock import AsyncMock, patch


class TestSendNotification:
    @pytest.mark.asyncio
    async def test_sends_email_when_enabled(self):
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email", return_value=True
            ) as mock_email:
                with patch(
                    "core.notifications.dispatcher.send_discord_dm",
                    AsyncMock(return_value=True),
                ):
                    result = await send_notification(
                        user_id=1,
                        message_type="welcome",
                        context={
                            "profile_url": "https://example.com/profile",
                            "discord_invite_url": "https://discord.gg/test",
                        },
                    )

        assert result["email"] is True
        assert result["discord"] is False
        mock_email.assert_called_once()

    @pytest.mark.asyncio
    async def test_sends_discord_when_enabled(self):
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "email_notifications_enabled": False,
            "dm_notifications_enabled": True,
        }

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch("core.notifications.dispatcher.send_email", return_value=True):
                with patch(
                    "core.notifications.dispatcher.send_discord_dm",
                    AsyncMock(return_value=True),
                ) as mock_dm:
                    result = await send_notification(
                        user_id=1,
                        message_type="welcome",
                        context={
                            "profile_url": "https://example.com/profile",
                            "discord_invite_url": "https://discord.gg/test",
                        },
                    )

        assert result["email"] is False
        assert result["discord"] is True
        mock_dm.assert_called_once()

    @pytest.mark.asyncio
    async def test_sends_both_when_both_enabled(self):
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "email_notifications_enabled": True,
            "dm_notifications_enabled": True,
        }

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email", return_value=True
            ) as mock_email:
                with patch(
                    "core.notifications.dispatcher.send_discord_dm",
                    AsyncMock(return_value=True),
                ) as mock_dm:
                    result = await send_notification(
                        user_id=1,
                        message_type="welcome",
                        context={
                            "profile_url": "https://example.com/profile",
                            "discord_invite_url": "https://discord.gg/test",
                        },
                    )

        assert result["email"] is True
        assert result["discord"] is True
        mock_email.assert_called_once()
        mock_dm.assert_called_once()
