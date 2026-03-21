"""Tests for MCP client lifecycle manager."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.modules.tools.mcp_client import MCPClientManager


class TestGetSessionNoneURL:
    """get_session() returns None when URL is None."""

    @pytest.mark.asyncio
    async def test_returns_none_when_url_is_none(self):
        mgr = MCPClientManager(url=None)
        assert await mgr.get_session() is None

    @pytest.mark.asyncio
    async def test_returns_none_when_url_is_empty(self):
        mgr = MCPClientManager(url="")
        assert await mgr.get_session() is None


class TestGetSessionLazyConnect:
    """get_session() lazily connects on first call."""

    @pytest.mark.asyncio
    async def test_connects_on_first_call(self):
        mock_session = MagicMock()
        mock_session.initialize = AsyncMock()

        mock_transport_cm = AsyncMock()
        mock_transport_cm.__aenter__ = AsyncMock(
            return_value=(MagicMock(), MagicMock(), MagicMock())
        )
        mock_transport_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session_cm = AsyncMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "core.modules.tools.mcp_client.streamablehttp_client",
                return_value=mock_transport_cm,
            ),
            patch(
                "core.modules.tools.mcp_client.ClientSession",
                return_value=mock_session_cm,
            ),
        ):
            mgr = MCPClientManager(url="http://example.com/mcp")
            session = await mgr.get_session()

            assert session is mock_session
            mock_session.initialize.assert_awaited_once()

        await mgr.close()


class TestGetSessionCaching:
    """get_session() returns cached session on subsequent calls."""

    @pytest.mark.asyncio
    async def test_returns_cached_session(self):
        mock_session = MagicMock()
        mock_session.initialize = AsyncMock()

        mock_transport_cm = AsyncMock()
        mock_transport_cm.__aenter__ = AsyncMock(
            return_value=(MagicMock(), MagicMock(), MagicMock())
        )
        mock_transport_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session_cm = AsyncMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "core.modules.tools.mcp_client.streamablehttp_client",
                return_value=mock_transport_cm,
            ) as mock_transport,
            patch(
                "core.modules.tools.mcp_client.ClientSession",
                return_value=mock_session_cm,
            ) as mock_cls,
        ):
            mgr = MCPClientManager(url="http://example.com/mcp")
            session1 = await mgr.get_session()
            session2 = await mgr.get_session()

            assert session1 is session2
            # Transport and session created only once
            mock_transport.assert_called_once()
            mock_cls.assert_called_once()

        await mgr.close()


class TestGetSessionConnectionFailure:
    """get_session() returns None on connection failure."""

    @pytest.mark.asyncio
    async def test_returns_none_on_failure(self):
        with patch(
            "core.modules.tools.mcp_client.streamablehttp_client",
            side_effect=ConnectionError("refused"),
        ):
            mgr = MCPClientManager(url="http://example.com/mcp")
            session = await mgr.get_session()
            assert session is None


class TestClose:
    """close() cleans up resources."""

    @pytest.mark.asyncio
    async def test_close_cleans_up(self):
        mock_session = MagicMock()
        mock_session.initialize = AsyncMock()

        mock_transport_cm = AsyncMock()
        mock_transport_cm.__aenter__ = AsyncMock(
            return_value=(MagicMock(), MagicMock(), MagicMock())
        )
        mock_transport_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session_cm = AsyncMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "core.modules.tools.mcp_client.streamablehttp_client",
                return_value=mock_transport_cm,
            ),
            patch(
                "core.modules.tools.mcp_client.ClientSession",
                return_value=mock_session_cm,
            ),
        ):
            mgr = MCPClientManager(url="http://example.com/mcp")
            await mgr.get_session()

            # Set tools cache to verify it gets cleared
            mgr.tools_cache = [{"name": "test"}]

            await mgr.close()

            assert mgr._session is None
            assert mgr._stack is None
            assert mgr.tools_cache is None

    @pytest.mark.asyncio
    async def test_close_safe_when_not_connected(self):
        mgr = MCPClientManager(url="http://example.com/mcp")
        # Should not raise
        await mgr.close()
        await mgr.close()

    @pytest.mark.asyncio
    async def test_reset_allows_reconnect(self):
        mock_session = MagicMock()
        mock_session.initialize = AsyncMock()

        mock_transport_cm = AsyncMock()
        mock_transport_cm.__aenter__ = AsyncMock(
            return_value=(MagicMock(), MagicMock(), MagicMock())
        )
        mock_transport_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session_cm = AsyncMock()
        mock_session_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cm.__aexit__ = AsyncMock(return_value=False)

        with (
            patch(
                "core.modules.tools.mcp_client.streamablehttp_client",
                return_value=mock_transport_cm,
            ) as mock_transport,
            patch(
                "core.modules.tools.mcp_client.ClientSession",
                return_value=mock_session_cm,
            ) as mock_cls,
        ):
            mgr = MCPClientManager(url="http://example.com/mcp")
            await mgr.get_session()
            await mgr.reset()
            await mgr.get_session()

            # Should have connected twice
            assert mock_transport.call_count == 2
            assert mock_cls.call_count == 2
