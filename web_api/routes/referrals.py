"""
Referral link API routes.

User-facing endpoints (authenticated):
- GET /api/referrals/links - List user's links with per-link funnel stats
- POST /api/referrals/links - Create a campaign link
- PATCH /api/referrals/links/{link_id} - Update name/slug
- DELETE /api/referrals/links/{link_id} - Soft-delete a link

Admin endpoints:
- GET /api/admin/referrals/overview - Global funnel stats + referrer list
- GET /api/admin/referrals/referrers/{user_id} - Per-link breakdown for a user
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection, get_transaction
from core.queries.users import get_user_by_discord_id
from core.referrals import (
    create_campaign_link,
    get_all_referrer_stats,
    get_link_stats,
    get_user_links,
    soft_delete_link,
    update_link,
    validate_slug,
)
from web_api.auth import get_current_user, require_admin

# ── User-facing router ───────────────────────────────────────

router = APIRouter(prefix="/api/referrals", tags=["referrals"])


class CreateLinkRequest(BaseModel):
    name: str
    slug: str | None = None


class UpdateLinkRequest(BaseModel):
    name: str | None = None
    slug: str | None = None


@router.get("/links")
async def list_links(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """List the current user's referral links with per-link funnel stats."""
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        links = await get_user_links(conn, db_user["user_id"])
        result = []
        for link in links:
            stats = await get_link_stats(conn, link["link_id"])
            result.append({**link, **stats})

    return {"links": result}


@router.post("/links")
async def create_link(
    body: CreateLinkRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a campaign referral link."""
    discord_id = user["sub"]

    if body.slug is not None and not validate_slug(body.slug):
        raise HTTPException(
            400,
            "Invalid slug: must be 3-50 lowercase alphanumeric characters or hyphens, starting with a letter",
        )

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            link = await create_campaign_link(
                conn, db_user["user_id"], body.name, body.slug
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    return {"link": link}


@router.patch("/links/{link_id}")
async def update_link_endpoint(
    link_id: int,
    body: UpdateLinkRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Update a referral link's name and/or slug."""
    discord_id = user["sub"]

    if body.slug is not None and not validate_slug(body.slug):
        raise HTTPException(
            400,
            "Invalid slug: must be 3-50 lowercase alphanumeric characters or hyphens, starting with a letter",
        )

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            link = await update_link(
                conn, link_id, db_user["user_id"], body.name, body.slug
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    return {"link": link}


@router.delete("/links/{link_id}")
async def delete_link(
    link_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, str]:
    """Soft-delete a referral link (cannot delete the default link)."""
    discord_id = user["sub"]

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            await soft_delete_link(conn, link_id, db_user["user_id"])
        except ValueError as e:
            raise HTTPException(400, str(e))

    return {"status": "deleted"}


# ── Admin router ─────────────────────────────────────────────

admin_router = APIRouter(prefix="/api/admin/referrals", tags=["admin-referrals"])


@admin_router.get("/overview")
async def referral_overview(
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Global referral funnel stats and referrer list."""
    async with get_connection() as conn:
        referrers = await get_all_referrer_stats(conn)

    total = {
        "clicks": sum(r["clicks"] for r in referrers),
        "signups": sum(r["signups"] for r in referrers),
        "enrolled": sum(r["enrolled"] for r in referrers),
        "completed": sum(r["completed"] for r in referrers),
        "referrers": len(referrers),
    }

    return {"total": total, "referrers": referrers}


@admin_router.get("/referrers/{user_id}")
async def referrer_detail(
    user_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Per-link breakdown for a specific referrer."""
    async with get_connection() as conn:
        links = await get_user_links(conn, user_id)
        result = []
        for link in links:
            stats = await get_link_stats(conn, link["link_id"])
            result.append({**link, **stats})

    return {"links": result}
