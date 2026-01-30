"""Google Calendar event operations."""

import asyncio
import logging
from datetime import datetime, timedelta

import sentry_sdk

from .client import get_calendar_service, get_calendar_email

logger = logging.getLogger(__name__)


async def create_meeting_event(
    title: str,
    description: str,
    start: datetime,
    attendee_emails: list[str],
    duration_minutes: int = 60,
) -> str | None:
    """
    Create a calendar event and send invites to attendees.

    Args:
        title: Event title (e.g., "Study Group Alpha - Week 1")
        description: Event description
        start: Start datetime (must be timezone-aware)
        attendee_emails: List of attendee email addresses
        duration_minutes: Meeting duration (default 60)

    Returns:
        Google Calendar event ID, or None if calendar not configured
    """
    service = get_calendar_service()
    if not service:
        print("Warning: Google Calendar not configured, skipping event creation")
        return None

    end = start + timedelta(minutes=duration_minutes)

    event = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
        "attendees": [{"email": email} for email in attendee_emails],
        "guestsCanSeeOtherGuests": False,
        "guestsCanModify": False,
        "reminders": {"useDefault": False, "overrides": []},  # We handle reminders
    }

    def _sync_insert():
        return (
            service.events()
            .insert(
                calendarId=get_calendar_email(),
                body=event,
                sendUpdates="all",
            )
            .execute()
        )

    try:
        result = await asyncio.to_thread(_sync_insert)
        return result["id"]
    except Exception as e:
        print(f"Failed to create calendar event: {e}")
        return None


async def create_recurring_event(
    title: str,
    description: str,
    first_meeting: datetime,
    duration_minutes: int,
    num_occurrences: int,
    attendee_emails: list[str],
) -> str | None:
    """
    Create a recurring calendar event with weekly frequency.

    Args:
        title: Event title (e.g., "Study Group Alpha")
        description: Event description
        first_meeting: First occurrence datetime (must be timezone-aware)
        duration_minutes: Meeting duration
        num_occurrences: Number of weekly meetings
        attendee_emails: List of attendee email addresses

    Returns:
        Google Calendar recurring event ID, or None if calendar not configured
    """
    service = get_calendar_service()
    if not service:
        logger.warning(
            "Google Calendar not configured, skipping recurring event creation"
        )
        return None

    end = first_meeting + timedelta(minutes=duration_minutes)

    event = {
        "summary": title,
        "description": description,
        "start": {"dateTime": first_meeting.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
        "recurrence": [f"RRULE:FREQ=WEEKLY;COUNT={num_occurrences}"],
        "attendees": [{"email": email} for email in attendee_emails],
        "guestsCanSeeOtherGuests": False,
        "guestsCanModify": False,
        "reminders": {"useDefault": False, "overrides": []},
    }

    def _sync_insert():
        return (
            service.events()
            .insert(
                calendarId=get_calendar_email(),
                body=event,
                sendUpdates="all",
            )
            .execute()
        )

    try:
        result = await asyncio.to_thread(_sync_insert)
        return result["id"]
    except Exception as e:
        logger.error(f"Failed to create recurring calendar event: {e}")
        sentry_sdk.capture_exception(e)
        return None


async def get_event_instances(recurring_event_id: str) -> list[dict] | None:
    """
    Get all instances of a recurring event.

    Each instance includes its own ID, start time, and attendee RSVPs.

    Args:
        recurring_event_id: The parent recurring event ID

    Returns:
        List of instance dicts with id, start, attendees, etc.
        Returns None if calendar not configured or API error.
    """
    service = get_calendar_service()
    if not service:
        return None

    calendar_id = get_calendar_email()

    def _sync_instances():
        return (
            service.events()
            .instances(calendarId=calendar_id, eventId=recurring_event_id)
            .execute()
        )

    try:
        result = await asyncio.to_thread(_sync_instances)
        return result.get("items", [])
    except Exception as e:
        logger.error(f"Failed to get instances for event {recurring_event_id}: {e}")
        sentry_sdk.capture_exception(e)
        return None


async def update_meeting_event(
    event_id: str,
    start: datetime | None = None,
    title: str | None = None,
    duration_minutes: int = 60,
) -> bool:
    """
    Update an existing calendar event (reschedule).

    Sends update notifications to all attendees.

    Returns:
        True if updated successfully
    """
    service = get_calendar_service()
    if not service:
        return False

    calendar_id = get_calendar_email()

    def _sync_get():
        return service.events().get(calendarId=calendar_id, eventId=event_id).execute()

    def _sync_update(event_body):
        return (
            service.events()
            .update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event_body,
                sendUpdates="all",
            )
            .execute()
        )

    try:
        # Get existing event
        event = await asyncio.to_thread(_sync_get)

        # Update fields
        if start:
            event["start"] = {"dateTime": start.isoformat(), "timeZone": "UTC"}
            event["end"] = {
                "dateTime": (start + timedelta(minutes=duration_minutes)).isoformat(),
                "timeZone": "UTC",
            }
        if title:
            event["summary"] = title

        await asyncio.to_thread(_sync_update, event)
        return True
    except Exception as e:
        print(f"Failed to update calendar event {event_id}: {e}")
        return False


async def cancel_meeting_event(event_id: str) -> bool:
    """
    Cancel/delete a calendar event.

    Sends cancellation notifications to all attendees.

    Returns:
        True if cancelled successfully
    """
    service = get_calendar_service()
    if not service:
        return False

    calendar_id = get_calendar_email()

    def _sync_delete():
        return (
            service.events()
            .delete(
                calendarId=calendar_id,
                eventId=event_id,
                sendUpdates="all",
            )
            .execute()
        )

    try:
        await asyncio.to_thread(_sync_delete)
        return True
    except Exception as e:
        print(f"Failed to cancel calendar event {event_id}: {e}")
        return False


async def get_event_rsvps(event_id: str) -> list[dict] | None:
    """
    Get attendee RSVP statuses for an event.

    Returns:
        List of {"email": str, "responseStatus": str} or None if failed.
        responseStatus: "needsAction", "accepted", "declined", "tentative"
    """
    service = get_calendar_service()
    if not service:
        return None

    calendar_id = get_calendar_email()

    def _sync_get():
        return service.events().get(calendarId=calendar_id, eventId=event_id).execute()

    try:
        event = await asyncio.to_thread(_sync_get)
        return [
            {
                "email": a["email"],
                "responseStatus": a.get("responseStatus", "needsAction"),
            }
            for a in event.get("attendees", [])
        ]
    except Exception as e:
        print(f"Failed to get RSVPs for event {event_id}: {e}")
        return None
