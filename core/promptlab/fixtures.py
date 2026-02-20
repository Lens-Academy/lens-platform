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


class FixtureSystemPrompt(TypedDict):
    base: str
    instructions: str


class FixtureMessage(TypedDict):
    role: str  # "user" or "assistant"
    content: str


class FixtureSummary(TypedDict):
    name: str
    module: str
    description: str


class Fixture(TypedDict):
    name: str
    module: str
    description: str
    systemPrompt: FixtureSystemPrompt
    previousContent: str
    messages: list[FixtureMessage]


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

    Iterates JSON files in FIXTURES_DIR and returns the first one where
    the 'name' field matches. Returns None if not found.
    """
    if not FIXTURES_DIR.exists():
        return None

    for path in FIXTURES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
            if data.get("name") == name:
                return Fixture(
                    name=data["name"],
                    module=data["module"],
                    description=data["description"],
                    systemPrompt=FixtureSystemPrompt(
                        base=data["systemPrompt"]["base"],
                        instructions=data["systemPrompt"]["instructions"],
                    ),
                    previousContent=data["previousContent"],
                    messages=[
                        FixtureMessage(role=m["role"], content=m["content"])
                        for m in data["messages"]
                    ],
                )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: skipping malformed fixture {path.name}: {e}")

    return None
