from core.agents.agent import Agent
from core.agents import tools as tools_module
from core.coach.persona import build_coach_agent
from core.modules.llm import DEFAULT_PROVIDER


_TUTOR_STUB_PROMPT = """\
You are a placeholder for the AI safety tutor, which isn't fully integrated yet.

Briefly acknowledge what the user asked about. Give a short, helpful \
1-2 sentence answer if you can (you know AI safety concepts). Then mention \
that a full tutor with course materials is coming soon.

Do NOT call transfer_to_coach — the user will naturally continue the \
conversation and the system will route them back to the coach if needed.
"""


def _build_tutor_stub() -> Agent:
    return Agent(
        name="tutor",
        system_prompt=_TUTOR_STUB_PROMPT,
        model=DEFAULT_PROVIDER,
        can_handoff_to=("coach",),
    )


AGENT_REGISTRY: dict[str, Agent] = {
    "coach": build_coach_agent(),
    "tutor": _build_tutor_stub(),
}

# Wire up tools.py's forward reference
tools_module.AGENT_REGISTRY = AGENT_REGISTRY

PLATFORM_DEFAULTS: dict[str, str] = {
    "discord_dm": "coach",
    "whatsapp": "coach",
    "web_coach": "coach",
}


def default_agent_for(platform: str) -> Agent:
    name = PLATFORM_DEFAULTS.get(platform)
    if name is None:
        raise ValueError(f"No default agent for platform: {platform}")
    return AGENT_REGISTRY[name]
