"""
Module API routes.

Endpoints:
- GET /api/modules - List available modules
- GET /api/modules/{slug} - Get module definition
- POST /api/module-sessions - Start a new session
- GET /api/module-sessions/{id} - Get session state
- POST /api/module-sessions/{id}/message - Send message (SSE streaming)
- POST /api/module-sessions/{id}/advance - Move to next stage
- POST /api/module-sessions/{id}/claim - Claim anonymous session
- POST /api/module-sessions/{id}/heartbeat - Record activity heartbeat
"""

import json
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import insert

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.modules import (
    load_module,
    get_available_modules,
    ModuleNotFoundError,
    create_session,
    get_session,
    add_message,
    advance_stage,
    complete_session,
    claim_session,
    SessionNotFoundError,
    SessionAlreadyClaimedError,
    send_module_message,
    get_stage_content,
    ArticleStage,
    VideoStage,
    load_video_transcript_with_metadata,
    get_stage_title,
    get_stage_duration,
)
from core.modules.loader import load_narrative_module
from core.modules.content import bundle_narrative_module
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


async def get_user_id_for_module(request: Request) -> int | None:
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


router = APIRouter(prefix="/api", tags=["modules"])


# --- Module Definition Endpoints ---


@router.get("/modules")
async def list_modules():
    """List available modules (supports both staged and narrative formats)."""
    module_slugs = get_available_modules()
    modules = []
    for slug in module_slugs:
        # Try loading as narrative module first
        try:
            module = load_narrative_module(slug)
            modules.append({"slug": module.slug, "title": module.title})
            continue
        except (ModuleNotFoundError, KeyError):
            pass  # Not a narrative module

        # Try loading as staged module
        try:
            module = load_module(slug)
            modules.append({"slug": module.slug, "title": module.title})
        except (ModuleNotFoundError, KeyError):
            pass  # Skip modules that fail to load
    return {"modules": modules}


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


@router.get("/modules/{module_slug}")
async def get_module(module_slug: str):
    """Get a module definition (supports both staged and narrative formats)."""
    # First try loading as narrative module
    try:
        module = load_narrative_module(module_slug)
        return bundle_narrative_module(module)
    except (ModuleNotFoundError, KeyError):
        pass  # Not a narrative module or missing 'sections' key

    # Fall back to staged module format
    try:
        module = load_module(module_slug)
        return {
            "slug": module.slug,
            "title": module.title,
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
                for s in module.stages
            ],
        }
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")


# --- Session Endpoints ---


class CreateSessionRequest(BaseModel):
    module_slug: str


class HeartbeatRequest(BaseModel):
    """Request body for heartbeat tracking."""

    stage_index: int
    stage_type: str  # "article", "video", "chat"
    scroll_depth: float | None = None
    video_time: int | None = None


@router.post("/module-sessions")
async def start_session(request_body: CreateSessionRequest, request: Request):
    """Start a new module session. Can be anonymous (no auth required)."""
    user_jwt = await get_optional_user(request)

    if user_jwt:
        discord_id = user_jwt["sub"]
        user = await get_or_create_user(discord_id)
        user_id = user["user_id"]
    else:
        user_id = None  # Anonymous session

    # Try loading as narrative module first, then staged module
    module = None
    try:
        load_narrative_module(request_body.module_slug)
    except (ModuleNotFoundError, KeyError):
        # Not a narrative module or missing 'sections' - try staged format
        try:
            module = load_module(request_body.module_slug)
        except ModuleNotFoundError:
            raise HTTPException(status_code=404, detail="Module not found")

    session = await create_session(user_id, request_body.module_slug)

    # Add "Started" system message if stage 0 is article/video (staged modules only)
    if module and module.stages:
        first_stage = module.stages[0]
        started_msg = get_started_message(first_stage)
        if started_msg:
            await add_message(
                session["session_id"],
                "system",
                started_msg["content"],
                started_msg.get("icon"),
            )

    return {"session_id": session["session_id"]}


@router.get("/module-sessions/{session_id}")
async def get_session_state(
    session_id: int,
    request: Request,
    view_stage: int | None = None,
):
    """Get current session state."""
    user_id = await get_user_id_for_module(request)

    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    check_session_access(session, user_id)

    # Try loading as narrative module first, then staged module
    narrative_module = None
    module = None
    try:
        narrative_module = load_narrative_module(session["module_slug"])
    except (ModuleNotFoundError, KeyError):
        # Not a narrative module - try staged format
        module = load_module(session["module_slug"])

    # For narrative modules, return simplified response (frontend handles structure)
    if narrative_module:
        return {
            "session_id": session["session_id"],
            "module_slug": session["module_slug"],
            "module_title": narrative_module.title,
            "messages": session["messages"],
            "completed": session["completed_at"] is not None,
            "is_narrative": True,
        }

    # For staged modules, continue with existing logic

    # Determine which stage to get content for
    content_stage_index = (
        view_stage if view_stage is not None else session["current_stage_index"]
    )

    # Validate view_stage is within bounds
    if view_stage is not None:
        if view_stage < 0 or view_stage >= len(module.stages):
            raise HTTPException(status_code=400, detail="Invalid stage index")

    current_stage = (
        module.stages[session["current_stage_index"]]
        if session["current_stage_index"] < len(module.stages)
        else None
    )

    # Get content for the viewed stage (may differ from current)
    content_stage = (
        module.stages[content_stage_index]
        if content_stage_index < len(module.stages)
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
            previous_stage = module.stages[stage_idx - 1]
            prev_result = get_stage_content(previous_stage)
            previous_article = bundle_article(prev_result)
            show_user_previous_content = current_stage.show_user_previous_content

    return {
        "session_id": session["session_id"],
        "module_slug": session["module_slug"],
        "module_title": module.title,
        "current_stage_index": session["current_stage_index"],
        "total_stages": len(module.stages),
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
                    {
                        "source": s.source,
                        "optional": s.optional,
                        "introduction": s.introduction,
                    }
                    if s.type == "article"
                    else {}
                ),
                **(serialize_video_stage(s) if s.type == "video" else {}),
            }
            for s in module.stages
        ],
    }


class SendMessageRequest(BaseModel):
    content: str
    section_index: int | None = None  # For narrative modules
    segment_index: int | None = None  # For narrative modules


def _parse_time_to_seconds(time_str: str | None) -> int:
    """
    Convert time string (e.g., '1:30' or '1:30:45') to seconds.

    Args:
        time_str: Time in format "MM:SS" or "HH:MM:SS", or None

    Returns:
        Time in seconds (0 if None or invalid)
    """
    if time_str is None:
        return 0
    # Strip any extra content (defensive - content parsing issue)
    time_str = time_str.strip().split("\n")[0].strip()
    try:
        parts = time_str.split(":")
        if len(parts) == 2:
            # MM:SS format
            minutes, seconds = int(parts[0]), int(parts[1])
            return minutes * 60 + seconds
        elif len(parts) == 3:
            # HH:MM:SS format
            hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2])
            return hours * 3600 + minutes * 60 + seconds
        else:
            # Single number assumed to be seconds
            return int(time_str)
    except ValueError:
        # If parsing fails, return 0 as fallback
        return 0


def _format_time_range(from_seconds: int, to_seconds: int) -> str:
    """Format a time range for display (e.g., '1:30 - 3:45')."""

    def fmt(s: int) -> str:
        minutes, secs = divmod(s, 60)
        return f"{minutes}:{secs:02d}"

    return f"{fmt(from_seconds)} - {fmt(to_seconds)}"


def _format_segment_for_llm(
    segment,
    section,
    is_last: bool,
) -> str | None:
    """
    Format a single segment's content for LLM context.

    Args:
        segment: The segment to format (TextSegment, ArticleExcerptSegment, or VideoExcerptSegment)
        section: Parent section (ArticleSection or VideoSection)
        is_last: Whether this is the most recent segment before the chat

    Returns:
        Formatted string, or None if content couldn't be loaded
    """
    # IMPORTANT: Use markdown_parser types for narrative modules
    from core.modules.markdown_parser import (
        ArticleSection,
        VideoSection,
        TextSegment,
        ArticleExcerptSegment,
        VideoExcerptSegment,
    )
    from core.modules.content import (
        load_article_with_metadata,
        load_video_transcript_with_metadata,
    )
    from core.transcripts import get_text_at_time

    prefix = "The user read last:" if is_last else "The user read earlier:"

    if isinstance(segment, TextSegment):
        return f"{prefix}\n{segment.content}"

    elif isinstance(segment, ArticleExcerptSegment) and isinstance(
        section, ArticleSection
    ):
        try:
            result = load_article_with_metadata(
                section.source,
                segment.from_text,
                segment.to_text,
            )
            return f"{prefix}\n{result.content}"
        except FileNotFoundError:
            return None

    elif isinstance(segment, VideoExcerptSegment) and isinstance(section, VideoSection):
        try:
            video_result = load_video_transcript_with_metadata(section.source)
            video_id = video_result.metadata.video_id
            video_title = video_result.metadata.title or "Video"

            # VideoExcerptSegment uses from_time/to_time STRINGS, not integers
            from_seconds = _parse_time_to_seconds(segment.from_time)
            to_seconds = (
                _parse_time_to_seconds(segment.to_time) if segment.to_time else 99999
            )

            transcript = get_text_at_time(
                video_id,
                from_seconds,
                to_seconds,
            )

            # Format with metadata
            time_range = _format_time_range(from_seconds, to_seconds)
            return f"{prefix}\n[Video: {video_title}, {time_range}]\n{transcript}"
        except FileNotFoundError:
            return None

    return None


def get_narrative_chat_context(
    module,
    section_index: int,
    segment_index: int,
) -> tuple[str, str | None]:
    """
    Get chat instructions and previous content for a narrative module position.

    Accumulates ALL segments before the chat segment within the current section,
    including TextSegment, ArticleExcerptSegment, and VideoExcerptSegment.
    Content is ordered earliest-to-latest, with the last segment marked specially.

    Note: This is section-scoped only. A standalone ChatSection will not receive
    content from a previous section. This can lead to unexpected behavior if
    module authors expect cross-section context inheritance.

    Args:
        module: NarrativeModule dataclass
        section_index: Section index (0-based)
        segment_index: Segment index within section (0-based)

    Returns:
        Tuple of (instructions, previous_content or None)
    """
    # IMPORTANT: Use markdown_parser types for narrative modules
    from core.modules.markdown_parser import ChatSegment

    section = module.sections[section_index]

    # Note: Standalone ChatSection does not inherit content from previous sections.
    # This is intentional but can lead to unexpected behavior if authors expect
    # cross-section context. Consider adding cross-section support in the future.
    if not hasattr(section, "segments"):
        return "", None

    segment = section.segments[segment_index]

    if not isinstance(segment, ChatSegment):
        return "", None

    instructions = segment.instructions

    if not segment.show_tutor_previous_content or segment_index == 0:
        return instructions, None

    # Accumulate all previous segments in order
    accumulated_parts: list[str] = []

    for i in range(segment_index):
        prev_seg = section.segments[i]
        is_last = i == segment_index - 1
        content_part = _format_segment_for_llm(prev_seg, section, is_last)
        if content_part:
            accumulated_parts.append(content_part)

    if not accumulated_parts:
        return instructions, None

    previous_content = "\n\n".join(accumulated_parts)
    return instructions, previous_content


@router.post("/module-sessions/{session_id}/message")
async def send_message_endpoint(
    session_id: int,
    request_body: SendMessageRequest,
    request: Request,
):
    """Send a message and stream the response."""
    from core.modules.types import ChatStage

    user_id = await get_user_id_for_module(request)

    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    check_session_access(session, user_id)

    # Check if this is a narrative module with position info
    is_narrative = (
        request_body.section_index is not None
        and request_body.segment_index is not None
    )

    if is_narrative:
        # Handle narrative module chat
        try:
            narrative_module = load_narrative_module(session["module_slug"])
            instructions, previous_content = get_narrative_chat_context(
                narrative_module,
                request_body.section_index,
                request_body.segment_index,
            )
            # For narrative modules, we use a simplified chat stage
            current_stage = ChatStage(
                type="chat",
                instructions=instructions,
                show_user_previous_content=True,
                show_tutor_previous_content=True,
            )
            current_content = None  # Not used for narrative chat
        except (ModuleNotFoundError, IndexError):
            raise HTTPException(status_code=400, detail="Invalid module or position")
    else:
        # Existing staged module logic
        module = load_module(session["module_slug"])
        stage_index = session["current_stage_index"]
        current_stage = module.stages[stage_index]
        previous_stage = module.stages[stage_index - 1] if stage_index > 0 else None

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
            async for chunk in send_module_message(
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


@router.post("/module-sessions/{session_id}/advance")
async def advance_session(session_id: int, request: Request):
    """Move to the next stage."""
    user_id = await get_user_id_for_module(request)

    try:
        session = await get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    check_session_access(session, user_id)

    module = load_module(session["module_slug"])
    current_stage_index = session["current_stage_index"]
    current_stage = module.stages[current_stage_index]

    if current_stage_index >= len(module.stages) - 1:
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
    new_stage = module.stages[current_stage_index + 1]
    started_msg = get_started_message(new_stage)
    if started_msg:
        await add_message(
            session_id, "system", started_msg["content"], started_msg.get("icon")
        )

    return {"completed": False, "new_stage_index": current_stage_index + 1}


@router.post("/module-sessions/{session_id}/claim")
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


@router.post("/module-sessions/{session_id}/heartbeat", status_code=204)
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
        # Get session to verify it exists and get module_id
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
                module_slug=session["module_slug"],
                stage_index=request_body.stage_index,
                stage_type=request_body.stage_type,
                event_type=ContentEventType.heartbeat,
                metadata=metadata if metadata else None,
            )
        )
        await conn.commit()

    return None  # 204 No Content
