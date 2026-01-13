# core/transcripts/tests/test_transcript_validation.py
"""Tests for video transcript validation."""

import json
import pytest
from pathlib import Path
import yaml

from core.lessons.content import extract_video_id_from_url


TRANSCRIPTS_DIR = Path(__file__).parent.parent.parent.parent / "educational_content" / "video_transcripts"

REQUIRED_FRONTMATTER_FIELDS = ["title", "url"]


def get_transcript_md_files():
    """Get all markdown files in video_transcripts folder."""
    if not TRANSCRIPTS_DIR.exists():
        return []
    return list(TRANSCRIPTS_DIR.glob("*.md"))


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


@pytest.mark.parametrize("md_path", get_transcript_md_files(), ids=lambda p: p.name)
def test_transcript_has_valid_frontmatter(md_path: Path):
    """Each transcript markdown should have valid YAML frontmatter with required fields."""
    content = md_path.read_text()

    # Check frontmatter exists
    frontmatter = parse_frontmatter(content)
    assert frontmatter is not None, f"{md_path.name} is missing YAML frontmatter"

    # Check required fields
    for field in REQUIRED_FRONTMATTER_FIELDS:
        assert field in frontmatter, f"{md_path.name} is missing required field: {field}"
        assert frontmatter[field], f"{md_path.name} has empty {field} field"


@pytest.mark.parametrize("md_path", get_transcript_md_files(), ids=lambda p: p.name)
def test_transcript_url_is_parseable(md_path: Path):
    """Each transcript URL must be in a format we can extract video ID from.

    This ensures we catch unsupported URL formats at test time, not at runtime.
    If this test fails, either fix the URL or add support for the new format
    in extract_video_id_from_url().
    """
    content = md_path.read_text()
    frontmatter = parse_frontmatter(content)

    if frontmatter is None or "url" not in frontmatter:
        pytest.skip(f"{md_path.name} has no URL (will be caught by other tests)")

    url = frontmatter["url"]
    try:
        video_id = extract_video_id_from_url(url)
        assert video_id, f"{md_path.name} URL parsed to empty video ID"
    except ValueError as e:
        pytest.fail(
            f"{md_path.name} has unparseable URL format: {url}\n"
            f"Error: {e}\n"
            f"Either fix the URL or add support for this format in extract_video_id_from_url()"
        )


@pytest.mark.parametrize("md_path", get_transcript_md_files(), ids=lambda p: p.name)
def test_transcript_has_timestamps_file(md_path: Path):
    """Each transcript markdown should have a corresponding .timestamps.json file."""
    timestamps_path = md_path.with_suffix(".timestamps.json")
    assert timestamps_path.exists(), f"Missing timestamps file for {md_path.name}: expected {timestamps_path.name}"


@pytest.mark.parametrize("md_path", get_transcript_md_files(), ids=lambda p: p.name)
def test_timestamps_file_has_valid_format(md_path: Path):
    """Each timestamps file should be a JSON array with valid word entries."""
    timestamps_path = md_path.with_suffix(".timestamps.json")

    if not timestamps_path.exists():
        pytest.skip(f"Timestamps file does not exist: {timestamps_path.name}")

    content = timestamps_path.read_text()

    # Should parse as JSON
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        pytest.fail(f"{timestamps_path.name} is not valid JSON: {e}")

    # Should be a list
    assert isinstance(data, list), f"{timestamps_path.name} should be a JSON array, got {type(data).__name__}"

    # Should have at least some entries
    assert len(data) > 0, f"{timestamps_path.name} is empty"

    # Each entry should have 'text' and 'start' fields
    for i, entry in enumerate(data[:10]):  # Check first 10 entries
        assert "text" in entry, f"{timestamps_path.name} entry {i} missing 'text' field"
        assert "start" in entry, f"{timestamps_path.name} entry {i} missing 'start' field"
        assert isinstance(entry["text"], str), f"{timestamps_path.name} entry {i} 'text' should be string"
        assert isinstance(entry["start"], (int, float)), f"{timestamps_path.name} entry {i} 'start' should be number"


def test_transcripts_directory_exists():
    """Transcripts directory should exist."""
    assert TRANSCRIPTS_DIR.exists(), f"Transcripts directory not found: {TRANSCRIPTS_DIR}"


def test_at_least_one_transcript_exists():
    """Should have at least one transcript file."""
    transcripts = get_transcript_md_files()
    assert len(transcripts) > 0, "No transcript files found"
