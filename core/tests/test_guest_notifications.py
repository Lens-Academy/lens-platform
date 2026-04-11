"""Tests for guest visit channel notifications."""

import pytest
from unittest.mock import AsyncMock, Mock, patch


def _make_mapping_result(rows):
    """Helper to create a mock result that supports .mappings().first() and iteration."""
    mock_result = Mock()
    mock_mappings = Mock()
    mock_mappings.first.return_value = rows[0] if rows else None
    mock_mappings.__iter__ = Mock(return_value=iter(rows))
    mock_result.mappings.return_value = mock_mappings
    mock_result.rowcount = len(rows)
    return mock_result


class TestNotifyGuestRoleChanges:
    """Tests for notify_guest_role_changes()."""

    @pytest.mark.asyncio
    async def test_sends_grant_message_for_guest(self):
        """When a guest is granted the role, posts grant message with home group name."""
        mock_conn = AsyncMock()

        # Query 1: group text channel
        group_row = {"discord_text_channel_id": "999888777"}
        # Query 2: guest info (discord_id + name)
        guest_row = {"discord_id": "111222333", "name": "Alice"}

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([group_row]),
                _make_mapping_result([guest_row]),
            ]
        )

        sync_result = {
            "granted_discord_ids": ["111222333"],
            "revoked_discord_ids": [],
        }

        with patch("core.guest_notifications.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.guest_notifications.send_channel_message",
                new_callable=AsyncMock,
            ) as mock_send:
                mock_send.return_value = True
                from core.guest_notifications import notify_guest_role_changes

                await notify_guest_role_changes(group_id=1, sync_result=sync_result)

                mock_send.assert_called_once_with(
                    "999888777",
                    "Alice is joining this week's meeting because they can't make it to their regular group's meeting. They've been added to this channel.",
                )

    @pytest.mark.asyncio
    async def test_sends_revoke_message_for_guest(self):
        """When a guest's role is revoked, posts revoke message."""
        mock_conn = AsyncMock()

        # Query 1: group text channel
        group_row = {"discord_text_channel_id": "999888777"}
        # Query 2: guest info (discord_id + name)
        guest_row = {"discord_id": "111222333", "name": "Bob"}

        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([group_row]),
                _make_mapping_result([guest_row]),
            ]
        )

        sync_result = {
            "granted_discord_ids": [],
            "revoked_discord_ids": ["111222333"],
        }

        with patch("core.guest_notifications.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.guest_notifications.send_channel_message",
                new_callable=AsyncMock,
            ) as mock_send:
                mock_send.return_value = True
                from core.guest_notifications import notify_guest_role_changes

                await notify_guest_role_changes(group_id=1, sync_result=sync_result)

                mock_send.assert_called_once_with(
                    "999888777",
                    "Bob joined as a guest for last week's meeting and will now be removed from this channel again.",
                )

    @pytest.mark.asyncio
    async def test_skips_non_guest_role_changes(self):
        """No messages for regular member grant/revoke."""
        mock_conn = AsyncMock()

        # Query 1: group text channel
        group_row = {"discord_text_channel_id": "999888777"}
        # Query 2: guest info returns empty (none of the changed IDs are guests)
        mock_conn.execute = AsyncMock(
            side_effect=[
                _make_mapping_result([group_row]),
                _make_mapping_result([]),  # no guest matches
            ]
        )

        sync_result = {
            "granted_discord_ids": ["555666777"],
            "revoked_discord_ids": [],
        }

        with patch("core.guest_notifications.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.guest_notifications.send_channel_message",
                new_callable=AsyncMock,
            ) as mock_send:
                from core.guest_notifications import notify_guest_role_changes

                await notify_guest_role_changes(group_id=1, sync_result=sync_result)

                mock_send.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_op_when_no_changes(self):
        """Returns immediately when sync_result has empty lists."""
        sync_result = {
            "granted_discord_ids": [],
            "revoked_discord_ids": [],
        }

        with patch("core.guest_notifications.get_connection") as mock_get_conn:
            with patch(
                "core.guest_notifications.send_channel_message",
                new_callable=AsyncMock,
            ) as mock_send:
                from core.guest_notifications import notify_guest_role_changes

                await notify_guest_role_changes(group_id=1, sync_result=sync_result)

                # Should not even open a DB connection
                mock_get_conn.assert_not_called()
                mock_send.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_op_when_no_text_channel(self):
        """Returns silently when group has no text channel."""
        mock_conn = AsyncMock()

        # Query 1: group has no text channel
        group_row = {"discord_text_channel_id": None}
        mock_conn.execute = AsyncMock(return_value=_make_mapping_result([group_row]))

        sync_result = {
            "granted_discord_ids": ["111222333"],
            "revoked_discord_ids": [],
        }

        with patch("core.guest_notifications.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.guest_notifications.send_channel_message",
                new_callable=AsyncMock,
            ) as mock_send:
                from core.guest_notifications import notify_guest_role_changes

                await notify_guest_role_changes(group_id=1, sync_result=sync_result)

                mock_send.assert_not_called()
