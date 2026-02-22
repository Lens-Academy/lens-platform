# core/modules/prompts.py
"""Shared prompt assembly for the chat system."""

DEFAULT_BASE_PROMPT = (
    "You are a tutor helping someone learn about AI safety. "
    "Each piece of content (article, video) has different topics "
    "and learning objectives."
)


def assemble_chat_prompt(
    base: str,
    instructions: str | None = None,
    context: str | None = None,
) -> str:
    """Assemble a system prompt from its three parts.

    Args:
        base: The base system prompt.
        instructions: Stage-specific instructions (appended under "Instructions:" header).
        context: Previous content context (appended in a fenced block).

    Returns:
        The assembled system prompt string.
    """
    prompt = base
    if instructions:
        prompt += f"\n\nInstructions:\n{instructions}"
    if context:
        prompt += f"\n\nThe user just engaged with this content:\n---\n{context}\n---"
    return prompt
