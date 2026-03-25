"""Tests for LLM wrapper module."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_stream_chat_yields_text_chunks():
    """Should yield text chunks from streaming response."""
    from core.modules.llm import stream_chat

    # Create mock chunk with text content
    mock_delta = MagicMock()
    mock_delta.content = "Hello"
    mock_delta.tool_calls = None

    mock_choice = MagicMock()
    mock_choice.delta = mock_delta

    mock_chunk = MagicMock()
    mock_chunk.choices = [mock_choice]

    # Create async iterator from mock chunks
    async def mock_response():
        yield mock_chunk

    with patch("core.modules.llm.acompletion", return_value=mock_response()):
        events = []
        async for event in stream_chat(
            messages=[{"role": "user", "content": "Hi"}],
            system="You are helpful.",
            provider="anthropic/claude-sonnet-4-20250514",
        ):
            events.append(event)

        assert {"type": "text", "content": "Hello"} in events
        assert {"type": "done"} in events


@pytest.mark.asyncio
async def test_stream_chat_does_not_yield_tool_events():
    """stream_chat should NOT yield tool_use events (handled by chat.py tool loop)."""
    from core.modules.llm import stream_chat

    # Create mock chunk with tool call
    mock_tool_call = MagicMock()
    mock_tool_call.function = MagicMock()
    mock_tool_call.function.name = "search_alignment_research"

    mock_delta = MagicMock()
    mock_delta.content = None
    mock_delta.tool_calls = [mock_tool_call]

    mock_choice = MagicMock()
    mock_choice.delta = mock_delta

    mock_chunk = MagicMock()
    mock_chunk.choices = [mock_choice]

    async def mock_response():
        yield mock_chunk

    with patch("core.modules.llm.acompletion", return_value=mock_response()):
        events = []
        async for event in stream_chat(
            messages=[{"role": "user", "content": "search something"}],
            system="You are a tutor.",
            tools=[
                {"type": "function", "function": {"name": "search_alignment_research"}}
            ],
            provider="anthropic/claude-sonnet-4-20250514",
        ):
            events.append(event)

        # No tool_use events should be yielded
        tool_events = [e for e in events if e.get("type") == "tool_use"]
        assert tool_events == []
        # Should still get done event
        assert {"type": "done"} in events


@pytest.mark.asyncio
async def test_iter_chunk_events_extracts_text():
    """iter_chunk_events should extract text and thinking events from a chunk."""
    from core.modules.llm import iter_chunk_events

    # Text chunk
    mock_delta = MagicMock()
    mock_delta.content = "Hello world"
    mock_delta.tool_calls = None
    mock_delta.reasoning_content = None

    mock_choice = MagicMock()
    mock_choice.delta = mock_delta

    mock_chunk = MagicMock()
    mock_chunk.choices = [mock_choice]

    events = iter_chunk_events(mock_chunk)
    assert events == [{"type": "text", "content": "Hello world"}]


@pytest.mark.asyncio
async def test_iter_chunk_events_extracts_thinking():
    """iter_chunk_events should extract thinking events."""
    from core.modules.llm import iter_chunk_events

    mock_delta = MagicMock()
    mock_delta.content = None
    mock_delta.reasoning_content = "Let me think..."

    mock_choice = MagicMock()
    mock_choice.delta = mock_delta

    mock_chunk = MagicMock()
    mock_chunk.choices = [mock_choice]

    events = iter_chunk_events(mock_chunk)
    assert events == [{"type": "thinking", "content": "Let me think..."}]


@pytest.mark.asyncio
async def test_iter_chunk_events_ignores_tool_calls():
    """iter_chunk_events should NOT emit tool_use events."""
    from core.modules.llm import iter_chunk_events

    mock_tool_call = MagicMock()
    mock_tool_call.function = MagicMock()
    mock_tool_call.function.name = "some_tool"

    mock_delta = MagicMock()
    mock_delta.content = None
    mock_delta.reasoning_content = None
    mock_delta.tool_calls = [mock_tool_call]

    mock_choice = MagicMock()
    mock_choice.delta = mock_delta

    mock_chunk = MagicMock()
    mock_chunk.choices = [mock_choice]

    events = iter_chunk_events(mock_chunk)
    assert events == []  # No tool events


@pytest.mark.asyncio
async def test_stream_chat_uses_default_provider():
    """Should use DEFAULT_PROVIDER when no provider specified."""
    from core.modules.llm import stream_chat, DEFAULT_PROVIDER

    async def mock_response():
        # Empty response
        return
        yield  # Make it a generator

    with patch(
        "core.modules.llm.acompletion", new_callable=AsyncMock
    ) as mock_completion:
        # Make acompletion return an async generator
        async def empty_gen():
            return
            yield

        mock_completion.return_value = empty_gen()

        events = []
        async for event in stream_chat(
            messages=[{"role": "user", "content": "Hi"}],
            system="Test",
        ):
            events.append(event)

        # Verify acompletion was called with default provider
        mock_completion.assert_called_once()
        call_kwargs = mock_completion.call_args[1]
        assert call_kwargs["model"] == DEFAULT_PROVIDER


@pytest.mark.asyncio
async def test_stream_chat_passes_tools_to_provider():
    """Should pass tools to LiteLLM when provided."""
    from core.modules.llm import stream_chat

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get weather",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]

    with patch(
        "core.modules.llm.acompletion", new_callable=AsyncMock
    ) as mock_completion:

        async def empty_gen():
            return
            yield

        mock_completion.return_value = empty_gen()

        events = []
        async for event in stream_chat(
            messages=[{"role": "user", "content": "Weather?"}],
            system="Test",
            tools=tools,
            provider="gemini/gemini-1.5-pro",
        ):
            events.append(event)

        call_kwargs = mock_completion.call_args[1]
        assert call_kwargs["tools"] == tools
        assert call_kwargs["model"] == "gemini/gemini-1.5-pro"
