# core/content/tests/test_typescript_processor.py
"""Tests for TypeScript subprocess processor."""

import json
import pytest
from pathlib import Path


@pytest.fixture
def fixture_files() -> dict[str, str]:
    """Load the minimal-module fixture files into a dict."""
    fixture_dir = (
        Path(__file__).parent.parent.parent.parent
        / "content_processor"
        / "fixtures"
        / "valid"
        / "minimal-module"
        / "input"
    )
    files = {}
    for file_path in fixture_dir.rglob("*.md"):
        relative_path = file_path.relative_to(fixture_dir)
        files[str(relative_path)] = file_path.read_text()
    # Also load .timestamps.json files if any
    for file_path in fixture_dir.rglob("*.timestamps.json"):
        relative_path = file_path.relative_to(fixture_dir)
        files[str(relative_path)] = file_path.read_text()
    return files


@pytest.fixture
def expected_output() -> dict:
    """Load the expected output for the minimal-module fixture."""
    expected_path = (
        Path(__file__).parent.parent.parent.parent
        / "content_processor"
        / "fixtures"
        / "valid"
        / "minimal-module"
        / "expected.json"
    )
    return json.loads(expected_path.read_text())


@pytest.mark.asyncio
async def test_process_content_via_subprocess(fixture_files, expected_output):
    """Verify Python can call TypeScript CLI and get correct output."""
    from core.content.typescript_processor import process_content_typescript

    result = await process_content_typescript(fixture_files)

    # Compare modules
    assert len(result["modules"]) == len(expected_output["modules"])
    for actual_mod, expected_mod in zip(result["modules"], expected_output["modules"]):
        assert actual_mod["slug"] == expected_mod["slug"]
        assert actual_mod["title"] == expected_mod["title"]
        assert actual_mod["sections"] == expected_mod["sections"]

    # Compare errors (should be empty for valid fixture)
    assert result["errors"] == expected_output["errors"]
