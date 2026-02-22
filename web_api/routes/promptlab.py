"""
Prompt Lab API routes.

Endpoints:
- GET /api/promptlab/fixtures - List available fixtures
- GET /api/promptlab/fixtures/{name} - Load a specific fixture
- POST /api/promptlab/regenerate - Regenerate AI response (SSE stream)
- POST /api/promptlab/continue - Continue conversation (SSE stream)

All endpoints require facilitator/admin authentication.
No database writes occur in any Prompt Lab code path.
"""

import json
import sys
import urllib.parse
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.modules.prompts import assemble_chat_prompt
from core.promptlab import (
    list_fixtures,
    load_fixture,
    regenerate_response,
    continue_conversation,
)
from core.queries.facilitator import get_facilitator_group_ids, is_admin
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/promptlab", tags=["promptlab"])


async def get_facilitator_user(user: dict = Depends(get_current_user)) -> dict:
    """Get database user, raise 403 if not found or not facilitator/admin."""
    discord_id = user["sub"]
    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(403, "User not found in database")

        admin = await is_admin(conn, db_user["user_id"])
        facilitator_groups = await get_facilitator_group_ids(conn, db_user["user_id"])

        if not admin and not facilitator_groups:
            raise HTTPException(403, "Access denied: not an admin or facilitator")

    return db_user


# --- Request models ---


class RegenerateRequest(BaseModel):
    messages: list[dict]  # Conversation up to the point to regenerate
    baseSystemPrompt: str  # Base prompt (editable in UI)
    instructions: str = ""  # Stage instructions
    context: str = ""  # Previous content context
    enableThinking: bool = True  # Whether to include CoT (default matches normal chat)
    effort: str = "low"  # Thinking effort: "low", "medium", or "high"
    model: str | None = None  # Optional model override (e.g. "anthropic/claude-sonnet-4-6")


class ContinueRequest(BaseModel):
    messages: list[dict]  # Full conversation including the follow-up user message
    baseSystemPrompt: str  # Base prompt (editable in UI)
    instructions: str = ""  # Stage instructions
    context: str = ""  # Previous content context
    enableThinking: bool = True
    effort: str = "low"
    model: str | None = None


# --- Endpoints ---


@router.get("/fixtures")
async def list_all_fixtures(
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """
    List all available chat fixtures for Prompt Lab.

    Auth: facilitator or admin required.
    """
    fixtures = list_fixtures()
    return {"fixtures": fixtures}


@router.get("/fixtures/{name:path}")
async def get_fixture(
    name: str,
    _user: dict = Depends(get_facilitator_user),
) -> dict:
    """
    Load a specific fixture by name.

    Auth: facilitator or admin required.
    Returns 404 if fixture not found.
    """
    decoded_name = urllib.parse.unquote(name)
    fixture = load_fixture(decoded_name)
    if not fixture:
        raise HTTPException(404, "Fixture not found")
    return fixture


@router.post("/regenerate")
async def regenerate(
    request: RegenerateRequest,
    _user: dict = Depends(get_facilitator_user),
) -> StreamingResponse:
    """
    Regenerate an AI response with a custom system prompt.

    Auth: facilitator or admin required.
    Returns Server-Sent Events with text/thinking/done/error events.
    Does NOT write to any database table.
    """

    system_prompt = assemble_chat_prompt(
        request.baseSystemPrompt,
        request.instructions or None,
        request.context or None,
    )

    async def event_generator():
        try:
            async for event in regenerate_response(
                messages=request.messages,
                system_prompt=system_prompt,
                enable_thinking=request.enableThinking,
                effort=request.effort,
                provider=request.model,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/continue")
async def continue_chat(
    request: ContinueRequest,
    _user: dict = Depends(get_facilitator_user),
) -> StreamingResponse:
    """
    Continue a conversation with a follow-up message.

    Auth: facilitator or admin required.
    Returns Server-Sent Events with text/thinking/done/error events.
    Does NOT write to any database table.
    """
    system_prompt = assemble_chat_prompt(
        request.baseSystemPrompt,
        request.instructions or None,
        request.context or None,
    )

    async def event_generator():
        try:
            async for event in continue_conversation(
                messages=request.messages,
                system_prompt=system_prompt,
                enable_thinking=request.enableThinking,
                effort=request.effort,
                provider=request.model,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
