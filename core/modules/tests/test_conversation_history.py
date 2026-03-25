# core/modules/tests/test_conversation_history.py
"""
Golden-file test for conversation history with context injection.

Shows the actual JSON messages array sent to LiteLLM across a multi-turn
conversation, including how content context, location markers, and tutor
instructions get merged into user messages.

The fixture stores the FINAL messages array after all turns. Each turn N
sees messages[0 : 2*N] (system prompt + N user/assistant pairs, ending
with the Nth user message).

To update the expected output:
  1. Edit fixtures/conversation_history_expected.json
  2. Run this test — it will fail with a diff
  3. Update production code to match
"""

import json
from pathlib import Path

from core.modules.context import gather_section_context
from core.modules.prompts import (
    build_content_context_message,
    build_location_update_message,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"

SYSTEM_PROMPT = "(base prompt)"

# Two lenses in "Threat Models" module
SECTIONS = {
    "risks-from-ai": {
        "module_title": "Threat Models",
        "section": {
            "meta": {"title": "Risks from AI"},
            "segments": [
                {
                    "type": "text",
                    "content": "This lens covers the key risks from advanced AI systems.",
                },
                {
                    "type": "article-excerpt",
                    "title": "Concrete Problems in AI Safety",
                    "author": "Amodei et al.",
                    "content": "The article content goes here.",
                    "instructions": (
                        "Ask the student what they think about the alignment problem.\n"
                        "Do not give away the answer."
                    ),
                },
                {
                    "type": "chat",
                    "instructions": "Help the student explore the key takeaways from this lens.",
                },
            ],
        },
    },
    "what-could-go-wrong": {
        "module_title": "Threat Models",
        "section": {
            "meta": {"title": "What Could Go Wrong?"},
            "segments": [
                {
                    "type": "text",
                    "content": "This lens surveys the main threat taxonomies.",
                },
                {
                    "type": "chat",
                    "instructions": "Discuss which threat model the student finds most concerning and why.",
                },
            ],
        },
    },
}

TURNS = [
    # Turn 1: First message at segment 2 (article) of "Risks from AI"
    {
        "section_key": "risks-from-ai",
        "segment_index": 1,
        "user_message": "What does reward hacking mean?",
        "assistant_response": "Reward hacking is when an AI finds unintended ways to maximize its reward.",
        "inject": "full_content",
    },
    # Turn 2: Follow-up, same position
    {
        "section_key": "risks-from-ai",
        "segment_index": 1,
        "user_message": "Can you give me an example?",
        "assistant_response": "A classic example is a robot rewarded for moving forward that learns to be very tall and fall over.",
        "inject": "none",
    },
    # Turn 3: Navigate to segment 3 (chat) within same lens
    {
        "section_key": "risks-from-ai",
        "segment_index": 2,
        "user_message": "I think the alignment problem is really about ensuring AI systems do what we actually want.",
        "assistant_response": "That's a great intuition. The alignment problem is fundamentally about the gap between what we specify and what we actually want.",
        "inject": "location_and_instructions",
    },
    # Turn 4: Navigate to a NEW lens — "What Could Go Wrong?" segment 1 (text)
    {
        "section_key": "what-could-go-wrong",
        "segment_index": 0,
        "user_message": "How does this relate to what we just read about concrete problems?",
        "assistant_response": "Great question. The concrete problems paper focuses on near-term technical issues, while threat taxonomies take a broader view.",
        "inject": "full_content",
    },
    # Turn 5: Navigate to segment 2 (chat) within the new lens
    {
        "section_key": "what-could-go-wrong",
        "segment_index": 1,
        "user_message": "I find the misuse risks most concerning.",
        "assistant_response": None,
        "inject": "location_and_instructions",
    },
]


def _get_instructions(section_key: str, segment_index: int) -> str:
    seg = SECTIONS[section_key]["section"]["segments"][segment_index]
    return seg.get("instructions", "Help the user learn about AI safety.")


def _build_all_turns() -> list[dict]:
    """Replay all turns and return the final LLM messages array."""
    db_messages: list[dict] = []

    for turn in TURNS:
        section_key = turn["section_key"]
        section_data = SECTIONS[section_key]
        section = section_data["section"]
        module_title = section_data["module_title"]
        segment_index = turn["segment_index"]

        # Inject context based on turn type
        if turn["inject"] == "full_content":
            ctx = gather_section_context(section, segment_index)
            if ctx:
                ctx.module_title = module_title
                ctx.section_title = section["meta"]["title"]
            instructions = _get_instructions(section_key, segment_index)
            content_msg = build_content_context_message(ctx, instructions)
            db_messages.append({"role": "system", "content": content_msg})

        elif turn["inject"] == "location_and_instructions":
            section_title = section["meta"]["title"]
            location_msg = build_location_update_message(section_title, segment_index)
            instructions = _get_instructions(section_key, segment_index)
            db_messages.append({"role": "system", "content": location_msg})
            db_messages.append(
                {
                    "role": "system",
                    "content": f"<segment-instructions>\n{instructions}\n</segment-instructions>",
                }
            )

        db_messages.append({"role": "user", "content": turn["user_message"]})

        if turn.get("assistant_response"):
            db_messages.append(
                {"role": "assistant", "content": turn["assistant_response"]}
            )

    # Build LLM messages: merge system messages into adjacent user messages
    llm_messages = []
    pending_context: list[str] = []
    for m in db_messages:
        if m["role"] == "system":
            pending_context.append(m["content"])
        elif m["role"] == "user":
            content = m["content"]
            if pending_context:
                content = "\n\n".join(pending_context) + "\n\n" + content
                pending_context.clear()
            llm_messages.append({"role": "user", "content": content})
        elif m["role"] == "assistant":
            llm_messages.append({"role": "assistant", "content": m["content"]})

    # Prepend system prompt
    return [{"role": "system", "content": SYSTEM_PROMPT}] + llm_messages


class TestConversationHistoryGoldenFile:
    """
    Builds a 5-turn conversation and compares the final messages array
    against fixtures/conversation_history_expected.json.

    Each turn N sees messages[0 : 2*N].
    """

    def test_matches_fixture(self):
        actual = _build_all_turns()

        expected_data = json.loads(
            (FIXTURES_DIR / "conversation_history_expected.json").read_text()
        )
        expected = expected_data["messages"]

        assert actual == expected, (
            "Conversation history does not match fixture.\n"
            "To update: edit core/modules/tests/fixtures/conversation_history_expected.json\n\n"
            f"=== ACTUAL ===\n{json.dumps(actual, indent=2)}\n\n"
            f"=== EXPECTED ===\n{json.dumps(expected, indent=2)}"
        )

    def test_turn_slicing(self):
        """Each turn N sees exactly messages[0 : 2*N]."""
        actual = _build_all_turns()

        # Turn 1: system + 1 user message
        assert len(actual[0:2]) == 2
        assert actual[1]["role"] == "user"

        # Turn 5: system + 5 user + 4 assistant = 10 messages
        assert len(actual) == 10
        assert actual[-1]["role"] == "user"  # last turn has no assistant response
