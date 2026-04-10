# core/modules/prompts.py
"""Shared prompt assembly for the chat system."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .flattened_types import ParsedCourse, ModuleRef, MeetingMarker
from .loader import load_flattened_module

if TYPE_CHECKING:
    from .context import SectionContext

DEFAULT_BASE_PROMPT = """\
You are a tutor helping someone learn about AI safety. Each piece of content \
(article, video) has different topics and learning objectives.

You have access to tools for looking up information. Use them when:
- The student asks about alignment research topics beyond the current material
- You need to verify or expand on a specific claim
- The student asks about something not covered in the course
- You need to examine the live contents of an embedded website or external link (use `read_url`)

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
    context: str | None = None,
) -> str:
    """Assemble a simple system prompt from parts (for promptlab).

    Args:
        base: The base system prompt.
        instructions: Stage-specific instructions (appended under header).
        context: Plain string context (treated as previous content).

    Returns:
        The assembled system prompt string.
    """
    prompt = base
    if instructions:
        prompt += f"\n\n# Current Instructions\n\n{instructions}"
    if context:
        prompt += (
            "\n\n# User's Current Location\n\n"
            f"The user previously read this content:\n---\n{context}\n---"
        )
    return prompt


def build_content_context_message(
    context: SectionContext,
    instructions: str | None = None,
) -> str:
    """Build a content context message for injection into conversation history.

    This formats segment content, location, and instructions as a single
    message to be stored as a system message in the DB and merged into the
    adjacent user message at LLM call time.

    Args:
        context: SectionContext with segments and position info.
        instructions: Optional segment-specific tutor instructions.

    Returns:
        Formatted string with <lens>, location marker, and optional
        <segment-instructions> blocks.
    """
    parts = []

    # Lens content with all segments
    if context.segments:
        attrs = []
        if context.module_title:
            attrs.append(f'module_title="{context.module_title}"')
        if context.section_title:
            attrs.append(f'lens_title="{context.section_title}"')
        attr_str = " " + " ".join(attrs) if attrs else ""
        parts.append(f"<lens{attr_str}>")

        for seg_num, seg_type, content in context.segments:
            idx = seg_num + 1
            parts.append(f'<segment index="{idx}" type="{seg_type}">')
            parts.append(content)
            parts.append("</segment>")

        parts.append("</lens>")

    # Location marker
    if context.section_title:
        pos = context.segment_index + 1
        parts.append(
            f'<student-position>Segment {pos} of "{context.section_title}"</student-position>'
        )

    # Tutor instructions
    if instructions:
        parts.append("<segment-instructions>")
        parts.append(instructions)
        parts.append("</segment-instructions>")

    return "\n".join(parts)


def build_location_update_message(
    section_title: str,
    segment_index: int,
) -> str:
    """Build a location update message for segment navigation.

    Used when the user moves to a different segment within the same section.

    Args:
        section_title: The current section/lens title.
        segment_index: The new segment index (0-based).

    Returns:
        Location marker string.
    """
    pos = segment_index + 1
    return f'<student-position>Segment {pos} of "{section_title}"</student-position>'


def build_course_overview(
    course: ParsedCourse,
) -> str:
    """Build a tree-formatted course overview for the system prompt.

    Uses the same path namespace as the search/read tools:
    CourseTitle/ModuleTitle/LensTitle

    Meetings divide the course into units.

    Args:
        course: The parsed course definition

    Returns:
        Formatted overview string for injection into system prompt
    """
    from . import ModuleNotFoundError

    lines = [COURSE_OVERVIEW_INTRO, ""]
    lines.append(f"{course.title}/")

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

        lines.append(f"  --- Unit {unit_num} ---")

        for mod_ref in module_refs:
            try:
                module = load_flattened_module(mod_ref.slug)
            except (ModuleNotFoundError, Exception):
                optional = " (optional)" if mod_ref.optional else ""
                lines.append(f"  {mod_ref.slug}/{optional} (unavailable)")
                continue

            optional = " (optional)" if mod_ref.optional else ""
            lines.append(f"  {module.title}/{optional}")

            for section in module.sections:
                title = section.get("meta", {}).get("title", "Untitled")
                tldr = section.get("summaryForTutor") or section.get("tldr", "")
                lines.append(f"    {title}")
                if tldr:
                    lines.append(f"      TLDR: {tldr}")

    return "\n".join(lines)
