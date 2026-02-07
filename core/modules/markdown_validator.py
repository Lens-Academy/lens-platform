# core/modules/markdown_validator.py
"""
Validate module and course Markdown files against the format specification.

This module provides strict validation for content quality control,
separate from the permissive parser that tries to make things work.

Format specification: docs/plans/2026-01-18-lesson-markdown-format-design.md

Usage:
    python -m core.modules.markdown_validator path/to/modules/

Or import directly:
    from core.modules.markdown_validator import validate_lesson, validate_lesson_file
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


def _strip_critic_markup(text: str) -> str:
    """
    Strip critic markup from text using "reject all changes" behavior.

    Critic markup types:
    - {>>comment<<}     → remove entirely
    - {++addition++}    → remove entirely (reject the addition)
    - {--deletion--}    → keep inner content (reject the deletion)
    - {~~old~>new~~}    → keep old, discard new (reject the substitution)
    - {==highlight==}   → keep inner content, remove markers
    """
    text = re.sub(r"\{>>.*?<<\}", "", text, flags=re.DOTALL)
    text = re.sub(r"\{\+\+.*?\+\+\}", "", text, flags=re.DOTALL)
    text = re.sub(r"\{--(.*?)--\}", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\{~~(.*?)~>.*?~~\}", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\{==(.*?)==\}", r"\1", text, flags=re.DOTALL)
    return text


def _check_no_setext_headers(text: str, fm_end: int | None) -> list[ValidationError]:
    """Detect Setext-style headers and return errors.

    Setext H1: a non-blank line followed by a line of ===
    Setext H2: a non-blank line followed by a line of ---

    Skips frontmatter lines. Distinguishes --- thematic breaks (preceded by
    a blank line) from Setext H2 underlines (preceded by text).
    """
    errors: list[ValidationError] = []
    lines = text.split("\n")
    start = fm_end if fm_end is not None else 0

    for i in range(start, len(lines)):
        line = lines[i]
        stripped = line.strip()

        # Setext H1: line of 3+ '=' chars, previous line is non-blank text
        if re.match(r"^={3,}\s*$", stripped):
            if i > 0 and lines[i - 1].strip():
                errors.append(
                    ValidationError(
                        "Setext-style header (===) is not allowed. "
                        "Use ATX-style: # Header",
                        line=i + 1,
                        context=lines[i - 1].strip(),
                    )
                )

        # Setext H2: line of 3+ '-' chars, previous line is non-blank text
        elif re.match(r"^-{3,}\s*$", stripped):
            if i > 0 and lines[i - 1].strip():
                errors.append(
                    ValidationError(
                        "Setext-style header (---) is not allowed. "
                        "Use ATX-style: ## Header",
                        line=i + 1,
                        context=lines[i - 1].strip(),
                    )
                )

    return errors


# -----------------------------------------------------------------------------
# Wiki-link utilities (shared with markdown_parser.py and path_resolver.py)
# -----------------------------------------------------------------------------

# Regex pattern for wiki-links: [[path]] or ![[path]] (Obsidian embed)
WIKI_LINK_PATTERN = r"!?\[\[([^\]]+)\]\]"


def extract_wiki_link_path(text: str) -> str | None:
    """Extract path from [[wiki-link]] or ![[embed]] syntax.

    Handles Obsidian display name syntax: [[path|display name]] -> path

    Args:
        text: Text that may contain a wiki-link

    Returns:
        The path portion of the wiki-link, or None if no wiki-link found
    """
    match = re.search(WIKI_LINK_PATTERN, text)
    if match:
        path = match.group(1)
        # Strip Obsidian display name (everything after |)
        if "|" in path:
            path = path.split("|", 1)[0]
        return path
    return None


# -----------------------------------------------------------------------------
# Frontmatter parsing (shared with markdown_parser.py)
# -----------------------------------------------------------------------------

# Regex for YAML frontmatter block
FRONTMATTER_PATTERN = r"^---\s*\n(.*?)---\s*\n"


def parse_frontmatter(text: str) -> tuple[dict[str, str], str, int | None, int | None]:
    """Extract YAML frontmatter from markdown text.

    Args:
        text: Full markdown text

    Returns:
        Tuple of (metadata_dict, remaining_content, start_line, end_line).
        If no frontmatter found, returns ({}, original_text, None, None).
    """
    match = re.match(FRONTMATTER_PATTERN, text, re.DOTALL)

    if not match:
        return {}, text, None, None

    frontmatter_text = match.group(1).strip()
    content = text[match.end() :]

    # Line numbers for validation
    start_line = 1
    end_line = frontmatter_text.count("\n") + 3  # Include both --- lines

    # Parse key: value pairs
    metadata = {}
    for line in frontmatter_text.split("\n"):
        line = line.strip()
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip().strip('"').strip("'")

    return metadata, content, start_line, end_line


# -----------------------------------------------------------------------------
# Field parsing (shared with markdown_parser.py)
# -----------------------------------------------------------------------------

# Default pattern for segment headers that stop field parsing
FIELD_STOP_PATTERN_H2 = r"^## \S+(?::\s*.+)?$"
FIELD_STOP_PATTERN_H4 = r"^#### \S+(?::\s*.*)?$"


def parse_fields(
    text: str, stop_pattern: str = FIELD_STOP_PATTERN_H2
) -> dict[str, str]:
    """Parse key:: value fields from text.

    Handles both single-line (key:: value) and multi-line (key:: followed by
    lines until next key::, header, or end) formats.

    Args:
        text: Text containing fields
        stop_pattern: Regex pattern for headers that stop field parsing

    Returns:
        Dictionary of field names to values
    """
    fields = {}
    lines = text.split("\n")
    current_key = None
    current_value_lines: list[str] = []

    for line in lines:
        # Stop at headers matching the stop pattern
        if re.match(stop_pattern, line):
            if current_key is not None:
                fields[current_key] = "\n".join(current_value_lines).strip()
            break

        # Check for new field
        field_match = re.match(r"^(\w+)::\s*(.*)?$", line)

        if field_match:
            # Save previous field if exists
            if current_key is not None:
                fields[current_key] = "\n".join(current_value_lines).strip()

            current_key = field_match.group(1)
            value_on_line = field_match.group(2) or ""

            if value_on_line:
                current_value_lines = [value_on_line]
            else:
                current_value_lines = []
        elif current_key is not None:
            current_value_lines.append(line)

    # Save last field
    if current_key is not None:
        fields[current_key] = "\n".join(current_value_lines).strip()

    return fields


# -----------------------------------------------------------------------------
# Header-based section splitting (shared with markdown_parser.py)
# -----------------------------------------------------------------------------


def split_by_headers(
    text: str, pattern: str, *, include_line_numbers: bool = True
) -> list[tuple[int, tuple[str, ...], str]]:
    """Split text into sections based on header pattern.

    This is a generic utility for splitting markdown by any header level.
    Each match of the pattern starts a new section.

    Args:
        text: Text to split
        pattern: Regex pattern with capture groups for header components.
                 E.g., ``^# (.+?)(?::\\s*(.*))?$`` captures (type, title)
        include_line_numbers: If True, returns (line_num, groups, content).
                              If False, returns (0, groups, content).

    Returns:
        List of (line_number, captured_groups, section_content) tuples.
        line_number is 1-indexed. captured_groups is a tuple of all regex groups.
    """
    sections: list[tuple[int, tuple[str, ...], str]] = []
    current_start: int | None = None
    current_groups: tuple[str, ...] | None = None
    current_lines: list[str] = []

    for i, line in enumerate(text.split("\n"), 1):
        match = re.match(pattern, line)
        if match:
            # Save previous section
            if current_start is not None:
                sections.append(
                    (current_start, current_groups, "\n".join(current_lines))
                )

            current_start = i if include_line_numbers else 0
            current_groups = match.groups()
            current_lines = []
        elif current_start is not None:
            current_lines.append(line)

    # Save last section
    if current_start is not None:
        sections.append((current_start, current_groups, "\n".join(current_lines)))

    return sections


@dataclass
class ValidationError:
    """A single validation error."""

    message: str
    line: int | None = None  # Line number if applicable
    context: str | None = None  # Additional context (section/segment name)

    def __str__(self) -> str:
        parts = []
        if self.line is not None:
            parts.append(f"line {self.line}")
        if self.context:
            parts.append(self.context)
        location = ", ".join(parts)
        if location:
            return f"{location}: {self.message}"
        return self.message


@dataclass
class ValidationResult:
    """Result of validating a file."""

    path: Path | None = None
    errors: list[ValidationError] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def __str__(self) -> str:
        if self.is_valid:
            return f"{self.path}: OK" if self.path else "OK"
        prefix = f"{self.path}: " if self.path else ""
        error_strs = [f"  - {e}" for e in self.errors]
        return f"{prefix}{len(self.errors)} error(s)\n" + "\n".join(error_strs)


# Valid types for H1 sections in v2 modules
# Note: video, article, text, chat are OLD format (v1) - they should only appear in Lens files
VALID_SECTION_TYPES = {
    "page",
    "learning outcome",
    "uncategorized",
}

# Old v1 section types - disallowed at H1 level in modules
OLD_SECTION_TYPES = {
    "video": "Use Lens files instead (reference via # Learning Outcome: or # Uncategorized: with ## Lens:)",
    "article": "Use Lens files instead (reference via # Learning Outcome: or # Uncategorized: with ## Lens:)",
    "text": "Use # Page: with ## Text segment instead",
    "chat": "Use # Page: with ## Chat segment instead",
}

VALID_SEGMENT_TYPES = {"text", "chat", "video-excerpt", "article-excerpt", "lens"}

# Sections that contain child segments
CONTAINER_SECTION_TYPES = {"page", "uncategorized"}

# Sections that require a title after the colon
TITLE_REQUIRED_SECTION_TYPES = {"page"}

# Sections that must NOT have a title (just "# Type:")
TITLE_FORBIDDEN_SECTION_TYPES = {"learning outcome", "uncategorized"}

# Allowed fields per section type (v2 module sections only)
ALLOWED_SECTION_FIELDS = {
    "page": {"id", "optional"},
    "learning outcome": {"source", "optional"},
    "uncategorized": set(),  # No fields directly, only Lens subsections
}

# Allowed fields per segment type
ALLOWED_SEGMENT_FIELDS = {
    "text": {"content"},
    "chat": {
        "instructions",
        "hidePreviousContentFromUser",
        "hidePreviousContentFromTutor",
    },
    "video-excerpt": {"from", "to"},
    "article-excerpt": {"from", "to"},
    "lens": {"source", "optional"},
}


def _find_line_number(text: str, pattern: str, occurrence: int = 0) -> int | None:
    """Find line number (1-indexed) of a pattern occurrence."""
    lines = text.split("\n")
    found = 0
    for i, line in enumerate(lines, 1):
        if pattern in line:
            if found == occurrence:
                return i
            found += 1
    return None


def _parse_frontmatter_for_validation(
    text: str,
) -> tuple[dict[str, str], int | None, int | None]:
    """Extract frontmatter and return (metadata, start_line, end_line)."""
    metadata, _, start_line, end_line = parse_frontmatter(text)
    return metadata, start_line, end_line


def _parse_fields_for_validation(text: str) -> dict[str, str]:
    """Parse key:: value fields (stops at ## headers)."""
    return parse_fields(text, FIELD_STOP_PATTERN_H2)


def validate_module(text: str) -> list[ValidationError]:
    """
    Validate a module Markdown file against the format specification.

    Args:
        text: Full markdown text of the module file

    Returns:
        List of ValidationError objects (empty if valid)
    """
    # Strip critic markup before validation
    text = _strip_critic_markup(text)

    errors: list[ValidationError] = []

    # 1. Validate frontmatter
    metadata, fm_start, fm_end = _parse_frontmatter_for_validation(text)
    errors.extend(_check_no_setext_headers(text, fm_end))

    if fm_start is None:
        errors.append(ValidationError("Missing frontmatter (---)", line=1))
    else:
        if not metadata.get("slug"):
            errors.append(
                ValidationError("Missing required field: slug", context="frontmatter")
            )
        if not metadata.get("title"):
            errors.append(
                ValidationError("Missing required field: title", context="frontmatter")
            )

    # 2. Split and validate sections
    # Pattern matches "# Type:" or "# Type: Title" or "# Multi Word Type:" etc.
    # Group 1: section type (everything before the colon)
    # Group 2: optional title (everything after the colon, may be empty)
    section_pattern = r"^# ([^:]+):\s*(.*)$"
    lines = text.split("\n")

    # Find all section headers
    sections: list[tuple[int, str, str, str]] = []  # (line_num, type, title, content)
    current_section_start = None
    current_section_type = None
    current_section_title = None
    current_section_lines: list[str] = []

    for i, line in enumerate(lines, 1):
        match = re.match(section_pattern, line)
        if match:
            # Save previous section
            if current_section_start is not None:
                sections.append(
                    (
                        current_section_start,
                        current_section_type,
                        current_section_title,
                        "\n".join(current_section_lines),
                    )
                )

            current_section_start = i
            current_section_type = match.group(1).strip().lower()
            current_section_title = match.group(2).strip() if match.group(2) else ""
            current_section_lines = []
        elif current_section_start is not None:
            current_section_lines.append(line)

    # Save last section
    if current_section_start is not None:
        sections.append(
            (
                current_section_start,
                current_section_type,
                current_section_title,
                "\n".join(current_section_lines),
            )
        )

    # Validate each section
    for line_num, section_type, section_title, section_content in sections:
        # Format context string based on whether there's a title
        if section_title:
            context = f"# {section_type.title()}: {section_title}"
        else:
            context = f"# {section_type.title()}:"

        # Check if this is an old v1 section type (disallowed in modules)
        if section_type in OLD_SECTION_TYPES:
            suggestion = OLD_SECTION_TYPES[section_type]
            errors.append(
                ValidationError(
                    f"Section type '# {section_type.title()}:' is not allowed in v2 modules. {suggestion}",
                    line=line_num,
                    context=context,
                )
            )
            continue

        # Check section type is valid
        if section_type not in VALID_SECTION_TYPES:
            errors.append(
                ValidationError(
                    f"Invalid section type: {section_type}",
                    line=line_num,
                    context=context,
                )
            )
            continue

        # Validate title requirements
        if section_type in TITLE_REQUIRED_SECTION_TYPES and not section_title:
            errors.append(
                ValidationError(
                    f"Missing title: {section_type.title()} sections require a title after the colon",
                    line=line_num,
                    context=context,
                )
            )
        elif section_type in TITLE_FORBIDDEN_SECTION_TYPES and section_title:
            errors.append(
                ValidationError(
                    f"Unexpected title: {section_type.title()} sections should not have a title",
                    line=line_num,
                    context=context,
                )
            )

        fields = _parse_fields_for_validation(section_content)
        allowed_fields = ALLOWED_SECTION_FIELDS.get(section_type, set())

        # Check for unknown fields
        for field_name in fields:
            if field_name not in allowed_fields:
                errors.append(
                    ValidationError(
                        f"Unknown field: {field_name}::",
                        line=line_num,
                        context=context,
                    )
                )

        # Validate required fields per section type
        if section_type == "page":
            if not fields.get("id"):
                errors.append(
                    ValidationError(
                        "Missing required field: id::",
                        line=line_num,
                        context=context,
                    )
                )
            # Validate segments (Page can contain Text, Chat, etc.)
            segment_errors = _validate_segments(
                section_content, line_num, context, "page"
            )
            errors.extend(segment_errors)

        elif section_type == "learning outcome":
            if not fields.get("source"):
                errors.append(
                    ValidationError(
                        "Missing required field: source::",
                        line=line_num,
                        context=context,
                    )
                )

        elif section_type == "uncategorized":
            # Validate Lens subsections
            segment_errors = _validate_uncategorized_section(
                section_content, line_num, context
            )
            errors.extend(segment_errors)

    return errors


# Backwards compatibility alias
validate_lesson = validate_module


def _validate_uncategorized_section(
    section_content: str, section_line: int, section_context: str
) -> list[ValidationError]:
    """Validate an Uncategorized section - must contain at least one Lens subsection."""
    errors: list[ValidationError] = []

    # Find all Lens subsections
    lens_pattern = r"^## Lens:\s*$"
    lines = section_content.split("\n")

    lenses: list[tuple[int, str]] = []  # (relative_line, content)
    current_lens_start = None
    current_lens_lines: list[str] = []

    for i, line in enumerate(lines, 1):
        match = re.match(lens_pattern, line)
        if match:
            if current_lens_start is not None:
                lenses.append((current_lens_start, "\n".join(current_lens_lines)))
            current_lens_start = i
            current_lens_lines = []
        elif current_lens_start is not None:
            current_lens_lines.append(line)

    if current_lens_start is not None:
        lenses.append((current_lens_start, "\n".join(current_lens_lines)))

    # Check that at least one Lens exists
    if not lenses:
        errors.append(
            ValidationError(
                "Uncategorized section must contain at least one ## Lens: subsection",
                line=section_line,
                context=section_context,
            )
        )
        return errors

    # Validate each Lens
    for relative_line, lens_content in lenses:
        approx_line = section_line + relative_line
        context = f"{section_context} > ## Lens:"

        fields = _parse_fields_for_validation(lens_content)
        allowed_fields = ALLOWED_SEGMENT_FIELDS.get("lens", set())

        # Check for unknown fields
        for field_name in fields:
            if field_name not in allowed_fields:
                errors.append(
                    ValidationError(
                        f"Unknown field: {field_name}::",
                        line=approx_line,
                        context=context,
                    )
                )

        # Check required field
        if not fields.get("source"):
            errors.append(
                ValidationError(
                    "Missing required field: source::",
                    line=approx_line,
                    context=context,
                )
            )

    return errors


def _validate_segments(
    section_content: str, section_line: int, section_context: str, section_type: str
) -> list[ValidationError]:
    """Validate segments within a Video or Article section."""
    errors: list[ValidationError] = []

    # Find all segment headers - allow optional title after colon (## Type or ## Type: Title)
    segment_pattern = r"^## (\S+)(?::\s*.+)?$"
    lines = section_content.split("\n")

    segments: list[tuple[int, str, str]] = []  # (relative_line, type, content)
    current_segment_start = None
    current_segment_type = None
    current_segment_lines: list[str] = []

    for i, line in enumerate(lines, 1):
        match = re.match(segment_pattern, line)
        if match:
            if current_segment_start is not None:
                segments.append(
                    (
                        current_segment_start,
                        current_segment_type,
                        "\n".join(current_segment_lines),
                    )
                )

            current_segment_start = i
            current_segment_type = match.group(1).lower()
            current_segment_lines = []
        elif current_segment_start is not None:
            current_segment_lines.append(line)

    if current_segment_start is not None:
        segments.append(
            (
                current_segment_start,
                current_segment_type,
                "\n".join(current_segment_lines),
            )
        )

    # Validate each segment
    for relative_line, segment_type, segment_content in segments:
        approx_line = section_line + relative_line
        context = f"{section_context} > ## {segment_type.title()}"

        if segment_type not in VALID_SEGMENT_TYPES:
            errors.append(
                ValidationError(
                    f"Invalid segment type: {segment_type}",
                    line=approx_line,
                    context=context,
                )
            )
            continue

        # Check segment is valid for this section type
        if section_type == "video" and segment_type == "article-excerpt":
            errors.append(
                ValidationError(
                    "Article-excerpt segment not allowed in Video section",
                    line=approx_line,
                    context=context,
                )
            )
        elif section_type == "article" and segment_type == "video-excerpt":
            errors.append(
                ValidationError(
                    "Video-excerpt segment not allowed in Article section",
                    line=approx_line,
                    context=context,
                )
            )
        elif section_type == "page" and segment_type in (
            "video-excerpt",
            "article-excerpt",
        ):
            errors.append(
                ValidationError(
                    f"{segment_type.title()} segment not allowed in Page section",
                    line=approx_line,
                    context=context,
                )
            )

        fields = _parse_fields_for_validation(segment_content)
        allowed_fields = ALLOWED_SEGMENT_FIELDS.get(segment_type, set())

        # Check for unknown fields
        for field_name in fields:
            if field_name not in allowed_fields:
                errors.append(
                    ValidationError(
                        f"Unknown field: {field_name}::",
                        line=approx_line,
                        context=context,
                    )
                )

        # Validate required fields per segment type
        if segment_type == "text":
            if not fields.get("content"):
                errors.append(
                    ValidationError(
                        "Missing required field: content::",
                        line=approx_line,
                        context=context,
                    )
                )

        elif segment_type == "chat":
            if not fields.get("instructions"):
                errors.append(
                    ValidationError(
                        "Missing required field: instructions::",
                        line=approx_line,
                        context=context,
                    )
                )

        elif segment_type == "video-excerpt":
            # from:: and to:: are optional - omitting means "full range"
            pass

        elif segment_type == "article-excerpt":
            # from:: and to:: are optional - omitting means "full range"
            pass

    return errors


def _extract_wiki_links(text: str) -> list[tuple[int, str]]:
    """Extract all wiki-links from text with their line numbers.

    Handles both [[link]] and ![[embed]] (Obsidian embed) syntax.
    Handles Obsidian display name syntax: [[path|display name]] -> path
    Only returns wiki-links that look like file paths (contain '/' or '..').
    Ignores things like Wikipedia citation links [[1]], [[2]], etc.

    Returns list of (line_number, link_path) tuples.
    """
    links = []
    for i, line in enumerate(text.split("\n"), 1):
        for match in re.finditer(WIKI_LINK_PATTERN, line):
            link = match.group(1)
            # Strip Obsidian display name (everything after |)
            if "|" in link:
                link = link.split("|", 1)[0]
            # Only validate links that look like file paths
            if "/" in link or link.startswith(".."):
                links.append((i, link))
    return links


def _validate_wiki_links(text: str, file_path: Path) -> list[ValidationError]:
    """Validate that wiki-links point to existing files.

    Wiki-links must use relative paths from the file's location (starting with ../).
    Links without .md extension get .md appended.
    """
    errors = []
    file_dir = file_path.parent

    for line_num, link_path in _extract_wiki_links(text):
        # Check if link uses relative path syntax
        if not link_path.startswith("../"):
            # Check if adding ../ would make it valid
            corrected_path = f"../{link_path}"
            # Add .md if not already present (check string, not suffix - handles dots in filenames)
            if not corrected_path.endswith(".md"):
                corrected_path_with_md = corrected_path + ".md"
            else:
                corrected_path_with_md = corrected_path
            corrected_target = (file_dir / corrected_path_with_md).resolve()

            if corrected_target.exists():
                errors.append(
                    ValidationError(
                        f"Wiki-link missing '../' prefix: [[{link_path}]] should be [[{corrected_path}]]",
                        line=line_num,
                    )
                )
            else:
                errors.append(
                    ValidationError(
                        f"Wiki-link missing '../' prefix: [[{link_path}]] (and file not found even with '../')",
                        line=line_num,
                    )
                )
            continue

        # Resolve relative path from the file's directory
        # Add .md if not already present (check string, not suffix - handles dots in filenames like "A.I.")
        if not link_path.endswith(".md"):
            link_path_with_md = link_path + ".md"
        else:
            link_path_with_md = link_path
        target = (file_dir / link_path_with_md).resolve()

        if not target.exists():
            errors.append(
                ValidationError(
                    f"Wiki-link target not found: [[{link_path}]] (file does not exist: {target})",
                    line=line_num,
                )
            )

    return errors


def validate_lesson_file(path: Path | str) -> ValidationResult:
    """
    Validate a lesson Markdown file from disk.

    Args:
        path: Path to the lesson .md file

    Returns:
        ValidationResult with path and any errors
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ValidationResult(
            path=path, errors=[ValidationError(f"File not found: {path}")]
        )
    except Exception as e:
        return ValidationResult(
            path=path, errors=[ValidationError(f"Error reading file: {e}")]
        )

    errors = validate_lesson(text)
    errors.extend(_validate_wiki_links(text, path))

    return ValidationResult(path=path, errors=errors)


def validate_course(text: str) -> list[ValidationError]:
    """
    Validate a course Markdown file against the format specification.

    Args:
        text: Full markdown text of the course file

    Returns:
        List of ValidationError objects (empty if valid)
    """
    errors: list[ValidationError] = []

    # 1. Validate frontmatter
    metadata, fm_start, fm_end = _parse_frontmatter_for_validation(text)
    errors.extend(_check_no_setext_headers(text, fm_end))

    if fm_start is None:
        errors.append(ValidationError("Missing frontmatter (---)", line=1))
    else:
        if not metadata.get("slug"):
            errors.append(
                ValidationError("Missing required field: slug", context="frontmatter")
            )
        if not metadata.get("title"):
            errors.append(
                ValidationError("Missing required field: title", context="frontmatter")
            )

    # 2. Validate progression items
    lesson_pattern = r"^# Lesson:\s*(.+)$"
    meeting_pattern = r"^# Meeting:\s*(\d+)$"
    wiki_link_pattern = r"\[\[([^\]]+)\]\]"

    lines = text.split("\n")
    for i, line in enumerate(lines, 1):
        line = line.strip()

        lesson_match = re.match(lesson_pattern, line)
        meeting_match = re.match(meeting_pattern, line)

        if lesson_match:
            lesson_ref = lesson_match.group(1)
            # Must use wiki-link syntax
            if not re.search(wiki_link_pattern, lesson_ref):
                errors.append(
                    ValidationError(
                        "Lesson reference must use [[wiki-link]] syntax",
                        line=i,
                        context=f"# Lesson: {lesson_ref}",
                    )
                )

        # Check for malformed headers that look like they're trying to be lessons/meetings
        if line.startswith("# ") and not lesson_match and not meeting_match:
            # Could be an invalid header
            if "lesson" in line.lower() or "meeting" in line.lower():
                errors.append(
                    ValidationError(
                        "Malformed header - use '# Lesson: [[path]]' or '# Meeting: number'",
                        line=i,
                    )
                )

    return errors


def validate_course_file(path: Path | str) -> ValidationResult:
    """
    Validate a course Markdown file from disk.

    Args:
        path: Path to the course .md file

    Returns:
        ValidationResult with path and any errors
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ValidationResult(
            path=path, errors=[ValidationError(f"File not found: {path}")]
        )
    except Exception as e:
        return ValidationResult(
            path=path, errors=[ValidationError(f"Error reading file: {e}")]
        )

    errors = validate_course(text)
    errors.extend(_validate_wiki_links(text, path))

    return ValidationResult(path=path, errors=errors)


def validate_learning_outcome(text: str) -> list[ValidationError]:
    """
    Validate a Learning Outcome Markdown file against the format specification.

    Learning Outcome files have:
    - Frontmatter with required `id` field (UUID), optional `discussion` field
    - Optional `## Test:` section (0 or 1) with optional `source::` field (can be empty/TBD)
    - Required `## Lens:` sections (1 or many) with required `source::` field, optional `optional::` field

    Args:
        text: Full markdown text of the Learning Outcome file

    Returns:
        List of ValidationError objects (empty if valid)
    """
    # Strip critic markup before validation
    text = _strip_critic_markup(text)

    errors: list[ValidationError] = []

    # 1. Validate frontmatter
    metadata, fm_start, fm_end = _parse_frontmatter_for_validation(text)
    errors.extend(_check_no_setext_headers(text, fm_end))

    if fm_start is None:
        errors.append(ValidationError("Missing frontmatter (---)", line=1))
    else:
        if not metadata.get("id"):
            errors.append(
                ValidationError("Missing required field: id", context="frontmatter")
            )

    # 2. Parse and validate sections (## Test: and ## Lens:)
    # Pattern matches "## Test:" or "## Lens:" (no title after colon)
    section_pattern = r"^## (Test|Lens):\s*$"
    lines = text.split("\n")

    sections: list[tuple[int, str, str]] = []  # (line_num, type, content)
    current_section_start = None
    current_section_type = None
    current_section_lines: list[str] = []

    for i, line in enumerate(lines, 1):
        match = re.match(section_pattern, line)
        if match:
            # Save previous section
            if current_section_start is not None:
                sections.append(
                    (
                        current_section_start,
                        current_section_type,
                        "\n".join(current_section_lines),
                    )
                )

            current_section_start = i
            current_section_type = match.group(1).lower()
            current_section_lines = []
        elif current_section_start is not None:
            current_section_lines.append(line)

    # Save last section
    if current_section_start is not None:
        sections.append(
            (
                current_section_start,
                current_section_type,
                "\n".join(current_section_lines),
            )
        )

    # 3. Validate section counts
    test_sections = [s for s in sections if s[1] == "test"]
    lens_sections = [s for s in sections if s[1] == "lens"]

    if len(test_sections) > 1:
        errors.append(
            ValidationError(
                "Multiple ## Test: sections found (only 0 or 1 allowed)",
                line=test_sections[1][0],
            )
        )

    if len(lens_sections) == 0:
        errors.append(
            ValidationError("Missing required ## Lens: section (at least one required)")
        )

    # 4. Validate each section's fields
    for line_num, section_type, section_content in sections:
        context = f"## {section_type.title()}:"
        fields = _parse_fields_for_validation(section_content)

        if section_type == "test":
            # Test section - source:: is optional (can be empty/TBD for now)
            pass

        elif section_type == "lens":
            # Lens section requires source::, allows optional::
            if not fields.get("source"):
                errors.append(
                    ValidationError(
                        "Missing required field: source::",
                        line=line_num,
                        context=context,
                    )
                )

    return errors


def validate_lens(text: str) -> list[ValidationError]:
    """
    Validate a Lens Markdown file against the format specification.

    Lens files have:
    - Frontmatter with required `id` field (no slug or title - title comes from
      the Article/Video section header)
    - One or more `### Article: Title` or `### Video: Title` sections
    - Each section must have a `source::` field
    - Each section must have at least one appropriate excerpt segment
      (Article-excerpt for Article, Video-excerpt for Video)
    - Other segments (#### Text, #### Chat) are optional
    - Segments can have `optional:: true` field

    Args:
        text: Full markdown text of the Lens file

    Returns:
        List of ValidationError objects (empty if valid)
    """
    # Strip critic markup before validation
    text = _strip_critic_markup(text)

    errors: list[ValidationError] = []

    # 1. Validate frontmatter
    metadata, fm_start, fm_end = _parse_frontmatter_for_validation(text)
    errors.extend(_check_no_setext_headers(text, fm_end))

    if fm_start is None:
        errors.append(ValidationError("Missing frontmatter (---)", line=1))
    else:
        if not metadata.get("id"):
            errors.append(
                ValidationError("Missing required field: id", context="frontmatter")
            )
        # Title is prohibited in Lens frontmatter - it comes from the Article/Video header
        if "title" in metadata:
            errors.append(
                ValidationError(
                    "Field 'title' is not allowed in Lens frontmatter (title comes from ### Article/Video header)",
                    context="frontmatter",
                )
            )

    # 2. Parse sections (### Article: or ### Video:)
    # Lens files use ### for sections (h3) and #### for segments (h4)
    section_pattern = r"^### (Article|Video):\s*(.+)$"
    lines = text.split("\n")

    sections: list[tuple[int, str, str, str]] = []  # (line_num, type, title, content)
    current_section_start = None
    current_section_type = None
    current_section_title = None
    current_section_lines: list[str] = []

    for i, line in enumerate(lines, 1):
        match = re.match(section_pattern, line)
        if match:
            # Save previous section
            if current_section_start is not None:
                sections.append(
                    (
                        current_section_start,
                        current_section_type,
                        current_section_title,
                        "\n".join(current_section_lines),
                    )
                )

            current_section_start = i
            current_section_type = match.group(1).lower()
            current_section_title = match.group(2).strip()
            current_section_lines = []
        elif current_section_start is not None:
            current_section_lines.append(line)

    # Save last section
    if current_section_start is not None:
        sections.append(
            (
                current_section_start,
                current_section_type,
                current_section_title,
                "\n".join(current_section_lines),
            )
        )

    # 3. Validate at least one section exists
    if len(sections) == 0:
        errors.append(
            ValidationError(
                "Missing required ### Article: or ### Video: section (at least one required)"
            )
        )
        return errors

    # 4. Validate each section
    for line_num, section_type, section_title, section_content in sections:
        context = f"### {section_type.title()}: {section_title}"

        # Parse fields from section content
        fields = _parse_lens_section_fields(section_content)

        # Check required source field
        if not fields.get("source"):
            errors.append(
                ValidationError(
                    "Missing required field: source::",
                    line=line_num,
                    context=context,
                )
            )

        # Validate segments within section
        segment_errors = _validate_lens_segments(
            section_content, line_num, context, section_type
        )
        errors.extend(segment_errors)

    return errors


def validate_learning_outcome_file(path: Path | str) -> ValidationResult:
    """
    Validate a Learning Outcome Markdown file from disk.

    Args:
        path: Path to the Learning Outcome .md file

    Returns:
        ValidationResult with path and any errors
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ValidationResult(
            path=path, errors=[ValidationError(f"File not found: {path}")]
        )
    except Exception as e:
        return ValidationResult(
            path=path, errors=[ValidationError(f"Error reading file: {e}")]
        )

    errors = validate_learning_outcome(text)
    errors.extend(_validate_wiki_links(text, path))

    return ValidationResult(path=path, errors=errors)


def validate_lens_file(path: Path | str) -> ValidationResult:
    """
    Validate a Lens Markdown file from disk.

    Args:
        path: Path to the Lens .md file

    Returns:
        ValidationResult with path and any errors
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ValidationResult(
            path=path, errors=[ValidationError(f"File not found: {path}")]
        )
    except Exception as e:
        return ValidationResult(
            path=path, errors=[ValidationError(f"Error reading file: {e}")]
        )

    errors = validate_lens(text)
    errors.extend(_validate_wiki_links(text, path))

    return ValidationResult(path=path, errors=errors)


def _parse_lens_section_fields(text: str) -> dict[str, str]:
    """Parse key:: value fields from a Lens section (stop at #### headers)."""
    return parse_fields(text, FIELD_STOP_PATTERN_H4)


def _validate_lens_segments(
    section_content: str, section_line: int, section_context: str, section_type: str
) -> list[ValidationError]:
    """Validate segments within a Lens Article/Video section.

    Validates:
    - At least one excerpt segment of the appropriate type
    - No mismatched excerpt types (Article-excerpt in Video, etc.)
    """
    errors: list[ValidationError] = []

    # Find all segment headers (#### Type or #### Type: Title)
    segment_pattern = r"^#### (\S+)(?::\s*.*)?$"
    lines = section_content.split("\n")

    segments: list[tuple[int, str, str]] = []  # (relative_line, type, content)
    current_segment_start = None
    current_segment_type = None
    current_segment_lines: list[str] = []

    for i, line in enumerate(lines, 1):
        match = re.match(segment_pattern, line)
        if match:
            if current_segment_start is not None:
                segments.append(
                    (
                        current_segment_start,
                        current_segment_type,
                        "\n".join(current_segment_lines),
                    )
                )

            current_segment_start = i
            current_segment_type = match.group(1).lower()
            current_segment_lines = []
        elif current_segment_start is not None:
            current_segment_lines.append(line)

    if current_segment_start is not None:
        segments.append(
            (
                current_segment_start,
                current_segment_type,
                "\n".join(current_segment_lines),
            )
        )

    # Check for at least one appropriate excerpt
    expected_excerpt = f"{section_type}-excerpt"
    has_excerpt = any(seg_type == expected_excerpt for _, seg_type, _ in segments)

    if not has_excerpt:
        errors.append(
            ValidationError(
                f"Missing required #### {expected_excerpt.title()} segment",
                line=section_line,
                context=section_context,
            )
        )

    # Validate each segment
    for relative_line, segment_type, segment_content in segments:
        approx_line = section_line + relative_line
        context = f"{section_context} > #### {segment_type.title()}"

        # Check for mismatched excerpt types
        if section_type == "video" and segment_type == "article-excerpt":
            errors.append(
                ValidationError(
                    "Article-excerpt segment not allowed in Video section",
                    line=approx_line,
                    context=context,
                )
            )
        elif section_type == "article" and segment_type == "video-excerpt":
            errors.append(
                ValidationError(
                    "Video-excerpt segment not allowed in Article section",
                    line=approx_line,
                    context=context,
                )
            )

    return errors


def _is_course_file(path: Path) -> bool:
    """Check if a file is a course file based on its location."""
    # Check if any parent directory is named "courses"
    return "courses" in path.parts


def _detect_file_type(path: Path) -> str:
    """
    Detect file type based on directory location.

    Args:
        path: Path to the markdown file

    Returns:
        One of: "module", "learning_outcome", "lens", "article",
                "video_transcript", "course", "unknown"
    """
    parts = path.parts

    # Check each directory name in the path
    for part in parts:
        part_lower = part.lower()

        if part_lower == "courses":
            return "course"
        elif part_lower in ("learning outcomes", "learning_outcomes"):
            return "learning_outcome"
        elif part_lower == "lenses":
            return "lens"
        elif part_lower == "articles":
            return "article"
        elif part_lower == "video_transcripts":
            return "video_transcript"
        elif part_lower == "modules":
            return "module"

    return "unknown"


# Files to skip during validation (case-insensitive filename matching)
SKIP_FILES = {"readme.md", "obsidian setup.md"}

# Directory patterns to skip (case-insensitive, checks if any part contains these)
SKIP_DIRECTORY_PATTERNS = {"wip", "work in progress", "draft", "drafts"}


def _should_skip_file(path: Path) -> bool:
    """Check if a file should be skipped during validation."""
    # Skip specific files by name
    if path.name.lower() in SKIP_FILES:
        return True

    # Skip files in WIP/draft directories
    path_parts_lower = [p.lower() for p in path.parts]
    for pattern in SKIP_DIRECTORY_PATTERNS:
        if any(pattern in part for part in path_parts_lower):
            return True

    return False


def validate_directory(
    directory: Path | str,
    lesson_glob: str = "**/*.md",
    course_glob: str = "courses/**/*.md",
) -> list[ValidationResult]:
    """
    Validate all Markdown files in a directory based on their location.

    Files are routed to appropriate validators based on their directory:
    - modules/ -> validate as modules
    - Learning Outcomes/ or learning_outcomes/ -> validate as learning outcomes
    - Lenses/ or lenses/ -> validate as lenses
    - articles/ or video_transcripts/ -> skip validation (return empty errors)
    - courses/ -> validate as courses

    Skipped automatically:
    - README.md, Obsidian Setup.md
    - Files in WIP, draft, or work-in-progress directories

    Args:
        directory: Root directory to search
        lesson_glob: Glob pattern for markdown files (default: **/*.md)
        course_glob: Glob pattern for course files (deprecated, ignored)

    Returns:
        List of ValidationResult for each file
    """
    directory = Path(directory)
    results = []

    # Find all markdown files and route based on detected file type
    for md_path in sorted(directory.glob(lesson_glob)):
        # Skip specific files and WIP directories
        if _should_skip_file(md_path):
            continue

        file_type = _detect_file_type(md_path)

        if file_type == "course":
            results.append(validate_course_file(md_path))
        elif file_type == "learning_outcome":
            results.append(validate_learning_outcome_file(md_path))
        elif file_type == "lens":
            results.append(validate_lens_file(md_path))
        elif file_type in ("article", "video_transcript"):
            # Skip validation for articles and video transcripts
            results.append(ValidationResult(path=md_path, errors=[]))
        elif file_type == "module":
            results.append(validate_lesson_file(md_path))
        else:
            # Unknown file type - validate as module (backwards compatibility)
            results.append(validate_lesson_file(md_path))

    return results


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Validate lesson and course Markdown files",
        prog="python -m core.lessons.markdown_validator",
    )
    parser.add_argument(
        "paths",
        nargs="+",
        type=Path,
        help="Files or directories to validate",
    )
    parser.add_argument(
        "--lesson-glob",
        default="**/*.md",
        help="Glob pattern for lesson files (default: **/*.md)",
    )
    parser.add_argument(
        "--course-glob",
        default="courses/**/*.md",
        help="Glob pattern for course files (default: courses/**/*.md)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Show all files, including valid ones",
    )

    args = parser.parse_args(argv)

    all_results: list[ValidationResult] = []

    for path in args.paths:
        if path.is_dir():
            results = validate_directory(
                path,
                lesson_glob=args.lesson_glob,
                course_glob=args.course_glob,
            )
            all_results.extend(results)
        elif path.is_file():
            # Determine if course or lesson by location
            if _is_course_file(path):
                all_results.append(validate_course_file(path))
            else:
                all_results.append(validate_lesson_file(path))
        else:
            all_results.append(
                ValidationResult(
                    path=path, errors=[ValidationError(f"Path not found: {path}")]
                )
            )

    # Print results
    invalid_count = 0
    for result in all_results:
        if not result.is_valid:
            print(result)
            invalid_count += 1
        elif args.verbose:
            print(result)

    # Summary
    total = len(all_results)
    valid = total - invalid_count
    print(f"\nValidated {total} file(s): {valid} valid, {invalid_count} invalid")

    return 1 if invalid_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
