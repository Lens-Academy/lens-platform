"""Tests for tool registry and alignment search module."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.modules.tools import get_tools, execute_tool
from core.modules.tools.mcp_client import MCPClientManager


class TestGetToolsNoMCP:
    """get_tools() returns None when MCP URL is None."""

    @pytest.mark.asyncio
    async def test_returns_none_when_no_url(self):
        mgr = MCPClientManager(url=None)
        result = await get_tools(mgr)
        assert result is None


class TestGetToolsWithMCP:
    """get_tools() returns alignment search tools when MCP is available."""

    @pytest.mark.asyncio
    async def test_returns_tools_from_mcp(self):
        mgr = MCPClientManager(url="http://example.com/mcp")
        mock_session = MagicMock()
        fake_tools = [{"type": "function", "function": {"name": "search"}}]

        with (
            patch.object(
                mgr, "get_session", new_callable=AsyncMock, return_value=mock_session
            ),
            patch(
                "core.modules.tools.alignment_search.load_tools",
                new_callable=AsyncMock,
                return_value=fake_tools,
            ) as mock_load,
        ):
            result = await get_tools(mgr)

        assert result == fake_tools
        mock_load.assert_awaited_once_with(mock_session)


class TestGetToolsCaching:
    """get_tools() uses cached tools on second call."""

    @pytest.mark.asyncio
    async def test_caches_after_first_load(self):
        mgr = MCPClientManager(url="http://example.com/mcp")
        mock_session = MagicMock()
        fake_tools = [{"type": "function", "function": {"name": "search"}}]

        with (
            patch.object(
                mgr, "get_session", new_callable=AsyncMock, return_value=mock_session
            ),
            patch(
                "core.modules.tools.alignment_search.load_tools",
                new_callable=AsyncMock,
                return_value=fake_tools,
            ) as mock_load,
        ):
            result1 = await get_tools(mgr)
            result2 = await get_tools(mgr)

        assert result1 == fake_tools
        assert result2 == fake_tools
        # load_tools should only be called once
        mock_load.assert_awaited_once()


class TestExecuteToolSuccess:
    """execute_tool() calls MCP and returns result string."""

    @pytest.mark.asyncio
    async def test_returns_result_string(self):
        mgr = MCPClientManager(url="http://example.com/mcp")
        mock_session = MagicMock()
        tool_call = MagicMock()
        tool_call.function.name = "search_alignment_research"

        mock_result = MagicMock()
        mock_result.content = [MagicMock(text="Some alignment research results")]

        with (
            patch.object(
                mgr, "get_session", new_callable=AsyncMock, return_value=mock_session
            ),
            patch(
                "core.modules.tools.alignment_search.experimental_mcp_client.call_openai_tool",
                new_callable=AsyncMock,
                return_value=mock_result,
            ),
        ):
            result = await execute_tool(mgr, tool_call)

        assert "Some alignment research results" in result


class TestExecuteToolTimeout:
    """execute_tool() returns error on timeout."""

    @pytest.mark.asyncio
    async def test_returns_timeout_error(self):
        mgr = MCPClientManager(url="http://example.com/mcp")
        mock_session = MagicMock()
        tool_call = MagicMock()
        tool_call.function.name = "search_alignment_research"

        async def slow_execute(*args, **kwargs):
            await asyncio.sleep(100)

        with (
            patch.object(
                mgr, "get_session", new_callable=AsyncMock, return_value=mock_session
            ),
            patch(
                "core.modules.tools.alignment_search.execute",
                side_effect=slow_execute,
            ),
            patch("core.modules.tools.TOOL_TIMEOUT", 0.01),
        ):
            result = await execute_tool(mgr, tool_call)

        assert "timed out" in result.lower()


class TestExecuteToolRetryOnClosedSession:
    """execute_tool() retries once after ClosedResourceError (stale session)."""

    @pytest.mark.asyncio
    async def test_reconnects_and_succeeds_on_retry(self):
        """When MCP session dies between requests, should reset, reconnect, and succeed."""
        from anyio import ClosedResourceError

        mgr = MCPClientManager(url="http://example.com/mcp")
        tool_call = MagicMock()
        tool_call.function.name = "search_alignment_research"

        call_count = 0
        mock_result = MagicMock()
        mock_result.content = [MagicMock(text="Results after reconnect")]

        async def call_openai_tool_with_stale_session(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ClosedResourceError()
            return mock_result

        session1 = MagicMock()
        session2 = MagicMock()
        session_sequence = iter([session1, session2])

        async def get_session_sequence():
            return next(session_sequence)

        with (
            patch.object(mgr, "get_session", side_effect=get_session_sequence),
            patch.object(mgr, "reset", new_callable=AsyncMock) as mock_reset,
            patch(
                "core.modules.tools.alignment_search.experimental_mcp_client.call_openai_tool",
                side_effect=call_openai_tool_with_stale_session,
            ),
        ):
            result = await execute_tool(mgr, tool_call)

        assert "Results after reconnect" in result
        mock_reset.assert_awaited_once()
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_gives_up_after_second_failure(self):
        """If retry also fails, should return error."""
        from anyio import ClosedResourceError

        mgr = MCPClientManager(url="http://example.com/mcp")
        tool_call = MagicMock()
        tool_call.function.name = "search_alignment_research"

        mock_session = MagicMock()

        with (
            patch.object(
                mgr, "get_session", new_callable=AsyncMock, return_value=mock_session
            ),
            patch.object(mgr, "reset", new_callable=AsyncMock),
            patch(
                "core.modules.tools.alignment_search.experimental_mcp_client.call_openai_tool",
                new_callable=AsyncMock,
                side_effect=ClosedResourceError(),
            ),
        ):
            result = await execute_tool(mgr, tool_call)

        assert "unavailable" in result.lower()


class TestExecuteToolNoSession:
    """execute_tool() returns error when session unavailable."""

    @pytest.mark.asyncio
    async def test_returns_error_when_no_session(self):
        mgr = MCPClientManager(url=None)
        tool_call = MagicMock()
        tool_call.function.name = "search_alignment_research"

        result = await execute_tool(mgr, tool_call)

        assert "unavailable" in result.lower()
