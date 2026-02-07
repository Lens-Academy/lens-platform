"""Tests for sync operations (TDD)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestSyncMeetingReminders:
    """Test reminder sync logic.

    Note: The old tests for user_ids updating and job removal were deleted
    because the new sync_meeting_reminders is diff-based and doesn't modify
    job kwargs. Tests for the new behavior are in
    core/notifications/tests/test_scheduler.py::TestSyncMeetingReminders.
    """

    @pytest.mark.asyncio
    async def test_does_nothing_when_scheduler_unavailable(self):
        """Should return zero counts if scheduler is not initialized."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Mock the context fetch to avoid DB call
        with patch(
            "core.notifications.context.get_meeting_with_group",
            new_callable=AsyncMock,
        ) as mock_get:
            mock_get.return_value = None  # Meeting not found
            with patch("core.notifications.scheduler._scheduler", None):
                result = await sync_meeting_reminders(meeting_id=5)

        # When meeting not found and scheduler unavailable, returns zero counts
        assert result["created"] == 0
        assert result["deleted"] == 0
        assert result["unchanged"] == 0


class TestSyncGroupDiscordPermissions:
    """Test Discord permissions sync logic."""

    @pytest.mark.asyncio
    async def test_returns_granted_and_revoked_discord_ids(self):
        """Should return lists of user IDs that were granted/revoked access."""
        from core.sync import sync_group_discord_permissions
        import discord

        # Setup: mock DB returns two expected members (discord_ids 111, 222)
        # Discord role currently has one member (discord_id 333)
        # Expected: grant 111, 222; revoke 333

        mock_conn = AsyncMock()

        # Query 1: _ensure_group_role - get group/cohort info
        mock_role_query_result = MagicMock()
        mock_role_query_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "discord_role_id": "777888999",  # Role exists
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
        }

        # Query 2: get group channel info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "discord_text_channel_id": "123456789",
            "discord_voice_channel_id": "987654321",
        }

        # Query 3: _ensure_cohort_channel - get cohort info
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
            "discord_category_id": "555666777",
            "discord_cohort_channel_id": "888999000",  # Cohort channel exists
        }

        # Query 4: get expected members from DB
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {"discord_id": "111"},
            {"discord_id": "222"},
        ]

        # Query 5: get facilitators from DB (empty — no facilitators)
        mock_facilitators_result = MagicMock()
        mock_facilitators_result.mappings.return_value = []

        mock_conn.execute = AsyncMock(
            side_effect=[
                mock_role_query_result,
                mock_group_result,
                mock_cohort_result,
                mock_members_result,
                mock_facilitators_result,
            ]
        )

        # Mock Discord role - currently has member 333
        mock_member_333 = MagicMock(spec=discord.Member)
        mock_member_333.id = 333

        mock_role = MagicMock(spec=discord.Role)
        mock_role.id = 777888999
        mock_role.name = "Cohort Jan 2026 - Group Test Group"
        mock_role.members = [mock_member_333]  # Member 333 currently has this role

        # Mock channels
        mock_text_channel = MagicMock(spec=discord.TextChannel)
        mock_text_channel.id = 123456789
        mock_text_channel.set_permissions = AsyncMock()

        mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
        mock_voice_channel.id = 987654321
        mock_voice_channel.set_permissions = AsyncMock()
        mock_voice_channel.overwrites = {}  # No existing member overwrites

        mock_cohort_channel = MagicMock(spec=discord.TextChannel)
        mock_cohort_channel.id = 888999000
        mock_cohort_channel.name = "general-jan-2026"
        mock_cohort_channel.set_permissions = AsyncMock()

        # Mock guild
        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.roles = [mock_role]  # Less than 250 roles
        mock_guild.me = MagicMock()
        mock_guild.me.guild_permissions = MagicMock()
        mock_guild.me.guild_permissions.manage_roles = True
        mock_guild.get_role.return_value = mock_role
        mock_role.guild = mock_guild

        mock_bot = MagicMock()
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel.side_effect = lambda id: {
            123456789: mock_text_channel,
            987654321: mock_voice_channel,
            888999000: mock_cohort_channel,
            555666777: MagicMock(),  # Category
        }.get(id)

        # Mock get_or_fetch_member to return members for grants, None for revoke (left server)
        async def mock_fetch(guild, discord_id):
            if discord_id in [111, 222]:
                m = MagicMock(spec=discord.Member)
                m.id = discord_id
                m.add_roles = AsyncMock()
                m.remove_roles = AsyncMock()
                return m
            return None  # User 333 left server

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch(
                    "core.discord_outbound.get_or_fetch_member",
                    side_effect=mock_fetch,
                ):
                    with patch(
                        "core.discord_outbound.get_role_member_ids",
                        return_value={"333"},  # Current role members (as strings)
                    ):
                        with patch(
                            "core.sync._set_group_role_permissions",
                            new_callable=AsyncMock,
                        ) as mock_set_perms:
                            mock_set_perms.return_value = {
                                "text": True,
                                "voice": True,
                                "cohort": True,
                            }
                            result = await sync_group_discord_permissions(group_id=1)

        # Verify user ID lists are returned
        assert "granted_discord_ids" in result
        assert "revoked_discord_ids" in result
        assert set(result["granted_discord_ids"]) == {111, 222}
        # 333 was in revoke set but member not found, so not in revoked_discord_ids
        assert result["revoked_discord_ids"] == []
        assert result["granted"] == 2
        assert result["role_status"] == "existed"

    @pytest.mark.asyncio
    async def test_returns_error_when_bot_unavailable(self):
        """Should return error dict if bot is not initialized."""
        from core.sync import sync_group_discord_permissions

        with patch("core.discord_outbound.bot._bot", None):
            result = await sync_group_discord_permissions(group_id=1)

        assert result == {
            "error": "bot_unavailable",
            "granted": 0,
            "revoked": 0,
            "unchanged": 0,
            "failed": 0,
        }

    @pytest.mark.asyncio
    async def test_returns_error_when_group_has_no_channel(self):
        """Should return error if group has no Discord channel."""
        from core.sync import sync_group_discord_permissions
        import discord

        mock_conn = AsyncMock()

        # Mock role query result (first DB query in _ensure_group_role)
        mock_role_result = MagicMock()
        mock_role_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "discord_role_id": "777888999",  # Role exists
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
        }

        # Mock group query result (second DB query for channel info)
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "discord_text_channel_id": None,  # No channel
            "discord_voice_channel_id": None,
        }

        mock_conn.execute = AsyncMock(side_effect=[mock_role_result, mock_group_result])

        # Mock Discord role
        mock_role = MagicMock(spec=discord.Role)
        mock_role.id = 777888999
        mock_role.name = "Cohort Jan 2026 - Group Test Group"
        mock_role.members = []  # No members currently have this role

        # Mock guild
        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.roles = [mock_role]  # Less than 250 roles
        mock_guild.me = MagicMock()
        mock_guild.me.guild_permissions = MagicMock()
        mock_guild.me.guild_permissions.manage_roles = True
        mock_guild.get_role.return_value = mock_role

        mock_bot = MagicMock()
        mock_bot.guilds = [mock_guild]

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await sync_group_discord_permissions(group_id=1)

        assert result["error"] == "no_channel"
        assert result["role_status"] == "existed"
        assert result["granted"] == 0
        assert result["revoked"] == 0
        assert result["unchanged"] == 0
        assert result["failed"] == 0

    @pytest.mark.asyncio
    async def test_returns_error_when_channel_not_found_in_discord(self):
        """Should return error if Discord channel is not found."""
        from core.sync import sync_group_discord_permissions
        import discord

        mock_conn = AsyncMock()

        # Mock role query result (first DB query in _ensure_group_role)
        mock_role_result = MagicMock()
        mock_role_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "discord_role_id": "777888999",
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
        }

        # Mock group query result (for channel info)
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "discord_text_channel_id": "123456789",  # Channel ID exists in DB
            "discord_voice_channel_id": None,
        }

        # Mock cohort query result (for _ensure_cohort_channel)
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
            "discord_category_id": "555666777",
            "discord_cohort_channel_id": None,  # No cohort channel yet
        }

        mock_conn.execute = AsyncMock(
            side_effect=[mock_role_result, mock_group_result, mock_cohort_result]
        )

        # Mock Discord role
        mock_role = MagicMock(spec=discord.Role)
        mock_role.id = 777888999
        mock_role.name = "Cohort Jan 2026 - Group Test Group"
        mock_role.members = []

        # Mock guild
        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.roles = [mock_role]
        mock_guild.me = MagicMock()
        mock_guild.me.guild_permissions = MagicMock()
        mock_guild.me.guild_permissions.manage_roles = True
        mock_guild.get_role.return_value = mock_role

        mock_bot = MagicMock()
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel.return_value = None  # Not in cache
        # fetch_channel raises NotFound when channel deleted from Discord
        import discord

        mock_bot.fetch_channel = AsyncMock(
            side_effect=discord.NotFound(MagicMock(), "Unknown Channel")
        )

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await sync_group_discord_permissions(group_id=1)

        assert result["error"] == "channel_not_found"
        assert result["role_status"] == "existed"
        assert result["granted"] == 0
        assert result["revoked"] == 0
        assert result["unchanged"] == 0
        assert result["failed"] == 0

    @pytest.mark.asyncio
    async def test_grants_facilitator_connect_on_voice_channel(self):
        """DB has facilitator 111, voice channel has no member overwrites
        → should grant connect=True and return facilitator_granted=1."""
        from core.sync import sync_group_discord_permissions
        import discord

        mock_conn = AsyncMock()

        # Query 1: _ensure_group_role - get group/cohort info
        mock_role_query_result = MagicMock()
        mock_role_query_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "discord_role_id": "777888999",
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
        }

        # Query 2: get group channel info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "discord_text_channel_id": "123456789",
            "discord_voice_channel_id": "987654321",
        }

        # Query 3: _ensure_cohort_channel - get cohort info
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
            "discord_category_id": "555666777",
            "discord_cohort_channel_id": "888999000",
        }

        # Query 4: get expected members from DB
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {"discord_id": "111"},
        ]

        # Query 5: get facilitators from DB — member 111 is a facilitator
        mock_facilitators_result = MagicMock()
        mock_facilitators_result.mappings.return_value = [
            {"discord_id": "111"},
        ]

        mock_conn.execute = AsyncMock(
            side_effect=[
                mock_role_query_result,
                mock_group_result,
                mock_cohort_result,
                mock_members_result,
                mock_facilitators_result,
            ]
        )

        # Mock Discord role
        mock_role = MagicMock(spec=discord.Role)
        mock_role.id = 777888999
        mock_role.name = "Cohort Jan 2026 - Group Test Group"
        mock_role.members = []

        # Mock channels
        mock_text_channel = MagicMock(spec=discord.TextChannel)
        mock_text_channel.id = 123456789
        mock_text_channel.set_permissions = AsyncMock()

        mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
        mock_voice_channel.id = 987654321
        mock_voice_channel.set_permissions = AsyncMock()
        mock_voice_channel.overwrites = {}  # No existing member overwrites

        mock_cohort_channel = MagicMock(spec=discord.TextChannel)
        mock_cohort_channel.id = 888999000
        mock_cohort_channel.name = "general-jan-2026"
        mock_cohort_channel.set_permissions = AsyncMock()

        # Mock guild
        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.roles = [mock_role]
        mock_guild.me = MagicMock()
        mock_guild.me.guild_permissions = MagicMock()
        mock_guild.me.guild_permissions.manage_roles = True
        mock_guild.get_role.return_value = mock_role
        mock_role.guild = mock_guild

        mock_bot = MagicMock()
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel.side_effect = lambda id: {
            123456789: mock_text_channel,
            987654321: mock_voice_channel,
            888999000: mock_cohort_channel,
            555666777: MagicMock(),
        }.get(id)

        # Mock member 111
        mock_member_111 = MagicMock(spec=discord.Member)
        mock_member_111.id = 111
        mock_member_111.add_roles = AsyncMock()
        mock_member_111.remove_roles = AsyncMock()

        async def mock_fetch(guild, discord_id):
            if discord_id == 111:
                return mock_member_111
            return None

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch(
                    "core.discord_outbound.get_or_fetch_member",
                    side_effect=mock_fetch,
                ):
                    with patch(
                        "core.discord_outbound.get_role_member_ids",
                        return_value=set(),
                    ):
                        with patch(
                            "core.sync._set_group_role_permissions",
                            new_callable=AsyncMock,
                        ) as mock_set_perms:
                            mock_set_perms.return_value = {
                                "text": True,
                                "voice": True,
                                "cohort": True,
                            }
                            result = await sync_group_discord_permissions(group_id=1)

        # Should have granted connect=True on voice channel for facilitator 111
        mock_voice_channel.set_permissions.assert_any_call(
            mock_member_111, connect=True, reason="Facilitator voice access"
        )
        assert result["facilitator_granted"] == 1
        assert result["facilitator_revoked"] == 0

    @pytest.mark.asyncio
    async def test_revokes_demoted_facilitator_connect(self):
        """DB has no facilitators, voice channel has stale connect=True overwrite
        for member 111 (who is still a group member) → should revoke."""
        from core.sync import sync_group_discord_permissions
        import discord

        mock_conn = AsyncMock()

        # Query 1: _ensure_group_role
        mock_role_query_result = MagicMock()
        mock_role_query_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "discord_role_id": "777888999",
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
        }

        # Query 2: get group channel info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "discord_text_channel_id": "123456789",
            "discord_voice_channel_id": "987654321",
        }

        # Query 3: _ensure_cohort_channel
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
            "discord_category_id": "555666777",
            "discord_cohort_channel_id": "888999000",
        }

        # Query 4: get expected members from DB — member 111 is still in the group
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {"discord_id": "111"},
        ]

        # Query 5: get facilitators from DB — none (111 was demoted)
        mock_facilitators_result = MagicMock()
        mock_facilitators_result.mappings.return_value = []

        mock_conn.execute = AsyncMock(
            side_effect=[
                mock_role_query_result,
                mock_group_result,
                mock_cohort_result,
                mock_members_result,
                mock_facilitators_result,
            ]
        )

        # Mock Discord role
        mock_role = MagicMock(spec=discord.Role)
        mock_role.id = 777888999
        mock_role.name = "Cohort Jan 2026 - Group Test Group"
        mock_role.members = []

        # Mock member 111 (has stale overwrite on voice channel)
        mock_member_111 = MagicMock(spec=discord.Member)
        mock_member_111.id = 111
        mock_member_111.add_roles = AsyncMock()
        mock_member_111.remove_roles = AsyncMock()

        # Mock channels
        mock_text_channel = MagicMock(spec=discord.TextChannel)
        mock_text_channel.id = 123456789
        mock_text_channel.set_permissions = AsyncMock()

        # Build a PermissionOverwrite with connect=True for member 111
        stale_overwrite = discord.PermissionOverwrite(connect=True)

        mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
        mock_voice_channel.id = 987654321
        mock_voice_channel.set_permissions = AsyncMock()
        mock_voice_channel.overwrites = {mock_member_111: stale_overwrite}

        mock_cohort_channel = MagicMock(spec=discord.TextChannel)
        mock_cohort_channel.id = 888999000
        mock_cohort_channel.name = "general-jan-2026"
        mock_cohort_channel.set_permissions = AsyncMock()

        # Mock guild
        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.roles = [mock_role]
        mock_guild.me = MagicMock()
        mock_guild.me.guild_permissions = MagicMock()
        mock_guild.me.guild_permissions.manage_roles = True
        mock_guild.get_role.return_value = mock_role
        mock_role.guild = mock_guild

        mock_bot = MagicMock()
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel.side_effect = lambda id: {
            123456789: mock_text_channel,
            987654321: mock_voice_channel,
            888999000: mock_cohort_channel,
            555666777: MagicMock(),
        }.get(id)

        async def mock_fetch(guild, discord_id):
            if discord_id == 111:
                return mock_member_111
            return None

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch(
                    "core.discord_outbound.get_or_fetch_member",
                    side_effect=mock_fetch,
                ):
                    with patch(
                        "core.discord_outbound.get_role_member_ids",
                        return_value={"111"},
                    ):
                        with patch(
                            "core.sync._set_group_role_permissions",
                            new_callable=AsyncMock,
                        ) as mock_set_perms:
                            mock_set_perms.return_value = {
                                "text": True,
                                "voice": True,
                                "cohort": True,
                            }
                            result = await sync_group_discord_permissions(group_id=1)

        # Should have revoked the stale overwrite
        mock_voice_channel.set_permissions.assert_any_call(
            mock_member_111, overwrite=None, reason="Facilitator voice access removed"
        )
        assert result["facilitator_granted"] == 0
        assert result["facilitator_revoked"] == 1

    @pytest.mark.asyncio
    async def test_facilitator_sync_is_idempotent(self):
        """DB has facilitator 111, voice channel already has connect=True overwrite
        for member 111 → should NOT call set_permissions and return zeros."""
        from core.sync import sync_group_discord_permissions
        import discord

        mock_conn = AsyncMock()

        # Query 1: _ensure_group_role
        mock_role_query_result = MagicMock()
        mock_role_query_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "discord_role_id": "777888999",
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
        }

        # Query 2: get group channel info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "discord_text_channel_id": "123456789",
            "discord_voice_channel_id": "987654321",
        }

        # Query 3: _ensure_cohort_channel
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
            "discord_category_id": "555666777",
            "discord_cohort_channel_id": "888999000",
        }

        # Query 4: get expected members from DB
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {"discord_id": "111"},
        ]

        # Query 5: get facilitators from DB — member 111 is a facilitator
        mock_facilitators_result = MagicMock()
        mock_facilitators_result.mappings.return_value = [
            {"discord_id": "111"},
        ]

        mock_conn.execute = AsyncMock(
            side_effect=[
                mock_role_query_result,
                mock_group_result,
                mock_cohort_result,
                mock_members_result,
                mock_facilitators_result,
            ]
        )

        # Mock Discord role
        mock_role = MagicMock(spec=discord.Role)
        mock_role.id = 777888999
        mock_role.name = "Cohort Jan 2026 - Group Test Group"
        mock_role.members = []

        # Mock member 111 — already has the overwrite
        mock_member_111 = MagicMock(spec=discord.Member)
        mock_member_111.id = 111
        mock_member_111.add_roles = AsyncMock()
        mock_member_111.remove_roles = AsyncMock()

        # Mock channels
        mock_text_channel = MagicMock(spec=discord.TextChannel)
        mock_text_channel.id = 123456789
        mock_text_channel.set_permissions = AsyncMock()

        # Voice channel already has connect=True for member 111
        existing_overwrite = discord.PermissionOverwrite(connect=True)

        mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
        mock_voice_channel.id = 987654321
        mock_voice_channel.set_permissions = AsyncMock()
        mock_voice_channel.overwrites = {mock_member_111: existing_overwrite}

        mock_cohort_channel = MagicMock(spec=discord.TextChannel)
        mock_cohort_channel.id = 888999000
        mock_cohort_channel.name = "general-jan-2026"
        mock_cohort_channel.set_permissions = AsyncMock()

        # Mock guild
        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.roles = [mock_role]
        mock_guild.me = MagicMock()
        mock_guild.me.guild_permissions = MagicMock()
        mock_guild.me.guild_permissions.manage_roles = True
        mock_guild.get_role.return_value = mock_role
        mock_role.guild = mock_guild

        mock_bot = MagicMock()
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel.side_effect = lambda id: {
            123456789: mock_text_channel,
            987654321: mock_voice_channel,
            888999000: mock_cohort_channel,
            555666777: MagicMock(),
        }.get(id)

        async def mock_fetch(guild, discord_id):
            if discord_id == 111:
                return mock_member_111
            return None

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch(
                    "core.discord_outbound.get_or_fetch_member",
                    side_effect=mock_fetch,
                ):
                    with patch(
                        "core.discord_outbound.get_role_member_ids",
                        return_value={"111"},
                    ):
                        with patch(
                            "core.sync._set_group_role_permissions",
                            new_callable=AsyncMock,
                        ) as mock_set_perms:
                            mock_set_perms.return_value = {
                                "text": True,
                                "voice": True,
                                "cohort": True,
                            }
                            result = await sync_group_discord_permissions(group_id=1)

        # Should NOT have called set_permissions on voice channel at all
        mock_voice_channel.set_permissions.assert_not_called()
        assert result["facilitator_granted"] == 0
        assert result["facilitator_revoked"] == 0


class TestSyncGroupCalendar:
    """Test group calendar sync wrapper."""

    @pytest.mark.asyncio
    async def test_returns_error_when_group_not_found(self):
        """Should return error when group doesn't exist."""
        from core.sync import sync_group_calendar

        mock_conn = AsyncMock()
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_group_result)

        with patch("core.database.get_transaction") as mock_get_tx:
            mock_get_tx.return_value.__aenter__.return_value = mock_conn
            result = await sync_group_calendar(group_id=1)

        assert result["error"] == "group_not_found"
        assert result["meetings"] == 0
        assert result["created_recurring"] is False


class TestSyncGroupReminders:
    """Test group reminders sync wrapper."""

    @pytest.mark.asyncio
    async def test_returns_zero_meetings_when_no_future_meetings(self):
        """Should return zero count when group has no future meetings."""
        from core.sync import sync_group_reminders

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = []  # No meetings
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group_reminders(group_id=1)

        assert result == {
            "meetings": 0,
            "created": 0,
            "deleted": 0,
            "unchanged": 0,
            "errors": 0,
        }

    @pytest.mark.asyncio
    async def test_calls_sync_meeting_reminders_for_each_meeting(self):
        """Should call sync_meeting_reminders for each future meeting."""
        from core.sync import sync_group_reminders

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {"meeting_id": 1},
            {"meeting_id": 2},
            {"meeting_id": 3},
        ]
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.notifications.scheduler.sync_meeting_reminders"
            ) as mock_sync:
                mock_sync.return_value = {"created": 3, "deleted": 0, "unchanged": 0}
                result = await sync_group_reminders(group_id=1)

        assert mock_sync.call_count == 3
        assert result["meetings"] == 3
        assert result["created"] == 9  # 3 meetings x 3 jobs each
        assert result["errors"] == 0


class TestSyncGroupRsvps:
    """Test group RSVPs sync wrapper using recurring events."""

    @pytest.mark.asyncio
    async def test_returns_error_when_no_recurring_event(self):
        """Should return error when group has no recurring event ID."""
        from core.sync import sync_group_rsvps

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.first.return_value = MagicMock(gcal_recurring_event_id=None)
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group_rsvps(group_id=1)

        assert result == {"error": "no_recurring_event", "synced": 0}

    @pytest.mark.asyncio
    async def test_calls_sync_group_rsvps_from_recurring(self):
        """Should call sync_group_rsvps_from_recurring with recurring event ID."""
        from core.sync import sync_group_rsvps

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.first.return_value = MagicMock(
            gcal_recurring_event_id="recurring123"
        )
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.calendar.rsvp.sync_group_rsvps_from_recurring"
            ) as mock_sync:
                mock_sync.return_value = {"synced": 2, "instances_fetched": 2}
                result = await sync_group_rsvps(group_id=1)

        mock_sync.assert_called_once_with(
            group_id=1,
            recurring_event_id="recurring123",
        )
        assert result == {"synced": 2, "instances_fetched": 2}


class TestSyncGroup:
    """Test unified sync_group function."""

    @pytest.mark.asyncio
    async def test_sync_group_calls_all_sub_syncs(self):
        """Should call all four sub-sync functions for a group."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch(
                "core.sync._get_group_for_sync", new_callable=AsyncMock
            ) as mock_get_group,
        ):
            mock_get_group.return_value = {
                "group_id": 123,
                "status": "active",
                "discord_text_channel_id": "123456",
                "discord_voice_channel_id": "654321",
                "cohort_id": 1,
            }
            mock_discord.return_value = {
                "granted": 1,
                "revoked": 0,
                "unchanged": 0,
                "failed": 0,
            }
            mock_calendar.return_value = {
                "meetings": 5,
                "created": 0,
                "patched": 2,
                "unchanged": 3,
                "failed": 0,
            }
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            result = await sync_group(group_id=123)

            mock_discord.assert_called_once_with(123)
            mock_calendar.assert_called_once_with(123)
            mock_reminders.assert_called_once_with(123)
            mock_rsvps.assert_called_once_with(123)

            assert result["discord"] == {
                "granted": 1,
                "revoked": 0,
                "unchanged": 0,
                "failed": 0,
            }
            assert result["calendar"]["patched"] == 2
            assert result["reminders"]["meetings"] == 5
            assert result["rsvps"]["meetings"] == 5

    @pytest.mark.asyncio
    async def test_sync_group_returns_errors_without_raising(self):
        """Should capture errors in results without raising exceptions."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch(
                "core.sync._get_group_for_sync", new_callable=AsyncMock
            ) as mock_get_group,
        ):
            mock_get_group.return_value = {
                "group_id": 123,
                "status": "active",
                "discord_text_channel_id": "123456",
                "discord_voice_channel_id": "654321",
                "cohort_id": 1,
            }
            mock_discord.side_effect = Exception("Discord error")
            mock_calendar.return_value = {"error": "quota_exceeded"}
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            result = await sync_group(group_id=123)

            assert "error" in result["discord"]
            assert result["calendar"]["error"] == "quota_exceeded"
            assert result["reminders"]["meetings"] == 5

    @pytest.mark.asyncio
    async def test_sync_group_schedules_retries_on_failure(self):
        """Should schedule retries for failed syncs."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch("core.notifications.scheduler.schedule_sync_retry") as mock_retry,
            patch(
                "core.sync._get_group_for_sync", new_callable=AsyncMock
            ) as mock_get_group,
        ):
            mock_get_group.return_value = {
                "group_id": 123,
                "status": "active",
                "discord_text_channel_id": "123456",
                "discord_voice_channel_id": "654321",
                "cohort_id": 1,
            }
            mock_discord.return_value = {
                "granted": 0,
                "revoked": 0,
                "unchanged": 0,
                "failed": 2,
            }
            mock_calendar.return_value = {
                "meetings": 5,
                "created": 0,
                "patched": 0,
                "unchanged": 0,
                "failed": 5,
            }
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            await sync_group(group_id=123)

            # Should schedule retries for discord and calendar (both had failures)
            calls = mock_retry.call_args_list
            sync_types = [call[1]["sync_type"] for call in calls]
            assert "discord" in sync_types
            assert "calendar" in sync_types


class TestSyncAfterGroupChange:
    """Tests for sync_after_group_change()."""

    @pytest.mark.asyncio
    async def test_syncs_new_group(self):
        """sync_after_group_change should call sync_group for the new group."""
        with patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync:
            mock_sync.return_value = {"discord": {"granted": 1}}

            from core.sync import sync_after_group_change

            result = await sync_after_group_change(
                group_id=1,
                previous_group_id=None,
            )

            # Should have called sync_group with the new group
            mock_sync.assert_called_once_with(1, allow_create=False)
            assert result["new_group"] == {"discord": {"granted": 1}}
            assert result["old_group"] is None

    @pytest.mark.asyncio
    async def test_syncs_both_old_and_new_group_when_switching(self):
        """sync_after_group_change should sync both groups when switching."""
        with patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync:
            # Return different results for old and new group
            mock_sync.side_effect = [
                {"discord": {"revoked": 1}},  # Old group
                {"discord": {"granted": 1}},  # New group
            ]

            from core.sync import sync_after_group_change

            result = await sync_after_group_change(
                group_id=2,
                previous_group_id=1,
            )

            # Should have called sync_group for both groups
            assert mock_sync.call_count == 2
            # First call for old group
            mock_sync.assert_any_call(1, allow_create=False)
            # Second call for new group
            mock_sync.assert_any_call(2, allow_create=False)
            assert result["old_group"] == {"discord": {"revoked": 1}}
            assert result["new_group"] == {"discord": {"granted": 1}}

    @pytest.mark.asyncio
    async def test_user_id_param_accepted_for_backwards_compatibility(self):
        """user_id param should be accepted but not used (for backwards compatibility)."""
        with patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync:
            mock_sync.return_value = {"discord": {"granted": 1}}

            from core.sync import sync_after_group_change

            # Should not raise even with user_id (it's deprecated but still accepted)
            result = await sync_after_group_change(
                group_id=1,
                previous_group_id=None,
                user_id=123,  # This is now deprecated
            )

            # sync_group should be called, but notifications are handled inside sync_group
            mock_sync.assert_called_once_with(1, allow_create=False)
            assert result["new_group"] == {"discord": {"granted": 1}}


class TestEnsureCohortCategory:
    """Tests for ensure_cohort_category() helper."""

    @pytest.mark.asyncio
    async def test_returns_existed_when_category_exists_in_db_and_discord(self):
        """When category ID in DB and channel exists in Discord, return existed."""
        from core.sync import _ensure_cohort_category

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "January 2026",
            "course_slug": "aisf",
            "discord_category_id": "999888777",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_category = MagicMock()
        mock_category.id = 999888777

        mock_bot = MagicMock()
        mock_bot.get_channel.return_value = mock_category

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await _ensure_cohort_category(cohort_id=1)

        assert result["status"] == "existed"
        assert result["id"] == "999888777"

    @pytest.mark.asyncio
    async def test_returns_channel_missing_when_db_has_id_but_discord_doesnt(self):
        """When category ID in DB but Discord returns None, flag as missing."""
        from core.sync import _ensure_cohort_category

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "January 2026",
            "course_slug": "aisf",
            "discord_category_id": "999888777",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_bot = MagicMock()
        mock_bot.get_channel.return_value = None  # Not in cache
        # fetch_channel raises NotFound when channel deleted from Discord
        import discord

        mock_bot.fetch_channel = AsyncMock(
            side_effect=discord.NotFound(MagicMock(), "Unknown Channel")
        )

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await _ensure_cohort_category(cohort_id=1)

        assert result["status"] == "channel_missing"
        assert result["id"] == "999888777"


class TestSyncGroupAllowCreate:
    """Tests for sync_group() with allow_create parameter."""

    @pytest.mark.asyncio
    async def test_allow_create_false_returns_needs_infrastructure_when_no_channels(
        self,
    ):
        """When allow_create=False and group has no channels, should return needs_infrastructure."""
        from core.sync import sync_group

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "status": "preview",
            "discord_text_channel_id": None,
            "discord_voice_channel_id": None,
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group(group_id=1, allow_create=False)

        assert result.get("needs_infrastructure") is True
        assert "infrastructure" in result

    @pytest.mark.asyncio
    async def test_allow_create_default_is_false(self):
        """Default behavior should be allow_create=False (backwards compatible)."""
        from core.sync import sync_group

        # Mock all sub-syncs to isolate the test
        with (
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch(
                "core.sync._get_group_for_sync", new_callable=AsyncMock
            ) as mock_get_group,
        ):
            mock_get_group.return_value = {
                "group_id": 1,
                "status": "active",
                "discord_text_channel_id": "123",
                "discord_voice_channel_id": "456",
                "cohort_id": 1,
            }
            mock_discord.return_value = {
                "granted": 0,
                "revoked": 0,
                "unchanged": 1,
                "failed": 0,
                "granted_discord_ids": [],
                "revoked_discord_ids": [],
            }
            mock_calendar.return_value = {
                "meetings": 0,
                "created": 0,
                "patched": 0,
                "unchanged": 0,
                "failed": 0,
            }
            mock_reminders.return_value = {"meetings": 0}
            mock_rsvps.return_value = {"meetings": 0}

            # Call without allow_create - should work for active group with channels
            result = await sync_group(group_id=1)

            # Should have called sub-syncs (not returned needs_infrastructure)
            mock_discord.assert_called_once()
            assert result.get("needs_infrastructure") is not True

    @pytest.mark.asyncio
    async def test_allow_create_true_creates_infrastructure(self):
        """When allow_create=True and infrastructure missing, should create it."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync._get_group_for_sync", new_callable=AsyncMock
            ) as mock_get_group,
            patch(
                "core.sync._get_group_member_count", new_callable=AsyncMock
            ) as mock_member_count,
            patch(
                "core.sync._ensure_cohort_category", new_callable=AsyncMock
            ) as mock_category,
            patch(
                "core.sync._ensure_group_channels", new_callable=AsyncMock
            ) as mock_channels,
            patch(
                "core.sync._ensure_group_meetings", new_callable=AsyncMock
            ) as mock_meetings,
            patch(
                "core.sync._ensure_meeting_discord_events", new_callable=AsyncMock
            ) as mock_events,
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch("core.sync._update_group_status", new_callable=AsyncMock),
            patch(
                "core.sync._get_notification_context", new_callable=AsyncMock
            ) as mock_context,
            patch("core.sync._send_sync_notifications", new_callable=AsyncMock),
            patch("core.discord_outbound.bot._bot") as mock_bot,
        ):
            # First call returns preview with no channels, second call (after infra) returns with channels
            mock_get_group.side_effect = [
                {
                    "group_id": 1,
                    "status": "preview",
                    "discord_text_channel_id": None,
                    "discord_voice_channel_id": None,
                    "cohort_id": 1,
                },
                {
                    "group_id": 1,
                    "status": "preview",
                    "discord_text_channel_id": "111222333",
                    "discord_voice_channel_id": "444555666",
                    "cohort_id": 1,
                },
            ]
            mock_member_count.return_value = 3  # Has members
            mock_category.return_value = {"status": "created", "id": "999888777"}
            mock_channels.return_value = {
                "text_channel": {"status": "created", "id": "111222333"},
                "voice_channel": {"status": "created", "id": "444555666"},
                "welcome_message_sent": True,
            }
            mock_meetings.return_value = {"created": 8, "existed": 0}
            mock_events.return_value = {
                "created": 8,
                "existed": 0,
                "skipped": 0,
                "failed": 0,
            }
            mock_discord.return_value = {
                "granted": 3,
                "revoked": 0,
                "unchanged": 0,
                "failed": 0,
                "granted_discord_ids": [1, 2, 3],
                "revoked_discord_ids": [],
            }
            mock_calendar.return_value = {
                "meetings": 8,
                "created": 8,
                "patched": 0,
                "unchanged": 0,
                "failed": 0,
            }
            mock_reminders.return_value = {"meetings": 8}
            mock_rsvps.return_value = {"meetings": 8}
            mock_bot.get_channel.return_value = MagicMock()
            mock_context.return_value = {"group_name": "Test", "members": []}

            result = await sync_group(group_id=1, allow_create=True)

        # Should have called infrastructure creation
        mock_category.assert_called_once()
        mock_channels.assert_called_once()
        mock_meetings.assert_called_once()
        mock_events.assert_called_once()

        # Infrastructure results should be in response
        assert result["infrastructure"]["category"]["status"] == "created"
        assert result["infrastructure"]["text_channel"]["status"] == "created"


class TestEnsureGroupChannels:
    """Tests for _ensure_group_channels() helper."""

    @pytest.mark.asyncio
    async def test_returns_existed_when_both_channels_exist(self):
        """When both channel IDs in DB and Discord has them, return existed."""
        from core.sync import _ensure_group_channels

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "discord_text_channel_id": "111",
            "discord_voice_channel_id": "222",
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_text = MagicMock()
        mock_text.id = 111
        mock_voice = MagicMock()
        mock_voice.id = 222

        mock_bot = MagicMock()
        mock_bot.get_channel.side_effect = lambda id: {
            111: mock_text,
            222: mock_voice,
        }.get(id)

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await _ensure_group_channels(group_id=1, category=MagicMock())

        assert result["text_channel"]["status"] == "existed"
        assert result["voice_channel"]["status"] == "existed"

    @pytest.mark.asyncio
    async def test_creates_missing_voice_channel_when_text_exists(self):
        """When text exists but voice missing, should create voice only."""
        from core.sync import _ensure_group_channels
        import discord

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "discord_text_channel_id": "111",
            "discord_voice_channel_id": None,
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_text = MagicMock(spec=discord.TextChannel)
        mock_text.id = 111

        mock_new_voice = MagicMock(spec=discord.VoiceChannel)
        mock_new_voice.id = 333

        mock_bot = MagicMock()
        mock_bot.get_channel.side_effect = lambda id: {111: mock_text}.get(id)

        mock_category = MagicMock()
        mock_category.guild = MagicMock()
        mock_category.guild.create_voice_channel = AsyncMock(
            return_value=mock_new_voice
        )

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch("core.database.get_transaction") as mock_get_tx:
                    mock_get_tx.return_value.__aenter__.return_value = mock_conn
                    result = await _ensure_group_channels(
                        group_id=1, category=mock_category
                    )

        assert result["text_channel"]["status"] == "existed"
        assert result["voice_channel"]["status"] == "created"
        assert result["voice_channel"]["id"] == "333"

    @pytest.mark.asyncio
    async def test_returns_channel_missing_when_db_has_id_but_discord_doesnt(self):
        """When text channel ID in DB but Discord returns None, flag as missing."""
        from core.sync import _ensure_group_channels

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "discord_text_channel_id": "111",
            "discord_voice_channel_id": "222",
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_bot = MagicMock()
        mock_bot.get_channel.return_value = None  # Not in cache
        # fetch_channel raises NotFound when channels deleted from Discord
        import discord

        mock_bot.fetch_channel = AsyncMock(
            side_effect=discord.NotFound(MagicMock(), "Unknown Channel")
        )

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await _ensure_group_channels(group_id=1, category=MagicMock())

        assert result["text_channel"]["status"] == "channel_missing"
        assert result["text_channel"]["id"] == "111"
        assert result["voice_channel"]["status"] == "channel_missing"
        assert result["voice_channel"]["id"] == "222"

    @pytest.mark.asyncio
    async def test_sends_welcome_message_when_text_channel_created(self):
        """When text channel is created, should send welcome message."""
        from core.sync import _ensure_group_channels
        import discord

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "discord_text_channel_id": None,
            "discord_voice_channel_id": None,
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_new_text = MagicMock(spec=discord.TextChannel)
        mock_new_text.id = 444
        mock_new_text.send = AsyncMock()

        mock_new_voice = MagicMock(spec=discord.VoiceChannel)
        mock_new_voice.id = 555

        mock_bot = MagicMock()
        mock_bot.get_channel.return_value = None  # Not in cache
        # fetch_channel raises NotFound - channel doesn't exist
        import discord

        mock_bot.fetch_channel = AsyncMock(
            side_effect=discord.NotFound(MagicMock(), "Unknown Channel")
        )

        mock_category = MagicMock()
        mock_category.guild = MagicMock()
        mock_category.guild.create_text_channel = AsyncMock(return_value=mock_new_text)
        mock_category.guild.create_voice_channel = AsyncMock(
            return_value=mock_new_voice
        )

        # Mock the welcome message function
        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch("core.database.get_transaction") as mock_get_tx:
                    mock_get_tx.return_value.__aenter__.return_value = mock_conn
                    with patch(
                        "core.sync._send_channel_welcome_message",
                        new_callable=AsyncMock,
                    ) as mock_welcome:
                        result = await _ensure_group_channels(
                            group_id=1, category=mock_category
                        )

        assert result["text_channel"]["status"] == "created"
        assert result["voice_channel"]["status"] == "created"
        assert result["welcome_message_sent"] is True
        mock_welcome.assert_called_once_with(mock_new_text, 1)


class TestEnsureGroupMeetings:
    """Tests for _ensure_group_meetings() helper."""

    @pytest.mark.asyncio
    async def test_returns_existed_count_when_meetings_exist(self):
        """When meetings already exist in DB, return existed count."""
        from core.sync import _ensure_group_meetings

        mock_conn = AsyncMock()

        # Query 1: get group info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "recurring_meeting_time_utc": "Wednesday 15:00",
            "cohort_id": 1,
        }

        # Query 2: count existing meetings
        mock_count_result = MagicMock()
        mock_count_result.scalar.return_value = 8

        mock_conn.execute = AsyncMock(
            side_effect=[mock_group_result, mock_count_result]
        )

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await _ensure_group_meetings(group_id=1)

        assert result["existed"] == 8
        assert result["created"] == 0

    @pytest.mark.asyncio
    async def test_creates_meetings_when_none_exist(self):
        """When no meetings exist, should create them."""
        from core.sync import _ensure_group_meetings
        from datetime import date

        mock_conn = AsyncMock()

        # Query 1: get group info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "recurring_meeting_time_utc": "Wednesday 15:00",
            "cohort_id": 1,
        }

        # Query 2: count existing meetings = 0
        mock_count_result = MagicMock()
        mock_count_result.scalar.return_value = 0

        # Query 3: get cohort info
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_start_date": date(2026, 2, 1),
            "number_of_group_meetings": 8,
        }

        mock_conn.execute = AsyncMock(
            side_effect=[mock_group_result, mock_count_result, mock_cohort_result]
        )

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.meetings.create_meetings_for_group", new_callable=AsyncMock
            ) as mock_create:
                mock_create.return_value = [1, 2, 3, 4, 5, 6, 7, 8]
                result = await _ensure_group_meetings(group_id=1)

        assert result["created"] == 8
        assert result["existed"] == 0
        mock_create.assert_called_once()


class TestCalculateFirstMeeting:
    """Tests for _calculate_first_meeting() helper."""

    def test_calculates_first_meeting_from_wednesday(self):
        """Should find first Wednesday after cohort start date."""
        from core.sync import _calculate_first_meeting
        from datetime import date

        # Feb 1, 2026 is a Sunday
        start_date = date(2026, 2, 1)
        meeting_time_str = "Wednesday 15:00"

        result = _calculate_first_meeting(start_date, meeting_time_str)

        assert result is not None
        assert result.weekday() == 2  # Wednesday
        assert result.hour == 15
        assert result.minute == 0
        # First Wednesday after Feb 1 (Sunday) is Feb 4
        assert result.day == 4

    def test_calculates_first_meeting_same_day(self):
        """If cohort starts on meeting day, should use that day."""
        from core.sync import _calculate_first_meeting
        from datetime import date

        # Feb 4, 2026 is a Wednesday
        start_date = date(2026, 2, 4)
        meeting_time_str = "Wednesday 10:30"

        result = _calculate_first_meeting(start_date, meeting_time_str)

        assert result is not None
        assert result.weekday() == 2  # Wednesday
        assert result.hour == 10
        assert result.minute == 30
        assert result.day == 4  # Same day

    def test_handles_time_range_format(self):
        """Should parse '15:00-16:00' format correctly."""
        from core.sync import _calculate_first_meeting
        from datetime import date

        start_date = date(2026, 2, 1)
        meeting_time_str = "Thursday 14:30-15:30"

        result = _calculate_first_meeting(start_date, meeting_time_str)

        assert result is not None
        assert result.weekday() == 3  # Thursday
        assert result.hour == 14
        assert result.minute == 30

    def test_returns_none_for_invalid_time_string(self):
        """Should return None for unparseable time string."""
        from core.sync import _calculate_first_meeting
        from datetime import date

        start_date = date(2026, 2, 1)
        meeting_time_str = "Invalid time"

        result = _calculate_first_meeting(start_date, meeting_time_str)

        assert result is None


class TestEnsureMeetingDiscordEvents:
    """Tests for _ensure_meeting_discord_events() helper."""

    @pytest.mark.asyncio
    async def test_skips_all_when_no_voice_channel(self):
        """When voice_channel is None, should skip all events."""
        from core.sync import _ensure_meeting_discord_events

        result = await _ensure_meeting_discord_events(group_id=1, voice_channel=None)

        assert result["skipped"] >= 0  # Should return without creating anything
        assert result == {"created": 0, "existed": 0, "skipped": 0, "failed": 0}

    @pytest.mark.asyncio
    async def test_returns_existed_when_events_already_have_discord_ids(self):
        """When meetings already have discord_event_id, count as existed."""
        from core.sync import _ensure_meeting_discord_events
        from datetime import datetime, timezone, timedelta

        mock_conn = AsyncMock()
        future_time = datetime.now(timezone.utc) + timedelta(days=7)

        # Query 1: get group name
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "group_name": "Group Alpha",
        }

        # Query 2: get meetings
        mock_meetings_result = MagicMock()
        mock_meetings_result.mappings.return_value = [
            {
                "meeting_id": 1,
                "discord_event_id": "event123",
                "scheduled_at": future_time,
                "meeting_number": 1,
            },
            {
                "meeting_id": 2,
                "discord_event_id": "event456",
                "scheduled_at": future_time + timedelta(weeks=1),
                "meeting_number": 2,
            },
        ]

        mock_conn.execute = AsyncMock(
            side_effect=[mock_group_result, mock_meetings_result]
        )

        mock_voice = MagicMock()
        mock_voice.guild = MagicMock()

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await _ensure_meeting_discord_events(
                group_id=1, voice_channel=mock_voice
            )

        assert result["existed"] == 2
        assert result["created"] == 0

    @pytest.mark.asyncio
    async def test_creates_events_for_meetings_without_discord_ids(self):
        """When meetings don't have discord_event_id, should create Discord events."""
        from core.sync import _ensure_meeting_discord_events
        from datetime import datetime, timezone, timedelta
        import discord

        mock_conn = AsyncMock()
        future_time = datetime.now(timezone.utc) + timedelta(days=7)

        # Query 1: get group name
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "group_name": "Group Alpha",
        }

        # Query 2: get meetings - no discord_event_id
        mock_meetings_result = MagicMock()
        mock_meetings_result.mappings.return_value = [
            {
                "meeting_id": 1,
                "discord_event_id": None,
                "scheduled_at": future_time,
                "meeting_number": 1,
            },
            {
                "meeting_id": 2,
                "discord_event_id": None,
                "scheduled_at": future_time + timedelta(weeks=1),
                "meeting_number": 2,
            },
        ]

        mock_conn.execute = AsyncMock(
            side_effect=[mock_group_result, mock_meetings_result]
        )

        # Mock Discord voice channel and guild
        mock_event = MagicMock(spec=discord.ScheduledEvent)
        mock_event.id = 999888777

        mock_guild = MagicMock(spec=discord.Guild)
        mock_guild.create_scheduled_event = AsyncMock(return_value=mock_event)

        mock_voice = MagicMock(spec=discord.VoiceChannel)
        mock_voice.guild = mock_guild

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch("core.database.get_transaction") as mock_get_tx:
                mock_tx_conn = AsyncMock()
                mock_get_tx.return_value.__aenter__.return_value = mock_tx_conn
                result = await _ensure_meeting_discord_events(
                    group_id=1, voice_channel=mock_voice
                )

        assert result["created"] == 2
        assert result["existed"] == 0
        assert mock_guild.create_scheduled_event.call_count == 2

    @pytest.mark.asyncio
    async def test_returns_empty_counts_when_no_future_meetings(self):
        """When group has no future meetings, should return zero counts."""
        from core.sync import _ensure_meeting_discord_events

        mock_conn = AsyncMock()

        # Query 1: get group name
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "group_name": "Group Alpha",
        }

        # Query 2: no meetings
        mock_meetings_result = MagicMock()
        mock_meetings_result.mappings.return_value = []

        mock_conn.execute = AsyncMock(
            side_effect=[mock_group_result, mock_meetings_result]
        )

        mock_voice = MagicMock()
        mock_voice.guild = MagicMock()

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await _ensure_meeting_discord_events(
                group_id=1, voice_channel=mock_voice
            )

        assert result == {"created": 0, "existed": 0, "skipped": 0, "failed": 0}


class TestSyncGroupStatusTransition:
    """Tests for group status transitions in sync_group()."""

    @pytest.mark.asyncio
    async def test_transitions_to_active_when_fully_realized(self):
        """Should set status to active when infrastructure complete and member has access."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync._get_group_for_sync", new_callable=AsyncMock
            ) as mock_get_group,
            patch(
                "core.sync._get_group_member_count", new_callable=AsyncMock
            ) as mock_member_count,
            patch(
                "core.sync._ensure_cohort_category", new_callable=AsyncMock
            ) as mock_category,
            patch(
                "core.sync._ensure_group_channels", new_callable=AsyncMock
            ) as mock_channels,
            patch(
                "core.sync._ensure_group_meetings", new_callable=AsyncMock
            ) as mock_meetings,
            patch(
                "core.sync._ensure_meeting_discord_events", new_callable=AsyncMock
            ) as mock_events,
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch(
                "core.sync._update_group_status", new_callable=AsyncMock
            ) as mock_update_status,
            patch(
                "core.sync._send_sync_notifications", new_callable=AsyncMock
            ) as mock_notify,
            patch(
                "core.sync._get_notification_context", new_callable=AsyncMock
            ) as mock_context,
            patch("core.discord_outbound.bot._bot") as mock_bot,
        ):
            # First call returns preview, second call (after infra) returns with channels
            mock_get_group.side_effect = [
                {
                    "group_id": 1,
                    "status": "preview",
                    "discord_text_channel_id": None,
                    "discord_voice_channel_id": None,
                    "cohort_id": 1,
                },
                {
                    "group_id": 1,
                    "status": "preview",
                    "discord_text_channel_id": "123",
                    "discord_voice_channel_id": "456",
                    "cohort_id": 1,
                },
            ]
            mock_member_count.return_value = 2
            mock_category.return_value = {"status": "created", "id": "999888777"}
            mock_channels.return_value = {
                "text_channel": {"status": "created", "id": "123"},
                "voice_channel": {"status": "created", "id": "456"},
                "welcome_message_sent": True,
            }
            mock_meetings.return_value = {"created": 8, "existed": 0}
            mock_events.return_value = {
                "created": 8,
                "existed": 0,
                "skipped": 0,
                "failed": 0,
            }
            mock_discord.return_value = {
                "granted": 2,
                "revoked": 0,
                "unchanged": 0,
                "failed": 0,
                "granted_discord_ids": [1, 2],
                "revoked_discord_ids": [],
            }
            mock_calendar.return_value = {
                "meetings": 8,
                "created": 8,
                "patched": 0,
                "unchanged": 0,
                "failed": 0,
            }
            mock_reminders.return_value = {"meetings": 8}
            mock_rsvps.return_value = {"meetings": 8}
            mock_bot.get_channel.return_value = MagicMock()
            mock_context.return_value = {
                "group_name": "Test Group",
                "meeting_time_utc": "Wednesday 15:00",
                "discord_channel_id": "123",
                "members": [
                    {"name": "Alice", "discord_id": "111", "user_id": 1},
                    {"name": "Bob", "discord_id": "222", "user_id": 2},
                ],
            }

            await sync_group(group_id=1, allow_create=True)

        # Should have transitioned to active
        mock_update_status.assert_called_once_with(1, "active")

        # Should have sent notifications with is_initial_realization=True
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args.kwargs
        assert call_kwargs["is_initial_realization"] is True

    @pytest.mark.asyncio
    async def test_does_not_transition_when_not_preview(self):
        """Should NOT transition if initial status is not preview."""
        from core.sync import sync_group

        with (
            patch(
                "core.sync._get_group_for_sync", new_callable=AsyncMock
            ) as mock_get_group,
            patch(
                "core.sync.sync_group_discord_permissions", new_callable=AsyncMock
            ) as mock_discord,
            patch(
                "core.sync.sync_group_calendar", new_callable=AsyncMock
            ) as mock_calendar,
            patch(
                "core.sync.sync_group_reminders", new_callable=AsyncMock
            ) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch(
                "core.sync._update_group_status", new_callable=AsyncMock
            ) as mock_update_status,
            patch(
                "core.sync._send_sync_notifications", new_callable=AsyncMock
            ) as mock_notify,
            patch(
                "core.sync._get_notification_context", new_callable=AsyncMock
            ) as mock_context,
        ):
            # Already active - should not transition
            mock_get_group.return_value = {
                "group_id": 1,
                "status": "active",
                "discord_text_channel_id": "123",
                "discord_voice_channel_id": "456",
                "cohort_id": 1,
            }
            mock_discord.return_value = {
                "granted": 1,
                "revoked": 0,
                "unchanged": 0,
                "failed": 0,
                "granted_discord_ids": [3],
                "revoked_discord_ids": [],
            }
            mock_calendar.return_value = {
                "meetings": 8,
                "created": 0,
                "patched": 0,
                "unchanged": 8,
                "failed": 0,
            }
            mock_reminders.return_value = {"meetings": 8}
            mock_rsvps.return_value = {"meetings": 8}
            mock_context.return_value = {
                "group_name": "Test Group",
                "meeting_time_utc": "Wednesday 15:00",
                "discord_channel_id": "123",
                "members": [{"name": "Charlie", "discord_id": "333", "user_id": 3}],
            }

            await sync_group(group_id=1, allow_create=False)

        # Should NOT have called update_status
        mock_update_status.assert_not_called()

        # Should still send notifications but with is_initial_realization=False
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args.kwargs
        assert call_kwargs["is_initial_realization"] is False


class TestIsFullyRealized:
    """Tests for _is_fully_realized() helper."""

    def test_returns_true_when_all_infrastructure_exists(self):
        """Should return True when category, channels exist and members have access."""
        from core.sync import _is_fully_realized

        infrastructure = {
            "category": {"status": "existed", "id": "cat123"},
            "text_channel": {"status": "created", "id": "txt123"},
            "voice_channel": {"status": "created", "id": "vox123"},
            "meetings": {"created": 8, "existed": 0},
            "discord_events": {"created": 8, "existed": 0, "skipped": 0, "failed": 0},
        }
        discord_result = {"granted": 2, "revoked": 0, "unchanged": 1, "failed": 0}

        result = _is_fully_realized(infrastructure, discord_result)
        assert result is True

    def test_returns_false_when_no_meetings(self):
        """Should return False when no meetings exist."""
        from core.sync import _is_fully_realized

        infrastructure = {
            "category": {"status": "existed", "id": "cat123"},
            "text_channel": {"status": "created", "id": "txt123"},
            "voice_channel": {"status": "created", "id": "vox123"},
            "meetings": {"created": 0, "existed": 0},
            "discord_events": {"created": 0, "existed": 0, "skipped": 0, "failed": 0},
        }
        discord_result = {"granted": 2, "revoked": 0, "unchanged": 0, "failed": 0}

        result = _is_fully_realized(infrastructure, discord_result)
        assert result is False

    def test_returns_false_when_no_members_have_access(self):
        """Should return False when no members have access."""
        from core.sync import _is_fully_realized

        infrastructure = {
            "category": {"status": "existed", "id": "cat123"},
            "text_channel": {"status": "created", "id": "txt123"},
            "voice_channel": {"status": "created", "id": "vox123"},
            "meetings": {"created": 8, "existed": 0},
            "discord_events": {"created": 8, "existed": 0, "skipped": 0, "failed": 0},
        }
        discord_result = {"granted": 0, "revoked": 0, "unchanged": 0, "failed": 2}

        result = _is_fully_realized(infrastructure, discord_result)
        assert result is False

    def test_returns_false_when_text_channel_missing(self):
        """Should return False when text channel is missing."""
        from core.sync import _is_fully_realized

        infrastructure = {
            "category": {"status": "existed", "id": "cat123"},
            "text_channel": {"status": "channel_missing", "id": "txt123"},
            "voice_channel": {"status": "created", "id": "vox123"},
            "meetings": {"created": 8, "existed": 0},
            "discord_events": {"created": 8, "existed": 0, "skipped": 0, "failed": 0},
        }
        discord_result = {"granted": 2, "revoked": 0, "unchanged": 0, "failed": 0}

        result = _is_fully_realized(infrastructure, discord_result)
        assert result is False


class TestUpdateGroupStatus:
    """Tests for _update_group_status() helper."""

    @pytest.mark.asyncio
    async def test_updates_status_in_database(self):
        """Should update group status in database."""
        from core.sync import _update_group_status

        mock_conn = AsyncMock()

        with patch("core.database.get_transaction") as mock_get_tx:
            mock_get_tx.return_value.__aenter__.return_value = mock_conn
            await _update_group_status(group_id=1, status="active")

        # Verify execute was called
        mock_conn.execute.assert_called_once()


class TestGetNotificationContext:
    """Tests for _get_notification_context() helper."""

    @pytest.mark.asyncio
    async def test_returns_context_with_members_and_user_ids(self):
        """Should return context dict with group info and member user_ids."""
        from core.sync import _get_notification_context

        mock_conn = AsyncMock()

        # Mock get_group_welcome_data result
        mock_welcome_data = {
            "group_name": "Test Group",
            "meeting_time_utc": "Wednesday 15:00",
        }

        # Mock member query result
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {
                "user_id": 1,
                "discord_id": "111",
                "nickname": "Alice",
                "discord_username": "alice#1234",
            },
            {
                "user_id": 2,
                "discord_id": "222",
                "nickname": None,
                "discord_username": "bob#5678",
            },
        ]

        # Mock channel query result
        mock_channel_result = MagicMock()
        mock_channel_result.scalar.return_value = "123456"

        mock_conn.execute = AsyncMock(
            side_effect=[mock_members_result, mock_channel_result]
        )

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.queries.groups.get_group_welcome_data", new_callable=AsyncMock
            ) as mock_get_data:
                mock_get_data.return_value = mock_welcome_data
                result = await _get_notification_context(group_id=1)

        assert result["group_name"] == "Test Group"
        assert result["meeting_time_utc"] == "Wednesday 15:00"
        assert result["discord_channel_id"] == "123456"
        assert len(result["members"]) == 2
        assert result["members"][0]["user_id"] == 1
        assert result["members"][0]["name"] == "Alice"
        assert (
            result["members"][1]["name"] == "bob#5678"
        )  # Falls back to discord_username

    @pytest.mark.asyncio
    async def test_returns_empty_dict_when_no_welcome_data(self):
        """Should return empty dict when get_group_welcome_data returns None."""
        from core.sync import _get_notification_context

        mock_conn = AsyncMock()

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.queries.groups.get_group_welcome_data", new_callable=AsyncMock
            ) as mock_get_data:
                mock_get_data.return_value = None
                result = await _get_notification_context(group_id=999)

        assert result == {}


class TestSendSyncNotifications:
    """Tests for _send_sync_notifications() helper."""

    @pytest.mark.asyncio
    async def test_sends_group_assigned_for_initial_realization(self):
        """Should send group_assigned notification for initial realization."""
        from core.sync import _send_sync_notifications

        notification_context = {
            "group_name": "Test Group",
            "meeting_time_utc": "Wednesday 15:00",
            "discord_channel_id": "123456",
            "members": [
                {"user_id": 1, "discord_id": "111", "name": "Alice"},
                {"user_id": 2, "discord_id": "222", "name": "Bob"},
            ],
            "member_names": ["Alice", "Bob"],
        }

        with (
            patch(
                "core.notifications.dispatcher.was_notification_sent",
                new_callable=AsyncMock,
            ) as mock_was_sent,
            patch(
                "core.notifications.actions.notify_group_assigned",
                new_callable=AsyncMock,
            ) as mock_notify_assigned,
        ):
            mock_was_sent.return_value = False  # Not yet notified
            mock_notify_assigned.return_value = {"email": True, "discord": True}

            # granted_discord_ids are Discord user IDs (111, 222)
            result = await _send_sync_notifications(
                group_id=1,
                granted_discord_ids=[111, 222],  # Discord IDs that match members
                revoked_discord_ids=[],
                is_initial_realization=True,
                notification_context=notification_context,
            )

        # Should have called notify_group_assigned twice (for each user)
        assert mock_notify_assigned.call_count == 2
        assert result["sent"] == 2
        assert result["skipped"] == 0

    @pytest.mark.asyncio
    async def test_sends_member_joined_for_late_join(self):
        """Should send member_joined notification for late join."""
        from core.sync import _send_sync_notifications

        notification_context = {
            "group_name": "Test Group",
            "meeting_time_utc": "Wednesday 15:00",
            "discord_channel_id": "123456",
            "members": [
                {"user_id": 3, "discord_id": "333", "name": "Charlie"},
            ],
            "member_names": ["Alice", "Bob", "Charlie"],
        }

        with (
            patch(
                "core.notifications.dispatcher.was_notification_sent",
                new_callable=AsyncMock,
            ) as mock_was_sent,
            patch(
                "core.notifications.actions.notify_member_joined",
                new_callable=AsyncMock,
            ) as mock_notify_joined,
        ):
            mock_was_sent.return_value = False
            mock_notify_joined.return_value = {"email": True, "discord": True}

            # granted_discord_ids are Discord user IDs (333 matches member discord_id)
            result = await _send_sync_notifications(
                group_id=1,
                granted_discord_ids=[333],  # Discord ID that matches the member
                revoked_discord_ids=[],
                is_initial_realization=False,  # Late join
                notification_context=notification_context,
            )

        # Should have called notify_member_joined (handles both DM and channel message)
        mock_notify_joined.assert_called_once()
        assert result["sent"] == 1

    @pytest.mark.asyncio
    async def test_skips_already_notified_users(self):
        """Should skip users who were already notified."""
        from core.sync import _send_sync_notifications

        notification_context = {
            "group_name": "Test Group",
            "meeting_time_utc": "Wednesday 15:00",
            "discord_channel_id": "123456",
            "members": [
                {"user_id": 1, "discord_id": "111", "name": "Alice"},
            ],
            "member_names": ["Alice"],
        }

        with (
            patch(
                "core.notifications.dispatcher.was_notification_sent",
                new_callable=AsyncMock,
            ) as mock_was_sent,
            patch(
                "core.notifications.actions.notify_group_assigned",
                new_callable=AsyncMock,
            ) as mock_notify_assigned,
        ):
            mock_was_sent.return_value = True  # Already notified

            # granted_discord_ids are Discord user IDs (111 matches member discord_id)
            result = await _send_sync_notifications(
                group_id=1,
                granted_discord_ids=[111],  # Discord ID that matches the member
                revoked_discord_ids=[],
                is_initial_realization=True,
                notification_context=notification_context,
            )

        # Should NOT have called notify_group_assigned
        mock_notify_assigned.assert_not_called()
        assert result["sent"] == 0
        assert result["skipped"] == 1


class TestSendChannelWelcomeMessage:
    """Tests for _send_channel_welcome_message() helper."""

    @pytest.mark.asyncio
    async def test_sends_formatted_welcome_message(self):
        """Should send a formatted welcome message with group info."""
        from core.sync import _send_channel_welcome_message

        mock_conn = AsyncMock()
        mock_channel = MagicMock()
        mock_channel.send = AsyncMock()

        mock_welcome_data = {
            "group_name": "Group Alpha",
            "cohort_name": "AI Safety - January 2026",
            "meeting_time_utc": "Wednesday 15:00",
            "number_of_group_meetings": 8,
            "members": [
                {"name": "Alice", "discord_id": "111", "role": "facilitator"},
                {"name": "Bob", "discord_id": "222", "role": "participant"},
            ],
        }

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.queries.groups.get_group_welcome_data", new_callable=AsyncMock
            ) as mock_get_data:
                mock_get_data.return_value = mock_welcome_data
                await _send_channel_welcome_message(mock_channel, group_id=1)

        # Verify channel.send was called
        mock_channel.send.assert_called_once()
        sent_message = mock_channel.send.call_args[0][0]

        # Verify message contains key info
        assert "Welcome to Group Alpha" in sent_message
        assert "AI Safety - January 2026" in sent_message
        assert "<@111>" in sent_message  # Facilitator Discord mention
        assert "<@222>" in sent_message  # Participant Discord mention
        assert "(Facilitator)" in sent_message
        assert "Wednesday 15:00" in sent_message

    @pytest.mark.asyncio
    async def test_does_nothing_when_no_data_found(self):
        """Should return early if get_group_welcome_data returns None."""
        from core.sync import _send_channel_welcome_message

        mock_conn = AsyncMock()
        mock_channel = MagicMock()
        mock_channel.send = AsyncMock()

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.queries.groups.get_group_welcome_data", new_callable=AsyncMock
            ) as mock_get_data:
                mock_get_data.return_value = None
                await _send_channel_welcome_message(mock_channel, group_id=999)

        # channel.send should NOT be called
        mock_channel.send.assert_not_called()
