# Zoom Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Discord voice channels with Zoom meetings — create Zoom meetings via API during group realization, include join URLs in calendar events and notifications.

**Architecture:** Licensed Zoom hosts are queried on demand from the Zoom API (`GET /users`), not stored in a local table. New columns on `meetings` track Zoom data per session. New `sync_group_zoom()` step in the sync pipeline. Google Calendar events patched with Zoom conferenceData. Notification templates updated with join links. Discord voice channels and scheduled events removed from the pipeline.

**Tech Stack:** Zoom REST API (S2S OAuth via `core/zoom/`), SQLAlchemy + Alembic, Google Calendar API, existing notification system.

**Spec:** `docs/superpowers/specs/2026-04-03-zoom-migration-design.md`

---

### Task 1: Database Migration — Add Zoom columns, drop Discord meeting columns

**Files:**
- Modify: `core/tables.py:233-256` (meetings table) and `core/tables.py:137-166` (groups table)
- Create: `alembic/versions/XXXX_zoom_migration.py` (auto-generated, then reviewed)

- [ ] **Step 1: Update meetings table in core/tables.py**

Add three Zoom columns and remove the two Discord meeting columns. The meetings table should become:

```python
meetings = Table(
    "meetings",
    metadata,
    Column("meeting_id", Integer, primary_key=True, autoincrement=True),
    Column("group_id", Integer, ForeignKey("groups.group_id", ondelete="CASCADE")),
    Column("cohort_id", Integer, ForeignKey("cohorts.cohort_id", ondelete="CASCADE")),
    Column("scheduled_at", TIMESTAMP(timezone=True), nullable=False),
    Column("meeting_number", Integer),
    Column("zoom_meeting_id", BigInteger),
    Column("zoom_join_url", Text),
    Column("zoom_host_email", Text),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_meetings_group_id", "group_id"),
    Index("idx_meetings_cohort_id", "cohort_id"),
    Index("idx_meetings_scheduled_at", "scheduled_at"),
)
```

Also remove `discord_voice_channel_id` from the `groups` table definition.

Add `BigInteger` to the import from `sqlalchemy` at the top of the file if not already there.

- [ ] **Step 2: Auto-generate the Alembic migration**

Run:
```bash
.venv/bin/alembic revision --autogenerate -m "add zoom columns, drop discord meeting columns"
```

- [ ] **Step 3: Review and clean up the generated migration**

Open the generated file in `alembic/versions/`. Verify it contains:
1. `ALTER TABLE meetings ADD COLUMN zoom_meeting_id BIGINT`
2. `ALTER TABLE meetings ADD COLUMN zoom_join_url TEXT`
3. `ALTER TABLE meetings ADD COLUMN zoom_host_email TEXT`
4. `ALTER TABLE meetings DROP COLUMN discord_event_id`
5. `ALTER TABLE meetings DROP COLUMN discord_voice_channel_id`
6. `ALTER TABLE groups DROP COLUMN discord_voice_channel_id`
7. Correct `downgrade()` that re-adds dropped columns and drops new ones

- [ ] **Step 4: Run the migration**

```bash
.venv/bin/alembic upgrade head
```

Expected: Migration applies cleanly with no errors.

- [ ] **Step 5: Verify the schema**

```bash
.venv/bin/python -c "
from core.database import get_sync_engine
from sqlalchemy import inspect
engine = get_sync_engine()
insp = inspect(engine)
meeting_cols = [c['name'] for c in insp.get_columns('meetings')]
group_cols = [c['name'] for c in insp.get_columns('groups')]
for c in ('zoom_meeting_id', 'zoom_join_url', 'zoom_host_email'):
    assert c in meeting_cols, f'{c} missing from meetings'
for c in ('discord_event_id', 'discord_voice_channel_id'):
    assert c not in meeting_cols, f'{c} should be dropped from meetings'
assert 'discord_voice_channel_id' not in group_cols, 'should be dropped from groups'
print('Schema OK')
"
```

- [ ] **Step 6: Commit**

```bash
jj describe -m "feat: add zoom columns, drop discord meeting columns"
jj new
```

---

### Task 2: Host Assignment via Zoom API

**Files:**
- Create: `core/zoom/hosts.py`
- Modify: `core/zoom/__init__.py`
- Create: `core/zoom/tests/__init__.py`
- Create: `core/zoom/tests/test_hosts.py`

- [ ] **Step 1: Write the failing test**

Create `core/zoom/tests/__init__.py` (empty file).

Create `core/zoom/tests/test_hosts.py`:

```python
"""Tests for Zoom host assignment."""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from core.zoom.hosts import find_available_host


@pytest.fixture
def mock_zoom_users():
    """Two licensed Zoom users returned by the API."""
    return {
        "users": [
            {"id": "u1", "email": "host1@lensacademy.org", "type": 2, "status": "active"},
            {"id": "u2", "email": "host2@lensacademy.org", "type": 2, "status": "active"},
        ]
    }


@pytest.mark.asyncio
async def test_find_available_host_no_conflicts(mock_zoom_users):
    """With no existing meetings, any host is available."""
    with patch("core.zoom.hosts.zoom_request", new_callable=AsyncMock, return_value=mock_zoom_users):
        with patch("core.zoom.hosts._get_busy_host_emails", new_callable=AsyncMock, return_value=set()):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is not None
    assert host["email"] in ("host1@lensacademy.org", "host2@lensacademy.org")


@pytest.mark.asyncio
async def test_find_available_host_with_conflict(mock_zoom_users):
    """When one host has a conflicting meeting, assign the other."""
    with patch("core.zoom.hosts.zoom_request", new_callable=AsyncMock, return_value=mock_zoom_users):
        with patch("core.zoom.hosts._get_busy_host_emails", new_callable=AsyncMock, return_value={"host1@lensacademy.org"}):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is not None
    assert host["email"] == "host2@lensacademy.org"


@pytest.mark.asyncio
async def test_find_available_host_all_busy(mock_zoom_users):
    """When all hosts have conflicts, return None."""
    with patch("core.zoom.hosts.zoom_request", new_callable=AsyncMock, return_value=mock_zoom_users):
        with patch("core.zoom.hosts._get_busy_host_emails", new_callable=AsyncMock, return_value={"host1@lensacademy.org", "host2@lensacademy.org"}):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is None


@pytest.mark.asyncio
async def test_find_available_host_filters_unlicensed():
    """Only licensed (type=2) and active users are considered."""
    users_with_basic = {
        "users": [
            {"id": "u1", "email": "basic@test.com", "type": 1, "status": "active"},
            {"id": "u2", "email": "licensed@test.com", "type": 2, "status": "active"},
            {"id": "u3", "email": "inactive@test.com", "type": 2, "status": "inactive"},
        ]
    }
    with patch("core.zoom.hosts.zoom_request", new_callable=AsyncMock, return_value=users_with_basic):
        with patch("core.zoom.hosts._get_busy_host_emails", new_callable=AsyncMock, return_value=set()):
            host = await find_available_host(
                start_time=datetime(2026, 5, 1, 15, 0, tzinfo=timezone.utc),
                duration_minutes=60,
            )
    assert host is not None
    assert host["email"] == "licensed@test.com"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/pytest core/zoom/tests/test_hosts.py -v
```

Expected: ImportError — `find_available_host` doesn't exist yet.

- [ ] **Step 3: Implement find_available_host**

Create `core/zoom/hosts.py`:

```python
"""Zoom host assignment — find available licensed hosts via the Zoom API."""

import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from core.database import get_connection
from core.tables import meetings
from core.zoom.client import zoom_request

logger = logging.getLogger(__name__)


async def _get_licensed_hosts() -> list[dict]:
    """
    Fetch all licensed, active Zoom users from the account.

    Returns list of dicts with "id", "email", "type", "status".
    Only includes licensed (type=2) and active users.
    """
    result = await zoom_request("GET", "/users", params={"page_size": 100, "status": "active"})
    if not result:
        return []
    return [
        {"id": u["id"], "email": u["email"]}
        for u in result.get("users", [])
        if u.get("type") == 2 and u.get("status") == "active"
    ]


async def _get_busy_host_emails(
    start_time: datetime,
    duration_minutes: int,
) -> set[str]:
    """
    Find host emails that have an overlapping meeting in our database.

    A meeting overlaps if it starts before our end_time AND ends after our start_time.
    """
    end_time = start_time + timedelta(minutes=duration_minutes)

    async with get_connection() as conn:
        result = await conn.execute(
            select(meetings.c.zoom_host_email)
            .where(meetings.c.zoom_host_email.isnot(None))
            .where(meetings.c.scheduled_at < end_time)
            .where(
                meetings.c.scheduled_at + timedelta(minutes=duration_minutes) > start_time
            )
            .distinct()
        )
        return {row[0] for row in result.all()}


async def find_available_host(
    start_time: datetime,
    duration_minutes: int = 60,
) -> dict | None:
    """
    Find a licensed Zoom host with no conflicting meetings at the given time.

    Queries the Zoom API for all licensed users, then checks our meetings
    table for time conflicts. Returns the first available host.

    Args:
        start_time: Meeting start time (timezone-aware).
        duration_minutes: Meeting duration in minutes.

    Returns:
        Dict with "id" (Zoom user ID), "email", or None if all hosts are busy.
    """
    hosts = await _get_licensed_hosts()
    if not hosts:
        logger.warning("No licensed Zoom hosts found on the account")
        return None

    busy_emails = await _get_busy_host_emails(start_time, duration_minutes)

    for host in hosts:
        if host["email"] not in busy_emails:
            return host

    logger.warning(
        f"All {len(hosts)} Zoom hosts are busy at {start_time} "
        f"(busy: {busy_emails})"
    )
    return None
```

- [ ] **Step 4: Update core/zoom/__init__.py**

```python
"""Zoom API integration for meeting scheduling."""

from .client import is_zoom_configured, zoom_request
from .hosts import find_available_host
from .meetings import create_meeting, update_meeting, delete_meeting, get_meeting

__all__ = [
    "is_zoom_configured",
    "zoom_request",
    "find_available_host",
    "create_meeting",
    "update_meeting",
    "delete_meeting",
    "get_meeting",
]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
.venv/bin/pytest core/zoom/tests/test_hosts.py -v
```

Expected: All 4 tests pass.

- [ ] **Step 6: Commit**

```bash
jj describe -m "feat: add Zoom host assignment via API lookup"
jj new
```

---

### Task 3: sync_group_zoom() — Create Zoom meetings during realize

**Files:**
- Modify: `core/sync.py` — add `sync_group_zoom()` function and wire into `sync_group()`

- [ ] **Step 1: Add sync_group_zoom() to core/sync.py**

Add import at top of `core/sync.py`:

```python
from core.zoom.hosts import find_available_host
from core.zoom.meetings import create_meeting as zoom_create_meeting, get_meeting as zoom_get_meeting
from core.zoom.client import is_zoom_configured
```

Add the function (place it near the other `sync_group_*` functions, before `sync_group()`):

```python
async def sync_group_zoom(group_id: int) -> dict:
    """
    Ensure every future meeting for a group has a Zoom meeting.

    For each meeting that lacks a zoom_meeting_id:
    1. Find an available host from the Zoom account
    2. Create a standalone Zoom meeting via the API
    3. Store the Zoom meeting ID, join URL, and host email

    Returns:
        {"created": int, "existed": int, "skipped": int, "failed": int, "errors": list}
    """
    if not is_zoom_configured():
        return {"skipped": "zoom_not_configured"}

    results = {"created": 0, "existed": 0, "skipped": 0, "failed": 0, "errors": []}

    async with get_connection() as conn:
        # Get group info
        group_row = await conn.execute(
            select(groups).where(groups.c.group_id == group_id)
        )
        group = group_row.mappings().first()
        if not group:
            return {"error": "group_not_found"}

        # Get future meetings without Zoom
        now = datetime.now(tz=timezone.utc)
        mtg_rows = await conn.execute(
            select(meetings)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
            .where(meetings.c.zoom_meeting_id.is_(None))
            .order_by(meetings.c.scheduled_at)
        )
        future_meetings = mtg_rows.mappings().all()

    for mtg in future_meetings:
        host = await find_available_host(
            start_time=mtg["scheduled_at"],
            duration_minutes=60,
        )
        if host is None:
            results["failed"] += 1
            results["errors"].append(
                f"Meeting {mtg['meeting_id']} ({mtg['scheduled_at']}): no available host"
            )
            continue

        try:
            topic = f"{group['group_name']} - Week {mtg['meeting_number']}"
            zoom_data = await zoom_create_meeting(
                host_email=host["email"],
                topic=topic,
                start_time=mtg["scheduled_at"].isoformat(),
                duration_minutes=60,
            )
            if zoom_data is None:
                results["skipped"] += 1
                continue

            async with get_transaction() as conn:
                await conn.execute(
                    meetings.update()
                    .where(meetings.c.meeting_id == mtg["meeting_id"])
                    .values(
                        zoom_meeting_id=zoom_data["id"],
                        zoom_join_url=zoom_data["join_url"],
                        zoom_host_email=host["email"],
                    )
                )
            results["created"] += 1
        except Exception as e:
            logger.error(f"Failed to create Zoom meeting for meeting {mtg['meeting_id']}: {e}")
            sentry_sdk.capture_exception(e)
            results["failed"] += 1
            results["errors"].append(f"Meeting {mtg['meeting_id']}: {e}")

    # Count meetings that already had Zoom
    async with get_connection() as conn:
        existing = await conn.execute(
            select(meetings)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
            .where(meetings.c.zoom_meeting_id.isnot(None))
        )
        results["existed"] = len(existing.all())

    return results
```

- [ ] **Step 2: Wire sync_group_zoom into sync_group()**

In the `sync_group()` function, add the Zoom sync step after Discord permissions and before calendar sync. Find the line (approximately):

```python
results["calendar"] = await sync_group_calendar(group_id)
```

Add before it:

```python
        # Zoom meetings
        if allow_create:
            results["zoom"] = await sync_group_zoom(group_id)
```

Also add `from datetime import timezone` to the imports at the top of `sync.py` if not already present.

- [ ] **Step 3: Test manually**

```bash
.venv/bin/python -c "
import asyncio
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path('.env.local'))
from core.zoom.client import is_zoom_configured
print('Zoom configured:', is_zoom_configured())
from core.sync import sync_group_zoom
print('sync_group_zoom imported OK')
"
```

- [ ] **Step 4: Commit**

```bash
jj describe -m "feat: add sync_group_zoom to create Zoom meetings during realize"
jj new
```

---

### Task 4: Add Zoom URL to Google Calendar events

**Files:**
- Modify: `core/calendar/events.py:72-132` — add `conference_url` parameter to `create_recurring_event()`
- Modify: `core/sync.py` — pass Zoom URLs when syncing calendar

- [ ] **Step 1: Add conference_url parameter to create_recurring_event()**

In `core/calendar/events.py`, update `create_recurring_event()` signature to accept an optional conference URL:

```python
async def create_recurring_event(
    title: str,
    description: str,
    first_meeting: datetime,
    duration_minutes: int,
    num_occurrences: int,
    attendee_emails: list[str],
    conference_url: str | None = None,
) -> str | None:
```

In the event body dict (around line 103), add conference data if a URL is provided. After the `"reminders"` key, add:

```python
if conference_url:
    event["conferenceData"] = {
        "entryPoints": [
            {
                "entryPointType": "video",
                "uri": conference_url,
                "label": "Join Zoom Meeting",
            }
        ],
        "conferenceSolution": {
            "name": "Zoom",
            "key": {"type": "addOn"},
        },
    }
```

Also update the `events().insert()` call to include `conferenceDataVersion=1`:

Find the line that does `service.events().insert(calendarId=calendar_id, body=event, sendUpdates="all")` and change to:

```python
service.events().insert(
    calendarId=calendar_id,
    body=event,
    sendUpdates="all",
    conferenceDataVersion=1,
)
```

- [ ] **Step 2: Patch individual calendar instances with per-meeting Zoom URLs**

Since we use standalone Zoom meetings (different URL per week), we need to patch each calendar instance with its specific Zoom URL after creating the recurring event.

In `core/sync.py`, in `sync_group_calendar()`, after the recurring event is created/verified and attendees are synced, add a step to patch Zoom URLs onto individual instances.

Find the end of `sync_group_calendar()` (before the `return results` line) and add:

```python
    # Patch Zoom join URLs onto individual calendar instances
    if event_id:
        try:
            await _patch_calendar_zoom_urls(group_id, event_id)
        except Exception as e:
            logger.error(f"Failed to patch Zoom URLs for group {group_id}: {e}")
            results["zoom_calendar_patch_error"] = str(e)
```

Add this helper function near `sync_group_calendar()`:

```python
async def _patch_calendar_zoom_urls(group_id: int, recurring_event_id: str) -> None:
    """Patch each calendar instance with its meeting's Zoom join URL."""
    from core.calendar.events import get_event_instances

    async with get_connection() as conn:
        mtg_rows = await conn.execute(
            select(meetings)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.zoom_join_url.isnot(None))
            .order_by(meetings.c.scheduled_at)
        )
        zoom_meetings = {
            mtg["scheduled_at"]: mtg["zoom_join_url"]
            for mtg in mtg_rows.mappings().all()
        }

    if not zoom_meetings:
        return

    instances = await asyncio.to_thread(get_event_instances, recurring_event_id)
    if not instances:
        return

    patches = []
    for instance in instances:
        instance_start_str = instance.get("start", {}).get("dateTime", "")
        if not instance_start_str:
            continue
        instance_start = datetime.fromisoformat(instance_start_str)
        zoom_url = zoom_meetings.get(instance_start)
        if not zoom_url:
            continue

        # Skip if already has this conference URL
        existing = instance.get("conferenceData", {}).get("entryPoints", [])
        if any(ep.get("uri") == zoom_url for ep in existing):
            continue

        patches.append({
            "event_id": instance["id"],
            "body": {
                "conferenceData": {
                    "entryPoints": [
                        {
                            "entryPointType": "video",
                            "uri": zoom_url,
                            "label": "Join Zoom Meeting",
                        }
                    ],
                    "conferenceSolution": {
                        "name": "Zoom",
                        "key": {"type": "addOn"},
                    },
                }
            },
            "send_updates": "none",
        })

    if patches:
        await asyncio.to_thread(batch_patch_events, patches)
```

- [ ] **Step 3: Commit**

```bash
jj describe -m "feat: add Zoom URLs to Google Calendar events as conferenceData"
jj new
```

---

### Task 5: Update notification templates with Zoom join URL

**Files:**
- Modify: `core/notifications/messages.yaml` — add `{zoom_join_url}` to meeting reminder templates
- Modify: `core/notifications/context.py:102-197` — add `zoom_join_url` to reminder context
- Modify: `core/notifications/actions.py:44-80,83-120` — add `zoom_join_url` param to group assignment notifications

- [ ] **Step 1: Add zoom_join_url to build_reminder_context()**

In `core/notifications/context.py`, in the `build_reminder_context()` function, add the Zoom URL to the returned dict. Find the `return` statement (around line 182) and add `zoom_join_url`:

```python
    return {
        "group_name": group["group_name"],
        "meeting_time_utc": scheduled_at.isoformat(),
        "meeting_date_utc": scheduled_at.isoformat(),
        "meeting_time": scheduled_at.strftime("%A at %H:%M UTC"),
        "meeting_date": scheduled_at.strftime("%A, %B %d"),
        "module_url": module_url,
        "discord_channel_url": build_discord_channel_url(
            channel_id=group["discord_text_channel_id"]
        ),
        "zoom_join_url": meeting.get("zoom_join_url", ""),
        "module_list": module_list,
        "modules_remaining": modules_remaining,
        "cta_text": cta_text,
    }
```

- [ ] **Step 2: Add zoom_join_url to notify_group_assigned() and notify_member_joined()**

In `core/notifications/actions.py`, update `notify_group_assigned()` to accept and pass `zoom_join_url`:

Add parameter to signature:
```python
async def notify_group_assigned(
    user_id: int,
    group_name: str,
    meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    zoom_join_url: str = "",
    reference_type: NotificationReferenceType | None = None,
    reference_id: int | None = None,
) -> dict:
```

Add to context dict:
```python
        context={
            "group_name": group_name,
            "meeting_time": meeting_time_utc,
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(
                channel_id=discord_channel_id
            ),
            "zoom_join_url": zoom_join_url,
        },
```

Do the same for `notify_member_joined()` — add `zoom_join_url: str = ""` parameter and include it in the context dict.

- [ ] **Step 3: Update messages.yaml templates**

Update `meeting_reminder_24h`:

```yaml
meeting_reminder_24h:
  email_subject: "Reminder: {group_name} meeting tomorrow"
  email_body: |
    Hi {name},

    Your study group meets tomorrow at {meeting_time}. You have {modules_remaining} sections left to complete.

    Haven't finished the module yet? Try to make some progress today — late submissions are still accepted.

    [{cta_text}]({module_url})

    [Join Zoom Meeting]({zoom_join_url})

    Best,
    Luc
    Founder of Lens Academy
  discord_channel: |
    Reminder: Meeting tomorrow at {meeting_time}!

    Haven't finished the module yet? Late submissions are still accepted — try to make some progress today!

    **Join Zoom:** {zoom_join_url}
```

Update `meeting_reminder_1h`:

```yaml
meeting_reminder_1h:
  email_subject: "Reminder: {group_name} meeting in 1 hour"
  email_body: |
    Hi {name},

    Your study group meets in 1 hour at {meeting_time}.

    Even if you haven't finished the module, join the discussion — you'll still get a lot out of it. You can submit late afterwards.

    [Join Zoom Meeting]({zoom_join_url})

    See you there!

    Best,
    Luc
    Founder of Lens Academy
  discord_channel: |
    Meeting starting in 1 hour! Even if you haven't finished the module, join the discussion — late submissions are accepted.

    **Join Zoom:** {zoom_join_url}
```

Update `group_assigned`:

```yaml
group_assigned:
  email_subject: "You've been assigned to a group: {group_name}"
  email_body: |
    Hi {name},

    Great news! You've been matched with a study group.

    Group: {group_name}
    Meeting time: {meeting_time}
    Your groupmates: {member_names}

    Meetings are held on Zoom. You'll receive the join link in your calendar invite and in reminders before each meeting.

    [Chat with your group on Discord]({discord_channel_url})

    A calendar invite is attached.

    Best,
    Luc
    Founder of Lens Academy
  discord: |
    You've been assigned to **{group_name}**!
    Meeting time: {meeting_time}
    Meetings are on Zoom — check your email for the calendar invite with join link.
  calendar_title: "Lens Academy Study Group: {group_name}"
  calendar_description: |
    Weekly study group meeting.
    Group members: {member_names}
```

Update `member_joined`:

```yaml
member_joined:
  email_subject: "Welcome to {group_name}!"
  email_body: |
    Hi {name},

    You've joined {group_name}!

    Meeting time: {meeting_time}
    Your groupmates: {member_names}

    Meetings are held on Zoom. You'll receive the join link in your calendar invite and in reminders before each meeting.

    [Chat with your group on Discord]({discord_channel_url})

    A calendar invite has been sent to your email.

    Best,
    Luc
    Founder of Lens Academy
  discord_channel: |
    Welcome {member_mention}! 👋 They've joined the group.
```

- [ ] **Step 4: Update callers of notify_group_assigned and notify_member_joined**

Search for all callers of these functions in `core/sync.py` and elsewhere. Pass `zoom_join_url` from the group's first meeting's Zoom URL (or empty string if not yet created).

In `core/sync.py`, find the call to `notify_group_assigned()` in `_send_sync_notifications()` and add:

```python
zoom_join_url=first_meeting_zoom_url or "",
```

where `first_meeting_zoom_url` is fetched from the meetings table for the group. Add a query before the notification loop to get this:

```python
async with get_connection() as conn:
    first_zoom = await conn.execute(
        select(meetings.c.zoom_join_url)
        .where(meetings.c.group_id == group_id)
        .where(meetings.c.zoom_join_url.isnot(None))
        .order_by(meetings.c.scheduled_at)
        .limit(1)
    )
    first_zoom_row = first_zoom.first()
    zoom_join_url = first_zoom_row[0] if first_zoom_row else ""
```

Do the same for `notify_member_joined()` callers (check `core/group_joining.py` or wherever it's called from).

- [ ] **Step 5: Run existing notification tests to verify nothing broke**

```bash
.venv/bin/pytest core/notifications/tests/ -v
```

Expected: All existing tests pass (some may need `zoom_join_url` added to test context dicts).

- [ ] **Step 6: Fix any failing tests**

If tests fail because templates now reference `{zoom_join_url}` but test context dicts don't include it, add `"zoom_join_url": "https://zoom.us/j/123"` to the test context dicts.

- [ ] **Step 7: Commit**

```bash
jj describe -m "feat: add Zoom join URL to notifications and calendar events"
jj new
```

---

### Task 6: Remove Discord voice channels and scheduled events from pipeline + code cleanup

**Files:**
- Modify: `core/sync.py` — remove voice channel creation, Discord event creation, and all references to dropped columns
- Modify: `core/meetings.py` — remove `discord_voice_channel_id` and `discord_event_id` params/references
- Modify: `core/queries/meetings.py` — remove `discord_event_id` and `discord_voice_channel_id` params
- Modify: `core/queries/groups.py` — remove `discord_voice_channel_id` references
- Modify: `core/attendance.py` — remove `discord_voice_channel_id` reference
- Modify: `core/discord_outbound/events.py` — can be deleted or emptied (no longer used)
- Modify: test files — update all test fixtures/mocks that reference dropped columns

**This task must be done carefully.** The columns `discord_event_id`, `discord_voice_channel_id` (on meetings), and `discord_voice_channel_id` (on groups) were dropped in the Task 1 migration. All code referencing these columns must be updated.

- [ ] **Step 1: Clean up core/sync.py**

Remove or refactor all references to the dropped columns. Key changes:

1. **`_ensure_group_channels()`** — remove voice channel creation block (the part calling `create_voice_channel()`) and remove saving `discord_voice_channel_id` to the groups table. Keep text channel creation.

2. **`_ensure_meeting_discord_events()`** — delete the entire function. It creates Discord scheduled events and writes to `discord_event_id` which no longer exists.

3. **`sync_group()`** — remove the call to `_ensure_meeting_discord_events()`.

4. Remove all `select()` queries that reference `groups.c.discord_voice_channel_id` or `meetings.c.discord_event_id`. There are references at approximately lines 158, 212-224, 256, 676, 731, 825, 841, 866, 1099, 1206, 1225-1226.

5. Any place that reads `group["discord_voice_channel_id"]` or `meeting["discord_event_id"]` must be updated.

- [ ] **Step 2: Clean up core/meetings.py**

Remove `discord_voice_channel_id` parameter from `create_meetings_for_group()` (line 36) and from the `create_meeting_row()` call inside it. Remove `discord_event_id` references (lines 65-75).

- [ ] **Step 3: Clean up core/queries/meetings.py**

Remove `discord_event_id` and `discord_voice_channel_id` parameters from the `create_meeting_row()` function (lines 17-18, 33-34).

- [ ] **Step 4: Clean up core/queries/groups.py**

Remove `discord_voice_channel_id` from query results and test fixtures (lines 113, 175, 211, 232).

- [ ] **Step 5: Clean up core/attendance.py**

Remove the query filter on `meetings.c.discord_voice_channel_id` (line 47). This was used to look up meetings by voice channel — replace with an alternative lookup or remove the code path if it's only used for Discord voice attendance.

- [ ] **Step 6: Update test files**

Remove `discord_voice_channel_id` and `discord_event_id` from all test fixtures and mock data in:
- `core/tests/test_sync.py` (~20+ references)
- `core/tests/test_sync_guest_permissions.py`
- `core/tests/test_meetings.py`
- `discord_bot/tests/test_scheduling_queries.py`
- `discord_bot/tests/helpers.py`
- `discord_bot/tests/test_discord_e2e.py`

- [ ] **Step 7: Run full test suite**

```bash
.venv/bin/pytest --tb=short -q
```

Fix any remaining failures. There will likely be several — work through them methodically.

- [ ] **Step 8: Commit**

```bash
jj describe -m "feat: remove Discord voice channels and scheduled events from codebase"
jj new
```

---

### Task 7: Update reschedule_meeting() and postpone_meeting() for Zoom

**Files:**
- Modify: `core/meetings.py:106-228` — add Zoom meeting update/recreation logic

- [ ] **Step 1: Update reschedule_meeting()**

In `core/meetings.py`, update `reschedule_meeting()` to handle Zoom. After the existing calendar and reminder updates, add Zoom handling:

```python
    # Update Zoom meeting time if one exists
    if meeting.get("zoom_meeting_id"):
        from core.zoom.meetings import update_meeting as zoom_update_meeting
        from core.zoom.hosts import find_available_host

        # Check if current host is still available at new time
        current_host_email = meeting.get("zoom_host_email")
        host = await find_available_host(
            start_time=new_time,
            duration_minutes=60,
        )

        if host and host["email"] == current_host_email:
            # Same host available — just update the time
            await zoom_update_meeting(
                meeting_id=meeting["zoom_meeting_id"],
                start_time=new_time.isoformat(),
            )
        else:
            # Need a different host — delete and recreate
            from core.zoom.meetings import delete_meeting as zoom_delete_meeting
            from core.zoom.meetings import create_meeting as zoom_create_meeting

            await zoom_delete_meeting(meeting["zoom_meeting_id"])

            if host:
                zoom_data = await zoom_create_meeting(
                    host_email=host["email"],
                    topic=f"{group_name} - Week {meeting['meeting_number']}",
                    start_time=new_time.isoformat(),
                    duration_minutes=60,
                )
                if zoom_data:
                    async with get_transaction() as conn:
                        await conn.execute(
                            meetings_table.update()
                            .where(meetings_table.c.meeting_id == meeting_id)
                            .values(
                                zoom_meeting_id=zoom_data["id"],
                                zoom_join_url=zoom_data["join_url"],
                                zoom_host_email=host["email"],
                            )
                        )
```

You'll need to fetch the meeting row (including zoom fields) at the start of the function. Check what the current code fetches and extend the query to include `zoom_meeting_id`, `zoom_host_email`, `zoom_join_url`.

- [ ] **Step 2: Update postpone_meeting()**

In `postpone_meeting()`, after the existing steps (delete meeting, renumber, create new, update calendar), add Zoom handling:

When deleting the postponed meeting, also delete its Zoom meeting:
```python
    if meeting.get("zoom_meeting_id"):
        from core.zoom.meetings import delete_meeting as zoom_delete_meeting
        try:
            await zoom_delete_meeting(meeting["zoom_meeting_id"])
        except Exception as e:
            logger.warning(f"Failed to delete Zoom meeting {meeting['zoom_meeting_id']}: {e}")
```

When creating the replacement meeting at the end, create a Zoom meeting for it:
```python
    # Create Zoom meeting for the new replacement meeting
    from core.zoom.hosts import find_available_host
    from core.zoom.meetings import create_meeting as zoom_create_meeting

    host = await find_available_host(start_time=new_meeting_time, duration_minutes=60)
    if host:
        zoom_data = await zoom_create_meeting(
            host_email=host["email"],
            topic=f"{group_name} - Week {new_meeting_number}",
            start_time=new_meeting_time.isoformat(),
            duration_minutes=60,
        )
        if zoom_data:
            async with get_transaction() as conn:
                await conn.execute(
                    meetings_table.update()
                    .where(meetings_table.c.meeting_id == new_meeting_id)
                    .values(
                        zoom_meeting_id=zoom_data["id"],
                        zoom_join_url=zoom_data["join_url"],
                        zoom_host_email=host["email"],
                    )
                )
```

- [ ] **Step 3: Run tests**

```bash
.venv/bin/pytest core/tests/ -v -k "reschedule or postpone"
```

- [ ] **Step 4: Commit**

```bash
jj describe -m "feat: handle Zoom meetings in reschedule and postpone flows"
jj new
```

---

### Task 8: Linting, type checking, and final verification

**Files:**
- All modified files

- [ ] **Step 1: Run linting**

```bash
ruff check .
ruff format --check .
```

Fix any issues.

- [ ] **Step 2: Run full test suite**

```bash
.venv/bin/pytest --tb=short
```

Fix any failures.

- [ ] **Step 3: Run build check (frontend)**

```bash
cd web_frontend && npm run lint && npm run build
```

Should be unaffected but verify.

- [ ] **Step 4: Manual smoke test**

Start the server and verify:
1. Zoom client can get a token: `is_zoom_configured()` returns True
2. List users works: `zoom_request('GET', '/users')` returns the licensed hosts
3. Import chain is clean: `from core.zoom import create_meeting, find_available_host`

- [ ] **Step 5: Squash all changes into a clean commit chain**

Review the jj log and ensure commits are well-described. Squash any fixup changes into their parent commits if needed.

```bash
jj log
```
