"""Tests for the multi-agent dispatcher."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from core.agents.identity import PlatformIdentity
from core.agents.dispatcher import handle_message


def _mock_llm_response(content="Hello!", tool_calls=None):
    """Build a mock LiteLLM response."""
    message = MagicMock()
    message.content = content
    message.tool_calls = tool_calls
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def _fresh_session(user_id: int = 1) -> dict:
    """Return a fresh in-memory session (no DB needed)."""
    return {"session_id": 999, "user_id": user_id, "messages": []}


@pytest.fixture
def discord_identity():
    return PlatformIdentity(type="discord", id=777777777777, platform_name="discord_dm")


# ---------------------------------------------------------------------------
# Tests that use real DB (resolve_user_id + session CRUD)
# Use unique IDs — each test creates its own user on first run, and the
# open-ended session state is consistent because we also mock the LLM.
# ---------------------------------------------------------------------------

# Test 1: Happy path — no handoff
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_happy_path_no_handoff(mock_llm, discord_identity):
    mock_llm.return_value = _mock_llm_response("Hi there! How's studying going?")
    result = await handle_message(discord_identity, "Hey")
    assert result.kind == "ok"
    assert len(result.reply_text) > 0
    mock_llm.assert_called_once()
    # Verify system prompt is present
    call_kwargs = mock_llm.call_args
    messages = call_kwargs.kwargs.get("messages") or call_kwargs[1].get("messages")
    assert messages[0]["role"] == "system"


# Test 3: Token cap
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
@patch("core.agents.dispatcher.estimate_input_tokens", return_value=46_000)
async def test_token_cap_returns_error(mock_estimate, mock_llm):
    identity = PlatformIdentity(type="discord", id=777777777779, platform_name="discord_dm")
    result = await handle_message(identity, "Long conversation")
    assert result.kind == "error"
    assert "too long" in result.reply_text.lower()
    mock_llm.assert_not_called()


# Test 5: LLM failure
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_llm_failure_returns_error(mock_llm):
    identity = PlatformIdentity(type="discord", id=777777777781, platform_name="discord_dm")
    mock_llm.side_effect = Exception("API error")
    result = await handle_message(identity, "Hello")
    assert result.kind == "error"
    assert "something went wrong" in result.reply_text.lower()


# Test 9: Reply text comes from last assistant content
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_reply_text_from_last_assistant(mock_llm):
    identity = PlatformIdentity(type="discord", id=777777777785, platform_name="discord_dm")
    expected_reply = "This is the final reply text."
    mock_llm.return_value = _mock_llm_response(expected_reply)

    result = await handle_message(identity, "Anything")
    assert result.kind == "ok"
    assert result.reply_text == expected_reply


# ---------------------------------------------------------------------------
# Tests that mock the session layer to get a fresh, predictable session.
# These test dispatcher logic independently of DB state.
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_sessions():
    """Mock load/save session to use an in-memory fresh session."""
    session = _fresh_session()

    async def fake_load(user_id):
        return session

    async def fake_save(s):
        pass

    with (
        patch("core.agents.dispatcher.load_or_create_open_ended_session", side_effect=fake_load),
        patch("core.agents.dispatcher.save_session", side_effect=fake_save),
        patch("core.agents.dispatcher.resolve_user_id", return_value=42),
        patch("core.agents.dispatcher.build_context_block", new_callable=AsyncMock, return_value=""),
        patch("core.agents.dispatcher.load_user_files", new_callable=AsyncMock, return_value={
            "agent_style.md": "", "user.md": "", "memory.md": "",
        }),
        patch("core.agents.dispatcher._get_user_timezone", new_callable=AsyncMock, return_value=None),
    ):
        yield session


# Test 2: Handoff — coach to tutor
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_handoff_coach_to_tutor(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    # Coach calls transfer_to_tutor
    coach_tc = MagicMock()
    coach_tc.id = "call_1"
    coach_tc.function.name = "transfer_to_tutor"
    coach_tc.function.arguments = '{"reason": "Technical question"}'
    coach_response = _mock_llm_response(content=None, tool_calls=[coach_tc])

    # Tutor responds with text (no further handoff)
    tutor_response = _mock_llm_response("The tutor isn't live yet, but corrigibility is about...")

    mock_llm.side_effect = [coach_response, tutor_response]
    result = await handle_message(identity, "What is corrigibility?")

    assert result.kind == "ok"
    assert mock_llm.call_count == 2


# Test 4: Invalid handoff target (typo in agent name)
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_invalid_handoff_target(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    bad_tc = MagicMock()
    bad_tc.id = "call_bad"
    bad_tc.function.name = "transfer_to_typo"
    bad_tc.function.arguments = '{"reason": "test"}'
    # invalid handoff → no handoff extracted → loop breaks
    # content is None → fallback text returned
    bad_response = _mock_llm_response(content="Let me help directly.", tool_calls=[bad_tc])
    mock_llm.return_value = bad_response

    result = await handle_message(identity, "Hello")
    assert result.kind == "ok"
    # 'transfer_to_typo' is not a real agent; dispatcher emits error tool-result and breaks loop
    mock_llm.assert_called_once()


# Test 6: Handoff with missing 'reason' parameter
# The dispatcher emits a synthetic tool-result error and breaks out of the loop.
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_handoff_missing_reason(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    bad_tc = MagicMock()
    bad_tc.id = "call_noreason"
    bad_tc.function.name = "transfer_to_tutor"
    bad_tc.function.arguments = '{"other_key": "value"}'
    bad_response = _mock_llm_response(content=None, tool_calls=[bad_tc])
    mock_llm.return_value = bad_response

    result = await handle_message(identity, "Help me")
    assert result.kind == "ok"
    # Invalid handoff → loop breaks after 1 LLM call, fallback reply used
    assert mock_llm.call_count == 1


# Test 7: Handoff with malformed JSON arguments
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_handoff_malformed_json(mock_llm, mock_sessions):
    identity = PlatformIdentity(type="discord", id=1, platform_name="discord_dm")

    bad_tc = MagicMock()
    bad_tc.id = "call_badjson"
    bad_tc.function.name = "transfer_to_tutor"
    bad_tc.function.arguments = 'not valid json {'
    bad_response = _mock_llm_response(content=None, tool_calls=[bad_tc])
    mock_llm.return_value = bad_response

    result = await handle_message(identity, "Question")
    assert result.kind == "ok"
    assert mock_llm.call_count == 1


# Test 8: Concurrent lock — two different users run concurrently without contention
@pytest.mark.asyncio
@patch("core.agents.dispatcher.acompletion", new_callable=AsyncMock)
async def test_concurrent_different_users(mock_llm):
    import asyncio
    identity_a = PlatformIdentity(type="discord", id=777777777784, platform_name="discord_dm")
    identity_b = PlatformIdentity(type="discord", id=777777777790, platform_name="discord_dm")

    call_count = 0

    async def slow_llm(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return _mock_llm_response(f"Response {call_count}")

    mock_llm.side_effect = slow_llm

    results = await asyncio.gather(
        handle_message(identity_a, "First user message"),
        handle_message(identity_b, "Second user message"),
    )

    assert all(r.kind == "ok" for r in results)
    assert mock_llm.call_count == 2
