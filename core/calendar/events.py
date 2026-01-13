"""Google Calendar event operations."""

from datetime import datetime, timedelta

from .client import get_calendar_service, get_calendar_email


def create_meeting_event(
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

    try:
        result = service.events().insert(
            calendarId=get_calendar_email(),
            body=event,
            sendUpdates="all",
        ).execute()

        return result["id"]
    except Exception as e:
        print(f"Failed to create calendar event: {e}")
        return None


def update_meeting_event(
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

    try:
        # Get existing event
        event = service.events().get(
            calendarId=get_calendar_email(),
            eventId=event_id,
        ).execute()

        # Update fields
        if start:
            event["start"] = {"dateTime": start.isoformat(), "timeZone": "UTC"}
            event["end"] = {
                "dateTime": (start + timedelta(minutes=duration_minutes)).isoformat(),
                "timeZone": "UTC",
            }
        if title:
            event["summary"] = title

        service.events().update(
            calendarId=get_calendar_email(),
            eventId=event_id,
            body=event,
            sendUpdates="all",
        ).execute()

        return True
    except Exception as e:
        print(f"Failed to update calendar event {event_id}: {e}")
        return False


def cancel_meeting_event(event_id: str) -> bool:
    """
    Cancel/delete a calendar event.

    Sends cancellation notifications to all attendees.

    Returns:
        True if cancelled successfully
    """
    service = get_calendar_service()
    if not service:
        return False

    try:
        service.events().delete(
            calendarId=get_calendar_email(),
            eventId=event_id,
            sendUpdates="all",
        ).execute()
        return True
    except Exception as e:
        print(f"Failed to cancel calendar event {event_id}: {e}")
        return False


def get_event_rsvps(event_id: str) -> list[dict] | None:
    """
    Get attendee RSVP statuses for an event.

    Returns:
        List of {"email": str, "responseStatus": str} or None if failed.
        responseStatus: "needsAction", "accepted", "declined", "tentative"
    """
    service = get_calendar_service()
    if not service:
        return None

    try:
        event = service.events().get(
            calendarId=get_calendar_email(),
            eventId=event_id,
        ).execute()

        return [
            {"email": a["email"], "responseStatus": a.get("responseStatus", "needsAction")}
            for a in event.get("attendees", [])
        ]
    except Exception as e:
        print(f"Failed to get RSVPs for event {event_id}: {e}")
        return None
