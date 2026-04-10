"""Zoom API integration for meeting scheduling and attendance."""

from .client import is_zoom_configured, zoom_request
from .hosts import find_available_host
from .meetings import create_meeting, update_meeting, delete_meeting, get_meeting
from .participants import get_meeting_participants
from .attendance import sync_meeting_attendance, sync_zoom_attendance

__all__ = [
    "is_zoom_configured",
    "zoom_request",
    "find_available_host",
    "create_meeting",
    "update_meeting",
    "delete_meeting",
    "get_meeting",
    "get_meeting_participants",
    "sync_meeting_attendance",
    "sync_zoom_attendance",
]
