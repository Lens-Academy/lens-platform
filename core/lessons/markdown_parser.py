# core/lessons/markdown_parser.py
"""
Parse lesson and course Markdown files into structured data.

Format specification: docs/plans/2026-01-18-lesson-markdown-format-design.md
"""

import re
from dataclasses import dataclass, field
from pathlib import Path


# -----------------------------------------------------------------------------
# Types for parsed Markdown lessons
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
    show_user_previous_content: bool = True
    show_tutor_previous_content: bool = True


@dataclass
class VideoExcerptSegment:
    """A video excerpt segment with timestamps."""

    type: str = "video-excerpt"
    from_time: str = "0:00"
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


@dataclass
class ArticleSection:
    """An article-based section with source and segments."""

    type: str = "article"
    title: str = ""
    source: str = ""
    segments: list[Segment] = field(default_factory=list)


@dataclass
class TextSection:
    """A standalone text section (no child segments)."""

    type: str = "text"
    title: str = ""
    content: str = ""


@dataclass
class ChatSection:
    """A standalone chat section (no child segments)."""

    type: str = "chat"
    title: str = ""
    instructions: str = ""
    show_user_previous_content: bool = True
    show_tutor_previous_content: bool = True


Section = VideoSection | ArticleSection | TextSection | ChatSection


@dataclass
class ParsedLesson:
    """A complete parsed lesson."""

    slug: str
    title: str
    sections: list[Section]


@dataclass
class LessonRef:
    """Reference to a lesson in a course progression."""

    path: str  # Wiki-link path like "lessons/introduction"
    optional: bool = False


@dataclass
class MeetingMarker:
    """A meeting marker in the course progression."""

    number: int


ProgressionItem = LessonRef | MeetingMarker


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
    Multi-line: key:: followed by lines until next key:: or end
    """
    fields = {}
    lines = text.split("\n")
    current_key = None
    current_value_lines = []

    for line in lines:
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
            show_user_previous_content=_parse_bool(
                fields.get("showUserPreviousContent", "true")
            ),
            show_tutor_previous_content=_parse_bool(
                fields.get("showTutorPreviousContent", "true")
            ),
        )

    elif segment_type_lower == "video-excerpt":
        return VideoExcerptSegment(
            from_time=fields.get("from", "0:00"),
            to_time=fields.get("to"),
        )

    elif segment_type_lower == "article-excerpt":
        return ArticleExcerptSegment(
            from_text=fields.get("from"),
            to_text=fields.get("to"),
        )

    else:
        raise ValueError(f"Unknown segment type: {segment_type}")


# -----------------------------------------------------------------------------
# Section parsing
# -----------------------------------------------------------------------------


def _split_into_segments(content: str) -> list[tuple[str, str]]:
    """Split section content into (segment_type, segment_content) tuples."""
    # Pattern for ## SegmentType
    pattern = r"^## (\S+)\s*$"

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

    if section_type_lower == "video":
        source = _extract_wiki_link(fields.get("source", ""))
        segment_data = _split_into_segments(content)
        segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]

        return VideoSection(
            title=title,
            source=source,
            segments=segments,
        )

    elif section_type_lower == "article":
        source = _extract_wiki_link(fields.get("source", ""))
        segment_data = _split_into_segments(content)
        segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]

        return ArticleSection(
            title=title,
            source=source,
            segments=segments,
        )

    elif section_type_lower == "text":
        raw_content = fields.get("content", "")
        return TextSection(
            title=title,
            content=_unescape_content_headers(raw_content),
        )

    elif section_type_lower == "chat":
        return ChatSection(
            title=title,
            instructions=fields.get("instructions", ""),
            show_user_previous_content=_parse_bool(
                fields.get("showUserPreviousContent", "true")
            ),
            show_tutor_previous_content=_parse_bool(
                fields.get("showTutorPreviousContent", "true")
            ),
        )

    else:
        raise ValueError(f"Unknown section type: {section_type}")


# -----------------------------------------------------------------------------
# Main parsing functions
# -----------------------------------------------------------------------------


def _split_into_sections(content: str) -> list[tuple[str, str, str]]:
    """Split content into (section_type, title, section_content) tuples."""
    # Pattern for # SectionType: Title
    pattern = r"^# (\w+):\s*(.+)$"

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
            current_title = match.group(2).strip()
            current_lines = []
        elif current_type is not None:
            current_lines.append(line)

    # Save last section
    if current_type is not None:
        sections.append((current_type, current_title, "\n".join(current_lines)))

    return sections


def parse_lesson(text: str) -> ParsedLesson:
    """
    Parse a lesson Markdown file into a ParsedLesson.

    Args:
        text: Full markdown text of the lesson file

    Returns:
        ParsedLesson with slug, title, and sections
    """
    metadata, content = _parse_frontmatter(text)

    slug = metadata.get("slug", "")
    title = metadata.get("title", "")

    section_data = _split_into_sections(content)
    sections = [
        _parse_section(stype, stitle, scontent)
        for stype, stitle, scontent in section_data
    ]

    return ParsedLesson(
        slug=slug,
        title=title,
        sections=sections,
    )


def parse_lesson_file(path: Path | str) -> ParsedLesson:
    """
    Parse a lesson Markdown file from disk.

    Args:
        path: Path to the lesson .md file

    Returns:
        ParsedLesson with slug, title, and sections
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    return parse_lesson(text)


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
    lesson_pattern = r"^# Lesson:\s*(.+)$"
    meeting_pattern = r"^# Meeting:\s*(\d+)$"

    lines = content.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        lesson_match = re.match(lesson_pattern, line)
        meeting_match = re.match(meeting_pattern, line)

        if lesson_match:
            path = _extract_wiki_link(lesson_match.group(1))
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

            progression.append(LessonRef(path=path, optional=optional))
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
