"""Progress tracking API routes.

Endpoints:
- POST /api/progress/complete - Mark content as complete
- POST /api/progress/time - Update time spent (heartbeat or beacon)
"""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel

from core import get_or_create_user
from core.database import get_transaction
from core.modules.progress import (
    get_or_create_progress,
    mark_content_complete,
    update_time_spent,
    get_module_progress,
)
from web_api.auth import get_optional_user

router = APIRouter(prefix="/api/progress", tags=["progress"])


class MarkCompleteRequest(BaseModel):
    content_id: UUID
    content_type: str  # 'module', 'lo', 'lens', 'test'
    content_title: str
    time_spent_s: int = 0
    module_slug: str | None = (
        None  # If provided, return full module progress in response
    )
    # Legacy fields (deprecated - use module_slug instead)
    parent_module_id: UUID | None = None
    sibling_lens_ids: list[str] | None = None  # All lens UUIDs in the module


class LensProgressResponse(BaseModel):
    id: str | None
    title: str
    type: str
    optional: bool
    completed: bool
    completedAt: str | None
    timeSpentS: int


class MarkCompleteResponse(BaseModel):
    completed_at: str | None
    # Full module state (returned if module_slug provided in request)
    module_status: str | None = None  # "not_started" | "in_progress" | "completed"
    module_progress: dict | None = None  # { "completed": int, "total": int }
    lenses: list[LensProgressResponse] | None = None


class TimeUpdateRequest(BaseModel):
    content_id: UUID
    lo_id: UUID | None = None
    module_id: UUID | None = None
    content_title: str = ""
    module_title: str = ""
    lo_title: str = ""


async def get_user_or_token(
    request: Request,
    x_anonymous_token: str | None = Header(None),
    anonymous_token: str | None = Query(None),  # For sendBeacon (query param)
) -> tuple[int | None, UUID | None]:
    """Get user_id from auth or anonymous_token from header/query.

    For authenticated users, looks up the user record by discord_id to get user_id.
    For anonymous users, uses X-Anonymous-Token header or anonymous_token query param.
    Query param is used by sendBeacon which can't set custom headers.

    Returns:
        Tuple of (user_id, anonymous_token) - one will be set, the other None.

    Raises:
        HTTPException: 401 if neither authenticated nor session token provided.
    """
    user_jwt = await get_optional_user(request)
    if user_jwt:
        # Authenticated user - look up user_id from discord_id
        discord_id = user_jwt["sub"]
        user = await get_or_create_user(discord_id)
        return user["user_id"], None

    # Check header first, then query param (for sendBeacon)
    token_str = x_anonymous_token or anonymous_token
    if token_str:
        try:
            return None, UUID(token_str)
        except ValueError:
            raise HTTPException(400, "Invalid session token format")

    raise HTTPException(401, "Authentication required")


@router.post("/complete", response_model=MarkCompleteResponse)
async def complete_content(
    body: MarkCompleteRequest,
    auth: tuple = Depends(get_user_or_token),
):
    """Mark content as complete.

    Accepts either authenticated user (via session cookie) or anonymous user
    (via X-Anonymous-Token header).

    Args:
        body: Request with content_id, content_type, content_title, time_spent_s,
              and optionally module_slug for full module state response

    Returns:
        MarkCompleteResponse with completed_at timestamp and optionally module status
    """
    user_id, anonymous_token = auth

    if body.content_type not in ("module", "lo", "lens", "test"):
        raise HTTPException(400, "Invalid content_type")

    # If module_slug provided, return full module progress in response
    lenses = None
    module_status = None
    module_progress = None

    async with get_transaction() as conn:
        progress = await mark_content_complete(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=body.content_id,
            content_type=body.content_type,
            content_title=body.content_title,
            time_spent_s=body.time_spent_s,
        )

        # If module_slug provided, propagate completion and return full module progress
        if body.module_slug:
            from core.modules.loader import load_flattened_module, ModuleNotFoundError
            from core.modules.completion import propagate_completion

            try:
                module = load_flattened_module(body.module_slug)

                # Propagate completion to LO and module
                if module.content_id:
                    await propagate_completion(
                        conn,
                        user_id=user_id,
                        anonymous_token=anonymous_token,
                        module_sections=module.sections,
                        module_content_id=module.content_id,
                        completed_lens_id=body.content_id,
                    )
                content_ids = [
                    UUID(s["contentId"]) for s in module.sections if s.get("contentId")
                ]

                progress_map = await get_module_progress(
                    conn,
                    user_id=user_id,
                    anonymous_token=anonymous_token,
                    lens_ids=content_ids,
                )

                # Build lenses list
                lenses = []
                for section in module.sections:
                    content_id_str = section.get("contentId")
                    content_id = UUID(content_id_str) if content_id_str else None
                    title = (
                        section.get("meta", {}).get("title")
                        or section.get("title")
                        or "Untitled"
                    )
                    lens_data = LensProgressResponse(
                        id=content_id_str,
                        title=title,
                        type=section.get("type"),
                        optional=section.get("optional", False),
                        completed=False,
                        completedAt=None,
                        timeSpentS=0,
                    )
                    if content_id and content_id in progress_map:
                        prog = progress_map[content_id]
                        lens_data.completed = prog.get("completed_at") is not None
                        lens_data.completedAt = (
                            prog["completed_at"].isoformat()
                            if prog.get("completed_at")
                            else None
                        )
                        lens_data.timeSpentS = prog.get("total_time_spent_s", 0)
                    lenses.append(lens_data)

                # Calculate module status
                required_lenses = [lens for lens in lenses if not lens.optional]
                completed_count = sum(1 for lens in required_lenses if lens.completed)
                total_count = len(required_lenses)

                if completed_count == 0:
                    module_status = "not_started"
                elif completed_count >= total_count:
                    module_status = "completed"
                else:
                    module_status = "in_progress"

                module_progress = {"completed": completed_count, "total": total_count}

            except ModuleNotFoundError:
                pass  # Module not found, skip returning full state

        # Legacy: If sibling_lens_ids provided (but not module_slug), compute module status
        elif body.sibling_lens_ids:
            try:
                lens_uuids = [UUID(lid) for lid in body.sibling_lens_ids]
            except ValueError:
                lens_uuids = []

            if lens_uuids:
                progress_map = await get_module_progress(
                    conn,
                    user_id=user_id,
                    anonymous_token=anonymous_token,
                    lens_ids=lens_uuids,
                )

                # Count completed lenses
                completed_count = sum(
                    1
                    for lid in lens_uuids
                    if progress_map.get(lid, {}).get("completed_at")
                )
                total_count = len(lens_uuids)

                if completed_count == 0:
                    module_status = "not_started"
                elif completed_count >= total_count:
                    module_status = "completed"
                else:
                    module_status = "in_progress"

                module_progress = {"completed": completed_count, "total": total_count}

    return MarkCompleteResponse(
        completed_at=(
            progress["completed_at"].isoformat()
            if progress.get("completed_at")
            else None
        ),
        module_status=module_status,
        module_progress=module_progress,
        lenses=lenses,
    )


@router.post("/time", status_code=204)
async def update_time_endpoint(
    request: Request,
    body: TimeUpdateRequest | None = None,
    auth: tuple = Depends(get_user_or_token),
):
    """Update time spent on content (periodic heartbeat or beacon).

    Called periodically while user is viewing content to track engagement time.
    Server computes elapsed time from last_heartbeat_at column.
    Also handles sendBeacon on page unload which sends raw JSON without Content-Type.

    Args:
        request: Raw request for handling sendBeacon
        body: Request with content_id (and optional lo_id, module_id)
             May be None for sendBeacon requests
    """
    user_id, anonymous_token = auth

    # Handle sendBeacon (raw JSON body without Content-Type header)
    if body is None:
        try:
            raw = await request.body()
            data = json.loads(raw)
            content_id = UUID(data["content_id"])
            lo_id = UUID(data["lo_id"]) if data.get("lo_id") else None
            module_id = UUID(data["module_id"]) if data.get("module_id") else None
            content_title = data.get("content_title", "")
            module_title = data.get("module_title", "")
            lo_title = data.get("lo_title", "")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            raise HTTPException(400, f"Invalid request body: {e}")
    else:
        content_id = body.content_id
        lo_id = body.lo_id
        module_id = body.module_id
        content_title = body.content_title
        module_title = body.module_title
        lo_title = body.lo_title

    async with get_transaction() as conn:
        # Ensure lens record exists, then update time
        await get_or_create_progress(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=content_id,
            content_type="lens",
            content_title=content_title,
        )
        await update_time_spent(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=content_id,
        )

        if lo_id:
            await get_or_create_progress(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=lo_id,
                content_type="lo",
                content_title=lo_title,
            )
            await update_time_spent(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=lo_id,
            )

        if module_id:
            await get_or_create_progress(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=module_id,
                content_type="module",
                content_title=module_title,
            )
            await update_time_spent(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=module_id,
            )
