# Tutor Tools Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tutor an alignment research search tool (via Stampy MCP) and course-wide context in the system prompt.

**Architecture:** Add a tool registry and execution loop to the existing chat system. The tool loop streams LLM chunks to the frontend while collecting them for `stream_chunk_builder`. When the LLM calls a tool, the loop executes it via the MCP client and re-calls the LLM with results. Course context is built from cached content and injected into the system prompt.

**Tech Stack:** Python, LiteLLM (acompletion + stream_chunk_builder), MCP Python SDK (streamablehttp_client), FastAPI lifespan, pytest

**Spec:** `docs/superpowers/specs/2026-03-21-tutor-tools-design.md`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `core/modules/tools/__init__.py` | Create | Tool registry — `get_tools()`, `execute_tool()` |
| `core/modules/tools/mcp_client.py` | Create | MCP session lifecycle (connect/reconnect/close) |
| `core/modules/tools/alignment_search.py` | Create | Stampy MCP tool definition + executor |
| `core/modules/llm.py` | Modify | Add `stream_and_collect()` that yields events AND returns full message |
| `core/modules/chat.py` | Modify | Remove `TRANSITION_TOOL`, add tool execution loop |
| `core/modules/prompts.py` | Modify | Add `build_course_overview()`, tool usage guidance |
| `main.py` | Modify | Initialize MCP client in lifespan |
| `requirements.txt` | Modify | Add `mcp` dependency |
| `core/modules/tests/test_tool_registry.py` | Create | Tests for tool registry |
| `core/modules/tests/test_tool_loop.py` | Create | Tests for tool execution loop |
| `core/modules/tests/test_course_overview.py` | Create | Tests for course overview prompt builder |
| `core/modules/tests/test_mcp_client.py` | Create | Tests for MCP client lifecycle |

---

### Task 1: MCP Client Lifecycle

Manages the MCP session to the Stampy server. Lazy connection — doesn't fail at startup if the server is unavailable.

**Files:**
- Create: `core/modules/tools/mcp_client.py`
- Test: `core/modules/tests/test_mcp_client.py`

- [ ] **Step 1: Write failing tests for MCP client**

```python
# core/modules/tests/test_mcp_client.py
"""Tests for MCP client lifecycle management."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_get_session_returns_none_when_no_url():
    """Should return None when STAMPY_MCP_URL is not set."""
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url=None)
    session = await manager.get_session()
    assert session is None


@pytest.mark.asyncio
async def test_get_session_connects_on_first_call():
    """Should lazily connect on first get_session() call."""
    from core.modules.tools.mcp_client import MCPClientManager

    mock_session = AsyncMock()
    mock_session.initialize = AsyncMock()

    manager = MCPClientManager(url="https://example.com/mcp")

    with patch(
        "core.modules.tools.mcp_client.streamablehttp_client"
    ) as mock_client:
        # streamablehttp_client is an async context manager that yields (read, write, _)
        mock_read = AsyncMock()
        mock_write = AsyncMock()
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read, mock_write, None))
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_client.return_value = mock_ctx

        with patch(
            "core.modules.tools.mcp_client.ClientSession"
        ) as mock_session_cls:
            mock_session_instance = AsyncMock()
            mock_session_instance.initialize = AsyncMock()
            mock_session_ctx = AsyncMock()
            mock_session_ctx.__aenter__ = AsyncMock(return_value=mock_session_instance)
            mock_session_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_session_cls.return_value = mock_session_ctx

            session = await manager.get_session()
            assert session is mock_session_instance
            mock_session_instance.initialize.assert_called_once()


@pytest.mark.asyncio
async def test_get_session_returns_cached_session():
    """Should return the same session on subsequent calls without reconnecting."""
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url="https://example.com/mcp")
    mock_session = AsyncMock()
    manager._session = mock_session

    session = await manager.get_session()
    assert session is mock_session


@pytest.mark.asyncio
async def test_get_session_returns_none_on_connection_failure():
    """Should return None and log warning if connection fails."""
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url="https://example.com/mcp")

    with patch(
        "core.modules.tools.mcp_client.streamablehttp_client",
        side_effect=Exception("Connection refused"),
    ):
        session = await manager.get_session()
        assert session is None


@pytest.mark.asyncio
async def test_close_cleans_up():
    """Should close session and transport on shutdown."""
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url="https://example.com/mcp")
    mock_session_ctx = AsyncMock()
    mock_transport_ctx = AsyncMock()
    manager._session_ctx = mock_session_ctx
    manager._transport_ctx = mock_transport_ctx
    manager._session = AsyncMock()

    await manager.close()

    mock_session_ctx.__aexit__.assert_called_once()
    mock_transport_ctx.__aexit__.assert_called_once()
    assert manager._session is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_mcp_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.modules.tools'`

- [ ] **Step 3: Install `mcp` dependency**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pip install mcp`

Add to `requirements.txt` after the `litellm` line:
```
mcp>=1.0.0  # MCP client for alignment research search
```

- [ ] **Step 4: Implement MCP client manager**

```python
# core/modules/tools/__init__.py
"""Tool registry for the tutor chat system."""

# core/modules/tools/mcp_client.py
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
                    "Failed to connect to MCP server at %s", self._url, exc_info=True
                )
                return None

    async def _connect(self) -> ClientSession:
        """Establish connection to the MCP server."""
        stack = AsyncExitStack()
        try:
            read, write, _ = await stack.enter_async_context(
                streamablehttp_client(self._url)
            )
            session = await stack.enter_async_context(
                ClientSession(read, write)
            )
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_mcp_client.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```
jj describe -m "feat: add MCP client lifecycle manager for Stampy alignment search"
jj new
```

---

### Task 2: Tool Registry

Assembles tools per request and dispatches tool execution.

**Files:**
- Modify: `core/modules/tools/__init__.py`
- Create: `core/modules/tools/alignment_search.py`
- Test: `core/modules/tests/test_tool_registry.py`

- [ ] **Step 1: Write failing tests for tool registry**

```python
# core/modules/tests/test_tool_registry.py
"""Tests for tool registry — assembles tools and dispatches execution."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_get_tools_returns_none_when_no_tools_available():
    """Should return None when no tools are configured (e.g., no MCP URL)."""
    from core.modules.tools import get_tools
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url=None)
    tools = await get_tools(manager)
    assert tools is None


@pytest.mark.asyncio
async def test_get_tools_returns_alignment_search_tool():
    """Should return alignment search tool when MCP is available."""
    from core.modules.tools import get_tools
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url="https://example.com/mcp")
    mock_session = AsyncMock()

    # Mock load_mcp_tools to return a tool definition
    mock_tool = {
        "type": "function",
        "function": {
            "name": "search_alignment_research",
            "description": "Search alignment research",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
        },
    }

    with patch.object(manager, "get_session", return_value=mock_session):
        with patch(
            "core.modules.tools.alignment_search.load_tools",
            return_value=[mock_tool],
        ):
            tools = await get_tools(manager)
            assert tools is not None
            assert len(tools) >= 1
            assert tools[0]["function"]["name"] == "search_alignment_research"


@pytest.mark.asyncio
async def test_execute_tool_calls_mcp():
    """Should execute a tool call via MCP and return the result string."""
    from core.modules.tools import execute_tool
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url="https://example.com/mcp")
    mock_session = AsyncMock()

    # Simulate a tool call from the LLM
    tool_call = MagicMock()
    tool_call.function.name = "search_alignment_research"
    tool_call.function.arguments = '{"query": "mesa optimization"}'
    tool_call.id = "call_123"

    mock_result = MagicMock()
    mock_result.content = [MagicMock(text="Result about mesa optimization...")]

    with patch.object(manager, "get_session", return_value=mock_session):
        with patch(
            "core.modules.tools.alignment_search.execute",
            return_value="Result about mesa optimization...",
        ):
            result = await execute_tool(manager, tool_call)
            assert "mesa optimization" in result


@pytest.mark.asyncio
async def test_execute_tool_returns_error_on_timeout():
    """Should return error string if tool execution times out."""
    import asyncio
    from core.modules.tools import execute_tool
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url="https://example.com/mcp")
    mock_session = AsyncMock()

    tool_call = MagicMock()
    tool_call.function.name = "search_alignment_research"
    tool_call.function.arguments = '{"query": "test"}'
    tool_call.id = "call_456"

    with patch.object(manager, "get_session", return_value=mock_session):
        with patch(
            "core.modules.tools.alignment_search.execute",
            side_effect=asyncio.TimeoutError(),
        ):
            result = await execute_tool(manager, tool_call)
            assert "timed out" in result.lower() or "unavailable" in result.lower()


@pytest.mark.asyncio
async def test_execute_tool_returns_error_on_unknown_tool():
    """Should return error for unknown tool names."""
    from core.modules.tools import execute_tool
    from core.modules.tools.mcp_client import MCPClientManager

    manager = MCPClientManager(url="https://example.com/mcp")

    tool_call = MagicMock()
    tool_call.function.name = "nonexistent_tool"
    tool_call.function.arguments = "{}"
    tool_call.id = "call_789"

    result = await execute_tool(manager, tool_call)
    assert "unknown" in result.lower() or "error" in result.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_tool_registry.py -v`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Implement alignment search tool**

```python
# core/modules/tools/alignment_search.py
"""Alignment research search via Stampy MCP server."""

import json
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

    Args:
        session: Active MCP client session
        tool_call: OpenAI-format tool call from LLM response

    Returns:
        Tool result as string
    """
    try:
        result = await experimental_mcp_client.call_openai_tool(
            session=session, openai_tool=tool_call
        )
        # Extract text from MCP result
        if result.content:
            texts = [
                block.text for block in result.content if hasattr(block, "text")
            ]
            return "\n".join(texts) if texts else "No results found."
        return "No results found."
    except Exception as e:
        logger.warning("MCP tool execution failed: %s", e, exc_info=True)
        return f"Error: search unavailable ({e})"
```

- [ ] **Step 4: Implement tool registry**

```python
# core/modules/tools/__init__.py
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
    mcp_manager.tools_cache = mcp_tools
    return mcp_tools if mcp_tools else None


async def execute_tool(mcp_manager: MCPClientManager, tool_call) -> str:
    """Execute a single tool call and return the result as a string.

    All MCP tools are dispatched through the MCP session.
    Handles timeouts and errors gracefully — always returns a string.
    """
    name = tool_call.function.name

    try:
        session = await mcp_manager.get_session()
        if not session:
            return "Error: search service unavailable"

        # All tools loaded from MCP are executed via MCP
        result = await asyncio.wait_for(
            alignment_search.execute(session, tool_call), timeout=TOOL_TIMEOUT
        )
        return result

    except asyncio.TimeoutError:
        logger.warning("Tool %s timed out after %ds", name, TOOL_TIMEOUT)
        return "Tool timed out — respond without this information."
    except Exception as e:
        logger.warning("Tool %s failed: %s", name, e, exc_info=True)
        await mcp_manager.reset()
        return f"Error: tool unavailable ({e})"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_tool_registry.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```
jj describe -m "feat: add tool registry with alignment research search via Stampy MCP"
jj new
```

---

### Task 3: Tool Execution Loop in LLM + Chat

Refactor `stream_chat()` to support chunk collection, and add a multi-round tool loop to `send_module_message()`.

**Files:**
- Modify: `core/modules/llm.py`
- Modify: `core/modules/chat.py`
- Test: `core/modules/tests/test_tool_loop.py`
- Modify: `core/modules/tests/test_llm.py` (update existing tests if interface changes)

- [ ] **Step 1: Write failing tests for the tool execution loop**

```python
# core/modules/tests/test_tool_loop.py
"""Tests for the tool execution loop in send_module_message."""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_text_chunk(text):
    """Create a mock streaming chunk with text content."""
    delta = MagicMock()
    delta.content = text
    delta.tool_calls = None
    delta.reasoning_content = None  # Use attribute access
    choice = MagicMock()
    choice.delta = delta
    choice.finish_reason = None
    chunk = MagicMock()
    chunk.choices = [choice]
    return chunk


def _make_done_chunk(finish_reason="stop"):
    """Create a mock streaming chunk that signals completion."""
    delta = MagicMock()
    delta.content = None
    delta.tool_calls = None
    delta.reasoning_content = None
    choice = MagicMock()
    choice.delta = delta
    choice.finish_reason = finish_reason
    chunk = MagicMock()
    chunk.choices = [choice]
    return chunk


@pytest.mark.asyncio
async def test_no_tools_streams_normally():
    """When no tools are called, should stream text and done events."""
    from core.modules.chat import send_module_message
    from core.modules.types import ChatStage

    stage = ChatStage(type="chat", instructions="Help the user.")

    chunks = [_make_text_chunk("Hello "), _make_text_chunk("world!"), _make_done_chunk()]

    async def mock_stream(*args, **kwargs):
        for c in chunks:
            yield c

    with patch("core.modules.chat.acompletion", side_effect=lambda **kw: mock_stream()):
        with patch("core.modules.chat.stream_chunk_builder") as mock_builder:
            # stream_chunk_builder returns a response with no tool_calls
            mock_msg = MagicMock()
            mock_msg.tool_calls = None
            mock_msg.content = "Hello world!"
            mock_resp = MagicMock()
            mock_resp.choices = [MagicMock(message=mock_msg)]
            mock_builder.return_value = mock_resp

            events = []
            async for event in send_module_message(
                messages=[{"role": "user", "content": "Hi"}],
                current_stage=stage,
                mcp_manager=None,
            ):
                events.append(event)

            text_events = [e for e in events if e["type"] == "text"]
            assert len(text_events) >= 1
            assert any(e["type"] == "done" for e in events)


@pytest.mark.asyncio
async def test_tool_call_executes_and_continues():
    """When LLM calls a tool, should execute it and re-call LLM."""
    from core.modules.chat import send_module_message
    from core.modules.types import ChatStage

    stage = ChatStage(type="chat", instructions="Help the user.")

    # First call: LLM returns a tool call
    tool_call_chunk = MagicMock()
    tc = MagicMock()
    tc.function = MagicMock()
    tc.function.name = "search_alignment_research"
    tc.function.arguments = ""
    tc.id = "call_1"
    tc.index = 0
    tc.type = "function"
    delta1 = MagicMock()
    delta1.content = None
    delta1.tool_calls = [tc]
    delta1.reasoning_content = None
    choice1 = MagicMock()
    choice1.delta = delta1
    choice1.finish_reason = None
    tool_call_chunk.choices = [choice1]

    done_chunk_tool = _make_done_chunk("tool_calls")

    # Second call: LLM returns text
    text_chunk = _make_text_chunk("Here's what I found...")
    done_chunk_text = _make_done_chunk("stop")

    call_count = 0

    async def mock_acompletion(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First call returns tool use
            async def gen():
                yield tool_call_chunk
                yield done_chunk_tool
            return gen()
        else:
            # Second call returns text
            async def gen():
                yield text_chunk
                yield done_chunk_text
            return gen()

    # Mock stream_chunk_builder for both calls
    build_count = 0

    def mock_builder(chunks, **kwargs):
        nonlocal build_count
        build_count += 1
        mock_msg = MagicMock()
        if build_count == 1:
            # First build: has tool_calls
            tc_obj = MagicMock()
            tc_obj.function.name = "search_alignment_research"
            tc_obj.function.arguments = '{"query": "mesa optimization"}'
            tc_obj.id = "call_1"
            mock_msg.tool_calls = [tc_obj]
            mock_msg.content = None
        else:
            # Second build: just text
            mock_msg.tool_calls = None
            mock_msg.content = "Here's what I found..."
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock(message=mock_msg)]
        return mock_resp

    mock_mcp = AsyncMock()

    with patch("core.modules.chat.acompletion", side_effect=mock_acompletion):
        with patch("core.modules.chat.stream_chunk_builder", side_effect=mock_builder):
            with patch(
                "core.modules.chat.execute_tool",
                return_value="Relevant research about mesa optimization...",
            ):
                events = []
                async for event in send_module_message(
                    messages=[{"role": "user", "content": "What is mesa optimization?"}],
                    current_stage=stage,
                    mcp_manager=mock_mcp,
                ):
                    events.append(event)

                # Should have tool_use event, then text from second call
                tool_events = [e for e in events if e.get("type") == "tool_use"]
                assert len(tool_events) >= 1
                assert tool_events[0]["name"] == "search_alignment_research"

                # LLM was called twice
                assert call_count == 2


@pytest.mark.asyncio
async def test_max_rounds_stops_loop():
    """Should stop after MAX_TOOL_ROUNDS even if LLM keeps calling tools."""
    from core.modules.chat import send_module_message, MAX_TOOL_ROUNDS
    from core.modules.types import ChatStage

    stage = ChatStage(type="chat", instructions="Help the user.")

    call_count = 0

    # Every call returns a tool call
    async def mock_acompletion(**kwargs):
        nonlocal call_count
        call_count += 1

        tc = MagicMock()
        tc.function = MagicMock()
        tc.function.name = "search_alignment_research"
        tc.function.arguments = ""
        tc.id = f"call_{call_count}"
        tc.index = 0
        tc.type = "function"
        delta = MagicMock()
        delta.content = None
        delta.tool_calls = [tc]
        delta.reasoning_content = None
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = None
        chunk = MagicMock()
        chunk.choices = [choice]

        done = _make_done_chunk("tool_calls")

        async def gen():
            yield chunk
            yield done
        return gen()

    def mock_builder(chunks, **kwargs):
        tc_obj = MagicMock()
        tc_obj.function.name = "search_alignment_research"
        tc_obj.function.arguments = '{"query": "test"}'
        tc_obj.id = f"call_{call_count}"
        mock_msg = MagicMock()
        mock_msg.tool_calls = [tc_obj]
        mock_msg.content = None
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock(message=mock_msg)]
        return mock_resp

    mock_mcp = AsyncMock()

    with patch("core.modules.chat.acompletion", side_effect=mock_acompletion):
        with patch("core.modules.chat.stream_chunk_builder", side_effect=mock_builder):
            with patch(
                "core.modules.chat.execute_tool",
                return_value="Some result",
            ):
                events = []
                async for event in send_module_message(
                    messages=[{"role": "user", "content": "test"}],
                    current_stage=stage,
                    mcp_manager=mock_mcp,
                ):
                    events.append(event)

                # Exactly MAX_TOOL_ROUNDS + 1: 3 tool rounds + 1 forced-text round
                assert call_count == MAX_TOOL_ROUNDS + 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_tool_loop.py -v`
Expected: FAIL — `ImportError` (MAX_TOOL_ROUNDS, execute_tool not importable, send_module_message signature changed)

- [ ] **Step 3: Refactor `llm.py` — extract chunk event normalization**

The tool loop in `chat.py` needs to both yield frontend events AND collect raw chunks. Extract the chunk→event logic into a helper so chat.py can use it while collecting chunks.

Modify `core/modules/llm.py`:

```python
"""
LLM provider abstraction using LiteLLM.

Provides a unified interface for Claude, Gemini, and other providers.
Normalizes streaming events to our internal format.
"""

import os
from typing import AsyncIterator

from litellm import acompletion, stream_chunk_builder


# Default provider - can be overridden per-call or via environment
DEFAULT_PROVIDER = os.environ.get("LLM_PROVIDER", "anthropic/claude-sonnet-4-6")


def iter_chunk_events(chunk) -> list[dict]:
    """Extract normalized events from a single streaming chunk.

    Returns a list of event dicts (may be empty for non-content chunks).
    Used by the tool loop in chat.py to yield events while collecting chunks.
    """
    events = []
    delta = chunk.choices[0].delta if chunk.choices else None
    if not delta:
        return events

    # Handle thinking/reasoning content
    reasoning = getattr(delta, "reasoning_content", None)
    if reasoning:
        events.append({"type": "thinking", "content": reasoning})

    # Handle text content
    if delta.content:
        events.append({"type": "text", "content": delta.content})

    # Note: tool_call chunks are NOT emitted as events here.
    # The tool loop in chat.py emits tool_use events after reconstruction
    # to avoid duplicates.

    return events


async def stream_chat(
    messages: list[dict],
    system: str,
    tools: list[dict] | None = None,
    provider: str | None = None,
    max_tokens: int = 16384,
    thinking: bool = True,
    effort: str = "low",
) -> AsyncIterator[dict]:
    """
    Stream a chat completion from any LLM provider.

    This is the simple single-pass interface used when no tool loop is needed.
    For tool-calling flows, chat.py calls acompletion directly.

    Yields:
        Normalized events:
        - {"type": "thinking", "content": str}
        - {"type": "text", "content": str}
        - {"type": "tool_use", "name": str}
        - {"type": "done"}
    """
    model = provider or DEFAULT_PROVIDER
    llm_messages = [{"role": "system", "content": system}] + messages

    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if thinking:
        kwargs["thinking"] = {"type": "adaptive"}
        kwargs["output_config"] = {"effort": effort}
    if tools:
        kwargs["tools"] = tools

    response = await acompletion(**kwargs)

    async for chunk in response:
        for event in iter_chunk_events(chunk):
            yield event

    yield {"type": "done"}


async def complete(
    messages: list[dict],
    system: str,
    response_format: dict | None = None,
    provider: str | None = None,
    max_tokens: int = 1024,
) -> str:
    """
    Non-streaming completion for structured responses (e.g., scoring).
    """
    model = provider or DEFAULT_PROVIDER
    llm_messages = [{"role": "system", "content": system}] + messages

    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": max_tokens,
    }
    if response_format:
        kwargs["response_format"] = response_format

    response = await acompletion(**kwargs)
    return response.choices[0].message.content
```

- [ ] **Step 4: Refactor `chat.py` — tool execution loop**

Replace the entire `send_module_message` function and remove `TRANSITION_TOOL`:

```python
# core/modules/chat.py
"""
Module chat - LLM integration with stage-aware prompting and tool execution.
"""

import json
import logging
import os
from typing import AsyncIterator

from litellm import acompletion, stream_chunk_builder

from .llm import iter_chunk_events, DEFAULT_PROVIDER
from .context import SectionContext
from .prompts import assemble_chat_prompt, DEFAULT_BASE_PROMPT, TOOL_USAGE_GUIDANCE
from .types import Stage, ArticleStage, VideoStage, ChatStage
from .content import (
    load_article_with_metadata,
    load_video_transcript_with_metadata,
    ArticleContent,
    ArticleMetadata,
)
from ..transcripts.tools import get_text_at_time

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 3


def _build_system_prompt(
    current_stage: Stage,
    current_content: str | None,
    section_context: SectionContext | None,
    course_overview: str | None = None,
) -> str:
    """Build the system prompt based on current stage and context."""

    base = DEFAULT_BASE_PROMPT

    if course_overview:
        base += f"\n\n{course_overview}"

    if isinstance(current_stage, ChatStage):
        context = (
            section_context
            if not current_stage.hide_previous_content_from_tutor
            else None
        )
        prompt = assemble_chat_prompt(base, current_stage.instructions, context)

    elif isinstance(current_stage, (ArticleStage, VideoStage)):
        content_type = (
            "reading an article"
            if isinstance(current_stage, ArticleStage)
            else "watching a video"
        )
        prompt = (
            base
            + f"""
The user is currently {content_type}. Answer the student's questions to help them understand the content, but don't lengthen the conversation. There will be more time for chatting after they are done reading/watching.
"""
        )
        if current_content:
            prompt += f"\n\nContent the user is viewing:\n---\n{current_content}\n---"

    else:
        prompt = base

    return prompt


# NOTE TO IMPLEMENTER: The existing get_stage_content function must be preserved
# unchanged in chat.py — it is exported from core/modules/__init__.py.
# Do not include these instruction comments in the actual source file.


async def send_module_message(
    messages: list[dict],
    current_stage: Stage,
    current_content: str | None = None,
    section_context: SectionContext | None = None,
    provider: str | None = None,
    mcp_manager=None,
    course_overview: str | None = None,
) -> AsyncIterator[dict]:
    """
    Send messages to an LLM and stream the response.
    Handles tool calling with a multi-round loop.

    Args:
        messages: List of {"role": "user"|"assistant"|"system", "content": str}
        current_stage: The current module stage
        current_content: Content of current stage (for article/video stages)
        section_context: Previous/current content from the section
        provider: LLM provider string
        mcp_manager: MCPClientManager instance (or None to disable tools)
        course_overview: Pre-built course overview string for system prompt

    Yields:
        Dicts with either:
        - {"type": "thinking", "content": str} for reasoning chunks
        - {"type": "text", "content": str} for text chunks
        - {"type": "tool_use", "name": str} for tool calls
        - {"type": "done"} when complete
    """
    system = _build_system_prompt(
        current_stage, current_content, section_context, course_overview
    )

    # Debug mode: show system prompt
    if os.environ.get("DEBUG") == "1":
        debug_text = f"**[DEBUG - System Prompt]**\n\n```\n{system}\n```\n\n**[DEBUG - Messages]**\n\n```\n{messages}\n```\n\n---\n\n"
        yield {"type": "text", "content": debug_text}

    # Filter out system messages (stage transition markers)
    api_messages = [m for m in messages if m["role"] != "system"]

    # Get available tools
    tools = None
    if mcp_manager:
        from .tools import get_tools, execute_tool

        tools = await get_tools(mcp_manager)

    # Append tool guidance to system prompt when tools are available
    if tools:
        system += TOOL_USAGE_GUIDANCE

    model = provider or DEFAULT_PROVIDER

    # Tool execution loop
    for round_num in range(MAX_TOOL_ROUNDS + 1):
        llm_messages = [{"role": "system", "content": system}] + api_messages

        kwargs = {
            "model": model,
            "messages": llm_messages,
            "max_tokens": 16384,
            "stream": True,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "low"},
        }
        if tools:
            kwargs["tools"] = tools
            # On final round, force text response
            if round_num == MAX_TOOL_ROUNDS:
                kwargs["tool_choice"] = "none"

        response = await acompletion(**kwargs)

        # Stream chunks to frontend while collecting for reconstruction
        chunks = []
        async for chunk in response:
            chunks.append(chunk)
            for event in iter_chunk_events(chunk):
                yield event

        # Reconstruct the full message
        built = stream_chunk_builder(chunks, messages=llm_messages)
        assistant_message = built.choices[0].message

        # If no tool calls, we're done
        if not assistant_message.tool_calls:
            break

        # Execute tool calls
        api_messages.append(assistant_message.model_dump(exclude_none=True))

        for tc in assistant_message.tool_calls:
            yield {"type": "tool_use", "name": tc.function.name}

            result = await execute_tool(mcp_manager, tc)

            api_messages.append({
                "tool_call_id": tc.id,
                "role": "tool",
                "name": tc.function.name,
                "content": result,
            })

    yield {"type": "done"}
```

- [ ] **Step 5: Update existing `test_llm.py`**

`stream_chat` no longer emits `tool_use` events (those are handled by the tool loop in `chat.py`). **Remove or update `test_stream_chat_yields_tool_calls`** — it will fail since `iter_chunk_events` no longer emits tool events. Add a replacement test for `iter_chunk_events`:

```python
# Add to core/modules/tests/test_llm.py

def test_iter_chunk_events_extracts_text():
    """iter_chunk_events should extract text from a chunk."""
    from core.modules.llm import iter_chunk_events
    from unittest.mock import MagicMock

    delta = MagicMock()
    delta.content = "Hello"
    delta.tool_calls = None
    delta.reasoning_content = None
    choice = MagicMock()
    choice.delta = delta
    chunk = MagicMock()
    chunk.choices = [choice]

    events = iter_chunk_events(chunk)
    assert events == [{"type": "text", "content": "Hello"}]
```

- [ ] **Step 6: Run all tests**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_tool_loop.py core/modules/tests/test_llm.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```
jj describe -m "feat: add tool execution loop to chat with streaming + chunk reconstruction"
jj new
```

---

### Task 4: Course Overview in System Prompt

Build a course overview string from cached content and inject it into the system prompt.

**Files:**
- Modify: `core/modules/prompts.py`
- Modify: `web_api/routes/module.py` (pass course overview to `send_module_message`)
- Test: `core/modules/tests/test_course_overview.py`

- [ ] **Step 1: Write failing tests for course overview builder**

```python
# core/modules/tests/test_course_overview.py
"""Tests for course overview prompt builder."""

import pytest
from unittest.mock import patch, MagicMock
from core.modules.flattened_types import ParsedCourse, ModuleRef, MeetingMarker, FlattenedModule


def _make_module(slug, title, sections):
    """Create a FlattenedModule with given sections."""
    return FlattenedModule(
        slug=slug,
        title=title,
        content_id=None,
        sections=sections,
    )


class TestBuildCourseOverview:
    def test_includes_course_title(self):
        from core.modules.prompts import build_course_overview

        course = ParsedCourse(
            slug="ai-safety-101",
            title="AI Safety Fundamentals",
            progression=[ModuleRef(slug="intro")],
        )
        module = _make_module("intro", "Introduction", [
            {"meta": {"title": "What is AI Safety?"}, "tldr": "A brief overview of the field."},
        ])

        with patch("core.modules.loader.load_flattened_module", return_value=module):
            result = build_course_overview(course, "intro", 0, set())
            assert "AI Safety Fundamentals" in result

    def test_includes_section_tldrs(self):
        from core.modules.prompts import build_course_overview

        course = ParsedCourse(
            slug="course",
            title="Course",
            progression=[ModuleRef(slug="mod1")],
        )
        module = _make_module("mod1", "Module 1", [
            {"meta": {"title": "Section A"}, "tldr": "About alignment basics."},
            {"meta": {"title": "Section B"}, "tldr": "About mesa optimization."},
        ])

        with patch("core.modules.loader.load_flattened_module", return_value=module):
            result = build_course_overview(course, "mod1", 0, set())
            assert "alignment basics" in result
            assert "mesa optimization" in result

    def test_marks_current_position(self):
        from core.modules.prompts import build_course_overview

        course = ParsedCourse(
            slug="course",
            title="Course",
            progression=[ModuleRef(slug="mod1"), ModuleRef(slug="mod2")],
        )
        mod1 = _make_module("mod1", "Module 1", [
            {"meta": {"title": "S1"}, "tldr": "T1"},
        ])
        mod2 = _make_module("mod2", "Module 2", [
            {"meta": {"title": "S2"}, "tldr": "T2"},
        ])

        def load_module(slug):
            return {"mod1": mod1, "mod2": mod2}[slug]

        with patch("core.modules.loader.load_flattened_module", side_effect=load_module):
            result = build_course_overview(course, "mod2", 0, set())
            # Current module should be marked
            assert "CURRENT" in result or "←" in result or "current" in result

    def test_marks_completed_sections(self):
        from core.modules.prompts import build_course_overview
        from uuid import uuid4

        content_id = str(uuid4())
        course = ParsedCourse(
            slug="course",
            title="Course",
            progression=[ModuleRef(slug="mod1")],
        )
        module = _make_module("mod1", "Module 1", [
            {"meta": {"title": "S1"}, "tldr": "T1", "contentId": content_id},
        ])

        with patch("core.modules.loader.load_flattened_module", return_value=module):
            result = build_course_overview(course, "mod1", 0, {content_id})
            assert "✓" in result or "done" in result.lower() or "completed" in result.lower()

    def test_includes_meeting_markers(self):
        from core.modules.prompts import build_course_overview

        course = ParsedCourse(
            slug="course",
            title="Course",
            progression=[
                ModuleRef(slug="mod1"),
                MeetingMarker(name="Unit 1 Discussion"),
                ModuleRef(slug="mod2"),
            ],
        )
        mod1 = _make_module("mod1", "Module 1", [{"meta": {"title": "S1"}, "tldr": "T1"}])
        mod2 = _make_module("mod2", "Module 2", [{"meta": {"title": "S2"}, "tldr": "T2"}])

        def load_module(slug):
            return {"mod1": mod1, "mod2": mod2}[slug]

        with patch("core.modules.loader.load_flattened_module", side_effect=load_module):
            result = build_course_overview(course, "mod1", 0, set())
            assert "Unit 1 Discussion" in result

    def test_handles_missing_module_gracefully(self):
        from core.modules.prompts import build_course_overview
        from core.modules import ModuleNotFoundError

        course = ParsedCourse(
            slug="course",
            title="Course",
            progression=[ModuleRef(slug="missing"), ModuleRef(slug="exists")],
        )
        module = _make_module("exists", "Exists", [{"meta": {"title": "S1"}, "tldr": "T1"}])

        def load_module(slug):
            if slug == "missing":
                raise ModuleNotFoundError(slug)
            return module

        with patch("core.modules.loader.load_flattened_module", side_effect=load_module):
            # Should not crash
            result = build_course_overview(course, "exists", 0, set())
            assert "Exists" in result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_course_overview.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_course_overview'`

- [ ] **Step 3: Implement `build_course_overview` in prompts.py**

Add to `core/modules/prompts.py`:

```python
# Add imports at top
from .flattened_types import ParsedCourse, ModuleRef, MeetingMarker

def build_course_overview(
    course: ParsedCourse,
    current_module_slug: str,
    current_section_index: int,
    completed_content_ids: set[str],
) -> str:
    """Build a structured course overview for the system prompt.

    Args:
        course: The parsed course definition
        current_module_slug: Slug of the module the student is currently in
        current_section_index: Index of the current section within the module
        completed_content_ids: Set of content IDs the student has completed

    Returns:
        Formatted overview string for injection into system prompt
    """
    from .loader import load_flattened_module
    from . import ModuleNotFoundError

    lines = [f"Course Overview: {course.title}", ""]

    for item in course.progression:
        if isinstance(item, MeetingMarker):
            lines.append(f"--- {item.name} ---")
            lines.append("")
            continue

        if not isinstance(item, ModuleRef):
            continue

        is_current_module = item.slug == current_module_slug

        try:
            module = load_flattened_module(item.slug)
        except (ModuleNotFoundError, Exception):
            lines.append(f"  {'→' if is_current_module else '•'} {item.slug} (unavailable)")
            continue

        marker = "→ CURRENT:" if is_current_module else "•"
        optional = " (optional)" if item.optional else ""
        lines.append(f"  {marker} {module.title}{optional}")

        for i, section in enumerate(module.sections):
            title = section.get("meta", {}).get("title", "Untitled")
            tldr = section.get("tldr", "")
            content_id = section.get("contentId")

            # Status marker
            if is_current_module and i == current_section_index:
                status = "← you are here"
            elif content_id and str(content_id) in completed_content_ids:
                status = "✓"
            else:
                status = ""

            line = f"    - {title}"
            if status:
                line += f" [{status}]"
            if tldr:
                line += f" — {tldr}"
            lines.append(line)

        lines.append("")

    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_course_overview.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```
jj describe -m "feat: add course overview builder for tutor system prompt"
jj new
```

---

### Task 5: Wire Everything Together

Connect the MCP client initialization in `main.py` and pass course overview + MCP manager through the API route.

**Files:**
- Modify: `main.py` (lifespan: init MCP, store on app.state)
- Modify: `web_api/routes/module.py` (pass mcp_manager + course_overview to send_module_message)
- Modify: `core/modules/prompts.py` (add tool usage guidance to base prompt)

- [ ] **Step 1: Add tool usage guidance to base prompt**

In `core/modules/prompts.py`, modify `DEFAULT_BASE_PROMPT`:

```python
DEFAULT_BASE_PROMPT = (
    "You are a tutor helping someone learn about AI safety. "
    "Each piece of content (article, video) has different topics "
    "and learning objectives."
)

TOOL_USAGE_GUIDANCE = """
You have access to tools for looking up information. Use them when:
- The student asks about alignment research topics beyond the current material
- You need to verify or expand on a specific claim
- The student asks about something not covered in the course

When you use a tool, briefly mention what you're looking up. Cite sources when providing information from tools."""
```

- [ ] **Step 2: Initialize MCP client in `main.py` lifespan**

Add to `main.py` after the content cache initialization (around line 221), before the database check:

```python
# Initialize MCP client for alignment research search
from core.modules.tools.mcp_client import MCPClientManager

stampy_url = os.getenv("STAMPY_MCP_URL", "").strip() or None
mcp_manager = MCPClientManager(url=stampy_url)
app.state.mcp_manager = mcp_manager
if stampy_url:
    print(f"MCP client configured for {stampy_url} (connects lazily)")
else:
    print("Note: STAMPY_MCP_URL not set, alignment search tool disabled")
```

Add to shutdown (after `await close_engine()`):
```python
# Close MCP client
if hasattr(app.state, "mcp_manager"):
    await app.state.mcp_manager.close()
```

- [ ] **Step 3: Pass MCP manager and course overview in `web_api/routes/module.py`**

In `event_generator()`, before the `async for chunk in send_module_message(...)` call:

```python
# Build course overview for system prompt
from core.modules.prompts import build_course_overview, TOOL_USAGE_GUIDANCE
from core.modules.course_loader import load_course

course_overview = None
try:
    # Load first available course (single-course platform)
    from core.content import get_cache
    cache = get_cache()
    if cache.courses:
        course_slug = next(iter(cache.courses))
        course = load_course(course_slug)

        # Get user's completed content IDs
        completed_ids = set()
        if user_id:
            from core.modules.progress import get_completed_content_ids
            async with get_connection() as conn:
                completed_ids = await get_completed_content_ids(conn, user_id)

        course_overview = build_course_overview(
            course, module.slug, section_index, completed_ids
        )
except Exception as e:
    logger.warning("Failed to build course overview: %s", e)

# Get MCP manager from app state
from fastapi import Request
# mcp_manager is accessed via the module-level reference set during lifespan
```

Update the `send_module_message` call to pass the new args:

```python
async for chunk in send_module_message(
    llm_messages, stage, None, section_context,
    mcp_manager=getattr(app.state, "mcp_manager", None),
    course_overview=course_overview,
):
```

**IMPORTANT — threading `app` through:** The route handler `chat_module` must inject `Request` and pass `request.app` to `event_generator`. Add `request: Request` param to `chat_module`, then pass `app=request.app` to `event_generator`. Inside `event_generator`, use `app.state.mcp_manager`. Example:

```python
# In chat_module():
async def chat_module(
    request: Request,  # ADD THIS
    req: ModuleChatRequest,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
) -> StreamingResponse:
    ...
    return StreamingResponse(
        event_generator(..., app=request.app),  # PASS APP
        ...
    )

# In event_generator(), add app param:
async def event_generator(..., app):
    mcp_manager = getattr(app.state, "mcp_manager", None)
    ...
```

- [ ] **Step 4: Add `STAMPY_MCP_URL` to `.env.example`**

```
# Alignment research search (Stampy MCP)
STAMPY_MCP_URL=https://chat.aisafety.info/mcp
```

- [ ] **Step 5: Run full test suite**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/ -v`
Expected: All PASS

- [ ] **Step 6: Manual smoke test**

1. Add `STAMPY_MCP_URL=https://chat.aisafety.info/mcp` to `.env.local`
2. Start the backend: `cd /home/penguin/code/lens-platform/ws4 && python main.py --dev`
3. Verify startup log shows "MCP client configured for https://chat.aisafety.info/mcp"
4. Open a module chat and ask "What is mesa optimization?"
5. Verify the tutor calls the search tool and responds with alignment research content
6. Use `DEBUG=1` to verify the course overview appears in the system prompt

- [ ] **Step 7: Commit**

```
jj describe -m "feat: wire MCP client + course overview into chat pipeline"
jj new
```

---

### Task 6: Add `get_completed_content_ids` Helper

**Implement this before Task 5's Step 3** (which imports it). The course overview needs a set of completed content IDs.

`core/modules/progress.py` already has `get_module_progress(conn, user_id, anonymous_token, lens_ids)` which returns `dict[UUID, dict]` where each dict has `completed_at`. We need a simpler wrapper that queries ALL completed content IDs for a user (not filtered by module).

**Files:**
- Modify: `core/modules/progress.py`
- Test: `core/modules/tests/test_progress.py` (add test)

- [ ] **Step 1: Write failing test**

```python
# Add to core/modules/tests/test_progress.py

@pytest.mark.asyncio
async def test_get_completed_content_ids(db_conn):
    """Should return set of content IDs with completed_at set."""
    from core.modules.progress import get_completed_content_ids
    # This test uses a real test DB connection (unit+1 style)
    # If no test DB fixture exists, mock the query instead
    result = await get_completed_content_ids(db_conn, user_id=99999)
    assert isinstance(result, set)
```

- [ ] **Step 2: Implement the helper**

Add to `core/modules/progress.py`:

```python
async def get_completed_content_ids(
    conn: AsyncConnection,
    user_id: int,
) -> set[str]:
    """Get all content IDs the user has completed (across all modules).

    Returns set of stringified UUIDs for easy comparison with section contentId fields.
    """
    result = await conn.execute(
        select(user_content_progress.c.content_id).where(
            and_(
                user_content_progress.c.user_id == user_id,
                user_content_progress.c.completed_at.isnot(None),
            )
        )
    )
    return {str(row.content_id) for row in result.fetchall()}
```

- [ ] **Step 3: Run tests**

Run: `cd /home/penguin/code/lens-platform/ws4 && .venv/bin/pytest core/modules/tests/test_progress.py -v`

- [ ] **Step 4: Commit**

```
jj describe -m "feat: add get_completed_content_ids helper for course overview"
jj new
```
