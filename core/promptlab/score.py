"""Prompt Lab assessment scoring.

Wraps complete() from core/modules/llm.py with Prompt Lab-specific concerns:
custom system prompts, structured scoring output, and no database writes.

Per INFRA-03: imports from core/modules/llm.py directly, NOT from assessment.py's
background scoring pipeline.
Per INFRA-04: does NOT import database modules or write to any tables.
"""

import json

from core.assessment import SCORE_SCHEMA
from core.modules.llm import complete


async def score_response(
    base_system_prompt: str,
    assessment_instructions: str,
    question_text: str,
    answer_text: str,
    provider: str | None = None,
    max_tokens: int = 512,
) -> dict:
    """
    Score a student's answer using a custom assessment prompt.

    This is the Prompt Lab scoring function. Unlike the production scoring
    pipeline, it accepts an arbitrary base system prompt (editable by
    facilitator) and does not write to the database.

    Args:
        base_system_prompt: The base assessment persona prompt (editable).
        assessment_instructions: Rubric/criteria for scoring this question.
        question_text: The question shown to the student.
        answer_text: The student's response text.
        provider: LLM provider string. If None, uses DEFAULT_PROVIDER.
        max_tokens: Maximum tokens in response.

    Returns:
        Parsed score dict with keys: overall_score, reasoning,
        and optionally dimensions, key_observations.
    """
    system = base_system_prompt + "\n\nScoring Rubric:\n" + assessment_instructions

    messages = [
        {
            "role": "user",
            "content": (
                f"Question: {question_text}\n\n"
                f"Student's answer: {answer_text}\n\n"
                "Score this response according to the rubric."
            ),
        }
    ]

    raw = await complete(
        messages=messages,
        system=system,
        response_format=SCORE_SCHEMA,
        provider=provider,
        max_tokens=max_tokens,
    )

    return json.loads(raw)
