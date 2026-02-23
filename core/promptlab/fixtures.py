"""
Fixture listing and loading for the Prompt Lab.

Fixtures are curated conversation snapshots stored as JSON files in the
fixtures/ directory. They capture real tutor-student interactions for
facilitators to use when iterating on system prompts.
"""

import json
from pathlib import Path
from typing import TypedDict

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class FixtureMessage(TypedDict):
    role: str  # "user" or "assistant"
    content: str


class FixtureConversation(TypedDict):
    label: str
    messages: list[FixtureMessage]


class FixtureSection(TypedDict):
    name: str
    instructions: str
    context: str
    conversations: list[FixtureConversation]


class FixtureSummary(TypedDict):
    name: str
    module: str
    description: str


class Fixture(TypedDict):
    name: str
    module: str
    description: str
    sections: list[FixtureSection]


def _parse_conversations(raw: list[dict]) -> list[FixtureConversation]:
    return [
        FixtureConversation(
            label=c["label"],
            messages=[
                FixtureMessage(role=m["role"], content=m["content"])
                for m in c["messages"]
            ],
        )
        for c in raw
    ]


def list_fixtures() -> list[FixtureSummary]:
    """Scan FIXTURES_DIR for *.json files and return metadata for each.

    Returns a list of {name, module, description} dicts sorted by name.
    Returns an empty list if FIXTURES_DIR doesn't exist.
    """
    if not FIXTURES_DIR.exists():
        return []

    fixtures: list[FixtureSummary] = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            fixtures.append(
                FixtureSummary(
                    name=data["name"],
                    module=data["module"],
                    description=data["description"],
                )
            )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: skipping malformed fixture {path.name}: {e}")

    fixtures.sort(key=lambda f: f["name"])
    return fixtures


def load_fixture(name: str) -> Fixture | None:
    """Load a specific fixture by name.

    Supports two JSON formats:

    **Sectioned format** (new): has a top-level "sections" array, each with
    name, instructions, context, and conversations.

    **Flat format** (legacy): has top-level instructions, context, and
    conversations. Normalized into a single section using the fixture name.
    """
    if not FIXTURES_DIR.exists():
        return None

    for path in FIXTURES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
            if data.get("name") != name:
                continue

            # Sectioned format
            if "sections" in data:
                sections = [
                    FixtureSection(
                        name=s["name"],
                        instructions=s["instructions"],
                        context=s["context"],
                        conversations=_parse_conversations(s["conversations"]),
                    )
                    for s in data["sections"]
                ]
            else:
                # Flat format — wrap in a single section
                sections = [
                    FixtureSection(
                        name=data["name"],
                        instructions=data["instructions"],
                        context=data["context"],
                        conversations=_parse_conversations(data["conversations"]),
                    )
                ]

            return Fixture(
                name=data["name"],
                module=data["module"],
                description=data["description"],
                sections=sections,
            )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: skipping malformed fixture {path.name}: {e}")

    return None
