"""Google Calendar integration for meeting invites and RSVP tracking."""

from .client import get_calendar_service, is_calendar_configured, batch_delete_events
from .events import (
    create_meeting_event,
    create_recurring_event,
    get_event_instances,
    update_meeting_event,
    cancel_meeting_event,
    get_event_rsvps,
)
from .rsvp import sync_group_rsvps_from_recurring

__all__ = [
    "get_calendar_service",
    "is_calendar_configured",
    "batch_delete_events",
    "create_meeting_event",
    "create_recurring_event",
    "get_event_instances",
    "update_meeting_event",
    "cancel_meeting_event",
    "get_event_rsvps",
    "sync_group_rsvps_from_recurring",
]
