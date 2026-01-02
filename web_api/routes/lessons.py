"""
Lesson API routes.

Endpoints:
- GET /api/lessons - List available lessons
- GET /api/lessons/{id} - Get lesson definition
- POST /api/lesson-sessions - Start a new session
- GET /api/lesson-sessions/{id} - Get session state
- POST /api/lesson-sessions/{id}/message - Send message (SSE streaming)
- POST /api/lesson-sessions/{id}/advance - Move to next stage
"""

import json
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

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
    SessionNotFoundError,
    send_lesson_message,
    get_stage_content,
    ArticleStage,
    VideoStage,
)
from core import get_or_create_user
from web_api.auth import get_optional_user


def get_stage_title(stage) -> str:
    """Extract display title from a stage."""
    if isinstance(stage, ArticleStage):
        # Parse from source_url like "articles/four-background-claims.md"
        filename = stage.source_url.split("/")[-1].replace(".md", "")
        # Convert kebab-case to Title Case
        return " ".join(word.capitalize() for word in filename.split("-"))
    elif isinstance(stage, VideoStage):
        # Simple label for now (would need YouTube API for real title)
        return "Video"
    return ""


def get_started_message(stage) -> str | None:
    """Get 'Started' system message for a stage, or None if not applicable."""
    if isinstance(stage, ArticleStage):
        title = get_stage_title(stage)
        return f"📖 Started reading: {title}"
    elif isinstance(stage, VideoStage):
        title = get_stage_title(stage)
        return f"📺 Started watching: {title}"
    return None


def get_finished_message(stage) -> str | None:
    """Get 'Finished' system message for a stage, or None if not applicable."""
    if isinstance(stage, ArticleStage):
        return "📖 Finished reading"
    elif isinstance(stage, VideoStage):
        return "📺 Finished watching"
    return None


async def get_user_id_for_lesson(request: Request) -> int:
    """Get user_id, with dev fallback for unauthenticated requests."""
    user_jwt = await get_optional_user(request)

    if user_jwt:
        # Authenticated user
        discord_id = user_jwt["sub"]
    else:
        # Dev fallback: use a test discord_id
        discord_id = "dev_test_user_123"

    user = await get_or_create_user(discord_id)
    return user["user_id"]

router = APIRouter(prefix="/api", tags=["lessons"])


# --- Lesson Definition Endpoints ---


@router.get("/lessons")
async def list_lessons():
    """List available lessons."""
    lesson_ids = get_available_lessons()
    lessons = []
    for lid in lesson_ids:
        try:
            lesson = load_lesson(lid)
            lessons.append({"id": lesson.id, "title": lesson.title})
        except LessonNotFoundError:
            pass
    return {"lessons": lessons}


@router.get("/lessons/{lesson_id}")
async def get_lesson(lesson_id: str):
    """Get a lesson definition."""
    try:
        lesson = load_lesson(lesson_id)
        return {
            "id": lesson.id,
            "title": lesson.title,
            "stages": [
                {
                    "type": s.type,
                    **(
                        {
                            "source_url": s.source_url,
                            "from": s.from_text,
                            "to": s.to_text,
                        }
                        if s.type == "article"
                        else {}
                    ),
                    **(
                        {
                            "videoId": s.video_id,
                            "from": s.from_seconds,
                            "to": s.to_seconds,
                        }
                        if s.type == "video"
                        else {}
                    ),
                    **(
                        {
                            "context": s.context,
                            "includePreviousContent": s.include_previous_content,
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
    lesson_id: str


@router.post("/lesson-sessions")
async def start_session(
    request_body: CreateSessionRequest, request: Request
):
    """Start a new lesson session."""
    user_id = await get_user_id_for_lesson(request)

    try:
        lesson = load_lesson(request_body.lesson_id)
    except LessonNotFoundError:
        raise HTTPException(status_code=404, detail="Lesson not found")

    session = await create_session(user_id, request_body.lesson_id)

    # Add "Started" system message if stage 0 is article/video
    if lesson.stages:
        first_stage = lesson.stages[0]
        started_msg = get_started_message(first_stage)
        if started_msg:
            await add_message(session["session_id"], "system", started_msg)

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

    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Load lesson to include stage info
    lesson = load_lesson(session["lesson_id"])

    # Determine which stage to get content for
    content_stage_index = view_stage if view_stage is not None else session["current_stage_index"]

    # Validate view_stage is within bounds and not beyond current progress
    if view_stage is not None:
        if view_stage < 0 or view_stage >= len(lesson.stages):
            raise HTTPException(status_code=400, detail="Invalid stage index")
        if view_stage > session["current_stage_index"]:
            raise HTTPException(status_code=400, detail="Cannot view future stages")

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

    # Get content for the viewed stage
    stage_content = None
    if content_stage:
        stage_content = get_stage_content(content_stage)

    # For chat stages, get previous stage content (for blur/visible display)
    previous_content = None
    previous_stage = None
    include_previous_content = True
    if current_stage and current_stage.type == "chat" and view_stage is None:
        # Only provide previous content when viewing current (not reviewing)
        stage_idx = session["current_stage_index"]
        if stage_idx > 0:
            previous_stage = lesson.stages[stage_idx - 1]
            previous_content = get_stage_content(previous_stage)
            include_previous_content = current_stage.include_previous_content

    return {
        "session_id": session["session_id"],
        "lesson_id": session["lesson_id"],
        "lesson_title": lesson.title,
        "current_stage_index": session["current_stage_index"],
        "total_stages": len(lesson.stages),
        "current_stage": (
            {
                "type": current_stage.type,
                **(
                    {
                        "source_url": current_stage.source_url,
                        "from": current_stage.from_text,
                        "to": current_stage.to_text,
                    }
                    if current_stage and current_stage.type == "article"
                    else {}
                ),
                **(
                    {
                        "videoId": current_stage.video_id,
                        "from": current_stage.from_seconds,
                        "to": current_stage.to_seconds,
                    }
                    if current_stage and current_stage.type == "video"
                    else {}
                ),
            }
            if current_stage
            else None
        ),
        "messages": session["messages"],
        "completed": session["completed_at"] is not None,
        "content": stage_content,
        # Previous content for chat stages (blurred or visible based on includePreviousContent)
        "previous_content": previous_content,
        "previous_stage": (
            {
                "type": previous_stage.type,
                **({"videoId": previous_stage.video_id} if previous_stage.type == "video" else {}),
            }
            if previous_stage
            else None
        ),
        "include_previous_content": include_previous_content,
        # Add all stages for frontend navigation
        "stages": [
            {
                "type": s.type,
                **({"source_url": s.source_url} if s.type == "article" else {}),
                **({"videoId": s.video_id, "from": s.from_seconds, "to": s.to_seconds} if s.type == "video" else {}),
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

    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Load lesson and current stage
    lesson = load_lesson(session["lesson_id"])
    stage_index = session["current_stage_index"]
    current_stage = lesson.stages[stage_index]
    previous_stage = lesson.stages[stage_index - 1] if stage_index > 0 else None

    # Get previous content if needed
    previous_content = None
    if previous_stage:
        previous_content = get_stage_content(previous_stage)

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
                messages, current_stage, previous_stage, previous_content
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

    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    lesson = load_lesson(session["lesson_id"])
    current_stage_index = session["current_stage_index"]
    current_stage = lesson.stages[current_stage_index]

    if current_stage_index >= len(lesson.stages) - 1:
        # Add "Finished" message for current stage before completing
        finished_msg = get_finished_message(current_stage)
        if finished_msg:
            await add_message(session_id, "system", finished_msg)
        await complete_session(session_id)
        return {"completed": True}

    # Add "Finished" message for current stage
    finished_msg = get_finished_message(current_stage)
    if finished_msg:
        await add_message(session_id, "system", finished_msg)

    await advance_stage(session_id)

    # Add "Started" message for new stage
    new_stage = lesson.stages[current_stage_index + 1]
    started_msg = get_started_message(new_stage)
    if started_msg:
        await add_message(session_id, "system", started_msg)

    return {"completed": False, "new_stage_index": current_stage_index + 1}
