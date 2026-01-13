# Meetings & Calendar Integration Design

## Overview

Connect the existing meetings infrastructure to persist meeting records, send Google Calendar invites, and track RSVPs. Most components already exist but aren't wired together.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Meeting storage | Individual rows in `meetings` table (one per week) |
| Calendar provider | Google Calendar API via `calendar@lensacademy.org` |
| Event model | Separate events (not recurring) - easy to reschedule individually |
| Privacy | `guestsCanSeeOtherGuests: false` - attendees don't see each other |
| RSVP tracking | Query Calendar API for attendee responses |
| Reminders | APScheduler (already implemented) |

## Database Changes

### Meetings Table Updates

Add columns to existing `meetings` table:

```sql
ALTER TABLE meetings
ADD COLUMN google_calendar_event_id TEXT,
ADD COLUMN calendar_invite_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN meeting_number INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_meetings_google_event ON meetings(google_calendar_event_id);
```

**Full schema after changes:**

```python
meetings = Table(
    "meetings",
    metadata,
    Column("meeting_id", Integer, primary_key=True, autoincrement=True),
    Column("group_id", Integer, ForeignKey("groups.group_id", ondelete="CASCADE")),
    Column("cohort_id", Integer, ForeignKey("cohorts.cohort_id", ondelete="CASCADE")),
    Column("scheduled_at", TIMESTAMP(timezone=True), nullable=False),
    Column("meeting_number", Integer, nullable=False),  # Week 1, 2, 3...
    Column("discord_event_id", Text),
    Column("discord_voice_channel_id", Text),
    Column("google_calendar_event_id", Text),  # NEW
    Column("calendar_invite_sent_at", TIMESTAMP(timezone=True)),  # NEW
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
)
```

### Attendances Table (existing)

Already exists for RSVP status - will be populated from Calendar API responses:

```python
attendances = Table(
    "attendances",
    metadata,
    Column("attendance_id", Integer, primary_key=True),
    Column("meeting_id", Integer, ForeignKey("meetings.meeting_id")),
    Column("user_id", Integer, ForeignKey("users.user_id")),
    Column("rsvp_status", Text),  # 'accepted', 'declined', 'tentative', 'needsAction'
    Column("attended", Boolean),
    ...
)
```

## Google Calendar Integration

### New Module: `core/calendar/`

```
core/calendar/
├── __init__.py
├── client.py      # Google Calendar API client
├── events.py      # Create/update/cancel events
└── rsvp.py        # Poll for RSVP responses
```

### Client Setup (`core/calendar/client.py`)

```python
"""Google Calendar API client."""

import os
from google.oauth2.credentials import Credentials
from google.oauth2 import service_account
from googleapiclient.discovery import build

CALENDAR_ID = os.environ.get("GOOGLE_CALENDAR_ID", "calendar@lensacademy.org")
SCOPES = ["https://www.googleapis.com/auth/calendar"]

_service = None

def get_calendar_service():
    """Get or create Google Calendar API service."""
    global _service
    if _service is None:
        # Use service account credentials from JSON file or env var
        creds_file = os.environ.get("GOOGLE_CALENDAR_CREDENTIALS_FILE")
        if creds_file:
            creds = service_account.Credentials.from_service_account_file(
                creds_file, scopes=SCOPES
            )
        else:
            # Fall back to application default credentials
            creds, _ = google.auth.default(scopes=SCOPES)

        _service = build("calendar", "v3", credentials=creds)
    return _service
```

### Event Operations (`core/calendar/events.py`)

```python
"""Google Calendar event operations."""

from datetime import datetime, timedelta
from core.calendar.client import get_calendar_service, CALENDAR_ID


def create_meeting_event(
    title: str,
    description: str,
    start: datetime,
    end: datetime,
    attendee_emails: list[str],
) -> str:
    """
    Create a calendar event and send invites.

    Returns:
        Google Calendar event ID
    """
    service = get_calendar_service()

    event = {
        "summary": title,
        "description": description,
        "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
        "attendees": [{"email": email} for email in attendee_emails],
        "guestsCanSeeOtherGuests": False,  # Privacy
        "reminders": {"useDefault": False, "overrides": []},  # We handle reminders
    }

    result = service.events().insert(
        calendarId=CALENDAR_ID,
        body=event,
        sendUpdates="all",  # Send invite emails
    ).execute()

    return result["id"]


def update_meeting_event(
    event_id: str,
    start: datetime | None = None,
    end: datetime | None = None,
    title: str | None = None,
) -> None:
    """Update an existing calendar event (reschedule)."""
    service = get_calendar_service()

    # Get existing event
    event = service.events().get(
        calendarId=CALENDAR_ID,
        eventId=event_id,
    ).execute()

    # Update fields
    if start:
        event["start"] = {"dateTime": start.isoformat(), "timeZone": "UTC"}
    if end:
        event["end"] = {"dateTime": end.isoformat(), "timeZone": "UTC"}
    if title:
        event["summary"] = title

    service.events().update(
        calendarId=CALENDAR_ID,
        eventId=event_id,
        body=event,
        sendUpdates="all",  # Notify attendees of change
    ).execute()


def cancel_meeting_event(event_id: str) -> None:
    """Cancel/delete a calendar event."""
    service = get_calendar_service()

    service.events().delete(
        calendarId=CALENDAR_ID,
        eventId=event_id,
        sendUpdates="all",  # Send cancellation emails
    ).execute()


def get_event_attendees(event_id: str) -> list[dict]:
    """
    Get attendee RSVP statuses for an event.

    Returns:
        List of {"email": str, "responseStatus": str}
        responseStatus: "needsAction", "accepted", "declined", "tentative"
    """
    service = get_calendar_service()

    event = service.events().get(
        calendarId=CALENDAR_ID,
        eventId=event_id,
    ).execute()

    return event.get("attendees", [])
```

### RSVP Sync (`core/calendar/rsvp.py`)

```python
"""Sync RSVP responses from Google Calendar to database."""

from core.calendar.events import get_event_attendees
from core.database import get_connection
from core.tables import meetings, attendances, users


async def sync_meeting_rsvps(meeting_id: int) -> dict[str, int]:
    """
    Sync RSVP statuses from Google Calendar to attendances table.

    Returns:
        Count of each status: {"accepted": 3, "declined": 1, ...}
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

        # Get RSVPs from Google
        attendees = get_event_attendees(row.google_calendar_event_id)

        counts = {}
        for attendee in attendees:
            email = attendee["email"]
            status = attendee["responseStatus"]
            counts[status] = counts.get(status, 0) + 1

            # Find user by email and update attendance
            user_result = await conn.execute(
                select(users.c.user_id).where(users.c.email == email)
            )
            user_row = user_result.first()
            if user_row:
                await conn.execute(
                    insert(attendances)
                    .values(
                        meeting_id=meeting_id,
                        user_id=user_row.user_id,
                        rsvp_status=status,
                    )
                    .on_conflict_do_update(
                        index_elements=["meeting_id", "user_id"],
                        set_={"rsvp_status": status, "updated_at": func.now()},
                    )
                )

        await conn.commit()
        return counts


async def sync_all_upcoming_rsvps() -> None:
    """Sync RSVPs for all meetings in the next 7 days. Run periodically."""
    async with get_connection() as conn:
        result = await conn.execute(
            select(meetings.c.meeting_id)
            .where(meetings.c.scheduled_at > func.now())
            .where(meetings.c.scheduled_at < func.now() + timedelta(days=7))
            .where(meetings.c.google_calendar_event_id.isnot(None))
        )

        for row in result:
            await sync_meeting_rsvps(row.meeting_id)
```

## Meeting Creation Flow

### During Group Realization (`groups_cog.py`)

When a group is "realized" (channels created), create meeting records:

```python
async def _create_meetings_for_group(
    self,
    group_id: int,
    cohort_id: int,
    group_data: dict,
    cohort_data: dict,
    voice_channel: discord.VoiceChannel,
    discord_events: list[discord.ScheduledEvent],
) -> list[int]:
    """
    Create meeting records in database after group realization.

    Returns:
        List of meeting_ids created
    """
    meeting_ids = []

    # Parse meeting time
    first_meeting, num_meetings = self._calculate_meeting_schedule(
        group_data, cohort_data
    )

    async with get_transaction() as conn:
        for week in range(num_meetings):
            meeting_time = first_meeting + timedelta(weeks=week)

            # Find matching Discord event (if created)
            discord_event_id = None
            if week < len(discord_events):
                discord_event_id = str(discord_events[week].id)

            result = await conn.execute(
                insert(meetings).values(
                    group_id=group_id,
                    cohort_id=cohort_id,
                    scheduled_at=meeting_time,
                    meeting_number=week + 1,
                    discord_event_id=discord_event_id,
                    discord_voice_channel_id=str(voice_channel.id),
                ).returning(meetings.c.meeting_id)
            )

            meeting_id = result.scalar()
            meeting_ids.append(meeting_id)

    return meeting_ids
```

### Calendar Invite Sending

After meetings are created, send calendar invites to group members:

```python
async def _send_calendar_invites(
    self,
    group_id: int,
    meeting_ids: list[int],
    group_data: dict,
) -> None:
    """Send Google Calendar invites for all meetings in a group."""
    from core.calendar.events import create_meeting_event
    from core.queries.groups import get_group_members

    members = await get_group_members(group_id)
    attendee_emails = [m["email"] for m in members if m.get("email")]

    if not attendee_emails:
        return  # No emails to invite

    async with get_transaction() as conn:
        for meeting_id in meeting_ids:
            # Get meeting details
            result = await conn.execute(
                select(meetings).where(meetings.c.meeting_id == meeting_id)
            )
            meeting = result.mappings().first()

            # Create Google Calendar event
            event_id = create_meeting_event(
                title=f"{group_data['group_name']} - Week {meeting['meeting_number']}",
                description=f"Weekly study group meeting",
                start=meeting["scheduled_at"],
                end=meeting["scheduled_at"] + timedelta(hours=1),
                attendee_emails=attendee_emails,
            )

            # Store event ID
            await conn.execute(
                update(meetings)
                .where(meetings.c.meeting_id == meeting_id)
                .values(
                    google_calendar_event_id=event_id,
                    calendar_invite_sent_at=func.now(),
                )
            )
```

## Reminder Flow

### Wiring Existing Infrastructure

The reminder functions already exist in `core/notifications/actions.py`. Wire them into meeting creation:

```python
# In groups_cog.py, after creating meetings:

from core.notifications.actions import schedule_meeting_reminders

async def _schedule_all_reminders(
    self,
    meeting_ids: list[int],
    group_data: dict,
    discord_channel_id: str,
    member_user_ids: list[int],
) -> None:
    """Schedule APScheduler reminders for all meetings."""
    async with get_connection() as conn:
        for meeting_id in meeting_ids:
            result = await conn.execute(
                select(meetings.c.scheduled_at)
                .where(meetings.c.meeting_id == meeting_id)
            )
            meeting = result.first()

            schedule_meeting_reminders(
                meeting_id=meeting_id,
                meeting_time=meeting.scheduled_at,
                user_ids=member_user_ids,
                group_name=group_data["group_name"],
                discord_channel_id=discord_channel_id,
            )
```

## RSVP Reminder Logic

If users haven't accepted the calendar invite, remind them more frequently:

```python
# In core/notifications/actions.py

async def schedule_rsvp_reminder(
    meeting_id: int,
    user_ids: list[int],
    group_name: str,
) -> None:
    """
    Schedule reminder to accept calendar invite.

    Sent 48h after invite if still 'needsAction'.
    """
    from core.calendar.rsvp import sync_meeting_rsvps

    schedule_reminder(
        job_id=f"meeting_{meeting_id}_rsvp_nudge",
        run_at=datetime.now(timezone.utc) + timedelta(hours=48),
        message_type="rsvp_nudge",
        user_ids=user_ids,
        context={"group_name": group_name},
        condition={"type": "rsvp_pending", "meeting_id": meeting_id},
    )
```

Add RSVP condition check:

```python
# In core/notifications/scheduler.py, extend _check_condition()

if condition_type == "rsvp_pending":
    from core.calendar.rsvp import sync_meeting_rsvps
    meeting_id = condition.get("meeting_id")

    # Sync latest RSVPs from Google
    await sync_meeting_rsvps(meeting_id)

    # Check if any user still hasn't responded
    async with get_connection() as conn:
        result = await conn.execute(
            select(attendances.c.rsvp_status)
            .where(attendances.c.meeting_id == meeting_id)
            .where(attendances.c.user_id.in_(user_ids))
        )
        statuses = [r.rsvp_status for r in result]

        # Send reminder if anyone still needs to respond
        return "needsAction" in statuses or len(statuses) < len(user_ids)
```

## Rescheduling a Meeting

```python
# In core/meetings.py (new file)

async def reschedule_meeting(
    meeting_id: int,
    new_time: datetime,
) -> None:
    """
    Reschedule a single meeting.

    Updates database, Google Calendar (sends update to attendees),
    Discord event, and APScheduler reminders.
    """
    from core.calendar.events import update_meeting_event
    from core.notifications.actions import reschedule_meeting_reminders

    async with get_transaction() as conn:
        # Get current meeting
        result = await conn.execute(
            select(meetings).where(meetings.c.meeting_id == meeting_id)
        )
        meeting = result.mappings().first()

        # Update database
        await conn.execute(
            update(meetings)
            .where(meetings.c.meeting_id == meeting_id)
            .values(scheduled_at=new_time, updated_at=func.now())
        )

        # Update Google Calendar (sends email to attendees)
        if meeting["google_calendar_event_id"]:
            update_meeting_event(
                event_id=meeting["google_calendar_event_id"],
                start=new_time,
                end=new_time + timedelta(hours=1),
            )

        # Update Discord event
        if meeting["discord_event_id"]:
            # TODO: Discord API call to update scheduled event
            pass

        # Reschedule APScheduler reminders
        group = await get_group(meeting["group_id"])
        members = await get_group_members(meeting["group_id"])

        reschedule_meeting_reminders(
            meeting_id=meeting_id,
            new_meeting_time=new_time,
            user_ids=[m["user_id"] for m in members],
            group_name=group["group_name"],
            discord_channel_id=group["discord_text_channel_id"],
        )
```

## Environment Variables

```bash
# Google Calendar
GOOGLE_CALENDAR_ID=calendar@lensacademy.org
GOOGLE_CALENDAR_CREDENTIALS_FILE=/path/to/service-account.json

# Existing (unchanged)
DATABASE_URL=postgresql+asyncpg://...
SENDGRID_API_KEY=...
```

## Periodic Jobs

Add to APScheduler on startup:

```python
# In main.py lifespan

def setup_periodic_jobs(scheduler):
    """Set up recurring background jobs."""
    from core.calendar.rsvp import sync_all_upcoming_rsvps

    # Sync RSVPs every 6 hours
    scheduler.add_job(
        sync_all_upcoming_rsvps,
        trigger="interval",
        hours=6,
        id="sync_rsvps",
        replace_existing=True,
    )
```

## Summary

### What's New

1. **`core/calendar/`** - Google Calendar API integration
2. **Migration** - Add `google_calendar_event_id`, `calendar_invite_sent_at`, `meeting_number` columns
3. **Meeting creation** - Insert rows during group realization
4. **Calendar invites** - Send via Google Calendar API with privacy settings
5. **RSVP sync** - Periodic job to pull responses from Google
6. **RSVP reminders** - Nudge users who haven't accepted

### What's Wired Up (already exists)

1. **APScheduler** - `core/notifications/scheduler.py`
2. **Reminder scheduling** - `core/notifications/actions.py`
3. **Notification dispatch** - Email + Discord channels
4. **Attendances table** - For RSVP storage

### Implementation Order

1. Database migration (add columns)
2. `core/calendar/` module with Google API client
3. Update `groups_cog.py` to create meeting records
4. Wire in calendar invite sending
5. Wire in reminder scheduling
6. Add RSVP sync job
7. Add RSVP nudge reminders
