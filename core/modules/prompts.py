# core/modules/prompts.py
"""Shared prompt assembly for the chat system."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .flattened_types import ParsedCourse, ModuleRef, MeetingMarker

if TYPE_CHECKING:
    from .context import SectionContext

DEFAULT_BASE_PROMPT = """\
You are a tutor helping someone learn about AI safety. Each piece of content \
(article, video) has different topics and learning objectives.

You have access to tools for looking up information. Use them when:
- The student asks about alignment research topics beyond the current material
- You need to verify or expand on a specific claim
- The student asks about something not covered in the course

When you use a tool, briefly mention what you're looking up. Cite sources \
when providing information from tools."""

COURSE_OVERVIEW_INTRO = (
    "The course structure is Course > Units > Modules > Lenses. "
    "A Lens is a page containing (excerpts from) articles or videos, "
    "and AI tutor discussions. Lens == Page == Section.\n"
    "\n"
    "For each unit, the students study the modules and then have "
    "an online group discussion about the material."
)


def assemble_chat_prompt(
    base: str,
    instructions: str | None = None,
    context: SectionContext | str | None = None,
) -> str:
    """Assemble a system prompt from its parts.

    Args:
        base: The base system prompt.
        instructions: Stage-specific instructions (appended under header).
        context: SectionContext with previous/current content, or a plain string
                 (legacy — treated as previous content).

    Returns:
        The assembled system prompt string.
    """
    prompt = base
    if instructions:
        prompt += f"\n\n# Current Instructions\n\n{instructions}"
    if context:
        if isinstance(context, str):
            # Legacy callers (e.g. promptlab) pass a plain string
            prompt += (
                "\n\n# User's Current Location\n\n"
                f"The user previously read this content:\n---\n{context}\n---"
            )
        else:
            has_location = context.module_title or context.section_title
            has_segments = bool(context.segments)

            if has_location or has_segments:
                prompt += "\n\n# User's Current Location"

            if has_location:
                parts = []
                if context.module_title:
                    parts.append(f"- Module: {context.module_title}")
                if context.section_title:
                    parts.append(f"- Lens: {context.section_title}")
                prompt += "\n" + "\n".join(parts)

            if has_segments:
                prompt += "\n\nSegments of this lens:"
                for seg_num, content in context.segments:
                    idx = seg_num + 1
                    prompt += f'\n\n<segment index="{idx}">\n{content}\n</segment>'

                # Position line
                pos = context.segment_index + 1
                total = context.total_segments
                if pos < total:
                    remaining_start = pos + 1
                    if remaining_start == total:
                        prompt += f"\n\nThe user is currently at segment {pos}. They have probably not read segment {total} yet."
                    else:
                        prompt += f"\n\nThe user is currently at segment {pos}. They have probably not read segments {remaining_start}\u2013{total} yet."
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

    Meetings divide the course into units. Modules are listed within each unit.

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

    lines = [COURSE_OVERVIEW_INTRO, ""]

    # Split progression into units (delimited by MeetingMarkers)
    units: list[list[ModuleRef]] = [[]]
    for item in course.progression:
        if isinstance(item, MeetingMarker):
            units.append([])
        elif isinstance(item, ModuleRef):
            units[-1].append(item)

    for unit_num, module_refs in enumerate(units, start=1):
        if not module_refs:
            continue

        lines.append(f"## Unit {unit_num}:")
        lines.append("")

        for mod_ref in module_refs:
            is_current_module = mod_ref.slug == current_module_slug

            try:
                module = load_flattened_module(mod_ref.slug)
            except (ModuleNotFoundError, Exception):
                lines.append(f"### Module: {mod_ref.slug} (unavailable)")
                lines.append("")
                continue

            optional = " (optional)" if mod_ref.optional else ""
            lines.append(f"### Module: {module.title}{optional}")
            lines.append("Lenses:")

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
