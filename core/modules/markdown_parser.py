# core/modules/markdown_parser.py
"""
Parse module and course Markdown files into structured data.

Format specification: docs/plans/2026-01-18-lesson-markdown-format-design.md
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID as PyUUID


# -----------------------------------------------------------------------------
# Types for parsed Markdown modules
# -----------------------------------------------------------------------------


@dataclass
class TextSegment:
    """A text content segment within a section."""

    type: str = "text"
    content: str = ""


@dataclass
class ChatSegment:
    """A chat/discussion segment within a section."""

    type: str = "chat"
    instructions: str = ""
    hide_previous_content_from_user: bool = False
    hide_previous_content_from_tutor: bool = False


@dataclass
class VideoExcerptSegment:
    """A video excerpt segment with timestamps."""

    type: str = "video-excerpt"
    from_time: str | None = None
    to_time: str | None = None


@dataclass
class ArticleExcerptSegment:
    """An article excerpt segment with text markers."""

    type: str = "article-excerpt"
    from_text: str | None = None
    to_text: str | None = None


Segment = TextSegment | ChatSegment | VideoExcerptSegment | ArticleExcerptSegment


@dataclass
class VideoSection:
    """A video-based section with source and segments."""

    type: str = "video"
    title: str = ""
    source: str = ""
    segments: list[Segment] = field(default_factory=list)
    optional: bool = False
    content_id: PyUUID | None = None


@dataclass
class ArticleSection:
    """An article-based section with source and segments."""

    type: str = "article"
    title: str = ""
    source: str = ""
    segments: list[Segment] = field(default_factory=list)
    optional: bool = False
    content_id: PyUUID | None = None


@dataclass
class TextSection:
    """A standalone text section (no child segments)."""

    type: str = "text"
    title: str = ""
    content: str = ""
    content_id: PyUUID | None = None


@dataclass
class ChatSection:
    """A standalone chat section (no child segments)."""

    type: str = "chat"
    title: str = ""
    instructions: str = ""
    hide_previous_content_from_user: bool = False
    hide_previous_content_from_tutor: bool = False
    content_id: PyUUID | None = None


Section = VideoSection | ArticleSection | TextSection | ChatSection


@dataclass
class ParsedModule:
    """A complete parsed module."""

    slug: str
    title: str
    sections: list[Section]
    content_id: PyUUID | None = None  # UUID from frontmatter, if present


@dataclass
class ModuleRef:
    """Reference to a module in a course progression."""

    path: str  # Wiki-link path like "modules/introduction"
    optional: bool = False


@dataclass
class MeetingMarker:
    """A meeting marker in the course progression."""

    number: int


ProgressionItem = ModuleRef | MeetingMarker


@dataclass
class ParsedCourse:
    """A complete parsed course."""

    slug: str
    title: str
    progression: list[ProgressionItem]


# -----------------------------------------------------------------------------
# Parsing utilities
# -----------------------------------------------------------------------------


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Extract YAML frontmatter and return (metadata, remaining_content)."""
    pattern = r"^---\s*\n(.*?)\n---\s*\n"
    match = re.match(pattern, text, re.DOTALL)

    if not match:
        return {}, text

    frontmatter_text = match.group(1)
    content = text[match.end() :]

    metadata = {}
    for line in frontmatter_text.split("\n"):
        line = line.strip()
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip().strip('"').strip("'")

    return metadata, content


def _parse_fields(text: str) -> dict[str, str]:
    """
    Parse key:: value fields from text.

    Single-line: key:: value
    Multi-line: key:: followed by lines until next key::, segment header (## ), or end
    """
    fields = {}
    lines = text.split("\n")
    current_key = None
    current_value_lines = []

    for line in lines:
        # Stop at segment headers (## SegmentType or ## SegmentType: Title)
        if re.match(r"^## \S+(?::\s*.+)?$", line):
            if current_key is not None:
                fields[current_key] = "\n".join(current_value_lines).strip()
                current_key = None
                current_value_lines = []
            continue

        # Check for new field
        field_match = re.match(r"^(\w+)::\s*(.*)?$", line)

        if field_match:
            # Save previous field if exists
            if current_key is not None:
                fields[current_key] = "\n".join(current_value_lines).strip()

            current_key = field_match.group(1)
            value_on_line = field_match.group(2) or ""

            if value_on_line:
                # Single-line value
                current_value_lines = [value_on_line]
            else:
                # Multi-line value starts on next line
                current_value_lines = []
        elif current_key is not None:
            # Continue multi-line value
            current_value_lines.append(line)

    # Save last field
    if current_key is not None:
        fields[current_key] = "\n".join(current_value_lines).strip()

    return fields


def _extract_wiki_link(text: str) -> str:
    """Extract path from [[wiki-link]] syntax."""
    match = re.search(r"\[\[([^\]]+)\]\]", text)
    if match:
        return match.group(1)
    return text.strip()


def _unescape_content_headers(content: str) -> str:
    """Convert !# headers back to # headers."""
    # Replace !# at start of line with #
    return re.sub(r"^(!)(#+)", r"\2", content, flags=re.MULTILINE)


def _parse_bool(value: str) -> bool:
    """Parse boolean string."""
    return value.lower() in ("true", "yes", "1")


def _strip_quotes(value: str | None) -> str | None:
    """Strip outer quotes from a value."""
    if value is None:
        return None
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


# -----------------------------------------------------------------------------
# Segment parsing
# -----------------------------------------------------------------------------


def _parse_segment(segment_type: str, content: str) -> Segment:
    """Parse a segment block into the appropriate Segment type."""
    fields = _parse_fields(content)
    segment_type_lower = segment_type.lower()

    if segment_type_lower == "text":
        raw_content = fields.get("content", "")
        return TextSegment(
            content=_unescape_content_headers(raw_content),
        )

    elif segment_type_lower == "chat":
        return ChatSegment(
            instructions=fields.get("instructions", ""),
            hide_previous_content_from_user=_parse_bool(
                fields.get("hidePreviousContentFromUser", "false")
            ),
            hide_previous_content_from_tutor=_parse_bool(
                fields.get("hidePreviousContentFromTutor", "false")
            ),
        )

    elif segment_type_lower == "video-excerpt":
        # from_time is null if not specified (not default "0:00")
        return VideoExcerptSegment(
            from_time=fields.get("from"),
            to_time=fields.get("to"),
        )

    elif segment_type_lower == "article-excerpt":
        # Strip outer quotes from from/to values
        return ArticleExcerptSegment(
            from_text=_strip_quotes(fields.get("from")),
            to_text=_strip_quotes(fields.get("to")),
        )

    else:
        raise ValueError(f"Unknown segment type: {segment_type}")


# -----------------------------------------------------------------------------
# Section parsing
# -----------------------------------------------------------------------------


def _split_into_segments(content: str) -> list[tuple[str, str]]:
    """Split section content into (segment_type, segment_content) tuples."""
    # Pattern for ## SegmentType or ## SegmentType: Title
    pattern = r"^## (\S+)(?::\s*.+)?$"

    segments = []
    current_type = None
    current_lines = []

    for line in content.split("\n"):
        match = re.match(pattern, line)
        if match:
            # Save previous segment
            if current_type is not None:
                segments.append((current_type, "\n".join(current_lines)))

            current_type = match.group(1)
            current_lines = []
        elif current_type is not None:
            current_lines.append(line)

    # Save last segment
    if current_type is not None:
        segments.append((current_type, "\n".join(current_lines)))

    return segments


def _parse_section(section_type: str, title: str, content: str) -> Section:
    """Parse a section block into the appropriate Section type."""
    fields = _parse_fields(content)
    section_type_lower = section_type.lower()

    # Parse optional flag (default False)
    optional = _parse_bool(fields.get("optional", "false"))

    # Extract content_id if present
    content_id = None
    if "id" in fields:
        try:
            content_id = PyUUID(fields["id"])
        except ValueError:
            pass  # Invalid UUID format, leave as None

    if section_type_lower == "video":
        source = _extract_wiki_link(fields.get("source", ""))
        segment_data = _split_into_segments(content)
        segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]

        return VideoSection(
            title=title,
            source=source,
            segments=segments,
            optional=optional,
            content_id=content_id,
        )

    elif section_type_lower == "article":
        source = _extract_wiki_link(fields.get("source", ""))
        segment_data = _split_into_segments(content)
        segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]

        return ArticleSection(
            title=title,
            source=source,
            segments=segments,
            optional=optional,
            content_id=content_id,
        )

    elif section_type_lower == "text":
        raw_content = fields.get("content", "")
        return TextSection(
            title=title,
            content=_unescape_content_headers(raw_content),
            content_id=content_id,
        )

    elif section_type_lower == "chat":
        return ChatSection(
            title=title,
            instructions=fields.get("instructions", ""),
            hide_previous_content_from_user=_parse_bool(
                fields.get("hidePreviousContentFromUser", "false")
            ),
            hide_previous_content_from_tutor=_parse_bool(
                fields.get("hidePreviousContentFromTutor", "false")
            ),
            content_id=content_id,
        )

    else:
        raise ValueError(f"Unknown section type: {section_type}")


# -----------------------------------------------------------------------------
# Main parsing functions
# -----------------------------------------------------------------------------


def _split_into_sections(content: str) -> list[tuple[str, str, str]]:
    """Split content into (section_type, title, section_content) tuples."""
    # Pattern for # SectionType or # SectionType: Title (title is optional)
    pattern = r"^# (\w+)(?::\s*(.*))?$"

    sections = []
    current_type = None
    current_title = None
    current_lines = []

    for line in content.split("\n"):
        match = re.match(pattern, line)
        if match:
            # Save previous section
            if current_type is not None:
                sections.append((current_type, current_title, "\n".join(current_lines)))

            current_type = match.group(1)
            current_title = (match.group(2) or "").strip()
            current_lines = []
        elif current_type is not None:
            current_lines.append(line)

    # Save last section
    if current_type is not None:
        sections.append((current_type, current_title, "\n".join(current_lines)))

    return sections


def parse_module(text: str) -> ParsedModule:
    """
    Parse a module Markdown file into a ParsedModule.

    Args:
        text: Full markdown text of the module file

    Returns:
        ParsedModule with slug, title, and sections
    """
    metadata, content = _parse_frontmatter(text)

    slug = metadata.get("slug", "")
    title = metadata.get("title", "")

    # Extract content_id if present
    content_id = None
    if "id" in metadata:
        try:
            content_id = PyUUID(metadata["id"])
        except ValueError:
            pass  # Invalid UUID format, leave as None

    section_data = _split_into_sections(content)
    sections = [
        _parse_section(stype, stitle, scontent)
        for stype, stitle, scontent in section_data
    ]

    return ParsedModule(
        slug=slug,
        title=title,
        sections=sections,
        content_id=content_id,
    )


def parse_module_file(path: Path | str) -> ParsedModule:
    """
    Parse a module Markdown file from disk.

    Args:
        path: Path to the module .md file

    Returns:
        ParsedModule with slug, title, and sections
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    return parse_module(text)


# -----------------------------------------------------------------------------
# Course parsing
# -----------------------------------------------------------------------------


def parse_course(text: str) -> ParsedCourse:
    """
    Parse a course Markdown file into a ParsedCourse.

    Args:
        text: Full markdown text of the course file

    Returns:
        ParsedCourse with slug, title, and progression
    """
    metadata, content = _parse_frontmatter(text)

    slug = metadata.get("slug", "")
    title = metadata.get("title", "")

    progression = []

    # Pattern for # Lesson: [[path]] or # Meeting: number
    # Note: The markdown format still uses "# Lesson:" for backward compatibility
    module_pattern = r"^# Lesson:\s*(.+)$"
    meeting_pattern = r"^# Meeting:\s*(\d+)$"

    lines = content.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        module_match = re.match(module_pattern, line)
        meeting_match = re.match(meeting_pattern, line)

        if module_match:
            path = _extract_wiki_link(module_match.group(1))
            optional = False

            # Check next lines for optional:: field
            j = i + 1
            while j < len(lines):
                next_line = lines[j].strip()
                if next_line.startswith("optional::"):
                    optional = _parse_bool(next_line.split("::", 1)[1].strip())
                    j += 1
                elif next_line == "" or next_line.startswith("#"):
                    break
                else:
                    j += 1

            progression.append(ModuleRef(path=path, optional=optional))
            i = j

        elif meeting_match:
            number = int(meeting_match.group(1))
            progression.append(MeetingMarker(number=number))
            i += 1

        else:
            i += 1

    return ParsedCourse(
        slug=slug,
        title=title,
        progression=progression,
    )


def parse_course_file(path: Path | str) -> ParsedCourse:
    """
    Parse a course Markdown file from disk.

    Args:
        path: Path to the course .md file

    Returns:
        ParsedCourse with slug, title, and progression
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    return parse_course(text)
