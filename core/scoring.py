"""
AI scoring module for question responses.

Builds prompts from question context, calls LiteLLM with structured output,
and writes scores to the question_assessments table. Runs as a background
task without blocking API responses.
"""

import asyncio
import json
import logging
import os

import sentry_sdk

from core.database import get_transaction
from core.modules.llm import DEFAULT_PROVIDER, complete
from core.modules.loader import ModuleNotFoundError, load_flattened_module
from core.tables import question_assessments

logger = logging.getLogger(__name__)

# Scoring-specific model (may differ from chat model)
SCORING_PROVIDER = os.environ.get("SCORING_PROVIDER") or DEFAULT_PROVIDER

# Prompt version for tracking in question_assessments.assessment_system_prompt_version
ASSESSMENT_SYSTEM_PROMPT_VERSION = "v2"

# Track running tasks to prevent GC (asyncio only keeps weak references)
_running_tasks: set[asyncio.Task] = set()

# Structured output schema for LLM scoring responses
SCORE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "assessment_score",
        "schema": {
            "type": "object",
            "properties": {
                "overall_score": {
                    "type": "integer",
                    "description": "1-5 scale",
                },
                "reasoning": {
                    "type": "string",
                    "description": "2-3 sentence explanation",
                },
                "dimensions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "score": {"type": "integer"},
                            "note": {"type": "string"},
                        },
                        "required": ["name", "score"],
                        "additionalProperties": False,
                    },
                },
                "key_observations": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["overall_score", "reasoning"],
            "additionalProperties": False,
        },
    },
}


def enqueue_scoring(response_id: int, question_context: dict) -> None:
    """
    Fire-and-forget: score a response in the background.

    Args:
        response_id: The question_responses.response_id to score
        question_context: Dict with keys: question_id, module_slug, answer_text
    """
    task = asyncio.create_task(
        _score_response(response_id, question_context),
        name=f"score-{response_id}",
    )
    _running_tasks.add(task)
    task.add_done_callback(_task_done)


def _task_done(task: asyncio.Task) -> None:
    """Callback to clean up completed tasks and log errors."""
    _running_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        logger.error("Scoring task %s failed: %s", task.get_name(), exc)
        sentry_sdk.capture_exception(exc)


def _build_scoring_prompt(
    *,
    answer_text: str,
    question_text: str,
    assessment_instructions: str | None,
    learning_outcome_name: str | None,
) -> tuple[str, list[dict]]:
    """
    Build system prompt and messages for scoring.

    Args:
        answer_text: The student's response text
        question_text: The question text shown to the student
        assessment_instructions: Optional rubric/assessment criteria
        learning_outcome_name: Optional learning outcome name for context

    Returns:
        Tuple of (system_prompt, messages_list)
    """
    system = (
        "You are a rigorous educational assessor. "
        "Score this student's response against the rubric precisely. "
        "Measure actual understanding demonstrated, not effort."
    )

    # Add learning outcome context if available
    if learning_outcome_name:
        system += f"\n\nLearning Outcome: {learning_outcome_name}"

    # Add custom rubric if provided
    if assessment_instructions:
        system += f"\n\nScoring Rubric:\n{assessment_instructions}"

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

    return system, messages


def _resolve_question_details(module_slug: str, question_id: str) -> dict:
    """
    Look up question text, assessment instructions, and learning outcome name
    from the content cache.

    question_id format: "moduleSlug:sectionIndex:segmentIndex"

    Args:
        module_slug: The module slug to look up
        question_id: Position-based question identifier

    Returns:
        Dict with keys: question_text, assessment_instructions,
        learning_outcome_name. Empty dict on any lookup failure.
    """
    try:
        module = load_flattened_module(module_slug)
    except ModuleNotFoundError:
        logger.warning("Module %s not found for scoring", module_slug)
        return {}

    # Parse position from question_id
    parts = question_id.split(":")
    if len(parts) != 3:
        logger.warning("Invalid question_id format: %s", question_id)
        return {}

    _, section_idx_str, segment_idx_str = parts
    try:
        section_idx = int(section_idx_str)
        segment_idx = int(segment_idx_str)
    except ValueError:
        logger.warning("Non-integer indices in question_id: %s", question_id)
        return {}

    if section_idx >= len(module.sections):
        logger.warning(
            "Section index %d out of bounds for module %s", section_idx, module_slug
        )
        return {}

    section = module.sections[section_idx]
    segments = section.get("segments", [])
    if segment_idx >= len(segments):
        logger.warning(
            "Segment index %d out of bounds in section %d of module %s",
            segment_idx,
            section_idx,
            module_slug,
        )
        return {}

    segment = segments[segment_idx]
    if segment.get("type") != "question":
        logger.warning(
            "Segment at %d:%d is type '%s', not 'question'",
            section_idx,
            segment_idx,
            segment.get("type"),
        )
        return {}

    return {
        "question_text": segment.get("content", ""),
        "assessment_instructions": segment.get("assessmentInstructions"),
        "learning_outcome_name": section.get("learningOutcomeName"),
    }


async def _score_response(response_id: int, ctx: dict) -> None:
    """
    Score a single response and write to question_assessments.

    Args:
        response_id: The response to score
        ctx: Context dict with question_id, module_slug, answer_text,
             and optionally question_text, assessment_instructions
    """
    # Prefer question_text from the row snapshot (new path),
    # fall back to content cache lookup (deployment safety during rollout)
    question_text = ctx.get("question_text")
    assessment_instructions = ctx.get("assessment_instructions")

    # Resolve learning_outcome_name from content cache
    # (these are not stored on the row)
    question_details = _resolve_question_details(
        module_slug=ctx["module_slug"],
        question_id=ctx["question_id"],
    )

    if not question_text:
        # Fallback: read from content cache
        if not question_details:
            logger.warning(
                "Could not resolve question details for response %d, skipping scoring",
                response_id,
            )
            return
        question_text = question_details["question_text"]
        assessment_instructions = question_details.get("assessment_instructions")

    learning_outcome_name = (
        question_details.get("learning_outcome_name") if question_details else None
    )

    # Build prompt
    system, messages = _build_scoring_prompt(
        answer_text=ctx["answer_text"],
        question_text=question_text,
        assessment_instructions=assessment_instructions,
        learning_outcome_name=learning_outcome_name,
    )

    # Call LLM
    raw_response = await complete(
        messages=messages,
        system=system,
        response_format=SCORE_SCHEMA,
        provider=SCORING_PROVIDER,
        max_tokens=512,
    )

    # Parse structured response
    score_data = json.loads(raw_response)

    # Write to DB
    async with get_transaction() as conn:
        await conn.execute(
            question_assessments.insert().values(
                response_id=response_id,
                score_data=score_data,
                model_id=SCORING_PROVIDER,
                assessment_system_prompt_version=ASSESSMENT_SYSTEM_PROMPT_VERSION,
            )
        )

    logger.info(
        "Scored response %d: overall=%s",
        response_id,
        score_data.get("overall_score"),
    )
