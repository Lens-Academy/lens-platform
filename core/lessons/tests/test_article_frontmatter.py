# core/lessons/tests/test_article_frontmatter.py
"""Tests for article frontmatter validation."""

import pytest
from pathlib import Path
import yaml


ARTICLES_DIR = Path(__file__).parent.parent.parent.parent / "educational_content" / "articles"

REQUIRED_FIELDS = ["title", "author"]


def get_article_files():
    """Get all markdown files in articles folder, excluding skill files and CLAUDE.md."""
    if not ARTICLES_DIR.exists():
        return []

    files = []
    for f in ARTICLES_DIR.glob("*.md"):
        # Skip skill files and CLAUDE.md
        if f.name.endswith(".skill.md"):
            continue
        if f.name.upper() == "CLAUDE.MD":
            continue
        files.append(f)

    return files


def parse_frontmatter(content: str) -> dict | None:
    """Parse YAML frontmatter from markdown content."""
    if not content.startswith("---"):
        return None

    # Find the closing ---
    end_idx = content.find("---", 3)
    if end_idx == -1:
        return None

    frontmatter_text = content[3:end_idx].strip()
    try:
        return yaml.safe_load(frontmatter_text)
    except yaml.YAMLError:
        return None


@pytest.mark.parametrize("article_path", get_article_files(), ids=lambda p: p.name)
def test_article_has_valid_frontmatter(article_path: Path):
    """Each article should have valid YAML frontmatter with required fields."""
    content = article_path.read_text()

    # Check frontmatter exists
    frontmatter = parse_frontmatter(content)
    assert frontmatter is not None, f"{article_path.name} is missing YAML frontmatter"

    # Check required fields
    for field in REQUIRED_FIELDS:
        assert field in frontmatter, f"{article_path.name} is missing required field: {field}"
        assert frontmatter[field], f"{article_path.name} has empty {field} field"


def test_articles_directory_exists():
    """Articles directory should exist."""
    assert ARTICLES_DIR.exists(), f"Articles directory not found: {ARTICLES_DIR}"


def test_at_least_one_article_exists():
    """Should have at least one article file."""
    articles = get_article_files()
    assert len(articles) > 0, "No article files found"
