"""MCP client lifecycle management.

Manages a persistent connection to the Stampy MCP server.
Lazy connection — first call to get_session() connects.
Returns None if URL not configured or connection fails.
"""

import asyncio
import logging
from contextlib import AsyncExitStack

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)


class MCPClientManager:
    """Manages a single MCP client session with lazy connection and reconnection."""

    def __init__(self, url: str | None):
        self._url = url
        self._session: ClientSession | None = None
        self._stack: AsyncExitStack | None = None
        self._lock = asyncio.Lock()
        self._tools_cache: list[dict] | None = None

    async def get_session(self) -> ClientSession | None:
        """Get the MCP session, connecting lazily on first call.

        Thread-safe — concurrent callers wait on the same connection.
        Returns None if URL is not configured or connection fails.
        """
        if not self._url:
            return None

        if self._session is not None:
            return self._session

        async with self._lock:
            # Double-check after acquiring lock
            if self._session is not None:
                return self._session
            try:
                return await self._connect()
            except Exception:
                logger.warning(
                    "Failed to connect to MCP server at %s",
                    self._url,
                    exc_info=True,
                )
                return None

    async def _connect(self) -> ClientSession:
        """Establish connection to the MCP server."""
        stack = AsyncExitStack()
        try:
            read, write, _ = await stack.enter_async_context(
                streamablehttp_client(self._url)
            )
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
        except:
            await stack.aclose()
            raise

        self._stack = stack
        self._session = session
        logger.info("Connected to MCP server at %s", self._url)
        return session

    @property
    def tools_cache(self) -> list[dict] | None:
        """Cached tool definitions from MCP server. Set after first load."""
        return self._tools_cache

    @tools_cache.setter
    def tools_cache(self, value: list[dict] | None):
        self._tools_cache = value

    async def reset(self):
        """Reset connection so next get_session() reconnects."""
        await self.close()

    async def close(self):
        """Close the MCP session and transport."""
        if self._stack:
            await self._stack.aclose()
        self._session = None
        self._stack = None
        self._tools_cache = None
