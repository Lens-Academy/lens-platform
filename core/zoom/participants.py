"""Fetch meeting participant data from the Zoom Reports API."""

import logging

import httpx

from .client import zoom_request, _log_zoom_error

logger = logging.getLogger(__name__)


async def get_meeting_participants(zoom_meeting_id: int) -> list[dict] | None:
    """
    Fetch all participants for a completed Zoom meeting.

    Uses the Reports API: GET /report/meetings/{meetingId}/participants.
    Requires scope: report:read:list_meeting_participants:admin.

    Args:
        zoom_meeting_id: The Zoom meeting ID (numeric).

    Returns:
        List of participant dicts (each with "user_email", "name", "join_time",
        "leave_time", "duration"), or None if:
        - Meeting hasn't ended yet (404 or error code 3001)
        - Zoom is not configured
    """
    try:
        data = await zoom_request(
            "GET",
            f"/report/meetings/{zoom_meeting_id}/participants",
            params={"page_size": 300},
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None
        # Error code 3001 = "Meeting report is not available" (HTTP 400)
        if e.response.status_code == 400:
            try:
                body = e.response.json()
                if body.get("code") == 3001:
                    return None
            except Exception:
                pass
        _log_zoom_error(
            e, "get_meeting_participants", {"zoom_meeting_id": zoom_meeting_id}
        )
        raise

    if data is None:
        return None

    participants = []
    _collect_participants(participants, data)

    # Handle pagination
    next_token = data.get("next_page_token", "")
    while next_token:
        try:
            data = await zoom_request(
                "GET",
                f"/report/meetings/{zoom_meeting_id}/participants",
                params={"page_size": 300, "next_page_token": next_token},
            )
        except httpx.HTTPStatusError as e:
            _log_zoom_error(
                e,
                "get_meeting_participants (pagination)",
                {"zoom_meeting_id": zoom_meeting_id},
            )
            raise

        if data is None:
            break

        _collect_participants(participants, data)
        next_token = data.get("next_page_token", "")

    return participants


def _collect_participants(result: list[dict], page: dict) -> None:
    """Append participants with non-empty emails from a response page."""
    for p in page.get("participants", []):
        email = p.get("user_email", "")
        if email:
            result.append(p)
