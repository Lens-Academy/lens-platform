# Google Calendar Batch API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Batch all Google Calendar API calls to avoid quota limits during cohort scheduling (800 events) and group switching.

**Architecture:** One unified `sync_group_calendar(group_id)` function that handles both event creation and attendee updates using batch API. Meetings without calendar events get batch-created; existing events get batch-fetched and batch-patched.

**Tech Stack:** `googleapiclient` (already installed), `service.new_batch_http_request()`

---

## Background

**Problem 1 - Cohort scheduling:** 100 groups × 8 meetings = 800 INSERT calls
**Problem 2 - Group switching:** 8 meetings × 2 calls (GET + PATCH) = 16 calls per switch

**Solution:** Unified sync function using batch API for all operations:
- Batch INSERT for new events
- Batch GET for fetching existing events
- Batch PATCH for updating attendees

---

## Task 1: Add batch_get_events helper

**Files:**
- Modify: `core/calendar/client.py`
- Test: `core/tests/test_calendar_batch.py` (create)

**Step 1: Write the failing test**

Create `core/tests/test_calendar_batch.py`:

```python
"""Tests for Google Calendar batch operations."""

import pytest
from unittest.mock import MagicMock, patch


class TestBatchGetEvents:
    """Test batch fetching of calendar events."""

    def test_returns_empty_dict_when_no_event_ids(self):
        """Should return empty dict for empty input."""
        from core.calendar.client import batch_get_events

        result = batch_get_events([])
        assert result == {}

    def test_returns_none_when_calendar_not_configured(self):
        """Should return None if calendar service unavailable."""
        from core.calendar.client import batch_get_events

        with patch("core.calendar.client.get_calendar_service", return_value=None):
            result = batch_get_events(["event1", "event2"])
            assert result is None

    def test_fetches_multiple_events_in_single_batch(self):
        """Should fetch all events in one batch request."""
        from core.calendar.client import batch_get_events

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            for request_id, callback in callbacks:
                callback(request_id, {"id": request_id, "attendees": []}, None)

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        with patch("core.calendar.client.get_calendar_service", return_value=mock_service):
            result = batch_get_events(["event1", "event2", "event3"])

        assert len(callbacks) == 3
        assert set(result.keys()) == {"event1", "event2", "event3"}

    def test_handles_partial_failures(self):
        """Should return successful events and log failures."""
        from core.calendar.client import batch_get_events

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            callbacks[0][1]("event1", {"id": "event1", "attendees": []}, None)
            callbacks[1][1]("event2", None, Exception("Not found"))

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        with patch("core.calendar.client.get_calendar_service", return_value=mock_service):
            with patch("core.calendar.client.sentry_sdk"):
                result = batch_get_events(["event1", "event2"])

        assert "event1" in result
        assert "event2" not in result
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_calendar_batch.py::TestBatchGetEvents -v`
Expected: FAIL with "cannot import name 'batch_get_events'"

**Step 3: Write minimal implementation**

Add to `core/calendar/client.py`:

```python
import logging
import sentry_sdk

logger = logging.getLogger(__name__)


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
            logger.error(f"Failed to fetch event {request_id}: {exception}")
            sentry_sdk.capture_exception(exception)
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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_calendar_batch.py::TestBatchGetEvents -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(calendar): add batch_get_events helper"
```

---

## Task 2: Add batch_create_events helper

**Files:**
- Modify: `core/calendar/client.py`
- Test: `core/tests/test_calendar_batch.py`

**Step 1: Write the failing test**

Add to `core/tests/test_calendar_batch.py`:

```python
class TestBatchCreateEvents:
    """Test batch creation of calendar events."""

    def test_returns_empty_dict_when_no_events(self):
        """Should return empty dict for empty input."""
        from core.calendar.client import batch_create_events

        result = batch_create_events([])
        assert result == {}

    def test_returns_none_when_calendar_not_configured(self):
        """Should return None if calendar service unavailable."""
        from core.calendar.client import batch_create_events

        with patch("core.calendar.client.get_calendar_service", return_value=None):
            events = [{"meeting_id": 1, "title": "Test", "start": "2024-01-01T10:00:00Z", "attendees": []}]
            result = batch_create_events(events)
            assert result is None

    def test_creates_multiple_events_in_single_batch(self):
        """Should create all events in one batch request."""
        from core.calendar.client import batch_create_events
        from datetime import datetime, timezone

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            for request_id, callback in callbacks:
                callback(request_id, {"id": f"gcal_{request_id}"}, None)

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        events = [
            {
                "meeting_id": 1,
                "title": "Group A - Meeting 1",
                "description": "Study group",
                "start": datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc),
                "duration_minutes": 60,
                "attendees": ["a@test.com", "b@test.com"],
            },
            {
                "meeting_id": 2,
                "title": "Group A - Meeting 2",
                "description": "Study group",
                "start": datetime(2024, 1, 8, 10, 0, tzinfo=timezone.utc),
                "duration_minutes": 60,
                "attendees": ["a@test.com", "b@test.com"],
            },
        ]

        with patch("core.calendar.client.get_calendar_service", return_value=mock_service):
            result = batch_create_events(events)

        assert len(callbacks) == 2
        assert result[1]["success"] is True
        assert result[1]["event_id"] == "gcal_1"
        assert result[2]["success"] is True
        assert result[2]["event_id"] == "gcal_2"

    def test_handles_partial_failures(self):
        """Should return success/failure status for each event."""
        from core.calendar.client import batch_create_events
        from datetime import datetime, timezone

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            callbacks[0][1]("1", {"id": "gcal_1"}, None)
            callbacks[1][1]("2", None, Exception("Quota exceeded"))

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        events = [
            {"meeting_id": 1, "title": "Meeting 1", "description": "", "start": datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc), "duration_minutes": 60, "attendees": []},
            {"meeting_id": 2, "title": "Meeting 2", "description": "", "start": datetime(2024, 1, 2, 10, 0, tzinfo=timezone.utc), "duration_minutes": 60, "attendees": []},
        ]

        with patch("core.calendar.client.get_calendar_service", return_value=mock_service):
            with patch("core.calendar.client.sentry_sdk"):
                result = batch_create_events(events)

        assert result[1]["success"] is True
        assert result[2]["success"] is False
        assert "Quota exceeded" in result[2]["error"]
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_calendar_batch.py::TestBatchCreateEvents -v`
Expected: FAIL with "cannot import name 'batch_create_events'"

**Step 3: Write minimal implementation**

Add to `core/calendar/client.py`:

```python
from datetime import timedelta


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
            logger.error(f"Failed to create event for meeting {meeting_id}: {exception}")
            sentry_sdk.capture_exception(exception)
            results[meeting_id] = {"success": False, "event_id": None, "error": str(exception)}
        else:
            results[meeting_id] = {"success": True, "event_id": response["id"], "error": None}

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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_calendar_batch.py::TestBatchCreateEvents -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(calendar): add batch_create_events helper"
```

---

## Task 3: Add batch_patch_events helper

**Files:**
- Modify: `core/calendar/client.py`
- Test: `core/tests/test_calendar_batch.py`

**Step 1: Write the failing test**

Add to `core/tests/test_calendar_batch.py`:

```python
class TestBatchPatchEvents:
    """Test batch patching of calendar events."""

    def test_returns_empty_dict_when_no_updates(self):
        """Should return empty dict for empty input."""
        from core.calendar.client import batch_patch_events

        result = batch_patch_events([])
        assert result == {}

    def test_patches_multiple_events_with_per_event_send_updates(self):
        """Should patch events with correct per-event sendUpdates."""
        from core.calendar.client import batch_patch_events

        mock_service = MagicMock()
        mock_batch = MagicMock()
        mock_service.new_batch_http_request.return_value = mock_batch

        patch_calls = []

        def mock_patch(**kwargs):
            patch_calls.append(kwargs)
            return MagicMock()

        mock_service.events.return_value.patch = mock_patch

        callbacks = []

        def mock_add(request, callback, request_id):
            callbacks.append((request_id, callback))

        def mock_execute():
            for request_id, callback in callbacks:
                callback(request_id, {"id": request_id}, None)

        mock_batch.add = mock_add
        mock_batch.execute = mock_execute

        updates = [
            {"event_id": "event1", "body": {"attendees": []}, "send_updates": "all"},
            {"event_id": "event2", "body": {"attendees": []}, "send_updates": "none"},
        ]

        with patch("core.calendar.client.get_calendar_service", return_value=mock_service):
            result = batch_patch_events(updates)

        assert patch_calls[0]["sendUpdates"] == "all"
        assert patch_calls[1]["sendUpdates"] == "none"
        assert result["event1"]["success"] is True
        assert result["event2"]["success"] is True
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_calendar_batch.py::TestBatchPatchEvents -v`
Expected: FAIL with "cannot import name 'batch_patch_events'"

**Step 3: Write minimal implementation**

Add to `core/calendar/client.py`:

```python
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
            logger.error(f"Failed to patch event {request_id}: {exception}")
            sentry_sdk.capture_exception(exception)
            results[request_id] = {"success": False, "error": str(exception)}
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
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_calendar_batch.py::TestBatchPatchEvents -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(calendar): add batch_patch_events helper"
```

---

## Task 4: Refactor sync_group_calendar to unified batch approach

**Files:**
- Modify: `core/lifecycle.py`
- Test: `core/tests/test_lifecycle_calendar.py` (create)

**Step 1: Write the failing test**

Create `core/tests/test_lifecycle_calendar.py`:

```python
"""Tests for calendar sync lifecycle operations."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta


class TestSyncGroupCalendar:
    """Test unified sync_group_calendar function."""

    @pytest.mark.asyncio
    async def test_creates_events_for_meetings_without_calendar_ids(self):
        """Should batch create events for meetings without google_calendar_event_id."""
        from core.lifecycle import sync_group_calendar

        # Meetings without calendar event IDs
        mock_meetings = [
            {"meeting_id": 1, "google_calendar_event_id": None, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=1), "group_name": "Test Group"},
            {"meeting_id": 2, "google_calendar_event_id": None, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=8), "group_name": "Test Group"},
        ]

        with patch("core.lifecycle.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_get_conn.return_value.__aenter__.return_value = mock_conn

            mock_result = MagicMock()
            mock_result.mappings.return_value = mock_meetings
            mock_conn.execute.return_value = mock_result

            with patch("core.lifecycle._get_group_member_emails") as mock_emails:
                mock_emails.return_value = {"user@test.com"}

                with patch("core.lifecycle.batch_create_events") as mock_create:
                    mock_create.return_value = {
                        1: {"success": True, "event_id": "gcal_1", "error": None},
                        2: {"success": True, "event_id": "gcal_2", "error": None},
                    }

                    with patch("core.lifecycle.batch_get_events") as mock_get:
                        mock_get.return_value = {}

                        with patch("core.lifecycle.batch_patch_events") as mock_patch:
                            mock_patch.return_value = {}

                            result = await sync_group_calendar(group_id=1)

                            # Should call batch_create for both meetings
                            mock_create.assert_called_once()
                            create_args = mock_create.call_args[0][0]
                            assert len(create_args) == 2

    @pytest.mark.asyncio
    async def test_patches_existing_events_with_attendee_changes(self):
        """Should batch patch existing events that have attendee diffs."""
        from core.lifecycle import sync_group_calendar

        mock_meetings = [
            {"meeting_id": 1, "google_calendar_event_id": "gcal_1", "scheduled_at": datetime.now(timezone.utc) + timedelta(days=1), "group_name": "Test"},
            {"meeting_id": 2, "google_calendar_event_id": "gcal_2", "scheduled_at": datetime.now(timezone.utc) + timedelta(days=8), "group_name": "Test"},
        ]

        with patch("core.lifecycle.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            mock_result = MagicMock()
            mock_result.mappings.return_value = mock_meetings
            mock_conn.execute.return_value = mock_result

            with patch("core.lifecycle._get_group_member_emails") as mock_emails:
                mock_emails.return_value = {"new@test.com"}

                with patch("core.lifecycle.batch_create_events") as mock_create:
                    mock_create.return_value = {}

                    with patch("core.lifecycle.batch_get_events") as mock_get:
                        mock_get.return_value = {
                            "gcal_1": {"attendees": [{"email": "old@test.com"}]},
                            "gcal_2": {"attendees": [{"email": "new@test.com"}]},  # Already correct
                        }

                        with patch("core.lifecycle.batch_patch_events") as mock_patch:
                            mock_patch.return_value = {"gcal_1": {"success": True}}

                            await sync_group_calendar(group_id=1)

                            # Only gcal_1 should be patched (gcal_2 already has correct attendees)
                            mock_patch.assert_called_once()
                            patch_args = mock_patch.call_args[0][0]
                            event_ids = [u["event_id"] for u in patch_args]
                            assert "gcal_1" in event_ids
                            assert "gcal_2" not in event_ids

    @pytest.mark.asyncio
    async def test_uses_send_updates_all_for_additions_none_for_removals(self):
        """Should send notifications only when adding attendees."""
        from core.lifecycle import sync_group_calendar

        mock_meetings = [
            {"meeting_id": 1, "google_calendar_event_id": "gcal_add", "scheduled_at": datetime.now(timezone.utc) + timedelta(days=1), "group_name": "Test"},
            {"meeting_id": 2, "google_calendar_event_id": "gcal_remove", "scheduled_at": datetime.now(timezone.utc) + timedelta(days=8), "group_name": "Test"},
        ]

        with patch("core.lifecycle.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            mock_result = MagicMock()
            mock_result.mappings.return_value = mock_meetings
            mock_conn.execute.return_value = mock_result

            with patch("core.lifecycle._get_group_member_emails") as mock_emails:
                mock_emails.return_value = {"new@test.com"}

                with patch("core.lifecycle.batch_create_events", return_value={}):
                    with patch("core.lifecycle.batch_get_events") as mock_get:
                        mock_get.return_value = {
                            "gcal_add": {"attendees": []},  # Will add new@test.com
                            "gcal_remove": {"attendees": [{"email": "old@test.com"}]},  # Will remove old
                        }

                        with patch("core.lifecycle.batch_patch_events") as mock_patch:
                            mock_patch.return_value = {}

                            await sync_group_calendar(group_id=1)

                            patch_args = mock_patch.call_args[0][0]
                            by_id = {u["event_id"]: u for u in patch_args}

                            assert by_id["gcal_add"]["send_updates"] == "all"
                            assert by_id["gcal_remove"]["send_updates"] == "none"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_lifecycle_calendar.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Replace `sync_group_calendar` in `core/lifecycle.py`:

```python
async def sync_group_calendar(group_id: int) -> dict:
    """
    Sync calendar events for all future meetings of a group.

    Handles both creation and updates in one unified function:
    1. Fetches all future meetings from DB
    2. Batch CREATES events for meetings without calendar IDs
    3. Batch GETS existing events to check attendees
    4. Batch PATCHES events with attendee changes

    Returns dict with counts.
    """
    from .database import get_connection, get_transaction
    from .tables import meetings, groups
    from .calendar.client import batch_create_events, batch_get_events, batch_patch_events
    from datetime import datetime, timezone
    from sqlalchemy import select, update

    async with get_connection() as conn:
        now = datetime.now(timezone.utc)

        # Get all future meetings with group info
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.google_calendar_event_id,
                meetings.c.scheduled_at,
                groups.c.group_name,
            )
            .join(groups, meetings.c.group_id == groups.c.group_id)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
        )
        meeting_rows = list(meetings_result.mappings())

        if not meeting_rows:
            return {"meetings": 0, "created": 0, "patched": 0, "unchanged": 0, "failed": 0}

        # Get expected attendees
        expected_emails = await _get_group_member_emails(conn, group_id)

    # Split meetings by whether they have calendar events
    meetings_to_create = [m for m in meeting_rows if not m["google_calendar_event_id"]]
    meetings_with_events = [m for m in meeting_rows if m["google_calendar_event_id"]]

    created = 0
    patched = 0
    failed = 0

    # --- BATCH CREATE for meetings without calendar events ---
    if meetings_to_create:
        create_data = [
            {
                "meeting_id": m["meeting_id"],
                "title": f"{m['group_name']} - Meeting",
                "description": "Study group meeting",
                "start": m["scheduled_at"],
                "duration_minutes": 60,
                "attendees": list(expected_emails),
            }
            for m in meetings_to_create
        ]

        create_results = batch_create_events(create_data)
        if create_results:
            # Save new event IDs to database
            async with get_transaction() as conn:
                for meeting_id, result in create_results.items():
                    if result["success"]:
                        await conn.execute(
                            update(meetings)
                            .where(meetings.c.meeting_id == meeting_id)
                            .values(google_calendar_event_id=result["event_id"])
                        )
                        created += 1
                    else:
                        failed += 1
                        logger.error(f"Failed to create event for meeting {meeting_id}: {result['error']}")

    # --- BATCH GET + PATCH for existing events ---
    if meetings_with_events:
        event_ids = [m["google_calendar_event_id"] for m in meetings_with_events]

        # Batch fetch current attendees
        events = batch_get_events(event_ids)
        if events is None:
            return {
                "meetings": len(meeting_rows),
                "created": created,
                "patched": 0,
                "unchanged": 0,
                "failed": failed,
                "error": "calendar_unavailable",
            }

        # Calculate which events need updates
        updates_to_make = []
        for event_id in event_ids:
            if event_id not in events:
                failed += 1
                continue

            event = events[event_id]
            current_emails = {
                a.get("email", "").lower()
                for a in event.get("attendees", [])
                if a.get("email")
            }

            to_add = expected_emails - current_emails
            to_remove = current_emails - expected_emails

            if to_add or to_remove:
                new_attendees = [{"email": email} for email in (current_emails | to_add) - to_remove]
                updates_to_make.append({
                    "event_id": event_id,
                    "body": {"attendees": new_attendees},
                    "send_updates": "all" if to_add else "none",
                })

        # Batch patch
        if updates_to_make:
            patch_results = batch_patch_events(updates_to_make)
            if patch_results:
                for event_id, result in patch_results.items():
                    if result["success"]:
                        patched += 1
                    else:
                        failed += 1

    unchanged = len(meeting_rows) - created - patched - failed

    return {
        "meetings": len(meeting_rows),
        "created": created,
        "patched": patched,
        "unchanged": unchanged,
        "failed": failed,
    }


async def _get_group_member_emails(conn, group_id: int) -> set[str]:
    """Get email addresses of all active group members, normalized to lowercase."""
    from .tables import groups_users, users
    from .enums import GroupUserStatus
    from sqlalchemy import select

    result = await conn.execute(
        select(users.c.email)
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .where(users.c.email.isnot(None))
    )
    return {row["email"].lower() for row in result.mappings()}
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_lifecycle_calendar.py -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "refactor(calendar): unified sync_group_calendar with batch create/get/patch"
```

---

## Task 5: Remove old sync_meeting_calendar function

**Files:**
- Modify: `core/lifecycle.py` - remove `sync_meeting_calendar`
- Modify: `core/__init__.py` - remove from exports

**Step 1: Search for usages**

Run: `grep -r "sync_meeting_calendar" --include="*.py" .`

**Step 2: Update any callers to use sync_group_calendar**

If there are callers that sync a single meeting, they should call `sync_group_calendar(group_id)` instead - it handles all meetings for the group efficiently.

**Step 3: Remove the function**

Delete `sync_meeting_calendar` from `core/lifecycle.py`.

**Step 4: Update exports**

Remove `sync_meeting_calendar` from `core/__init__.py` exports.

**Step 5: Run tests**

Run: `pytest core/tests/ -v`
Expected: PASS (after updating/removing tests that referenced the old function)

**Step 6: Commit**

```bash
jj describe -m "refactor(calendar): remove sync_meeting_calendar, use sync_group_calendar"
```

---

## Task 6: Manual integration test

**Step 1: Start dev server**

```bash
python main.py --dev > /tmp/server.log 2>&1 &
```

**Step 2: Test group switching**

1. Go to http://localhost:3000/group
2. Switch groups multiple times
3. Check logs: `cat /tmp/server.log | grep -i calendar`

**Expected:** Batch operations, no quota errors.

**Step 3: Test with scheduler (if possible)**

If you can trigger cohort scheduling with test groups, verify batch creation works for multiple meetings.

---

## Summary

| Task | What | Batches |
|------|------|---------|
| 1 | `batch_get_events` | GET multiple events |
| 2 | `batch_create_events` | INSERT multiple events |
| 3 | `batch_patch_events` | PATCH multiple events |
| 4 | Unified `sync_group_calendar` | Uses all three helpers |
| 5 | Remove `sync_meeting_calendar` | Clean up old code |
| 6 | Integration test | Verify end-to-end |

**API call reduction:**
- Cohort scheduling (100 groups × 8 meetings): 800 calls → ~8 batch calls
- Group switching (8 meetings): 16 calls → 2 batch calls
