# core/modules/prompts.py
"""Shared prompt assembly for the chat system."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .context import SectionContext

DEFAULT_BASE_PROMPT = (
    "You are a tutor helping someone learn about AI safety. "
    "Each piece of content (article, video) has different topics "
    "and learning objectives."
)


def assemble_chat_prompt(
    base: str,
    instructions: str | None = None,
    context: SectionContext | str | None = None,
) -> str:
    """Assemble a system prompt from its parts.

    Args:
        base: The base system prompt.
        instructions: Stage-specific instructions (appended under "Instructions:" header).
        context: SectionContext with previous/current content, or a plain string
                 (legacy — treated as previous content).

    Returns:
        The assembled system prompt string.
    """
    prompt = base
    if instructions:
        prompt += f"\n\nInstructions:\n{instructions}"
    if context:
        if isinstance(context, str):
            # Legacy callers (e.g. promptlab) pass a plain string
            prompt += (
                f"\n\nThe user previously read this content:\n"
                f"---\n{context}\n---"
            )
        else:
            if context.previous:
                prompt += (
                    f"\n\nThe user previously read this content:\n"
                    f"---\n{context.previous}\n---"
                )
            if context.current:
                prompt += (
                    f"\n\nThe user is currently reading this content:\n"
                    f"---\n{context.current}\n---"
                )
    return prompt
