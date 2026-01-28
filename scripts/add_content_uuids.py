#!/usr/bin/env python3
"""Add UUIDs to content frontmatter in Obsidian vault.

Processes courses, modules, learning outcomes, and lenses.
"""

import re
import uuid
from pathlib import Path

# Obsidian vault path (WSL path)
VAULT_PATH = Path("/mnt/c/Users/lucbr/Documents/Obsidian Vault/Lens Edu")

# Directories to process
CONTENT_DIRS = [
    "courses",
    "modules",
    "Learning Outcomes",
    "Lenses",
]

# Skip WIP folders and non-content files
SKIP_PATTERNS = ["WIP", "attachments"]


def has_frontmatter(content: str) -> bool:
    """Check if content starts with YAML frontmatter."""
    return content.startswith("---\n")


def parse_frontmatter(content: str) -> tuple[dict | None, str]:
    """Parse YAML frontmatter from markdown content.

    Returns (frontmatter_dict, body) or (None, content) if no frontmatter.
    """
    if not has_frontmatter(content):
        return None, content

    # Find the closing ---
    end_match = re.search(r"\n---\n", content[4:])
    if not end_match:
        return None, content

    end_pos = end_match.start() + 4  # Account for initial "---\n"
    frontmatter_str = content[4:end_pos]
    body = content[end_pos + 5 :]  # Skip "\n---\n"

    # Simple YAML parsing (key: value pairs)
    frontmatter = {}
    for line in frontmatter_str.split("\n"):
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            # Remove quotes if present
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            elif value.startswith("'") and value.endswith("'"):
                value = value[1:-1]
            frontmatter[key] = value

    return frontmatter, body


def build_frontmatter(data: dict) -> str:
    """Build YAML frontmatter string from dict.

    Ensures 'id' comes first.
    """
    lines = ["---"]

    # id first
    if "id" in data:
        lines.append(f"id: {data['id']}")

    # Rest of fields in original order
    for key, value in data.items():
        if key == "id":
            continue
        # Quote values that contain special characters
        if any(c in str(value) for c in [":", "[", "]", "{", "}", "#", "|"]):
            lines.append(f'{key}: "{value}"')
        else:
            lines.append(f"{key}: {value}")

    lines.append("---")
    return "\n".join(lines)


def add_uuid_to_file(filepath: Path, dry_run: bool = False) -> bool:
    """Add UUID to a markdown file's frontmatter.

    Returns True if file was modified.
    """
    content = filepath.read_text(encoding="utf-8")

    frontmatter, body = parse_frontmatter(content)

    # Check if already has an id
    if frontmatter and "id" in frontmatter:
        print(f"  SKIP (has id): {filepath.name}")
        return False

    # Generate new UUID
    new_id = str(uuid.uuid4())

    if frontmatter is None:
        # No frontmatter - create new
        frontmatter = {"id": new_id}
        new_content = build_frontmatter(frontmatter) + "\n" + content
    else:
        # Has frontmatter - add id
        frontmatter["id"] = new_id
        new_content = build_frontmatter(frontmatter) + "\n" + body

    if dry_run:
        print(f"  DRY RUN: {filepath.name} -> {new_id}")
    else:
        filepath.write_text(new_content, encoding="utf-8")
        print(f"  ADDED: {filepath.name} -> {new_id}")

    return True


def process_directory(dir_path: Path, dry_run: bool = False) -> int:
    """Process all markdown files in a directory.

    Returns count of modified files.
    """
    if not dir_path.exists():
        print(f"Directory not found: {dir_path}")
        return 0

    modified = 0
    for filepath in dir_path.glob("*.md"):
        # Skip files matching skip patterns
        if any(skip in str(filepath) for skip in SKIP_PATTERNS):
            continue

        if add_uuid_to_file(filepath, dry_run):
            modified += 1

    return modified


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Add UUIDs to content frontmatter")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes",
    )
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN MODE ===\n")

    total_modified = 0

    for dir_name in CONTENT_DIRS:
        dir_path = VAULT_PATH / dir_name
        print(f"\n[{dir_name}]")
        modified = process_directory(dir_path, args.dry_run)
        total_modified += modified

    print(f"\n{'Would modify' if args.dry_run else 'Modified'}: {total_modified} files")


if __name__ == "__main__":
    main()
