"""Google Calendar integration for meeting invites and RSVP tracking."""

from .client import get_calendar_service, is_calendar_configured
from .events import (
    create_meeting_event,
    create_recurring_event,
    get_event_instances,
    update_meeting_event,
    cancel_meeting_event,
    get_event_rsvps,
)
from .rsvp import sync_meeting_rsvps, sync_upcoming_meeting_rsvps

__all__ = [
    "get_calendar_service",
    "is_calendar_configured",
    "create_meeting_event",
    "create_recurring_event",
    "get_event_instances",
    "update_meeting_event",
    "cancel_meeting_event",
    "get_event_rsvps",
    "sync_meeting_rsvps",
    "sync_upcoming_meeting_rsvps",
]
