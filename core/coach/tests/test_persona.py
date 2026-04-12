from core.coach.persona import COACH_SYSTEM_PROMPT, build_coach_agent
from core.agents.agent import Agent


def test_coach_system_prompt_is_nonempty():
    assert len(COACH_SYSTEM_PROMPT) > 100


def test_coach_prompt_mentions_handoff_criteria():
    lower = COACH_SYSTEM_PROMPT.lower()
    assert "transfer_to_tutor" in lower or "hand off" in lower


def test_coach_prompt_mentions_scope_limits():
    lower = COACH_SYSTEM_PROMPT.lower()
    assert "course progress" in lower or "don't have access" in lower


def test_build_coach_agent_returns_agent():
    agent = build_coach_agent()
    assert isinstance(agent, Agent)
    assert agent.name == "coach"
    assert "tutor" in agent.can_handoff_to


def test_registry_has_coach_and_tutor():
    from core.agents.registry import AGENT_REGISTRY
    assert "coach" in AGENT_REGISTRY
    assert "tutor" in AGENT_REGISTRY


def test_default_agent_for_discord_dm_is_coach():
    from core.agents.registry import default_agent_for
    agent = default_agent_for("discord_dm")
    assert agent.name == "coach"


def test_tutor_stub_can_handoff_to_coach():
    from core.agents.registry import AGENT_REGISTRY
    tutor = AGENT_REGISTRY["tutor"]
    assert "coach" in tutor.can_handoff_to


def test_registry_consistency():
    """Every agent's can_handoff_to targets exist in the registry."""
    from core.agents.registry import AGENT_REGISTRY
    for name, agent in AGENT_REGISTRY.items():
        for target in agent.can_handoff_to:
            assert target in AGENT_REGISTRY, (
                f"Agent '{name}' can hand off to '{target}' but '{target}' is not registered"
            )
