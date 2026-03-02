"""
Roleplay chat API routes.

Endpoints:
- POST /api/chat/roleplay - Send message and stream response (SSE)
- GET /api/chat/roleplay/{roleplay_id}/history - Get chat history
- POST /api/chat/roleplay/{session_id}/complete - Mark session completed
- POST /api/chat/roleplay/{session_id}/retry - Archive and retry with fresh session
- GET /api/chat/roleplay/{session_id}/assessment - Get assessment results
"""

import json
import logging
import sys
from pathlib import Path
from uuid import UUID

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.modules import ModuleNotFoundError
from core.modules.chat_sessions import (
    add_chat_message,
    archive_chat_session,
    complete_chat_session,
    get_chat_session,
    get_or_create_chat_session,
)
from core.modules.llm import stream_chat
from core.modules.loader import load_flattened_module
from core.modules.roleplay import build_roleplay_prompt
from core.roleplay_assessment import enqueue_roleplay_scoring
from core.tables import roleplay_assessments
from web_api.auth import get_user_or_anonymous

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["roleplay"])


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------


class RoleplayChatRequest(BaseModel):
    """Request body for roleplay chat SSE endpoint."""

    module_slug: str
    roleplay_id: str  # UUID string from content
    message: str  # User message (empty string for initial load)
    ai_instructions: str  # Character behavior from content
    scenario_content: str | None = None  # Briefing text
    opening_message: str | None = None  # Optional first AI message
    assessment_instructions: str | None = None  # Rubric for AI scoring


class RoleplayHistoryResponse(BaseModel):
    """Response for roleplay chat history endpoint."""

    sessionId: int
    messages: list[dict]
    completedAt: str | None = None


class RoleplayAssessmentResponse(BaseModel):
    """Response for roleplay assessment retrieval endpoint."""

    score_data: dict
    model_id: str | None = None
    created_at: str


class RetryRequest(BaseModel):
    """Request body for retry endpoint."""

    opening_message: str | None = None


# ---------------------------------------------------------------------------
# SSE event generator
# ---------------------------------------------------------------------------


async def roleplay_event_generator(
    user_id: int | None,
    anonymous_token: UUID | None,
    module,
    request: RoleplayChatRequest,
):
    """Generate SSE events for a roleplay chat interaction."""
    roleplay_uuid = UUID(request.roleplay_id)

    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=module.content_id,
            roleplay_id=roleplay_uuid,
            segment_snapshot={
                "content": request.scenario_content,
                "aiInstructions": request.ai_instructions,
                "openingMessage": request.opening_message,
                "assessmentInstructions": request.assessment_instructions,
            },
        )
        session_id = session["session_id"]
        existing_messages = session.get("messages", [])

        # Check if session is already completed
        if session.get("completed_at") is not None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Session completed'})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # Opening message handling: new session with opening message
        if not existing_messages and request.opening_message:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="assistant",
                content=request.opening_message,
            )
            yield f"data: {json.dumps({'type': 'text', 'content': request.opening_message})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # Save user message
        if request.message:
            await add_chat_message(
                conn,
                session_id=session_id,
                role="user",
                content=request.message,
            )

    # Build system prompt
    system_prompt = build_roleplay_prompt(
        ai_instructions=request.ai_instructions,
        scenario_content=request.scenario_content,
    )

    # Build LLM message history from existing messages + new user message
    llm_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in existing_messages
        if m["role"] in ("user", "assistant")
    ]
    if request.message:
        llm_messages.append({"role": "user", "content": request.message})

    # Stream response from LLM (no tools for roleplay)
    assistant_content = ""
    try:
        async for chunk in stream_chat(
            messages=llm_messages,
            system=system_prompt,
            tools=None,
        ):
            if chunk.get("type") == "text":
                assistant_content += chunk.get("content", "")
            yield f"data: {json.dumps(chunk)}\n\n"
    except Exception as e:
        logger.error("Roleplay LLM error: %s", e)
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/roleplay")
async def chat_roleplay(
    request: RoleplayChatRequest,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
) -> StreamingResponse:
    """
    Send a message to the roleplay chat and stream the response.

    Auth: JWT cookie (for authenticated users) or X-Anonymous-Token header.

    Request body:
    - module_slug: Module identifier
    - roleplay_id: UUID of the roleplay from content
    - message: User's message (empty string for opening message flow)
    - ai_instructions: Character behavior instructions from content
    - scenario_content: Optional briefing text
    - opening_message: Optional first AI message (sent on new sessions)
    - assessment_instructions: Optional scoring rubric for AI assessment

    Returns Server-Sent Events with:
    - {"type": "text", "content": "..."} for text chunks
    - {"type": "thinking", "content": "..."} for reasoning chunks
    - {"type": "done"} when complete
    - {"type": "error", "message": "..."} on error
    """
    user_id, anonymous_token = auth

    # Load module
    try:
        module = load_flattened_module(request.module_slug)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")

    return StreamingResponse(
        roleplay_event_generator(
            user_id=user_id,
            anonymous_token=anonymous_token,
            module=module,
            request=request,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/roleplay/{roleplay_id}/history", response_model=RoleplayHistoryResponse)
async def get_roleplay_history(
    roleplay_id: str,
    module_slug: str,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
):
    """
    Get chat history for a roleplay session.

    Auth: JWT cookie or X-Anonymous-Token header.

    Path params:
    - roleplay_id: UUID of the roleplay from content

    Query params:
    - module_slug: Module identifier (required)

    Returns the chat session messages and completion status.
    Creates a new empty session if none exists.
    """
    user_id, anonymous_token = auth

    try:
        module = load_flattened_module(module_slug)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")

    async with get_connection() as conn:
        session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=module.content_id,
            roleplay_id=UUID(roleplay_id),
        )

    completed_at = session.get("completed_at")
    return RoleplayHistoryResponse(
        sessionId=session["session_id"],
        messages=session.get("messages", []),
        completedAt=completed_at.isoformat() if completed_at else None,
    )


@router.post("/roleplay/{session_id}/complete")
async def complete_roleplay(
    session_id: int,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
):
    """
    Mark a roleplay session as completed.

    Auth: JWT cookie or X-Anonymous-Token header.
    Verifies session ownership before completing.
    Triggers background AI scoring if assessment instructions exist.
    """
    user_id, anonymous_token = auth

    async with get_connection() as conn:
        session = await get_chat_session(conn, session_id=session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Verify ownership
        if user_id and session.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Not your session")
        if anonymous_token and session.get("anonymous_token") != anonymous_token:
            raise HTTPException(status_code=403, detail="Not your session")

        await complete_chat_session(conn, session_id=session_id)

    # Trigger assessment scoring if rubric exists in segment_snapshot
    snapshot = session.get("segment_snapshot") or {}
    if snapshot.get("assessmentInstructions") or snapshot.get(
        "assessment-instructions"
    ):
        enqueue_roleplay_scoring(
            session_id=session_id,
            messages=session.get("messages", []),
            segment_snapshot=snapshot,
        )

    return {"status": "completed"}


@router.post("/roleplay/{session_id}/retry")
async def retry_roleplay(
    session_id: int,
    request: RetryRequest,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
):
    """
    Archive current roleplay session and create a fresh one.

    Auth: JWT cookie or X-Anonymous-Token header.
    Verifies session ownership before archiving.

    Returns the new session ID. The frontend handles re-triggering the
    opening message via streamMessage("") after retry.
    """
    user_id, anonymous_token = auth

    async with get_connection() as conn:
        session = await get_chat_session(conn, session_id=session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Verify ownership
        if user_id and session.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Not your session")
        if anonymous_token and session.get("anonymous_token") != anonymous_token:
            raise HTTPException(status_code=403, detail="Not your session")

        # Archive old session
        await archive_chat_session(conn, session_id=session_id)

        # Create new session with same module_id and roleplay_id
        new_session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            module_id=session.get("module_id"),
            roleplay_id=session.get("roleplay_id"),
        )

    # Don't insert opening message here -- the frontend calls streamMessage("")
    # after retry, which triggers the "new empty session" path in
    # roleplay_event_generator to insert and stream the opening message.

    return {"sessionId": new_session["session_id"]}


@router.get(
    "/roleplay/{session_id}/assessment",
    response_model=RoleplayAssessmentResponse,
)
async def get_roleplay_assessment(
    session_id: int,
    auth: tuple[int | None, UUID | None] = Depends(get_user_or_anonymous),
):
    """
    Get the most recent assessment result for a roleplay session.

    Auth: JWT cookie or X-Anonymous-Token header.
    Verifies session ownership before returning results.

    Returns 404 if no assessment exists yet (scoring may still be in progress).
    """
    user_id, anonymous_token = auth

    async with get_connection() as conn:
        # Verify session exists and check ownership
        session = await get_chat_session(conn, session_id=session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        if user_id and session.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Not your session")
        if anonymous_token and session.get("anonymous_token") != anonymous_token:
            raise HTTPException(status_code=403, detail="Not your session")

        # Get most recent assessment for this session
        result = await conn.execute(
            select(roleplay_assessments)
            .where(roleplay_assessments.c.session_id == session_id)
            .order_by(roleplay_assessments.c.created_at.desc())
            .limit(1)
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(
            status_code=404, detail="No assessment found for this session"
        )

    assessment = dict(row._mapping)
    return RoleplayAssessmentResponse(
        score_data=assessment["score_data"],
        model_id=assessment["model_id"],
        created_at=assessment["created_at"].isoformat(),
    )
