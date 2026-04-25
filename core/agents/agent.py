from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class Agent:
    """An immutable agent definition with a persona and handoff targets."""
    name: str
    system_prompt: str
    model: str
    extra_tools: tuple[dict, ...] = field(default_factory=tuple)
    can_handoff_to: tuple[str, ...] = field(default_factory=tuple)
    tool_executor: Callable | None = None
