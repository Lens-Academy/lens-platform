"""Tests for the tool execution loop in chat.py."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_text_chunk(text):
    """Create a mock streaming chunk with text content."""
    delta = MagicMock()
    delta.content = text
    delta.tool_calls = None
    # reasoning_content should return None
    type(delta).reasoning_content = property(lambda self: None)

    choice = MagicMock()
    choice.delta = delta

    chunk = MagicMock()
    chunk.choices = [choice]
    return chunk


def _make_tool_chunk(tool_name=None, tool_id=None, arguments_fragment=""):
    """Create a mock streaming chunk with a tool call."""
    tool_call = MagicMock()
    tool_call.function = MagicMock()
    tool_call.function.name = tool_name
    tool_call.function.arguments = arguments_fragment
    tool_call.id = tool_id

    delta = MagicMock()
    delta.content = None
    delta.tool_calls = [tool_call]
    type(delta).reasoning_content = property(lambda self: None)

    choice = MagicMock()
    choice.delta = delta

    chunk = MagicMock()
    chunk.choices = [choice]
    return chunk


def _make_built_message(content=None, tool_calls=None):
    """Create a mock reconstructed message from stream_chunk_builder."""
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls
    message.model_dump = MagicMock(
        return_value={
            "role": "assistant",
            "content": content,
            "tool_calls": (
                [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ]
                if tool_calls
                else None
            ),
        }
    )

    built = MagicMock()
    built.choices = [MagicMock()]
    built.choices[0].message = message
    return built


def _make_tool_call_obj(name, arguments="{}", tc_id="call_123"):
    """Create a mock tool call object as returned by stream_chunk_builder."""
    tc = MagicMock()
    tc.function = MagicMock()
    tc.function.name = name
    tc.function.arguments = arguments
    tc.id = tc_id
    return tc


@pytest.mark.asyncio
async def test_no_tools_streams_normally():
    """When mcp_manager=None, text streams through and done event emitted."""
    from core.modules.chat import send_module_message
    from core.modules.types import ChatStage

    stage = ChatStage(type="chat", instructions="Test instructions")

    text_chunk = _make_text_chunk("Hello there!")
    built = _make_built_message(content="Hello there!", tool_calls=None)

    async def mock_stream():
        yield text_chunk

    with (
        patch("core.modules.chat.acompletion", return_value=mock_stream()) as mock_ac,
        patch("core.modules.chat.stream_chunk_builder", return_value=built),
    ):
        events = []
        async for event in send_module_message(
            messages=[{"role": "user", "content": "Hi"}],
            current_stage=stage,
            mcp_manager=None,
        ):
            events.append(event)

    # Should have text and done events
    assert {"type": "text", "content": "Hello there!"} in events
    assert events[-1] == {"type": "done"}
    # acompletion called once (no tool loop)
    mock_ac.assert_called_once()


@pytest.mark.asyncio
async def test_tool_call_executes_and_continues():
    """LLM returns tool_call on first stream, tool executed, LLM called again with result."""
    from core.modules.chat import send_module_message
    from core.modules.types import ChatStage

    stage = ChatStage(type="chat", instructions="Test instructions")

    # First call: LLM returns a tool call
    tool_chunk = _make_tool_chunk(
        tool_name="search_alignment_research",
        tool_id="call_abc",
        arguments_fragment='{"query": "test"}',
    )
    tc_obj = _make_tool_call_obj(
        "search_alignment_research", '{"query": "test"}', "call_abc"
    )
    built_with_tool = _make_built_message(content=None, tool_calls=[tc_obj])

    # Second call: LLM returns text
    text_chunk = _make_text_chunk("Here is what I found.")
    built_with_text = _make_built_message(
        content="Here is what I found.", tool_calls=None
    )

    call_count = 0

    async def mock_acompletion(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:

            async def gen():
                yield tool_chunk

            return gen()
        else:

            async def gen():
                yield text_chunk

            return gen()

    mock_mcp = MagicMock()
    mock_tools = [
        {"type": "function", "function": {"name": "search_alignment_research"}}
    ]

    builder_calls = [0]

    def mock_builder(chunks, messages=None):
        builder_calls[0] += 1
        if builder_calls[0] == 1:
            return built_with_tool
        return built_with_text

    with (
        patch("core.modules.chat.acompletion", side_effect=mock_acompletion),
        patch("core.modules.chat.stream_chunk_builder", side_effect=mock_builder),
        patch(
            "core.modules.chat.get_tools",
            new_callable=AsyncMock,
            return_value=mock_tools,
        ),
        patch(
            "core.modules.chat.execute_tool",
            new_callable=AsyncMock,
            return_value="Tool result: alignment research info",
        ) as mock_exec,
    ):
        events = []
        async for event in send_module_message(
            messages=[{"role": "user", "content": "Tell me about alignment"}],
            current_stage=stage,
            mcp_manager=mock_mcp,
        ):
            events.append(event)

    # Should have tool_use events (calling + result) and tool_save events
    tool_use_events = [e for e in events if e["type"] == "tool_use"]
    assert len(tool_use_events) == 2
    assert tool_use_events[0]["name"] == "search_alignment_research"
    assert tool_use_events[0]["state"] == "calling"
    assert tool_use_events[0]["arguments"] == {"query": "test"}
    assert tool_use_events[1]["name"] == "search_alignment_research"
    assert tool_use_events[1]["state"] == "result"

    # Should have tool_save events for DB persistence
    tool_save_events = [e for e in events if e["type"] == "tool_save"]
    assert len(tool_save_events) == 2
    # First: assistant message with tool_calls
    assert tool_save_events[0]["message"]["role"] == "assistant"
    assert "tool_calls" in tool_save_events[0]["message"]
    # Second: tool result message
    assert tool_save_events[1]["message"]["role"] == "tool"
    assert tool_save_events[1]["message"]["name"] == "search_alignment_research"

    text_events = [e for e in events if e["type"] == "text"]
    assert any("Here is what I found" in e["content"] for e in text_events)

    assert events[-1] == {"type": "done"}

    # execute_tool was called once
    mock_exec.assert_called_once()
    # acompletion called twice (first with tool call, second with result)
    assert call_count == 2


@pytest.mark.asyncio
async def test_max_rounds_stops_loop():
    """If LLM keeps calling tools, loop stops after MAX_TOOL_ROUNDS + 1 calls."""
    from core.modules.chat import send_module_message, MAX_TOOL_ROUNDS
    from core.modules.types import ChatStage

    stage = ChatStage(type="chat", instructions="Test")

    tc_obj = _make_tool_call_obj(
        "search_alignment_research", '{"query": "x"}', "call_1"
    )
    built_with_tool = _make_built_message(content=None, tool_calls=[tc_obj])

    # Final round: text (because tool_choice="none" forces text)
    text_chunk = _make_text_chunk("Final answer.")
    built_with_text = _make_built_message(content="Final answer.", tool_calls=None)

    call_count = 0

    async def mock_acompletion(**kwargs):
        nonlocal call_count
        call_count += 1
        tool_chunk = _make_tool_chunk(
            tool_name="search_alignment_research",
            tool_id="call_1",
            arguments_fragment='{"query": "x"}',
        )

        # On the last round (MAX_TOOL_ROUNDS + 1), tool_choice should be "none"
        if call_count == MAX_TOOL_ROUNDS + 1:
            assert kwargs.get("tool_choice") == "none", (
                f"Expected tool_choice='none' on final round {call_count}"
            )

            async def gen():
                yield text_chunk

            return gen()
        else:

            async def gen():
                yield tool_chunk

            return gen()

    builder_calls = [0]

    def mock_builder(chunks, messages=None):
        builder_calls[0] += 1
        if builder_calls[0] <= MAX_TOOL_ROUNDS:
            return built_with_tool
        return built_with_text

    mock_mcp = MagicMock()
    mock_tools = [
        {"type": "function", "function": {"name": "search_alignment_research"}}
    ]

    with (
        patch("core.modules.chat.acompletion", side_effect=mock_acompletion),
        patch("core.modules.chat.stream_chunk_builder", side_effect=mock_builder),
        patch(
            "core.modules.chat.get_tools",
            new_callable=AsyncMock,
            return_value=mock_tools,
        ),
        patch(
            "core.modules.chat.execute_tool",
            new_callable=AsyncMock,
            return_value="Tool result",
        ) as mock_exec,
    ):
        events = []
        async for event in send_module_message(
            messages=[{"role": "user", "content": "Research everything"}],
            current_stage=stage,
            mcp_manager=mock_mcp,
        ):
            events.append(event)

    # Total acompletion calls = MAX_TOOL_ROUNDS + 1
    assert call_count == MAX_TOOL_ROUNDS + 1
    # execute_tool called MAX_TOOL_ROUNDS times (not on the final text-only round)
    assert mock_exec.call_count == MAX_TOOL_ROUNDS
    # Final event is done
    assert events[-1] == {"type": "done"}
