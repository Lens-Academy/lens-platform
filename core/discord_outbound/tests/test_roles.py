# core/discord_outbound/tests/test_roles.py
"""Tests for Discord role operations."""

import pytest
from unittest.mock import AsyncMock, MagicMock

import discord


class TestCreateRole:
    @pytest.mark.asyncio
    async def test_creates_role_with_name(self):
        from core.discord_outbound.roles import create_role

        mock_guild = MagicMock(spec=discord.Guild)
        mock_role = MagicMock(spec=discord.Role)
        mock_guild.create_role = AsyncMock(return_value=mock_role)

        result = await create_role(mock_guild, "Cohort January 2026 - Group Alpha")

        mock_guild.create_role.assert_called_once_with(
            name="Cohort January 2026 - Group Alpha",
            reason="Group sync",
        )
        assert result == mock_role

    @pytest.mark.asyncio
    async def test_creates_role_with_custom_reason(self):
        from core.discord_outbound.roles import create_role

        mock_guild = MagicMock(spec=discord.Guild)
        mock_role = MagicMock(spec=discord.Role)
        mock_guild.create_role = AsyncMock(return_value=mock_role)

        result = await create_role(mock_guild, "Test Role", reason="Custom reason")

        mock_guild.create_role.assert_called_once_with(
            name="Test Role",
            reason="Custom reason",
        )
        assert result == mock_role

    @pytest.mark.asyncio
    async def test_raises_on_http_exception(self):
        from core.discord_outbound.roles import create_role

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.create_role = AsyncMock(
            side_effect=discord.HTTPException(MagicMock(), "Rate limited")
        )

        with pytest.raises(discord.HTTPException):
            await create_role(mock_guild, "Test Role")


class TestDeleteRole:
    @pytest.mark.asyncio
    async def test_deletes_role_successfully(self):
        from core.discord_outbound.roles import delete_role

        mock_role = MagicMock(spec=discord.Role)
        mock_role.delete = AsyncMock()

        result = await delete_role(mock_role)

        mock_role.delete.assert_called_once_with(reason="Group sync")
        assert result is True

    @pytest.mark.asyncio
    async def test_deletes_role_with_custom_reason(self):
        from core.discord_outbound.roles import delete_role

        mock_role = MagicMock(spec=discord.Role)
        mock_role.delete = AsyncMock()

        result = await delete_role(mock_role, reason="Cleanup")

        mock_role.delete.assert_called_once_with(reason="Cleanup")
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_on_http_exception(self):
        from core.discord_outbound.roles import delete_role

        mock_role = MagicMock(spec=discord.Role)
        mock_role.delete = AsyncMock(
            side_effect=discord.HTTPException(MagicMock(), "Error")
        )

        result = await delete_role(mock_role)

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_on_not_found(self):
        from core.discord_outbound.roles import delete_role

        mock_role = MagicMock(spec=discord.Role)
        mock_response = MagicMock()
        mock_response.status = 404
        mock_role.delete = AsyncMock(
            side_effect=discord.NotFound(mock_response, "Not found")
        )

        result = await delete_role(mock_role)

        # NotFound means role is already gone - that's success
        assert result is True


class TestRenameRole:
    @pytest.mark.asyncio
    async def test_renames_role_successfully(self):
        from core.discord_outbound.roles import rename_role

        mock_role = MagicMock(spec=discord.Role)
        mock_role.edit = AsyncMock()

        result = await rename_role(mock_role, "New Name")

        mock_role.edit.assert_called_once_with(name="New Name", reason="Group sync")
        assert result is True

    @pytest.mark.asyncio
    async def test_renames_role_with_custom_reason(self):
        from core.discord_outbound.roles import rename_role

        mock_role = MagicMock(spec=discord.Role)
        mock_role.edit = AsyncMock()

        result = await rename_role(mock_role, "New Name", reason="Name sync")

        mock_role.edit.assert_called_once_with(name="New Name", reason="Name sync")
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_on_http_exception(self):
        from core.discord_outbound.roles import rename_role

        mock_role = MagicMock(spec=discord.Role)
        mock_role.edit = AsyncMock(
            side_effect=discord.HTTPException(MagicMock(), "Error")
        )

        result = await rename_role(mock_role, "New Name")

        assert result is False


class TestSetRoleChannelPermissions:
    @pytest.mark.asyncio
    async def test_sets_text_channel_permissions(self):
        from core.discord_outbound.roles import set_role_channel_permissions

        mock_role = MagicMock(spec=discord.Role)
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.set_permissions = AsyncMock()

        result = await set_role_channel_permissions(
            mock_role,
            mock_channel,
            view_channel=True,
            send_messages=True,
            read_message_history=True,
        )

        mock_channel.set_permissions.assert_called_once()
        call_kwargs = mock_channel.set_permissions.call_args.kwargs
        assert call_kwargs["view_channel"] is True
        assert call_kwargs["send_messages"] is True
        assert call_kwargs["read_message_history"] is True
        assert call_kwargs["reason"] == "Group sync"
        assert result is True

    @pytest.mark.asyncio
    async def test_sets_voice_channel_permissions(self):
        from core.discord_outbound.roles import set_role_channel_permissions

        mock_role = MagicMock(spec=discord.Role)
        mock_channel = MagicMock(spec=discord.VoiceChannel)
        mock_channel.set_permissions = AsyncMock()

        result = await set_role_channel_permissions(
            mock_role,
            mock_channel,
            view_channel=True,
            connect=True,
            speak=True,
        )

        mock_channel.set_permissions.assert_called_once()
        call_kwargs = mock_channel.set_permissions.call_args.kwargs
        assert call_kwargs["view_channel"] is True
        assert call_kwargs["connect"] is True
        assert call_kwargs["speak"] is True
        assert call_kwargs["reason"] == "Group sync"
        assert result is True

    @pytest.mark.asyncio
    async def test_sets_only_view_channel_by_default(self):
        from core.discord_outbound.roles import set_role_channel_permissions

        mock_role = MagicMock(spec=discord.Role)
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.set_permissions = AsyncMock()

        result = await set_role_channel_permissions(mock_role, mock_channel)

        mock_channel.set_permissions.assert_called_once()
        call_kwargs = mock_channel.set_permissions.call_args.kwargs
        assert call_kwargs["view_channel"] is True
        # None values should not be passed
        assert (
            "send_messages" not in call_kwargs or call_kwargs["send_messages"] is None
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_uses_custom_reason(self):
        from core.discord_outbound.roles import set_role_channel_permissions

        mock_role = MagicMock(spec=discord.Role)
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.set_permissions = AsyncMock()

        result = await set_role_channel_permissions(
            mock_role, mock_channel, reason="Custom reason"
        )

        call_kwargs = mock_channel.set_permissions.call_args.kwargs
        assert call_kwargs["reason"] == "Custom reason"
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_on_http_exception(self):
        from core.discord_outbound.roles import set_role_channel_permissions

        mock_role = MagicMock(spec=discord.Role)
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.set_permissions = AsyncMock(
            side_effect=discord.HTTPException(MagicMock(), "Error")
        )

        result = await set_role_channel_permissions(mock_role, mock_channel)

        assert result is False

    @pytest.mark.asyncio
    async def test_can_deny_view_channel(self):
        from core.discord_outbound.roles import set_role_channel_permissions

        mock_role = MagicMock(spec=discord.Role)
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_channel.set_permissions = AsyncMock()

        result = await set_role_channel_permissions(
            mock_role, mock_channel, view_channel=False
        )

        call_kwargs = mock_channel.set_permissions.call_args.kwargs
        assert call_kwargs["view_channel"] is False
        assert result is True


class TestGetRoleMemberIds:
    def test_returns_member_ids_as_strings(self):
        from core.discord_outbound.roles import get_role_member_ids

        # Create mock members
        mock_member1 = MagicMock(spec=discord.Member)
        mock_member1.id = 123456789
        mock_member2 = MagicMock(spec=discord.Member)
        mock_member2.id = 987654321

        mock_role = MagicMock(spec=discord.Role)
        mock_role.members = [mock_member1, mock_member2]

        result = get_role_member_ids(mock_role)

        assert result == {"123456789", "987654321"}

    def test_returns_empty_set_for_no_members(self):
        from core.discord_outbound.roles import get_role_member_ids

        mock_role = MagicMock(spec=discord.Role)
        mock_role.members = []

        result = get_role_member_ids(mock_role)

        assert result == set()

    def test_returns_set_type(self):
        from core.discord_outbound.roles import get_role_member_ids

        mock_role = MagicMock(spec=discord.Role)
        mock_role.members = []

        result = get_role_member_ids(mock_role)

        assert isinstance(result, set)
