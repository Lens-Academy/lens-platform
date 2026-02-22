"""
AI scoring module for question responses.

Builds prompts from question context, calls LiteLLM with structured output,
and writes scores to the question_assessments table. Supports socratic vs
assessment mode. Runs as a background task without blocking API responses.
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

# Prompt version for tracking in question_assessments.prompt_version
PROMPT_VERSION = "v1"

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
                    "type": "object",
                    "additionalProperties": {
                        "type": "object",
                        "properties": {
                            "score": {"type": "integer"},
                            "note": {"type": "string"},
                        },
                        "required": ["score"],
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
    user_instruction: str,
    assessment_prompt: str | None,
    learning_outcome_name: str | None,
    mode: str,
) -> tuple[str, list[dict]]:
    """
    Build system prompt and messages for scoring.

    Args:
        answer_text: The student's response text
        user_instruction: The question text shown to the student
        assessment_prompt: Optional rubric/assessment criteria
        learning_outcome_name: Optional learning outcome name for context
        mode: "socratic" or "assessment"

    Returns:
        Tuple of (system_prompt, messages_list)
    """
    if mode == "socratic":
        system = (
            "You are a supportive educational assessor. "
            "Score this student's response with emphasis on effort, engagement, "
            "and learning progress. Be generous with partial understanding. "
            "The goal is to track learning, not to judge."
        )
    else:  # assessment
        system = (
            "You are a rigorous educational assessor. "
            "Score this student's response against the rubric precisely. "
            "Measure actual understanding demonstrated, not effort."
        )

    # Add learning outcome context if available
    if learning_outcome_name:
        system += f"\n\nLearning Outcome: {learning_outcome_name}"

    # Add custom rubric if provided
    if assessment_prompt:
        system += f"\n\nScoring Rubric:\n{assessment_prompt}"

    messages = [
        {
            "role": "user",
            "content": (
                f"Question: {user_instruction}\n\n"
                f"Student's answer: {answer_text}\n\n"
                "Score this response according to the rubric."
            ),
        }
    ]

    return system, messages


def _resolve_question_details(module_slug: str, question_id: str) -> dict:
    """
    Look up question text, assessment prompt, learning outcome name,
    and scoring mode from the content cache.

    question_id format: "moduleSlug:sectionIndex:segmentIndex"

    Args:
        module_slug: The module slug to look up
        question_id: Position-based question identifier

    Returns:
        Dict with keys: user_instruction, assessment_prompt,
        learning_outcome_name, mode. Empty dict on any lookup failure.
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

    # Determine mode: test sections = assessment, everything else = socratic
    mode = "assessment" if section.get("type") == "test" else "socratic"

    return {
        "user_instruction": segment.get("userInstruction", ""),
        "assessment_prompt": segment.get("assessmentPrompt"),
        "learning_outcome_name": section.get("learningOutcomeName"),
        "mode": mode,
    }


async def _score_response(response_id: int, ctx: dict) -> None:
    """
    Score a single response and write to question_assessments.

    Args:
        response_id: The response to score
        ctx: Context dict with question_id, module_slug, answer_text,
             and optionally question_text, assessment_prompt
    """
    # Prefer question_text from the row snapshot (new path),
    # fall back to content cache lookup (deployment safety during rollout)
    user_instruction = ctx.get("question_text")
    assessment_prompt = ctx.get("assessment_prompt")

    # Resolve mode and learning_outcome_name from content cache
    # (these are not stored on the row)
    question_details = _resolve_question_details(
        module_slug=ctx["module_slug"],
        question_id=ctx["question_id"],
    )

    if not user_instruction:
        # Fallback: read from content cache
        if not question_details:
            logger.warning(
                "Could not resolve question details for response %d, skipping scoring",
                response_id,
            )
            return
        user_instruction = question_details["user_instruction"]
        assessment_prompt = question_details.get("assessment_prompt")

    mode = question_details.get("mode", "socratic") if question_details else "socratic"
    learning_outcome_name = (
        question_details.get("learning_outcome_name") if question_details else None
    )

    # Build prompt
    system, messages = _build_scoring_prompt(
        answer_text=ctx["answer_text"],
        user_instruction=user_instruction,
        assessment_prompt=assessment_prompt,
        learning_outcome_name=learning_outcome_name,
        mode=mode,
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
                prompt_version=PROMPT_VERSION,
            )
        )

    logger.info(
        "Scored response %d: overall=%s",
        response_id,
        score_data.get("overall_score"),
    )
