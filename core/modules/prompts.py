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

TOOL_USAGE_GUIDANCE = """
You have access to tools for looking up information. Use them when:
- The student asks about alignment research topics beyond the current material
- You need to verify or expand on a specific claim
- The student asks about something not covered in the course

When you use a tool, briefly mention what you're looking up. Cite sources when providing information from tools."""


def _format_location(context: "SectionContext") -> str | None:
    """Build a 'Module > Learning Outcome > Section' breadcrumb string."""
    parts = []
    if context.module_title:
        parts.append(context.module_title)
    if context.learning_outcome:
        parts.append(context.learning_outcome)
    if context.section_title:
        parts.append(context.section_title)
    return " > ".join(parts) if parts else None


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
            prompt += f"\n\nThe user previously read this content:\n---\n{context}\n---"
        else:
            location = _format_location(context)
            if location:
                prompt += f"\n\nCurrent location in course: {location}"

            # Content block (cacheable — same regardless of position)
            if context.segments:
                prompt += "\n\nThe user is engaging with the following content:"
                for seg_num, content in context.segments:
                    prompt += f"\n\nSegment {seg_num + 1}:\n{content}"

                # Position line (only part that changes)
                pos = context.segment_index + 1
                total = context.total_segments
                if pos < total:
                    prompt += f"\n\nThe user is currently at segment {pos}. They have probably not read segments {pos + 1}\u2013{total} yet."
                else:
                    prompt += f"\n\nThe user is currently at segment {pos} (the last segment)."
    return prompt
