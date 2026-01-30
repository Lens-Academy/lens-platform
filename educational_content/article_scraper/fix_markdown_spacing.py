#!/usr/bin/env python3
"""
Fix markdown bold/italic spacing issues in extracted articles.

Common issues from web scraping:
- **bold**text  → **bold** text
- text**bold**  → text **bold**
- *italic*text  → *italic* text
- text*italic*  → text *italic*

Also fixes:
- HTML entities: &gt; → >, &lt; → <, &amp; → &

Saves output as <input>_fixed.md for comparison.
"""

import re
import sys
from pathlib import Path


def fix_markdown_spacing(content: str) -> tuple[str, list[str]]:
    """
    Fix spacing around bold/italic markers.

    Returns (fixed_content, list_of_changes).
    """
    changes = []
    result = content

    # === HTML entities ===
    html_entities = [
        ("&gt;", ">"),
        ("&lt;", "<"),
        ("&amp;", "&"),
        ("&quot;", '"'),
        ("&apos;", "'"),
        ("&nbsp;", " "),
    ]
    for entity, replacement in html_entities:
        if entity in result:
            count = result.count(entity)
            result = result.replace(entity, replacement)
            changes.append(f"HTML entity {entity} → {replacement} ({count}x)")

    # === Bold spacing ===
    # Pattern requires: **<content with at least one word char>**
    # This avoids matching things like **  ** (just spaces)

    # **bold**letter → **bold** letter (bold followed by word char)
    pattern = r"(\*\*[^*\n]*\w[^*\n]*\*\*)([a-zA-Z])"
    matches = re.findall(pattern, result)
    if matches:
        result = re.sub(pattern, r"\1 \2", result)
        changes.append(f"Added space after bold ({len(matches)}x)")

    # letter**bold** → letter **bold** (word char followed by bold)
    pattern = r"([a-zA-Z])(\*\*[^*\n]*\w[^*\n]*\*\*)"
    matches = re.findall(pattern, result)
    if matches:
        result = re.sub(pattern, r"\1 \2", result)
        changes.append(f"Added space before bold ({len(matches)}x)")

    # punctuation**bold** → punctuation **bold**
    pattern = r"([,.:;)\]])(\*\*[^*\n]*\w[^*\n]*\*\*)"
    matches = re.findall(pattern, result)
    if matches:
        result = re.sub(pattern, r"\1 \2", result)
        changes.append(f"Added space after punctuation before bold ({len(matches)}x)")

    # === Italic spacing (single asterisk) ===
    # Need to be careful not to match bold markers
    # Pattern requires content to start with word char (not space/punctuation)
    # This prevents matching *  * (space between two real italics)

    # *italic*letter → *italic* letter
    # Match: asterisk, word char, optional more content, asterisk, letter
    # Use negative lookbehind to avoid matching ** (bold)
    pattern = r"(?<!\*)(\*\w[^*\n]*\*)([a-zA-Z])"
    matches = re.findall(pattern, result)
    if matches:
        result = re.sub(pattern, r"\1 \2", result)
        changes.append(f"Added space after italic ({len(matches)}x)")

    # letter*italic* → letter *italic*
    # Content must start with word char
    pattern = r"([a-zA-Z])(\*\w[^*\n]*\*)(?!\*)"
    matches = re.findall(pattern, result)
    if matches:
        result = re.sub(pattern, r"\1 \2", result)
        changes.append(f"Added space before italic ({len(matches)}x)")

    # punctuation*italic* → punctuation *italic*
    # Add space after comma, period, colon, semicolon, closing paren/bracket when followed by italic
    pattern = r"([,.:;)\]])(\*\w[^*\n]*\*)(?!\*)"
    matches = re.findall(pattern, result)
    if matches:
        result = re.sub(pattern, r"\1 \2", result)
        changes.append(f"Added space after punctuation before italic ({len(matches)}x)")

    # === Fix double-spacing that might result from above ===
    if "  " in result:
        old_count = result.count("  ")
        result = re.sub(r"  +", " ", result)
        new_count = result.count("  ")
        if old_count != new_count:
            changes.append(f"Collapsed double spaces ({old_count - new_count}x)")

    return result, changes


def process_file(
    input_path: Path, output_path: Path | None = None
) -> tuple[Path, list[str]]:
    """
    Process a single file.

    Returns (output_path, changes).
    """
    if output_path is None:
        output_path = input_path.with_stem(input_path.stem + "_fixed")

    content = input_path.read_text(encoding="utf-8")
    fixed_content, changes = fix_markdown_spacing(content)

    output_path.write_text(fixed_content, encoding="utf-8")

    return output_path, changes


def main():
    if len(sys.argv) < 2:
        print("Usage: python fix_markdown_spacing.py <input.md> [output.md]")
        print("       python fix_markdown_spacing.py --all <directory>")
        print()
        print("If output not specified, saves as <input>_fixed.md")
        print("Use --all to process all .md files in a directory")
        sys.exit(1)

    if sys.argv[1] == "--all":
        if len(sys.argv) < 3:
            print("Error: --all requires a directory path")
            sys.exit(1)

        directory = Path(sys.argv[2])
        if not directory.is_dir():
            print(f"Error: {directory} is not a directory")
            sys.exit(1)

        # Process all .md files (excluding already-fixed ones)
        md_files = [
            f
            for f in directory.glob("*.md")
            if not f.stem.endswith("_fixed")
            and not f.stem.endswith("_cleaned")
            and not f.stem.endswith("_llm_cleanup")
        ]

        if not md_files:
            print(f"No markdown files found in {directory}")
            sys.exit(1)

        print(f"Processing {len(md_files)} files in {directory}...\n")

        for input_path in sorted(md_files):
            output_path, changes = process_file(input_path)

            if changes:
                print(f"✓ {input_path.name}")
                for change in changes:
                    print(f"    {change}")
            else:
                print(f"  {input_path.name} (no changes needed)")

        print("\nDone! Fixed files saved as *_fixed.md")

    else:
        input_path = Path(sys.argv[1])

        if not input_path.exists():
            print(f"Error: {input_path} does not exist")
            sys.exit(1)

        if len(sys.argv) >= 3:
            output_path = Path(sys.argv[2])
        else:
            output_path = None

        output_path, changes = process_file(input_path, output_path)

        print(f"Input:  {input_path}")
        print(f"Output: {output_path}")
        print()

        if changes:
            print("Changes made:")
            for change in changes:
                print(f"  - {change}")
        else:
            print("No changes needed.")


if __name__ == "__main__":
    main()
