"""
Module chat API routes.

Endpoints:
- POST /api/chat/module - Send message and stream response
- GET /api/chat/module/{slug}/history - Get chat history for a module
"""

import json
import sys
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.modules import ModuleNotFoundError
from core.modules.chat import send_module_message
from core.modules.chat_sessions import add_chat_message, get_or_create_chat_session
from core.modules.context import gather_section_context
from core.modules.loader import load_flattened_module
from core.modules.types import ChatStage
from web_api.auth import get_user_or_anonymous

router = APIRouter(prefix="/api/chat", tags=["module"])


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
):
    """Generate SSE events from chat interaction."""
    # Get or create chat session
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module.content_id,
            content_type="module",
        )
        session_id = session["session_id"]
        existing_messages = session.get("messages", [])

        # Save user message
        if user_message:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="user",
                content=user_message,
            )

    # Get section and gather context
    section = (
        module.sections[section_index] if section_index < len(module.sections) else {}
    )
    previous_content = gather_section_context(section, segment_index)

    # Get chat instructions from segment
    segments = section.get("segments", [])
    current_segment = segments[segment_index] if segment_index < len(segments) else {}

    # Question segments: build feedback-aware system prompt
    if current_segment.get("type") == "question":
        user_instruction = current_segment.get("userInstruction", "")
        assessment_prompt = current_segment.get("assessmentPrompt")
        learning_outcome_name = section.get("learningOutcomeName")

        instructions = (
            "You are a supportive tutor providing feedback on a student's response. "
            "Focus on what the student understood well, gently point out gaps, and "
            "ask Socratic questions to deepen their understanding. "
            "Be encouraging and constructive."
        )
        instructions += f"\n\nQuestion: {user_instruction}"
        if learning_outcome_name:
            instructions += f"\nLearning Outcome: {learning_outcome_name}"
        if assessment_prompt:
            instructions += f"\nRubric:\n{assessment_prompt}"
    else:
        instructions = current_segment.get(
            "instructions", "Help the user learn about AI safety."
        )

    # Build messages for LLM (existing history + new message)
    llm_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in existing_messages
        if m["role"] in ("user", "assistant")
    ]
    if user_message:
        llm_messages.append({"role": "user", "content": user_message})

    # Create chat stage
    stage = ChatStage(
        type="chat",
        instructions=instructions,
    )

    # Stream response
    assistant_content = ""
    try:
        async for chunk in send_module_message(
            llm_messages, stage, None, previous_content
        ):
            if chunk.get("type") == "text":
                assistant_content += chunk.get("content", "")
            yield f"data: {json.dumps(chunk)}\n\n"
    except Exception as e:
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
    request: ModuleChatRequest,
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
        module = load_flattened_module(request.slug)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")

    return StreamingResponse(
        event_generator(
            user_id=user_id,
            anonymous_token=anonymous_token,
            module=module,
            section_index=request.sectionIndex,
            segment_index=request.segmentIndex,
            user_message=request.message,
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
            content_id=module.content_id,
            content_type="module",
        )

    return ChatHistoryResponse(
        sessionId=session["session_id"],
        messages=session.get("messages", []),
    )
