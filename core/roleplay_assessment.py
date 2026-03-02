"""
AI assessment module for roleplay transcripts.

Mirrors the question assessment pattern in core/assessment.py:
builds prompts from transcript + rubric, calls LiteLLM with structured output,
and writes scores to the roleplay_assessments table. Runs as a background
task without blocking API responses.
"""

import asyncio
import json
import logging

import sentry_sdk

from core.assessment import SCORE_SCHEMA, SCORING_PROVIDER
from core.database import get_transaction
from core.modules.llm import complete
from core.tables import roleplay_assessments

logger = logging.getLogger(__name__)

# Prompt version for tracking in roleplay_assessments.prompt_version
ROLEPLAY_PROMPT_VERSION = "v1"

# Track running tasks to prevent GC (asyncio only keeps weak references)
_running_tasks: set[asyncio.Task] = set()

# Base system prompt for roleplay assessment scoring
ROLEPLAY_ASSESSMENT_SYSTEM_PROMPT = (
    "You are a rigorous educational assessor evaluating a student's "
    "performance in a roleplay scenario. Score the student's responses "
    "against the rubric based on the full conversation transcript. "
    "Measure actual understanding and skill demonstrated, not effort."
)


def format_transcript(messages: list[dict]) -> str:
    """Format chat_sessions.messages for the scoring prompt.

    Args:
        messages: List of message dicts with 'role' and 'content' keys.

    Returns:
        Formatted transcript with Student/Character labels.
    """
    lines = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if role == "user":
            lines.append(f"Student: {content}")
        elif role == "assistant":
            lines.append(f"Character: {content}")
    return "\n\n".join(lines)


def _build_roleplay_scoring_prompt(
    *,
    transcript: str,
    assessment_instructions: str,
    scenario_context: str | None = None,
) -> tuple[str, list[dict]]:
    """Build system prompt and messages for roleplay scoring.

    Args:
        transcript: Formatted conversation transcript.
        assessment_instructions: Rubric/assessment criteria from content.
        scenario_context: Optional scenario briefing text for context.

    Returns:
        Tuple of (system_prompt, messages_list).
    """
    system = ROLEPLAY_ASSESSMENT_SYSTEM_PROMPT

    if assessment_instructions:
        system += f"\n\nScoring Rubric:\n{assessment_instructions}"

    if scenario_context:
        system += f"\n\nScenario Context:\n{scenario_context}"

    messages = [
        {
            "role": "user",
            "content": (
                f"Full conversation transcript:\n\n{transcript}\n\n"
                "Score this student's performance according to the rubric."
            ),
        }
    ]

    return system, messages


def enqueue_roleplay_scoring(
    session_id: int,
    messages: list[dict],
    segment_snapshot: dict,
) -> None:
    """Fire-and-forget: score a roleplay session in the background.

    Args:
        session_id: The chat_sessions.session_id to score.
        messages: Conversation messages from the chat session.
        segment_snapshot: Snapshot of the roleplay segment content,
            containing assessment instructions and scenario context.
    """
    task = asyncio.create_task(
        _score_roleplay_session(session_id, messages, segment_snapshot),
        name=f"roleplay-score-{session_id}",
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
        logger.error("Roleplay scoring task %s failed: %s", task.get_name(), exc)
        sentry_sdk.capture_exception(exc)


async def _score_roleplay_session(
    session_id: int,
    messages: list[dict],
    segment_snapshot: dict,
) -> None:
    """Score a single roleplay session and write to roleplay_assessments.

    Args:
        session_id: The session to score.
        messages: Conversation messages from the chat session.
        segment_snapshot: Snapshot with assessment instructions and context.
    """
    # Extract assessment instructions (try both camelCase and kebab-case)
    assessment_instructions = segment_snapshot.get(
        "assessmentInstructions"
    ) or segment_snapshot.get("assessment-instructions")

    if not assessment_instructions:
        logger.warning(
            "No assessment instructions in segment_snapshot for session %d, "
            "skipping scoring",
            session_id,
        )
        return

    # Extract scenario context from snapshot
    scenario_context = segment_snapshot.get("content")

    # Format transcript
    transcript = format_transcript(messages)

    if not transcript.strip():
        logger.warning("Empty transcript for session %d, skipping scoring", session_id)
        return

    # Build prompt
    system, prompt_messages = _build_roleplay_scoring_prompt(
        transcript=transcript,
        assessment_instructions=assessment_instructions,
        scenario_context=scenario_context,
    )

    # Call LLM
    raw_response = await complete(
        messages=prompt_messages,
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
            roleplay_assessments.insert().values(
                session_id=session_id,
                score_data=score_data,
                model_id=SCORING_PROVIDER,
                prompt_version=ROLEPLAY_PROMPT_VERSION,
            )
        )

    logger.info(
        "Scored roleplay session %d: overall=%s",
        session_id,
        score_data.get("overall_score"),
    )
