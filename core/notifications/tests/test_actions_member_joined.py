"""Tests for notify_member_joined action."""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_notify_member_joined_sends_email_and_channel_message():
    """notify_member_joined should send email and Discord channel message."""
    with patch(
        "core.notifications.actions.send_notification", new_callable=AsyncMock
    ) as mock_send:
        mock_send.return_value = {"email": "sent", "discord": "sent"}

        from core.notifications.actions import notify_member_joined

        result = await notify_member_joined(
            user_id=123,
            group_name="Test Group",
            meeting_time_utc="Wednesday 15:00",
            member_names=["Alice", "Bob"],
            discord_channel_id="999888777",
            discord_user_id="111222333",
        )

        assert result == {"email": "sent", "discord": "sent"}
        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args.kwargs

        assert call_kwargs["user_id"] == 123
        assert call_kwargs["message_type"] == "member_joined"
        assert call_kwargs["context"]["group_name"] == "Test Group"
        assert call_kwargs["context"]["meeting_time"] == "Wednesday 15:00"
        assert "Alice, Bob" in call_kwargs["context"]["member_names"]
        assert call_kwargs["context"]["member_mention"] == "<@111222333>"
        # IMPORTANT: dispatcher expects channel_id, not discord_channel_id
        assert call_kwargs["channel_id"] == "999888777"
