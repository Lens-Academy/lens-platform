# core/modules/tests/test_course_tools.py
"""Tests for course content tool definitions and execution."""

import json
from unittest.mock import MagicMock

from core.modules.tools.course_search import get_tool_definitions, execute_tool


def _make_tool_call(name: str, arguments: dict):
    """Create a tool call object matching LiteLLM's structure."""
    tc = MagicMock()
    tc.function.name = name
    tc.function.arguments = json.dumps(arguments)
    return tc


def _make_index():
    """Build a real ContentIndex from test data."""
    from core.modules.tests.test_content_index import _make_cache_data
    from core.modules.tools.content_index import ContentIndex

    courses, modules = _make_cache_data()
    return ContentIndex(courses, modules)


class TestToolDefinitions:
    def test_returns_two_tools(self):
        tools = get_tool_definitions()
        assert len(tools) == 2

    def test_search_tool_schema(self):
        tools = get_tool_definitions()
        search = next(
            t for t in tools if t["function"]["name"] == "search_course_content"
        )
        assert search["type"] == "function"
        params = search["function"]["parameters"]
        assert "query" in params["properties"]
        assert "query" in params["required"]

    def test_read_tool_schema(self):
        tools = get_tool_definitions()
        read = next(t for t in tools if t["function"]["name"] == "read_lens")
        assert read["type"] == "function"
        params = read["function"]["parameters"]
        assert "path" in params["properties"]
        assert "path" in params["required"]


class TestExecuteSearch:
    """execute_tool dispatches search_course_content to real ContentIndex."""

    def test_returns_formatted_results(self):
        index = _make_index()
        tc = _make_tool_call("search_course_content", {"query": "mesa-optimization"})
        result = execute_tool(tc, index)
        assert "Goal Misgeneralization" in result
        assert "AGI Safety Fundamentals" in result

    def test_no_results_message(self):
        index = _make_index()
        tc = _make_tool_call("search_course_content", {"query": "quantum blockchain"})
        result = execute_tool(tc, index)
        assert "No results found" in result


class TestExecuteRead:
    """execute_tool dispatches read_lens to real ContentIndex."""

    def test_returns_lens_content(self):
        index = _make_index()
        tc = _make_tool_call(
            "read_lens",
            {"path": "AGI Safety Fundamentals/Risks from AI/Goal Misgeneralization"},
        )
        result = execute_tool(tc, index)
        assert "<lens" in result
        assert "Mesa-optimization" in result

    def test_not_found_message(self):
        index = _make_index()
        tc = _make_tool_call("read_lens", {"path": "Nonexistent/Path/Here"})
        result = execute_tool(tc, index)
        assert "not found" in result.lower()


class TestExecuteUnknown:
    def test_unknown_tool_returns_error(self):
        index = _make_index()
        tc = _make_tool_call("unknown_tool", {})
        result = execute_tool(tc, index)
        assert "unknown" in result.lower()
