"""Tests for dispatcher tool execution (Phase 2 additions)."""

import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from dataclasses import replace
from core.agents.identity import PlatformIdentity
from core.agents.dispatcher import handle_message, MAX_TOOL_ROUNDS


def _mock_llm_response(content="Hello!", tool_calls=None):
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def _make_tc(name, arguments, tc_id="call_1"):
    tc = MagicMock()
    tc.id = tc_id
    tc.function.name = name
    tc.function.arguments = json.dumps(arguments)
    return tc


def _fresh_session(user_id=42):
    return {"session_id": 999, "user_id": user_id, "messages": []}


@pytest.fixture
def mock_sessions():
    session = _fresh_session()

    async def fake_load(user_id):
        return session

    async def fake_save(s):
        pass

    with (
        patch("core.agents.dispatcher.load_or_create_open_ended_session", side_effect=fake_load),
        patch("core.agents.dispatcher.save_session", side_effect=fake_save),
        patch("core.agents.dispatcher.resolve_user_id", return_value=42),
        patch("core.agents.dispatcher.build_context_block", new_callable=AsyncMock, return_value="Progress: 5/10"),
        patch("core.agents.dispatcher.load_user_files", new_callable=AsyncMock, return_value={
            "agent_style.md": "", "user.md": "", "memory.md": "",
        }),
        patch("core.agents.dispatcher._get_user_timezone", new_callable=AsyncMock, return_value=None),
    ):
        yield session


@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_regular_tool_call_executes_and_loops(mock_llm, mock_sessions):
    """LLM calls a tool -> tool executes -> LLM sees result -> responds with text."""
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    tc = _make_tc("get_my_progress", {})
    llm_call1 = _mock_llm_response(content=None, tool_calls=[tc])
    llm_call2 = _mock_llm_response("You're 40% done — great progress!")
    mock_llm.side_effect = [llm_call1, llm_call2]

    from core.agents.registry import AGENT_REGISTRY
    original_coach = AGENT_REGISTRY["coach"]
    mock_executor = AsyncMock(return_value="Course: AI Safety\nOverall: 12/30 lenses (40%)")
    patched_coach = replace(original_coach, tool_executor=mock_executor)
    AGENT_REGISTRY["coach"] = patched_coach
    try:
        result = await handle_message(identity, "How am I doing?")
    finally:
        AGENT_REGISTRY["coach"] = original_coach

    assert result.kind == "ok"
    assert "40%" in result.reply_text or "progress" in result.reply_text.lower()
    assert mock_llm.call_count == 2
    mock_executor.assert_called_once()


@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_max_tool_rounds_forces_text(mock_llm, mock_sessions):
    """After MAX_TOOL_ROUNDS, tool_choice='none' forces text."""
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    tool_responses = []
    for i in range(MAX_TOOL_ROUNDS):
        tc = _make_tc("list_my_reminders", {}, tc_id=f"call_{i}")
        tool_responses.append(_mock_llm_response(content=None, tool_calls=[tc]))
    tool_responses.append(_mock_llm_response("Here's what I found."))
    mock_llm.side_effect = tool_responses

    from core.agents.registry import AGENT_REGISTRY
    original_coach = AGENT_REGISTRY["coach"]
    mock_executor = AsyncMock(return_value="No pending reminders.")
    patched_coach = replace(original_coach, tool_executor=mock_executor)
    AGENT_REGISTRY["coach"] = patched_coach
    try:
        result = await handle_message(identity, "What reminders do I have?")
    finally:
        AGENT_REGISTRY["coach"] = original_coach

    assert result.kind == "ok"
    # Verify last LLM call used tool_choice="none"
    last_call = mock_llm.call_args_list[-1]
    assert last_call.kwargs.get("tool_choice") == "none"


@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_messages_get_timestamps(mock_llm, mock_sessions):
    """User and assistant messages get ts fields."""
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")
    mock_llm.return_value = _mock_llm_response("Hi!")
    await handle_message(identity, "Hello")

    session = mock_sessions
    user_msg = next(m for m in session["messages"] if m["role"] == "user")
    assistant_msg = next(m for m in session["messages"] if m["role"] == "assistant")
    assert "ts" in user_msg
    assert "ts" in assistant_msg


@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_injected_context_removed_before_save(mock_llm, mock_sessions):
    """_injected context messages are removed before saving."""
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")
    mock_llm.return_value = _mock_llm_response("Hi!")
    await handle_message(identity, "Hello")

    session = mock_sessions
    injected = [m for m in session["messages"] if m.get("_injected")]
    assert len(injected) == 0  # All injected messages removed before save
