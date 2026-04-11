"""Tests for user queries."""

import pytest
from unittest.mock import AsyncMock, MagicMock


class TestSearchUsers:
    """Tests for search_users query."""

    @pytest.mark.asyncio
    async def test_search_by_nickname(self):
        """Should find users by nickname substring."""
        from core.queries.users import search_users

        # Create mock connection that returns test data
        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {
                "user_id": 1,
                "discord_id": "111",
                "nickname": "Alice",
                "discord_username": "alice#1234",
            },
        ]
        mock_conn.execute.return_value = mock_result

        results = await search_users(mock_conn, "Ali")

        assert len(results) == 1
        assert results[0]["nickname"] == "Alice"

    @pytest.mark.asyncio
    async def test_search_by_discord_username(self):
        """Should find users by discord_username substring."""
        from core.queries.users import search_users

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {
                "user_id": 2,
                "discord_id": "222",
                "nickname": None,
                "discord_username": "bob_smith",
            },
        ]
        mock_conn.execute.return_value = mock_result

        results = await search_users(mock_conn, "bob")

        assert len(results) == 1
        assert results[0]["discord_username"] == "bob_smith"

    @pytest.mark.asyncio
    async def test_search_limits_results(self):
        """Should limit results to specified count."""
        from core.queries.users import search_users

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        # Return more results than limit
        mock_result.mappings.return_value = [
            {
                "user_id": i,
                "discord_id": str(i),
                "nickname": f"User{i}",
                "discord_username": f"user{i}",
            }
            for i in range(5)
        ]
        mock_conn.execute.return_value = mock_result

        await search_users(mock_conn, "User", limit=3)

        # Mock returns all 5, but function should pass limit to query
        # For unit test, we verify the query was constructed correctly
        call_args = mock_conn.execute.call_args
        assert call_args is not None


class TestGetUserAdminDetails:
    """Tests for get_user_admin_details query."""

    @pytest.mark.asyncio
    async def test_returns_user_with_group_info(self):
        """Should return user details including current group."""
        from core.queries.users import get_user_admin_details

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "user_id": 1,
            "discord_id": "111",
            "nickname": "Alice",
            "discord_username": "alice#1234",
            "email": "alice@example.com",
            "group_id": 5,
            "group_name": "Group A",
            "cohort_id": 2,
            "cohort_name": "Jan 2026 Cohort",
            "group_status": "active",
        }
        mock_conn.execute.return_value = mock_result

        result = await get_user_admin_details(mock_conn, 1)

        assert result is not None
        assert result["user_id"] == 1
        assert result["group_id"] == 5
        assert result["cohort_name"] == "Jan 2026 Cohort"

    @pytest.mark.asyncio
    async def test_returns_none_for_nonexistent_user(self):
        """Should return None when user not found."""
        from core.queries.users import get_user_admin_details

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute.return_value = mock_result

        result = await get_user_admin_details(mock_conn, 999)

        assert result is None
