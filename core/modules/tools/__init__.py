"""Tool registry for the tutor chat system.

Assembles tools per request and dispatches execution.
"""

import asyncio
import json
import logging

from . import alignment_search
from .mcp_client import MCPClientManager

logger = logging.getLogger(__name__)

_LOCAL_TOOL_NAMES = {"search_course_content", "read_lens", "read_url"}

READ_URL_TOOL = {
    "type": "function",
    "function": {
        "name": "read_url",
        "description": (
            "Examine the live contents of a website or embedded iframe. "
            "Use this to research external links or to get more information from "
            "interactive content when the initial summary is insufficient. "
            "Returns a cleaned briefing (Title, Description, and Body)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Full URL to fetch and examine",
                },
            },
            "required": ["url"],
        },
    },
}


async def get_tools(
    mcp_manager: MCPClientManager,
    content_index=None,
) -> list[dict] | None:
    """Get all available tools in OpenAI function-calling format.

    Combines MCP tools (alignment search) with local tools (course content).
    Returns None when no tools are available at all.
    """
    all_tools: list[dict] = []

    # MCP tools (cached after first load)
    if mcp_manager.tools_cache is not None:
        all_tools.extend(mcp_manager.tools_cache)
    else:
        for attempt in range(2):
            session = await mcp_manager.get_session()
            if not session:
                break
            mcp_tools = await alignment_search.load_tools(session)
            if mcp_tools:
                logger.info("Loaded %d MCP tools", len(mcp_tools))
                mcp_manager.tools_cache = mcp_tools
                all_tools.extend(mcp_tools)
                break
            if attempt == 0:
                logger.info("No MCP tools loaded, resetting session and retrying")
                await mcp_manager.reset()
        else:
            mcp_manager.tools_cache = []

    # Local tools (course content)
    if content_index is not None:
        from .course_search import get_tool_definitions

        all_tools.extend(get_tool_definitions())
        all_tools.append(READ_URL_TOOL)

    return all_tools or None


async def execute_tool(
    mcp_manager: MCPClientManager,
    tool_call,
    content_index=None,
) -> str:
    """Execute a single tool call and return the result as a string."""
    name = tool_call.function.name

    # Local tools — no MCP needed
    if name in _LOCAL_TOOL_NAMES:
        if name == "read_url":
            args = json.loads(tool_call.function.arguments)
            url = args.get("url", "")
            from .external_reader import execute_read_url

            return await execute_read_url(url)

        if content_index is None:
            return "Error: course content index not available"
        from .course_search import execute_tool as execute_local

        return execute_local(tool_call, content_index)

    # MCP tools
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
