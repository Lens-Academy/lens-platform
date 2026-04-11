"""Google Calendar API client initialization."""

import json
import logging
import os
from datetime import timedelta

import sentry_sdk
from google.oauth2 import service_account
from googleapiclient.discovery import build, Resource
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)


def _is_rate_limit_error(exception: Exception) -> bool:
    """Check if exception is a Google API rate limit error."""
    if isinstance(exception, HttpError):
        return exception.resp.status == 429
    return False


def _log_calendar_error(
    exception: Exception,
    operation: str,
    context: dict | None = None,
) -> None:
    """
    Log calendar API errors with appropriate severity.

    Rate limits get warning level + specific Sentry event.
    Other errors get error level.
    """
    context = context or {}

    if _is_rate_limit_error(exception):
        logger.warning(
            f"Google Calendar rate limit hit during {operation}",
            extra={"operation": operation, **context},
        )
        sentry_sdk.capture_message(
            f"Google Calendar rate limit: {operation}",
            level="warning",
            extras={"operation": operation, **context},
        )
    else:
        logger.error(
            f"Google Calendar API error during {operation}: {exception}",
            extra={"operation": operation, **context},
        )
        sentry_sdk.capture_exception(exception)


CALENDAR_EMAIL = os.environ.get("GOOGLE_CALENDAR_EMAIL", "calendar@lensacademy.org")
CREDENTIALS_FILE = os.environ.get("GOOGLE_CALENDAR_CREDENTIALS_FILE")
CREDENTIALS_JSON = os.environ.get("GOOGLE_CALENDAR_CREDENTIALS_JSON")
SCOPES = ["https://www.googleapis.com/auth/calendar"]

_service: Resource | None = None


def is_calendar_configured() -> bool:
    """Check if Google Calendar credentials are configured."""
    # Support credentials from env var (for Railway/Heroku) or file
    if CREDENTIALS_JSON:
        return True
    return bool(CREDENTIALS_FILE and os.path.exists(CREDENTIALS_FILE))


def get_calendar_service() -> Resource | None:
    """
    Get or create Google Calendar API service.

    Supports credentials from:
    - GOOGLE_CALENDAR_CREDENTIALS_JSON env var (for Railway/Heroku)
    - GOOGLE_CALENDAR_CREDENTIALS_FILE path (for local dev)

    Returns None if not configured.
    """
    global _service

    if _service is not None:
        return _service

    if not is_calendar_configured():
        return None

    try:
        if CREDENTIALS_JSON:
            # Load credentials from env var (Railway/Heroku pattern)
            creds_info = json.loads(CREDENTIALS_JSON)
            creds = service_account.Credentials.from_service_account_info(
                creds_info,
                scopes=SCOPES,
            )
        else:
            # Load credentials from file (local dev)
            creds = service_account.Credentials.from_service_account_file(
                CREDENTIALS_FILE,
                scopes=SCOPES,
            )
        # Delegate to the calendar email (service account acts as this user)
        creds = creds.with_subject(CALENDAR_EMAIL)

        _service = build("calendar", "v3", credentials=creds)
        return _service
    except Exception as e:
        print(f"Warning: Failed to initialize Google Calendar service: {e}")
        return None


def get_calendar_email() -> str:
    """Get the calendar email address used for invites."""
    return CALENDAR_EMAIL


def batch_get_events(event_ids: list[str]) -> dict[str, dict] | None:
    """
    Fetch multiple calendar events in a single batch request.

    Returns:
        Dict mapping event_id -> event data, or None if calendar not configured.
        Events that failed to fetch are omitted from the dict.
    """
    if not event_ids:
        return {}

    service = get_calendar_service()
    if not service:
        return None

    calendar_id = get_calendar_email()
    results: dict[str, dict] = {}

    def callback(request_id: str, response: dict, exception):
        if exception:
            _log_calendar_error(
                exception,
                operation="batch_get_events",
                context={"event_id": request_id},
            )
        else:
            results[request_id] = response

    batch = service.new_batch_http_request()
    for event_id in event_ids:
        batch.add(
            service.events().get(calendarId=calendar_id, eventId=event_id),
            callback=callback,
            request_id=event_id,
        )

    batch.execute()
    return results


def batch_create_events(
    events: list[dict],
) -> dict[int, dict] | None:
    """
    Create multiple calendar events in a single batch request.

    Args:
        events: List of dicts, each with:
            - meeting_id: Database meeting ID (used as key in results)
            - title: Event title
            - description: Event description
            - start: Start datetime (timezone-aware)
            - duration_minutes: Meeting duration
            - attendees: List of email addresses

    Returns:
        Dict mapping meeting_id -> {"success": bool, "event_id": str | None, "error": str | None},
        or None if calendar not configured.
    """
    if not events:
        return {}

    service = get_calendar_service()
    if not service:
        return None

    calendar_id = get_calendar_email()
    results: dict[int, dict] = {}

    def callback(request_id: str, response: dict, exception):
        meeting_id = int(request_id)
        if exception:
            _log_calendar_error(
                exception,
                operation="batch_create_events",
                context={"meeting_id": meeting_id},
            )
            results[meeting_id] = {
                "success": False,
                "event_id": None,
                "error": str(exception),
                "is_rate_limit": _is_rate_limit_error(exception),
            }
        else:
            results[meeting_id] = {
                "success": True,
                "event_id": response["id"],
                "error": None,
            }

    batch = service.new_batch_http_request()
    for event_data in events:
        start = event_data["start"]
        end = start + timedelta(minutes=event_data["duration_minutes"])

        event_body = {
            "summary": event_data["title"],
            "description": event_data["description"],
            "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
            "attendees": [{"email": email} for email in event_data["attendees"]],
            "guestsCanSeeOtherGuests": False,
            "guestsCanModify": False,
            "reminders": {"useDefault": False, "overrides": []},
        }

        batch.add(
            service.events().insert(
                calendarId=calendar_id,
                body=event_body,
                sendUpdates="all",
            ),
            callback=callback,
            request_id=str(event_data["meeting_id"]),
        )

    batch.execute()
    return results


def batch_patch_events(
    updates: list[dict],
) -> dict[str, dict] | None:
    """
    Patch multiple calendar events in a single batch request.

    Args:
        updates: List of dicts, each with:
            - event_id: Google Calendar event ID
            - body: Patch body (e.g., {"attendees": [...]})
            - send_updates: "all" to notify, "none" to skip (per-event)

    Returns:
        Dict mapping event_id -> {"success": bool, "error": str | None},
        or None if calendar not configured.
    """
    if not updates:
        return {}

    service = get_calendar_service()
    if not service:
        return None

    calendar_id = get_calendar_email()
    results: dict[str, dict] = {}

    def callback(request_id: str, response: dict, exception):
        if exception:
            _log_calendar_error(
                exception,
                operation="batch_patch_events",
                context={"event_id": request_id},
            )
            results[request_id] = {
                "success": False,
                "error": str(exception),
                "is_rate_limit": _is_rate_limit_error(exception),
            }
        else:
            results[request_id] = {"success": True, "error": None}

    batch = service.new_batch_http_request()
    for update in updates:
        batch.add(
            service.events().patch(
                calendarId=calendar_id,
                eventId=update["event_id"],
                body=update["body"],
                sendUpdates=update["send_updates"],
            ),
            callback=callback,
            request_id=update["event_id"],
        )

    batch.execute()
    return results


def batch_delete_events(event_ids: list[str]) -> dict[str, dict] | None:
    """
    Delete multiple calendar events in a single batch request.

    Args:
        event_ids: List of Google Calendar event IDs to delete

    Returns:
        Dict mapping event_id -> {"success": bool, "error": str | None},
        or None if calendar not configured.
    """
    if not event_ids:
        return {}

    service = get_calendar_service()
    if not service:
        return None

    calendar_id = get_calendar_email()
    results: dict[str, dict] = {}

    def callback(request_id: str, response, exception):
        if exception:
            _log_calendar_error(
                exception,
                operation="batch_delete_events",
                context={"event_id": request_id},
            )
            results[request_id] = {"success": False, "error": str(exception)}
        else:
            results[request_id] = {"success": True, "error": None}

    batch = service.new_batch_http_request()
    for event_id in event_ids:
        batch.add(
            service.events().delete(
                calendarId=calendar_id,
                eventId=event_id,
                sendUpdates="none",  # Don't notify - these are being replaced
            ),
            callback=callback,
            request_id=event_id,
        )

    batch.execute()
    return results
