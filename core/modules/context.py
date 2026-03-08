# core/modules/context.py
"""Context gathering for chat sessions."""

from dataclasses import dataclass


@dataclass
class SectionContext:
    """Content the user has read and is currently reading."""

    previous: str | None
    """Content from segments before the current one (already read)."""
    current: str | None
    """Content of the current segment (currently reading)."""
    module_title: str | None = None
    """Module title (e.g. 'Introduction to AI Safety')."""
    section_title: str | None = None
    """Section/lens title (e.g. 'The "most important century" blog post series')."""
    learning_outcome: str | None = None
    """Learning outcome name (submodule grouping), if applicable."""


def _extract_segment_content(seg: dict) -> str | None:
    """Extract displayable content from a single segment."""
    seg_type = seg.get("type")

    if seg_type == "text":
        content = seg.get("content", "")
        return content or None

    if seg_type == "video-excerpt":
        transcript = seg.get("transcript", "")
        return f"[Video transcript]\n{transcript}" if transcript else None

    if seg_type == "article-excerpt":
        content = seg.get("content", "")
        return content or None

    if seg_type == "roleplay":
        content = seg.get("content", "")
        return f"[Roleplay scenario]\n{content}" if content else None

    # chat segments etc. — no extractable content
    return None


def gather_section_context(section: dict, segment_index: int) -> SectionContext | None:
    """Gather content from segments up to and including segment_index.

    Returns a SectionContext with separate previous/current content,
    or None if hidePreviousContentFromTutor is set or index is out of bounds.

    Args:
        section: A flattened module section dict with "segments" list
        segment_index: Index of the current segment (chat or content)
    """
    segments = section.get("segments", [])

    if segment_index >= len(segments) or segment_index < 0:
        return None

    current_segment = segments[segment_index]

    if current_segment.get("hidePreviousContentFromTutor"):
        return None

    # Gather content from preceding segments
    previous_parts = []
    for i in range(segment_index):
        content = _extract_segment_content(segments[i])
        if content:
            previous_parts.append(content)

    previous = "\n\n---\n\n".join(previous_parts) if previous_parts else None

    # Extract current segment content
    current = _extract_segment_content(current_segment)

    if not previous and not current:
        return None

    return SectionContext(previous=previous, current=current)
