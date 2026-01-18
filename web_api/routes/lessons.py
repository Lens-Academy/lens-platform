"""
Lesson API routes.

Endpoints:
- GET /api/lessons - List available lessons
- GET /api/lessons/{slug} - Get lesson definition
- POST /api/lesson-sessions - Start a new session
- GET /api/lesson-sessions/{id} - Get session state
- POST /api/lesson-sessions/{id}/message - Send message (SSE streaming)
- POST /api/lesson-sessions/{id}/advance - Move to next stage
- POST /api/lesson-sessions/{id}/claim - Claim anonymous session
- POST /api/lesson-sessions/{id}/heartbeat - Record activity heartbeat
"""

import json
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import insert

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.lessons import (
    load_lesson,
    get_available_lessons,
    LessonNotFoundError,
    create_session,
    get_session,
    add_message,
    advance_stage,
    complete_session,
    claim_session,
    SessionNotFoundError,
    SessionAlreadyClaimedError,
    send_lesson_message,
    get_stage_content,
    ArticleStage,
    VideoStage,
    load_article_with_metadata,
    load_video_transcript_with_metadata,
    get_stage_title,
    get_stage_duration,
)
from core import get_or_create_user
from core.database import get_connection
from core.tables import content_events
from core.enums import ContentEventType
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_optional_user, get_current_user


def get_video_info(stage: VideoStage) -> dict:
    """Get video metadata from transcript file."""
    try:
        result = load_video_transcript_with_metadata(stage.source)
        return {
            "video_id": result.metadata.video_id,
            "title": result.metadata.title,
            "url": result.metadata.url,
        }
    except FileNotFoundError:
        return {"video_id": None, "title": None, "url": None}


def get_started_message(stage) -> dict | None:
    """Get 'Started' system message for a stage, or None if not applicable."""
    if isinstance(stage, ArticleStage):
        title = get_stage_title(stage)
        return {"content": f"Started reading: {title}", "icon": "article"}
    elif isinstance(stage, VideoStage):
        title = get_stage_title(stage)
        return {"content": f"Started watching: {title}", "icon": "video"}
    return None


def get_finished_message(stage) -> dict | None:
    """Get 'Finished' system message for a stage, or None if not applicable."""
    if isinstance(stage, ArticleStage):
        return {"content": "Finished reading", "icon": "article"}
    elif isinstance(stage, VideoStage):
        return {"content": "Finished watching", "icon": "video"}
    return None


def check_session_access(session: dict, user_id: int | None) -> None:
    """Raise 403 if user doesn't own the session.

    Anonymous sessions (user_id=None in session) are accessible by anyone.
    Owned sessions require the requesting user_id to match.
    """
    if session["user_id"] is not None and session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")


async def get_user_id_for_lesson(request: Request) -> int | None:
    """Get user_id from authenticated user, or None for anonymous requests.

    In DEV_MODE only, unauthenticated requests get a test user.
    In production, unauthenticated requests remain anonymous (user_id=None).
    """
    import os

    user_jwt = await get_optional_user(request)

    if user_jwt:
        # Authenticated user
        discord_id = user_jwt["sub"]
    elif os.environ.get("DEV_MODE", "").lower() in ("true", "1", "yes"):
        # Dev fallback: use a test discord_id (only in dev mode)
        discord_id = "dev_test_user_123"
    else:
        # Production: anonymous user (no database record)
        return None

    user = await get_or_create_user(discord_id)
    return user["user_id"]


router = APIRouter(prefix="/api", tags=["lessons"])


# --- Lesson Definition Endpoints ---


@router.get("/lessons")
async def list_lessons():
    """List available lessons."""
    lesson_slugs = get_available_lessons()
    lessons = []
    for slug in lesson_slugs:
        try:
            lesson = load_lesson(slug)
            lessons.append({"slug": lesson.slug, "title": lesson.title})
        except LessonNotFoundError:
            pass
    return {"lessons": lessons}


def serialize_video_stage(s: VideoStage) -> dict:
    """Serialize a video stage to JSON, loading video_id from transcript."""
    info = get_video_info(s)
    return {
        "type": "video",
        "videoId": info["video_id"],
        "title": info["title"],
        "from": s.from_seconds,
        "to": s.to_seconds,
        "optional": s.optional,
        "introduction": s.introduction,
    }


@router.get("/lessons/{lesson_slug}")
async def get_lesson(lesson_slug: str):
    """Get a lesson definition."""
    try:
        lesson = load_lesson(lesson_slug)
        return {
            "slug": lesson.slug,
            "title": lesson.title,
            "stages": [
                {
                    "type": s.type,
                    **(
                        {
                            "source": s.source,
                            "from": s.from_text,
                            "to": s.to_text,
                            "optional": s.optional,
                            "introduction": s.introduction,
                        }
                        if s.type == "article"
                        else {}
                    ),
                    **(serialize_video_stage(s) if s.type == "video" else {}),
                    **(
                        {
                            "instructions": s.instructions,
                            "showUserPreviousContent": s.show_user_previous_content,
                            "showTutorPreviousContent": s.show_tutor_previous_content,
                        }
                        if s.type == "chat"
                        else {}
                    ),
                }
                for s in lesson.stages
            ],
        }
    except LessonNotFoundError:
        raise HTTPException(status_code=404, detail="Lesson not found")


# --- Session Endpoints ---


class CreateSessionRequest(BaseModel):
    lesson_slug: str


class HeartbeatRequest(BaseModel):
    """Request body for heartbeat tracking."""

    stage_index: int
    stage_type: str  # "article", "video", "chat"
    scroll_depth: float | None = None
    video_time: int | None = None


@router.post("/lesson-sessions")
async def start_session(request_body: CreateSessionRequest, request: Request):
    """Start a new lesson session. Can be anonymous (no auth required)."""
    user_jwt = await get_optional_user(request)

    if user_jwt:
        discord_id = user_jwt["sub"]
        user = await get_or_create_user(discord_id)
        user_id = user["user_id"]
    else:
        user_id = None  # Anonymous session

    try:
        lesson = load_lesson(request_body.lesson_slug)
    except LessonNotFoundError:
        raise HTTPException(status_code=404, detail="Lesson not found")

    session = await create_session(user_id, request_body.lesson_slug)

    # Add "Started" system message if stage 0 is article/video
    if lesson.stages:
        first_stage = lesson.stages[0]
        started_msg = get_started_message(first_stage)
        if started_msg:
            await add_message(
                session["session_id"],
                "system",
                started_msg["content"],
                started_msg.get("icon"),
            )

    return {"session_id": session["session_id"]}


@router.get("/lesson-sessions/{session_id}")
async def get_session_state(
    session_id: int,
    request: Request,
    view_stage: int | None = None,
):
    """Get current session state."""
    user_id = await get_user_id_for_lesson(request)

    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    check_session_access(session, user_id)

    # Load lesson to include stage info
    lesson = load_lesson(session["lesson_slug"])

    # Determine which stage to get content for
    content_stage_index = (
        view_stage if view_stage is not None else session["current_stage_index"]
    )

    # Validate view_stage is within bounds
    if view_stage is not None:
        if view_stage < 0 or view_stage >= len(lesson.stages):
            raise HTTPException(status_code=400, detail="Invalid stage index")

    current_stage = (
        lesson.stages[session["current_stage_index"]]
        if session["current_stage_index"] < len(lesson.stages)
        else None
    )

    # Get content for the viewed stage (may differ from current)
    content_stage = (
        lesson.stages[content_stage_index]
        if content_stage_index < len(lesson.stages)
        else None
    )

    # Helper to bundle article content with metadata
    def bundle_article(result) -> dict | None:
        if not result:
            return None
        return {
            "content": result.content,
            "title": result.metadata.title,
            "author": result.metadata.author,
            "sourceUrl": result.metadata.source_url,
            "isExcerpt": result.is_excerpt,
        }

    # Get content for the viewed stage
    article = None
    if content_stage:
        result = get_stage_content(content_stage)
        article = bundle_article(result)

    # For chat stages, get previous stage content (for blur/visible display)
    previous_article = None
    previous_stage = None
    show_user_previous_content = True
    if current_stage and current_stage.type == "chat" and view_stage is None:
        # Only provide previous content when viewing current (not reviewing)
        stage_idx = session["current_stage_index"]
        if stage_idx > 0:
            previous_stage = lesson.stages[stage_idx - 1]
            prev_result = get_stage_content(previous_stage)
            previous_article = bundle_article(prev_result)
            show_user_previous_content = current_stage.show_user_previous_content

    return {
        "session_id": session["session_id"],
        "lesson_slug": session["lesson_slug"],
        "lesson_title": lesson.title,
        "current_stage_index": session["current_stage_index"],
        "total_stages": len(lesson.stages),
        "current_stage": (
            {
                "type": current_stage.type,
                **(
                    {
                        "source": current_stage.source,
                        "from": current_stage.from_text,
                        "to": current_stage.to_text,
                        "optional": current_stage.optional,
                        "introduction": current_stage.introduction,
                    }
                    if current_stage and current_stage.type == "article"
                    else {}
                ),
                **(
                    serialize_video_stage(current_stage)
                    if current_stage and current_stage.type == "video"
                    else {}
                ),
            }
            if current_stage
            else None
        ),
        "messages": session["messages"],
        "completed": session["completed_at"] is not None,
        # Bundled article data (content + metadata)
        "article": article,
        # Previous article for chat stages (blurred or visible)
        "previous_article": previous_article,
        "previous_stage": (
            {
                "type": previous_stage.type,
                **(
                    {
                        "videoId": get_video_info(previous_stage)["video_id"],
                        "from": previous_stage.from_seconds,
                        "to": previous_stage.to_seconds,
                    }
                    if previous_stage.type == "video"
                    else {}
                ),
            }
            if previous_stage
            else None
        ),
        "show_user_previous_content": show_user_previous_content,
        # Add all stages for frontend navigation
        "stages": [
            {
                "type": s.type,
                "title": get_stage_title(s),
                "duration": get_stage_duration(s),
                **(
                    {"source": s.source, "optional": s.optional, "introduction": s.introduction}
                    if s.type == "article"
                    else {}
                ),
                **(serialize_video_stage(s) if s.type == "video" else {}),
            }
            for s in lesson.stages
        ],
    }


class SendMessageRequest(BaseModel):
    content: str


@router.post("/lesson-sessions/{session_id}/message")
async def send_message_endpoint(
    session_id: int,
    request_body: SendMessageRequest,
    request: Request,
):
    """Send a message and stream the response."""
    user_id = await get_user_id_for_lesson(request)

    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    check_session_access(session, user_id)

    # Load lesson and current stage
    lesson = load_lesson(session["lesson_slug"])
    stage_index = session["current_stage_index"]
    current_stage = lesson.stages[stage_index]
    previous_stage = lesson.stages[stage_index - 1] if stage_index > 0 else None

    # Get content for AI context
    current_content = None
    previous_content = None

    if current_stage.type in ("article", "video"):
        # For article/video stages: always provide current content to tutor
        result = get_stage_content(current_stage)
        current_content = result.content if result else None
    elif current_stage.type == "chat" and previous_stage:
        # For chat stages: provide previous content if showTutorPreviousContent
        if current_stage.show_tutor_previous_content:
            prev_result = get_stage_content(previous_stage)
            previous_content = prev_result.content if prev_result else None

    # Add user message to session (skip empty messages - used for AI auto-initiation)
    if request_body.content:
        await add_message(session_id, "user", request_body.content)

    # Build messages list for LLM
    # Always include full session history for context across stages
    messages = session["messages"].copy()

    if request_body.content:
        messages.append({"role": "user", "content": request_body.content})
    else:
        # AI auto-initiation: add synthetic trigger to prompt AI to speak first
        # Claude API requires conversations start with a user message
        messages.append({"role": "user", "content": "[Begin conversation]"})

    async def event_generator():
        assistant_content = ""
        try:
            async for chunk in send_lesson_message(
                messages, current_stage, current_content, previous_content
            ):
                if chunk["type"] == "text":
                    assistant_content += chunk["content"]
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Save assistant response
            if assistant_content:
                await add_message(session_id, "assistant", assistant_content)
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/lesson-sessions/{session_id}/advance")
async def advance_session(session_id: int, request: Request):
    """Move to the next stage."""
    user_id = await get_user_id_for_lesson(request)

    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    check_session_access(session, user_id)

    lesson = load_lesson(session["lesson_slug"])
    current_stage_index = session["current_stage_index"]
    current_stage = lesson.stages[current_stage_index]

    if current_stage_index >= len(lesson.stages) - 1:
        # Add "Finished" message for current stage before completing
        finished_msg = get_finished_message(current_stage)
        if finished_msg:
            await add_message(
                session_id, "system", finished_msg["content"], finished_msg.get("icon")
            )
        await complete_session(session_id)

        return {"completed": True}

    # Add "Finished" message for current stage
    finished_msg = get_finished_message(current_stage)
    if finished_msg:
        await add_message(
            session_id, "system", finished_msg["content"], finished_msg.get("icon")
        )

    await advance_stage(session_id)

    # Add "Started" message for new stage
    new_stage = lesson.stages[current_stage_index + 1]
    started_msg = get_started_message(new_stage)
    if started_msg:
        await add_message(
            session_id, "system", started_msg["content"], started_msg.get("icon")
        )

    return {"completed": False, "new_stage_index": current_stage_index + 1}


@router.post("/lesson-sessions/{session_id}/claim")
async def claim_session_endpoint(session_id: int, request: Request):
    """Claim an anonymous session for the authenticated user."""
    # Require authentication
    user_jwt = await get_current_user(request)
    discord_id = user_jwt["sub"]

    # Get or create user record
    user = await get_or_create_user(discord_id)
    user_id = user["user_id"]

    try:
        await claim_session(session_id, user_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except SessionAlreadyClaimedError:
        raise HTTPException(status_code=403, detail="Session already claimed")

    return {"claimed": True}


@router.post("/lesson-sessions/{session_id}/heartbeat", status_code=204)
async def record_heartbeat(
    session_id: int,
    request_body: HeartbeatRequest,
    request: Request,
):
    """
    Record an activity heartbeat for time tracking.

    Fire-and-forget from frontend - returns 204 No Content.
    """
    user = await get_optional_user(request)

    async with get_connection() as conn:
        # Get session to verify it exists and get lesson_id
        session = await get_session(session_id)
        if not session:
            raise HTTPException(404, "Session not found")

        # Get user_id if authenticated
        user_id = None
        if user:
            db_user = await get_user_by_discord_id(conn, user["sub"])
            if db_user:
                user_id = db_user["user_id"]

        # Build metadata
        metadata = {}
        if request_body.scroll_depth is not None:
            metadata["scroll_depth"] = request_body.scroll_depth
        if request_body.video_time is not None:
            metadata["video_time"] = request_body.video_time

        # Insert heartbeat
        await conn.execute(
            insert(content_events).values(
                user_id=user_id,
                session_id=session_id,
                lesson_slug=session["lesson_slug"],
                stage_index=request_body.stage_index,
                stage_type=request_body.stage_type,
                event_type=ContentEventType.heartbeat,
                metadata=metadata if metadata else None,
            )
        )
        await conn.commit()

    return None  # 204 No Content
