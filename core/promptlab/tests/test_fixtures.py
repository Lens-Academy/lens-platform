import json

import pytest

from core.promptlab.fixtures import list_fixtures, load_fixture

FLAT_FIXTURE = {
    "name": "Test Flat Fixture",
    "module": "test-module",
    "description": "A flat-format fixture for testing.",
    "baseSystemPrompt": "You are a test tutor.",
    "instructions": "You are a helpful tutor.",
    "context": "The student is learning about X.",
    "conversations": [
        {
            "label": "Opening exchange",
            "messages": [
                {"role": "user", "content": "What is X?"},
                {"role": "assistant", "content": "X is a concept."},
            ],
        }
    ],
}

SECTIONED_FIXTURE = {
    "name": "Test Sectioned Fixture",
    "module": "test-module",
    "description": "A sectioned fixture for testing.",
    "baseSystemPrompt": "You are a sectioned tutor.",
    "sections": [
        {
            "name": "Section A",
            "instructions": "Instruction A",
            "context": "Context A",
            "conversations": [
                {
                    "label": "Convo A",
                    "messages": [
                        {"role": "user", "content": "Hello A"},
                        {"role": "assistant", "content": "Hi A"},
                    ],
                }
            ],
        },
        {
            "name": "Section B",
            "instructions": "Instruction B",
            "context": "Context B",
            "conversations": [
                {
                    "label": "Convo B",
                    "messages": [
                        {"role": "user", "content": "Hello B"},
                        {"role": "assistant", "content": "Hi B"},
                    ],
                }
            ],
        },
    ],
}


@pytest.fixture(autouse=True)
def _use_test_fixtures(tmp_path, monkeypatch):
    """Point FIXTURES_DIR at a temp directory with test data."""
    (tmp_path / "flat.json").write_text(json.dumps(FLAT_FIXTURE))
    (tmp_path / "sectioned.json").write_text(json.dumps(SECTIONED_FIXTURE))
    monkeypatch.setattr("core.promptlab.fixtures.FIXTURES_DIR", tmp_path)


def test_list_fixtures_returns_summaries():
    fixtures = list_fixtures()
    assert len(fixtures) == 2
    for f in fixtures:
        assert "name" in f
        assert "module" in f
        assert "description" in f
    names = {f["name"] for f in fixtures}
    assert names == {"Test Flat Fixture", "Test Sectioned Fixture"}


def test_load_flat_fixture_normalized_to_sections():
    """Flat-format fixtures (legacy) get wrapped in a single section."""
    fixture = load_fixture("Test Flat Fixture")
    assert fixture is not None
    assert fixture["baseSystemPrompt"] == "You are a test tutor."
    assert "sections" in fixture
    assert len(fixture["sections"]) == 1
    section = fixture["sections"][0]
    assert "instructions" in section
    assert "context" in section
    assert "conversations" in section
    assert len(section["conversations"]) == 1
    conv = section["conversations"][0]
    assert conv["label"] == "Opening exchange"
    assert len(conv["messages"]) == 2


def test_load_sectioned_fixture():
    """Sectioned-format fixtures have multiple sections."""
    fixture = load_fixture("Test Sectioned Fixture")
    assert fixture is not None
    assert fixture["baseSystemPrompt"] == "You are a sectioned tutor."
    assert len(fixture["sections"]) == 2
    for section in fixture["sections"]:
        assert "name" in section
        assert "instructions" in section
        assert "context" in section
        assert len(section["conversations"]) >= 1


def test_load_fixture_not_found():
    fixture = load_fixture("Nonexistent Fixture")
    assert fixture is None
