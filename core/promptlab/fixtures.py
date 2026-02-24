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


class AssessmentItem(TypedDict):
    label: str
    question: str
    answer: str


class AssessmentSection(TypedDict):
    name: str
    instructions: str  # rubric
    items: list[AssessmentItem]


class FixtureSummary(TypedDict):
    name: str
    module: str
    description: str
    type: str  # "chat" or "assessment"


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
                    type=data.get("type", "chat"),
                )
            )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: skipping malformed fixture {path.name}: {e}")

    fixtures.sort(key=lambda f: f["name"])
    return fixtures


def load_fixture(name: str) -> dict | None:
    """Load a specific fixture by name.

    Supports three JSON formats:

    **Assessment format**: has ``"type": "assessment"`` with sections
    containing items (question/answer pairs) instead of conversations.

    **Sectioned format** (chat): has a top-level "sections" array, each with
    name, instructions, context, and conversations.

    **Flat format** (legacy chat): has top-level instructions, context, and
    conversations. Normalized into a single section using the fixture name.
    """
    if not FIXTURES_DIR.exists():
        return None

    for path in FIXTURES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
            if data.get("name") != name:
                continue

            fixture_type = data.get("type", "chat")

            # Assessment fixtures
            if fixture_type == "assessment":
                sections = [
                    AssessmentSection(
                        name=s["name"],
                        instructions=s["instructions"],
                        items=[
                            AssessmentItem(
                                label=item["label"],
                                question=item["question"],
                                answer=item["answer"],
                            )
                            for item in s["items"]
                        ],
                    )
                    for s in data["sections"]
                ]
                return {
                    "name": data["name"],
                    "module": data["module"],
                    "type": "assessment",
                    "description": data["description"],
                    "baseSystemPrompt": data.get("baseSystemPrompt", ""),
                    "sections": sections,
                }

            # Chat fixtures — sectioned format
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
