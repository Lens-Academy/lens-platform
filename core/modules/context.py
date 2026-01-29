# core/modules/context.py
"""Context gathering for chat sessions."""


def gather_section_context(section: dict, segment_index: int) -> str | None:
    """Gather content from preceding segments for chat context.

    Args:
        section: A flattened module section dict with "segments" list
        segment_index: Index of the current chat segment

    Returns:
        Formatted context string, or None if:
        - hidePreviousContentFromTutor is True on current segment
        - No content segments precede the current segment
        - segment_index is out of bounds
    """
    segments = section.get("segments", [])

    # Handle out of bounds
    if segment_index >= len(segments) or segment_index < 0:
        return None

    current_segment = segments[segment_index]

    # Check if this chat hides previous content
    if current_segment.get("hidePreviousContentFromTutor"):
        return None

    # Gather content from segments 0 to segment_index-1
    parts = []
    for i in range(segment_index):
        seg = segments[i]
        seg_type = seg.get("type")

        if seg_type == "text":
            content = seg.get("content", "")
            if content:
                parts.append(content)

        elif seg_type == "video-excerpt":
            transcript = seg.get("transcript", "")
            if transcript:
                parts.append(f"[Video transcript]\n{transcript}")

        elif seg_type == "article-excerpt":
            content = seg.get("content", "")
            if content:
                parts.append(content)

        # Skip chat segments - history captures those

    return "\n\n---\n\n".join(parts) if parts else None
