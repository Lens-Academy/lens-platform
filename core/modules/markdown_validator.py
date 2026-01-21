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


# Valid types
VALID_SECTION_TYPES = {"video", "article", "text", "chat"}
VALID_SEGMENT_TYPES = {"text", "chat", "video-excerpt", "article-excerpt"}

# Sections that contain child segments
CONTAINER_SECTION_TYPES = {"video", "article"}

# Allowed fields per section type
ALLOWED_SECTION_FIELDS = {
    "video": {"source", "optional"},
    "article": {"source", "optional"},
    "text": {"content"},
    "chat": {"instructions", "showUserPreviousContent", "showTutorPreviousContent"},
}

# Allowed fields per segment type
ALLOWED_SEGMENT_FIELDS = {
    "text": {"content"},
    "chat": {"instructions", "showUserPreviousContent", "showTutorPreviousContent"},
    "video-excerpt": {"from", "to"},
    "article-excerpt": {"from", "to"},
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
    """
    Extract frontmatter and return (metadata, start_line, end_line).

    Returns empty dict and None lines if no frontmatter found.
    """
    pattern = r"^---\s*\n(.*?)\n---\s*\n"
    match = re.match(pattern, text, re.DOTALL)

    if not match:
        return {}, None, None

    frontmatter_text = match.group(1)

    # Count lines to find positions
    start_line = 1  # First ---
    end_line = frontmatter_text.count("\n") + 3  # Include both --- lines

    metadata = {}
    for line in frontmatter_text.split("\n"):
        line = line.strip()
        if ":" in line:
            key, value = line.split(":", 1)
            metadata[key.strip()] = value.strip().strip('"').strip("'")

    return metadata, start_line, end_line


def _parse_fields_for_validation(text: str) -> dict[str, str]:
    """Parse key:: value fields (same logic as parser, for validation)."""
    fields = {}
    lines = text.split("\n")
    current_key = None
    current_value_lines = []

    for line in lines:
        # Stop at segment headers - don't parse fields inside segments
        # Segment headers can have optional titles: ## Type or ## Type: Title
        if re.match(r"^## \S+(?::\s*.+)?$", line):
            if current_key is not None:
                fields[current_key] = "\n".join(current_value_lines).strip()
            break

        field_match = re.match(r"^(\w+)::\s*(.*)?$", line)

        if field_match:
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

    if current_key is not None:
        fields[current_key] = "\n".join(current_value_lines).strip()

    return fields


def validate_lesson(text: str) -> list[ValidationError]:
    """
    Validate a lesson Markdown file against the format specification.

    Args:
        text: Full markdown text of the lesson file

    Returns:
        List of ValidationError objects (empty if valid)
    """
    errors: list[ValidationError] = []

    # 1. Validate frontmatter
    metadata, fm_start, fm_end = _parse_frontmatter_for_validation(text)

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
    section_pattern = r"^# (\w+):\s*(.+)$"
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

    # Validate each section
    for line_num, section_type, section_title, section_content in sections:
        context = f"# {section_type.title()}: {section_title}"

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
        if section_type == "video":
            if not fields.get("source"):
                errors.append(
                    ValidationError(
                        "Missing required field: source::",
                        line=line_num,
                        context=context,
                    )
                )
            # Validate segments
            segment_errors = _validate_segments(
                section_content, line_num, context, "video"
            )
            errors.extend(segment_errors)

        elif section_type == "article":
            if not fields.get("source"):
                errors.append(
                    ValidationError(
                        "Missing required field: source::",
                        line=line_num,
                        context=context,
                    )
                )
            # Validate segments
            segment_errors = _validate_segments(
                section_content, line_num, context, "article"
            )
            errors.extend(segment_errors)

        elif section_type == "text":
            if not fields.get("content"):
                errors.append(
                    ValidationError(
                        "Missing required field: content::",
                        line=line_num,
                        context=context,
                    )
                )

        elif section_type == "chat":
            if not fields.get("instructions"):
                errors.append(
                    ValidationError(
                        "Missing required field: instructions::",
                        line=line_num,
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

    Only returns wiki-links that look like file paths (contain '/' or '..').
    Ignores things like Wikipedia citation links [[1]], [[2]], etc.

    Returns list of (line_number, link_path) tuples.
    """
    wiki_link_pattern = r"\[\[([^\]]+)\]\]"
    links = []
    for i, line in enumerate(text.split("\n"), 1):
        for match in re.finditer(wiki_link_pattern, line):
            link = match.group(1)
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
            corrected_target = (file_dir / corrected_path).resolve()
            if not corrected_target.suffix:
                corrected_target = corrected_target.with_suffix(".md")

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
        target = (file_dir / link_path).resolve()

        # Add .md extension if not present
        if not target.suffix:
            target = target.with_suffix(".md")

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


def _is_course_file(path: Path) -> bool:
    """Check if a file is a course file based on its location."""
    # Check if any parent directory is named "courses"
    return "courses" in path.parts


def validate_directory(
    directory: Path | str,
    lesson_glob: str = "**/*.md",
    course_glob: str = "courses/**/*.md",
) -> list[ValidationResult]:
    """
    Validate all lesson and course files in a directory.

    Args:
        directory: Root directory to search
        lesson_glob: Glob pattern for lesson files (default: **/*.md)
        course_glob: Glob pattern for course files (default: courses/**/*.md)

    Returns:
        List of ValidationResult for each file
    """
    directory = Path(directory)
    results = []

    # Find all markdown files and categorize by location
    for md_path in sorted(directory.glob(lesson_glob)):
        if _is_course_file(md_path):
            results.append(validate_course_file(md_path))
        else:
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
