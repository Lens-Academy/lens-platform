from core.agents.agent import Agent


def test_agent_is_frozen():
    agent = Agent(name="test", system_prompt="You are a test.", model="anthropic/claude-sonnet-4-6", can_handoff_to=("other",))
    assert agent.name == "test"
    assert agent.can_handoff_to == ("other",)
    try:
        agent.name = "changed"
        assert False, "Should have raised"
    except AttributeError:
        pass


def test_agent_defaults():
    agent = Agent(name="a", system_prompt="p", model="m")
    assert agent.extra_tools == ()
    assert agent.can_handoff_to == ()


def test_agent_with_tool_executor():
    """Agent can be created with a tool_executor callable."""
    async def fake_executor(tool_call, user_id):
        return "result"

    agent = Agent(
        name="test",
        system_prompt="prompt",
        model="test-model",
        tool_executor=fake_executor,
    )
    assert agent.tool_executor is fake_executor


def test_agent_tool_executor_defaults_to_none():
    """Agent.tool_executor defaults to None when not provided."""
    agent = Agent(
        name="test",
        system_prompt="prompt",
        model="test-model",
    )
    assert agent.tool_executor is None
