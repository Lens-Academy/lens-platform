"""
Module chat API routes.

Endpoints:
- POST /api/chat/module - Send message and stream response
- GET /api/chat/module/{slug}/history - Get chat history for a module
"""

import json
import logging
import sys
from pathlib import Path
from uuid import UUID

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.modules import ModuleNotFoundError
from core.modules.chat import send_module_message
from core.modules.chat_sessions import (
    add_chat_message,
    get_latest_roleplay_session,
    get_or_create_chat_session,
)
from core.modules.context import gather_section_context
from core.modules.loader import load_flattened_module
from core.modules.types import ChatStage
from web_api.auth import get_user_or_anonymous

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["module"])


def _segment_context_label(segment_type: str) -> str | None:
    return {
        "chat": "Moved to chat segment",
        "question": "Working on a question",
        "roleplay": "Started roleplay exercise",
        "article": "Reading article excerpt",
        "video": "Watching video",
        "text": "Reading text",
        # Backward compat for historical chat sessions
        "article-excerpt": "Reading article excerpt",
        "video-excerpt": "Watching video",
    }.get(segment_type)


class ModuleChatRequest(BaseModel):
    """Request body for module chat."""

    slug: str
    sectionIndex: int
    segmentIndex: int
    message: str


class ChatHistoryResponse(BaseModel):
    """Response for chat history endpoint."""

    sessionId: int
    messages: list[dict]


async def event_generator(
    user_id: int | None,
    anonymous_token: UUID | None,
    module,
    section_index: int,
    segment_index: int,
    user_message: str,
    app=None,
):
    """Generate SSE events from chat interaction."""
    # Get or create chat session
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=module.content_id,
        )
        session_id = session["session_id"]
        existing_messages = session.get("messages", [])

        # Detect position change from previous user message
        context_msg_content: str | None = None
        last_section_idx = None
        last_segment_idx = None
        for m in reversed(existing_messages):
            if m.get("role") == "user" and m.get("sectionIndex") is not None:
                last_section_idx = m["sectionIndex"]
                last_segment_idx = m.get("segmentIndex")
                break

        has_user_message = any(m["role"] == "user" for m in existing_messages)

        if has_user_message and last_section_idx is not None:
            if last_section_idx != section_index:
                # Section changed — inject context message with section title
                section_data = (
                    module.sections[section_index]
                    if section_index < len(module.sections)
                    else {}
                )
                title = section_data.get("meta", {}).get("title")
                if title:
                    context_msg_content = f"Now viewing: {title}"
            elif last_segment_idx is not None and last_segment_idx != segment_index:
                # Segment changed within same section
                section_data = (
                    module.sections[section_index]
                    if section_index < len(module.sections)
                    else {}
                )
                segments = section_data.get("segments", [])
                seg = segments[segment_index] if segment_index < len(segments) else {}
                desc = _segment_context_label(seg.get("type", ""))
                if desc:
                    context_msg_content = desc
        elif not has_user_message:
            # First message — inject current section context
            section_data = (
                module.sections[section_index]
                if section_index < len(module.sections)
                else {}
            )
            title = section_data.get("meta", {}).get("title")
            if title:
                context_msg_content = f"Now viewing: {title}"

        if context_msg_content:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="system",
                content=context_msg_content,
            )

        # Save user message with position metadata
        if user_message:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="user",
                content=user_message,
                sectionIndex=section_index,
                segmentIndex=segment_index,
            )

    # Emit SSE event so the frontend sees system messages in real-time
    if context_msg_content:
        yield f"data: {json.dumps({'type': 'system', 'content': context_msg_content})}\n\n"

    # Get section and gather context
    section = (
        module.sections[section_index] if section_index < len(module.sections) else {}
    )
    section_context = gather_section_context(section, segment_index)
    if section_context:
        section_context.module_title = module.title
        section_context.section_title = section.get("meta", {}).get("title")
        section_context.learning_outcome = section.get("learningOutcomeName")

    # Get chat instructions from segment
    segments = section.get("segments", [])
    current_segment = segments[segment_index] if segment_index < len(segments) else {}

    # Test sections: provide all question context for holistic feedback
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
    # Standalone question segments: provide single-question context
    elif current_segment.get("type") == "question":
        question_text = current_segment.get("content", "")
        assessment_instructions = current_segment.get("assessmentInstructions")
        learning_outcome_name = section.get("learningOutcomeName")

        instructions = f"The student answered a question. Here is the context:\n\nQuestion: {question_text}"
        if learning_outcome_name:
            instructions += f"\nLearning Outcome: {learning_outcome_name}"
        if assessment_instructions:
            instructions += f"\nRubric:\n{assessment_instructions}"
    # Roleplay segments: provide scenario + transcript for feedback
    elif current_segment.get("type") == "roleplay":
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

        # Load roleplay transcript for feedback context
        roleplay_id_str = current_segment.get("id")
        if roleplay_id_str:
            async with get_connection() as conn:
                rp_session = await get_latest_roleplay_session(
                    conn,
                    user_id=user_id,
                    anonymous_token=anonymous_token,
                    module_id=module.content_id,
                    roleplay_id=UUID(roleplay_id_str),
                )
            if rp_session:
                rp_messages = rp_session.get("messages", [])
                if rp_messages:
                    lines = [
                        f"{m['role'].title()}: {m['content']}" for m in rp_messages
                    ]
                    instructions += "\n\nRoleplay transcript:\n" + "\n".join(lines)
    else:
        instructions = current_segment.get(
            "instructions", "Help the user learn about AI safety."
        )

    # Build messages for LLM (existing history + new message)
    # Merge system messages as [Context: ...] into adjacent user messages
    # to avoid consecutive user-role messages (Anthropic API requirement)
    llm_messages = []
    pending_context: list[str] = []
    for m in existing_messages:
        if m["role"] == "system":
            pending_context.append(f"[Context: {m['content']}]")
        elif m["role"] == "user":
            content = m["content"]
            if pending_context:
                content = "\n".join(pending_context) + "\n\n" + content
                pending_context.clear()
            llm_messages.append({"role": "user", "content": content})
        elif m["role"] == "assistant":
            llm_messages.append({"role": "assistant", "content": m["content"]})

    if user_message:
        content = user_message
        if context_msg_content:
            content = f"[Context: {context_msg_content}]\n\n{content}"
        if pending_context:
            content = "\n".join(pending_context) + "\n\n" + content
            pending_context.clear()
        llm_messages.append({"role": "user", "content": content})

    # Create chat stage
    stage = ChatStage(
        type="chat",
        instructions=instructions,
    )

    # Build course overview for system prompt
    from core.modules.prompts import build_course_overview
    from core.modules.course_loader import load_course
    from core.content import get_cache

    course_overview = None
    try:
        cache = get_cache()
        if cache.courses:
            course_slug = next(iter(cache.courses))
            course = load_course(course_slug)

            # Get user's completed content IDs
            completed_ids = set()
            if user_id:
                from core.modules.progress import get_completed_content_ids

                async with get_connection() as conn:
                    completed_ids = await get_completed_content_ids(conn, user_id)

            course_overview = build_course_overview(
                course, module.slug, section_index, completed_ids
            )
    except Exception as e:
        logger.warning("Failed to build course overview: %s", e)

    # Get MCP manager from app state
    mcp_manager = getattr(app.state, "mcp_manager", None) if app else None

    # Stream response
    assistant_content = ""
    try:
        async for chunk in send_module_message(
            llm_messages, stage, None, section_context,
            mcp_manager=mcp_manager,
            course_overview=course_overview,
        ):
            if chunk.get("type") == "text":
                assistant_content += chunk.get("content", "")
            yield f"data: {json.dumps(chunk)}\n\n"
    except Exception as e:
        logger.error("Chat LLM error: %s", e)
        sentry_sdk.capture_exception(e)
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    # Save assistant response
    if assistant_content:
        async with get_connection() as conn:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="assistant",
                content=assistant_content,
            )


@router.post("/module")
async def chat_module(
    body: ModuleChatRequest,
    request: Request,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
) -> StreamingResponse:
    """
    Send a message to the module chat and stream the response.

    Auth: JWT cookie (for authenticated users) or X-Anonymous-Token header (for anonymous users)

    Request body:
    - slug: Module identifier
    - sectionIndex: Current section (0-indexed)
    - segmentIndex: Current segment within section (0-indexed)
    - message: User's message

    Returns Server-Sent Events with:
    - {"type": "text", "content": "..."} for text chunks
    - {"type": "tool_use", "name": "..."} for tool calls
    - {"type": "done"} when complete
    - {"type": "error", "message": "..."} on error
    """
    user_id, anonymous_token = auth

    # Load module
    try:
        module = load_flattened_module(body.slug)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")

    return StreamingResponse(
        event_generator(
            user_id=user_id,
            anonymous_token=anonymous_token,
            module=module,
            section_index=body.sectionIndex,
            segment_index=body.segmentIndex,
            user_message=body.message,
            app=request.app,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/module/{slug}/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    slug: str,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
):
    """
    Get chat history for a module.

    Auth: JWT cookie (for authenticated users) or X-Anonymous-Token header (for anonymous users)

    Returns the chat session messages for the current user/anonymous token.
    Creates a new empty session if none exists.
    """
    user_id, anonymous_token = auth

    # Load module to get content_id
    try:
        module = load_flattened_module(slug)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")

    # Get or create chat session
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=module.content_id,
        )

    return ChatHistoryResponse(
        sessionId=session["session_id"],
        messages=session.get("messages", []),
    )
