#!/usr/bin/env python3
"""
Clean up PDF-extracted markdown by:
1. Removing page break markers (--- outside YAML frontmatter)
2. Joining lines that were broken mid-paragraph due to PDF column widths
3. Cleaning up the table of contents
4. Fixing common OCR artifacts (math symbols, spacing)

Saves output as <input>_cleaned.md for manual comparison.
"""

import re
import sys
from pathlib import Path


# Common OCR math symbol replacements
OCR_REPLACEMENTS = {
    ' £ ': ' ≤ ',
    '£': '≤',  # fallback without spaces
    ' ³ ': ' ≥ ',
    '³': '≥',
    '¥': '∞',
    'minus ¥': 'minus ∞',
}


def is_list_item(line: str) -> bool:
    """Check if line looks like a list item that legitimately starts with lowercase."""
    stripped = line.strip()

    # a), b), c) style
    if re.match(r'^[a-z]\)\s', stripped):
        return True

    # a., b., c. style
    if re.match(r'^[a-z]\.\s', stripped):
        return True

    # i., ii., iii., iv., v., vi., vii., viii., ix., x. (Roman numerals)
    if re.match(r'^[ivx]+\.\s', stripped):
        return True

    # i), ii), iii) style
    if re.match(r'^[ivx]+\)\s', stripped):
        return True

    return False


def is_toc_line(line: str) -> bool:
    """Check if line looks like part of a table of contents."""
    stripped = line.strip()
    # Standalone number (section number)
    if re.match(r'^\d+\.\s*$', stripped):
        return True
    # Standalone page number
    if re.match(r'^\d{1,3}$', stripped):
        return True
    return False


def is_section_header(line: str) -> bool:
    """Check if line looks like a section header in body text."""
    return bool(re.match(r'^\d+\.\s+[A-Z]', line.strip()))


def split_section_header(line: str) -> tuple[str, str] | None:
    """If line starts with a section header merged with text, split them."""
    # Pattern: "1. Title Text Continuation text starts here..."
    # We want to split after the title (which is typically Title Case words)
    match = re.match(r'^(\d+\.\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+([A-Z][a-z])', line)
    if match:
        header = match.group(1)
        rest = match.group(2) + line[match.end()-1:]
        return header, rest
    return None


def should_join_lines(current: str, next_line: str, was_page_break: bool) -> bool:
    """
    Determine if two lines should be joined.

    Join when:
    - Next line starts with lowercase
    - AND current line doesn't end with sentence-ending punctuation (. ? !)
    - AND next line isn't a list item (a), b), i., ii., etc.)

    Also join:
    - Hyphenated words split across lines
    - Lines split by page breaks where next starts lowercase
    """
    current = current.rstrip()
    next_stripped = next_line.strip()

    # Don't join if next line is empty
    if not next_stripped:
        return False

    # Don't join if next line is a section header
    if is_section_header(next_line):
        return False

    # Don't join if next line is a TOC element
    if is_toc_line(next_line):
        return False

    # Don't join if next line is a list item
    if is_list_item(next_line):
        return False

    # If current line ends mid-word (hyphenation), definitely join
    if current.endswith('-') and next_stripped and next_stripped[0].islower():
        return True

    # Check if next line starts with lowercase
    next_starts_lower = next_stripped and next_stripped[0].islower()

    # If current line ends with sentence-ending punctuation, only join if
    # next line starts lowercase (indicating a broken sentence)
    if current.endswith(('.', '?', '!')):
        # Short lines ending with period + lowercase continuation = likely broken
        if next_starts_lower and len(current) < 80:
            return True
        # Page break + lowercase = likely broken
        if was_page_break and next_starts_lower:
            return True
        return False

    # Semicolon/colon: join if next starts lowercase
    if current.endswith((';', ':')):
        return next_starts_lower

    # No ending punctuation: likely a broken line, join it
    return True


def fix_ocr_artifacts(content: str) -> str:
    """Fix common OCR artifacts like mangled math symbols."""
    for old, new in OCR_REPLACEMENTS.items():
        content = content.replace(old, new)

    # Fix missing spaces in journal references like "Biometrika40" -> "Biometrika 40"
    content = re.sub(r'([a-zA-Z])(\d{2,3}),\s*(\d+)', r'\1 \2, \3', content)

    # Fix merged words (lowercase followed by uppercase mid-word)
    # e.g., "placedsubcortical" - this is tricky and prone to false positives
    # so we only do specific known patterns
    content = content.replace('consciousnessprovoking', 'consciousness-provoking')

    return content


def clean_pdf_linebreaks(content: str) -> str:
    """Clean PDF line breaks while preserving intentional structure."""

    # Split into YAML frontmatter and body
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            frontmatter = f"---{parts[1]}---\n"
            body = parts[2].lstrip('\n')
        else:
            frontmatter = ""
            body = content
    else:
        frontmatter = ""
        body = content

    lines = body.split('\n')

    # Track page breaks (--- markers)
    page_break_indices = set()
    filtered_lines = []
    for i, line in enumerate(lines):
        if line.strip() == '---':
            page_break_indices.add(len(filtered_lines))
        else:
            filtered_lines.append(line)
    lines = filtered_lines

    # Find and process the table of contents
    # TOC typically starts after author info and ends before "1. Introduction" body
    toc_start = None
    toc_end = None
    intro_body_start = None

    for i, line in enumerate(lines):
        # Find first "1." which is start of TOC
        if toc_start is None and re.match(r'^1\.\s*$', line.strip()):
            toc_start = i
        # Find where body text starts (after TOC, a "1. Introduction" followed by actual paragraphs)
        if toc_start is not None and re.match(r'^1\.\s+Introduction', line.strip()):
            # Check if next non-empty line is a paragraph (not a number)
            for j in range(i + 1, min(i + 5, len(lines))):
                if lines[j].strip() and not re.match(r'^\d', lines[j].strip()):
                    intro_body_start = i
                    toc_end = i
                    break
            if intro_body_start:
                break

    result_lines = []

    # Process header (before TOC)
    if toc_start:
        for i in range(toc_start):
            result_lines.append(lines[i])

    # Process TOC - remove it entirely since page numbers aren't useful
    # Or optionally, we could rebuild it as a clean list
    # For now, let's skip it

    # Process body text (after TOC)
    if intro_body_start is None:
        intro_body_start = 0

    i = intro_body_start
    while i < len(lines):
        line = lines[i]

        # Keep blank lines as paragraph separators
        if not line.strip():
            result_lines.append('')
            i += 1
            continue

        # Accumulate lines that should be joined
        accumulated = line
        was_page_break = i in page_break_indices

        while i + 1 < len(lines):
            next_line = lines[i + 1]
            next_was_break = (i + 1) in page_break_indices

            if not should_join_lines(accumulated, next_line, was_page_break):
                break

            # Handle hyphenation
            if accumulated.rstrip().endswith('-'):
                # Remove hyphen and join directly
                accumulated = accumulated.rstrip()[:-1] + next_line.strip()
            else:
                accumulated = accumulated.rstrip() + ' ' + next_line.strip()

            i += 1
            was_page_break = next_was_break

        result_lines.append(accumulated)
        i += 1

    # Split section headers that got merged with following text
    split_lines = []
    for line in result_lines:
        split = split_section_header(line)
        if split:
            split_lines.append(split[0])
            split_lines.append(split[1])
        else:
            split_lines.append(line)
    result_lines = split_lines

    # Second pass: join lines where current line doesn't end with period
    # and next line starts with lowercase (catches remaining broken lines)
    joined_lines = []
    i = 0
    while i < len(result_lines):
        line = result_lines[i]

        # Check if next line starts with lowercase and should be joined
        if (i + 1 < len(result_lines) and
            result_lines[i + 1].strip() and
            result_lines[i + 1].strip()[0].islower() and
            not is_list_item(result_lines[i + 1]) and
            line.strip()):  # current line is not empty

            # Join if current doesn't end with sentence punctuation
            # or if it's a short line ending with period
            current_stripped = line.rstrip()
            if (not current_stripped.endswith(('.', '?', '!')) or
                (current_stripped.endswith('.') and len(current_stripped) < 80)):
                line = current_stripped + ' ' + result_lines[i + 1].strip()
                joined_lines.append(line)
                i += 2
                continue

        joined_lines.append(line)
        i += 1
    result_lines = joined_lines

    # Clean up multiple consecutive blank lines
    final_lines = []
    prev_blank = False
    for line in result_lines:
        is_blank = not line.strip()
        if is_blank and prev_blank:
            continue
        final_lines.append(line)
        prev_blank = is_blank

    result = frontmatter + '\n'.join(final_lines)

    # Apply OCR artifact fixes
    result = fix_ocr_artifacts(result)

    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: python clean_pdf_linebreaks.py <input.md> [output.md]")
        print("If output not specified, saves as <input>_cleaned.md")
        sys.exit(1)

    input_path = Path(sys.argv[1])

    if len(sys.argv) >= 3:
        output_path = Path(sys.argv[2])
    else:
        output_path = input_path.with_stem(input_path.stem + '_cleaned')

    content = input_path.read_text(encoding='utf-8')
    cleaned = clean_pdf_linebreaks(content)
    output_path.write_text(cleaned, encoding='utf-8')

    # Stats
    orig_lines = len(content.split('\n'))
    new_lines = len(cleaned.split('\n'))

    print(f"Input:  {input_path} ({orig_lines} lines)")
    print(f"Output: {output_path} ({new_lines} lines)")
    print(f"Reduced by {orig_lines - new_lines} lines ({100*(orig_lines-new_lines)/orig_lines:.1f}%)")


if __name__ == '__main__':
    main()
