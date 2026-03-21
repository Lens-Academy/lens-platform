# core/modules/context.py
"""Context gathering for chat sessions."""

from dataclasses import dataclass, field


@dataclass
class SectionContext:
    """All segments in the section plus the user's current position."""

    segments: list[tuple[int, str]] = field(default_factory=list)
    """List of (original_index, content) for segments with extractable content."""
    segment_index: int = 0
    """User's current segment position (0-based)."""
    total_segments: int = 0
    """Total number of segments in the section."""
    module_title: str | None = None
    """Module title (e.g. 'Introduction to AI Safety')."""
    section_title: str | None = None
    """Section/lens title (e.g. 'The "most important century" blog post series')."""
    learning_outcome: str | None = None
    """Learning outcome name (submodule grouping), if applicable."""


def _extract_segment_content(
    seg: dict,
    article_title: str | None = None,
    article_author: str | None = None,
) -> str | None:
    """Extract displayable content from a single segment."""
    seg_type = seg.get("type")

    if seg_type == "text":
        content = seg.get("content", "")
        return f"[Written by Lens Academy]\n{content}" if content else None

    if seg_type in ("video", "video-excerpt"):
        transcript = seg.get("transcript", "")
        return f"[Video transcript]\n{transcript}" if transcript else None

    if seg_type in ("article", "article-excerpt"):
        content = seg.get("content", "")
        if not content:
            return None
        # Read title/author from segment itself (new format) or fall back to
        # section-level meta passed as arguments (old format / backward compat)
        title = seg.get("title") or article_title
        author = seg.get("author") or article_author
        parts = []
        if title:
            parts.append(f'"{title}"')
        if author:
            parts.append(f"by {author}")
        if parts:
            return f"[From {', '.join(parts)}]\n{content}"
        return content

    if seg_type == "roleplay":
        content = seg.get("content", "")
        return f"[Roleplay scenario]\n{content}" if content else None

    if seg_type == "chat":
        return "[Chat discussion]"

    if seg_type == "question":
        return "[Question]"

    return None


def gather_section_context(section: dict, segment_index: int) -> SectionContext | None:
    """Gather all segment content from the section with the user's position.

    Returns a SectionContext with numbered segments and position info,
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

    # Extract article metadata from section meta for attribution
    meta = section.get("meta", {})
    article_title = meta.get("title")
    article_author = meta.get("author")

    # Gather ALL segments in the section
    extracted: list[tuple[int, str]] = []
    for i, seg in enumerate(segments):
        content = _extract_segment_content(seg, article_title, article_author)
        if content:
            extracted.append((i, content))

    if not extracted:
        return None

    return SectionContext(
        segments=extracted,
        segment_index=segment_index,
        total_segments=len(segments),
    )
