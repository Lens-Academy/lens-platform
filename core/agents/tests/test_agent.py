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
