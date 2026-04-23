"""Pure helpers for building a tutor turn's system prompt and message list.

Extracted from web_api/routes/module.py's event_generator so that Prompt Lab
can reproduce the exact same inputs the production tutor sends to the LLM,
without any DB dependency. The tutor route wraps this with DB persistence;
Prompt Lab wraps it with a ephemeral UI-driven state.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .context import gather_section_context
from .prompts import (
    build_content_context_message,
    build_course_overview,
    build_location_update_message,
)
from .types import ChatStage

logger = logging.getLogger(__name__)


@dataclass
class ScenarioTurn:
    """Everything derived from module data + conversation state for one turn.

    The tutor route persists the system/user messages and streams the LLM
    reply; Prompt Lab only uses the LLM-facing fields.
    """

    llm_messages: list[dict]
    stage: ChatStage
    current_content: str | None
    course_overview: str | None
    instructions: str
    section_title: str | None
    # DB-persistence fields (ignored by Prompt Lab):
    system_messages_to_persist: list[str] = field(default_factory=list)


def _build_segment_instructions(
    section: dict,
    segments: list[dict],
    current_segment: dict,
    roleplay_transcript: str | None,
) -> str:
    """Build segment-specific tutor instructions based on segment type.

    Mirrors the if/elif/else ladder in event_generator(). Kept pure so
    Prompt Lab can call it too.
    """
    if section.get("type") == "test":
        instructions = "The student has completed a test. Here is the context:\n"
        learning_outcome_name = section.get("learningOutcomeName")
        if learning_outcome_name:
            instructions += f"\nLearning Outcome: {learning_outcome_name}"
        for seg in segments:
            if seg.get("type") == "question":
                instructions += f"\n\nQuestion: {seg.get('content', '')}"
                if seg.get("assessmentInstructions"):
                    instructions += f"\nRubric:\n{seg['assessmentInstructions']}"
        return instructions

    if current_segment.get("type") == "question":
        question_text = current_segment.get("content", "")
        assessment_instructions = current_segment.get("assessmentInstructions")
        learning_outcome_name = section.get("learningOutcomeName")

        instructions = (
            "The student answered a question. Here is the context:\n\n"
            f"Question: {question_text}"
        )
        if learning_outcome_name:
            instructions += f"\nLearning Outcome: {learning_outcome_name}"
        if assessment_instructions:
            instructions += f"\nRubric:\n{assessment_instructions}"
        return instructions

    if current_segment.get("type") == "roleplay":
        scenario_content = current_segment.get("content", "")
        assessment_instructions = current_segment.get("assessmentInstructions")
        learning_outcome_name = section.get("learningOutcomeName")

        instructions = (
            "The student has completed a roleplay exercise and wants to discuss "
            "their performance. Give specific, constructive feedback.\n\n"
            f"Scenario: {scenario_content}"
        )
        if learning_outcome_name:
            instructions += f"\nLearning Outcome: {learning_outcome_name}"
        if assessment_instructions:
            instructions += f"\nAssessment criteria:\n{assessment_instructions}"
        if roleplay_transcript:
            instructions += f"\n\nRoleplay transcript:\n{roleplay_transcript}"
        return instructions

    return current_segment.get("instructions", "Help the user learn about AI safety.")


def merge_existing_messages(
    existing_messages: list[dict],
) -> tuple[list[dict], list[str]]:
    """Walk existing_messages, merging system-role messages into the next user.

    Returns (llm_messages_so_far, pending_system_context). Any system messages
    AFTER the last user message remain in pending_system_context — the caller
    prepends them to the new user message along with the new turn's context.
    """
    llm_messages: list[dict] = []
    pending_context: list[str] = []
    for m in existing_messages:
        role = m.get("role")
        if role == "system":
            pending_context.append(m["content"])
        elif role == "user":
            content = m["content"]
            if pending_context:
                content = "\n\n".join(pending_context) + "\n\n" + content
                pending_context = []
            llm_messages.append({"role": "user", "content": content})
        elif role == "assistant":
            msg = {"role": "assistant", "content": m.get("content", "")}
            if "tool_calls" in m:
                msg["tool_calls"] = m["tool_calls"]
            llm_messages.append(msg)
        elif role == "tool":
            llm_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": m["tool_call_id"],
                    "name": m["name"],
                    "content": m["content"],
                }
            )
    return llm_messages, pending_context


def build_scenario_turn(
    module: Any,
    section_index: int,
    segment_index: int,
    existing_messages: list[dict],
    user_message: str,
    course_slug: str | None = None,
    roleplay_transcript: str | None = None,
    include_course_overview: bool = True,
    instructions_override: str | None = None,
    content_context_override: str | None = None,
    course_overview_override: str | None = None,
    llm_messages_override: list[dict] | None = None,
) -> ScenarioTurn:
    """Build the LLM inputs for one tutor turn from module data + history.

    Args:
        module: Loaded module (from load_flattened_module).
        section_index: 0-based section index.
        segment_index: 0-based segment index within section.
        existing_messages: Prior conversation including position metadata on
            user messages (sectionIndex, segmentIndex). System messages from
            past turns will be merged into adjacent user messages.
        user_message: The new user message to append. May be "".
        course_slug: If given and include_course_overview is True, load the
            course and inject its overview into the system prompt.
        roleplay_transcript: Pre-formatted transcript for roleplay-feedback
            segments. Loaded by the caller (DB query in production tutor,
            skipped or pasted-in for Prompt Lab).
        include_course_overview: Prompt Lab toggle; False suppresses course
            overview even when course_slug is given.
        instructions_override: Prompt Lab only. Replaces the result of
            `_build_segment_instructions()` verbatim — the override is what
            gets wrapped in `<segment-instructions>…</segment-instructions>`
            inside the content-context message.
        content_context_override: Prompt Lab only. Replaces the full
            `<lens>…</lens>` content-context block verbatim — `gather_section_context`
            and `build_content_context_message` are both skipped. Named
            `content_context` (not `current_content`) to avoid collision
            with `ScenarioTurn.current_content`, a different field used
            only for article/video stages.
        course_overview_override: Prompt Lab only. Replaces the course
            overview string verbatim — course loading and
            `build_course_overview()` are both skipped. Overrides the
            `include_course_overview` toggle.
        llm_messages_override: Prompt Lab only. Replaces the assembled
            `llm_messages` list entirely — the `merge_existing_messages`
            walk, content-context prepending, and user-message appending
            are all skipped. `ScenarioTurn.system_messages_to_persist`
            will be empty when this is used (nothing was built).

    Returns a ScenarioTurn ready to feed into send_module_message().
    """
    section = (
        module.sections[section_index] if section_index < len(module.sections) else {}
    )
    section_title = section.get("meta", {}).get("title")

    last_section_idx = None
    last_segment_idx = None
    for m in reversed(existing_messages):
        if m.get("role") == "user" and m.get("sectionIndex") is not None:
            last_section_idx = m["sectionIndex"]
            last_segment_idx = m.get("segmentIndex")
            break

    has_user_message = any(m.get("role") == "user" for m in existing_messages)

    needs_full_content = False
    needs_location_update = False
    section_context = None

    if not has_user_message:
        needs_full_content = True
    elif has_user_message and last_section_idx is not None:
        if last_section_idx != section_index:
            needs_full_content = True
        elif last_segment_idx is not None and last_segment_idx != segment_index:
            needs_location_update = True

    system_messages_to_persist: list[str] = []

    if needs_full_content:
        section_context = gather_section_context(section, segment_index)
        if section_context:
            section_context.module_title = module.title
            section_context.section_title = section_title
            section_context.learning_outcome = section.get("learningOutcomeName")
    elif needs_location_update and section_title:
        location_msg = build_location_update_message(section_title, segment_index)
        system_messages_to_persist.append(location_msg)

    segments = section.get("segments", [])
    current_segment = segments[segment_index] if segment_index < len(segments) else {}

    if instructions_override is not None:
        instructions = instructions_override
    else:
        instructions = _build_segment_instructions(
            section=section,
            segments=segments,
            current_segment=current_segment,
            roleplay_transcript=roleplay_transcript,
        )

    if content_context_override is not None:
        content_context_msg: str | None = content_context_override
    elif needs_full_content and section_context:
        content_context_msg = build_content_context_message(
            section_context, instructions
        )
    elif needs_location_update:
        content_context_msg = (
            f"<segment-instructions>\n{instructions}\n</segment-instructions>"
        )
    else:
        content_context_msg = None

    if content_context_msg:
        system_messages_to_persist.append(content_context_msg)

    if llm_messages_override is not None:
        llm_messages = list(llm_messages_override)
        # Override replaces the whole merge/append pipeline. Clear what would
        # have been saved — nothing was actually built.
        system_messages_to_persist = []
    else:
        # Merge existing_messages, then append this turn's user message
        # (prefixed with the just-built content_context_msg when present).
        # Matches the production tutor: location_msg is saved to DB but NOT
        # prepended to the current turn's user message — it gets picked up
        # on the next turn via existing_messages instead.
        llm_messages, pending_context = merge_existing_messages(existing_messages)
        if user_message:
            content = user_message
            extras = list(pending_context)
            if content_context_msg:
                extras.append(content_context_msg)
            if extras:
                content = "\n\n".join(extras) + "\n\n" + content
            llm_messages.append({"role": "user", "content": content})

    if course_overview_override is not None:
        course_overview: str | None = course_overview_override
    else:
        course_overview = None
        if include_course_overview and course_slug:
            try:
                from .course_loader import load_course

                course = load_course(course_slug)
                course_overview = build_course_overview(course)
            except Exception as e:
                logger.warning("Failed to build course overview: %s", e)

    return ScenarioTurn(
        llm_messages=llm_messages,
        stage=ChatStage(type="chat", instructions=None),
        current_content=None,
        course_overview=course_overview,
        instructions=instructions,
        section_title=section_title,
        system_messages_to_persist=system_messages_to_persist,
    )
