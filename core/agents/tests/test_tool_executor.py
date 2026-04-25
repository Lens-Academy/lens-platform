"""Tests for the coach tool executor registry."""

import pytest
import json
from unittest.mock import patch, AsyncMock
from core.agents.tools import COACH_TOOL_SCHEMAS, coach_tool_executor


def test_all_schemas_present():
    """All 8 tool schemas are registered."""
    names = {s["function"]["name"] for s in COACH_TOOL_SCHEMAS}
    assert names == {
        "read_file", "edit_file", "append_memory",
        "get_my_progress", "get_my_upcoming_deadlines",
        "schedule_reminder", "list_my_reminders", "cancel_reminder",
    }


def _make_tool_call(name: str, arguments: dict) -> dict:
    return {
        "id": "call_test",
        "type": "function",
        "function": {
            "name": name,
            "arguments": json.dumps(arguments),
        },
    }


@pytest.mark.asyncio
@patch("core.agents.tools.execute_read_file", new_callable=AsyncMock, return_value="file content")
async def test_dispatches_read_file(mock_fn):
    tc = _make_tool_call("read_file", {"filename": "agent_style.md"})
    result = await coach_tool_executor(tc, user_id=1)
    assert result == "file content"
    mock_fn.assert_called_once_with(1, "agent_style.md")


@pytest.mark.asyncio
@patch("core.agents.tools.execute_append_memory", new_callable=AsyncMock, return_value="Noted.")
async def test_dispatches_append_memory(mock_fn):
    tc = _make_tool_call("append_memory", {"note": "likes tea"})
    result = await coach_tool_executor(tc, user_id=2)
    assert result == "Noted."
    mock_fn.assert_called_once_with(2, "likes tea")


@pytest.mark.asyncio
@patch("core.agents.tools.execute_get_my_progress", new_callable=AsyncMock, return_value="progress")
async def test_dispatches_get_my_progress(mock_fn):
    tc = _make_tool_call("get_my_progress", {})
    result = await coach_tool_executor(tc, user_id=3)
    assert result == "progress"
    mock_fn.assert_called_once_with(3)


@pytest.mark.asyncio
async def test_unknown_tool_returns_error():
    tc = _make_tool_call("hack_the_planet", {})
    result = await coach_tool_executor(tc, user_id=1)
    assert "Unknown tool" in result


@pytest.mark.asyncio
async def test_malformed_arguments_returns_error():
    tc = {
        "id": "call_test",
        "type": "function",
        "function": {"name": "read_file", "arguments": "not valid json {"},
    }
    result = await coach_tool_executor(tc, user_id=1)
    assert "Invalid" in result or "error" in result.lower()
