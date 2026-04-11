"""Zoom meeting management — create, update, delete standalone meetings."""

import logging

from .client import zoom_request, _log_zoom_error, is_zoom_configured

logger = logging.getLogger(__name__)


async def create_meeting(
    host_email: str,
    topic: str,
    start_time: str,
    duration_minutes: int,
    timezone: str = "UTC",
) -> dict | None:
    """
    Create a standalone scheduled Zoom meeting.

    Args:
        host_email: Email of the licensed Zoom user who will host.
        topic: Meeting title.
        start_time: ISO 8601 datetime string (e.g. "2026-04-10T15:00:00Z").
        duration_minutes: Meeting length in minutes.
        timezone: Timezone for the meeting (default UTC).

    Returns:
        Dict with "id" (int), "join_url", "start_url", or None if not configured.
    """
    if not is_zoom_configured():
        return None

    body = {
        "topic": topic,
        "type": 2,  # Scheduled meeting
        "start_time": start_time,
        "duration": duration_minutes,
        "timezone": timezone,
        "settings": {
            "join_before_host": True,
            "waiting_room": False,
            "mute_upon_entry": True,
            "auto_recording": "none",
        },
    }

    try:
        data = await zoom_request("POST", f"/users/{host_email}/meetings", json=body)
        if data is None:
            return None
        return {
            "id": data["id"],
            "join_url": data["join_url"],
            "start_url": data.get("start_url", ""),
        }
    except Exception as e:
        _log_zoom_error(e, "create_meeting", {"host": host_email, "topic": topic})
        raise


async def update_meeting(
    meeting_id: int,
    topic: str | None = None,
    start_time: str | None = None,
    duration_minutes: int | None = None,
    timezone: str | None = None,
) -> dict | None:
    """
    Update an existing Zoom meeting's details.

    Only non-None fields are sent in the patch.
    Returns empty dict on success, None if not configured.
    """
    body = {}
    if topic is not None:
        body["topic"] = topic
    if start_time is not None:
        body["start_time"] = start_time
    if duration_minutes is not None:
        body["duration"] = duration_minutes
    if timezone is not None:
        body["timezone"] = timezone

    if not body:
        return {}

    try:
        return await zoom_request("PATCH", f"/meetings/{meeting_id}", json=body)
    except Exception as e:
        _log_zoom_error(e, "update_meeting", {"meeting_id": meeting_id})
        raise


async def delete_meeting(meeting_id: int) -> dict | None:
    """
    Delete a Zoom meeting.

    Returns empty dict on success, None if not configured.
    """
    try:
        return await zoom_request("DELETE", f"/meetings/{meeting_id}")
    except Exception as e:
        _log_zoom_error(e, "delete_meeting", {"meeting_id": meeting_id})
        raise


async def get_meeting(meeting_id: int) -> dict | None:
    """
    Fetch details of an existing Zoom meeting.

    Returns the meeting data dict, or None if not configured.
    """
    try:
        return await zoom_request("GET", f"/meetings/{meeting_id}")
    except Exception as e:
        _log_zoom_error(e, "get_meeting", {"meeting_id": meeting_id})
        raise
