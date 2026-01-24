"""Tests for notification dispatcher."""

import pytest
from unittest.mock import AsyncMock, patch


class TestTimezoneFormatting:
    @pytest.mark.asyncio
    async def test_formats_meeting_time_in_user_timezone(self):
        """meeting_time should be formatted in user's timezone when sending."""
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "timezone": "Asia/Bangkok",  # UTC+7
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        captured_body = None

        def capture_email(to_email, subject, body):
            nonlocal captured_body
            captured_body = body
            return True

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email",
                side_effect=capture_email,
            ):
                await send_notification(
                    user_id=1,
                    message_type="meeting_reminder_24h",
                    context={
                        "meeting_time_utc": "2024-01-10T15:00:00+00:00",  # Wed 15:00 UTC
                        "meeting_time": "Wednesday at 15:00 UTC",  # Fallback
                        "group_name": "Test Group",
                        "module_url": "https://example.com",
                        "module_list": "- Module 1",
                        "discord_channel_url": "https://discord.com/channels/123",
                    },
                )

        # Should be formatted in Bangkok time (UTC+7)
        assert captured_body is not None
        assert "Wednesday at 10:00 PM (UTC+7)" in captured_body
        assert "15:00 UTC" not in captured_body

    @pytest.mark.asyncio
    async def test_uses_utc_fallback_when_no_timezone(self):
        """Should use UTC fallback when user has no timezone set."""
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "timezone": None,  # No timezone
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        captured_body = None

        def capture_email(to_email, subject, body):
            nonlocal captured_body
            captured_body = body
            return True

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email",
                side_effect=capture_email,
            ):
                await send_notification(
                    user_id=1,
                    message_type="meeting_reminder_24h",
                    context={
                        "meeting_time_utc": "2024-01-10T15:00:00+00:00",
                        "meeting_time": "Wednesday at 15:00 UTC",
                        "group_name": "Test Group",
                        "module_url": "https://example.com",
                        "module_list": "- Module 1",
                        "discord_channel_url": "https://discord.com/channels/123",
                    },
                )

        # Should fall back to UTC
        assert captured_body is not None
        assert "Wednesday at 15:00 UTC" in captured_body


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
