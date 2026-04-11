# Async Google Calendar API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert blocking Google Calendar API calls to non-blocking async calls using `asyncio.to_thread()`.

**Architecture:** Wrap existing synchronous Google API calls in `asyncio.to_thread()` to run them in a thread pool without blocking the shared asyncio event loop. This is minimally invasive - function signatures change from sync to async, but implementation stays largely the same.

**Tech Stack:** Python asyncio, Google API Python client (existing), pytest-asyncio for tests.

---

## Task 1: Convert `create_meeting_event()` to Async

**Files:**
- Modify: `core/calendar/events.py:8-60`
- Test: `core/calendar/tests/test_events.py:33-66`

**Step 1: Write the failing test for async behavior**

Open `core/calendar/tests/test_events.py` and update the test class:

```python
import pytest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from core.calendar.events import (
    create_meeting_event,
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
    @pytest.mark.asyncio
    async def test_creates_event_with_correct_params(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().insert().execute.return_value = {
            "id": "event123"
        }

        result = await create_meeting_event(
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

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await create_meeting_event(
                title="Test",
                description="Test",
                start=datetime.now(timezone.utc),
                attendee_emails=["test@example.com"],
            )
            assert result is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/calendar/tests/test_events.py::TestCreateMeetingEvent -v`

Expected: FAIL with `TypeError: object str cannot be used in 'await' expression` (because function is still sync)

**Step 3: Convert `create_meeting_event()` to async**

Open `core/calendar/events.py` and replace lines 1-60 with:

```python
"""Google Calendar event operations."""

import asyncio
from datetime import datetime, timedelta

from .client import get_calendar_service, get_calendar_email


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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/calendar/tests/test_events.py::TestCreateMeetingEvent -v`

Expected: PASS

**Step 5: Commit**

```bash
git add core/calendar/events.py core/calendar/tests/test_events.py
git commit -m "feat(calendar): convert create_meeting_event to async

Use asyncio.to_thread() to run blocking Google API call in thread pool,
preventing event loop blocking in FastAPI/Discord bot async contexts."
```

---

## Task 2: Convert `update_meeting_event()` to Async

**Files:**
- Modify: `core/calendar/events.py:63-112`
- Test: `core/calendar/tests/test_events.py` (add new test)

**Step 1: Write the failing test**

Add to `core/calendar/tests/test_events.py`:

```python
from core.calendar.events import (
    create_meeting_event,
    update_meeting_event,
    get_event_rsvps,
)


class TestUpdateMeetingEvent:
    @pytest.mark.asyncio
    async def test_updates_event_successfully(
        self, mock_calendar_service, mock_calendar_email
    ):
        # Mock get() to return existing event
        mock_calendar_service.events().get().execute.return_value = {
            "summary": "Old Title",
            "start": {"dateTime": "2026-01-20T15:00:00+00:00", "timeZone": "UTC"},
            "end": {"dateTime": "2026-01-20T16:00:00+00:00", "timeZone": "UTC"},
        }
        # Mock update()
        mock_calendar_service.events().update().execute.return_value = {}

        result = await update_meeting_event(
            event_id="event123",
            start=datetime(2026, 1, 21, 15, 0, tzinfo=timezone.utc),
            title="New Title",
        )

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await update_meeting_event(event_id="event123")
            assert result is False
```

**Step 2: Run test to verify it fails**

Run: `pytest core/calendar/tests/test_events.py::TestUpdateMeetingEvent -v`

Expected: FAIL with `TypeError: object bool cannot be used in 'await' expression`

**Step 3: Convert `update_meeting_event()` to async**

In `core/calendar/events.py`, replace the `update_meeting_event` function (after `create_meeting_event`) with:

```python
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
        return (
            service.events()
            .get(calendarId=calendar_id, eventId=event_id)
            .execute()
        )

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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/calendar/tests/test_events.py::TestUpdateMeetingEvent -v`

Expected: PASS

**Step 5: Commit**

```bash
git add core/calendar/events.py core/calendar/tests/test_events.py
git commit -m "feat(calendar): convert update_meeting_event to async

Wrap both GET and UPDATE API calls in asyncio.to_thread()."
```

---

## Task 3: Convert `cancel_meeting_event()` to Async

**Files:**
- Modify: `core/calendar/events.py:115-137`
- Test: `core/calendar/tests/test_events.py` (add new test)

**Step 1: Write the failing test**

Add to `core/calendar/tests/test_events.py`:

```python
from core.calendar.events import (
    create_meeting_event,
    update_meeting_event,
    cancel_meeting_event,
    get_event_rsvps,
)


class TestCancelMeetingEvent:
    @pytest.mark.asyncio
    async def test_cancels_event_successfully(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().delete().execute.return_value = None

        result = await cancel_meeting_event("event123")

        assert result is True
        mock_calendar_service.events().delete.assert_called()

    @pytest.mark.asyncio
    async def test_returns_false_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await cancel_meeting_event("event123")
            assert result is False
```

**Step 2: Run test to verify it fails**

Run: `pytest core/calendar/tests/test_events.py::TestCancelMeetingEvent -v`

Expected: FAIL with `TypeError: object bool cannot be used in 'await' expression`

**Step 3: Convert `cancel_meeting_event()` to async**

In `core/calendar/events.py`, replace the `cancel_meeting_event` function with:

```python
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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/calendar/tests/test_events.py::TestCancelMeetingEvent -v`

Expected: PASS

**Step 5: Commit**

```bash
git add core/calendar/events.py core/calendar/tests/test_events.py
git commit -m "feat(calendar): convert cancel_meeting_event to async"
```

---

## Task 4: Convert `get_event_rsvps()` to Async

**Files:**
- Modify: `core/calendar/events.py:140-171`
- Test: `core/calendar/tests/test_events.py:69-85`

**Step 1: Update the existing test to be async**

In `core/calendar/tests/test_events.py`, update `TestGetEventRsvps`:

```python
class TestGetEventRsvps:
    @pytest.mark.asyncio
    async def test_returns_attendee_statuses(
        self, mock_calendar_service, mock_calendar_email
    ):
        mock_calendar_service.events().get().execute.return_value = {
            "attendees": [
                {"email": "user1@example.com", "responseStatus": "accepted"},
                {"email": "user2@example.com", "responseStatus": "declined"},
            ]
        }

        result = await get_event_rsvps("event123")

        assert len(result) == 2
        assert result[0]["email"] == "user1@example.com"
        assert result[0]["responseStatus"] == "accepted"

    @pytest.mark.asyncio
    async def test_returns_none_when_service_unavailable(self):
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await get_event_rsvps("event123")
            assert result is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/calendar/tests/test_events.py::TestGetEventRsvps -v`

Expected: FAIL with `TypeError: object list cannot be used in 'await' expression`

**Step 3: Convert `get_event_rsvps()` to async**

In `core/calendar/events.py`, replace the `get_event_rsvps` function with:

```python
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
        return (
            service.events()
            .get(calendarId=calendar_id, eventId=event_id)
            .execute()
        )

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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/calendar/tests/test_events.py::TestGetEventRsvps -v`

Expected: PASS

**Step 5: Commit**

```bash
git add core/calendar/events.py core/calendar/tests/test_events.py
git commit -m "feat(calendar): convert get_event_rsvps to async"
```

---

## Task 5: Update Callers in `core/meetings.py`

**Files:**
- Modify: `core/meetings.py:115-120` and `core/meetings.py:177-181`

**Step 1: Verify current tests still fail after function changes**

Run: `pytest core/ -v -k "meeting" --tb=short 2>&1 | head -50`

Expected: Some tests may fail due to missing `await` on calendar calls.

**Step 2: Update `send_calendar_invites_for_group()` to await**

In `core/meetings.py`, change line 115 from:

```python
            event_id = create_meeting_event(
```

to:

```python
            event_id = await create_meeting_event(
```

The full context around line 115:

```python
        for meeting in meetings_list:
            if meeting["meeting_id"] not in meeting_ids:
                continue

            event_id = await create_meeting_event(
                title=f"{group_name} - Week {meeting['meeting_number']}",
                description="Weekly AI Safety study group meeting",
                start=meeting["scheduled_at"],
                attendee_emails=emails,
            )

            if event_id:
                await update_meeting_calendar_id(conn, meeting["meeting_id"], event_id)
                sent += 1
```

**Step 3: Update `reschedule_meeting()` to await**

In `core/meetings.py`, change lines 177-181 from:

```python
        # Update Google Calendar (sends notification to attendees)
        if meeting.get("google_calendar_event_id"):
            update_meeting_event(
                event_id=meeting["google_calendar_event_id"],
                start=new_time,
            )
```

to:

```python
        # Update Google Calendar (sends notification to attendees)
        if meeting.get("google_calendar_event_id"):
            await update_meeting_event(
                event_id=meeting["google_calendar_event_id"],
                start=new_time,
            )
```

**Step 4: Run tests to verify callers work correctly**

Run: `pytest core/calendar/tests/ -v`

Expected: PASS

**Step 5: Commit**

```bash
git add core/meetings.py
git commit -m "fix(meetings): await async calendar API calls

Update send_calendar_invites_for_group and reschedule_meeting to
properly await the now-async calendar functions."
```

---

## Task 5.5: Update Mocks in `core/tests/test_meetings.py`

**Files:**
- Modify: `core/tests/test_meetings.py:50`

**Why this is needed:** The test file mocks `create_meeting_event` with a regular `Mock` that returns a string directly. After converting to async, the function returns a coroutine, so the mock must use `AsyncMock`.

**Step 1: Run the test to see it fail**

Run: `pytest core/tests/test_meetings.py::TestSendCalendarInvites::test_sends_invites_to_all_members -v`

Expected: FAIL with `TypeError: object str cannot be used in 'await' expression` (the mock returns `"google-event-id-123"` synchronously instead of a coroutine)

**Step 2: Update the mock to use AsyncMock**

In `core/tests/test_meetings.py`, change line 50 from:

```python
            patch("core.meetings.create_meeting_event") as mock_create_event,
```

to:

```python
            patch("core.meetings.create_meeting_event", new_callable=AsyncMock) as mock_create_event,
```

Note: `AsyncMock` is already imported on line 5 of this file.

**Step 3: Run the test to verify it passes**

Run: `pytest core/tests/test_meetings.py::TestSendCalendarInvites::test_sends_invites_to_all_members -v`

Expected: PASS

**Step 4: Commit**

```bash
git add core/tests/test_meetings.py
git commit -m "test(meetings): use AsyncMock for async calendar functions

The create_meeting_event function is now async, so tests must use
AsyncMock to properly simulate the coroutine behavior."
```

---

## Task 6: Update Caller in `core/calendar/rsvp.py`

**Files:**
- Modify: `core/calendar/rsvp.py:46`

**Step 1: Update `sync_meeting_rsvps()` to await `get_event_rsvps()`**

In `core/calendar/rsvp.py`, change line 46 from:

```python
        google_rsvps = get_event_rsvps(row.google_calendar_event_id)
```

to:

```python
        google_rsvps = await get_event_rsvps(row.google_calendar_event_id)
```

**Step 2: Run the RSVP-related tests**

Run: `pytest core/ -v -k "rsvp" --tb=short`

Expected: PASS (or no RSVP tests exist yet, which is fine)

**Step 3: Run full calendar test suite**

Run: `pytest core/calendar/ -v`

Expected: All PASS

**Step 4: Commit**

```bash
git add core/calendar/rsvp.py
git commit -m "fix(calendar): await get_event_rsvps in sync_meeting_rsvps

The rsvp.py module was already async, just needed to await the
now-async get_event_rsvps function."
```

---

## Task 7: Run Full Test Suite and Lint

**Files:**
- None (verification only)

**Step 1: Run all core tests**

Run: `pytest core/ -v`

Expected: All PASS

**Step 2: Run ruff linter**

Run: `ruff check core/calendar/ core/meetings.py`

Expected: No errors (or only unrelated pre-existing issues)

**Step 3: Run ruff formatter check**

Run: `ruff format --check core/calendar/ core/meetings.py`

Expected: No formatting issues

**Step 4: Fix any issues if needed**

If ruff reports issues, fix them:

Run: `ruff check --fix core/calendar/ core/meetings.py && ruff format core/calendar/ core/meetings.py`

**Step 5: Final commit if fixes were needed**

```bash
git add -A
git commit -m "style: fix lint issues in calendar async migration"
```

---

## Task 8: Integration Verification

**Files:**
- None (manual verification)

**Step 1: Verify the full test suite passes**

Run: `pytest --tb=short`

Expected: All tests PASS

**Step 2: Verify the application starts**

Run: `python main.py --no-bot --help` (just verify it imports correctly)

Expected: Help message displays without import errors

**Step 3: Create summary commit (if all previous commits successful)**

If working on a feature branch, all commits are already made. Otherwise, this serves as final verification.

---

## Summary of Changes

| File | Change |
|------|--------|
| `core/calendar/events.py` | Convert 4 functions to async with `asyncio.to_thread()` |
| `core/calendar/tests/test_events.py` | Update all tests to be async with `@pytest.mark.asyncio` |
| `core/meetings.py` | Add `await` to `create_meeting_event()` and `update_meeting_event()` calls |
| `core/tests/test_meetings.py` | Update mock to use `AsyncMock` for `create_meeting_event` |
| `core/calendar/rsvp.py` | Add `await` to `get_event_rsvps()` call |

**Note:** `core/calendar/__init__.py` exports do not need changes - re-exports of async functions work transparently.

## Verification Checklist

- [ ] `create_meeting_event()` is async and uses `asyncio.to_thread()`
- [ ] `update_meeting_event()` is async and uses `asyncio.to_thread()`
- [ ] `cancel_meeting_event()` is async and uses `asyncio.to_thread()`
- [ ] `get_event_rsvps()` is async and uses `asyncio.to_thread()`
- [ ] All callers updated to `await` the async functions
- [ ] Test mocks updated to use `AsyncMock` where needed
- [ ] All tests pass
- [ ] Lint passes
