# core/discord_mcp/server.py
"""FastMCP server exposing Discord search, read, write, and sync tools."""

import hmac
import logging
import os

import discord
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Simple bearer token auth middleware."""

    def __init__(self, app, token: str):
        super().__init__(app)
        self.token = token

    async def dispatch(self, request: Request, call_next):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or not hmac.compare_digest(
            auth[7:], self.token
        ):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)


def create_mcp_app(
    bot: discord.Client,
    guild_id: int,
) -> Starlette:
    """
    Create the MCP Starlette app with all tools registered.

    Args:
        bot: Discord bot instance (must be ready).
        guild_id: Discord guild ID to operate on.

    Returns:
        Starlette app ready to be mounted on FastAPI.
    """
    mcp = FastMCP(
        "Lens Discord MCP",
        instructions=(
            "Search, read, and write messages in the Lens Academy Discord server. "
            "Use search_messages for keyword search, read_messages for live channel "
            "reading, send_message to post via webhook, and list_channels to discover channels."
        ),
        stateless_http=True,
        json_response=True,
    )

    # -- Tools --

    @mcp.tool()
    async def search_messages(
        query: str,
        channel: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Search Discord messages by keyword. Uses PostgreSQL full-text search.

        Args:
            query: Search terms (natural language).
            channel: Optional channel name or ID to filter results.
            limit: Max results (default 10).
        """
        from .search import search_keyword

        if not query.strip():
            return []
        return await search_keyword(query, channel=channel, limit=min(limit, 100))

    @mcp.tool()
    async def read_messages(
        channel: str,
        around_message_id: int | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Read messages from a Discord channel (live from Discord API).

        Args:
            channel: Channel name or ID.
            around_message_id: If provided, read messages around this message ID.
            limit: Max messages to return (default 50).
        """
        if not bot.is_ready():
            return [{"error": "Discord bot is still connecting, try again shortly"}]

        limit = min(limit, 200)
        guild = bot.get_guild(guild_id)
        if not guild:
            return [{"error": f"Guild {guild_id} not found"}]

        # Resolve channel
        ch = _resolve_channel(guild, channel)
        if not ch:
            return [{"error": f"Channel '{channel}' not found"}]

        msgs = []
        if around_message_id:
            msg_ref = discord.Object(id=around_message_id)
            async for msg in ch.history(limit=limit, around=msg_ref):
                msgs.append(_format_message(msg, ch.name))
        else:
            async for msg in ch.history(limit=limit):
                msgs.append(_format_message(msg, ch.name))

        msgs.sort(key=lambda m: m["created_at"])
        return msgs

    @mcp.tool()
    async def list_channels() -> list[dict]:
        """List all channels in the Discord server with their types and topics."""
        from sqlalchemy import select, func

        from core.database import get_connection
        from .tables import channels, messages

        async with get_connection() as conn:
            stmt = (
                select(
                    channels.c.id,
                    channels.c.name,
                    channels.c.type,
                    channels.c.topic,
                    channels.c.parent_id,
                    func.count(messages.c.id).label("message_count"),
                )
                .select_from(
                    channels.outerjoin(messages, channels.c.id == messages.c.channel_id)
                )
                .group_by(channels.c.id)
                .order_by(channels.c.name)
            )
            rows = (await conn.execute(stmt)).mappings().all()

        return [
            {
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "topic": row["topic"],
                "parent_id": row["parent_id"],
                "message_count": row["message_count"],
            }
            for row in rows
        ]

    @mcp.tool()
    async def send_message(
        channel: str,
        content: str,
        display_name: str | None = None,
    ) -> dict:
        """Send a message to a Discord channel via webhook.

        Args:
            channel: Channel name or ID.
            content: Message text to send.
            display_name: Custom sender name (shown in Discord). Defaults to "Lens MCP".
        """
        if not bot.is_ready():
            return {"error": "Discord bot is still connecting, try again shortly"}

        from .send import send_message as _send

        return await _send(bot, guild_id, channel, content, display_name)

    @mcp.tool()
    async def sync_channel(channel: str | None = None) -> dict:
        """Trigger a message sync/backfill for a channel or the entire server.

        Args:
            channel: Channel name or ID. If omitted, syncs all channels.
        """
        if not bot.is_ready():
            return {"error": "Discord bot is still connecting, try again shortly"}

        from .export import sync_channel as _sync_channel, sync_guild

        if channel:
            guild = bot.get_guild(guild_id)
            if not guild:
                return {"error": f"Guild {guild_id} not found"}
            ch = _resolve_channel(guild, channel)
            if not ch:
                return {"error": f"Channel '{channel}' not found"}
            count = await _sync_channel(ch, guild_id)
            return {"channel": ch.name, "messages_synced": count}
        else:
            # Full guild sync
            result = await sync_guild(bot, guild_id)
            return result

    # -- Helpers --

    def _resolve_channel(
        guild: discord.Guild, identifier: str
    ) -> discord.abc.Messageable | None:
        """Resolve a channel by name or ID. Searches text, forum, and thread channels."""
        try:
            channel_id = int(identifier)
            ch = guild.get_channel(channel_id) or guild.get_thread(channel_id)
            return ch
        except ValueError:
            name = identifier.lower()
            for ch in guild.text_channels:
                if ch.name.lower() == name:
                    return ch
            for ch in guild.forums:
                if ch.name.lower() == name:
                    return ch
            for thread in guild.threads:
                if thread.name.lower() == name:
                    return thread
            return None

    def _format_message(msg: discord.Message, channel_name: str) -> dict:
        """Format a discord.Message for MCP tool output."""
        return {
            "id": msg.id,
            "channel_name": channel_name,
            "author_name": msg.author.display_name,
            "content": msg.content,
            "created_at": msg.created_at.isoformat(),
            "edited_at": msg.edited_at.isoformat() if msg.edited_at else None,
        }

    # Build the Starlette app
    starlette_app = mcp.streamable_http_app()

    # Add auth middleware if token is configured
    auth_token = os.environ.get("DISCORD_MCP_AUTH_TOKEN")
    if auth_token:
        starlette_app.add_middleware(BearerAuthMiddleware, token=auth_token)

    # Expose the session manager for lifecycle management
    starlette_app._mcp_session_manager = mcp._session_manager

    return starlette_app
