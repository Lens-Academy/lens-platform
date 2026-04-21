"""
Cohort routes.

Endpoints:
- GET /api/cohorts/available - Get cohorts available for enrollment
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection
from core.prospects import (
    get_public_cohort_list,
    has_available_cohorts as check_available_cohorts,
)
from core.queries.cohorts import get_available_cohorts
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api/cohorts", tags=["cohorts"])


@router.get("/available-public")
async def get_available_public() -> dict:
    """Check if any cohorts are available for enrollment (no auth required)."""
    return {"has_available": await check_available_cohorts()}


@router.get("/available-list")
async def get_available_list_public() -> dict:
    """Get cohorts available for enrollment with enrollment-path info (no auth required)."""
    return {"cohorts": await get_public_cohort_list()}


@router.get("/available")
async def get_available(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get cohorts available for enrollment.

    Returns enrolled cohorts (read-only) and available cohorts (can enroll).
    """
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        user_id = db_user["user_id"] if db_user else None
        return await get_available_cohorts(conn, user_id)
