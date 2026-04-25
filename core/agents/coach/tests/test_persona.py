"""Tests for coach persona and agent builder."""

from core.agents.coach.persona import build_coach_agent, COACH_SYSTEM_PROMPT


def test_build_coach_agent_returns_agent():
    agent = build_coach_agent()
    assert agent.name == "coach"
    assert agent.model is not None
    assert "tutor" in agent.can_handoff_to


def test_coach_has_tool_executor():
    agent = build_coach_agent()
    assert agent.tool_executor is not None


def test_coach_has_tool_schemas():
    agent = build_coach_agent()
    tool_names = {t["function"]["name"] for t in agent.extra_tools}
    assert "read_file" in tool_names
    assert "get_my_progress" in tool_names
    assert "schedule_reminder" in tool_names


def test_system_prompt_mentions_tools():
    assert "read_file" in COACH_SYSTEM_PROMPT
    assert "append_memory" in COACH_SYSTEM_PROMPT
    assert "get_my_progress" in COACH_SYSTEM_PROMPT
    assert "schedule_reminder" in COACH_SYSTEM_PROMPT


def test_system_prompt_mentions_memory_policy():
    assert "Want me to note that" in COACH_SYSTEM_PROMPT or "remember" in COACH_SYSTEM_PROMPT.lower()


def test_system_prompt_mentions_user_files():
    assert "agent_style.md" in COACH_SYSTEM_PROMPT
    assert "user.md" in COACH_SYSTEM_PROMPT
    assert "memory.md" in COACH_SYSTEM_PROMPT
