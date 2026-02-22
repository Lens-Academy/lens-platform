# Guest Meeting Visits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users temporarily join another group's same-week meeting when they can't attend their own.

**Architecture:** Single `is_guest` boolean column on `attendances`. Guest attendance records drive Discord role sync (temporary role grant/revoke) and Google Calendar instance patching. Self-healing cleanup via periodic sync sweep.

**Tech Stack:** SQLAlchemy + Alembic (schema), FastAPI (API), Vike + React + Tailwind (frontend), APScheduler (cleanup), Google Calendar API (instance patching)

**Design doc:** `docs/plans/2026-02-20-guest-meeting-visits-design.md`

---

### Task 1: Schema — Add `is_guest` Column

**Files:**
- Modify: `core/tables.py:245-268` (attendances table definition)
- Create: `alembic/versions/xxx_add_is_guest_to_attendances.py` (migration)

**Step 1: Update SQLAlchemy table definition**

In `core/tables.py`, add the `is_guest` column to the `attendances` table, before the `created_at` column:

```python
    Column("is_guest", Boolean, server_default=text("false"), nullable=False),
```

Add `Boolean` and `text` to the imports from `sqlalchemy` at the top of the file if not already present.

**Step 2: Generate Alembic migration**

Run:
```bash
.venv/bin/alembic revision --autogenerate -m "add is_guest to attendances"
```

**Step 3: Review generated migration**

Open the generated file in `alembic/versions/`. Verify it contains:

```python
def upgrade():
    op.add_column('attendances',
        sa.Column('is_guest', sa.Boolean(), server_default=sa.text('false'), nullable=False))

def downgrade():
    op.drop_column('attendances', 'is_guest')
```

**Step 4: Run the migration**

Run:
```bash
.venv/bin/alembic upgrade head
```
Expected: Migration applies cleanly. All existing rows get `is_guest=false`.

**Step 5: Commit**

```
schema: add is_guest column to attendances
```

---

### Task 2: Protect Existing Facilitator Queries

Add `NOT is_guest` filters to 3 queries in `core/queries/facilitator.py` so guest attendance records don't pollute facilitator dashboard data.

**Files:**
- Modify: `core/queries/facilitator.py:104-116` (meetings_attended subquery)
- Modify: `core/queries/facilitator.py:297-303` (completion data attendance fetch)
- Modify: `core/queries/facilitator.py:208-223` (user meeting attendance)
- Create: `core/tests/test_facilitator_guest_filter.py`

**Step 1: Write failing tests**

Create `core/tests/test_facilitator_guest_filter.py`:

```python
"""Tests that facilitator queries exclude guest attendance records.

These tests verify that the actual SQL queries built by the facilitator
functions include is_guest filtering. We call each function with a mock
connection, capture the executed SQLAlchemy query objects, compile them
to SQL strings, and check for the is_guest filter.
"""

import pytest
from unittest.mock import AsyncMock, Mock
from sqlalchemy.dialects import postgresql

from core.queries.facilitator import (
    get_group_members_with_progress,
    get_group_completion_data,
    get_user_meeting_attendance,
)


def _make_mapping_result(rows):
    """Helper to create a mock result supporting .mappings() and iteration."""
    mock_result = Mock()
    mock_mappings = Mock()
    if rows:
        mock_mappings.first.return_value = rows[0]
        mock_mappings.all.return_value = rows
        mock_mappings.__iter__ = Mock(return_value=iter(rows))
    else:
        mock_mappings.first.return_value = None
        mock_mappings.all.return_value = []
        mock_mappings.__iter__ = Mock(return_value=iter([]))
    mock_result.mappings.return_value = mock_mappings
    mock_result.rowcount = len(rows)
    mock_result.__iter__ = Mock(return_value=iter(rows))
    return mock_result


def _compile_sql(query) -> str:
    """Compile a SQLAlchemy query to SQL string for inspection."""
    return str(query.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))


class TestGuestFiltering:
    """Verify facilitator queries include is_guest filter in compiled SQL."""

    @pytest.mark.asyncio
    async def test_meetings_attended_subquery_excludes_guests(self):
        """get_group_members_with_progress query should filter on is_guest."""
        conn = AsyncMock()
        conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        await get_group_members_with_progress(conn, group_id=1)

        # Capture the query that was executed and compile to SQL
        assert conn.execute.called, "Function should execute a query"
        query_arg = conn.execute.call_args[0][0]
        sql = _compile_sql(query_arg)
        assert "is_guest" in sql, (
            f"Query must filter on is_guest to exclude guest check-ins.\nSQL: {sql}"
        )

    @pytest.mark.asyncio
    async def test_completion_data_excludes_guests(self):
        """get_group_completion_data attendance query should filter on is_guest."""
        conn = AsyncMock()
        conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        try:
            await get_group_completion_data(conn, group_id=1, cohort_id=1)
        except Exception:
            pass  # May fail with empty mock data; we only need query capture

        # Find any executed query that touches attendances and verify is_guest
        found = False
        for call in conn.execute.call_args_list:
            if call.args:
                try:
                    sql = _compile_sql(call.args[0])
                    if "attendances" in sql and "is_guest" in sql:
                        found = True
                        break
                except Exception:
                    continue
        assert found, "Attendance query must filter on is_guest"

    @pytest.mark.asyncio
    async def test_user_meeting_attendance_excludes_guests(self):
        """get_user_meeting_attendance outerjoin should filter on is_guest."""
        conn = AsyncMock()
        conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        await get_user_meeting_attendance(conn, user_id=1, group_id=1)

        assert conn.execute.called, "Function should execute a query"
        query_arg = conn.execute.call_args[0][0]
        sql = _compile_sql(query_arg)
        assert "is_guest" in sql, (
            f"Outerjoin must filter on is_guest to exclude guest records.\nSQL: {sql}"
        )
```

**Step 2: Run tests to verify they fail**

Run:
```bash
.venv/bin/pytest core/tests/test_facilitator_guest_filter.py -v
```
Expected: All 3 tests FAIL (source code doesn't contain "is_guest" yet).

**Step 3: Fix query 1 — meetings_attended subquery (~line 104)**

In `core/queries/facilitator.py`, the `meetings_attended_subq` at line 104. Add `is_guest` filter to the WHERE clause. Change:

```python
        .where(
            (meetings.c.group_id == group_id)
            & (meetings.c.scheduled_at < func.now())
            & (attendances.c.user_id == groups_users.c.user_id)
            & (attendances.c.checked_in_at.isnot(None))
        )
```

to:

```python
        .where(
            (meetings.c.group_id == group_id)
            & (meetings.c.scheduled_at < func.now())
            & (attendances.c.user_id == groups_users.c.user_id)
            & (attendances.c.checked_in_at.isnot(None))
            & (attendances.c.is_guest.is_(False))
        )
```

**Step 4: Fix query 2 — completion data (~line 297)**

The attendance fetch at line 297. Add filter. Change:

```python
        att_result = await conn.execute(
            select(
                attendances.c.user_id,
                attendances.c.meeting_id,
                attendances.c.checked_in_at,
                attendances.c.rsvp_status,
            ).where(attendances.c.meeting_id.in_([r.meeting_id for r in all_mtg_rows]))
        )
```

to:

```python
        att_result = await conn.execute(
            select(
                attendances.c.user_id,
                attendances.c.meeting_id,
                attendances.c.checked_in_at,
                attendances.c.rsvp_status,
            ).where(
                attendances.c.meeting_id.in_([r.meeting_id for r in all_mtg_rows])
                & (attendances.c.is_guest.is_(False))
            )
        )
```

**Step 5: Fix query 3 — user meeting attendance (~line 208)**

The outerjoin at line 217. Add `is_guest` filter to the join condition. Change:

```python
        .outerjoin(
            attendances,
            (meetings.c.meeting_id == attendances.c.meeting_id)
            & (attendances.c.user_id == user_id),
        )
```

to:

```python
        .outerjoin(
            attendances,
            (meetings.c.meeting_id == attendances.c.meeting_id)
            & (attendances.c.user_id == user_id)
            & (attendances.c.is_guest.is_(False)),
        )
```

**Step 6: Run tests to verify they pass**

Run:
```bash
.venv/bin/pytest core/tests/test_facilitator_guest_filter.py -v
```
Expected: All 3 PASS.

**Step 7: Run existing tests to verify no regressions**

Run:
```bash
.venv/bin/pytest core/tests/ -v
```
Expected: All existing tests still pass.

**Step 8: Add RSVP sync safety regression test**

Add to `core/tests/test_facilitator_guest_filter.py`:

```python
class TestRSVPSyncPreservesIsGuest:
    """Verify the RSVP sync upsert doesn't overwrite is_guest."""

    @pytest.mark.asyncio
    async def test_rsvp_upsert_does_not_touch_is_guest(self):
        """The ON CONFLICT SET clause in rsvp sync must not include is_guest."""
        from core.calendar.rsvp import sync_group_rsvps_from_recurring
        import inspect
        source = inspect.getsource(sync_group_rsvps_from_recurring)
        # The upsert's set_ dict should NOT contain is_guest.
        # We verify the conflict update only touches rsvp_status and rsvp_at.
        assert "is_guest" not in source, (
            "RSVP sync upsert must NOT touch is_guest column — "
            "it would overwrite guest records created by guest_visits"
        )
```

Run:
```bash
.venv/bin/pytest core/tests/test_facilitator_guest_filter.py::TestRSVPSyncPreservesIsGuest -v
```
Expected: PASS (the existing upsert already doesn't touch `is_guest`). This is a regression guard.

**Step 9: Commit**

```
fix: exclude guest attendance records from facilitator queries
```

---

### Task 3: Calendar — Add `patch_event_instance` Function

New function to modify attendees on a specific instance of a recurring Google Calendar event.

**Files:**
- Modify: `core/calendar/events.py` (add function)
- Modify: `core/calendar/__init__.py` (export)
- Create: `core/tests/test_calendar_patch_instance.py`

**Step 1: Write failing test**

Create `core/tests/test_calendar_patch_instance.py`:

```python
"""Tests for patching individual Google Calendar event instances."""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from core.calendar.events import patch_event_instance


class TestPatchEventInstance:

    @pytest.mark.asyncio
    async def test_patch_adds_attendee_to_instance(self):
        """Patching an instance should call events().patch() with correct args."""
        mock_service = MagicMock()
        mock_patch = MagicMock()
        mock_service.events.return_value.patch.return_value.execute.return_value = {
            "id": "instance123",
            "attendees": [
                {"email": "existing@test.com"},
                {"email": "guest@test.com"},
            ],
        }
        mock_service.events.return_value.patch.return_value = mock_patch
        mock_patch.execute.return_value = {"id": "instance123"}

        with patch("core.calendar.events.get_calendar_service", return_value=mock_service), \
             patch("core.calendar.events.get_calendar_email", return_value="cal@test.com"):
            result = await patch_event_instance(
                instance_event_id="instance123",
                attendees=[
                    {"email": "existing@test.com"},
                    {"email": "guest@test.com"},
                ],
            )

        assert result is True
        mock_service.events.return_value.patch.assert_called_once()
        call_kwargs = mock_service.events.return_value.patch.call_args
        assert call_kwargs[1]["eventId"] == "instance123"
        assert call_kwargs[1]["body"] == {
            "attendees": [
                {"email": "existing@test.com"},
                {"email": "guest@test.com"},
            ]
        }
        assert call_kwargs[1]["sendUpdates"] == "all"

    @pytest.mark.asyncio
    async def test_returns_false_when_calendar_not_configured(self):
        """Should return False if calendar service is not available."""
        with patch("core.calendar.events.get_calendar_service", return_value=None):
            result = await patch_event_instance("inst123", [])
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_on_api_error(self):
        """Should return False and not raise on API errors."""
        mock_service = MagicMock()
        mock_service.events.return_value.patch.return_value.execute.side_effect = Exception("API error")

        with patch("core.calendar.events.get_calendar_service", return_value=mock_service), \
             patch("core.calendar.events.get_calendar_email", return_value="cal@test.com"):
            result = await patch_event_instance("inst123", [{"email": "a@b.com"}])
        assert result is False
```

**Step 2: Run test to verify it fails**

Run:
```bash
.venv/bin/pytest core/tests/test_calendar_patch_instance.py -v
```
Expected: FAIL — `patch_event_instance` doesn't exist yet.

**Step 3: Implement `patch_event_instance`**

Add to `core/calendar/events.py` after the `update_meeting_event` function:

```python
async def patch_event_instance(
    instance_event_id: str,
    attendees: list[dict],
) -> bool:
    """
    Patch a specific instance of a recurring event (e.g., add/remove a guest).

    This modifies a single occurrence without affecting the recurring series.

    Args:
        instance_event_id: The instance-specific event ID (from get_event_instances)
        attendees: Full attendee list for this instance

    Returns:
        True if patched successfully
    """
    service = get_calendar_service()
    if not service:
        return False

    calendar_id = get_calendar_email()

    def _sync_patch():
        return (
            service.events()
            .patch(
                calendarId=calendar_id,
                eventId=instance_event_id,
                body={"attendees": attendees},
                sendUpdates="all",
            )
            .execute()
        )

    try:
        await asyncio.to_thread(_sync_patch)
        return True
    except Exception as e:
        logger.error(f"Failed to patch event instance {instance_event_id}: {e}")
        sentry_sdk.capture_exception(e)
        return False
```

**Step 4: Export from `core/calendar/__init__.py`**

Add `patch_event_instance` to the imports and `__all__`.

**Step 5: Run test to verify it passes**

Run:
```bash
.venv/bin/pytest core/tests/test_calendar_patch_instance.py -v
```
Expected: All 3 PASS.

**Step 6: Commit**

```
feat: add patch_event_instance for per-instance calendar modifications
```

---

### Task 4: Core — Guest Visits Business Logic

The main business logic module.

**Files:**
- Create: `core/guest_visits.py`
- Modify: `core/__init__.py` (exports)
- Create: `core/tests/test_guest_visits.py`

**Step 1: Write failing tests**

Create `core/tests/test_guest_visits.py`:

```python
"""Tests for guest meeting visit business logic."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock, patch, MagicMock

from core.guest_visits import (
    find_alternative_meetings,
    create_guest_visit,
    cancel_guest_visit,
    get_user_guest_visits,
)


def _make_mapping_result(rows):
    """Helper to create a mock result supporting .mappings()."""
    mock_result = Mock()
    mock_mappings = Mock()
    if rows:
        mock_mappings.first.return_value = rows[0]
        mock_mappings.all.return_value = rows
        mock_mappings.__iter__ = Mock(return_value=iter(rows))
    else:
        mock_mappings.first.return_value = None
        mock_mappings.all.return_value = []
        mock_mappings.__iter__ = Mock(return_value=iter([]))
    mock_result.mappings.return_value = mock_mappings
    mock_result.rowcount = len(rows)
    mock_result.first.return_value = rows[0] if rows else None
    return mock_result


class TestFindAlternativeMeetings:

    @pytest.mark.asyncio
    async def test_returns_meetings_from_other_groups_same_cohort(self):
        """Should find meetings with same meeting_number in same cohort."""
        now = datetime.now(timezone.utc)
        future = now + timedelta(days=3)

        # Mock: user's group is group 1, meeting is week 5
        home_meeting = {
            "meeting_id": 10,
            "group_id": 1,
            "cohort_id": 1,
            "meeting_number": 5,
        }
        # Mock: alternative meeting in group 2
        alt_meeting = {
            "meeting_id": 20,
            "group_id": 2,
            "cohort_id": 1,
            "meeting_number": 5,
            "scheduled_at": future,
            "group_name": "Beta",
            "facilitator_name": "Alice",
        }

        conn = AsyncMock()
        # First call: get home meeting info
        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([home_meeting]),     # home meeting lookup
            _make_mapping_result([{"group_id": 1}]),  # user's group
            _make_mapping_result([alt_meeting]),       # alternative meetings
        ])

        result = await find_alternative_meetings(conn, user_id=1, meeting_id=10)
        assert len(result) == 1
        assert result[0]["meeting_id"] == 20
        assert result[0]["group_name"] == "Beta"

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_alternatives(self):
        """Should return empty list when no other groups have same meeting number."""
        conn = AsyncMock()
        home_meeting = {
            "meeting_id": 10,
            "group_id": 1,
            "cohort_id": 1,
            "meeting_number": 5,
        }
        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([home_meeting]),
            _make_mapping_result([{"group_id": 1}]),
            _make_mapping_result([]),  # no alternatives
        ])

        result = await find_alternative_meetings(conn, user_id=1, meeting_id=10)
        assert result == []


class TestCreateGuestVisit:

    @pytest.mark.asyncio
    async def test_creates_guest_attendance_and_updates_home(self):
        """Should create is_guest=True attendance on host and not_attending on home."""
        conn = AsyncMock()
        # Mocks for validation queries
        home_meeting = {"meeting_id": 10, "group_id": 1, "cohort_id": 1, "meeting_number": 5, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=3)}
        host_meeting = {"meeting_id": 20, "group_id": 2, "cohort_id": 1, "meeting_number": 5, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=4)}
        user_group = {"group_id": 1}
        no_existing = _make_mapping_result([])

        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([home_meeting]),   # home meeting lookup
            _make_mapping_result([host_meeting]),   # host meeting lookup
            _make_mapping_result([user_group]),      # user's active group
            no_existing,                             # no existing guest visit
            Mock(rowcount=1),                        # insert guest attendance
            Mock(rowcount=1),                        # upsert home attendance
        ])

        result = await create_guest_visit(conn, user_id=1, home_meeting_id=10, host_meeting_id=20)
        assert result["success"] is True
        assert result["host_meeting_id"] == 20
        assert result["host_scheduled_at"] is not None

    @pytest.mark.asyncio
    async def test_rejects_own_group_visit(self):
        """Should reject when home and host meetings are in the same group."""
        conn = AsyncMock()
        home_meeting = {"meeting_id": 10, "group_id": 1, "cohort_id": 1, "meeting_number": 5, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=3)}
        host_meeting = {"meeting_id": 20, "group_id": 1, "cohort_id": 1, "meeting_number": 5, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=4)}

        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([home_meeting]),
            _make_mapping_result([host_meeting]),
        ])

        with pytest.raises(ValueError, match="own group"):
            await create_guest_visit(conn, user_id=1, home_meeting_id=10, host_meeting_id=20)

    @pytest.mark.asyncio
    async def test_rejects_cross_cohort_visit(self):
        """Should reject when home and host meetings are in different cohorts."""
        conn = AsyncMock()
        home_meeting = {"meeting_id": 10, "group_id": 1, "cohort_id": 1, "meeting_number": 5, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=3)}
        host_meeting = {"meeting_id": 20, "group_id": 2, "cohort_id": 2, "meeting_number": 5, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=4)}

        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([home_meeting]),
            _make_mapping_result([host_meeting]),
        ])

        with pytest.raises(ValueError, match="same cohort"):
            await create_guest_visit(conn, user_id=1, home_meeting_id=10, host_meeting_id=20)

    @pytest.mark.asyncio
    async def test_rejects_different_meeting_number(self):
        """Should reject when meeting numbers don't match."""
        conn = AsyncMock()
        home_meeting = {"meeting_id": 10, "group_id": 1, "cohort_id": 1, "meeting_number": 5, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=3)}
        host_meeting = {"meeting_id": 20, "group_id": 2, "cohort_id": 1, "meeting_number": 6, "scheduled_at": datetime.now(timezone.utc) + timedelta(days=4)}

        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([home_meeting]),
            _make_mapping_result([host_meeting]),
        ])

        with pytest.raises(ValueError, match="same meeting number"):
            await create_guest_visit(conn, user_id=1, home_meeting_id=10, host_meeting_id=20)


class TestCancelGuestVisit:

    @pytest.mark.asyncio
    async def test_deletes_guest_attendance_and_resets_home(self):
        """Should delete guest record and reset home meeting RSVP."""
        conn = AsyncMock()
        now = datetime.now(timezone.utc)
        future = now + timedelta(days=3)

        guest_att = {
            "attendance_id": 100,
            "meeting_id": 20,
            "user_id": 1,
            "is_guest": True,
        }
        host_meeting = {"meeting_id": 20, "group_id": 2, "scheduled_at": future, "meeting_number": 5}
        home_meeting = {"meeting_id": 10, "group_id": 1, "cohort_id": 1, "meeting_number": 5}

        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([guest_att]),     # find guest attendance
            _make_mapping_result([host_meeting]),  # host meeting (for time check)
            Mock(rowcount=1),                      # delete guest attendance
            _make_mapping_result([home_meeting]),  # find home meeting
            Mock(rowcount=1),                      # reset home RSVP
        ])

        result = await cancel_guest_visit(conn, user_id=1, host_meeting_id=20)
        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_rejects_cancel_after_meeting_started(self):
        """Should reject cancellation if the meeting is in the past."""
        conn = AsyncMock()
        past = datetime.now(timezone.utc) - timedelta(hours=1)

        guest_att = {"attendance_id": 100, "meeting_id": 20, "user_id": 1, "is_guest": True}
        host_meeting = {"meeting_id": 20, "group_id": 2, "cohort_id": 1, "scheduled_at": past, "meeting_number": 5}

        conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([guest_att]),
            _make_mapping_result([host_meeting]),
        ])

        with pytest.raises(ValueError, match="already started"):
            await cancel_guest_visit(conn, user_id=1, host_meeting_id=20)


class TestGetUserGuestVisits:

    @pytest.mark.asyncio
    async def test_returns_guest_visits_with_metadata(self):
        """Should return guest visit records with is_past and can_cancel flags."""
        conn = AsyncMock()
        now = datetime.now(timezone.utc)
        future = now + timedelta(days=3)

        visit = {
            "attendance_id": 100,
            "meeting_id": 20,
            "meeting_number": 5,
            "scheduled_at": future,
            "group_id": 2,
            "group_name": "Beta",
        }
        conn.execute = AsyncMock(return_value=_make_mapping_result([visit]))

        result = await get_user_guest_visits(conn, user_id=1)
        assert len(result) == 1
        assert result[0]["group_name"] == "Beta"
        assert result[0]["is_past"] is False
        assert result[0]["can_cancel"] is True

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_visits(self):
        """Should return empty list when user has no guest visits."""
        conn = AsyncMock()
        conn.execute = AsyncMock(return_value=_make_mapping_result([]))

        result = await get_user_guest_visits(conn, user_id=1)
        assert result == []
```

**Step 2: Run tests to verify they fail**

Run:
```bash
.venv/bin/pytest core/tests/test_guest_visits.py -v
```
Expected: FAIL — `core.guest_visits` module doesn't exist.

**Step 3: Implement `core/guest_visits.py`**

```python
"""Guest meeting visit business logic.

Allows users to temporarily attend another group's meeting
within the same cohort when they can't make their own.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select, delete, and_, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import meetings, attendances, groups, groups_users, users
from core.enums import GroupUserStatus, RSVPStatus

logger = logging.getLogger(__name__)


async def find_alternative_meetings(
    conn: AsyncConnection,
    user_id: int,
    meeting_id: int,
) -> list[dict]:
    """
    Find alternative meetings a user can attend as a guest.

    Returns meetings with the same meeting_number in the same cohort,
    from groups other than the user's own, that are in the future.

    Args:
        conn: Database connection
        user_id: The user looking for alternatives
        meeting_id: The meeting they can't attend (their home meeting)

    Returns:
        List of dicts with meeting_id, group_name, scheduled_at,
        facilitator_name, group_id
    """
    # Get the home meeting's details
    home_result = await conn.execute(
        select(
            meetings.c.meeting_id,
            meetings.c.group_id,
            meetings.c.cohort_id,
            meetings.c.meeting_number,
        ).where(meetings.c.meeting_id == meeting_id)
    )
    home = home_result.mappings().first()
    if not home:
        return []

    # Get user's current group
    user_group_result = await conn.execute(
        select(groups_users.c.group_id).where(
            and_(
                groups_users.c.user_id == user_id,
                groups_users.c.status == GroupUserStatus.active,
            )
        )
    )
    user_group = user_group_result.mappings().first()
    if not user_group:
        return []

    # Find facilitator name subquery
    facilitator_name = (
        select(
            func.coalesce(users.c.nickname, users.c.discord_username)
        )
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .where(
            and_(
                groups_users.c.group_id == meetings.c.group_id,
                groups_users.c.role == "facilitator",
                groups_users.c.status == GroupUserStatus.active,
            )
        )
        .limit(1)
        .correlate(meetings)
        .scalar_subquery()
        .label("facilitator_name")
    )

    # Find alternatives: same cohort, same meeting_number, different group, future
    now = datetime.now(timezone.utc)
    alt_result = await conn.execute(
        select(
            meetings.c.meeting_id,
            meetings.c.group_id,
            meetings.c.scheduled_at,
            meetings.c.meeting_number,
            groups.c.group_name,
            facilitator_name,
        )
        .join(groups, meetings.c.group_id == groups.c.group_id)
        .where(
            and_(
                meetings.c.cohort_id == home["cohort_id"],
                meetings.c.meeting_number == home["meeting_number"],
                meetings.c.group_id != user_group["group_id"],
                meetings.c.scheduled_at > now,
            )
        )
        .order_by(meetings.c.scheduled_at)
    )

    return [dict(row) for row in alt_result.mappings()]


async def create_guest_visit(
    conn: AsyncConnection,
    user_id: int,
    home_meeting_id: int,
    host_meeting_id: int,
) -> dict:
    """
    Create a guest visit: attendance on host meeting + RSVP decline on home meeting.

    Args:
        conn: Database connection (should be inside a transaction)
        user_id: The visiting user
        home_meeting_id: Meeting they're missing
        host_meeting_id: Meeting they're attending as guest

    Returns:
        {"success": True, "host_meeting_id": ..., "host_group_id": ...}

    Raises:
        ValueError: If validation fails (wrong cohort, wrong meeting number, etc.)
    """
    # Fetch both meetings
    home_result = await conn.execute(
        select(
            meetings.c.meeting_id,
            meetings.c.group_id,
            meetings.c.cohort_id,
            meetings.c.meeting_number,
            meetings.c.scheduled_at,
        ).where(meetings.c.meeting_id == home_meeting_id)
    )
    home = home_result.mappings().first()
    if not home:
        raise ValueError("Home meeting not found")

    host_result = await conn.execute(
        select(
            meetings.c.meeting_id,
            meetings.c.group_id,
            meetings.c.cohort_id,
            meetings.c.meeting_number,
            meetings.c.scheduled_at,
        ).where(meetings.c.meeting_id == host_meeting_id)
    )
    host = host_result.mappings().first()
    if not host:
        raise ValueError("Host meeting not found")

    # Validate not visiting own group
    if home["group_id"] == host["group_id"]:
        raise ValueError("Cannot visit your own group's meeting")

    # Validate same cohort
    if home["cohort_id"] != host["cohort_id"]:
        raise ValueError("Home and host meetings must be in the same cohort")

    # Validate same meeting number
    if home["meeting_number"] != host["meeting_number"]:
        raise ValueError("Home and host meetings must have the same meeting number")

    # Validate user belongs to home meeting's group
    user_group_result = await conn.execute(
        select(groups_users.c.group_id).where(
            and_(
                groups_users.c.user_id == user_id,
                groups_users.c.status == GroupUserStatus.active,
                groups_users.c.group_id == home["group_id"],
            )
        )
    )
    if not user_group_result.mappings().first():
        raise ValueError("User is not an active member of the home meeting's group")

    # Check no existing guest visit for this meeting number
    existing_result = await conn.execute(
        select(attendances.c.attendance_id)
        .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
        .where(
            and_(
                attendances.c.user_id == user_id,
                attendances.c.is_guest.is_(True),
                meetings.c.cohort_id == home["cohort_id"],
                meetings.c.meeting_number == home["meeting_number"],
            )
        )
    )
    if existing_result.mappings().first():
        raise ValueError("User already has a guest visit for this meeting number")

    # Create guest attendance on host meeting
    stmt = insert(attendances).values(
        meeting_id=host_meeting_id,
        user_id=user_id,
        rsvp_status=RSVPStatus.attending,
        is_guest=True,
    )
    stmt = stmt.on_conflict_do_nothing(constraint="attendances_meeting_user_unique")
    await conn.execute(stmt)

    # Update/create home meeting attendance as not_attending
    home_stmt = insert(attendances).values(
        meeting_id=home_meeting_id,
        user_id=user_id,
        rsvp_status=RSVPStatus.not_attending,
    )
    home_stmt = home_stmt.on_conflict_do_update(
        constraint="attendances_meeting_user_unique",
        set_={"rsvp_status": RSVPStatus.not_attending},
    )
    await conn.execute(home_stmt)

    return {
        "success": True,
        "host_meeting_id": host_meeting_id,
        "host_group_id": host["group_id"],
        "host_scheduled_at": host["scheduled_at"],
        "home_group_id": home["group_id"],
    }


async def cancel_guest_visit(
    conn: AsyncConnection,
    user_id: int,
    host_meeting_id: int,
) -> dict:
    """
    Cancel a guest visit before the meeting starts.

    Deletes the guest attendance and resets the home meeting RSVP.

    Args:
        conn: Database connection (should be inside a transaction)
        user_id: The visiting user
        host_meeting_id: The meeting they're no longer attending as guest

    Returns:
        {"success": True, "host_group_id": ..., "home_group_id": ...}

    Raises:
        ValueError: If guest visit not found or meeting already started
    """
    # Find the guest attendance
    guest_result = await conn.execute(
        select(
            attendances.c.attendance_id,
            attendances.c.meeting_id,
            attendances.c.user_id,
        ).where(
            and_(
                attendances.c.meeting_id == host_meeting_id,
                attendances.c.user_id == user_id,
                attendances.c.is_guest.is_(True),
            )
        )
    )
    guest_att = guest_result.mappings().first()
    if not guest_att:
        raise ValueError("Guest visit not found")

    # Get host meeting details (for time check, group_id, and cohort_id)
    host_result = await conn.execute(
        select(
            meetings.c.meeting_id,
            meetings.c.group_id,
            meetings.c.cohort_id,
            meetings.c.scheduled_at,
            meetings.c.meeting_number,
        ).where(meetings.c.meeting_id == host_meeting_id)
    )
    host = host_result.mappings().first()

    # Check meeting hasn't started
    now = datetime.now(timezone.utc)
    if host["scheduled_at"] <= now:
        raise ValueError("Cannot cancel: meeting has already started")

    # Delete the guest attendance
    await conn.execute(
        delete(attendances).where(
            and_(
                attendances.c.meeting_id == host_meeting_id,
                attendances.c.user_id == user_id,
                attendances.c.is_guest.is_(True),
            )
        )
    )

    # Find the home meeting (same cohort, same meeting_number, user's group)
    home_result = await conn.execute(
        select(meetings.c.meeting_id, meetings.c.group_id)
        .join(groups_users, meetings.c.group_id == groups_users.c.group_id)
        .where(
            and_(
                meetings.c.cohort_id == host["cohort_id"],
                meetings.c.meeting_number == host["meeting_number"],
                groups_users.c.user_id == user_id,
                groups_users.c.status == GroupUserStatus.active,
            )
        )
    )
    home = home_result.mappings().first()

    # Reset home meeting RSVP to pending
    if home:
        await conn.execute(
            attendances.update()
            .where(
                and_(
                    attendances.c.meeting_id == home["meeting_id"],
                    attendances.c.user_id == user_id,
                )
            )
            .values(rsvp_status=RSVPStatus.pending)
        )

    return {
        "success": True,
        "host_group_id": host["group_id"],
        "home_group_id": home["group_id"] if home else None,
    }


async def get_user_guest_visits(
    conn: AsyncConnection,
    user_id: int,
) -> list[dict]:
    """
    Get all guest visits for a user (upcoming and past).

    Returns:
        List of dicts with meeting details, group name, scheduled_at, is_past
    """
    now = datetime.now(timezone.utc)
    result = await conn.execute(
        select(
            attendances.c.attendance_id,
            meetings.c.meeting_id,
            meetings.c.meeting_number,
            meetings.c.scheduled_at,
            meetings.c.group_id,
            groups.c.group_name,
        )
        .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
        .join(groups, meetings.c.group_id == groups.c.group_id)
        .where(
            and_(
                attendances.c.user_id == user_id,
                attendances.c.is_guest.is_(True),
                attendances.c.rsvp_status == RSVPStatus.attending,
            )
        )
        .order_by(meetings.c.scheduled_at.desc())
    )

    visits = []
    for row in result.mappings():
        visit = dict(row)
        visit["is_past"] = visit["scheduled_at"] < now
        visit["can_cancel"] = visit["scheduled_at"] > now
        if visit.get("scheduled_at"):
            visit["scheduled_at"] = visit["scheduled_at"].isoformat()
        visits.append(visit)
    return visits
```

**Step 4: Export from `core/__init__.py`**

Add imports and `__all__` entries:

```python
# Guest visits
from .guest_visits import (
    find_alternative_meetings,
    create_guest_visit,
    cancel_guest_visit,
    get_user_guest_visits,
)
```

**Step 5: Run tests to verify they pass**

Run:
```bash
.venv/bin/pytest core/tests/test_guest_visits.py -v
```
Expected: All PASS.

**Step 6: Commit**

```
feat: add guest visit core business logic
```

---

### Task 5: Discord Sync — Include Guests in Expected Members

**Files:**
- Modify: `core/sync.py:1257-1266` (expected members query)
- Modify: `core/tests/test_sync.py` (add test for guest inclusion)

**Step 1: Write failing test**

Create `core/tests/test_sync_guest_permissions.py`:

```python
"""Test that sync_group_discord_permissions includes guest attendees.

We patch the external dependencies (Discord bot, channels, roles) and
capture the SQL query used to determine expected members. The compiled
SQL should include is_guest to account for guest visitors.
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch, MagicMock
from sqlalchemy.dialects import postgresql


def _compile_sql(query) -> str:
    """Compile a SQLAlchemy query to SQL string for inspection."""
    return str(query.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))


class TestSyncIncludesGuests:

    @pytest.mark.asyncio
    async def test_expected_members_query_includes_guests(self):
        """The expected members query should UNION with guest attendees."""
        from core.sync import sync_group_discord_permissions

        # Set up mocks for Discord objects so the function reaches the DB query
        mock_bot = MagicMock()
        mock_guild = MagicMock()
        mock_role = MagicMock()
        mock_role.members = []
        mock_guild.get_role.return_value = mock_role
        mock_guild.roles = [mock_role]
        mock_bot.guilds = [mock_guild]

        mock_text_channel = MagicMock()
        mock_text_channel.overwrites = {}
        mock_bot.get_channel = MagicMock(return_value=mock_text_channel)

        # Capture the SQL query from the expected members DB call
        captured_queries = []
        original_execute = None

        async def capture_execute(query, *args, **kwargs):
            try:
                sql = _compile_sql(query)
                captured_queries.append(sql)
            except Exception:
                pass
            # Return empty result
            mock_result = Mock()
            mock_mappings = Mock()
            mock_mappings.__iter__ = Mock(return_value=iter([]))
            mock_result.mappings.return_value = mock_mappings
            return mock_result

        mock_conn = AsyncMock()
        mock_conn.execute = capture_execute

        with patch("core.sync.get_bot", return_value=mock_bot), \
             patch("core.sync.get_connection") as mock_get_conn, \
             patch("core.sync._set_group_role_permissions", new_callable=AsyncMock), \
             patch("core.sync.get_role_member_ids", return_value=set()):

            mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_get_conn.return_value.__aexit__ = AsyncMock()

            # Need a group with role/channel IDs to reach the members query
            group_data = {
                "group_id": 1,
                "discord_role_id": "123",
                "discord_text_channel_id": "456",
                "discord_voice_channel_id": None,
                "cohort_id": 1,
            }

            try:
                await sync_group_discord_permissions(1)
            except Exception:
                pass  # May fail; we only need to capture queries

        # Check that at least one captured query references is_guest
        found_guest_query = any("is_guest" in sql for sql in captured_queries)
        assert found_guest_query, (
            "sync_group_discord_permissions expected members query must include "
            "is_guest to account for guest visitors.\n"
            f"Captured {len(captured_queries)} queries, none referenced is_guest."
        )
```

**Step 2: Run test to verify it fails**

Run:
```bash
.venv/bin/pytest core/tests/test_sync_guest_permissions.py -v
```
Expected: FAIL — expected members query doesn't reference `is_guest` yet.

**Step 3: Modify the expected members query**

In `core/sync.py`, find the expected members query at ~line 1257. Replace the block:

```python
    # Step 4: Get expected members from DB (who SHOULD have the role)
    async with get_connection() as conn:
        members_result = await conn.execute(
            select(users.c.discord_id)
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
            .where(users.c.discord_id.isnot(None))
        )
        expected_discord_ids = {row["discord_id"] for row in members_result.mappings()}
```

with:

```python
    # Step 4: Get expected members from DB (who SHOULD have the role)
    # Includes both permanent group members AND active guest visitors
    from .tables import meetings, attendances
    from .enums import RSVPStatus
    from datetime import datetime, timezone, timedelta

    async with get_connection() as conn:
        # Permanent members
        permanent_query = (
            select(users.c.discord_id)
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
            .where(users.c.discord_id.isnot(None))
        )

        # Guest visitors (attending a meeting in this group within the access window)
        # Window: 6 days before meeting → 3 days after meeting
        now = datetime.now(timezone.utc)
        grace_cutoff = now - timedelta(days=3)
        access_start = now + timedelta(days=6)
        guest_query = (
            select(users.c.discord_id)
            .join(attendances, users.c.user_id == attendances.c.user_id)
            .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
            .where(meetings.c.group_id == group_id)
            .where(attendances.c.is_guest.is_(True))
            .where(attendances.c.rsvp_status == RSVPStatus.attending)
            .where(meetings.c.scheduled_at > grace_cutoff)
            .where(meetings.c.scheduled_at < access_start)
            .where(users.c.discord_id.isnot(None))
        )

        combined = permanent_query.union(guest_query)
        members_result = await conn.execute(combined)
        expected_discord_ids = {row["discord_id"] for row in members_result.mappings()}
```

**Step 4: Run test to verify it passes**

Run:
```bash
.venv/bin/pytest core/tests/test_sync_guest_permissions.py -v
```
Expected: PASS.

**Step 5: Run full test suite for regressions**

Run:
```bash
.venv/bin/pytest core/tests/test_sync.py -v
```
Expected: All existing sync tests still pass.

**Step 6: Commit**

```
feat: include guest visitors in Discord role sync
```

---

### Task 6: Guest Channel Notifications

When `sync_group_discord_permissions` grants or revokes a role because of a guest visit, post a message in the host group's text channel so members know who the guest is and why they have access.

**Files:**
- Create: `core/guest_notifications.py`
- Create: `core/tests/test_guest_notifications.py`

**Step 1: Write failing tests**

Create `core/tests/test_guest_notifications.py`:

```python
"""Tests for guest visit channel notifications."""

import pytest
from unittest.mock import AsyncMock, patch, Mock
from sqlalchemy.dialects import postgresql


def _make_mapping_result(rows):
    """Helper to create a mock result supporting .mappings()."""
    mock_result = Mock()
    mock_mappings = Mock()
    if rows:
        mock_mappings.first.return_value = rows[0]
        mock_mappings.__iter__ = Mock(return_value=iter(rows))
    else:
        mock_mappings.first.return_value = None
        mock_mappings.__iter__ = Mock(return_value=iter([]))
    mock_result.mappings.return_value = mock_mappings
    return mock_result


class TestNotifyGuestRoleChanges:

    @pytest.mark.asyncio
    async def test_sends_grant_message_for_guest(self):
        """Should post a join message when a guest is granted the role."""
        from core.guest_notifications import notify_guest_role_changes

        sync_result = {
            "granted_discord_ids": ["discord_guest_1"],
            "revoked_discord_ids": [],
        }

        # Mock DB: group has a text channel, guest exists, home group found
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([{"discord_text_channel_id": "chan_123"}]),  # group lookup
            _make_mapping_result([{"discord_id": "discord_guest_1", "name": "Alice"}]),  # guest lookup
            _make_mapping_result([{"group_name": "Alpha"}]),  # home group lookup
        ])

        with patch("core.guest_notifications.get_connection") as mock_get_conn, \
             patch("core.guest_notifications.send_channel_message", new_callable=AsyncMock) as mock_send:
            mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_get_conn.return_value.__aexit__ = AsyncMock()

            await notify_guest_role_changes(group_id=2, sync_result=sync_result)

        mock_send.assert_called_once()
        message = mock_send.call_args[0][1]
        assert "Alice" in message
        assert "guest" in message.lower()
        assert "Alpha" in message

    @pytest.mark.asyncio
    async def test_sends_revoke_message_for_guest(self):
        """Should post an ended message when a guest's role is revoked."""
        from core.guest_notifications import notify_guest_role_changes

        sync_result = {
            "granted_discord_ids": [],
            "revoked_discord_ids": ["discord_guest_1"],
        }

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([{"discord_text_channel_id": "chan_123"}]),  # group lookup
            _make_mapping_result([{"discord_id": "discord_guest_1", "name": "Bob"}]),  # guest lookup
        ])

        with patch("core.guest_notifications.get_connection") as mock_get_conn, \
             patch("core.guest_notifications.send_channel_message", new_callable=AsyncMock) as mock_send:
            mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_get_conn.return_value.__aexit__ = AsyncMock()

            await notify_guest_role_changes(group_id=2, sync_result=sync_result)

        mock_send.assert_called_once()
        message = mock_send.call_args[0][1]
        assert "Bob" in message
        assert "ended" in message.lower()

    @pytest.mark.asyncio
    async def test_skips_non_guest_role_changes(self):
        """Should not send messages for regular member grant/revoke."""
        from core.guest_notifications import notify_guest_role_changes

        sync_result = {
            "granted_discord_ids": ["discord_regular_1"],
            "revoked_discord_ids": [],
        }

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(side_effect=[
            _make_mapping_result([{"discord_text_channel_id": "chan_123"}]),
            _make_mapping_result([]),  # no guest matches
        ])

        with patch("core.guest_notifications.get_connection") as mock_get_conn, \
             patch("core.guest_notifications.send_channel_message", new_callable=AsyncMock) as mock_send:
            mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_get_conn.return_value.__aexit__ = AsyncMock()

            await notify_guest_role_changes(group_id=2, sync_result=sync_result)

        mock_send.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_op_when_no_changes(self):
        """Should return immediately when sync_result has no grants or revokes."""
        from core.guest_notifications import notify_guest_role_changes

        with patch("core.guest_notifications.get_connection") as mock_get_conn:
            await notify_guest_role_changes(
                group_id=2,
                sync_result={"granted_discord_ids": [], "revoked_discord_ids": []},
            )
            mock_get_conn.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_op_when_no_text_channel(self):
        """Should return silently when the group has no text channel."""
        from core.guest_notifications import notify_guest_role_changes

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value=_make_mapping_result([
            {"discord_text_channel_id": None},
        ]))

        with patch("core.guest_notifications.get_connection") as mock_get_conn, \
             patch("core.guest_notifications.send_channel_message", new_callable=AsyncMock) as mock_send:
            mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_get_conn.return_value.__aexit__ = AsyncMock()

            await notify_guest_role_changes(
                group_id=2,
                sync_result={"granted_discord_ids": ["x"], "revoked_discord_ids": []},
            )

        mock_send.assert_not_called()
```

**Step 2: Run tests to verify they fail**

Run:
```bash
.venv/bin/pytest core/tests/test_guest_notifications.py -v
```
Expected: FAIL — `core.guest_notifications` module doesn't exist.

**Step 3: Implement `core/guest_notifications.py`**

```python
"""Guest visit channel notifications.

Posts messages in Discord channels when guests are granted or revoked
access to a host group's channels.
"""

import logging

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncConnection

from core.database import get_connection
from core.tables import attendances, meetings, users, groups, groups_users
from core.discord_outbound import send_channel_message

logger = logging.getLogger(__name__)


async def notify_guest_role_changes(
    group_id: int,
    sync_result: dict,
) -> None:
    """
    Post channel messages when guests are granted or revoked Discord roles.

    After sync_group_discord_permissions runs, this function cross-references
    the granted/revoked discord_ids with guest attendance records to identify
    guest-specific changes, then posts messages in the host group's text channel.

    Args:
        group_id: The host group that was synced
        sync_result: Return value from sync_group_discord_permissions, containing
                     granted_discord_ids and revoked_discord_ids
    """
    granted = set(sync_result.get("granted_discord_ids", []))
    revoked = set(sync_result.get("revoked_discord_ids", []))

    if not granted and not revoked:
        return

    async with get_connection() as conn:
        # Get text channel for this group
        group_result = await conn.execute(
            select(groups.c.discord_text_channel_id)
            .where(groups.c.group_id == group_id)
        )
        group_row = group_result.mappings().first()
        if not group_row or not group_row.get("discord_text_channel_id"):
            return

        text_channel_id = group_row["discord_text_channel_id"]

        # Find guest discord_ids for this group (any meeting, is_guest=true)
        # This works for both grant and revoke: attendance records persist
        # after the access window closes, so we can always identify guests.
        # (Cancelled visits delete the record, but we don't need to notify for those.)
        all_changed = granted | revoked
        guest_result = await conn.execute(
            select(
                users.c.discord_id,
                func.coalesce(users.c.nickname, users.c.discord_username).label("name"),
            )
            .join(attendances, users.c.user_id == attendances.c.user_id)
            .join(meetings, attendances.c.meeting_id == meetings.c.meeting_id)
            .where(meetings.c.group_id == group_id)
            .where(attendances.c.is_guest.is_(True))
            .where(users.c.discord_id.in_(all_changed))
            .distinct()
        )
        guest_info = {
            row["discord_id"]: row["name"]
            for row in guest_result.mappings()
        }

        guest_grants = granted & set(guest_info.keys())
        guest_revokes = revoked & set(guest_info.keys())

        # Send grant messages (with home group name)
        for discord_id in guest_grants:
            home_result = await conn.execute(
                select(groups.c.group_name)
                .join(groups_users, groups.c.group_id == groups_users.c.group_id)
                .join(users, groups_users.c.user_id == users.c.user_id)
                .where(users.c.discord_id == discord_id)
                .where(groups_users.c.status == "active")
                .where(groups_users.c.group_id != group_id)
                .limit(1)
            )
            home_row = home_result.mappings().first()
            home_name = home_row["group_name"] if home_row else "another group"
            name = guest_info[discord_id]

            await send_channel_message(
                text_channel_id,
                f"{name} is joining this week's meeting as a guest from {home_name}.",
            )

        # Send revoke messages
        for discord_id in guest_revokes:
            name = guest_info.get(discord_id, "A guest")
            await send_channel_message(
                text_channel_id,
                f"{name}'s guest visit has ended.",
            )
```

**Step 4: Run tests to verify they pass**

Run:
```bash
.venv/bin/pytest core/tests/test_guest_notifications.py -v
```
Expected: All 5 PASS.

**Step 5: Commit**

```
feat: add guest visit channel notifications
```

---

### Task 7: Schedule Guest Access Grant and Revoke

When a guest visit is created, schedule two one-shot APScheduler jobs that each call `sync_group_discord_permissions(host_group_id)`:

1. **Grant** at `meeting - 6 days` — guest enters the expected-members window, diff grants role
2. **Revoke** at `meeting + 3 days` — guest exits the expected-members window, diff revokes role

Both are fire-and-forget. If the visit is created within 6 days, the immediate sync (Task 7) handles the grant and the grant job is a harmless no-op. If cancelled, the attendance is deleted, so both jobs are no-ops. No cancellation of scheduled jobs needed.

**Files:**
- Modify: `core/notifications/scheduler.py` (add `schedule_guest_sync` function)
- Create: `core/tests/test_guest_sync_schedule.py`

**Step 1: Write failing test**

Create `core/tests/test_guest_sync_schedule.py`:

```python
"""Tests for guest visit sync scheduling (grant + revoke)."""

import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta, timezone

from core.notifications.scheduler import schedule_guest_sync


class TestScheduleGuestSync:

    def test_schedules_two_jobs_for_grant_and_revoke(self):
        """Should schedule a grant job at meeting-6d and revoke job at meeting+3d."""
        meeting_time = datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc)

        mock_scheduler = MagicMock()
        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_guest_sync(group_id=42, meeting_scheduled_at=meeting_time)

        assert mock_scheduler.add_job.call_count == 2
        calls = mock_scheduler.add_job.call_args_list

        # First call: grant (meeting - 6 days)
        grant_kwargs = calls[0].kwargs
        assert grant_kwargs["trigger"] == "date"
        assert grant_kwargs["run_date"] == meeting_time - timedelta(days=6)
        assert grant_kwargs["kwargs"] == {"group_id": 42}
        assert "grant" in grant_kwargs["id"]

        # Second call: revoke (meeting + 3 days)
        revoke_kwargs = calls[1].kwargs
        assert revoke_kwargs["trigger"] == "date"
        assert revoke_kwargs["run_date"] == meeting_time + timedelta(days=3)
        assert revoke_kwargs["kwargs"] == {"group_id": 42}
        assert "revoke" in revoke_kwargs["id"]

    def test_does_nothing_when_scheduler_not_initialized(self):
        """Should not raise when scheduler is None."""
        with patch("core.notifications.scheduler._scheduler", None):
            schedule_guest_sync(
                group_id=42,
                meeting_scheduled_at=datetime.now(timezone.utc),
            )

    def test_job_ids_include_group_and_meeting_timestamp(self):
        """Job IDs should be unique per group+meeting to avoid collisions."""
        meeting_time = datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc)
        mock_scheduler = MagicMock()
        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_guest_sync(group_id=42, meeting_scheduled_at=meeting_time)

        calls = mock_scheduler.add_job.call_args_list
        grant_id = calls[0].kwargs["id"]
        revoke_id = calls[1].kwargs["id"]
        # Both should include group_id
        assert "42" in grant_id
        assert "42" in revoke_id
        # They should be different from each other
        assert grant_id != revoke_id
```

**Step 2: Run tests to verify they fail**

Run:
```bash
.venv/bin/pytest core/tests/test_guest_sync_schedule.py -v
```
Expected: FAIL — `schedule_guest_sync` doesn't exist yet.

**Step 3: Implement `schedule_guest_sync` in scheduler**

Add to `core/notifications/scheduler.py`, near the other scheduling functions:

```python
GUEST_ACCESS_LEAD = timedelta(days=6)
GUEST_GRACE_PERIOD = timedelta(days=3)


def schedule_guest_sync(
    group_id: int,
    meeting_scheduled_at: datetime,
) -> None:
    """
    Schedule two one-shot Discord syncs for a guest visit.

    1. Grant: meeting - 6 days (guest enters expected-members window)
    2. Revoke: meeting + 3 days (guest exits expected-members window)

    Both are fire-and-forget. The sync is diff-based, so cancelled visits
    (where the attendance record is deleted) result in harmless no-ops.

    Args:
        group_id: Host group to sync
        meeting_scheduled_at: When the host meeting is scheduled
    """
    if not _scheduler:
        logger.warning("Scheduler not available, cannot schedule guest sync")
        return

    meeting_ts = int(meeting_scheduled_at.timestamp())

    # Grant: add guest to host group's Discord role
    grant_at = meeting_scheduled_at - GUEST_ACCESS_LEAD
    _scheduler.add_job(
        _execute_guest_sync,
        trigger="date",
        run_date=grant_at,
        id=f"guest_grant_{group_id}_{meeting_ts}",
        replace_existing=True,
        kwargs={"group_id": group_id},
    )

    # Revoke: remove guest from host group's Discord role
    revoke_at = meeting_scheduled_at + GUEST_GRACE_PERIOD
    _scheduler.add_job(
        _execute_guest_sync,
        trigger="date",
        run_date=revoke_at,
        id=f"guest_revoke_{group_id}_{meeting_ts}",
        replace_existing=True,
        kwargs={"group_id": group_id},
    )

    logger.info(
        f"Scheduled guest sync for group {group_id}: "
        f"grant at {grant_at.isoformat()}, revoke at {revoke_at.isoformat()}"
    )


async def _execute_guest_sync(group_id: int) -> None:
    """Run sync_group_discord_permissions and notify on guest changes."""
    from core.sync import sync_group_discord_permissions
    from core.guest_notifications import notify_guest_role_changes

    try:
        sync_result = await sync_group_discord_permissions(group_id)
        logger.info(f"Guest sync completed for group {group_id}")
        await notify_guest_role_changes(group_id, sync_result)
    except Exception as e:
        logger.error(f"Guest sync failed for group {group_id}: {e}")
```

**Step 4: Export from `core/notifications/scheduler.py`**

If the module uses `__all__`, add `schedule_guest_sync` to it.

**Step 5: Run tests to verify they pass**

Run:
```bash
.venv/bin/pytest core/tests/test_guest_sync_schedule.py -v
```
Expected: All 3 PASS.

**Step 6: Commit**

```
feat: schedule guest access grant and revoke via APScheduler
```

---

### Task 8: API Endpoints — Guest Visit Routes

**Files:**
- Create: `web_api/routes/guest_visits.py`
- Modify: `main.py:139-150,304-315` (import and register router)
- Create: `web_api/tests/test_guest_visits_api.py`

**Step 1: Write failing tests**

Create `web_api/tests/test_guest_visits_api.py`:

```python
"""Tests for guest visit API endpoints."""

import pytest
from unittest.mock import AsyncMock, patch, Mock
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create test client with mocked auth."""
    from main import app
    return TestClient(app)


@pytest.fixture
def mock_auth():
    """Mock authenticated user."""
    with patch("web_api.routes.guest_visits.get_current_user") as mock:
        mock.return_value = {"sub": "discord123"}
        yield mock


class TestGuestVisitEndpoints:

    def test_get_options_returns_alternatives(self, client, mock_auth):
        """GET /api/guest-visits/options should return alternative meetings."""
        with patch("web_api.routes.guest_visits.get_user_by_discord_id") as mock_user, \
             patch("web_api.routes.guest_visits.find_alternative_meetings") as mock_find:
            mock_user.return_value = {"user_id": 1}
            mock_find.return_value = [
                {"meeting_id": 20, "group_name": "Beta", "scheduled_at": "2026-03-01T15:00:00+00:00"}
            ]
            response = client.get("/api/guest-visits/options?meeting_id=10")
        assert response.status_code == 200
        assert len(response.json()["alternatives"]) == 1

    def test_create_guest_visit(self, client, mock_auth):
        """POST /api/guest-visits should create a guest visit."""
        with patch("web_api.routes.guest_visits.get_user_by_discord_id") as mock_user, \
             patch("web_api.routes.guest_visits.create_guest_visit") as mock_create, \
             patch("web_api.routes.guest_visits.sync_group_discord_permissions") as mock_sync, \
             patch("web_api.routes.guest_visits.notify_guest_role_changes", new_callable=AsyncMock), \
             patch("web_api.routes.guest_visits.schedule_guest_sync"), \
             patch("web_api.routes.guest_visits._sync_guest_calendar"):
            mock_user.return_value = {"user_id": 1}
            mock_create.return_value = {"success": True, "host_meeting_id": 20, "host_group_id": 2, "host_scheduled_at": datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc), "home_group_id": 1}
            response = client.post("/api/guest-visits", json={
                "home_meeting_id": 10,
                "host_meeting_id": 20,
            })
        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_create_returns_400_on_validation_error(self, client, mock_auth):
        """POST /api/guest-visits should return 400 when create_guest_visit raises ValueError."""
        with patch("web_api.routes.guest_visits.get_user_by_discord_id") as mock_user, \
             patch("web_api.routes.guest_visits.create_guest_visit") as mock_create:
            mock_user.return_value = {"user_id": 1}
            mock_create.side_effect = ValueError("Home and host meetings must be in the same cohort")
            response = client.post("/api/guest-visits", json={
                "home_meeting_id": 10,
                "host_meeting_id": 20,
            })
        assert response.status_code == 400
        assert "same cohort" in response.json()["detail"]

    def test_create_returns_404_when_user_not_found(self, client, mock_auth):
        """POST /api/guest-visits should return 404 when user doesn't exist."""
        with patch("web_api.routes.guest_visits.get_user_by_discord_id") as mock_user:
            mock_user.return_value = None
            response = client.post("/api/guest-visits", json={
                "home_meeting_id": 10,
                "host_meeting_id": 20,
            })
        assert response.status_code == 404
```

**Step 2: Run tests to verify they fail**

Run:
```bash
.venv/bin/pytest web_api/tests/test_guest_visits_api.py -v
```
Expected: FAIL — route module doesn't exist.

**Step 3: Implement `web_api/routes/guest_visits.py`**

```python
"""
Guest visit routes.

Endpoints:
- GET /api/guest-visits/options - Get alternative meetings for a given meeting
- POST /api/guest-visits - Create a guest visit
- DELETE /api/guest-visits/{host_meeting_id} - Cancel a guest visit
- GET /api/guest-visits - List user's guest visits
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.database import get_connection, get_transaction
from core.guest_visits import (
    find_alternative_meetings,
    create_guest_visit,
    cancel_guest_visit,
    get_user_guest_visits,
)
from core.sync import sync_group_discord_permissions
from core.calendar.events import get_event_instances, patch_event_instance
from core.notifications.scheduler import schedule_guest_sync
from core.guest_notifications import notify_guest_role_changes
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guest-visits", tags=["guest-visits"])


@router.get("/options")
async def get_alternatives(
    meeting_id: int = Query(..., description="The meeting the user can't attend"),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Get alternative meetings the user can attend as a guest."""
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        alternatives = await find_alternative_meetings(
            conn, user_id=db_user["user_id"], meeting_id=meeting_id
        )

    return {"alternatives": alternatives}


class CreateGuestVisitRequest(BaseModel):
    home_meeting_id: int
    host_meeting_id: int


@router.post("")
async def create_guest_visit_endpoint(
    request: CreateGuestVisitRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create a guest visit for a meeting in another group."""
    discord_id = user["sub"]

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            result = await create_guest_visit(
                conn,
                user_id=db_user["user_id"],
                home_meeting_id=request.home_meeting_id,
                host_meeting_id=request.host_meeting_id,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    # After commit: trigger side effects
    if result.get("success"):
        # Sync Discord permissions now (grants role if meeting is within 6 days)
        try:
            sync_result = await sync_group_discord_permissions(result["host_group_id"])
            await notify_guest_role_changes(result["host_group_id"], sync_result)
        except Exception as e:
            logger.error(f"Failed to sync Discord for guest visit: {e}")

        # Schedule grant at meeting-6d and revoke at meeting+3d
        schedule_guest_sync(
            group_id=result["host_group_id"],
            meeting_scheduled_at=result["host_scheduled_at"],
        )

        # Patch calendar instance to add guest
        try:
            await _sync_guest_calendar(
                host_group_id=result["host_group_id"],
                host_meeting_id=request.host_meeting_id,
                user_email=db_user.get("email"),
                add=True,
            )
        except Exception as e:
            logger.error(f"Failed to sync calendar for guest visit: {e}")

    return result


@router.delete("/{host_meeting_id}")
async def cancel_guest_visit_endpoint(
    host_meeting_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Cancel a guest visit (before the meeting starts)."""
    discord_id = user["sub"]

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            result = await cancel_guest_visit(
                conn,
                user_id=db_user["user_id"],
                host_meeting_id=host_meeting_id,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))

    # After commit: trigger side effects
    if result.get("success"):
        try:
            sync_result = await sync_group_discord_permissions(result["host_group_id"])
            await notify_guest_role_changes(result["host_group_id"], sync_result)
        except Exception as e:
            logger.error(f"Failed to sync Discord for guest visit cancel: {e}")

        try:
            await _sync_guest_calendar(
                host_group_id=result["host_group_id"],
                host_meeting_id=host_meeting_id,
                user_email=db_user.get("email"),
                add=False,
            )
        except Exception as e:
            logger.error(f"Failed to sync calendar for guest visit cancel: {e}")

    return result


@router.get("")
async def list_guest_visits(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """List all guest visits for the current user."""
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        visits = await get_user_guest_visits(conn, db_user["user_id"])

    return {"visits": visits}


async def _sync_guest_calendar(
    host_group_id: int,
    host_meeting_id: int,
    user_email: str | None,
    add: bool,
) -> None:
    """
    Add or remove a guest from a specific calendar event instance.

    Args:
        host_group_id: The group whose calendar event to modify
        host_meeting_id: The specific meeting (to find the right instance)
        user_email: Guest's email address
        add: True to add guest, False to remove
    """
    if not user_email:
        logger.info("No email for user, skipping calendar sync")
        return

    from core.database import get_connection
    from core.tables import groups, meetings
    from sqlalchemy import select

    # Get the group's recurring event ID and the meeting's scheduled time
    async with get_connection() as conn:
        result = await conn.execute(
            select(
                groups.c.gcal_recurring_event_id,
                meetings.c.scheduled_at,
            )
            .join(meetings, meetings.c.group_id == groups.c.group_id)
            .where(meetings.c.meeting_id == host_meeting_id)
        )
        row = result.mappings().first()

    if not row or not row["gcal_recurring_event_id"]:
        logger.info(f"No calendar event for group {host_group_id}")
        return

    # Get all instances to find the right one
    instances = await get_event_instances(row["gcal_recurring_event_id"])
    if not instances:
        return

    # Match instance by scheduled time
    from dateutil.parser import isoparse
    from datetime import timezone

    # Use astimezone (not replace) to correctly convert timezone-aware datetimes
    scheduled_at = row["scheduled_at"]
    target_time = scheduled_at.astimezone(timezone.utc) if scheduled_at.tzinfo else scheduled_at.replace(tzinfo=timezone.utc)
    target_instance = None

    for inst in instances:
        start_str = inst.get("start", {}).get("dateTime")
        if not start_str:
            continue
        try:
            inst_time = isoparse(start_str).astimezone(timezone.utc)
            if inst_time == target_time:
                target_instance = inst
                break
        except (ValueError, TypeError):
            continue

    if not target_instance:
        logger.warning(f"No calendar instance found for meeting {host_meeting_id}")
        return

    # Modify attendees
    current_attendees = target_instance.get("attendees", [])
    current_emails = {a.get("email", "").lower() for a in current_attendees}

    if add and user_email.lower() not in current_emails:
        new_attendees = current_attendees + [{"email": user_email}]
    elif not add and user_email.lower() in current_emails:
        new_attendees = [a for a in current_attendees if a.get("email", "").lower() != user_email.lower()]
    else:
        return  # No change needed

    await patch_event_instance(target_instance["id"], new_attendees)
```

**Step 4: Register router in `main.py`**

Add import near line 150:
```python
from web_api.routes.guest_visits import router as guest_visits_router
```

Add `app.include_router(guest_visits_router)` near line 315.

**Step 5: Run tests to verify they pass**

Run:
```bash
.venv/bin/pytest web_api/tests/test_guest_visits_api.py -v
```
Expected: PASS.

**Step 6: Commit**

```
feat: add guest visit API endpoints
```

---

### Task 9: Backend Support — User Meetings Endpoint

The frontend needs a `GET /api/users/me/meetings` endpoint to list the user's upcoming meetings. Check if this already exists; if not, add it.

**Files:**
- Modify: `web_api/routes/users.py` (add endpoint if missing)

**Step 1: Check if the endpoint exists**

Search for `meetings` endpoints in `web_api/routes/users.py`. If a route returning the user's upcoming meetings exists, skip this task.

**Step 2: Write a failing test for the endpoint**

Add to `web_api/tests/test_guest_visits_api.py` (or create a separate test file):

```python
class TestUserMeetingsEndpoint:

    def test_returns_upcoming_meetings(self, client, mock_auth):
        """GET /api/users/me/meetings should return user's upcoming meetings."""
        with patch("web_api.routes.users.get_user_by_discord_id") as mock_user, \
             patch("web_api.routes.users.get_connection") as mock_conn_ctx:
            mock_user.return_value = {"user_id": 1}

            mock_conn = AsyncMock()
            mock_conn.execute = AsyncMock(side_effect=[
                _make_mapping_result([{"group_id": 1}]),  # user's group
                _make_mapping_result([{                     # upcoming meeting
                    "meeting_id": 10,
                    "meeting_number": 5,
                    "scheduled_at": datetime(2026, 3, 1, 15, 0, tzinfo=timezone.utc),
                    "group_name": "Alpha",
                }]),
            ])
            mock_conn_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_conn_ctx.return_value.__aexit__ = AsyncMock()

            response = client.get("/api/users/me/meetings")

        assert response.status_code == 200
        meetings = response.json()["meetings"]
        assert len(meetings) == 1
        assert meetings[0]["meeting_id"] == 10
```

**Step 3: If missing, add the endpoint**

Add to `web_api/routes/users.py`:

```python
@router.get("/users/me/meetings")
async def get_my_meetings(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Get current user's upcoming meetings from their active group."""
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        # Find user's active group
        group_result = await conn.execute(
            select(groups_users.c.group_id)
            .where(groups_users.c.user_id == db_user["user_id"])
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        group_row = group_result.mappings().first()
        if not group_row:
            return {"meetings": []}

        group_id = group_row["group_id"]

        # Get upcoming meetings with group name
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.meeting_number,
                meetings.c.scheduled_at,
                groups.c.group_name,
            )
            .join(groups, meetings.c.group_id == groups.c.group_id)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
            .order_by(meetings.c.scheduled_at)
        )
        result = []
        for row in meetings_result.mappings():
            r = dict(row)
            r["scheduled_at"] = r["scheduled_at"].isoformat()
            result.append(r)

        return {"meetings": result}
```

Add necessary imports (`groups_users`, `groups`, `meetings`, `GroupUserStatus`, `datetime`, `timezone`, `select`).

**Step 4: Run the test**

Run:
```bash
.venv/bin/pytest web_api/tests/test_guest_visits_api.py::TestUserMeetingsEndpoint -v
```
Expected: PASS.

**Step 5: Commit**

```
feat: add GET /api/users/me/meetings endpoint
```

---

### Task 10: Frontend — Reschedule Page (depends on Task 9)

**Files:**
- Create: `web_frontend/src/pages/reschedule/+Page.tsx`
- Create: `web_frontend/src/api/guestVisits.ts`

**Step 1: Create API utility**

Create `web_frontend/src/api/guestVisits.ts`:

```typescript
import { fetchWithRefresh } from "./fetchWithRefresh";

const API_URL = import.meta.env.PUBLIC_ENV__API_URL ?? "";

export interface AlternativeMeeting {
  meeting_id: number;
  group_id: number;
  group_name: string;
  scheduled_at: string;
  meeting_number: number;
  facilitator_name: string | null;
}

export interface GuestVisit {
  attendance_id: number;
  meeting_id: number;
  meeting_number: number;
  scheduled_at: string;
  group_id: number;
  group_name: string;
  is_past: boolean;
  can_cancel: boolean;
}

export async function getAlternatives(meetingId: number): Promise<AlternativeMeeting[]> {
  const res = await fetchWithRefresh(
    `${API_URL}/api/guest-visits/options?meeting_id=${meetingId}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to load alternatives");
  const data = await res.json();
  return data.alternatives;
}

export async function createGuestVisit(
  homeMeetingId: number,
  hostMeetingId: number,
): Promise<{ success: boolean }> {
  const res = await fetchWithRefresh(`${API_URL}/api/guest-visits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      home_meeting_id: homeMeetingId,
      host_meeting_id: hostMeetingId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to create guest visit");
  }
  return res.json();
}

export async function cancelGuestVisit(hostMeetingId: number): Promise<void> {
  const res = await fetchWithRefresh(
    `${API_URL}/api/guest-visits/${hostMeetingId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to cancel guest visit");
  }
}

export async function getGuestVisits(): Promise<GuestVisit[]> {
  const res = await fetchWithRefresh(`${API_URL}/api/guest-visits`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load guest visits");
  const data = await res.json();
  return data.visits;
}
```

**Step 2: Create the page component**

Create `web_frontend/src/pages/reschedule/+Page.tsx`:

```tsx
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  getAlternatives,
  createGuestVisit,
  cancelGuestVisit,
  getGuestVisits,
  type AlternativeMeeting,
  type GuestVisit,
} from "@/api/guestVisits";
import { fetchWithRefresh } from "@/api/fetchWithRefresh";

const API_URL = import.meta.env.PUBLIC_ENV__API_URL ?? "";

interface UpcomingMeeting {
  meeting_id: number;
  meeting_number: number;
  scheduled_at: string;
  group_name: string;
}

export default function ReschedulePage() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const [guestVisits, setGuestVisits] = useState<GuestVisit[]>([]);
  const [alternatives, setAlternatives] = useState<AlternativeMeeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load user's upcoming meetings from their group
      const res = await fetchWithRefresh(`${API_URL}/api/users/me/meetings`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings ?? []);
      }

      // Load existing guest visits
      const visits = await getGuestVisits();
      setGuestVisits(visits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadData();
  }, [user, loadData]);

  const handleCantAttend = async (meetingId: number) => {
    try {
      setError(null);
      setSelectedMeeting(meetingId);
      const alts = await getAlternatives(meetingId);
      setAlternatives(alts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alternatives");
    }
  };

  const handleSelectAlternative = async (hostMeetingId: number) => {
    if (!selectedMeeting) return;
    try {
      setSubmitting(true);
      setError(null);
      await createGuestVisit(selectedMeeting, hostMeetingId);
      setSuccess("Guest visit confirmed! You'll receive a calendar invite and Discord access.");
      setSelectedMeeting(null);
      setAlternatives([]);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create guest visit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (hostMeetingId: number) => {
    try {
      setError(null);
      await cancelGuestVisit(hostMeetingId);
      setSuccess("Guest visit cancelled.");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel guest visit");
    }
  };

  if (!user) {
    return (
      <div className="min-h-dvh bg-stone-50 flex items-center justify-center">
        <p className="text-slate-500">Please log in to manage your meetings.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-stone-50 flex items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  return (
    <div className="min-h-dvh bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          Reschedule a Meeting
        </h1>
        <p className="text-slate-600 mb-8">
          Can't make your group's meeting? Attend another group's meeting for that week instead.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm">
            {success}
          </div>
        )}

        {/* Active Guest Visits */}
        {guestVisits.filter((v) => !v.is_past).length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              Upcoming Guest Visits
            </h2>
            <div className="space-y-3">
              {guestVisits
                .filter((v) => !v.is_past)
                .map((visit) => (
                  <div
                    key={visit.attendance_id}
                    className="p-4 bg-white border border-slate-200 rounded-lg flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        Week {visit.meeting_number} with {visit.group_name}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatDate(visit.scheduled_at)}
                      </p>
                    </div>
                    {visit.can_cancel && (
                      <button
                        onClick={() => handleCancel(visit.meeting_id)}
                        className="text-sm text-red-600 hover:text-red-700 font-medium"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Upcoming Meetings */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            Your Upcoming Meetings
          </h2>
          {meetings.length === 0 ? (
            <p className="text-slate-500">No upcoming meetings.</p>
          ) : (
            <div className="space-y-3">
              {meetings.map((meeting) => (
                <div
                  key={meeting.meeting_id}
                  className="p-4 bg-white border border-slate-200 rounded-lg flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      Week {meeting.meeting_number} — {meeting.group_name}
                    </p>
                    <p className="text-sm text-slate-500">
                      {formatDate(meeting.scheduled_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleCantAttend(meeting.meeting_id)}
                    className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Can't attend
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Alternative Meetings */}
        {selectedMeeting && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              Available Alternatives
            </h2>
            {alternatives.length === 0 ? (
              <p className="text-slate-500">
                No alternative meetings available for this week.
              </p>
            ) : (
              <div className="space-y-3">
                {alternatives.map((alt) => (
                  <div
                    key={alt.meeting_id}
                    className="p-4 bg-white border border-emerald-200 rounded-lg flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {alt.group_name}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatDate(alt.scheduled_at)}
                        {alt.facilitator_name && ` — Facilitated by ${alt.facilitator_name}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleSelectAlternative(alt.meeting_id)}
                      disabled={submitting}
                      className="text-sm px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                      {submitting ? "Joining..." : "Join this meeting"}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setSelectedMeeting(null);
                setAlternatives([]);
              }}
              className="mt-4 text-sm text-slate-500 hover:text-slate-700"
            >
              Back
            </button>
          </section>
        )}

        {/* Past Guest Visits */}
        {guestVisits.filter((v) => v.is_past).length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              Past Guest Visits
            </h2>
            <div className="space-y-3">
              {guestVisits
                .filter((v) => v.is_past)
                .map((visit) => (
                  <div
                    key={visit.attendance_id}
                    className="p-4 bg-slate-50 border border-slate-100 rounded-lg"
                  >
                    <p className="font-medium text-slate-600">
                      Week {visit.meeting_number} with {visit.group_name}
                    </p>
                    <p className="text-sm text-slate-400">
                      {formatDate(visit.scheduled_at)}
                    </p>
                  </div>
                ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Verify frontend builds**

Run:
```bash
cd web_frontend && npm run build
```
Expected: Build succeeds.

**Step 4: Verify lint passes**

Run:
```bash
cd web_frontend && npm run lint
```
Expected: No errors.

**Step 5: Commit**

```
feat: add /reschedule page for guest meeting visits
```

---

### Task 11: Integration Test — End-to-End Verification

**Step 1: Run all backend tests**

```bash
.venv/bin/pytest -v
```
Expected: All pass.

**Step 2: Run frontend build + lint**

```bash
cd web_frontend && npm run lint && npm run build
```
Expected: Both pass.

**Step 3: Run ruff checks**

```bash
ruff check . && ruff format --check .
```
Expected: Clean.

**Step 4: Manual smoke test**

Start the dev server and verify:
1. `/reschedule` page loads
2. API endpoints respond correctly
3. No console errors

**Step 5: Final commit with any fixes**

```
chore: fix any lint/type issues from guest visit implementation
```
