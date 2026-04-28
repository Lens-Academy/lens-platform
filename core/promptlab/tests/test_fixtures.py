import json

import pytest

from core.promptlab.fixtures import (
    SCHEMA_VERSION,
    InvalidFixtureNameError,
    delete_fixture,
    list_fixtures,
    load_fixture,
    save_fixture,
)

LEGACY_SECTIONED = {
    "name": "Legacy Sectioned",
    "module": "test-module",
    "description": "A legacy sectioned fixture.",
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
    ],
}

LEGACY_FLAT = {
    "name": "Legacy Flat",
    "module": "test-module",
    "description": "A legacy flat fixture.",
    "baseSystemPrompt": "You are a flat tutor.",
    "instructions": "Instruction X",
    "context": "Context X",
    "conversations": [
        {
            "label": "Convo X",
            "messages": [{"role": "user", "content": "hi"}],
        }
    ],
}

V2_FIXTURE = {
    "schemaVersion": SCHEMA_VERSION,
    "name": "v2-sample",
    "description": "Native v2 fixture",
    "globalOverrides": {"basePrompt": None},
    "stageGroups": [
        {
            "kind": "live_module",
            "moduleSlug": "introduction",
            "sectionIndex": 0,
            "segmentIndex": 0,
            "courseSlug": None,
            "overrides": {},
            "chats": [{"label": "Chat 1", "messages": []}],
        }
    ],
}


@pytest.fixture(autouse=True)
def _use_test_fixtures(tmp_path, monkeypatch):
    (tmp_path / "legacy-sectioned.json").write_text(json.dumps(LEGACY_SECTIONED))
    (tmp_path / "legacy-flat.json").write_text(json.dumps(LEGACY_FLAT))
    (tmp_path / "v2-sample.json").write_text(json.dumps(V2_FIXTURE))
    monkeypatch.setattr("core.promptlab.fixtures.FIXTURES_DIR", tmp_path)


def test_list_fixtures_summaries():
    fixtures = list_fixtures()
    names = {f["name"] for f in fixtures}
    assert names == {"Legacy Sectioned", "Legacy Flat", "v2-sample"}
    for f in fixtures:
        assert {"name", "description", "type"} <= f.keys()


def test_load_legacy_sectioned_migrated_to_v2():
    fx = load_fixture("Legacy Sectioned")
    assert fx is not None
    assert fx["schemaVersion"] == SCHEMA_VERSION
    assert fx["globalOverrides"]["basePrompt"] == "You are a sectioned tutor."
    assert len(fx["stageGroups"]) == 1
    sg = fx["stageGroups"][0]
    assert sg["kind"] == "inline"
    assert sg["name"] == "Section A"
    assert sg["instructions"] == "Instruction A"
    assert sg["chats"][0]["label"] == "Convo A"


def test_load_legacy_flat_migrated_to_one_stagegroup():
    fx = load_fixture("Legacy Flat")
    assert fx["schemaVersion"] == SCHEMA_VERSION
    assert len(fx["stageGroups"]) == 1
    assert fx["stageGroups"][0]["kind"] == "inline"
    assert fx["stageGroups"][0]["instructions"] == "Instruction X"


def test_load_v2_passthrough():
    fx = load_fixture("v2-sample")
    assert fx == V2_FIXTURE


def test_load_missing_returns_none():
    assert load_fixture("does-not-exist") is None


def test_save_then_load_roundtrip(tmp_path):
    saved = save_fixture("v2-sample", V2_FIXTURE)
    assert saved["schemaVersion"] == SCHEMA_VERSION
    reloaded = load_fixture("v2-sample")
    assert reloaded == saved


def test_save_rejects_mismatched_name():
    with pytest.raises(ValueError):
        save_fixture("v2-sample", {**V2_FIXTURE, "name": "different"})


@pytest.mark.parametrize(
    "bad",
    ["../escape", "Caps", "with space", ".dot", "", "a/b", "name.json"],
)
def test_save_rejects_unsafe_names(bad):
    with pytest.raises(InvalidFixtureNameError):
        save_fixture(bad, {**V2_FIXTURE, "name": bad})


def test_save_atomic_write_visible_only_after_rename(tmp_path, monkeypatch):
    """Tempfile must not be visible under the final filename mid-write."""
    save_fixture("v2-sample", V2_FIXTURE)
    files = {p.name for p in tmp_path.iterdir()}
    # No temp leftover with our prefix.
    assert not any(name.startswith(".v2-sample.") for name in files)


def test_delete_fixture():
    assert delete_fixture("v2-sample") is True
    assert load_fixture("v2-sample") is None
    assert delete_fixture("v2-sample") is False
