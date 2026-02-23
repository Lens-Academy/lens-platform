"""
Module API routes.

Endpoints:
- GET /api/modules - List available modules
- GET /api/modules/{slug} - Get module definition (flattened)
- GET /api/modules/{slug}/progress - Get module progress
"""

import sys
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.modules import (
    get_available_modules,
    ModuleNotFoundError,
)
from core.modules.loader import load_flattened_module
from core.modules.flattened_types import FlattenedModule
from core.modules.progress import get_module_progress
from core.modules.chat_sessions import get_or_create_chat_session
from core.database import get_connection
from core import get_or_create_user
from web_api.auth import get_optional_user


router = APIRouter(prefix="/api", tags=["modules"])


# --- Serialization Helpers ---


def serialize_flattened_module(module: FlattenedModule) -> dict:
    """Serialize a flattened module to JSON for the API response.

    Sections are already dicts (page, video, article) so we pass them through.
    Error field is only included when present (not None).
    """
    result = {
        "slug": module.slug,
        "title": module.title,
        "sections": module.sections,  # Already dicts from flattener
    }
    if module.error is not None:
        result["error"] = module.error
    return result


# --- Module Definition Endpoints ---


@router.get("/modules")
async def list_modules(type: str | None = None):
    """List available modules.

    Query params:
        type: Filter — 'module' (no lens/ prefix), 'lens' (lens/ prefix), or None (all)
    """
    module_slugs = get_available_modules()
    modules = []
    for slug in module_slugs:
        is_lens = slug.startswith("lens/")
        if type == "module" and is_lens:
            continue
        if type == "lens" and not is_lens:
            continue
        try:
            module = load_flattened_module(slug)
            modules.append(
                {
                    "slug": module.slug,
                    "title": module.title,
                    "type": "lens" if is_lens else "module",
                }
            )
        except ModuleNotFoundError:
            pass
    return {"modules": modules}


# CRITICAL: Progress route MUST be defined BEFORE catch-all module route.
# {module_slug:path} is greedy — without this ordering, /lens/foo/progress
# would be consumed as module_slug="lens/foo/progress" by the catch-all.
@router.get("/modules/{module_slug:path}/progress")
async def get_module_progress_endpoint(
    module_slug: str,
    request: Request,
    x_anonymous_token: str | None = Header(None),
):
    """Get detailed progress for a single module.

    Returns lens-level completion status, time spent, and chat session info.
    """
    # Get user or session token
    user_jwt = await get_optional_user(request)
    user_id = None
    if user_jwt:
        # Authenticated user - look up user_id from discord_id
        discord_id = user_jwt["sub"]
        user = await get_or_create_user(discord_id)
        user_id = user["user_id"]

    anonymous_token = None
    if not user_id and x_anonymous_token:
        try:
            anonymous_token = UUID(x_anonymous_token)
        except ValueError:
            pass

    if not user_id and not anonymous_token:
        raise HTTPException(401, "Authentication required")

    # Load module
    try:
        module = load_flattened_module(module_slug)
    except ModuleNotFoundError:
        raise HTTPException(404, "Module not found")

    # Collect content IDs from flattened sections (sections are dicts)
    content_ids = [UUID(s["contentId"]) for s in module.sections if s.get("contentId")]

    async with get_connection() as conn:
        # Get progress for all lenses/sections
        progress_map = await get_module_progress(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            lens_ids=content_ids,
        )

        # Get chat session
        chat_session = await get_or_create_chat_session(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module.content_id,
            content_type="module",
        )

    # Build lens list with completion status (sections are dicts)
    lenses = []
    for section in module.sections:
        content_id_str = section.get("contentId")
        content_id = UUID(content_id_str) if content_id_str else None
        # Get title from meta if present, otherwise from title key
        title = (
            section.get("meta", {}).get("title") or section.get("title") or "Untitled"
        )
        lens_data = {
            "id": content_id_str,
            "title": title,
            "type": section.get("type"),
            "optional": section.get("optional", False),
            "completed": False,
            "completedAt": None,
            "timeSpentS": 0,
        }
        if content_id and content_id in progress_map:
            prog = progress_map[content_id]
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

    # Build response
    response = {
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

    # Include error if module has one
    if module.error:
        response["error"] = module.error

    return response


@router.get("/modules/{module_slug:path}")
async def get_module(module_slug: str):
    """Get a module definition with flattened sections."""
    try:
        module = load_flattened_module(module_slug)
        return serialize_flattened_module(module)
    except ModuleNotFoundError:
        raise HTTPException(status_code=404, detail="Module not found")
