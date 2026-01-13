# Meetings & Calendar Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create meeting records in DB during group realization, send Google Calendar invites, and track RSVPs.

**Architecture:** Individual meeting rows stored in `meetings` table. Google Calendar API creates separate events (not recurring) for each meeting. APScheduler handles reminders. Periodic job syncs RSVPs from Calendar API to `attendances` table.

**Tech Stack:** Google Calendar API (`google-api-python-client`), SQLAlchemy async, APScheduler (existing), PostgreSQL

---

## Task 1: Add Google API Dependencies

**Files:**
- Modify: `requirements.txt`

**Step 1: Add dependencies**

Add to `requirements.txt` after the `# Notifications` section:

```
# Google Calendar API
google-api-python-client>=2.100.0
google-auth>=2.25.0
```

**Step 2: Install dependencies**

Run: `pip install -r requirements.txt`
Expected: Successfully installed google-api-python-client and google-auth

**Step 3: Commit**

```bash
jj describe -m "feat: add Google Calendar API dependencies"
```

---

## Task 2: Database Migration - Add Meeting Columns

**Files:**
- Create: `migrations/012_meeting_calendar_fields.sql`
- Modify: `core/tables.py:210-232`

**Step 1: Create migration file**

Create `migrations/012_meeting_calendar_fields.sql`:

```sql
-- Add Google Calendar and meeting number fields to meetings table
ALTER TABLE meetings
ADD COLUMN IF NOT EXISTS meeting_number INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT,
ADD COLUMN IF NOT EXISTS calendar_invite_sent_at TIMESTAMP WITH TIME ZONE;

-- Index for Google Calendar event lookup
CREATE INDEX IF NOT EXISTS idx_meetings_google_event
ON meetings(google_calendar_event_id)
WHERE google_calendar_event_id IS NOT NULL;

-- Add unique constraint for meeting/user in attendances (for upsert)
ALTER TABLE attendances
ADD CONSTRAINT IF NOT EXISTS attendances_meeting_user_unique
UNIQUE (meeting_id, user_id);
```

**Step 2: Update tables.py**

In `core/tables.py`, update the meetings table definition (lines 210-232):

```python
# =====================================================
# 7. MEETINGS
# =====================================================
meetings = Table(
    "meetings",
    metadata,
    Column("meeting_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "group_id",
        Integer,
        ForeignKey("groups.group_id", ondelete="CASCADE"),
    ),
    Column(
        "cohort_id",
        Integer,
        ForeignKey("cohorts.cohort_id", ondelete="CASCADE"),
    ),
    Column("scheduled_at", TIMESTAMP(timezone=True), nullable=False),
    Column("meeting_number", Integer, nullable=False, server_default="1"),
    Column("discord_event_id", Text),
    Column("discord_voice_channel_id", Text),
    Column("google_calendar_event_id", Text),
    Column("calendar_invite_sent_at", TIMESTAMP(timezone=True)),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_meetings_group_id", "group_id"),
    Index("idx_meetings_cohort_id", "cohort_id"),
    Index("idx_meetings_scheduled_at", "scheduled_at"),
)
```

**Step 3: Run migration**

Run against your database:
```bash
psql $DATABASE_URL -f migrations/012_meeting_calendar_fields.sql
```
Expected: ALTER TABLE, CREATE INDEX output (no errors)

**Step 4: Commit**

```bash
jj describe -m "feat: add Google Calendar fields to meetings table"
```

---

## Task 3: Create Calendar Module Structure

**Files:**
- Create: `core/calendar/__init__.py`
- Create: `core/calendar/client.py`

**Step 1: Create module directory and __init__.py**

Create `core/calendar/__init__.py`:

```python
"""Google Calendar integration for meeting invites and RSVP tracking."""

from .client import get_calendar_service, is_calendar_configured
from .events import (
    create_meeting_event,
    update_meeting_event,
    cancel_meeting_event,
    get_event_rsvps,
)
from .rsvp import sync_meeting_rsvps, sync_upcoming_meeting_rsvps

__all__ = [
    "get_calendar_service",
    "is_calendar_configured",
    "create_meeting_event",
    "update_meeting_event",
    "cancel_meeting_event",
    "get_event_rsvps",
    "sync_meeting_rsvps",
    "sync_upcoming_meeting_rsvps",
]
```

**Step 2: Create client.py**

Create `core/calendar/client.py`:

```python
"""Google Calendar API client initialization."""

import os
from functools import lru_cache

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
```

**Step 3: Commit**

```bash
jj describe -m "feat: add Google Calendar client module"
```

---

## Task 4: Create Calendar Events Module

**Files:**
- Create: `core/calendar/events.py`

**Step 1: Create events.py**

Create `core/calendar/events.py`:

```python
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
```

**Step 2: Commit**

```bash
jj describe -m "feat: add Google Calendar event operations"
```

---

## Task 5: Create RSVP Sync Module

**Files:**
- Create: `core/calendar/rsvp.py`

**Step 1: Create rsvp.py**

Create `core/calendar/rsvp.py`:

```python
"""Sync RSVP responses from Google Calendar to database."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from core.database import get_connection
from core.tables import meetings, attendances, users
from core.enums import RSVPStatus
from .events import get_event_rsvps


# Map Google Calendar response status to our RSVPStatus enum
GOOGLE_TO_RSVP_STATUS = {
    "needsAction": RSVPStatus.pending,
    "accepted": RSVPStatus.attending,
    "declined": RSVPStatus.not_attending,
    "tentative": RSVPStatus.tentative,
}


async def sync_meeting_rsvps(meeting_id: int) -> dict[str, int]:
    """
    Sync RSVP statuses from Google Calendar to attendances table.

    Args:
        meeting_id: Database meeting ID

    Returns:
        Count of each status: {"attending": 3, "not_attending": 1, ...}
    """
    async with get_connection() as conn:
        # Get meeting's Google event ID
        result = await conn.execute(
            select(meetings.c.google_calendar_event_id)
            .where(meetings.c.meeting_id == meeting_id)
        )
        row = result.first()

        if not row or not row.google_calendar_event_id:
            return {}

        # Get RSVPs from Google Calendar API
        google_rsvps = get_event_rsvps(row.google_calendar_event_id)
        if google_rsvps is None:
            return {}

        counts: dict[str, int] = {}

        for attendee in google_rsvps:
            email = attendee["email"]
            google_status = attendee["responseStatus"]
            our_status = GOOGLE_TO_RSVP_STATUS.get(google_status, RSVPStatus.pending)

            counts[our_status.value] = counts.get(our_status.value, 0) + 1

            # Find user by email
            user_result = await conn.execute(
                select(users.c.user_id).where(users.c.email == email)
            )
            user_row = user_result.first()

            if user_row:
                # Upsert attendance record
                stmt = insert(attendances).values(
                    meeting_id=meeting_id,
                    user_id=user_row.user_id,
                    rsvp_status=our_status,
                    rsvp_at=func.now(),
                )
                stmt = stmt.on_conflict_do_update(
                    constraint="attendances_meeting_user_unique",
                    set_={
                        "rsvp_status": our_status,
                        "rsvp_at": func.now(),
                    },
                )
                await conn.execute(stmt)

        await conn.commit()
        return counts


async def sync_upcoming_meeting_rsvps(days_ahead: int = 7) -> int:
    """
    Sync RSVPs for all meetings in the next N days.

    Call this periodically (e.g., every 6 hours) to keep RSVPs current.

    Returns:
        Number of meetings synced
    """
    async with get_connection() as conn:
        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(days=days_ahead)

        result = await conn.execute(
            select(meetings.c.meeting_id)
            .where(meetings.c.scheduled_at > now)
            .where(meetings.c.scheduled_at < cutoff)
            .where(meetings.c.google_calendar_event_id.isnot(None))
        )

        meeting_ids = [row.meeting_id for row in result]

    # Sync each meeting (outside transaction to avoid long locks)
    for meeting_id in meeting_ids:
        try:
            await sync_meeting_rsvps(meeting_id)
        except Exception as e:
            print(f"Failed to sync RSVPs for meeting {meeting_id}: {e}")

    return len(meeting_ids)
```

**Step 2: Commit**

```bash
jj describe -m "feat: add RSVP sync from Google Calendar"
```

---

## Task 6: Create Meeting Queries Module

**Files:**
- Create: `core/queries/meetings.py`

**Step 1: Create meetings.py**

Create `core/queries/meetings.py`:

```python
"""Database queries for meetings."""

from datetime import datetime, timedelta

from sqlalchemy import select, insert, update, func
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import meetings, groups, attendances


async def create_meeting(
    conn: AsyncConnection,
    group_id: int,
    cohort_id: int,
    scheduled_at: datetime,
    meeting_number: int,
    discord_event_id: str | None = None,
    discord_voice_channel_id: str | None = None,
) -> int:
    """
    Create a meeting record.

    Returns:
        The new meeting_id
    """
    result = await conn.execute(
        insert(meetings).values(
            group_id=group_id,
            cohort_id=cohort_id,
            scheduled_at=scheduled_at,
            meeting_number=meeting_number,
            discord_event_id=discord_event_id,
            discord_voice_channel_id=discord_voice_channel_id,
        ).returning(meetings.c.meeting_id)
    )
    return result.scalar_one()


async def update_meeting_calendar_id(
    conn: AsyncConnection,
    meeting_id: int,
    google_calendar_event_id: str,
) -> None:
    """Store Google Calendar event ID for a meeting."""
    await conn.execute(
        update(meetings)
        .where(meetings.c.meeting_id == meeting_id)
        .values(
            google_calendar_event_id=google_calendar_event_id,
            calendar_invite_sent_at=func.now(),
        )
    )


async def get_meetings_for_group(
    conn: AsyncConnection,
    group_id: int,
) -> list[dict]:
    """Get all meetings for a group, ordered by meeting number."""
    result = await conn.execute(
        select(meetings)
        .where(meetings.c.group_id == group_id)
        .order_by(meetings.c.meeting_number)
    )
    return [dict(row._mapping) for row in result]


async def get_meeting(
    conn: AsyncConnection,
    meeting_id: int,
) -> dict | None:
    """Get a single meeting by ID."""
    result = await conn.execute(
        select(meetings).where(meetings.c.meeting_id == meeting_id)
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def reschedule_meeting(
    conn: AsyncConnection,
    meeting_id: int,
    new_time: datetime,
) -> None:
    """Update meeting scheduled time."""
    await conn.execute(
        update(meetings)
        .where(meetings.c.meeting_id == meeting_id)
        .values(
            scheduled_at=new_time,
            updated_at=func.now(),
        )
    )


async def get_group_member_emails(
    conn: AsyncConnection,
    group_id: int,
) -> list[str]:
    """Get email addresses for all members of a group."""
    from core.tables import group_users, users

    result = await conn.execute(
        select(users.c.email)
        .select_from(
            group_users.join(users, group_users.c.user_id == users.c.user_id)
        )
        .where(group_users.c.group_id == group_id)
        .where(users.c.email.isnot(None))
    )
    return [row.email for row in result]


async def get_group_member_user_ids(
    conn: AsyncConnection,
    group_id: int,
) -> list[int]:
    """Get user IDs for all members of a group."""
    from core.tables import group_users

    result = await conn.execute(
        select(group_users.c.user_id)
        .where(group_users.c.group_id == group_id)
    )
    return [row.user_id for row in result]
```

**Step 2: Commit**

```bash
jj describe -m "feat: add meeting database queries"
```

---

## Task 7: Create Meeting Service

**Files:**
- Create: `core/meetings.py`

**Step 1: Create meetings.py**

Create `core/meetings.py`:

```python
"""
Meeting management service.

Coordinates database, Google Calendar, Discord, and APScheduler operations.
"""

from datetime import datetime, timedelta

from core.database import get_connection, get_transaction
from core.queries.meetings import (
    create_meeting,
    update_meeting_calendar_id,
    get_meeting,
    get_meetings_for_group,
    reschedule_meeting as db_reschedule_meeting,
    get_group_member_emails,
    get_group_member_user_ids,
)
from core.calendar import (
    create_meeting_event,
    update_meeting_event,
    cancel_meeting_event,
    is_calendar_configured,
)
from core.notifications.actions import (
    schedule_meeting_reminders,
    cancel_meeting_reminders,
)


async def create_meetings_for_group(
    group_id: int,
    cohort_id: int,
    group_name: str,
    first_meeting: datetime,
    num_meetings: int,
    discord_voice_channel_id: str,
    discord_events: list | None = None,
    discord_text_channel_id: str | None = None,
) -> list[int]:
    """
    Create all meeting records for a group.

    Called during group realization after Discord channels are created.

    Args:
        group_id: Database group ID
        cohort_id: Database cohort ID
        group_name: Group name (for calendar event titles)
        first_meeting: First meeting datetime (UTC)
        num_meetings: Number of weekly meetings
        discord_voice_channel_id: Voice channel ID
        discord_events: Optional list of Discord scheduled events
        discord_text_channel_id: Text channel for reminders

    Returns:
        List of created meeting_ids
    """
    meeting_ids = []

    async with get_transaction() as conn:
        for week in range(num_meetings):
            meeting_time = first_meeting + timedelta(weeks=week)

            # Get Discord event ID if available
            discord_event_id = None
            if discord_events and week < len(discord_events):
                discord_event_id = str(discord_events[week].id)

            meeting_id = await create_meeting(
                conn,
                group_id=group_id,
                cohort_id=cohort_id,
                scheduled_at=meeting_time,
                meeting_number=week + 1,
                discord_event_id=discord_event_id,
                discord_voice_channel_id=discord_voice_channel_id,
            )
            meeting_ids.append(meeting_id)

    return meeting_ids


async def send_calendar_invites_for_group(
    group_id: int,
    group_name: str,
    meeting_ids: list[int],
) -> int:
    """
    Send Google Calendar invites for all meetings in a group.

    Returns:
        Number of invites sent successfully
    """
    if not is_calendar_configured():
        print("Google Calendar not configured, skipping invites")
        return 0

    async with get_connection() as conn:
        # Get member emails
        emails = await get_group_member_emails(conn, group_id)

        if not emails:
            print(f"No emails found for group {group_id}, skipping calendar invites")
            return 0

        # Get meetings
        meetings_list = await get_meetings_for_group(conn, group_id)

    sent = 0
    async with get_transaction() as conn:
        for meeting in meetings_list:
            if meeting["meeting_id"] not in meeting_ids:
                continue

            event_id = create_meeting_event(
                title=f"{group_name} - Week {meeting['meeting_number']}",
                description="Weekly AI Safety study group meeting",
                start=meeting["scheduled_at"],
                attendee_emails=emails,
            )

            if event_id:
                await update_meeting_calendar_id(conn, meeting["meeting_id"], event_id)
                sent += 1

    return sent


async def schedule_reminders_for_group(
    group_id: int,
    group_name: str,
    meeting_ids: list[int],
    discord_channel_id: str,
) -> None:
    """Schedule APScheduler reminders for all meetings in a group."""
    async with get_connection() as conn:
        user_ids = await get_group_member_user_ids(conn, group_id)
        meetings_list = await get_meetings_for_group(conn, group_id)

    for meeting in meetings_list:
        if meeting["meeting_id"] not in meeting_ids:
            continue

        schedule_meeting_reminders(
            meeting_id=meeting["meeting_id"],
            meeting_time=meeting["scheduled_at"],
            user_ids=user_ids,
            group_name=group_name,
            discord_channel_id=discord_channel_id,
        )


async def reschedule_meeting(
    meeting_id: int,
    new_time: datetime,
    group_name: str,
    discord_channel_id: str,
) -> bool:
    """
    Reschedule a single meeting.

    Updates database, Google Calendar, and APScheduler reminders.
    Discord event update is NOT handled here (requires bot context).

    Returns:
        True if successful
    """
    async with get_transaction() as conn:
        meeting = await get_meeting(conn, meeting_id)
        if not meeting:
            return False

        # Update database
        await db_reschedule_meeting(conn, meeting_id, new_time)

        # Update Google Calendar (sends notification to attendees)
        if meeting.get("google_calendar_event_id"):
            update_meeting_event(
                event_id=meeting["google_calendar_event_id"],
                start=new_time,
            )

        # Get user IDs for rescheduling reminders
        user_ids = await get_group_member_user_ids(conn, meeting["group_id"])

    # Reschedule APScheduler reminders
    cancel_meeting_reminders(meeting_id)
    schedule_meeting_reminders(
        meeting_id=meeting_id,
        meeting_time=new_time,
        user_ids=user_ids,
        group_name=group_name,
        discord_channel_id=discord_channel_id,
    )

    return True
```

**Step 2: Export from core/__init__.py**

Add to `core/__init__.py` imports and __all__:

```python
# Meetings
from .meetings import (
    create_meetings_for_group,
    send_calendar_invites_for_group,
    schedule_reminders_for_group,
    reschedule_meeting,
)
```

Add to `__all__`:
```python
    # Meetings
    'create_meetings_for_group', 'send_calendar_invites_for_group',
    'schedule_reminders_for_group', 'reschedule_meeting',
```

**Step 3: Commit**

```bash
jj describe -m "feat: add meeting service coordinating DB, Calendar, and reminders"
```

---

## Task 8: Wire Meeting Creation into Groups Cog

**Files:**
- Modify: `discord_bot/cogs/groups_cog.py`

**Step 1: Find the _realize_single_group method**

Read `discord_bot/cogs/groups_cog.py` and locate where Discord events are created and `_send_group_notifications` is called.

**Step 2: Update imports**

Add to imports at top of `groups_cog.py`:

```python
from core.meetings import (
    create_meetings_for_group,
    send_calendar_invites_for_group,
    schedule_reminders_for_group,
)
```

**Step 3: Create meetings after Discord events**

In `_realize_single_group`, after Discord events are created and before `_send_group_notifications`, add:

```python
# Create meeting records in database
meeting_ids = await create_meetings_for_group(
    group_id=group_data["group_id"],
    cohort_id=cohort_data["cohort_id"],
    group_name=group_data["group_name"],
    first_meeting=first_meeting,  # Already calculated for Discord events
    num_meetings=num_meetings,
    discord_voice_channel_id=str(voice_channel.id),
    discord_events=events,
    discord_text_channel_id=str(text_channel.id),
)

# Send Google Calendar invites
await send_calendar_invites_for_group(
    group_id=group_data["group_id"],
    group_name=group_data["group_name"],
    meeting_ids=meeting_ids,
)

# Schedule APScheduler reminders
await schedule_reminders_for_group(
    group_id=group_data["group_id"],
    group_name=group_data["group_name"],
    meeting_ids=meeting_ids,
    discord_channel_id=str(text_channel.id),
)
```

**Step 4: Remove old synthetic meeting ID code**

In `_send_group_notifications`, remove or simplify the old `schedule_meeting_reminders` calls that used synthetic IDs like `int(f"{group_data['group_id']}{i+1:02d}")`. The reminders are now scheduled by `schedule_reminders_for_group`.

**Step 5: Commit**

```bash
jj describe -m "feat: wire meeting creation into group realization"
```

---

## Task 9: Add RSVP Sync Periodic Job

**Files:**
- Modify: `main.py`

**Step 1: Add RSVP sync to scheduler startup**

In `main.py`, find where the scheduler is initialized in the lifespan. Add:

```python
from core.calendar.rsvp import sync_upcoming_meeting_rsvps

# In lifespan, after scheduler.start():
if scheduler:
    scheduler.add_job(
        sync_upcoming_meeting_rsvps,
        trigger="interval",
        hours=6,
        id="sync_calendar_rsvps",
        replace_existing=True,
        kwargs={"days_ahead": 7},
    )
    print("Scheduled RSVP sync job (every 6 hours)")
```

**Step 2: Commit**

```bash
jj describe -m "feat: add periodic RSVP sync job"
```

---

## Task 10: Add Environment Variables Documentation

**Files:**
- Modify: `.env.example` (or create if doesn't exist)

**Step 1: Document required env vars**

Add to `.env.example`:

```bash
# Google Calendar Integration
# Service account credentials JSON file path
GOOGLE_CALENDAR_CREDENTIALS_FILE=/path/to/service-account.json
# Calendar email (must match Workspace user)
GOOGLE_CALENDAR_EMAIL=calendar@lensacademy.org
```

**Step 2: Commit**

```bash
jj describe -m "docs: add Google Calendar env vars to .env.example"
```

---

## Task 11: Write Integration Test

**Files:**
- Create: `core/calendar/tests/__init__.py`
- Create: `core/calendar/tests/test_events.py`

**Step 1: Create test directory**

Create empty `core/calendar/tests/__init__.py`

**Step 2: Create test file**

Create `core/calendar/tests/test_events.py`:

```python
"""Tests for Google Calendar event operations.

These tests mock the Google API client to avoid requiring credentials.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from core.calendar.events import (
    create_meeting_event,
    update_meeting_event,
    cancel_meeting_event,
    get_event_rsvps,
)


@pytest.fixture
def mock_calendar_service():
    """Mock Google Calendar service."""
    with patch("core.calendar.events.get_calendar_service") as mock_get:
        mock_service = Mock()
        mock_get.return_value = mock_service
        yield mock_service


@pytest.fixture
def mock_calendar_email():
    """Mock calendar email."""
    with patch("core.calendar.events.get_calendar_email") as mock:
        mock.return_value = "test@example.com"
        yield mock


class TestCreateMeetingEvent:
    def test_creates_event_with_correct_params(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().insert().execute.return_value = {
            "id": "event123"
        }

        result = create_meeting_event(
            title="Test Meeting",
            description="Test description",
            start=datetime(2026, 1, 20, 15, 0, tzinfo=timezone.utc),
            attendee_emails=["user1@example.com", "user2@example.com"],
        )

        assert result == "event123"

        # Verify insert was called with correct body
        call_kwargs = mock_calendar_service.events().insert.call_args
        body = call_kwargs.kwargs["body"]

        assert body["summary"] == "Test Meeting"
        assert body["guestsCanSeeOtherGuests"] is False
        assert len(body["attendees"]) == 2

    def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = create_meeting_event(
                title="Test",
                description="Test",
                start=datetime.now(timezone.utc),
                attendee_emails=["test@example.com"],
            )
            assert result is None


class TestGetEventRsvps:
    def test_returns_attendee_statuses(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().get().execute.return_value = {
            "attendees": [
                {"email": "user1@example.com", "responseStatus": "accepted"},
                {"email": "user2@example.com", "responseStatus": "declined"},
            ]
        }

        result = get_event_rsvps("event123")

        assert len(result) == 2
        assert result[0]["email"] == "user1@example.com"
        assert result[0]["responseStatus"] == "accepted"
```

**Step 3: Run tests**

Run: `pytest core/calendar/tests/ -v`
Expected: All tests pass

**Step 4: Commit**

```bash
jj describe -m "test: add Google Calendar integration tests"
```

---

## Summary

After completing all tasks:

1. **Dependencies**: Google Calendar API client installed
2. **Database**: `meetings` table has new columns for calendar tracking
3. **`core/calendar/`**: New module handling Google API operations
4. **`core/meetings.py`**: Service coordinating DB + Calendar + APScheduler
5. **`groups_cog.py`**: Creates meeting records during group realization
6. **Periodic job**: Syncs RSVPs from Google Calendar every 6 hours

**To test end-to-end:**
1. Set up Google Workspace and create service account
2. Configure `GOOGLE_CALENDAR_CREDENTIALS_FILE` and `GOOGLE_CALENDAR_EMAIL`
3. Run `/schedule realize` command to create a group
4. Verify meetings appear in database and calendar invites are sent
