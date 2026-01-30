# Recurring Google Calendar Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch from individual calendar invites per meeting to a single recurring event per group, reducing API calls by ~8x.

**Architecture:** Add `gcal_recurring_event_id` to groups table, remove `google_calendar_event_id` and `calendar_invite_sent_at` from meetings table. Use Google Calendar's `instances()` API to fetch RSVPs for all meetings in one call. Match instances to meetings by datetime.

**Tech Stack:** Google Calendar API v3, SQLAlchemy, Alembic migrations, pytest

---

## Task 1: Add Rate Limit Logging to Calendar Client

**Files:**
- Modify: `core/calendar/client.py`

**Why:** Before changing calendar operations, improve observability so we can monitor rate limit issues. This helps validate that the recurring events change actually reduces rate limit hits.

**Step 1: Add rate limit detection helper**

Add to `core/calendar/client.py` after the imports:

```python
from googleapiclient.errors import HttpError


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
```

**Step 2: Update batch_create_events callback**

Replace the callback in `batch_create_events` (around line 126):

```python
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
```

**Step 3: Update batch_get_events callback**

Replace the callback in `batch_get_events` (around line 78):

```python
    def callback(request_id: str, response: dict, exception):
        if exception:
            _log_calendar_error(
                exception,
                operation="batch_get_events",
                context={"event_id": request_id},
            )
        else:
            results[request_id] = response
```

**Step 4: Update batch_patch_events callback**

Replace the callback in `batch_patch_events` (around line 201):

```python
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
```

**Step 5: Run existing tests**

Run: `pytest core/calendar/tests/ -v`
Expected: PASS (existing tests shouldn't break)

**Step 6: Commit**

```bash
git add core/calendar/client.py
git commit -m "feat(calendar): add rate limit detection and logging

- Detect 429 errors specifically
- Log rate limits as warnings with context
- Send rate limit events to Sentry for monitoring
- Include is_rate_limit flag in batch results"
```

---

## Task 2: Database Migration - Add Column to Groups

**Files:**
- Create: `migrations/XXXX_add_gcal_recurring_event_id_to_groups.sql`
- Modify: `core/tables.py:118-144`

**Step 1: Write the migration SQL**

Create `migrations/add_gcal_recurring_event_id_to_groups.sql`:

```sql
-- Add recurring calendar event ID to groups table
ALTER TABLE groups ADD COLUMN gcal_recurring_event_id TEXT;
ALTER TABLE groups ADD COLUMN calendar_invite_sent_at TIMESTAMP WITH TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN groups.gcal_recurring_event_id IS 'Google Calendar recurring event ID for all meetings in this group';
COMMENT ON COLUMN groups.calendar_invite_sent_at IS 'When the recurring calendar invite was created';
```

**Step 2: Update SQLAlchemy table definition**

In `core/tables.py`, add to the `groups` table definition (after line 140, before the Index lines):

```python
    Column("gcal_recurring_event_id", Text),
    Column("calendar_invite_sent_at", TIMESTAMP(timezone=True)),
```

**Step 3: Run migration locally**

Run: `psql $DATABASE_URL -f migrations/add_gcal_recurring_event_id_to_groups.sql`
Expected: ALTER TABLE (success)

**Step 4: Verify migration**

Run: `psql $DATABASE_URL -c "\d groups" | grep gcal`
Expected: `gcal_recurring_event_id | text`

**Step 5: Commit**

```bash
git add migrations/add_gcal_recurring_event_id_to_groups.sql core/tables.py
git commit -m "feat(db): add gcal_recurring_event_id to groups table

Preparation for recurring calendar events feature."
```

---

## Task 3: Add Recurring Event Creation Function

**Files:**
- Modify: `core/calendar/events.py:1-64`
- Test: `core/calendar/tests/test_events.py`

**Step 0: Add required imports to events.py**

First, add the missing imports at the top of `core/calendar/events.py`:

```python
import logging
import sentry_sdk

logger = logging.getLogger(__name__)
```

Note: `asyncio` and `timedelta` are already imported in the existing file.

**Step 1: Write failing test for create_recurring_event**

Add to `core/calendar/tests/test_events.py`:

```python
from core.calendar.events import create_recurring_event


class TestCreateRecurringEvent:
    @pytest.mark.asyncio
    async def test_creates_recurring_event_with_rrule(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().insert().execute.return_value = {
            "id": "recurring123"
        }

        result = await create_recurring_event(
            title="Study Group Alpha",
            description="Weekly AI Safety study group",
            first_meeting=datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc),
            duration_minutes=60,
            num_occurrences=8,
            attendee_emails=["user1@example.com", "user2@example.com"],
        )

        assert result == "recurring123"

        # Verify RRULE was included
        call_kwargs = mock_calendar_service.events().insert.call_args
        body = call_kwargs.kwargs["body"]

        assert body["summary"] == "Study Group Alpha"
        assert "recurrence" in body
        assert body["recurrence"] == ["RRULE:FREQ=WEEKLY;COUNT=8"]
        assert len(body["attendees"]) == 2

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await create_recurring_event(
                title="Test",
                description="Test",
                first_meeting=datetime.now(timezone.utc),
                duration_minutes=60,
                num_occurrences=8,
                attendee_emails=["test@example.com"],
            )
            assert result is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/calendar/tests/test_events.py::TestCreateRecurringEvent -v`
Expected: FAIL with "cannot import name 'create_recurring_event'"

**Step 3: Implement create_recurring_event**

Add to `core/calendar/events.py` after the `create_meeting_event` function:

```python
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
        logger.warning("Google Calendar not configured, skipping recurring event creation")
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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/calendar/tests/test_events.py::TestCreateRecurringEvent -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/calendar/events.py core/calendar/tests/test_events.py
git commit -m "feat(calendar): add create_recurring_event function

Creates a recurring weekly event with RRULE for study groups."
```

---

## Task 4: Add Get Event Instances Function

**Files:**
- Modify: `core/calendar/events.py`
- Test: `core/calendar/tests/test_events.py`

**Note:** This function uses `asyncio.to_thread()` which is already imported from Task 3's imports. Also uses `logger` added in Task 3.

**Step 1: Write failing test for get_event_instances**

Add to `core/calendar/tests/test_events.py`:

```python
from core.calendar.events import get_event_instances


class TestGetEventInstances:
    @pytest.mark.asyncio
    async def test_returns_all_instances(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().instances().execute.return_value = {
            "items": [
                {
                    "id": "recurring123_20260201T180000Z",
                    "start": {"dateTime": "2026-02-01T18:00:00Z"},
                    "attendees": [
                        {"email": "user1@example.com", "responseStatus": "accepted"},
                    ],
                },
                {
                    "id": "recurring123_20260208T180000Z",
                    "start": {"dateTime": "2026-02-08T18:00:00Z"},
                    "attendees": [
                        {"email": "user1@example.com", "responseStatus": "tentative"},
                    ],
                },
            ]
        }

        result = await get_event_instances("recurring123")

        assert len(result) == 2
        assert result[0]["id"] == "recurring123_20260201T180000Z"
        assert result[0]["attendees"][0]["responseStatus"] == "accepted"
        assert result[1]["id"] == "recurring123_20260208T180000Z"

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await get_event_instances("recurring123")
            assert result is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/calendar/tests/test_events.py::TestGetEventInstances -v`
Expected: FAIL with "cannot import name 'get_event_instances'"

**Step 3: Implement get_event_instances**

Add to `core/calendar/events.py`:

```python
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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/calendar/tests/test_events.py::TestGetEventInstances -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/calendar/events.py core/calendar/tests/test_events.py
git commit -m "feat(calendar): add get_event_instances function

Fetches all instances of a recurring event with their RSVPs in one API call."
```

---

## Task 5: Export New Functions from Calendar Module

**Files:**
- Modify: `core/calendar/__init__.py`

**Step 1: Read current exports**

Check current `core/calendar/__init__.py` to see existing exports.

**Step 2: Add new exports**

Add to `core/calendar/__init__.py`:

```python
from .events import create_recurring_event, get_event_instances
from .client import batch_delete_events
```

**Step 3: Verify imports work**

Run: `python -c "from core.calendar import create_recurring_event, get_event_instances; print('OK')"`
Expected: OK

**Step 4: Commit**

```bash
git add core/calendar/__init__.py
git commit -m "feat(calendar): export recurring event functions"
```

---

## Task 6: Rewrite sync_group_calendar for Recurring Events

**Files:**
- Modify: `core/sync.py:914-1068`
- Test: `core/tests/test_sync_calendar.py`

**Step 1: Write failing test for new sync behavior**

Create or update `core/tests/test_sync_calendar.py`:

```python
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock, MagicMock

from core.sync import sync_group_calendar


class TestSyncGroupCalendarRecurring:
    @pytest.mark.asyncio
    async def test_creates_recurring_event_for_group_without_one(self):
        """When group has no gcal_recurring_event_id, create one."""
        # Create mock result objects that properly chain
        group_result = MagicMock()
        group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "gcal_recurring_event_id": None,
            "cohort_id": 1,
        }

        meetings_data = [
            {
                "meeting_id": i,
                "scheduled_at": datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc) + timedelta(weeks=i-1),
                "meeting_number": i,
            }
            for i in range(1, 9)
        ]
        meetings_result = MagicMock()
        meetings_result.mappings.return_value = meetings_data

        # Track which query is being executed
        call_count = [0]
        async def mock_execute(query):
            call_count[0] += 1
            if call_count[0] == 1:
                return group_result
            elif call_count[0] == 2:
                return meetings_result
            return MagicMock()

        conn = AsyncMock()
        conn.execute = mock_execute

        with patch("core.sync.get_transaction") as mock_tx:
            mock_tx.return_value.__aenter__.return_value = conn
            with patch("core.sync._get_group_member_emails", return_value={"user@example.com"}):
                with patch("core.calendar.events.create_recurring_event", return_value="recurring123") as mock_create:
                    result = await sync_group_calendar(1)

        assert result["created_recurring"] == True
        assert result["recurring_event_id"] == "recurring123"
        mock_create.assert_called_once()

    @pytest.mark.asyncio
    async def test_patches_attendees_on_existing_recurring_event(self):
        """When group has recurring event, patch attendees if changed."""
        # Create mock result objects
        group_result = MagicMock()
        group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Test Group",
            "gcal_recurring_event_id": "recurring123",
            "cohort_id": 1,
        }

        meetings_data = [
            {
                "meeting_id": 1,
                "scheduled_at": datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc),
                "meeting_number": 1,
            }
        ]
        meetings_result = MagicMock()
        meetings_result.mappings.return_value = meetings_data

        call_count = [0]
        async def mock_execute(query):
            call_count[0] += 1
            if call_count[0] == 1:
                return group_result
            elif call_count[0] == 2:
                return meetings_result
            return MagicMock()

        conn = AsyncMock()
        conn.execute = mock_execute

        with patch("core.sync.get_transaction") as mock_tx:
            mock_tx.return_value.__aenter__.return_value = conn
            with patch("core.sync._get_group_member_emails", return_value={"user@example.com", "new@example.com"}):
                with patch("core.sync.asyncio.to_thread") as mock_thread:
                    # First call: batch_get_events
                    # Second call: batch_patch_events
                    mock_thread.side_effect = [
                        {"recurring123": {"attendees": [{"email": "user@example.com"}]}},
                        {"recurring123": {"success": True}},
                    ]
                    result = await sync_group_calendar(1)

        assert result["patched"] == 1
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_sync_calendar.py::TestSyncGroupCalendarRecurring -v`
Expected: FAIL (current implementation doesn't handle recurring events)

**Step 3: Rewrite sync_group_calendar**

Replace `sync_group_calendar` function in `core/sync.py` (lines 914-1068):

```python
async def sync_group_calendar(group_id: int) -> dict:
    """
    Sync calendar for a group using recurring events.

    Idempotent and self-healing:
    - Creates recurring event if none exists
    - Recreates if event was deleted in Google Calendar
    - Patches attendees if changed
    - Uses row locking to prevent duplicate event creation

    Returns dict with sync results.
    """
    import asyncio
    from .database import get_connection, get_transaction
    from .tables import meetings, groups
    from .calendar.events import create_recurring_event
    from .calendar.client import batch_get_events, batch_patch_events
    from datetime import datetime, timezone
    from sqlalchemy import select, update

    result = {
        "meetings": 0,
        "created_recurring": False,
        "recurring_event_id": None,
        "patched": 0,
        "failed": 0,
    }

    # Use transaction with row lock to prevent race conditions.
    # CRITICAL: The SELECT FOR UPDATE lock is essential here - it prevents two concurrent
    # sync operations from both seeing gcal_recurring_event_id=None and creating duplicate
    # recurring events. The lock is held until the transaction commits.
    async with get_transaction() as conn:
        # Lock the group row to prevent concurrent event creation
        group_result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.group_name,
                groups.c.gcal_recurring_event_id,
                groups.c.cohort_id,
            )
            .where(groups.c.group_id == group_id)
            .with_for_update()
        )
        group = group_result.mappings().first()

        if not group:
            return {"error": "group_not_found", **result}

        # Get expected attendees
        expected_emails = await _get_group_member_emails(conn, group_id)

        if not expected_emails:
            return {"error": "no_members", **result}

        # Get future meetings to determine first meeting and count
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.scheduled_at,
                meetings.c.meeting_number,
            )
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
            .order_by(meetings.c.scheduled_at)
        )
        meeting_rows = list(meetings_result.mappings())

        if not meeting_rows:
            return {"reason": "no_future_meetings", **result}

        result["meetings"] = len(meeting_rows)
        result["recurring_event_id"] = group["gcal_recurring_event_id"]

        # --- Check if existing event still exists in Google Calendar ---
        events = None  # Initialize for use in PATCH section below
        if group["gcal_recurring_event_id"]:
            events = await asyncio.to_thread(
                batch_get_events, [group["gcal_recurring_event_id"]]
            )

            if events is None:
                # Calendar service not configured
                return {"error": "calendar_unavailable", **result}

            # Note: batch_get_events returns {} if event not found (vs None if service unavailable)
            if group["gcal_recurring_event_id"] not in events:
                # Event was deleted in Google Calendar - clear and recreate
                logger.warning(
                    f"Recurring event {group['gcal_recurring_event_id']} not found, "
                    f"clearing and recreating for group {group_id}"
                )
                await conn.execute(
                    update(groups)
                    .where(groups.c.group_id == group_id)
                    .values(gcal_recurring_event_id=None, calendar_invite_sent_at=None)
                )
                # Fall through to creation logic below
                group = {**group, "gcal_recurring_event_id": None}

        # --- CREATE recurring event if none exists ---
        if not group["gcal_recurring_event_id"]:
            first_meeting = meeting_rows[0]["scheduled_at"]
            num_meetings = len(meeting_rows)

            event_id = await create_recurring_event(
                title=f"{group['group_name']} - Weekly Meeting",
                description="AI Safety study group meeting",
                first_meeting=first_meeting,
                duration_minutes=60,
                num_occurrences=num_meetings,
                attendee_emails=list(expected_emails),
            )

            if event_id:
                await conn.execute(
                    update(groups)
                    .where(groups.c.group_id == group_id)
                    .values(
                        gcal_recurring_event_id=event_id,
                        calendar_invite_sent_at=datetime.now(timezone.utc),
                    )
                )
                result["created_recurring"] = True
                result["recurring_event_id"] = event_id
            else:
                result["failed"] = 1
                result["error"] = "calendar_create_failed"

            return result

        # --- PATCH existing recurring event if attendees changed ---
        event_id = group["gcal_recurring_event_id"]
        event_data = events[event_id]

        current_emails = {
            a.get("email", "").lower()
            for a in event_data.get("attendees", [])
            if a.get("email")
        }

        to_add = expected_emails - current_emails
        to_remove = current_emails - expected_emails

        if to_add or to_remove:
            new_attendees = [
                {"email": email} for email in (current_emails | to_add) - to_remove
            ]
            patch_results = await asyncio.to_thread(
                batch_patch_events,
                [{
                    "event_id": event_id,
                    "body": {"attendees": new_attendees},
                    "send_updates": "all" if to_add else "none",
                }]
            )

            if patch_results and patch_results.get(event_id, {}).get("success"):
                result["patched"] = 1
            else:
                result["failed"] = 1

        return result
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_sync_calendar.py::TestSyncGroupCalendarRecurring -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/sync.py core/tests/test_sync_calendar.py
git commit -m "feat(sync): rewrite sync_group_calendar for recurring events

- Creates single recurring event per group instead of N individual events
- Patches attendees on recurring event (affects all instances)
- Reduces API calls by ~8x"
```

---

## Task 7: Rewrite RSVP Sync to Use Instances API

**Files:**
- Modify: `core/calendar/rsvp.py`
- Test: `core/calendar/tests/test_rsvp.py` (create if needed)

**Step 1: Write failing test for new RSVP sync**

Create `core/calendar/tests/test_rsvp.py`:

```python
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock

from core.calendar.rsvp import sync_group_rsvps_from_recurring


class TestSyncGroupRsvpsFromRecurring:
    @pytest.mark.asyncio
    async def test_syncs_rsvps_from_all_instances(self):
        """Fetches instances and syncs RSVPs to meetings by datetime."""
        # Mock: instances API returns 2 instances with different RSVPs
        mock_instances = [
            {
                "id": "recurring123_20260201T180000Z",
                "start": {"dateTime": "2026-02-01T18:00:00Z"},
                "attendees": [
                    {"email": "user@example.com", "responseStatus": "accepted"},
                ],
            },
            {
                "id": "recurring123_20260208T180000Z",
                "start": {"dateTime": "2026-02-08T18:00:00Z"},
                "attendees": [
                    {"email": "user@example.com", "responseStatus": "declined"},
                ],
            },
        ]

        with patch("core.calendar.rsvp.get_event_instances", return_value=mock_instances):
            with patch("core.calendar.rsvp.get_connection") as mock_conn:
                conn = AsyncMock()
                mock_conn.return_value.__aenter__.return_value = conn

                # Mock: meetings query returns matching meetings
                conn.execute.return_value.mappings.return_value.all.return_value = [
                    {"meeting_id": 1, "scheduled_at": datetime(2026, 2, 1, 18, 0, tzinfo=timezone.utc)},
                    {"meeting_id": 2, "scheduled_at": datetime(2026, 2, 8, 18, 0, tzinfo=timezone.utc)},
                ]

                result = await sync_group_rsvps_from_recurring(
                    group_id=1,
                    recurring_event_id="recurring123",
                )

        assert result["synced"] == 2
        assert result["instances_fetched"] == 2
```

**Step 2: Run test to verify it fails**

Run: `pytest core/calendar/tests/test_rsvp.py::TestSyncGroupRsvpsFromRecurring -v`
Expected: FAIL with "cannot import name 'sync_group_rsvps_from_recurring'"

**Step 3: Implement sync_group_rsvps_from_recurring**

Add to `core/calendar/rsvp.py`:

```python
from dateutil.parser import isoparse
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert

from core.database import get_connection
from core.tables import meetings, attendances, users
from core.enums import RSVPStatus
from .events import get_event_instances


async def sync_group_rsvps_from_recurring(
    group_id: int,
    recurring_event_id: str,
) -> dict[str, int]:
    """
    Sync RSVPs for all meetings in a group from recurring event instances.

    Fetches all instances in ONE API call, then matches each instance
    to a meeting by comparing datetime.

    Diff-based: Only updates attendance records where status actually changed.

    Args:
        group_id: Database group ID
        recurring_event_id: Google Calendar recurring event ID

    Returns:
        {"instances_fetched": N, "synced": N, "skipped": N, "rsvps_updated": N}
    """
    import logging
    from datetime import timezone

    logger = logging.getLogger(__name__)

    # Fetch all instances in one API call
    instances = await get_event_instances(recurring_event_id)
    if instances is None:
        return {"instances_fetched": 0, "synced": 0, "error": "api_failed"}

    result = {
        "instances_fetched": len(instances),
        "synced": 0,
        "skipped": 0,
        "rsvps_updated": 0,  # Actual DB updates (not no-ops)
    }

    async with get_connection() as conn:
        # Get all meetings for the group
        meetings_result = await conn.execute(
            select(meetings.c.meeting_id, meetings.c.scheduled_at)
            .where(meetings.c.group_id == group_id)
        )
        meetings_by_time = {
            row["scheduled_at"].replace(tzinfo=timezone.utc): row["meeting_id"]
            for row in meetings_result.mappings()
        }

        # Process each instance
        for instance in instances:
            # Parse instance start time with error handling
            start_str = instance.get("start", {}).get("dateTime")
            if not start_str:
                continue

            try:
                instance_time = isoparse(start_str).replace(tzinfo=timezone.utc)
            except (ValueError, TypeError) as e:
                logger.warning(f"Failed to parse instance datetime '{start_str}': {e}")
                result["skipped"] += 1
                continue

            # Find matching meeting
            meeting_id = meetings_by_time.get(instance_time)
            if not meeting_id:
                # No matching meeting (time mismatch)
                result["skipped"] += 1
                continue

            # Sync attendee RSVPs for this instance
            for attendee in instance.get("attendees", []):
                email = attendee.get("email", "").lower()
                google_status = attendee.get("responseStatus", "needsAction")
                our_status = GOOGLE_TO_RSVP_STATUS.get(google_status, RSVPStatus.pending)

                # Find user by email
                user_result = await conn.execute(
                    select(users.c.user_id).where(users.c.email == email)
                )
                user_row = user_result.first()

                if user_row:
                    # Upsert attendance record - only update if status changed
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
                        # Only update if status actually changed (diff-based)
                        where=(attendances.c.rsvp_status != our_status),
                    )
                    db_result = await conn.execute(stmt)
                    # Track actual updates (rowcount > 0 means insert or update happened)
                    if db_result.rowcount > 0:
                        result["rsvps_updated"] += 1

            result["synced"] += 1

        await conn.commit()

    return result
```

**Step 4: Run test to verify it passes**

Run: `pytest core/calendar/tests/test_rsvp.py::TestSyncGroupRsvpsFromRecurring -v`
Expected: PASS

**Step 5: Commit**

```bash
git add core/calendar/rsvp.py core/calendar/tests/test_rsvp.py
git commit -m "feat(rsvp): add sync_group_rsvps_from_recurring

Syncs RSVPs from all instances in one API call instead of N calls."
```

---

## Task 8: Update sync_group_rsvps to Use Recurring Events

**Files:**
- Modify: `core/sync.py:1121-1152`

**Step 1: Rewrite sync_group_rsvps**

Replace the `sync_group_rsvps` function in `core/sync.py`:

```python
async def sync_group_rsvps(group_id: int) -> dict:
    """
    Sync RSVP records for all meetings of a group using recurring event instances.

    Returns dict with counts.
    """
    from .database import get_connection
    from .tables import groups
    from .calendar.rsvp import sync_group_rsvps_from_recurring
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(groups.c.gcal_recurring_event_id)
            .where(groups.c.group_id == group_id)
        )
        row = result.first()

    if not row or not row.gcal_recurring_event_id:
        return {"error": "no_recurring_event", "synced": 0}

    return await sync_group_rsvps_from_recurring(
        group_id=group_id,
        recurring_event_id=row.gcal_recurring_event_id,
    )
```

**Step 2: Run existing tests**

Run: `pytest core/tests/ -v -k rsvp`
Expected: PASS

**Step 3: Commit**

```bash
git add core/sync.py
git commit -m "feat(sync): update sync_group_rsvps to use recurring events

Uses instances() API - no legacy fallback."
```

---

## Task 9: Delete Old Individual Calendar Events

**Files:**
- Modify: `core/calendar/client.py` - add `batch_delete_events`
- Create: `scripts/cleanup_old_calendar_events.py`

**Why:** Before removing the `google_calendar_event_id` column, delete the old individual calendar events from Google Calendar to prevent users seeing duplicate entries.

**Step 1: Add batch_delete_events to client**

Add to `core/calendar/client.py`:

```python
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
```

**Step 2: Create cleanup script**

Create `scripts/cleanup_old_calendar_events.py`:

```python
#!/usr/bin/env python3
"""
Delete old individual calendar events from Google Calendar.

Run BEFORE the migration that removes google_calendar_event_id column.

Usage:
    python scripts/cleanup_old_calendar_events.py [--dry-run]
"""
import asyncio
import argparse

from core.database import get_connection
from core.calendar.client import batch_delete_events
from sqlalchemy import select


async def cleanup_old_events(dry_run: bool = True):
    """Delete all individual meeting calendar events."""

    # Import here to avoid circular imports
    from core.tables import meetings

    async with get_connection() as conn:
        # Find all meetings with individual calendar events
        result = await conn.execute(
            select(meetings.c.meeting_id, meetings.c.google_calendar_event_id)
            .where(meetings.c.google_calendar_event_id.isnot(None))
        )
        rows = list(result.mappings())

    if not rows:
        print("No individual calendar events found.")
        return

    event_ids = [row["google_calendar_event_id"] for row in rows]
    print(f"Found {len(event_ids)} individual calendar events to delete.")

    if dry_run:
        print("DRY RUN - would delete these events:")
        for eid in event_ids[:10]:
            print(f"  - {eid}")
        if len(event_ids) > 10:
            print(f"  ... and {len(event_ids) - 10} more")
        return

    # Delete in batches of 50 (Google API limit)
    BATCH_SIZE = 50
    deleted = 0
    failed = 0

    for i in range(0, len(event_ids), BATCH_SIZE):
        batch = event_ids[i:i + BATCH_SIZE]
        results = batch_delete_events(batch)

        if results:
            for event_id, result in results.items():
                if result["success"]:
                    deleted += 1
                else:
                    failed += 1
                    print(f"  Failed to delete {event_id}: {result['error']}")

        print(f"Progress: {i + len(batch)}/{len(event_ids)}")

    print(f"\nDeleted: {deleted}, Failed: {failed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--execute", action="store_true", help="Actually delete events")
    args = parser.parse_args()

    asyncio.run(cleanup_old_events(dry_run=not args.execute))
```

**Step 3: Run cleanup (dry-run first)**

Run: `python scripts/cleanup_old_calendar_events.py --dry-run`
Expected: List of events that would be deleted

**Step 4: Run cleanup for real**

Run: `python scripts/cleanup_old_calendar_events.py --execute`
Expected: Events deleted from Google Calendar

**Step 5: Commit**

```bash
git add core/calendar/client.py scripts/cleanup_old_calendar_events.py
git commit -m "feat(calendar): add cleanup script for old individual events

Deletes legacy per-meeting calendar events before migration."
```

---

## Task 10: Database Migration - Remove Old Columns from Meetings

**⚠️ DEPENDENCY: Task 9 MUST be completed before this task.** The cleanup script in Task 9 uses the `google_calendar_event_id` column that this migration removes.

**Files:**
- Create: `migrations/remove_calendar_columns_from_meetings.sql`
- Modify: `core/tables.py:210-235`

**Step 1: Write migration SQL**

Create `migrations/remove_calendar_columns_from_meetings.sql`:

```sql
-- Remove calendar columns from meetings table (now tracked at group level)
-- Clean break - no legacy support needed

ALTER TABLE meetings DROP COLUMN IF EXISTS google_calendar_event_id;
ALTER TABLE meetings DROP COLUMN IF EXISTS calendar_invite_sent_at;
```

**Step 2: Update SQLAlchemy table definition**

In `core/tables.py`, remove from the `meetings` table (around lines 228-229):

```python
    # REMOVE these lines:
    Column("google_calendar_event_id", Text),
    Column("calendar_invite_sent_at", TIMESTAMP(timezone=True)),
```

**Step 3: Run migration locally**

Run: `psql $DATABASE_URL -f migrations/remove_calendar_columns_from_meetings.sql`
Expected: ALTER TABLE (success)

**Step 4: Commit**

```bash
git add migrations/remove_calendar_columns_from_meetings.sql core/tables.py
git commit -m "feat(db): remove calendar columns from meetings table

Calendar tracking now at group level via gcal_recurring_event_id."
```

---

## Task 11: Delete Legacy Calendar Code

**Files:**
- Modify: `core/meetings.py` - delete `send_calendar_invites_for_group`
- Modify: `core/queries/meetings.py` - delete `update_meeting_calendar_id`
- Modify: `core/calendar/rsvp.py` - delete `sync_meeting_rsvps`, `sync_upcoming_meeting_rsvps`

**Step 1: Search for usages of legacy functions**

Run: `grep -rE "send_calendar_invites_for_group|update_meeting_calendar_id|sync_meeting_rsvps|sync_upcoming_meeting_rsvps" --include="*.py" .`

**Step 2: Update any callers**

Replace calls to:
- `send_calendar_invites_for_group()` → use `sync_group_calendar()` from `core/sync.py`
- `sync_meeting_rsvps()` → use `sync_group_rsvps()` from `core/sync.py`

**Step 3: Delete the legacy functions**

In `core/meetings.py`, delete the entire `send_calendar_invites_for_group` function (lines 83-126).

In `core/queries/meetings.py`, delete `update_meeting_calendar_id` if it exists.

In `core/calendar/rsvp.py`, delete `sync_meeting_rsvps` and `sync_upcoming_meeting_rsvps` functions.

**Step 4: Run tests to find any broken imports**

Run: `pytest`
Expected: May fail initially - fix any remaining references

**Step 5: Commit**

```bash
git add core/meetings.py core/queries/meetings.py core/calendar/rsvp.py
git commit -m "refactor: delete legacy per-meeting calendar functions

Replaced by recurring event functions in sync.py."
```

---

## Task 12: Run Full Test Suite and Lint

**Step 1: Run all tests**

Run: `pytest`
Expected: All tests pass

**Step 2: Run linting**

Run: `ruff check . && ruff format --check .`
Expected: No errors

**Step 3: Fix any issues found**

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: ensure all tests pass after recurring events refactor"
```

---

## Summary

**12 tasks total:**
1. Rate limit logging in calendar client
2. Add columns to groups table
3. Create recurring event function
4. Get event instances function
5. Export new functions
6. Rewrite sync_group_calendar (idempotent, self-healing)
7. RSVP sync from recurring events
8. Update sync_group_rsvps
9. Delete old individual calendar events (cleanup script)
10. Remove calendar columns from meetings table
11. Delete legacy calendar code
12. Run full test suite and lint

**After completing all tasks:**

1. **Rate limit monitoring** - 429 errors logged with context to Sentry
2. **Groups table** has `gcal_recurring_event_id` and `calendar_invite_sent_at`
3. **All groups** get a single recurring calendar event (clean break, no legacy)
4. **RSVP sync** uses `instances()` API (1 call instead of N)
5. **Attendee changes** patch the recurring event (affects all meetings)
6. **Idempotent sync** - row locking prevents race conditions, self-heals if event deleted
7. **Old events cleaned up** - legacy individual events deleted from Google Calendar
8. **Meetings table** cleaned up - calendar columns removed
9. **Legacy code deleted** - `send_calendar_invites_for_group`, `sync_meeting_rsvps` removed

**API call reduction:**
- Create: N → 1
- RSVP sync: N → 1
- Attendee changes: N → 1
- Total: ~8x reduction for typical 8-week cohort
