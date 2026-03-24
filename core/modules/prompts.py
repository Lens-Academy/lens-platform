# core/modules/prompts.py
"""Shared prompt assembly for the chat system."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .flattened_types import ParsedCourse, ModuleRef, MeetingMarker

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
        prompt += f"\n\n# Instructions\n\n{instructions}"
    if context:
        if isinstance(context, str):
            # Legacy callers (e.g. promptlab) pass a plain string
            prompt += f"\n\n# Current Context\n\nThe user previously read this content:\n---\n{context}\n---"
        else:
            location = _format_location(context)
            has_segments = bool(context.segments)

            if location or has_segments:
                prompt += "\n\n# Current Context"

            if location:
                prompt += f"\n\nCurrent location: {location}"

            # Content block (cacheable — same regardless of position)
            if has_segments:
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


def build_course_overview(
    course: ParsedCourse,
    current_module_slug: str,
    current_section_index: int,
    completed_content_ids: set[str],
) -> str:
    """Build a structured course overview for the system prompt.

    Args:
        course: The parsed course definition
        current_module_slug: Slug of the module the student is currently in
        current_section_index: Index of the current section within the module
        completed_content_ids: Set of content IDs the student has completed

    Returns:
        Formatted overview string for injection into system prompt
    """
    from .loader import load_flattened_module
    from . import ModuleNotFoundError

    lines = [
        "The course contains lenses (articles, videos, discussions) organized into modules. "
        "The student can navigate between them.",
        "",
    ]

    for item in course.progression:
        if isinstance(item, MeetingMarker):
            lines.append(f"--- {item.name} ---")
            lines.append("")
            continue

        if not isinstance(item, ModuleRef):
            continue

        is_current_module = item.slug == current_module_slug

        try:
            module = load_flattened_module(item.slug)
        except (ModuleNotFoundError, Exception):
            lines.append(f"## {item.slug} (unavailable)")
            lines.append("")
            continue

        optional = " (optional)" if item.optional else ""
        lines.append(f"## {module.title}{optional}")
        lines.append("")

        for i, section in enumerate(module.sections):
            title = section.get("meta", {}).get("title", "Untitled")
            tldr = section.get("tldr", "")
            content_id = section.get("contentId")

            # Status marker
            if is_current_module and i == current_section_index:
                status = " ← you are here"
            elif content_id and str(content_id) in completed_content_ids:
                status = " ✓"
            else:
                status = ""

            lines.append(f"- **{title}**{status}")
            if tldr:
                lines.append(f"  TLDR: {tldr}")

        lines.append("")

    return "\n".join(lines)
