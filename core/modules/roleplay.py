# core/modules/roleplay.py
"""Roleplay prompt assembly, separate from tutor chat.

This module builds system prompts for AI roleplay characters.
It does NOT import from chat.py -- the prompt framing is fundamentally
different (character-in-scene vs tutor-helping-student).
"""

ROLEPLAY_BASE_PROMPT = (
    "You are playing a character in a roleplay scenario for an AI safety "
    "education course. Stay in character at all times. Your behavior, "
    "personality, and responses are defined by the instructions below.\n\n"
    "Important rules:\n"
    "- Stay in character throughout the conversation\n"
    "- Respond naturally as the character would\n"
    "- Do not break character to explain you are an AI\n"
    "- Keep responses conversational and appropriately sized"
)


def build_roleplay_prompt(
    ai_instructions: str,
    scenario_content: str | None = None,
) -> str:
    """Build system prompt for roleplay from content fields.

    Args:
        ai_instructions: Character behavior, personality, rules
            from the ai-instructions:: field.
        scenario_content: Student-facing scenario briefing from
            the content:: field. Included so the AI understands
            what the student was told about the scenario.

    Returns:
        Assembled system prompt string.
    """
    prompt = ROLEPLAY_BASE_PROMPT
    prompt += f"\n\nCharacter Instructions:\n{ai_instructions}"
    if scenario_content:
        prompt += f"\n\nScenario Context (what the student sees):\n{scenario_content}"
    return prompt
