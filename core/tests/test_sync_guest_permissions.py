"""Tests for guest visitor inclusion in Discord role sync."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestGuestVisitorsInExpectedMembers:
    """Verify sync_group_discord_permissions includes guest visitors."""

    def _build_mocks(self):
        """Build common Discord mock objects for all tests."""
        import discord

        # -- Mock DB results in order of execution --

        # Query 1: _ensure_group_role -> select groups+cohorts
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

        # Query 3: _ensure_cohort_channel -> get cohort info
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "Jan 2026",
            "discord_category_id": "555666777",
            "discord_cohort_channel_id": "888999000",
        }

        # Query 4: combined permanent + guest UNION query
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {"discord_id": "111"},
            {"discord_id": "222"},
            {"discord_id": "444"},  # guest visitor
        ]

        # Query 5: facilitator query
        mock_facilitators_result = MagicMock()
        mock_facilitators_result.mappings.return_value = []

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(
            side_effect=[
                mock_role_query_result,
                mock_group_result,
                mock_cohort_result,
                mock_members_result,
                mock_facilitators_result,
            ]
        )

        # -- Discord objects --
        mock_role = MagicMock(spec=discord.Role)
        mock_role.id = 777888999
        mock_role.name = "Cohort Jan 2026 - Group Test Group"
        mock_role.members = []

        mock_text_channel = MagicMock(spec=discord.TextChannel)
        mock_text_channel.id = 123456789
        mock_text_channel.set_permissions = AsyncMock()

        mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
        mock_voice_channel.id = 987654321
        mock_voice_channel.set_permissions = AsyncMock()
        mock_voice_channel.overwrites = {}

        mock_cohort_channel = MagicMock(spec=discord.TextChannel)
        mock_cohort_channel.id = 888999000
        mock_cohort_channel.name = "general-jan-2026"
        mock_cohort_channel.set_permissions = AsyncMock()

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
            555666777: MagicMock(),  # Category
        }.get(id)

        async def mock_fetch(guild, discord_id):
            m = MagicMock(spec=discord.Member)
            m.id = discord_id
            m.add_roles = AsyncMock()
            m.remove_roles = AsyncMock()
            return m

        return mock_conn, mock_bot, mock_fetch

    async def _run_sync_and_capture_queries(self, mock_conn, mock_bot, mock_fetch):
        """Run sync and capture all SQL queries passed to conn.execute."""
        from core.sync import sync_group_discord_permissions

        # Wrap execute to capture query objects
        original_results = list(mock_conn.execute.side_effect)
        captured_queries = []
        call_index = 0

        async def capturing_execute(query, *args, **kwargs):
            nonlocal call_index
            # Capture the compiled SQL
            from sqlalchemy.dialects import postgresql

            try:
                compiled = query.compile(dialect=postgresql.dialect())
                captured_queries.append(str(compiled))
            except Exception:
                captured_queries.append(str(query))

            # Return the pre-configured mock result
            result = original_results[call_index]
            call_index += 1
            return result

        mock_conn.execute = AsyncMock(side_effect=capturing_execute)

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

        return result, captured_queries

    @pytest.mark.asyncio
    async def test_expected_members_query_includes_is_guest(self):
        """The SQL query for expected members should reference is_guest,
        indicating guest visitors are included via a UNION."""
        mock_conn, mock_bot, mock_fetch = self._build_mocks()
        result, queries = await self._run_sync_and_capture_queries(
            mock_conn, mock_bot, mock_fetch
        )

        all_sql = " ".join(queries)
        assert "is_guest" in all_sql, (
            f"Expected 'is_guest' in SQL queries for guest visitor inclusion. "
            f"Queries executed: {queries}"
        )

    @pytest.mark.asyncio
    async def test_guest_query_uses_union_with_permanent_members(self):
        """The expected members query should use UNION to combine
        permanent members and guest visitors."""
        mock_conn, mock_bot, mock_fetch = self._build_mocks()
        result, queries = await self._run_sync_and_capture_queries(
            mock_conn, mock_bot, mock_fetch
        )

        all_sql = " ".join(queries)
        assert "UNION" in all_sql.upper(), (
            f"Expected 'UNION' in SQL queries for combined permanent + guest query. "
            f"Queries executed: {queries}"
        )

    @pytest.mark.asyncio
    async def test_guest_query_filters_by_rsvp_and_time_window(self):
        """The guest query should filter by rsvp_status and scheduled_at."""
        mock_conn, mock_bot, mock_fetch = self._build_mocks()
        result, queries = await self._run_sync_and_capture_queries(
            mock_conn, mock_bot, mock_fetch
        )

        all_sql = " ".join(queries)
        assert "rsvp_status" in all_sql, (
            f"Expected 'rsvp_status' in SQL queries for guest RSVP filtering. "
            f"Queries executed: {queries}"
        )
        assert "scheduled_at" in all_sql, (
            f"Expected 'scheduled_at' in SQL queries for time window filtering. "
            f"Queries executed: {queries}"
        )

    @pytest.mark.asyncio
    async def test_guest_visitors_are_granted_role(self):
        """Guest visitors from the UNION query should be granted the role."""

        mock_conn, mock_bot, mock_fetch = self._build_mocks()

        with patch("core.discord_outbound.bot._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch(
                    "core.discord_outbound.get_or_fetch_member",
                    side_effect=mock_fetch,
                ):
                    with patch(
                        "core.discord_outbound.get_role_member_ids",
                        return_value=set(),  # No one currently has the role
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
                            from core.sync import sync_group_discord_permissions

                            result = await sync_group_discord_permissions(group_id=1)

        # All 3 users (111, 222 permanent + 444 guest) should be granted
        assert result["granted"] == 3
        assert set(result["granted_discord_ids"]) == {"111", "222", "444"}
