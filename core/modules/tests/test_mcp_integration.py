"""Integration tests for Stampy MCP server connection.

These tests hit the real MCP server at https://chat.aisafety.info/mcp.
They are slow (network I/O) and require internet access.

Run manually: .venv/bin/pytest core/modules/tests/test_mcp_integration.py -v -s
"""

import os

import pytest

STAMPY_MCP_URL = "https://chat.aisafety.info/mcp"

# Skip if explicitly disabled or no network expected
pytestmark = pytest.mark.skipif(
    os.environ.get("SKIP_INTEGRATION_TESTS", "").lower() in ("1", "true"),
    reason="SKIP_INTEGRATION_TESTS is set",
)


@pytest.mark.asyncio
async def test_connect_and_list_tools():
    """Should connect to Stampy MCP and list the search_alignment_research tool."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(STAMPY_MCP_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()

            tool_names = [t.name for t in tools.tools]
            assert "search_alignment_research" in tool_names


@pytest.mark.asyncio
async def test_search_returns_results():
    """Should return alignment research results for a known query."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(STAMPY_MCP_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "search_alignment_research",
                {"query": "corrigibility", "k": 3},
            )

            assert result.content
            text = result.content[0].text
            assert "corrigib" in text.lower()


@pytest.mark.asyncio
async def test_session_survives_multiple_calls():
    """Same session should handle multiple sequential tool calls."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(STAMPY_MCP_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            result1 = await session.call_tool(
                "search_alignment_research",
                {"query": "corrigibility", "k": 2},
            )
            assert result1.content

            result2 = await session.call_tool(
                "search_alignment_research",
                {"query": "mesa optimization", "k": 2},
            )
            assert result2.content


@pytest.mark.asyncio
async def test_mcp_client_manager_reconnects_after_close():
    """MCPClientManager should reconnect after session is closed."""
    from core.modules.tools.mcp_client import MCPClientManager

    mgr = MCPClientManager(url=STAMPY_MCP_URL)

    # First connection
    session1 = await mgr.get_session()
    assert session1 is not None

    # Force close
    await mgr.reset()

    # Should reconnect
    session2 = await mgr.get_session()
    assert session2 is not None
    assert session2 is not session1

    await mgr.close()


def _make_tool_call(query: str, call_id: str = "call_test"):
    """Build a tool_call object matching what stream_chunk_builder produces."""
    from litellm.types.utils import ChatCompletionMessageToolCall, Function

    return ChatCompletionMessageToolCall(
        id=call_id,
        type="function",
        function=Function(
            name="search_alignment_research",
            arguments=f'{{"query": "{query}", "k": 3}}',
        ),
    )


@pytest.mark.asyncio
async def test_full_tool_execution_flow():
    """End-to-end: MCPClientManager → get_tools → execute_tool."""
    from core.modules.tools import execute_tool, get_tools
    from core.modules.tools.mcp_client import MCPClientManager

    mgr = MCPClientManager(url=STAMPY_MCP_URL)

    # Load tools
    tools = await get_tools(mgr)
    assert tools is not None
    assert len(tools) >= 1
    assert tools[0]["function"]["name"] == "search_alignment_research"

    # Execute with real tool_call type
    tool_call = _make_tool_call("deceptive alignment", "call_integration_test")
    result = await execute_tool(mgr, tool_call)
    assert "Error" not in result
    assert len(result) > 50  # Should have real content

    await mgr.close()


@pytest.mark.asyncio
async def test_retry_after_stale_session():
    """execute_tool should retry and succeed when session dies between calls."""
    from unittest.mock import MagicMock

    from core.modules.tools import execute_tool, get_tools
    from core.modules.tools.mcp_client import MCPClientManager

    mgr = MCPClientManager(url=STAMPY_MCP_URL)

    # Load tools (connects session)
    tools = await get_tools(mgr)
    assert tools is not None

    # Kill the session to simulate what the Stampy server does
    if mgr._stack:
        await mgr._stack.aclose()
    # Clear stack but keep stale session reference (this is what happens in practice)
    mgr._stack = None
    mgr._session = MagicMock()  # stale — will cause ClosedResourceError or similar

    # Execute — should fail on first attempt, reconnect, and succeed
    tool_call = _make_tool_call("corrigibility", "call_retry_test")
    result = await execute_tool(mgr, tool_call)
    assert "Error" not in result
    assert len(result) > 50

    await mgr.close()
