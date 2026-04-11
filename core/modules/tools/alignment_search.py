"""Alignment research search via Stampy MCP server."""

import logging

from mcp import ClientSession
from litellm import experimental_mcp_client

logger = logging.getLogger(__name__)


async def load_tools(session: ClientSession) -> list[dict]:
    """Load alignment search tools from MCP server in OpenAI format."""
    try:
        tools = await experimental_mcp_client.load_mcp_tools(
            session=session, format="openai"
        )
        return tools
    except Exception:
        logger.warning("Failed to load MCP tools", exc_info=True)
        return []


async def execute(session: ClientSession, tool_call) -> str:
    """Execute an alignment search tool call via MCP.

    Raises on connection errors (ClosedResourceError etc.) so the caller
    can retry with a fresh session. Only catches response-format errors.
    """
    result = await experimental_mcp_client.call_openai_tool(
        session=session, openai_tool=tool_call
    )
    # Extract text from MCP result
    if result.content:
        texts = [block.text for block in result.content if hasattr(block, "text")]
        return "\n".join(texts) if texts else "No results found."
    return "No results found."
