"""Google Calendar API client initialization."""

import os

from google.oauth2 import service_account
from googleapiclient.discovery import build, Resource


CALENDAR_EMAIL = os.environ.get("GOOGLE_CALENDAR_EMAIL", "calendar@lensacademy.org")
CREDENTIALS_FILE = os.environ.get("GOOGLE_CALENDAR_CREDENTIALS_FILE")
SCOPES = ["https://www.googleapis.com/auth/calendar"]

_service: Resource | None = None


def is_calendar_configured() -> bool:
    """Check if Google Calendar credentials are configured."""
    return bool(CREDENTIALS_FILE and os.path.exists(CREDENTIALS_FILE))


def get_calendar_service() -> Resource | None:
    """
    Get or create Google Calendar API service.

    Returns None if not configured.
    """
    global _service

    if _service is not None:
        return _service

    if not is_calendar_configured():
        return None

    try:
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
