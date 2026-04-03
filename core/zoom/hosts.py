"""Zoom host assignment — find available licensed hosts via the Zoom API."""

import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from core.database import get_connection
from core.tables import meetings
from core.zoom.client import zoom_request

logger = logging.getLogger(__name__)


async def _get_licensed_hosts() -> list[dict]:
    """
    Fetch all licensed, active Zoom users from the account.

    Returns list of dicts with "id", "email".
    Only includes licensed (type=2) and active users.
    """
    result = await zoom_request("GET", "/users", params={"page_size": 100, "status": "active"})
    if not result:
        return []
    return [
        {"id": u["id"], "email": u["email"]}
        for u in result.get("users", [])
        if u.get("type") == 2 and u.get("status") == "active"
    ]


async def _get_busy_host_emails(
    start_time: datetime,
    duration_minutes: int,
) -> set[str]:
    """
    Find host emails that have an overlapping meeting in our database.

    A meeting overlaps if it starts before our end_time AND ends after our start_time.
    """
    end_time = start_time + timedelta(minutes=duration_minutes)

    async with get_connection() as conn:
        result = await conn.execute(
            select(meetings.c.zoom_host_email)
            .where(meetings.c.zoom_host_email.isnot(None))
            .where(meetings.c.scheduled_at < end_time)
            .where(
                meetings.c.scheduled_at + timedelta(minutes=duration_minutes) > start_time
            )
            .distinct()
        )
        return {row[0] for row in result.all()}


async def find_available_host(
    start_time: datetime,
    duration_minutes: int = 60,
) -> dict | None:
    """
    Find a licensed Zoom host with no conflicting meetings at the given time.

    Queries the Zoom API for all licensed users, then checks our meetings
    table for time conflicts. Returns the first available host.

    Args:
        start_time: Meeting start time (timezone-aware).
        duration_minutes: Meeting duration in minutes.

    Returns:
        Dict with "id" (Zoom user ID), "email", or None if all hosts are busy.
    """
    hosts = await _get_licensed_hosts()
    if not hosts:
        logger.warning("No licensed Zoom hosts found on the account")
        return None

    busy_emails = await _get_busy_host_emails(start_time, duration_minutes)

    for host in hosts:
        if host["email"] not in busy_emails:
            return host

    logger.warning(
        f"All {len(hosts)} Zoom hosts are busy at {start_time} "
        f"(busy: {busy_emails})"
    )
    return None
