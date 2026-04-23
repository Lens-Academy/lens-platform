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
    save_raw_message,
)
from core.modules.loader import load_flattened_module
from core.modules.tutor_scenario import build_scenario_turn
from web_api.auth import get_user_or_anonymous

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["module"])


async def _load_roleplay_transcript_if_applicable(
    conn,
    *,
    module,
    section_index: int,
    segment_index: int,
    user_id: int | None,
    anonymous_token: UUID | None,
) -> str | None:
    """Fetch the latest roleplay transcript when the current segment is a
    roleplay-feedback segment. Returns a pre-formatted 'Role: content' string
    or None if no transcript is available.
    """
    section = (
        module.sections[section_index] if section_index < len(module.sections) else {}
    )
    segments = section.get("segments", [])
    current_segment = segments[segment_index] if segment_index < len(segments) else {}
    if current_segment.get("type") != "roleplay":
        return None
    roleplay_id_str = current_segment.get("id")
    if not roleplay_id_str:
        return None
    rp_session = await get_latest_roleplay_session(
        conn,
        user_id=user_id,
        anonymous_token=anonymous_token,
        module_id=module.content_id,
        roleplay_id=UUID(roleplay_id_str),
    )
    if not rp_session:
        return None
    rp_messages = rp_session.get("messages", [])
    if not rp_messages:
        return None
    return "\n".join(f"{m['role'].title()}: {m['content']}" for m in rp_messages)


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
    courseSlug: str | None = None


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
    course_slug: str | None = None,
):
    """Generate SSE events from chat interaction."""
    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=module.content_id,
        )
        session_id = session["session_id"]
        existing_messages = session.get("messages", [])

        # Fetch roleplay transcript for feedback segments; the scenario
        # builder is pure, so we inline the DB lookup here.
        roleplay_transcript = await _load_roleplay_transcript_if_applicable(
            conn,
            module=module,
            section_index=section_index,
            segment_index=segment_index,
            user_id=user_id,
            anonymous_token=anonymous_token,
        )

        scenario = build_scenario_turn(
            module=module,
            section_index=section_index,
            segment_index=segment_index,
            existing_messages=existing_messages,
            user_message=user_message,
            course_slug=course_slug,
            roleplay_transcript=roleplay_transcript,
        )

        for msg in scenario.system_messages_to_persist:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="system",
                content=msg,
            )

        if user_message:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="user",
                content=user_message,
                sectionIndex=section_index,
                segmentIndex=segment_index,
            )

    mcp_manager = getattr(app.state, "mcp_manager", None) if app else None
    content_index = getattr(app.state, "content_index", None) if app else None

    assistant_content = ""
    had_tool_calls = False
    post_tool_content_start = 0
    try:
        async for chunk in send_module_message(
            scenario.llm_messages,
            scenario.stage,
            scenario.current_content,
            mcp_manager=mcp_manager,
            course_overview=scenario.course_overview,
            content_index=content_index,
        ):
            if chunk.get("type") == "text":
                assistant_content += chunk.get("content", "")
                yield f"data: {json.dumps(chunk)}\n\n"
            elif chunk.get("type") == "tool_save":
                had_tool_calls = True
                # Track where post-tool content starts (after last tool result save)
                if chunk["message"].get("role") == "tool":
                    post_tool_content_start = len(assistant_content)
                async with get_connection() as conn:
                    await save_raw_message(
                        conn, session_id=session_id, message=chunk["message"]
                    )
                # Don't yield tool_save to SSE
            else:
                yield f"data: {json.dumps(chunk)}\n\n"
    except Exception as e:
        logger.error("Chat LLM error: %s", e)
        sentry_sdk.capture_exception(e)
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    # Save final assistant response (post-tool text only if tool calls happened)
    final_content = (
        assistant_content[post_tool_content_start:].strip()
        if had_tool_calls
        else assistant_content
    )
    if final_content:
        async with get_connection() as conn:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="assistant",
                content=final_content,
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
            course_slug=body.courseSlug,
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
