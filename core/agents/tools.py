# AGENT_REGISTRY is populated later by registry.py to avoid circular imports.
AGENT_REGISTRY: dict = {}


def build_transfer_tool(target_agent_name: str) -> dict:
    """Build an OpenAI-format tool schema for handing off to another agent."""
    return {
        "type": "function",
        "function": {
            "name": f"transfer_to_{target_agent_name}",
            "description": (
                f"Hand off the conversation to the {target_agent_name}. "
                f"Only call this when the user's message is clearly outside "
                f"your expertise. You must provide a clear reason."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Why this conversation should move to the other agent.",
                    },
                },
                "required": ["reason"],
            },
        },
    }


def build_all_transfer_tools() -> list[dict]:
    """Build transfer tools for every registered agent."""
    return [build_transfer_tool(name) for name in AGENT_REGISTRY.keys()]
