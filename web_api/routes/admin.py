"""
Admin panel API routes.

All endpoints require admin authentication.
"""

import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection, get_transaction
from core.group_joining import get_user_current_group_membership, assign_to_group
from core.queries.cohorts import get_all_cohorts_summary
from core.queries.groups import (
    create_group,
    get_cohort_group_ids,
    get_cohort_groups_summary,
    get_cohort_preview_group_ids,
    remove_user_from_group,
)
from core.queries.users import get_user_admin_details, search_users
from core.sync import sync_after_group_change, sync_group
from core.tables import cohorts, groups
from web_api.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserSearchRequest(BaseModel):
    """Request body for user search."""

    query: str
    limit: int = 20


class MemberRequest(BaseModel):
    """Request body for member operations."""

    user_id: int


class CreateGroupRequest(BaseModel):
    """Request body for creating a group."""

    cohort_id: int
    group_name: str
    meeting_time: str  # e.g., "Wednesday 15:00"
    max_size: int | None = None


class CreateCohortRequest(BaseModel):
    """Request body for creating a cohort."""

    cohort_name: str
    course_slug: str = "default"
    cohort_start_date: date
    duration_days: int = 42
    number_of_group_meetings: int = 6
    max_group_size: int = 8
    accepts_availability_signups: bool = True


class UpdateCohortRequest(BaseModel):
    """Request body for updating a cohort (all fields optional)."""

    cohort_name: str | None = None
    max_group_size: int | None = Field(default=None, ge=1)
    accepts_availability_signups: bool | None = None
    status: str | None = None


class UpdateGroupRequest(BaseModel):
    """Request body for updating a group."""

    max_size: int | None = Field(default=None, ge=1)
    clear_max_size: bool = False


@router.post("/users/search")
async def search_users_endpoint(
    request: UserSearchRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Search users by nickname or discord_username.

    Returns list of matching users with basic info.
    """
    async with get_connection() as conn:
        users = await search_users(conn, request.query, request.limit)

    return {"users": users}


@router.get("/users/{user_id}")
async def get_user_details_endpoint(
    user_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Get detailed user information including group membership.
    """
    async with get_connection() as conn:
        user = await get_user_admin_details(conn, user_id)

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.post("/groups/{group_id}/sync")
async def sync_group_endpoint(
    group_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Sync a group's Discord permissions, calendar, and reminders.

    Does NOT create infrastructure - use /realize for that.
    """
    result = await sync_group(group_id, allow_create=False)
    return result


@router.post("/groups/{group_id}/realize")
async def realize_group_endpoint(
    group_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Realize a group - create Discord infrastructure and sync.

    Creates category, channels, calendar events, then syncs permissions.
    """
    result = await sync_group(group_id, allow_create=True)
    return result


@router.post("/groups/{group_id}/members/add")
async def add_member_endpoint(
    group_id: int,
    request: MemberRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Add a user to a group (admin operation - bypasses capacity/timing validation).

    If user is already in another group, removes them from the old group first.
    Automatically syncs Discord permissions, calendar, and sends notifications.
    """
    from sqlalchemy import select

    from core.tables import groups

    async with get_transaction() as conn:
        # Check target group exists
        result = await conn.execute(
            select(groups.c.group_id).where(groups.c.group_id == group_id)
        )
        if not result.first():
            raise HTTPException(status_code=404, detail="Group not found")

        # Get user's current group (if any)
        current_group = await get_user_current_group_membership(conn, request.user_id)

        # Check user isn't already in target group
        if current_group and current_group["group_id"] == group_id:
            raise HTTPException(status_code=400, detail="User is already in this group")

        # Switch groups (no capacity/timing validation - admin can bypass)
        previous_group_id = current_group["group_id"] if current_group else None

        result = await assign_to_group(
            conn,
            user_id=request.user_id,
            to_group_id=group_id,
            from_group_id=previous_group_id,
        )

    # Sync after transaction commits (handles both new and old group if switching)
    await sync_after_group_change(
        group_id=group_id,
        previous_group_id=previous_group_id,
        user_id=request.user_id,
    )

    status = "moved" if previous_group_id else "added"
    return {"status": status, "group_id": result["group_id"]}


@router.post("/groups/{group_id}/members/remove")
async def remove_member_endpoint(
    group_id: int,
    request: MemberRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Remove a user from a group.

    Automatically syncs to revoke Discord permissions and calendar access.
    """
    async with get_transaction() as conn:
        removed = await remove_user_from_group(conn, group_id, request.user_id)

    if not removed:
        raise HTTPException(status_code=404, detail="User not in group")

    # Sync to revoke access
    await sync_after_group_change(group_id=group_id)

    return {"status": "removed"}


@router.post("/groups/create")
async def create_group_endpoint(
    request: CreateGroupRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    Create a new group in a cohort.

    Group starts in 'preview' status. Use /realize to create Discord infrastructure.
    """
    async with get_transaction() as conn:
        group = await create_group(
            conn,
            cohort_id=request.cohort_id,
            group_name=request.group_name,
            recurring_meeting_time_utc=request.meeting_time,
            max_size=request.max_size,
        )

    return group


@router.post("/cohorts/{cohort_id}/sync")
async def sync_cohort_endpoint(
    cohort_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Sync all groups in a cohort."""
    async with get_connection() as conn:
        group_ids = await get_cohort_group_ids(conn, cohort_id)

    results = []
    for group_id in group_ids:
        result = await sync_group(group_id, allow_create=False)
        results.append({"group_id": group_id, "result": result})

    return {"synced": len(results), "results": results}


@router.post("/cohorts/{cohort_id}/realize")
async def realize_cohort_endpoint(
    cohort_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Realize All Preview Groups in a cohort."""
    async with get_connection() as conn:
        group_ids = await get_cohort_preview_group_ids(conn, cohort_id)

    results = []
    for group_id in group_ids:
        result = await sync_group(group_id, allow_create=True)
        results.append({"group_id": group_id, "result": result})

    return {"realized": len(results), "results": results}


@router.get("/cohorts")
async def list_cohorts_endpoint(
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    List all cohorts for admin panel.
    """
    async with get_connection() as conn:
        cohort_list = await get_all_cohorts_summary(conn)

    return {"cohorts": cohort_list}


@router.get("/cohorts/{cohort_id}/groups")
async def list_cohort_groups_endpoint(
    cohort_id: int,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """
    List all groups in a cohort with member counts.
    """
    async with get_connection() as conn:
        groups_list = await get_cohort_groups_summary(conn, cohort_id)

    return {"groups": groups_list}


@router.post("/cohorts")
async def create_cohort_endpoint(
    request: CreateCohortRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Create a new cohort."""
    from sqlalchemy import insert

    async with get_transaction() as conn:
        result = await conn.execute(
            insert(cohorts)
            .values(
                cohort_name=request.cohort_name,
                course_slug=request.course_slug,
                cohort_start_date=request.cohort_start_date,
                duration_days=request.duration_days,
                number_of_group_meetings=request.number_of_group_meetings,
                max_group_size=request.max_group_size,
                accepts_availability_signups=request.accepts_availability_signups,
                status="active",
            )
            .returning(cohorts)
        )
        cohort = dict(result.mappings().first())

    cohort["cohort_start_date"] = cohort["cohort_start_date"].isoformat()
    return cohort


@router.patch("/cohorts/{cohort_id}")
async def update_cohort_endpoint(
    cohort_id: int,
    request: UpdateCohortRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Update a cohort (partial update)."""
    from sqlalchemy import select, update

    updates = {}
    if request.cohort_name is not None:
        updates["cohort_name"] = request.cohort_name
    if request.max_group_size is not None:
        updates["max_group_size"] = request.max_group_size
    if request.accepts_availability_signups is not None:
        updates["accepts_availability_signups"] = request.accepts_availability_signups
    if request.status is not None:
        updates["status"] = request.status

    if not updates:
        raise HTTPException(400, "No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc)

    async with get_transaction() as conn:
        result = await conn.execute(
            select(cohorts.c.cohort_id).where(cohorts.c.cohort_id == cohort_id)
        )
        if not result.first():
            raise HTTPException(404, "Cohort not found")

        await conn.execute(
            update(cohorts).where(cohorts.c.cohort_id == cohort_id).values(**updates)
        )

    return {"status": "updated", "cohort_id": cohort_id, **updates}


@router.patch("/groups/{group_id}")
async def update_group_endpoint(
    group_id: int,
    request: UpdateGroupRequest,
    admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    """Update a group (partial update). Set clear_max_size=true to revert to cohort default."""
    from sqlalchemy import select, update

    updates: dict[str, Any] = {}
    if request.clear_max_size:
        updates["max_size"] = None
    elif request.max_size is not None:
        updates["max_size"] = request.max_size

    if not updates:
        raise HTTPException(400, "No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc)

    async with get_transaction() as conn:
        result = await conn.execute(
            select(groups.c.group_id).where(groups.c.group_id == group_id)
        )
        if not result.first():
            raise HTTPException(404, "Group not found")

        await conn.execute(
            update(groups).where(groups.c.group_id == group_id).values(**updates)
        )

    return {"status": "updated", "group_id": group_id, **updates}
