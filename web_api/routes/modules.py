"""
Module API routes.

Endpoints:
- GET /api/modules - List available modules
- GET /api/modules/{slug} - Get module definition
- GET /api/modules/{slug}/progress - Get module progress
"""

import sys
from pathlib import Path

from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.modules import (
    load_module,
    get_available_modules,
    ModuleNotFoundError,
    VideoStage,
    load_video_transcript_with_metadata,
)
from core.modules.loader import load_narrative_module
from core.modules.content import bundle_narrative_module
from core.modules.progress import get_module_progress
from core.modules.chat_sessions import get_or_create_chat_session
from core.database import get_connection
from web_api.auth import get_optional_user


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
                            "hidePreviousContentFromUser": s.hide_previous_content_from_user,
                            "hidePreviousContentFromTutor": s.hide_previous_content_from_tutor,
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


@router.get("/modules/{module_slug}/progress")
async def get_module_progress_endpoint(
    module_slug: str,
    request: Request,
    x_anonymous_token: str | None = Header(None),
):
    """Get detailed progress for a single module.

    Returns lens-level completion status, time spent, and chat session info.
    """
    # Get user or session token
    user = await get_optional_user(request)
    user_id = user["user_id"] if user else None
    anonymous_token = None
    if not user_id and x_anonymous_token:
        try:
            anonymous_token = UUID(x_anonymous_token)
        except ValueError:
            pass

    if not user_id and not anonymous_token:
        raise HTTPException(401, "Authentication required")

    # Load module
    module = load_narrative_module(module_slug)
    if not module:
        raise HTTPException(404, "Module not found")

    # Collect lens UUIDs
    lens_ids = [s.content_id for s in module.sections if s.content_id]

    async with get_connection() as conn:
        # Get progress for all lenses
        progress_map = await get_module_progress(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            lens_ids=lens_ids,
        )

        # Get chat session
        chat_session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module.content_id,
            content_type="module",
        )

    # Build lens list with completion status
    lenses = []
    for section in module.sections:
        lens_data = {
            "id": str(section.content_id) if section.content_id else None,
            "title": getattr(section, "title", section.type),
            "type": section.type,
            "optional": getattr(section, "optional", False),
            "completed": False,
            "completedAt": None,
            "timeSpentS": 0,
        }
        if section.content_id and section.content_id in progress_map:
            prog = progress_map[section.content_id]
            lens_data["completed"] = prog.get("completed_at") is not None
            lens_data["completedAt"] = (
                prog["completed_at"].isoformat() if prog.get("completed_at") else None
            )
            lens_data["timeSpentS"] = prog.get("total_time_spent_s", 0)
        lenses.append(lens_data)

    # Calculate module status
    required_lenses = [lens for lens in lenses if not lens["optional"]]
    completed_count = sum(1 for lens in required_lenses if lens["completed"])
    total_count = len(required_lenses)

    if completed_count == 0:
        status = "not_started"
    elif completed_count >= total_count:
        status = "completed"
    else:
        status = "in_progress"

    return {
        "module": {
            "id": str(module.content_id) if module.content_id else None,
            "slug": module.slug,
            "title": module.title,
        },
        "status": status,
        "progress": {"completed": completed_count, "total": total_count},
        "lenses": lenses,
        "chatSession": {
            "sessionId": chat_session["session_id"],
            "hasMessages": len(chat_session.get("messages", [])) > 0,
        },
    }
