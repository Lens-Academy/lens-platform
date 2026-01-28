"""Progress tracking API routes.

Endpoints:
- POST /api/progress/complete - Mark content as complete
- POST /api/progress/time - Update time spent (heartbeat or beacon)
- POST /api/progress/claim - Claim anonymous records for authenticated user
"""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from pydantic import BaseModel

from core import get_or_create_user
from core.database import get_connection
from core.modules.progress import (
    mark_content_complete,
    update_time_spent,
    claim_progress_records,
    get_module_progress,
)
from core.modules.chat_sessions import claim_chat_sessions
from web_api.auth import get_optional_user

router = APIRouter(prefix="/api/progress", tags=["progress"])


class MarkCompleteRequest(BaseModel):
    content_id: UUID
    content_type: str  # 'module', 'lo', 'lens', 'test'
    content_title: str
    time_spent_s: int = 0
    # Optional: for computing parent module status when marking lens complete
    parent_module_id: UUID | None = None
    sibling_lens_ids: list[str] | None = None  # All lens UUIDs in the module


class MarkCompleteResponse(BaseModel):
    completed_at: str | None
    module_status: str | None = None
    module_progress: dict | None = None


class TimeUpdateRequest(BaseModel):
    content_id: UUID
    time_delta_s: int


class ClaimRequest(BaseModel):
    anonymous_token: UUID


class ClaimResponse(BaseModel):
    progress_records_claimed: int
    chat_sessions_claimed: int


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
              and optionally parent_module_id and sibling_lens_ids for module status

    Returns:
        MarkCompleteResponse with completed_at timestamp and optionally module status
    """
    user_id, anonymous_token = auth

    if body.content_type not in ("module", "lo", "lens", "test"):
        raise HTTPException(400, "Invalid content_type")

    module_status = None
    module_progress = None

    async with get_connection() as conn:
        progress = await mark_content_complete(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=body.content_id,
            content_type=body.content_type,
            content_title=body.content_title,
            time_spent_s=body.time_spent_s,
        )

        # If sibling_lens_ids provided, compute module status
        if body.sibling_lens_ids:
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
    )


@router.post("/time", status_code=204)
async def update_time_endpoint(
    request: Request,
    body: TimeUpdateRequest | None = None,
    auth: tuple = Depends(get_user_or_token),
):
    """Update time spent on content (periodic heartbeat or beacon).

    Called periodically while user is viewing content to track engagement time.
    Also handles sendBeacon on page unload which sends raw JSON without Content-Type.

    Args:
        request: Raw request for handling sendBeacon
        body: Request with content_id and time_delta_s (seconds to add)
             May be None for sendBeacon requests
    """
    user_id, anonymous_token = auth

    # Handle sendBeacon (raw JSON body without Content-Type header)
    if body is None:
        try:
            raw = await request.body()
            data = json.loads(raw)
            content_id = UUID(data["content_id"])
            time_delta_s = data["time_delta_s"]
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            raise HTTPException(400, f"Invalid request body: {e}")
    else:
        content_id = body.content_id
        time_delta_s = body.time_delta_s

    async with get_connection() as conn:
        await update_time_spent(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=content_id,
            time_delta_s=time_delta_s,
        )


@router.post("/claim", response_model=ClaimResponse)
async def claim_records(
    body: ClaimRequest,
    request: Request,
):
    """Claim all anonymous records for authenticated user.

    Called after login to associate any progress/chat records created
    anonymously with the now-authenticated user.

    Args:
        body: Request with anonymous_token (the anonymous token to claim from)

    Returns:
        ClaimResponse with counts of records claimed
    """
    user_jwt = await get_optional_user(request)
    if not user_jwt:
        raise HTTPException(401, "Must be authenticated to claim records")

    # Get user_id from discord_id
    discord_id = user_jwt["sub"]
    user = await get_or_create_user(discord_id)
    user_id = user["user_id"]

    async with get_connection() as conn:
        progress_count = await claim_progress_records(
            conn,
            anonymous_token=body.anonymous_token,
            user_id=user_id,
        )
        chat_count = await claim_chat_sessions(
            conn,
            anonymous_token=body.anonymous_token,
            user_id=user_id,
        )

    return ClaimResponse(
        progress_records_claimed=progress_count,
        chat_sessions_claimed=chat_count,
    )
