# core/discord_mcp/__init__.py
"""Discord MCP server — search, read, and write Discord messages via MCP."""

from .server import create_mcp_app

__all__ = ["create_mcp_app"]
