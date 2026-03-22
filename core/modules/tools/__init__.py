"""Tool registry for the tutor chat system.

Assembles tools per request and dispatches execution.
"""

import asyncio
import logging

from . import alignment_search
from .mcp_client import MCPClientManager

logger = logging.getLogger(__name__)

# Tool execution timeout in seconds
TOOL_TIMEOUT = 15


async def get_tools(mcp_manager: MCPClientManager) -> list[dict] | None:
    """Get all available tools in OpenAI function-calling format.

    Caches tool definitions after first load (they don't change between requests).
    Returns None (not empty list) when no tools are available.
    """
    if mcp_manager.tools_cache is not None:
        return mcp_manager.tools_cache or None

    session = await mcp_manager.get_session()
    if not session:
        return None

    mcp_tools = await alignment_search.load_tools(session)
    logger.info("Loaded %d MCP tools", len(mcp_tools))
    mcp_manager.tools_cache = mcp_tools
    return mcp_tools if mcp_tools else None


async def execute_tool(mcp_manager: MCPClientManager, tool_call) -> str:
    """Execute a single tool call and return the result as a string.

    All MCP tools are dispatched through the MCP session.
    Handles timeouts and errors gracefully -- always returns a string.
    """
    name = tool_call.function.name

    for attempt in range(2):
        try:
            session = await mcp_manager.get_session()
            if not session:
                return "Error: search service unavailable"


            result = await asyncio.wait_for(
                alignment_search.execute(session, tool_call), timeout=TOOL_TIMEOUT
            )
            return result

        except asyncio.TimeoutError:
            logger.warning("Tool %s timed out after %ds", name, TOOL_TIMEOUT)
            return "Tool timed out — respond without this information."
        except Exception as e:
            if attempt == 0:
                # First failure — reconnect and retry once
                logger.info("Tool %s failed, reconnecting: %s", name, e)
                await mcp_manager.reset()
                continue
            logger.warning("Tool %s failed after retry: %s", name, e, exc_info=True)
            await mcp_manager.reset()
            return f"Error: tool unavailable ({e})"

    return "Error: tool unavailable"
