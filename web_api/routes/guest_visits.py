"""
Guest visit routes.

Endpoints:
- GET /api/guest-visits/options - Find alternative meetings for a user
- POST /api/guest-visits - Create a guest visit
- DELETE /api/guest-visits/{host_meeting_id} - Cancel a guest visit
- GET /api/guest-visits - List user's guest visits
"""

import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.calendar.events import get_event_instances, patch_event_instance
from core.database import get_connection, get_transaction
from core.discord_outbound import send_channel_message
from core.guest_notifications import notify_guest_role_changes
from core.guest_visits import (
    cancel_guest_visit,
    create_guest_visit,
    find_alternative_meetings,
    get_user_guest_visits,
)
from core.notifications.scheduler import schedule_guest_sync
from core.queries.users import get_user_by_discord_id
from core.sync import sync_group_discord_permissions
from core.tables import groups, meetings
from web_api.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guest-visits", tags=["guest-visits"])


@router.get("/options")
async def get_options(
    meeting_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get alternative meetings the user could attend as a guest.

    Query params:
        meeting_id: The user's home meeting they want to skip.
    """
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        alternatives = await find_alternative_meetings(
            conn, db_user["user_id"], meeting_id
        )

    return {"alternatives": alternatives}


class CreateGuestVisitRequest(BaseModel):
    """Schema for creating a guest visit."""

    home_meeting_id: int
    host_meeting_id: int


@router.post("")
async def create_guest_visit_endpoint(
    request: CreateGuestVisitRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Create a guest visit: attend a different group's meeting.

    Body:
        home_meeting_id: The user's own group meeting they'll miss.
        host_meeting_id: The other group's meeting they'll attend.
    """
    discord_id = user["sub"]

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            result = await create_guest_visit(
                conn,
                db_user["user_id"],
                request.home_meeting_id,
                request.host_meeting_id,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    # Transaction committed - now trigger side effects (fire-and-forget)
    host_group_id = result["host_group_id"]
    host_meeting_id = result["host_meeting_id"]
    host_scheduled_at = result["host_scheduled_at"]
    home_group_id = result["home_group_id"]
    email = db_user.get("email")
    guest_name = db_user.get("nickname") or db_user.get("discord_username") or "A member"

    # Notify home group that this member is visiting another group
    try:
        async with get_connection() as conn:
            group_result = await conn.execute(
                select(groups.c.discord_text_channel_id).where(
                    groups.c.group_id == home_group_id
                )
            )
            group_row = group_result.mappings().first()
            if group_row and group_row.get("discord_text_channel_id"):
                await send_channel_message(
                    group_row["discord_text_channel_id"],
                    f"{guest_name} is joining another group for this week's meeting because they can't attend this one.",
                )
    except Exception:
        logger.exception("Failed to send home group departure message")

    try:
        sync_result = await sync_group_discord_permissions(host_group_id)
        await notify_guest_role_changes(host_group_id, sync_result)
    except Exception:
        logger.exception("Failed to sync Discord permissions for guest visit")

    try:
        schedule_guest_sync(
            group_id=host_group_id,
            meeting_scheduled_at=datetime.fromisoformat(host_scheduled_at),
        )
    except Exception:
        logger.exception("Failed to schedule guest sync")

    try:
        await _sync_guest_calendar(host_group_id, host_meeting_id, email, add=True)
    except Exception:
        logger.exception("Failed to sync guest calendar invite")

    return result


@router.delete("/{host_meeting_id}")
async def delete_guest_visit_endpoint(
    host_meeting_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Cancel a guest visit.
    """
    discord_id = user["sub"]

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            result = await cancel_guest_visit(conn, db_user["user_id"], host_meeting_id)
        except ValueError as e:
            raise HTTPException(400, str(e))

    # Transaction committed - now trigger side effects (fire-and-forget)
    host_group_id = result["host_group_id"]
    email = db_user.get("email")
    guest_name = db_user.get("nickname") or db_user.get("discord_username") or "A guest"

    # Send farewell message BEFORE revoking role (so group members see it)
    try:
        async with get_connection() as conn:
            group_result = await conn.execute(
                select(groups.c.discord_text_channel_id).where(
                    groups.c.group_id == host_group_id
                )
            )
            group_row = group_result.mappings().first()
            if group_row and group_row.get("discord_text_channel_id"):
                await send_channel_message(
                    group_row["discord_text_channel_id"],
                    f"{guest_name}'s guest visit has been cancelled. They will be removed from this channel again.",
                )
    except Exception:
        logger.exception("Failed to send guest departure message")

    try:
        sync_result = await sync_group_discord_permissions(host_group_id)
        await notify_guest_role_changes(host_group_id, sync_result)
    except Exception:
        logger.exception("Failed to sync Discord permissions after guest visit cancel")

    try:
        await _sync_guest_calendar(host_group_id, host_meeting_id, email, add=False)
    except Exception:
        logger.exception("Failed to sync guest calendar invite removal")

    return {"status": "cancelled", **result}


@router.get("")
async def list_guest_visits(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    List the current user's guest visits.
    """
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        visits = await get_user_guest_visits(conn, db_user["user_id"])

    return {"visits": visits}


async def _sync_guest_calendar(
    host_group_id: int,
    host_meeting_id: int,
    user_email: str | None,
    add: bool,
) -> None:
    """
    Add or remove a guest from the Google Calendar event instance.

    Finds the specific instance of the host group's recurring event that
    matches the meeting time, then patches its attendee list.

    Args:
        host_group_id: The host group's ID (to find the recurring event).
        host_meeting_id: The host meeting ID (to find the scheduled time).
        user_email: The guest's email. If None, skip.
        add: True to add the guest, False to remove.
    """
    if not user_email:
        logger.info("No email for guest, skipping calendar sync")
        return

    # Look up group's recurring event ID and meeting's scheduled_at
    async with get_connection() as conn:
        group_result = await conn.execute(
            select(groups.c.gcal_recurring_event_id).where(
                groups.c.group_id == host_group_id
            )
        )
        group_row = group_result.mappings().first()
        if not group_row or not group_row["gcal_recurring_event_id"]:
            logger.info(
                f"No recurring event for group {host_group_id}, skipping calendar sync"
            )
            return

        recurring_event_id = group_row["gcal_recurring_event_id"]

        meeting_result = await conn.execute(
            select(meetings.c.scheduled_at).where(
                meetings.c.meeting_id == host_meeting_id
            )
        )
        meeting_row = meeting_result.mappings().first()
        if not meeting_row:
            logger.warning(f"Meeting {host_meeting_id} not found for calendar sync")
            return

        scheduled_at = meeting_row["scheduled_at"]

    # Get all instances of the recurring event
    instances = await get_event_instances(recurring_event_id)
    if not instances:
        logger.warning(f"No instances found for recurring event {recurring_event_id}")
        return

    # Match instance by start time
    target_instance = None
    for instance in instances:
        start = instance.get("start", {})
        instance_dt_str = start.get("dateTime")
        if not instance_dt_str:
            continue
        instance_dt = datetime.fromisoformat(instance_dt_str)
        if instance_dt == scheduled_at:
            target_instance = instance
            break

    if not target_instance:
        logger.warning(f"No matching instance found for meeting at {scheduled_at}")
        return

    # Modify attendees
    attendees = target_instance.get("attendees", [])
    if add:
        # Add guest if not already present
        if not any(a.get("email") == user_email for a in attendees):
            attendees.append({"email": user_email})
    else:
        # Remove guest
        attendees = [a for a in attendees if a.get("email") != user_email]

    # Patch the instance
    instance_id = target_instance["id"]
    success = await patch_event_instance(instance_id, attendees)
    if success:
        action = "added to" if add else "removed from"
        logger.info(f"Guest {user_email} {action} calendar event {instance_id}")
    else:
        logger.warning(
            f"Failed to patch calendar event {instance_id} for guest {user_email}"
        )
