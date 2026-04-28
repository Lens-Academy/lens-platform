"""
Fixture listing, loading, and saving for the Prompt Lab.

A fixture is the entire backing state of one Prompt Lab page. The frontend
mirrors the file shape 1:1 — opening a fixture loads it as page state, and
every UI mutation auto-saves the file via the PUT endpoint. This makes
fixtures `jj evolog`-trackable and revertable per change.

Schema v2 (new format):

    {
      "schemaVersion": 2,
      "name": "...",
      "description": "...",
      "globalOverrides": {"basePrompt": null | str},
      "stageGroups": [
        {
          "kind": "live_module",
          "moduleSlug": "...",
          "sectionIndex": 0,
          "segmentIndex": 0,
          "courseSlug": "..." | null,
          "overrides": {...},
          "chats": [{"label": "...", "messages": [{role, content}]}]
        },
        {
          "kind": "inline",
          "name": "...",
          "instructions": "...",
          "context": "...",
          "overrides": {...},
          "chats": [...]
        }
      ]
    }

Legacy schema (assessments + the original real-student-conversations format)
is migrated transparently on load. Save always emits v2.

Assessment fixtures (type=assessment) keep their separate format and are
returned as-is by load_fixture; they don't pass through the v2 migration.
"""

import json
import os
import re
import tempfile
from pathlib import Path
from typing import TypedDict

from core.modules.tutor_scenario import (
    ScenarioTurn,
    build_scenario_turn,
    merge_existing_messages,
)
from core.modules.types import ChatStage

FIXTURES_DIR = Path(__file__).parent / "fixtures"

SCHEMA_VERSION = 2

# Names: lowercase + digits + dash + underscore. Refuse paths and dotfiles.
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class FixtureMessage(TypedDict):
    role: str
    content: str


class FixtureChat(TypedDict):
    label: str
    messages: list[FixtureMessage]


class AssessmentItem(TypedDict):
    label: str
    question: str
    answer: str


class AssessmentSection(TypedDict):
    name: str
    instructions: str
    items: list[AssessmentItem]


class FixtureSummary(TypedDict):
    name: str
    description: str
    type: str  # "chat" or "assessment"


class InvalidFixtureNameError(ValueError):
    """Raised when a fixture name fails validation."""


def _validate_name(name: str) -> str:
    """Return the name if safe; raise otherwise. Refuses anything that
    could escape FIXTURES_DIR or hit dotfiles."""
    if not _NAME_RE.fullmatch(name):
        raise InvalidFixtureNameError(
            f"Invalid fixture name {name!r}: must match [a-z0-9][a-z0-9_-]*"
        )
    return name


def _path_for(name: str) -> Path:
    """Resolve a validated name to its FIXTURES_DIR path, with a final
    sanity check that the resolved path stays inside FIXTURES_DIR."""
    _validate_name(name)
    path = (FIXTURES_DIR / f"{name}.json").resolve()
    if FIXTURES_DIR.resolve() not in path.parents:
        raise InvalidFixtureNameError(f"Resolved path escapes FIXTURES_DIR: {path}")
    return path


def _migrate_legacy_chat(data: dict) -> dict:
    """Convert a legacy chat fixture dict to v2.

    Legacy "sectioned" format had `sections: [{name, instructions, context,
    conversations}]`. Legacy "flat" format had top-level instructions /
    context / conversations and no sections array. Both become v2 with
    each legacy section mapping to one `inline` stage group.
    """
    if "sections" in data:
        legacy_sections = data["sections"]
    else:
        legacy_sections = [
            {
                "name": data.get("name", ""),
                "instructions": data.get("instructions", ""),
                "context": data.get("context", ""),
                "conversations": data.get("conversations", []),
            }
        ]

    stage_groups = []
    for s in legacy_sections:
        stage_groups.append(
            {
                "kind": "inline",
                "name": s.get("name", ""),
                "instructions": s.get("instructions", "") or "",
                "context": s.get("context", "") or "",
                "overrides": {},
                "chats": [
                    {
                        "label": c["label"],
                        "messages": [
                            {"role": m["role"], "content": m["content"]}
                            for m in c["messages"]
                        ],
                    }
                    for c in s.get("conversations", [])
                ],
            }
        )

    base_prompt = data.get("baseSystemPrompt") or None
    return {
        "schemaVersion": SCHEMA_VERSION,
        "name": data["name"],
        "description": data.get("description", ""),
        "globalOverrides": {"basePrompt": base_prompt},
        "stageGroups": stage_groups,
    }


def list_fixtures() -> list[FixtureSummary]:
    """Scan FIXTURES_DIR for *.json files and return summaries."""
    if not FIXTURES_DIR.exists():
        return []

    fixtures: list[FixtureSummary] = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            fixtures.append(
                FixtureSummary(
                    name=data["name"],
                    description=data.get("description", ""),
                    type=data.get("type", "chat"),
                )
            )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: skipping malformed fixture {path.name}: {e}")

    fixtures.sort(key=lambda f: f["name"])
    return fixtures


def load_fixture(name: str) -> dict | None:
    """Load a fixture by `name` field. Returns the v2 dict (chat fixtures
    are migrated on read) or the assessment dict (untouched).

    Returns None if no matching file exists.
    """
    if not FIXTURES_DIR.exists():
        return None

    for path in FIXTURES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            print(f"Warning: skipping malformed fixture {path.name}: {e}")
            continue
        if data.get("name") != name:
            continue

        if data.get("type") == "assessment":
            return data

        if data.get("schemaVersion") == SCHEMA_VERSION:
            # Already v2. Defensive: ensure required fields exist.
            data.setdefault("globalOverrides", {"basePrompt": None})
            data.setdefault("stageGroups", [])
            data.setdefault("description", "")
            return data

        return _migrate_legacy_chat(data)

    return None


def save_fixture(name: str, fixture: dict) -> dict:
    """Atomically write `fixture` to FIXTURES_DIR/{name}.json.

    `fixture` must already be in v2 shape with `name` matching the path.
    Writes via tempfile + os.replace for atomicity (no half-written files
    visible to readers).

    Returns the saved fixture (with schemaVersion stamped).
    """
    path = _path_for(name)
    if fixture.get("name") != name:
        raise ValueError(
            f"Fixture name {fixture.get('name')!r} doesn't match path name {name!r}"
        )

    out = dict(fixture)
    out["schemaVersion"] = SCHEMA_VERSION
    out.setdefault("description", "")
    out.setdefault("globalOverrides", {"basePrompt": None})
    out.setdefault("stageGroups", [])

    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=FIXTURES_DIR, prefix=f".{name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
    return out


def delete_fixture(name: str) -> bool:
    """Delete a fixture by name. Returns True if removed, False if absent."""
    path = _path_for(name)
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def stage_group_to_scenario(
    fixture: dict,
    stage_group_index: int,
    messages: list[dict],
) -> ScenarioTurn:
    """Convert a v2 stage group + conversation history to a ScenarioTurn.

    Both `live_module` and `inline` kinds are routed through this path
    (live_module delegates to build_scenario_turn for byte-identical parity
    with the production tutor; inline synthesizes a ScenarioTurn from the
    stored instructions/context strings).
    """
    sg = fixture["stageGroups"][stage_group_index]
    kind = sg["kind"]

    user_message = ""
    existing = list(messages)
    if existing and existing[-1].get("role") == "user":
        user_message = existing[-1].get("content", "")
        existing = existing[:-1]

    if kind == "live_module":
        from core.modules.loader import load_flattened_module

        module = load_flattened_module(sg["moduleSlug"])
        return build_scenario_turn(
            module=module,
            section_index=sg.get("sectionIndex", 0),
            segment_index=sg.get("segmentIndex", 0),
            existing_messages=existing,
            user_message=user_message,
            course_slug=sg.get("courseSlug"),
        )

    # inline
    section_name = sg.get("name") or None
    instructions = sg.get("instructions", "") or ""
    context = sg.get("context", "") or ""

    parts: list[str] = []
    if context:
        attrs = f' lens_title="{section_name}"' if section_name else ""
        parts.append(f"<lens{attrs}>")
        parts.append('<segment index="1" type="article">')
        parts.append(context)
        parts.append("</segment>")
        parts.append("</lens>")
    if instructions:
        parts.append("<segment-instructions>")
        parts.append(instructions)
        parts.append("</segment-instructions>")
    content_context_msg: str | None = "\n".join(parts) if parts else None

    llm_messages, pending_context = merge_existing_messages(existing)
    if user_message:
        content = user_message
        extras = list(pending_context)
        if content_context_msg:
            extras.append(content_context_msg)
        if extras:
            content = "\n\n".join(extras) + "\n\n" + content
        llm_messages.append({"role": "user", "content": content})

    return ScenarioTurn(
        llm_messages=llm_messages,
        stage=ChatStage(type="chat", instructions=None),
        current_content=None,
        course_overview=None,
        instructions=instructions,
        section_title=section_name,
        system_messages_to_persist=[content_context_msg] if content_context_msg else [],
    )


# Back-compat shim: existing callers (the /tutor-turn + /inspect endpoints
# pre-rename) call `fixture_section_to_scenario(fixture, idx, messages)`.
# Forward to the new name. New code should call `stage_group_to_scenario`.
def fixture_section_to_scenario(
    fixture: dict, section_index: int, messages: list[dict]
) -> ScenarioTurn:
    return stage_group_to_scenario(fixture, section_index, messages)
