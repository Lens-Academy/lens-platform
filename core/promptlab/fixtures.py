"""
Fixture listing and loading for the Prompt Lab.

Fixtures are curated conversation snapshots stored as JSON files in the
fixtures/ directory. They capture real tutor-student interactions for
facilitators to use when iterating on system prompts.
"""

import json
from pathlib import Path
from typing import TypedDict

from core.modules.tutor_scenario import (
    ScenarioTurn,
    build_scenario_turn,
    merge_existing_messages,
)
from core.modules.types import ChatStage

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
    baseSystemPrompt: str
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
                baseSystemPrompt=data.get("baseSystemPrompt", ""),
                sections=sections,
            )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: skipping malformed fixture {path.name}: {e}")

    return None


def fixture_section_to_scenario(
    fixture: dict,
    section_index: int,
    messages: list[dict],
) -> ScenarioTurn:
    """Convert a fixture section + conversation to a ScenarioTurn.

    Unifies fixture and live-module pipelines: the returned ScenarioTurn is
    fed to `send_module_message` exactly like a live-built scenario, so
    fixtures and the production tutor go through identical LLM-facing code.

    **New-format fixtures** (sections carry `moduleSlug` + `sectionIndex` +
    `segmentIndex`): delegates to `build_scenario_turn` so assembly is
    byte-identical to the live tutor path.

    **Legacy fixtures** (no module refs): synthesizes a ScenarioTurn from
    stored strings. `section.instructions` → `ScenarioTurn.instructions` +
    `<segment-instructions>` block. `section.context` → `<lens>…</lens>`
    content block. The <lens>/<segment-instructions> wrapping matches the
    live tutor's shape so the LLM sees the same structure either way.

    `fixture.baseSystemPrompt` is NOT consumed here — it's a system-prompt
    level concern, not a scenario concern. Caller (the /tutor-turn endpoint)
    threads it through as `system_prompt_override` if desired.

    Args:
        fixture: Full fixture dict as returned by `load_fixture`.
        section_index: Which section of the fixture to use.
        messages: Conversation so far. If the last entry is a user message,
            it is treated as the new turn's input (content-context is
            prepended to it, matching `build_scenario_turn` semantics).

    Returns:
        A ScenarioTurn ready to feed into `send_module_message`.
    """
    section = fixture["sections"][section_index]
    section_name = section.get("name")

    user_message = ""
    existing = list(messages)
    if existing and existing[-1].get("role") == "user":
        user_message = existing[-1].get("content", "")
        existing = existing[:-1]

    module_slug = section.get("moduleSlug")
    if module_slug is not None:
        from core.modules.loader import load_flattened_module

        module = load_flattened_module(module_slug)
        return build_scenario_turn(
            module=module,
            section_index=section.get("sectionIndex", 0),
            segment_index=section.get("segmentIndex", 0),
            existing_messages=existing,
            user_message=user_message,
            course_slug=section.get("courseSlug"),
        )

    instructions = section.get("instructions", "") or ""
    context = section.get("context", "") or ""

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
        system_messages_to_persist=[],
    )
