#!/usr/bin/env python3
"""
Truncate an article after a specific phrase.

Usage:
    python truncate_after.py <file_path> "<ending_phrase>"

Example:
    python truncate_after.py articles/foo.md "and that's why AI safety matters."

The script will:
1. Find the line containing the ending phrase
2. Remove all content after that line
3. Only proceed if the phrase appears exactly once (uniqueness check)
"""

import sys
import re
from pathlib import Path


def truncate_after(file_path: str, ending_phrase: str, dry_run: bool = False) -> tuple[bool, str]:
    """
    Truncate article content after the line containing ending_phrase.

    Args:
        file_path: Path to the markdown file
        ending_phrase: The phrase to search for (last 5-10 words of actual content)
        dry_run: If True, don't modify file, just report what would happen

    Returns:
        (success, message) tuple
    """
    path = Path(file_path)
    if not path.exists():
        return False, f"File not found: {file_path}"

    content = path.read_text(encoding="utf-8")

    # Escape regex special characters in the phrase
    escaped_phrase = re.escape(ending_phrase)

    # Find all occurrences
    matches = list(re.finditer(escaped_phrase, content, re.IGNORECASE))

    if len(matches) == 0:
        return False, f"Phrase not found: '{ending_phrase}'"

    if len(matches) > 1:
        # Find line numbers for each match to help user pick a more unique phrase
        lines = content[:matches[0].start()].count('\n') + 1
        line_nums = []
        for m in matches:
            line_num = content[:m.start()].count('\n') + 1
            line_nums.append(line_num)
        return False, f"Phrase appears {len(matches)} times (lines {', '.join(map(str, line_nums))}). Use a more unique phrase."

    # Single match - find the end of the line containing it
    match = matches[0]
    end_of_line = content.find('\n', match.end())

    if end_of_line == -1:
        # Phrase is on the last line, nothing to truncate
        return True, "Phrase is on the last line. No content to remove."

    # Content to keep (up to and including the line with the phrase)
    new_content = content[:end_of_line + 1].rstrip() + '\n'

    # Calculate what's being removed
    removed = content[end_of_line + 1:]
    removed_lines = removed.count('\n') + (1 if removed.strip() else 0)
    removed_chars = len(removed)

    if dry_run:
        preview = removed[:200] + "..." if len(removed) > 200 else removed
        return True, f"Would remove {removed_lines} lines ({removed_chars} chars) after phrase.\nPreview of removed content:\n{preview}"

    # Write the truncated content
    path.write_text(new_content, encoding="utf-8")
    return True, f"Removed {removed_lines} lines ({removed_chars} chars) after '{ending_phrase}'"


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        print("Error: Missing arguments")
        print("Usage: python truncate_after.py <file_path> \"<ending_phrase>\" [--dry-run]")
        sys.exit(1)

    file_path = sys.argv[1]
    ending_phrase = sys.argv[2]
    dry_run = "--dry-run" in sys.argv

    success, message = truncate_after(file_path, ending_phrase, dry_run)

    if success:
        print(f"OK: {message}")
    else:
        print(f"ERROR: {message}")
        sys.exit(1)


if __name__ == "__main__":
    main()
