# core/modules/markdown_parser.py
"""
Parse module and course Markdown files into structured data.

Format specification: docs/plans/2026-01-18-lesson-markdown-format-design.md
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID as PyUUID

from core.modules.critic_markup import strip_critic_markup
from core.modules.markdown_validator import (
    extract_wiki_link_path,
    parse_frontmatter,
    parse_fields,
    split_by_headers,
    FIELD_STOP_PATTERN_H2,
)


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


# -----------------------------------------------------------------------------
# Types for Lens file segments (support optional:: field)
# -----------------------------------------------------------------------------


@dataclass
class LensTextSegment:
    """A text content segment within a Lens section."""

    type: str = "text"
    content: str = ""
    optional: bool = False


@dataclass
class LensChatSegment:
    """A chat/discussion segment within a Lens section."""

    type: str = "chat"
    instructions: str = ""
    hide_previous_content_from_user: bool = False
    hide_previous_content_from_tutor: bool = False
    optional: bool = False


@dataclass
class LensVideoExcerptSegment:
    """A video excerpt segment within a Lens section."""

    type: str = "video-excerpt"
    from_time: str | None = None
    to_time: str | None = None
    optional: bool = False


@dataclass
class LensArticleExcerptSegment:
    """An article excerpt segment within a Lens section."""

    type: str = "article-excerpt"
    from_text: str | None = None
    to_text: str | None = None
    optional: bool = False


LensSegment = (
    LensTextSegment
    | LensChatSegment
    | LensVideoExcerptSegment
    | LensArticleExcerptSegment
)


# -----------------------------------------------------------------------------
# Types for Lens file sections
# -----------------------------------------------------------------------------


@dataclass
class LensVideoSection:
    """A video section in a Lens file."""

    type: str = "video"
    title: str = ""
    source: str = ""
    segments: list[LensSegment] = field(default_factory=list)


@dataclass
class LensArticleSection:
    """An article section in a Lens file."""

    type: str = "article"
    title: str = ""
    source: str = ""
    segments: list[LensSegment] = field(default_factory=list)


LensSection = LensVideoSection | LensArticleSection


@dataclass
class ParsedLens:
    """A complete parsed Lens file."""

    content_id: PyUUID
    sections: list[LensSection] = field(default_factory=list)


# -----------------------------------------------------------------------------
# Types for Module sections
# -----------------------------------------------------------------------------


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


@dataclass
class PageSection:
    """A page section containing Text and Chat segments."""

    type: str = "page"
    title: str = ""
    segments: list[Segment] = field(default_factory=list)
    content_id: PyUUID | None = None


@dataclass
class LearningOutcomeRef:
    """A reference to a Learning Outcome file."""

    type: str = "learning-outcome"
    source: str = ""
    optional: bool = False


@dataclass
class LensRef:
    """A reference to a Lens file within an Uncategorized section."""

    type: str = "lens"
    source: str = ""
    optional: bool = False


@dataclass
class TestRef:
    """A reference to a Test file within a Learning Outcome."""

    source: str = ""


@dataclass
class ParsedLearningOutcome:
    """A complete parsed Learning Outcome file."""

    content_id: PyUUID
    discussion: str | None = None
    test: TestRef | None = None
    lenses: list[LensRef] = field(default_factory=list)


@dataclass
class UncategorizedSection:
    """An Uncategorized section containing Lens references."""

    type: str = "uncategorized"
    lenses: list[LensRef] = field(default_factory=list)


Section = (
    VideoSection
    | ArticleSection
    | TextSection
    | ChatSection
    | PageSection
    | LearningOutcomeRef
    | UncategorizedSection
)


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
    metadata, content, _, _ = parse_frontmatter(text)
    return metadata, content


def _parse_fields(text: str) -> dict[str, str]:
    """Parse key:: value fields from text (stops at ## headers)."""
    return parse_fields(text, FIELD_STOP_PATTERN_H2)


def _extract_wiki_link(text: str) -> str:
    """Extract path from [[wiki-link]] or ![[embed]] syntax.

    Handles Obsidian display name syntax: [[path|display name]] -> path
    """
    path = extract_wiki_link_path(text)
    if path is not None:
        return path
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


def _parse_lens_refs(content: str) -> list["LensRef"]:
    """Parse ## Lens: subsections within an Uncategorized section."""
    lenses = []

    # Split on ## Lens: headers
    lens_pattern = r"^## Lens:.*$"
    current_content_lines = []
    in_lens = False

    for line in content.split("\n"):
        if re.match(lens_pattern, line):
            # Save previous lens if exists
            if in_lens and current_content_lines:
                lens_fields = _parse_fields("\n".join(current_content_lines))
                source = _extract_wiki_link(lens_fields.get("source", ""))
                optional = _parse_bool(lens_fields.get("optional", "false"))
                lenses.append(LensRef(source=source, optional=optional))

            in_lens = True
            current_content_lines = []
        elif in_lens:
            current_content_lines.append(line)

    # Save last lens
    if in_lens and current_content_lines:
        lens_fields = _parse_fields("\n".join(current_content_lines))
        source = _extract_wiki_link(lens_fields.get("source", ""))
        optional = _parse_bool(lens_fields.get("optional", "false"))
        lenses.append(LensRef(source=source, optional=optional))

    return lenses


def _split_into_segments(content: str) -> list[tuple[str, str]]:
    """Split section content into (segment_type, segment_content) tuples."""
    # Pattern for ## SegmentType or ## SegmentType: Title
    pattern = r"^## ([^:\s]+)(?::\s*.*)?$"
    sections = split_by_headers(content, pattern, include_line_numbers=False)
    return [(groups[0], text) for _, groups, text in sections]


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

    elif section_type_lower == "page":
        segment_data = _split_into_segments(content)
        segments = [_parse_segment(stype, scontent) for stype, scontent in segment_data]

        return PageSection(
            title=title,
            segments=segments,
            content_id=content_id,
        )

    elif section_type_lower == "learning outcome":
        source = _extract_wiki_link(fields.get("source", ""))
        return LearningOutcomeRef(
            source=source,
            optional=optional,
        )

    elif section_type_lower == "uncategorized":
        lenses = _parse_lens_refs(content)
        return UncategorizedSection(lenses=lenses)

    else:
        raise ValueError(f"Unknown section type: {section_type}")


# -----------------------------------------------------------------------------
# Main parsing functions
# -----------------------------------------------------------------------------


def _split_into_sections(content: str) -> list[tuple[str, str, str]]:
    """Split content into (section_type, title, section_content) tuples."""
    # Pattern for # SectionType or # SectionType: Title (title is optional)
    pattern = r"^# (.+?)(?::\s*(.*))?$"
    sections = split_by_headers(content, pattern, include_line_numbers=False)
    return [
        (groups[0].strip(), (groups[1] or "").strip(), text)
        for _, groups, text in sections
    ]


def parse_module(text: str) -> ParsedModule:
    """
    Parse a module Markdown file into a ParsedModule.

    Args:
        text: Full markdown text of the module file

    Returns:
        ParsedModule with slug, title, and sections
    """
    # Strip critic markup first (reject all changes behavior)
    text = strip_critic_markup(text)

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

    # Pattern for # Module: [[path]] or # Lesson: [[path]] or # Meeting: number
    # Supports both "# Module:" (current) and "# Lesson:" (legacy)
    module_pattern = r"^# (?:Module|Lesson):\s*(.+)$"
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


# -----------------------------------------------------------------------------
# Learning Outcome parsing
# -----------------------------------------------------------------------------


def _parse_test_section(content: str) -> TestRef | None:
    """Parse ## Test: section from content, if present."""
    # Find ## Test: section
    test_pattern = r"^## Test:.*$"
    in_test = False
    test_lines = []

    for line in content.split("\n"):
        if re.match(test_pattern, line):
            in_test = True
            test_lines = []
        elif in_test:
            # Stop at next ## header
            if re.match(r"^## \S+", line):
                break
            test_lines.append(line)

    if not in_test:
        return None

    fields = _parse_fields("\n".join(test_lines))
    source = _extract_wiki_link(fields.get("source", ""))
    if not source:
        return None

    return TestRef(source=source)


def _parse_lo_lens_refs(content: str) -> list[LensRef]:
    """Parse ## Lens: sections from Learning Outcome content."""
    lenses = []

    # Split on ## Lens: headers
    lens_pattern = r"^## Lens:.*$"
    current_content_lines = []
    in_lens = False

    for line in content.split("\n"):
        if re.match(lens_pattern, line):
            # Save previous lens if exists
            if in_lens and current_content_lines:
                lens_fields = _parse_fields("\n".join(current_content_lines))
                source = _extract_wiki_link(lens_fields.get("source", ""))
                optional = _parse_bool(lens_fields.get("optional", "false"))
                if source:
                    lenses.append(LensRef(source=source, optional=optional))

            in_lens = True
            current_content_lines = []
        elif in_lens:
            # Stop at ## Test: (don't include Test section in lens)
            if re.match(r"^## Test:", line):
                # Save current lens before stopping
                if current_content_lines:
                    lens_fields = _parse_fields("\n".join(current_content_lines))
                    source = _extract_wiki_link(lens_fields.get("source", ""))
                    optional = _parse_bool(lens_fields.get("optional", "false"))
                    if source:
                        lenses.append(LensRef(source=source, optional=optional))
                in_lens = False
                current_content_lines = []
            else:
                current_content_lines.append(line)

    # Save last lens
    if in_lens and current_content_lines:
        lens_fields = _parse_fields("\n".join(current_content_lines))
        source = _extract_wiki_link(lens_fields.get("source", ""))
        optional = _parse_bool(lens_fields.get("optional", "false"))
        if source:
            lenses.append(LensRef(source=source, optional=optional))

    return lenses


def parse_learning_outcome(text: str) -> ParsedLearningOutcome:
    """
    Parse a Learning Outcome Markdown file into a ParsedLearningOutcome.

    Args:
        text: Full markdown text of the Learning Outcome file

    Returns:
        ParsedLearningOutcome with content_id, discussion, test, and lenses
    """
    # Strip critic markup first (reject all changes behavior)
    text = strip_critic_markup(text)

    metadata, content = _parse_frontmatter(text)

    # Parse required id field
    content_id = PyUUID(metadata["id"])

    # Parse optional discussion field
    discussion = metadata.get("discussion") or None

    # Parse optional ## Test: section
    test = _parse_test_section(content)

    # Parse ## Lens: sections
    lenses = _parse_lo_lens_refs(content)

    return ParsedLearningOutcome(
        content_id=content_id,
        discussion=discussion,
        test=test,
        lenses=lenses,
    )


def parse_learning_outcome_file(path: Path | str) -> ParsedLearningOutcome:
    """
    Parse a Learning Outcome Markdown file from disk.

    Args:
        path: Path to the Learning Outcome .md file

    Returns:
        ParsedLearningOutcome with content_id, discussion, test, and lenses
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    return parse_learning_outcome(text)


# -----------------------------------------------------------------------------
# Lens file parsing
# -----------------------------------------------------------------------------


def _split_lens_sections(content: str) -> list[tuple[str, str, str]]:
    """Split Lens content into (section_type, title, section_content) tuples."""
    # Pattern for ### Type: Title (case-insensitive with (?i))
    pattern = r"(?i)^### (Article|Video):\s*(.*)$"
    sections = split_by_headers(content, pattern, include_line_numbers=False)
    return [
        (groups[0].strip(), groups[1].strip(), text) for _, groups, text in sections
    ]


def _split_lens_segments(content: str) -> list[tuple[str, str]]:
    """Split Lens section content into (segment_type, segment_content) tuples."""
    # Pattern for #### SegmentType or #### SegmentType: Title
    pattern = r"^#### ([^:\s]+)(?::\s*.*)?$"
    sections = split_by_headers(content, pattern, include_line_numbers=False)
    return [(groups[0], text) for _, groups, text in sections]


def _parse_lens_segment(segment_type: str, content: str) -> LensSegment:
    """Parse a Lens segment block into the appropriate LensSegment type."""
    fields = _parse_fields(content)
    segment_type_lower = segment_type.lower()
    optional = _parse_bool(fields.get("optional", "false"))

    if segment_type_lower == "text":
        raw_content = fields.get("content", "")
        return LensTextSegment(
            content=_unescape_content_headers(raw_content),
            optional=optional,
        )

    elif segment_type_lower == "chat":
        return LensChatSegment(
            instructions=fields.get("instructions", ""),
            hide_previous_content_from_user=_parse_bool(
                fields.get("hidePreviousContentFromUser", "false")
            ),
            hide_previous_content_from_tutor=_parse_bool(
                fields.get("hidePreviousContentFromTutor", "false")
            ),
            optional=optional,
        )

    elif segment_type_lower == "video-excerpt":
        return LensVideoExcerptSegment(
            from_time=fields.get("from"),
            to_time=fields.get("to"),
            optional=optional,
        )

    elif segment_type_lower == "article-excerpt":
        return LensArticleExcerptSegment(
            from_text=_strip_quotes(fields.get("from")),
            to_text=_strip_quotes(fields.get("to")),
            optional=optional,
        )

    else:
        raise ValueError(f"Unknown Lens segment type: {segment_type}")


def _parse_lens_section(section_type: str, title: str, content: str) -> LensSection:
    """Parse a Lens section block into LensVideoSection or LensArticleSection."""
    fields = _parse_fields(content)
    source = _extract_wiki_link(fields.get("source", ""))

    segment_data = _split_lens_segments(content)
    segments = [
        _parse_lens_segment(stype, scontent) for stype, scontent in segment_data
    ]

    section_type_lower = section_type.lower()

    if section_type_lower == "video":
        return LensVideoSection(
            title=title,
            source=source,
            segments=segments,
        )

    elif section_type_lower == "article":
        return LensArticleSection(
            title=title,
            source=source,
            segments=segments,
        )

    else:
        raise ValueError(f"Unknown Lens section type: {section_type}")


def parse_lens(text: str) -> ParsedLens:
    """
    Parse a Lens Markdown file into a ParsedLens.

    Args:
        text: Full markdown text of the Lens file

    Returns:
        ParsedLens with content_id and sections
    """
    # Strip critic markup first (reject all changes behavior)
    text = strip_critic_markup(text)

    metadata, content = _parse_frontmatter(text)

    # Parse required id field
    content_id = PyUUID(metadata["id"])

    # Parse ### Article: / ### Video: sections
    section_data = _split_lens_sections(content)
    sections = [
        _parse_lens_section(stype, stitle, scontent)
        for stype, stitle, scontent in section_data
    ]

    return ParsedLens(
        content_id=content_id,
        sections=sections,
    )


def parse_lens_file(path: Path | str) -> ParsedLens:
    """
    Parse a Lens Markdown file from disk.

    Args:
        path: Path to the Lens .md file

    Returns:
        ParsedLens with content_id and sections
    """
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    return parse_lens(text)
