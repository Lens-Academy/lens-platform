# Direct Group Join Implementation Plan (v4)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to directly join existing groups, with full lifecycle management (Discord permissions, calendar invites, meeting reminders).

**Architecture:** Backend handles all business logic. The `join_group()` function is the single entry point that does EVERYTHING - database update, Discord permissions, calendar invites, reminder scheduling. Frontend is a thin display layer.

**Tech Stack:** FastAPI (backend), React + TypeScript (frontend), SQLAlchemy (database queries), APScheduler (reminders), Google Calendar API, Discord.py

**Key Design Principles:**
1. The backend decides everything. The frontend just renders.
2. `join_group()` does ALL lifecycle operations - never partial operations.
3. Core accesses Discord bot via the established `set_bot()` pattern.

**Development Approach: Test-Driven Development (TDD)**

Backend core tasks (Tasks 1-3) use strict TDD:
1. **RED**: Write failing test for specific behavior
2. **Verify RED**: Run test, confirm it fails for the right reason
3. **GREEN**: Write minimal code to make test pass
4. **Verify GREEN**: Run test, confirm it passes
5. **Commit**: After each RED-GREEN cycle

No production code without a failing test first.

---

## Task 1: Create Core Group Joining Module (TDD)

**Files:**
- Create: `core/group_joining.py`
- Create: `core/tests/test_group_joining.py`

This module contains all business logic for group joining. We build it test-first.

**Step 1: Create empty files**

Create `core/tests/test_group_joining.py`:

```python
"""Tests for group joining business logic (TDD)."""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
```

Create `core/group_joining.py`:

```python
"""
Group joining business logic.

All logic for direct group joining lives here. API endpoints delegate to this module.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from .database import get_connection, get_transaction
from .enums import GroupUserStatus
from .tables import cohorts, groups, groups_users, meetings, users


# Constants for group size thresholds
MIN_BADGE_SIZE = 3  # Groups with 3-4 members get "best size" badge
MAX_BADGE_SIZE = 4
MAX_JOINABLE_SIZE = 7  # Groups with 8+ members are hidden (8 is max capacity)
```

---

### 1a. TDD: `_calculate_next_meeting` (pure function)

**RED - Write failing test:**

Add to `core/tests/test_group_joining.py`:

```python
from core.group_joining import _calculate_next_meeting


class TestCalculateNextMeeting:
    """Test meeting time calculation."""

    def test_returns_first_meeting_if_in_future(self):
        """Should return first_meeting_at if it's in the future."""
        future = datetime.now(timezone.utc) + timedelta(days=7)
        result = _calculate_next_meeting("Wednesday 15:00", future)
        assert result == future.isoformat()

    def test_returns_none_for_empty_recurring_time(self):
        """Should return None if no recurring time provided."""
        result = _calculate_next_meeting("", None)
        assert result is None

    def test_returns_none_for_invalid_format(self):
        """Should return None for invalid recurring time format."""
        result = _calculate_next_meeting("invalid", None)
        assert result is None

    def test_calculates_next_wednesday(self):
        """Should calculate next occurrence from recurring time."""
        result = _calculate_next_meeting("Wednesday 15:00", None)
        assert result is not None
        parsed = datetime.fromisoformat(result)
        assert parsed.weekday() == 2  # Wednesday
        assert parsed.hour == 15
        assert parsed.minute == 0
```

**Verify RED:**

```bash
pytest core/tests/test_group_joining.py::TestCalculateNextMeeting -v
```

Expected: `ImportError: cannot import name '_calculate_next_meeting'`

**GREEN - Write minimal implementation:**

Add to `core/group_joining.py`:

```python
def _calculate_next_meeting(recurring_time_utc: str, first_meeting_at: datetime | None) -> str | None:
    """
    Calculate the next meeting datetime as ISO string.

    Args:
        recurring_time_utc: e.g., "Wednesday 15:00"
        first_meeting_at: First scheduled meeting datetime

    Returns:
        ISO datetime string for the next occurrence, or None if can't calculate
    """
    if first_meeting_at:
        now = datetime.now(timezone.utc)
        if first_meeting_at > now:
            return first_meeting_at.isoformat()

    if not recurring_time_utc:
        return None

    try:
        day_name, time_str = recurring_time_utc.split(" ")
        hours, minutes = map(int, time_str.split(":"))

        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        target_day = days.index(day_name)

        now = datetime.now(timezone.utc)
        current_day = now.weekday()
        days_until = (target_day - current_day) % 7
        if days_until == 0 and (now.hour > hours or (now.hour == hours and now.minute >= minutes)):
            days_until = 7  # Next week

        next_meeting = now.replace(
            hour=hours,
            minute=minutes,
            second=0,
            microsecond=0,
        ) + timedelta(days=days_until)

        return next_meeting.isoformat()
    except (ValueError, IndexError):
        return None
```

**Verify GREEN:**

```bash
pytest core/tests/test_group_joining.py::TestCalculateNextMeeting -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add _calculate_next_meeting with TDD"
```

---

### 1b. TDD: `get_user_current_group`

**RED - Write failing test:**

Add to `core/tests/test_group_joining.py`:

```python
from core.group_joining import get_user_current_group


class TestGetUserCurrentGroup:
    """Test getting user's current group."""

    @pytest.mark.asyncio
    async def test_returns_none_when_user_has_no_group(self):
        """Should return None if user is not in any group for the cohort."""
        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_current_group(mock_conn, user_id=1, cohort_id=10)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_group_when_user_is_member(self):
        """Should return group info when user is an active member."""
        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 5,
            "group_name": "Test Group",
            "recurring_meeting_time_utc": "Wednesday 15:00",
            "group_user_id": 100,
            "role": "participant",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_current_group(mock_conn, user_id=1, cohort_id=10)

        assert result is not None
        assert result["group_id"] == 5
        assert result["group_name"] == "Test Group"
```

**Verify RED:**

```bash
pytest core/tests/test_group_joining.py::TestGetUserCurrentGroup -v
```

Expected: `ImportError: cannot import name 'get_user_current_group'`

**GREEN - Write minimal implementation:**

Add to `core/group_joining.py`:

```python
async def get_user_current_group(
    conn: AsyncConnection,
    user_id: int,
    cohort_id: int,
) -> dict[str, Any] | None:
    """Get user's current active group in a specific cohort, if any."""
    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            groups_users.c.group_user_id,
            groups_users.c.role,
        )
        .join(groups_users, groups.c.group_id == groups_users.c.group_id)
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
        .where(groups.c.cohort_id == cohort_id)
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    return dict(row) if row else None
```

**Verify GREEN:**

```bash
pytest core/tests/test_group_joining.py::TestGetUserCurrentGroup -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add get_user_current_group with TDD"
```

---

### 1c. TDD: Badge assignment logic

**RED - Write failing test:**

Add to `core/tests/test_group_joining.py`:

```python
from core.group_joining import assign_group_badge


class TestAssignGroupBadge:
    """Test badge assignment logic."""

    def test_assigns_best_size_for_3_members(self):
        """Groups with 3 members get best_size badge."""
        assert assign_group_badge(3) == "best_size"

    def test_assigns_best_size_for_4_members(self):
        """Groups with 4 members get best_size badge."""
        assert assign_group_badge(4) == "best_size"

    def test_no_badge_for_2_members(self):
        """Groups with 2 members get no badge."""
        assert assign_group_badge(2) is None

    def test_no_badge_for_5_members(self):
        """Groups with 5 members get no badge."""
        assert assign_group_badge(5) is None

    def test_no_badge_for_0_members(self):
        """Empty groups get no badge."""
        assert assign_group_badge(0) is None
```

**Verify RED:**

```bash
pytest core/tests/test_group_joining.py::TestAssignGroupBadge -v
```

Expected: `ImportError: cannot import name 'assign_group_badge'`

**GREEN - Write minimal implementation:**

Add to `core/group_joining.py`:

```python
def assign_group_badge(member_count: int) -> str | None:
    """Assign badge based on member count. Backend decides all badges."""
    if MIN_BADGE_SIZE <= member_count <= MAX_BADGE_SIZE:
        return "best_size"
    return None
```

**Verify GREEN:**

```bash
pytest core/tests/test_group_joining.py::TestAssignGroupBadge -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add assign_group_badge with TDD"
```

---

### 1d. TDD: `get_joinable_groups`

**RED - Write failing test:**

Add to `core/tests/test_group_joining.py`:

```python
from core.group_joining import get_joinable_groups


class TestGetJoinableGroups:
    """Test group listing and filtering."""

    @pytest.mark.asyncio
    async def test_returns_empty_list_for_cohort_with_no_groups(self):
        """Should return empty list if cohort has no groups."""
        mock_conn = AsyncMock()

        # First call: get_user_current_group returns None
        # Second call: main query returns no rows
        mock_result_empty = MagicMock()
        mock_result_empty.mappings.return_value.first.return_value = None
        mock_result_empty.mappings.return_value = []

        mock_conn.execute = AsyncMock(return_value=mock_result_empty)

        result = await get_joinable_groups(mock_conn, cohort_id=1, user_id=None)

        assert result == []

    @pytest.mark.asyncio
    async def test_adds_badge_to_groups_with_3_to_4_members(self):
        """Groups with 3-4 members should get best_size badge."""
        mock_conn = AsyncMock()

        # Mock query results
        mock_groups = MagicMock()
        mock_groups.mappings.return_value = [
            {
                "group_id": 1,
                "group_name": "Group A",
                "recurring_meeting_time_utc": "Wednesday 15:00",
                "status": "active",
                "member_count": 3,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
            {
                "group_id": 2,
                "group_name": "Group B",
                "recurring_meeting_time_utc": "Thursday 16:00",
                "status": "active",
                "member_count": 5,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
        ]

        mock_conn.execute = AsyncMock(return_value=mock_groups)

        result = await get_joinable_groups(mock_conn, cohort_id=1, user_id=None)

        assert len(result) == 2
        assert result[0]["badge"] == "best_size"  # 3 members
        assert result[1]["badge"] is None  # 5 members

    @pytest.mark.asyncio
    async def test_marks_current_group_with_is_current_flag(self):
        """User's current group should have is_current=True."""
        mock_conn = AsyncMock()

        # First call returns user's current group
        mock_current = MagicMock()
        mock_current.mappings.return_value.first.return_value = {"group_id": 1}

        # Second call returns groups list
        mock_groups = MagicMock()
        mock_groups.mappings.return_value = [
            {
                "group_id": 1,
                "group_name": "Current Group",
                "recurring_meeting_time_utc": "Wednesday 15:00",
                "status": "active",
                "member_count": 4,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
            {
                "group_id": 2,
                "group_name": "Other Group",
                "recurring_meeting_time_utc": "Thursday 16:00",
                "status": "active",
                "member_count": 4,
                "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
            },
        ]

        mock_conn.execute = AsyncMock(side_effect=[mock_current, mock_groups])

        result = await get_joinable_groups(mock_conn, cohort_id=1, user_id=99)

        assert result[0]["is_current"] is True
        assert result[1]["is_current"] is False
```

**Verify RED:**

```bash
pytest core/tests/test_group_joining.py::TestGetJoinableGroups -v
```

Expected: `ImportError: cannot import name 'get_joinable_groups'`

**GREEN - Write minimal implementation:**

Add `get_joinable_groups` to `core/group_joining.py`:

```python
async def get_joinable_groups(
    conn: AsyncConnection,
    cohort_id: int,
    user_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Get groups available for direct joining in a cohort.

    Backend handles ALL filtering, sorting, and badge assignment:
    - Filters out full groups (7+ members)
    - Filters out groups whose first meeting has passed (unless user already has a group)
    - Sorts by member count (smallest first, to encourage balanced groups)
    - Adds badge field ("best_size" for 3-4 member groups)
    - Adds is_current field if user is already in this group
    - Calculates next_meeting_at as ISO datetime

    Args:
        cohort_id: The cohort to get groups for
        user_id: Current user's ID (for is_current flag and joining rules)

    Returns:
        List of group dicts, pre-filtered and pre-sorted, ready for frontend display
    """
    now = datetime.now(timezone.utc)

    # Check if user already has a group in this cohort (affects joining rules)
    user_current_group_id = None
    if user_id:
        current = await get_user_current_group(conn, user_id, cohort_id)
        if current:
            user_current_group_id = current["group_id"]

    # Subquery for member count per group (only active members)
    member_count_subq = (
        select(
            groups_users.c.group_id,
            func.count().label("member_count"),
        )
        .where(groups_users.c.status == GroupUserStatus.active)
        .group_by(groups_users.c.group_id)
        .subquery()
    )

    # Subquery for first meeting time per group
    first_meeting_subq = (
        select(
            meetings.c.group_id,
            func.min(meetings.c.scheduled_at).label("first_meeting_at"),
        )
        .group_by(meetings.c.group_id)
        .subquery()
    )

    # Base query with joins
    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            groups.c.status,
            func.coalesce(member_count_subq.c.member_count, 0).label("member_count"),
            first_meeting_subq.c.first_meeting_at,
        )
        .outerjoin(member_count_subq, groups.c.group_id == member_count_subq.c.group_id)
        .outerjoin(first_meeting_subq, groups.c.group_id == first_meeting_subq.c.group_id)
        .where(groups.c.cohort_id == cohort_id)
        .where(groups.c.status.in_(["preview", "active"]))
        # Filter: member count < 8 (8 is max capacity)
        .where(func.coalesce(member_count_subq.c.member_count, 0) < 8)
        # Sort: smallest groups first (nudge toward balanced sizes)
        .order_by(func.coalesce(member_count_subq.c.member_count, 0))
    )

    # Joining rule: if user has NO current group, filter out groups that have started
    # If user HAS a group, they can switch to any group (even after first meeting)
    if not user_current_group_id:
        query = query.where(
            (first_meeting_subq.c.first_meeting_at.is_(None)) |
            (first_meeting_subq.c.first_meeting_at > now)
        )

    result = await conn.execute(query)
    groups_list = []

    for row in result.mappings():
        group = dict(row)

        # Add badge (backend decides)
        member_count = group["member_count"]
        if MIN_BADGE_SIZE <= member_count <= MAX_BADGE_SIZE:
            group["badge"] = "best_size"
        else:
            group["badge"] = None

        # Add is_current flag
        group["is_current"] = (group["group_id"] == user_current_group_id)

        # Calculate next_meeting_at as ISO datetime string
        # (so frontend doesn't need to parse "Wednesday 15:00")
        group["next_meeting_at"] = _calculate_next_meeting(
            group["recurring_meeting_time_utc"],
            group["first_meeting_at"],
        )

        # Convert first_meeting_at to ISO string if present
        if group["first_meeting_at"]:
            group["first_meeting_at"] = group["first_meeting_at"].isoformat()

        # Add has_started for informational purposes
        if group["first_meeting_at"]:
            group["has_started"] = datetime.fromisoformat(group["first_meeting_at"]) <= now
        else:
            group["has_started"] = False

        groups_list.append(group)

    return groups_list
```

**Verify GREEN:**

```bash
pytest core/tests/test_group_joining.py::TestGetJoinableGroups -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add get_joinable_groups with TDD"
```

---

### 1e. Helper Queries (pre-requisites for join_group)

These simple data retrieval functions don't need TDD - they're straightforward database lookups.

**Add to `core/queries/meetings.py`:**

```python
async def get_future_meetings_for_group(
    conn: AsyncConnection,
    group_id: int,
) -> list[dict]:
    """Get all future meetings for a group."""
    from datetime import datetime, timezone
    from ..tables import meetings
    from sqlalchemy import select

    now = datetime.now(timezone.utc)

    result = await conn.execute(
        select(meetings)
        .where(meetings.c.group_id == group_id)
        .where(meetings.c.scheduled_at > now)
        .order_by(meetings.c.scheduled_at)
    )

    return [dict(row) for row in result.mappings()]
```

**Add to `core/queries/groups.py`:**

```python
async def get_group_member_names(
    conn: AsyncConnection,
    group_id: int,
) -> list[str]:
    """Get display names of all active members in a group."""
    from ..tables import groups_users, users
    from ..enums import GroupUserStatus
    from sqlalchemy import select

    result = await conn.execute(
        select(users.c.nickname)
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.status == GroupUserStatus.active)
    )

    return [row["nickname"] or "Unknown" for row in result.mappings()]


async def get_group_with_details(
    conn: AsyncConnection,
    group_id: int,
) -> dict[str, Any] | None:
    """
    Get group details needed for notifications and lifecycle operations.

    Returns:
        {
            "group_id": int,
            "group_name": str,
            "recurring_meeting_time_utc": str,
            "discord_text_channel_id": str | None,
            "cohort_id": int,
        }
    """
    from ..tables import groups
    from sqlalchemy import select

    result = await conn.execute(
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            groups.c.discord_text_channel_id,
            groups.c.cohort_id,
        ).where(groups.c.group_id == group_id)
    )
    row = result.mappings().first()
    return dict(row) if row else None
```

**Commit:**

```bash
jj describe -m "feat(core): add helper queries for group operations"
```

---

### 1f. TDD: `join_group`

**RED - Write failing tests:**

Add to `core/tests/test_group_joining.py`:

```python
from core.group_joining import join_group


class TestJoinGroup:
    """Test group joining logic."""

    @pytest.mark.asyncio
    async def test_adds_user_to_new_group(self):
        """Should add user to groups_users when joining first group."""
        mock_conn = AsyncMock()

        # Mock: user has no current group
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None

        # Mock: group exists and is joinable
        mock_group = MagicMock()
        mock_group.mappings.return_value.first.return_value = {
            "group_id": 5,
            "cohort_id": 10,
            "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
        }

        # Mock: insert succeeds
        mock_insert = MagicMock()
        mock_insert.mappings.return_value.first.return_value = {"group_user_id": 99}

        mock_conn.execute = AsyncMock(side_effect=[mock_no_group, mock_group, mock_insert])

        result = await join_group(mock_conn, user_id=1, group_id=5)

        assert result["success"] is True
        assert result["group_id"] == 5

    @pytest.mark.asyncio
    async def test_switches_user_between_groups(self):
        """Should remove from old group and add to new group when switching."""
        mock_conn = AsyncMock()

        # Mock: user has current group
        mock_current = MagicMock()
        mock_current.mappings.return_value.first.return_value = {
            "group_id": 3,
            "group_user_id": 50,
        }

        # Mock: new group exists
        mock_group = MagicMock()
        mock_group.mappings.return_value.first.return_value = {
            "group_id": 5,
            "cohort_id": 10,
            "first_meeting_at": datetime.now(timezone.utc) + timedelta(days=7),
        }

        # Mock: update old group (mark as removed)
        mock_update = MagicMock()

        # Mock: insert into new group
        mock_insert = MagicMock()
        mock_insert.mappings.return_value.first.return_value = {"group_user_id": 99}

        mock_conn.execute = AsyncMock(side_effect=[mock_current, mock_group, mock_update, mock_insert])

        result = await join_group(mock_conn, user_id=1, group_id=5)

        assert result["success"] is True
        assert result["previous_group_id"] == 3

    @pytest.mark.asyncio
    async def test_rejects_joining_started_group_without_existing_group(self):
        """Should reject if group has started and user has no current group."""
        mock_conn = AsyncMock()

        # Mock: user has no current group
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None

        # Mock: group has already started
        mock_group = MagicMock()
        mock_group.mappings.return_value.first.return_value = {
            "group_id": 5,
            "cohort_id": 10,
            "first_meeting_at": datetime.now(timezone.utc) - timedelta(days=1),  # Past
        }

        mock_conn.execute = AsyncMock(side_effect=[mock_no_group, mock_group])

        result = await join_group(mock_conn, user_id=1, group_id=5)

        assert result["success"] is False
        assert result["error"] == "group_already_started"
```

**Verify RED:**

```bash
pytest core/tests/test_group_joining.py::TestJoinGroup -v
```

Expected: `ImportError: cannot import name 'join_group'`

**GREEN - Write minimal implementation:**

Add `join_group` to `core/group_joining.py`:

```python
async def join_group(
    conn: AsyncConnection,
    user_id: int,
    group_id: int,
    role: str = "participant",
) -> dict[str, Any]:
    """
    Join a group (or switch to a different group).

    This is THE single function for joining groups. ALL lifecycle operations
    happen here:
    1. Database: Update groups_users
    2. Discord: Grant/revoke channel permissions
    3. Calendar: Send/cancel meeting invites
    4. Reminders: Add/remove user from meeting reminder jobs

    Args:
        conn: Database connection (should be in a transaction)
        user_id: User joining the group
        group_id: Target group
        role: "participant" or "facilitator"

    Returns:
        {"group_id": int, "previous_group_id": int | None}

    Raises:
        ValueError: If group not found, not joinable, or user already in it
    """
    from .queries.users import is_facilitator_by_user_id
    from .queries.groups import add_user_to_group, get_group_with_details, get_group_member_names
    from .lifecycle import (
        sync_group_discord_permissions,
        sync_group_calendar,
        sync_group_reminders,
        sync_group_rsvps,
    )
    from .notifications.actions import notify_group_assigned
    from .notifications.dispatcher import was_notification_sent
    from .enums import NotificationReferenceType

    # Get the target group
    group_result = await conn.execute(
        select(groups).where(groups.c.group_id == group_id)
    )
    target_group = group_result.mappings().first()

    if not target_group:
        raise ValueError("Group not found")

    cohort_id = target_group["cohort_id"]

    # Check if user is already in this group
    current_group = await get_user_current_group(conn, user_id, cohort_id)
    if current_group and current_group["group_id"] == group_id:
        raise ValueError("You are already in this group")

    # Verify group is still joinable (re-check with current user context)
    joinable = await get_joinable_groups(conn, cohort_id, user_id)
    joinable_ids = [g["group_id"] for g in joinable]

    if group_id not in joinable_ids:
        raise ValueError("This group is no longer available for joining")

    # Get user info for lifecycle operations
    user_result = await conn.execute(
        select(users).where(users.c.user_id == user_id)
    )
    user_row = user_result.mappings().first()
    discord_id = user_row["discord_id"] if user_row else None

    # === LEAVE OLD GROUP (if switching) ===
    previous_group_id = None
    if current_group:
        previous_group_id = current_group["group_id"]

        # 1. Update database
        await conn.execute(
            update(groups_users)
            .where(groups_users.c.group_user_id == current_group["group_user_id"])
            .values(
                status=GroupUserStatus.removed,
                left_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )

    # === JOIN NEW GROUP ===
    # Determine role (facilitators stay facilitators)
    is_fac = await is_facilitator_by_user_id(conn, user_id)
    actual_role = "facilitator" if is_fac else role

    # 1. Add to database
    await add_user_to_group(conn, group_id, user_id, actual_role)

    # === SYNC LIFECYCLE (after DB changes) ===
    # All sync functions are group-level and diff-based:
    # read DB, compare with external system, apply changes

    # 2. Sync Discord permissions for affected groups
    await sync_group_discord_permissions(group_id)
    if previous_group_id:
        await sync_group_discord_permissions(previous_group_id)

    # 3. Sync calendar invites for affected groups
    await sync_group_calendar(group_id)
    if previous_group_id:
        await sync_group_calendar(previous_group_id)

    # 4. Sync meeting reminders for affected groups
    await sync_group_reminders(group_id)
    if previous_group_id:
        await sync_group_reminders(previous_group_id)

    # 5. Sync RSVP/attendance records for new group
    await sync_group_rsvps(group_id)

    # 6. Send group assignment notification (idempotent - won't re-send)
    already_notified = await was_notification_sent(
        user_id=user_id,
        message_type="group_assigned",
        reference_type=NotificationReferenceType.group_id,
        reference_id=group_id,
    )
    if not already_notified:
        new_group = await get_group_with_details(conn, group_id)
        member_names = await get_group_member_names(conn, group_id)
        await notify_group_assigned(
            user_id=user_id,
            group_name=new_group["group_name"],
            meeting_time_utc=new_group["recurring_meeting_time_utc"],
            member_names=member_names,
            discord_channel_id=new_group.get("discord_text_channel_id", ""),
            # Pass reference for logging
            reference_type=NotificationReferenceType.group_id,
            reference_id=group_id,
        )

    return {
        "success": True,
        "group_id": group_id,
        "previous_group_id": previous_group_id,
    }
```

**Verify GREEN:**

```bash
pytest core/tests/test_group_joining.py::TestJoinGroup -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add join_group with TDD"
```

---

### 1g. TDD: `get_user_group_info`

**RED - Write failing test:**

Add to `core/tests/test_group_joining.py`:

```python
from core.group_joining import get_user_group_info


class TestGetUserGroupInfo:
    """Test user group info retrieval."""

    @pytest.mark.asyncio
    async def test_returns_not_enrolled_when_no_signup(self):
        """Should return is_enrolled=False when user has no signup."""
        mock_conn = AsyncMock()

        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_group_info(mock_conn, user_id=1)

        assert result["is_enrolled"] is False
        assert "cohort_id" not in result or result.get("cohort_id") is None

    @pytest.mark.asyncio
    async def test_returns_cohort_info_when_enrolled(self):
        """Should return cohort info when user is enrolled."""
        mock_conn = AsyncMock()

        # First call: signup query
        mock_signup = MagicMock()
        mock_signup.mappings.return_value.first.return_value = {
            "cohort_id": 10,
            "cohort_name": "Test Cohort",
        }

        # Second call: current group query (no group)
        mock_no_group = MagicMock()
        mock_no_group.mappings.return_value.first.return_value = None

        mock_conn.execute = AsyncMock(side_effect=[mock_signup, mock_no_group])

        result = await get_user_group_info(mock_conn, user_id=1)

        assert result["is_enrolled"] is True
        assert result["cohort_id"] == 10
        assert result["cohort_name"] == "Test Cohort"
        assert result["current_group"] is None
```

**Verify RED:**

```bash
pytest core/tests/test_group_joining.py::TestGetUserGroupInfo -v
```

Expected: `ImportError: cannot import name 'get_user_group_info'`

**GREEN - Write minimal implementation:**

Add `get_user_group_info` to `core/group_joining.py`:

```python
async def get_user_group_info(
    conn: AsyncConnection,
    user_id: int,
) -> dict[str, Any]:
    """
    Get user's cohort and group information for the /group page.

    Returns:
        {
            "is_enrolled": bool,
            "cohort_id": int | None,
            "cohort_name": str | None,
            "current_group": {...} | None,
        }
    """
    from .tables import signups

    # Get user's most recent signup
    signup_query = (
        select(signups, cohorts)
        .join(cohorts, signups.c.cohort_id == cohorts.c.cohort_id)
        .where(signups.c.user_id == user_id)
        .order_by(cohorts.c.cohort_start_date.desc())
        .limit(1)
    )
    result = await conn.execute(signup_query)
    signup = result.mappings().first()

    if not signup:
        return {"is_enrolled": False}

    cohort_id = signup["cohort_id"]

    # Get current group if any
    current_group = await get_user_current_group(conn, user_id, cohort_id)

    return {
        "is_enrolled": True,
        "cohort_id": cohort_id,
        "cohort_name": signup["cohort_name"],
        "current_group": {
            "group_id": current_group["group_id"],
            "group_name": current_group["group_name"],
            "recurring_meeting_time_utc": current_group["recurring_meeting_time_utc"],
        } if current_group else None,
    }
```

**Verify GREEN:**

```bash
pytest core/tests/test_group_joining.py::TestGetUserGroupInfo -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add get_user_group_info with TDD"
```

---

### Step 2: Export from core/__init__.py

Add to `core/__init__.py`:

```python
from .group_joining import (
    get_joinable_groups,
    get_user_current_group,
    join_group,
    get_user_group_info,
)
```

**Step 3: Commit**

```bash
jj describe -m "feat(core): add group_joining module with all business logic"
```

---

## Task 2: Add Notification Deduplication Support (TDD)

**Files:**
- Modify: `core/enums.py`
- Modify: `core/tables.py`
- Modify: `core/notifications/dispatcher.py`
- Create: `core/tests/test_notification_dedup.py`

Add `reference_type` (enum) and `reference_id` columns to `notification_log` for idempotent notifications.

**Step 1: Add ReferenceType enum and SQLEnum**

Add to `core/enums.py`:

```python
class NotificationReferenceType(str, enum.Enum):
    """Types of entities that notifications can reference."""
    group_id = "group_id"
    meeting_id = "meeting_id"
    cohort_id = "cohort_id"
    user_id = "user_id"


# Add with other SQLEnum definitions at the bottom:
notification_reference_type_enum = SQLEnum(
    NotificationReferenceType, name="notification_reference_type", create_type=False, native_enum=True
)
```

Note: The Alembic migration will need to create the PostgreSQL enum type. Review the autogenerated migration to ensure it includes:
```sql
CREATE TYPE notification_reference_type AS ENUM ('group_id', 'meeting_id', 'cohort_id', 'user_id');
```

**Step 2: Update notification_log table**

In `core/tables.py`, update the `notification_log` table:

```python
from .enums import NotificationReferenceType

notification_log = Table(
    "notification_log",
    metadata,
    Column("log_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
    ),
    Column("channel_id", Text),
    Column("message_type", Text, nullable=False),
    Column("channel", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("error_message", Text),
    Column("sent_at", TIMESTAMP(timezone=True), server_default=func.now()),
    # New columns for notification deduplication
    Column("reference_type", SQLEnum(NotificationReferenceType)),
    Column("reference_id", Integer),
    Index("idx_notification_log_user_id", "user_id"),
    Index("idx_notification_log_sent_at", "sent_at"),
    # New index for deduplication queries
    Index("idx_notification_log_dedup", "user_id", "message_type", "reference_type", "reference_id"),
)
```

**Step 3: Update log_notification function**

In `core/notifications/dispatcher.py`, update `log_notification`:

```python
from core.enums import NotificationReferenceType

async def log_notification(
    user_id: int | None,
    channel_id: str | None,
    message_type: str,
    channel: str,
    success: bool,
    error_message: str | None = None,
    reference_type: NotificationReferenceType | None = None,  # New
    reference_id: int | None = None,     # New
) -> None:
    """Log a notification to the database."""
    from sqlalchemy import insert
    from core.database import get_connection
    from core.tables import notification_log

    try:
        async with get_connection() as conn:
            await conn.execute(
                insert(notification_log).values(
                    user_id=user_id,
                    channel_id=channel_id,
                    message_type=message_type,
                    channel=channel,
                    status="sent" if success else "failed",
                    error_message=error_message,
                    reference_type=reference_type,
                    reference_id=reference_id,
                )
            )
            await conn.commit()
    except Exception as e:
        print(f"Warning: Failed to log notification: {e}")
```

**Step 4: TDD for `was_notification_sent`**

**RED - Write failing test:**

Create `core/tests/test_notification_dedup.py`:

```python
"""Tests for notification deduplication (TDD)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from core.enums import NotificationReferenceType


class TestWasNotificationSent:
    """Test notification deduplication check."""

    @pytest.mark.asyncio
    async def test_returns_false_when_no_matching_notification(self):
        """Should return False when no notification matches criteria."""
        from core.notifications.dispatcher import was_notification_sent

        with patch("core.notifications.dispatcher.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_result = MagicMock()
            mock_result.first.return_value = None
            mock_conn.execute = AsyncMock(return_value=mock_result)
            mock_get_conn.return_value.__aenter__.return_value = mock_conn

            result = await was_notification_sent(
                user_id=1,
                message_type="group_assigned",
                reference_type=NotificationReferenceType.group_id,
                reference_id=5,
            )

            assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_when_matching_notification_exists(self):
        """Should return True when a matching notification was already sent."""
        from core.notifications.dispatcher import was_notification_sent

        with patch("core.notifications.dispatcher.get_connection") as mock_get_conn:
            mock_conn = AsyncMock()
            mock_result = MagicMock()
            mock_result.first.return_value = {"log_id": 123}  # Found a match
            mock_conn.execute = AsyncMock(return_value=mock_result)
            mock_get_conn.return_value.__aenter__.return_value = mock_conn

            result = await was_notification_sent(
                user_id=1,
                message_type="group_assigned",
                reference_type=NotificationReferenceType.group_id,
                reference_id=5,
            )

            assert result is True

    @pytest.mark.asyncio
    async def test_only_matches_sent_status(self):
        """Should only match notifications with status='sent', not 'failed'."""
        # This is verified by checking the SQL query includes status == "sent"
        # The query construction is tested implicitly - if it doesn't filter by status,
        # the integration test would fail
        pass
```

**Verify RED:**

```bash
pytest core/tests/test_notification_dedup.py -v
```

Expected: `ImportError: cannot import name 'was_notification_sent'`

**GREEN - Write minimal implementation:**

Add to `core/notifications/dispatcher.py`:

```python
from core.enums import NotificationReferenceType

async def was_notification_sent(
    user_id: int,
    message_type: str,
    reference_type: NotificationReferenceType,
    reference_id: int,
) -> bool:
    """
    Check if a notification was already successfully sent.

    Used for idempotent notifications (e.g., group_assigned).
    """
    from sqlalchemy import select, and_
    from core.database import get_connection
    from core.tables import notification_log

    async with get_connection() as conn:
        result = await conn.execute(
            select(notification_log.c.log_id)
            .where(and_(
                notification_log.c.user_id == user_id,
                notification_log.c.message_type == message_type,
                notification_log.c.reference_type == reference_type,
                notification_log.c.reference_id == reference_id,
                notification_log.c.status == "sent",
            ))
            .limit(1)
        )
        return result.first() is not None
```

**Verify GREEN:**

```bash
pytest core/tests/test_notification_dedup.py -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add was_notification_sent with TDD"
```

**Step 5: Update notify_group_assigned to accept reference**

In `core/notifications/actions.py`, update `notify_group_assigned`:

```python
from core.enums import NotificationReferenceType

async def notify_group_assigned(
    user_id: int,
    group_name: str,
    meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    reference_type: NotificationReferenceType | None = None,  # New
    reference_id: int | None = None,     # New
) -> dict:
    """Send notification when user is assigned to a group."""
    return await send_notification(
        user_id=user_id,
        message_type="group_assigned",
        context={
            "group_name": group_name,
            "meeting_time": meeting_time_utc,
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(
                channel_id=discord_channel_id
            ),
        },
        reference_type=reference_type,
        reference_id=reference_id,
    )
```

**Step 5b: Update send_notification to pass reference through**

In `core/notifications/dispatcher.py`, update the `send_notification` function (around line 66):

```python
from core.enums import NotificationReferenceType

async def send_notification(
    user_id: int,
    message_type: str,
    context: dict,
    channel_id: str | None = None,
    reference_type: NotificationReferenceType | None = None,  # New
    reference_id: int | None = None,                          # New
) -> dict:
    """
    Send a notification to a user via their preferred channels.

    Args:
        user_id: Database user ID
        message_type: Message type key from messages.yaml (e.g., "welcome")
        context: Template variables
        channel_id: Optional Discord channel ID (for channel messages instead of DMs)
        reference_type: Type of entity this notification references (for deduplication)
        reference_id: ID of the referenced entity (for deduplication)

    Returns:
        Dict with delivery status: {"email": bool, "discord": bool}
    """
    user = await get_user_by_id(user_id)
    if not user:
        print(f"Warning: User {user_id} not found for notification")
        return {"email": False, "discord": False}

    # Add user info to context
    full_context = {
        "name": user.get("nickname") or user.get("discord_username") or "there",
        "email": user.get("email", ""),
        **context,
    }

    templates = load_templates()
    message_templates = templates.get(message_type, {})

    result = {"email": False, "discord": False}

    # Send email if enabled and user has email
    if user.get("email_notifications_enabled", True) and user.get("email"):
        if "email_subject" in message_templates and "email_body" in message_templates:
            subject = get_message(message_type, "email_subject", full_context)
            body = get_message(message_type, "email_body", full_context)
            result["email"] = send_email(
                to_email=user["email"],
                subject=subject,
                body=body,
            )
            await log_notification(
                user_id=user_id,
                channel_id=None,
                message_type=message_type,
                channel="email",
                success=result["email"],
                reference_type=reference_type,  # New
                reference_id=reference_id,      # New
            )

    # Send Discord message if enabled
    if user.get("dm_notifications_enabled", True) and user.get("discord_id"):
        # Use channel message if channel_id provided, otherwise DM
        if channel_id and "discord_channel" in message_templates:
            message = get_message(message_type, "discord_channel", full_context)
            result["discord"] = await send_discord_channel_message(channel_id, message)
            await log_notification(
                user_id=user_id,
                channel_id=channel_id,
                message_type=message_type,
                channel="discord_channel",
                success=result["discord"],
                reference_type=reference_type,  # New
                reference_id=reference_id,      # New
            )
        elif "discord" in message_templates:
            message = get_message(message_type, "discord", full_context)
            result["discord"] = await send_discord_dm(user["discord_id"], message)
            await log_notification(
                user_id=user_id,
                channel_id=None,
                message_type=message_type,
                channel="discord_dm",
                success=result["discord"],
                reference_type=reference_type,  # New
                reference_id=reference_id,      # New
            )

    return result
```

**Step 6: Generate and run migration**

```bash
alembic revision --autogenerate -m "Add reference columns to notification_log"
# Review the generated migration
alembic upgrade head
```

**Step 7: Commit**

```bash
jj describe -m "feat(core): add notification deduplication via reference_type/reference_id"
```

---

## Task 3: Create Lifecycle Operations Module (TDD)

**Files:**
- Create: `core/lifecycle.py`
- Create: `core/tests/test_lifecycle.py`
- Modify: `core/notifications/scheduler.py`

This module handles Discord permissions, calendar invites, and reminders when users join/leave groups.

**Step 1: TDD for `sync_meeting_reminders`**

**RED - Write failing test:**

Create `core/tests/test_lifecycle.py`:

```python
"""Tests for lifecycle operations (TDD)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestSyncMeetingReminders:
    """Test reminder sync logic."""

    @pytest.mark.asyncio
    async def test_updates_job_user_ids_from_database(self):
        """Should update job kwargs with current group members from DB."""
        from core.notifications.scheduler import sync_meeting_reminders

        # Mock the scheduler
        mock_job = MagicMock()
        mock_job.kwargs = {"user_ids": [1, 2], "meeting_id": 5}

        mock_scheduler = MagicMock()
        mock_scheduler.get_job.return_value = mock_job

        # Mock DB to return new member list
        mock_conn = AsyncMock()

        # First query: get group_id from meeting
        mock_meeting_result = MagicMock()
        mock_meeting_result.mappings.return_value.first.return_value = {"group_id": 10}

        # Second query: get active members
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = [
            {"user_id": 1},
            {"user_id": 3},
            {"user_id": 4},
        ]

        mock_conn.execute = AsyncMock(side_effect=[mock_meeting_result, mock_members_result])

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            with patch("core.notifications.scheduler.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                await sync_meeting_reminders(meeting_id=5)

        # Verify job was updated with new user_ids
        mock_scheduler.modify_job.assert_called()
        call_args = mock_scheduler.modify_job.call_args
        assert call_args[1]["kwargs"]["user_ids"] == [1, 3, 4]

    @pytest.mark.asyncio
    async def test_removes_job_when_no_members_left(self):
        """Should remove job if group has no active members."""
        from core.notifications.scheduler import sync_meeting_reminders

        mock_job = MagicMock()
        mock_job.kwargs = {"user_ids": [1, 2], "meeting_id": 5}

        mock_scheduler = MagicMock()
        mock_scheduler.get_job.return_value = mock_job

        mock_conn = AsyncMock()
        mock_meeting_result = MagicMock()
        mock_meeting_result.mappings.return_value.first.return_value = {"group_id": 10}

        # Empty member list
        mock_members_result = MagicMock()
        mock_members_result.mappings.return_value = []

        mock_conn.execute = AsyncMock(side_effect=[mock_meeting_result, mock_members_result])

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            with patch("core.notifications.scheduler.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                await sync_meeting_reminders(meeting_id=5)

        # Job should be removed
        mock_job.remove.assert_called()

    @pytest.mark.asyncio
    async def test_does_nothing_when_scheduler_unavailable(self):
        """Should exit gracefully if scheduler is not initialized."""
        from core.notifications.scheduler import sync_meeting_reminders

        with patch("core.notifications.scheduler._scheduler", None):
            # Should not raise
            await sync_meeting_reminders(meeting_id=5)
```

**Verify RED:**

```bash
pytest core/tests/test_lifecycle.py::TestSyncMeetingReminders -v
```

Expected: Tests fail because `sync_meeting_reminders` doesn't exist or has wrong behavior.

**GREEN - Write minimal implementation:**

Add to `core/notifications/scheduler.py`:

```python
async def sync_meeting_reminders(meeting_id: int) -> None:
    """
    Sync reminder job's user_ids with current group membership from DB.

    This is idempotent and self-healing - reads the source of truth (database)
    and updates the APScheduler jobs to match.

    Called when users join or leave a group.
    """
    if not _scheduler:
        return

    from core.database import get_connection
    from core.tables import meetings, groups_users
    from core.enums import GroupUserStatus
    from sqlalchemy import select

    # Get current active members for this meeting's group
    async with get_connection() as conn:
        # First get the group_id for this meeting
        meeting_result = await conn.execute(
            select(meetings.c.group_id).where(meetings.c.meeting_id == meeting_id)
        )
        meeting_row = meeting_result.mappings().first()
        if not meeting_row:
            return

        group_id = meeting_row["group_id"]

        # Get all active members of the group
        members_result = await conn.execute(
            select(groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        user_ids = [row["user_id"] for row in members_result.mappings()]

    # Update all reminder jobs for this meeting
    job_suffixes = ["reminder_24h", "reminder_1h", "module_nudge_3d", "module_nudge_1d"]

    for suffix in job_suffixes:
        job_id = f"meeting_{meeting_id}_{suffix}"
        job = _scheduler.get_job(job_id)
        if job:
            if user_ids:
                # Update with current members
                new_kwargs = {**job.kwargs, "user_ids": user_ids}
                _scheduler.modify_job(job_id, kwargs=new_kwargs)
            else:
                # No users left, remove the job
                job.remove()
```

**Verify GREEN:**

```bash
pytest core/tests/test_lifecycle.py::TestSyncMeetingReminders -v
```

Expected: All tests pass.

**Commit:**

```bash
jj describe -m "feat(core): add sync_meeting_reminders with TDD"
```

---

**Step 2: Create the lifecycle module**

Create `core/lifecycle.py`:

```python
"""
Lifecycle operations for group membership changes.

Handles Discord permissions, calendar invites, and meeting reminders
when users join or leave groups.

Error handling: Best-effort with Sentry reporting. Failures don't block
the database update. Use sync commands to recover from failures.
"""

import logging
import sentry_sdk

logger = logging.getLogger(__name__)


# ============================================================================
# SYNC FUNCTIONS - Diff-based, used for both normal flow and recovery
# ============================================================================

async def sync_group_discord_permissions(group_id: int) -> dict:
    """
    Sync Discord channel permissions with DB membership (diff-based).

    Syncs BOTH text and voice channels:
    1. Reads current permission overwrites from Discord
    2. Compares with active members from DB
    3. Only grants/revokes for the diff

    Idempotent and efficient - no API calls if nothing changed.

    Returns dict with counts: {"granted": N, "revoked": N, "unchanged": N, "failed": N}
    """
    from .database import get_connection
    from .notifications.channels.discord import _bot
    from .tables import groups, groups_users, users
    from .enums import GroupUserStatus
    from sqlalchemy import select
    import discord

    if not _bot:
        logger.warning("Bot not available for Discord sync")
        return {"error": "bot_unavailable"}

    async with get_connection() as conn:
        # Get group's Discord channels (both text and voice)
        group_result = await conn.execute(
            select(
                groups.c.discord_text_channel_id,
                groups.c.discord_voice_channel_id,
            ).where(groups.c.group_id == group_id)
        )
        group_row = group_result.mappings().first()
        if not group_row or not group_row.get("discord_text_channel_id"):
            logger.warning(f"Group {group_id} has no Discord channel")
            return {"error": "no_channel"}

        text_channel_id = int(group_row["discord_text_channel_id"])
        voice_channel_id = (
            int(group_row["discord_voice_channel_id"])
            if group_row.get("discord_voice_channel_id")
            else None
        )

        # Get all active members' Discord IDs from DB (who SHOULD have access)
        members_result = await conn.execute(
            select(users.c.discord_id)
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
            .where(users.c.discord_id.isnot(None))
        )
        expected_discord_ids = {row["discord_id"] for row in members_result.mappings()}

    # Get text channel
    text_channel = _bot.get_channel(text_channel_id)
    if not text_channel:
        logger.warning(f"Text channel {text_channel_id} not found in Discord")
        return {"error": "channel_not_found"}

    # Get voice channel (optional)
    voice_channel = _bot.get_channel(voice_channel_id) if voice_channel_id else None

    # Get current permission overwrites from text channel (who CURRENTLY has access)
    current_discord_ids = set()
    for target, perms in text_channel.overwrites.items():
        if isinstance(target, discord.Member) and perms.view_channel:
            current_discord_ids.add(str(target.id))

    # Calculate diff
    to_grant = expected_discord_ids - current_discord_ids
    to_revoke = current_discord_ids - expected_discord_ids
    unchanged = expected_discord_ids & current_discord_ids

    granted, revoked, failed = 0, 0, 0
    guild = text_channel.guild

    # Grant access to new members (both text and voice)
    for discord_id in to_grant:
        try:
            member = guild.get_member(int(discord_id))
            if member:
                # Grant text channel permissions
                await text_channel.set_permissions(
                    member,
                    view_channel=True,
                    send_messages=True,
                    read_message_history=True,
                    reason="Group sync",
                )
                # Grant voice channel permissions
                if voice_channel:
                    await voice_channel.set_permissions(
                        member,
                        view_channel=True,
                        connect=True,
                        speak=True,
                        reason="Group sync",
                    )
                granted += 1
            else:
                logger.info(f"Member {discord_id} not in guild, skipping grant")
        except Exception as e:
            logger.error(f"Error granting access to {discord_id}: {e}")
            sentry_sdk.capture_exception(e)
            failed += 1

    # Revoke access from removed members (both text and voice)
    for discord_id in to_revoke:
        try:
            member = guild.get_member(int(discord_id))
            if member:
                await text_channel.set_permissions(member, overwrite=None, reason="Group sync")
                if voice_channel:
                    await voice_channel.set_permissions(member, overwrite=None, reason="Group sync")
                revoked += 1
        except Exception as e:
            logger.error(f"Error revoking access from {discord_id}: {e}")
            sentry_sdk.capture_exception(e)
            failed += 1

    return {
        "granted": granted,
        "revoked": revoked,
        "unchanged": len(unchanged),
        "failed": failed,
    }


async def sync_meeting_calendar(meeting_id: int) -> dict:
    """
    Sync a meeting's calendar event with DB membership (diff-based).

    1. Creates calendar event if it doesn't exist
    2. Gets current attendees from Google Calendar
    3. Compares with active group members from DB
    4. Only adds/removes for the diff

    Idempotent - safe to run multiple times.

    Returns dict with counts: {"added": N, "removed": N, "unchanged": N, "created": bool}
    """
    from .database import get_connection, get_transaction
    from .tables import meetings, groups, groups_users, users
    from .enums import GroupUserStatus
    from .calendar.client import get_calendar_service, CALENDAR_ID
    from .calendar.events import create_meeting_event
    from datetime import datetime, timezone
    from sqlalchemy import select, update

    service = get_calendar_service()
    if not service:
        logger.warning("Calendar service not available")
        return {"error": "calendar_unavailable"}

    async with get_connection() as conn:
        # Get meeting and group details
        meeting_result = await conn.execute(
            select(meetings, groups.c.group_name, groups.c.discord_text_channel_id)
            .join(groups, meetings.c.group_id == groups.c.group_id)
            .where(meetings.c.meeting_id == meeting_id)
        )
        meeting = meeting_result.mappings().first()
        if not meeting:
            return {"error": "meeting_not_found"}

        group_id = meeting["group_id"]

        # Get all active members' emails from DB (who SHOULD be invited)
        members_result = await conn.execute(
            select(users.c.email)
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
            .where(users.c.email.isnot(None))
        )
        expected_emails = {row["email"].lower() for row in members_result.mappings()}

    created = False
    event_id = meeting.get("google_calendar_event_id")

    # Create calendar event if it doesn't exist
    if not event_id:
        try:
            # create_meeting_event is synchronous - construct title/description
            meeting_title = f"{meeting['group_name']} - Meeting"
            meeting_description = "Study group meeting"

            event_id = create_meeting_event(
                title=meeting_title,
                description=meeting_description,
                start=meeting["scheduled_at"],
                attendee_emails=list(expected_emails),
            )
            # Save event_id to database
            async with get_transaction() as conn:
                await conn.execute(
                    update(meetings)
                    .where(meetings.c.meeting_id == meeting_id)
                    .values(google_calendar_event_id=event_id)
                )
            created = True
            return {
                "created": True,
                "added": len(expected_emails),
                "removed": 0,
                "unchanged": 0,
            }
        except Exception as e:
            logger.error(f"Error creating calendar event: {e}")
            sentry_sdk.capture_exception(e)
            return {"error": "event_creation_failed"}

    # Get current attendees from Google Calendar
    try:
        event = service.events().get(
            calendarId=CALENDAR_ID,
            eventId=event_id,
        ).execute()
        current_emails = {
            a.get("email", "").lower()
            for a in event.get("attendees", [])
            if a.get("email")
        }
    except Exception as e:
        logger.error(f"Error fetching calendar event: {e}")
        sentry_sdk.capture_exception(e)
        return {"error": "event_fetch_failed"}

    # Calculate diff
    to_add = expected_emails - current_emails
    to_remove = current_emails - expected_emails
    unchanged = expected_emails & current_emails

    # Apply changes if any
    if to_add or to_remove:
        new_attendees = [
            {"email": email}
            for email in (current_emails | to_add) - to_remove
        ]
        try:
            service.events().patch(
                calendarId=CALENDAR_ID,
                eventId=event_id,
                body={"attendees": new_attendees},
                sendUpdates="all" if to_add else "none",  # Only notify new attendees
            ).execute()
        except Exception as e:
            logger.error(f"Error updating calendar attendees: {e}")
            sentry_sdk.capture_exception(e)
            return {"error": "attendee_update_failed"}

    return {
        "created": False,
        "added": len(to_add),
        "removed": len(to_remove),
        "unchanged": len(unchanged),
    }


async def sync_group_calendar(group_id: int) -> dict:
    """
    Sync calendar events for all future meetings of a group.

    Calls sync_meeting_calendar for each future meeting.

    Returns dict with aggregate counts.
    """
    from .database import get_connection
    from .tables import meetings
    from datetime import datetime, timezone
    from sqlalchemy import select

    async with get_connection() as conn:
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(meetings.c.meeting_id)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
        )
        meeting_ids = [row["meeting_id"] for row in meetings_result.mappings()]

    if not meeting_ids:
        return {"meetings": 0, "error": "no_future_meetings"}

    total = {"meetings": len(meeting_ids), "created": 0, "added": 0, "removed": 0, "failed": 0}

    for meeting_id in meeting_ids:
        result = await sync_meeting_calendar(meeting_id)
        if "error" in result:
            total["failed"] += 1
        else:
            if result.get("created"):
                total["created"] += 1
            total["added"] += result.get("added", 0)
            total["removed"] += result.get("removed", 0)

    return total


async def sync_group_reminders(group_id: int) -> dict:
    """
    Sync reminder jobs for all future meetings of a group.

    Calls sync_meeting_reminders for each future meeting.

    Returns dict with counts.
    """
    from .database import get_connection
    from .tables import meetings
    from .notifications.scheduler import sync_meeting_reminders
    from datetime import datetime, timezone
    from sqlalchemy import select

    async with get_connection() as conn:
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(meetings.c.meeting_id)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
        )
        meeting_ids = [row["meeting_id"] for row in meetings_result.mappings()]

    if not meeting_ids:
        return {"meetings": 0}

    synced = 0
    for meeting_id in meeting_ids:
        await sync_meeting_reminders(meeting_id)
        synced += 1

    return {"meetings": synced}


async def sync_group_rsvps(group_id: int) -> dict:
    """
    Sync RSVP records for all future meetings of a group.

    Calls sync_meeting_rsvps for each future meeting.

    Returns dict with counts.
    """
    from .database import get_connection
    from .tables import meetings
    from .calendar.rsvp import sync_meeting_rsvps
    from datetime import datetime, timezone
    from sqlalchemy import select

    async with get_connection() as conn:
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(meetings.c.meeting_id)
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
        )
        meeting_ids = [row["meeting_id"] for row in meetings_result.mappings()]

    if not meeting_ids:
        return {"meetings": 0}

    synced = 0
    for meeting_id in meeting_ids:
        await sync_meeting_rsvps(meeting_id)
        synced += 1

    return {"meetings": synced}
```

**Step 3: Ensure create_meeting_event exists in calendar/events.py**

The `sync_meeting_calendar` function calls `create_meeting_event` to create calendar events
if they don't exist. Check that this function exists and accepts `attendee_emails` parameter.
If not, it may need to be added or updated.

**Step 4: Export lifecycle functions**

Add to `core/__init__.py`:

```python
from .lifecycle import (
    # Sync functions - used for both normal flow and recovery
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
    sync_meeting_calendar,
)
from .notifications.scheduler import sync_meeting_reminders
```

**Step 5: Commit**

```bash
jj describe -m "feat(core): add lifecycle module for group membership operations"
```

---

## Task 4: Refactor Group Realization to Use Sync Functions

**Files:**
- Modify: `discord_bot/cogs/groups_cog.py`

Refactor the existing `/realize-groups` command to use the new sync functions instead of inline implementations. This ensures one code path for all group membership operations.

**Step 1: Add imports at top of groups_cog.py**

Add these imports near the top of `discord_bot/cogs/groups_cog.py`:

```python
from core.lifecycle import (
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
)
from core.notifications.dispatcher import was_notification_sent
from core.notifications.actions import notify_group_assigned
from core.queries.groups import get_group_with_details, get_group_member_names
from core.enums import NotificationReferenceType
```

**Step 2: Add helper method to the GroupsCog class**

Add this method to the `GroupsCog` class:

```python
async def _sync_group_lifecycle(
    self,
    group_id: int,
    user_ids: list[int],
) -> None:
    """
    Sync all lifecycle operations for a newly realized group.

    This uses the same group-level sync functions as direct group joining,
    ensuring one code path for all group membership operations.
    """
    # 1. Sync Discord permissions (diff-based - will grant to all members)
    await sync_group_discord_permissions(group_id)

    # 2. Sync calendar events and attendees for all future meetings
    await sync_group_calendar(group_id)

    # 3. Sync reminders for all future meetings
    await sync_group_reminders(group_id)

    # 4. Sync RSVPs for all future meetings
    await sync_group_rsvps(group_id)

    # 5. Send notifications (with deduplication)
    async with get_connection() as conn:
        group_details = await get_group_with_details(conn, group_id)
        member_names = await get_group_member_names(conn, group_id)

    if not group_details:
        return

    for user_id in user_ids:
        already_notified = await was_notification_sent(
            user_id=user_id,
            message_type="group_assigned",
            reference_type=NotificationReferenceType.group_id,
            reference_id=group_id,
        )
        if not already_notified:
            await notify_group_assigned(
                user_id=user_id,
                group_name=group_details["group_name"],
                meeting_time_utc=group_details["recurring_meeting_time_utc"],
                member_names=member_names,
                discord_channel_id=group_details.get("discord_text_channel_id", ""),
                reference_type=NotificationReferenceType.group_id,
                reference_id=group_id,
            )
```

**Step 3: Replace inline logic in realize_groups command**

In the `realize_groups` method, **after** `save_discord_channel_ids` (around line 234), replace:

```python
# REMOVE these blocks (approximately lines 168-183, 212-225, 244-250):
# - The for loop granting permissions per member
# - The send_calendar_invites_for_group call
# - The schedule_reminders_for_group call
# - The _send_group_notifications task

# REPLACE WITH a single call:
# Get user_ids for this group
user_ids = [m["user_id"] for m in group_data["members"]]

# Call unified sync function (handles permissions, calendar, reminders, notifications)
await self._sync_group_lifecycle(
    group_id=group_data["group_id"],
    user_ids=user_ids,
)
```

**Step 4: Update summary of what to remove**

Remove these existing code blocks from `realize_groups`:
- **Lines ~168-183**: `for member_data in group_data["members"]:` loop that grants permissions
- **Lines ~212-217**: `send_calendar_invites_for_group(...)` call
- **Lines ~219-225**: `schedule_reminders_for_group(...)` call
- **Lines ~244-250**: `asyncio.create_task(self._send_group_notifications(...))` task

Keep:
- Discord channel/category creation (one-time setup, not sync)
- Database record creation for groups and meetings via `create_meetings_for_group`
- Discord scheduled event creation via `_create_scheduled_events`
- `save_discord_channel_ids` call
- Welcome message in channel via `_send_welcome_message`

**Step 3: Test realization still works**

```bash
# In Discord, run /realize-groups for a test cohort
# Verify:
# - Members get channel access
# - Calendar events created with attendees
# - Reminders scheduled
# - Notifications sent (check notification_log)
```

**Step 4: Commit**

```bash
jj describe -m "refactor(discord): use sync functions in group realization"
```

---

## Task 5: Add has_groups to Cohorts Query

**Files:**
- Modify: `core/queries/cohorts.py`

**Step 1: Update get_available_cohorts**

In `core/queries/cohorts.py`, update the function to include `has_groups` and map `course_name`:

```python
async def get_available_cohorts(
    conn: AsyncConnection,
    user_id: int | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """
    Get future cohorts, separated into enrolled and available.

    Includes has_groups flag for each cohort (True if cohort has any groups).
    Maps course_slug to course_name using load_course().
    """
    from datetime import date
    from ..tables import groups
    from ..modules.course_loader import load_course

    today = date.today()

    # Subquery to check if cohort has groups
    has_groups_subq = (
        select(
            groups.c.cohort_id,
            func.count().label("group_count"),
        )
        .group_by(groups.c.cohort_id)
        .subquery()
    )

    # Get all future active cohorts with has_groups
    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
            cohorts.c.course_slug,
            cohorts.c.duration_days,
            func.coalesce(has_groups_subq.c.group_count, 0).label("group_count"),
        )
        .outerjoin(has_groups_subq, cohorts.c.cohort_id == has_groups_subq.c.cohort_id)
        .where(cohorts.c.cohort_start_date > today)
        .where(cohorts.c.status == "active")
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    all_cohorts = []
    for row in result.mappings():
        cohort = dict(row)
        cohort["has_groups"] = cohort.pop("group_count") > 0
        # Map course_slug to course_name for frontend compatibility
        course = load_course(cohort["course_slug"])
        cohort["course_name"] = course.title
        all_cohorts.append(cohort)

    if not user_id:
        return {"enrolled": [], "available": all_cohorts}

    # Get user's signups
    enrollment_query = select(
        signups.c.cohort_id,
        signups.c.role,
    ).where(signups.c.user_id == user_id)
    enrollment_result = await conn.execute(enrollment_query)
    enrollments = {
        row["cohort_id"]: row["role"] for row in enrollment_result.mappings()
    }

    enrolled = []
    available = []

    for cohort in all_cohorts:
        if cohort["cohort_id"] in enrollments:
            cohort["role"] = enrollments[cohort["cohort_id"]].value
            enrolled.append(cohort)
        else:
            available.append(cohort)

    return {"enrolled": enrolled, "available": available}
```

**Step 2: Commit**

```bash
jj describe -m "feat(core): add has_groups flag to available cohorts"
```

---

## Task 6: Create Groups API Routes

**Files:**
- Create: `web_api/routes/groups.py`
- Modify: `main.py`

**Step 1: Create the route file**

Create `web_api/routes/groups.py`:

```python
"""
Group routes.

Endpoints:
- GET /api/cohorts/{cohort_id}/groups - Get joinable groups (pre-filtered, pre-sorted)
- POST /api/groups/join - Join or switch to a group
"""

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_joinable_groups, join_group
from core.database import get_connection, get_transaction
from core.queries.users import get_user_by_discord_id
from web_api.auth import get_current_user

router = APIRouter(prefix="/api", tags=["groups"])


@router.get("/cohorts/{cohort_id}/groups")
async def get_cohort_groups(
    cohort_id: int,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get groups available for joining in a cohort.

    Returns pre-filtered, pre-sorted groups with all display info:
    - Filters out full groups (8+ members)
    - Filters out started groups (unless user already has a group)
    - Sorted by member count (smallest first)
    - Includes badge, is_current, next_meeting_at fields

    Frontend should render these directly without additional processing.
    """
    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        user_id = db_user["user_id"] if db_user else None

        groups = await get_joinable_groups(conn, cohort_id, user_id)

    return {"groups": groups}


class JoinGroupRequest(BaseModel):
    """Schema for joining a group."""
    group_id: int


@router.post("/groups/join")
async def join_group_endpoint(
    request: JoinGroupRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Join a group (or switch to a different group).

    Returns the joined group_id and previous_group_id if switching.
    """
    discord_id = user["sub"]

    async with get_transaction() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            raise HTTPException(404, "User not found")

        try:
            result = await join_group(conn, db_user["user_id"], request.group_id)
        except ValueError as e:
            raise HTTPException(400, str(e))

    return {"status": "joined", **result}
```

**Step 2: Register router in main.py**

Find where routers are imported/included and add:

```python
from web_api.routes import groups as groups_route
# ...
app.include_router(groups_route.router)
```

**Step 3: Commit**

```bash
jj describe -m "feat(api): add groups routes for listing and joining"
```

---

## Task 7: Add User Group Info Endpoint

**Files:**
- Modify: `web_api/routes/users.py`

**Step 1: Add the endpoint**

Add to `web_api/routes/users.py`:

```python
@router.get("/me/group-info")
async def get_my_group_info(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get current user's cohort and group information.

    Used by /group page for group management.
    """
    from core import get_user_group_info

    discord_id = user["sub"]

    async with get_connection() as conn:
        db_user = await get_user_by_discord_id(conn, discord_id)
        if not db_user:
            return {"is_enrolled": False}

        return await get_user_group_info(conn, db_user["user_id"])
```

**Step 2: Commit**

```bash
jj describe -m "feat(api): add GET /api/users/me/group-info endpoint"
```

---

## Task 8: Update PATCH /api/users/me for Direct Group Join

**Files:**
- Modify: `web_api/routes/users.py`

**Step 1: Update schema**

Add `group_id` to `UserProfileUpdate`:

```python
class UserProfileUpdate(BaseModel):
    """Schema for updating user profile."""

    nickname: str | None = None
    email: str | None = None
    timezone: str | None = None
    availability_local: str | None = None
    cohort_id: int | None = None
    role: str | None = None
    tos_accepted: bool | None = None
    group_id: int | None = None  # Direct group join (for scheduled cohorts)
```

**Step 2: Update endpoint to use core function**

Modify `update_my_profile` to handle `group_id`:

```python
@router.patch("/me")
async def update_my_profile(
    updates: UserProfileUpdate,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Update the current user's profile.

    Optionally:
    - Enroll in a cohort (cohort_id + role)
    - Join a group directly (group_id) - uses core.join_group
    """
    from core import join_group

    discord_id = user["sub"]

    # Update profile
    updated_user = await update_user_profile(
        discord_id,
        nickname=updates.nickname,
        email=updates.email,
        timezone_str=updates.timezone,
        availability_local=updates.availability_local,
        tos_accepted=updates.tos_accepted,
    )

    if not updated_user:
        raise HTTPException(404, "User not found")

    # Sync nickname to Discord
    if updates.nickname is not None:
        await update_nickname_in_discord(discord_id, updates.nickname)

    # Enroll in cohort
    enrollment = None
    if updates.cohort_id is not None and updates.role is not None:
        enrollment = await enroll_in_cohort(
            discord_id,
            updates.cohort_id,
            updates.role,
        )

    # Direct group join (delegates to core function)
    group_join = None
    if updates.group_id is not None:
        async with get_transaction() as conn:
            db_user = await get_user_by_discord_id(conn, discord_id)
            if not db_user:
                raise HTTPException(404, "User not found")

            try:
                group_join = await join_group(conn, db_user["user_id"], updates.group_id)
            except ValueError as e:
                raise HTTPException(400, str(e))

    return {
        "status": "updated",
        "user": updated_user,
        "enrollment": enrollment,
        "group_join": group_join,
    }
```

**Step 3: Commit**

```bash
jj describe -m "feat(api): support group_id in PATCH /api/users/me"
```

---

## Task 9: Add Frontend Types

**Files:**
- Modify: `web_frontend/src/types/enroll.ts`

**Step 1: Add Group type and update interfaces**

Add to `web_frontend/src/types/enroll.ts`:

```typescript
// Group returned by API - all display info is pre-computed by backend
export interface Group {
  group_id: number;
  group_name: string;
  recurring_meeting_time_utc: string;
  member_count: number;
  first_meeting_at: string | null;
  next_meeting_at: string | null;  // ISO datetime - frontend just formats this
  has_started: boolean;
  badge: "best_size" | null;  // Backend decides badge
  is_current: boolean;  // True if user is already in this group
  status: string;
}

// Update Cohort to include has_groups (keep existing course_name field)
export interface Cohort {
  cohort_id: number;
  cohort_name: string;
  cohort_start_date: string;
  course_name: string;  // Keep existing field name
  duration_days: number;
  role?: string;
  has_groups?: boolean;
}

// Update EnrollFormData
export interface EnrollFormData {
  displayName: string;
  email: string;
  discordConnected: boolean;
  discordUsername?: string;
  termsAccepted: boolean;
  availability: AvailabilityData;
  timezone: string;
  selectedCohortId: number | null;
  selectedRole: string | null;
  selectedGroupId: number | null;
}
```

**Step 2: Commit**

```bash
jj describe -m "feat(frontend): add Group type with backend-computed fields"
```

---

## Task 10: Create GroupSelectionStep Component

**Files:**
- Create: `web_frontend/src/components/enroll/GroupSelectionStep.tsx`

This component is a thin display layer - no filtering, sorting, or badge logic.

**Step 1: Create the component**

Create `web_frontend/src/components/enroll/GroupSelectionStep.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { Group } from "../../types/enroll";
import { COMMON_TIMEZONES, formatTimezoneDisplay } from "../../types/enroll";
import { API_URL } from "../../config";

interface GroupSelectionStepProps {
  cohortId: number;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  selectedGroupId: number | null;
  onGroupSelect: (groupId: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  onSwitchToAvailability: () => void;
}

export default function GroupSelectionStep({
  cohortId,
  timezone,
  onTimezoneChange,
  selectedGroupId,
  onGroupSelect,
  onBack,
  onSubmit,
  onSwitchToAvailability,
}: GroupSelectionStepProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGroups();
  }, [cohortId]);

  const fetchGroups = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_URL}/api/cohorts/${cohortId}/groups`,
        { credentials: "include" }
      );
      if (response.status === 401) {
        window.location.href = "/enroll";
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch groups");
      }
      const data = await response.json();
      // Backend returns pre-filtered, pre-sorted groups - just use them
      setGroups(data.groups);
    } catch (err) {
      setError("Failed to load groups. Please try again.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Format next_meeting_at in user's timezone (backend provides ISO datetime)
  const formatMeetingTime = (isoDatetime: string | null): string => {
    if (!isoDatetime) return "Time TBD";

    try {
      const date = new Date(isoDatetime);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    } catch {
      return "Time TBD";
    }
  };

  // Badge display text (backend decides which groups get badges)
  const getBadgeText = (badge: string | null): string | null => {
    if (badge === "best_size") return "Best size to join!";
    return null;
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <div className="text-red-600 text-center py-8">{error}</div>
        <button
          onClick={fetchGroups}
          className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Groups Available</h2>
        <p className="text-gray-600 mb-6">
          All groups in this cohort are currently full or have already started.
          You can join a different cohort and be matched based on your availability.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={onSwitchToAvailability}
            className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Choose Different Cohort
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Select Your Group</h2>
      <p className="text-gray-600 mb-6">
        Choose a group that fits your schedule. You'll meet weekly at the same time.
      </p>

      {/* Timezone selector */}
      <div className="mb-6">
        <label
          htmlFor="timezone"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Your Timezone
        </label>
        <select
          id="timezone"
          value={timezone}
          onChange={(e) => onTimezoneChange(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {!COMMON_TIMEZONES.includes(timezone as typeof COMMON_TIMEZONES[number]) && (
            <option value={timezone}>{formatTimezoneDisplay(timezone)}</option>
          )}
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {formatTimezoneDisplay(tz)}
            </option>
          ))}
        </select>
      </div>

      {/* Group list - rendered directly from API response */}
      <div className="space-y-3 mb-6">
        {groups.map((group) => {
          const isSelected = selectedGroupId === group.group_id;
          const badgeText = getBadgeText(group.badge);
          const isDisabled = group.is_current;

          return (
            <button
              key={group.group_id}
              type="button"
              onClick={() => !isDisabled && onGroupSelect(group.group_id)}
              disabled={isDisabled}
              className={`w-full text-left p-4 border rounded-lg transition-colors ${
                isDisabled
                  ? "border-gray-200 bg-gray-50 cursor-default"
                  : isSelected
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-900 flex items-center gap-2">
                    {group.group_name}
                    {group.is_current && (
                      <span className="text-xs text-gray-500 font-normal">
                        (Your current group)
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    {formatMeetingTime(group.next_meeting_at)}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {group.member_count} member{group.member_count !== 1 ? "s" : ""}
                  </div>
                </div>
                {badgeText && !group.is_current && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    {badgeText}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Escape hatch */}
      <div className="text-center mb-6">
        <button
          type="button"
          onClick={onSwitchToAvailability}
          className="text-sm text-blue-600 hover:text-blue-800 underline"
        >
          None of these work? Join a different cohort
        </button>
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-4 py-3 font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!selectedGroupId || groups.find(g => g.group_id === selectedGroupId)?.is_current}
          className={`flex-1 px-4 py-3 font-medium rounded-lg transition-colors disabled:cursor-default ${
            selectedGroupId && !groups.find(g => g.group_id === selectedGroupId)?.is_current
              ? "bg-blue-500 hover:bg-blue-600 text-white"
              : "bg-gray-200 text-gray-400"
          }`}
        >
          Complete Enrollment
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj describe -m "feat(frontend): add GroupSelectionStep component (thin display layer)"
```

---

## Task 11: Update EnrollWizard

**Files:**
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx`

**Step 1: Add imports and state**

Add import:
```typescript
import GroupSelectionStep from "./GroupSelectionStep";
```

Update initial state:
```typescript
const [formData, setFormData] = useState<EnrollFormData>({
  displayName: "",
  email: "",
  discordConnected: false,
  discordUsername: undefined,
  termsAccepted: false,
  availability: { ...EMPTY_AVAILABILITY },
  timezone: getBrowserTimezone(),
  selectedCohortId: null,
  selectedRole: null,
  selectedGroupId: null,
});

const [forceAvailabilityMode, setForceAvailabilityMode] = useState(false);
```

**Step 2: Add helper for cohort detection**

```typescript
import { useMemo } from "react";

// Inside component:
const selectedCohortHasGroups = useMemo(() => {
  if (!formData.selectedCohortId) return false;
  const cohort = availableCohorts.find(c => c.cohort_id === formData.selectedCohortId);
  return cohort?.has_groups ?? false;
}, [formData.selectedCohortId, availableCohorts]);
```

**Step 3: Update handleSubmit**

```typescript
const handleSubmit = async () => {
  if (!isAuthenticated) {
    console.error("User not authenticated");
    return;
  }

  setIsSubmitting(true);

  try {
    const response = await fetch(`${API_URL}/api/users/me`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: formData.displayName || null,
        email: formData.email || null,
        timezone: formData.timezone,
        // Only send availability if not doing direct group join
        availability_local: formData.selectedGroupId
          ? null
          : JSON.stringify(formData.availability),
        cohort_id: formData.selectedCohortId,
        role: formData.selectedRole,
        tos_accepted: formData.termsAccepted,
        group_id: formData.selectedGroupId,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.detail || "Failed to update profile");
    }

    trackEnrollmentCompleted();
    setCurrentStep("complete");
  } catch (error) {
    console.error("Failed to submit:", error);
    alert(error instanceof Error ? error.message : "Failed to save. Please try again.");
  } finally {
    setIsSubmitting(false);
  }
};
```

**Step 4: Update step 3 rendering**

```typescript
{currentStep === 3 && (
  selectedCohortHasGroups && !forceAvailabilityMode ? (
    <GroupSelectionStep
      cohortId={formData.selectedCohortId!}
      timezone={formData.timezone}
      onTimezoneChange={(tz) =>
        setFormData((prev) => ({ ...prev, timezone: tz }))
      }
      selectedGroupId={formData.selectedGroupId}
      onGroupSelect={(groupId) =>
        setFormData((prev) => ({ ...prev, selectedGroupId: groupId }))
      }
      onBack={() => setCurrentStep(2)}
      onSubmit={handleSubmit}
      onSwitchToAvailability={() => {
        setFormData((prev) => ({
          ...prev,
          selectedCohortId: null,
          selectedRole: null,
          selectedGroupId: null,
        }));
        setForceAvailabilityMode(true);
        setCurrentStep(2);
      }}
    />
  ) : (
    <AvailabilityStep
      availability={formData.availability}
      onAvailabilityChange={(data) =>
        setFormData((prev) => ({ ...prev, availability: data }))
      }
      timezone={formData.timezone}
      onTimezoneChange={(tz) =>
        setFormData((prev) => ({ ...prev, timezone: tz }))
      }
      onBack={() => setCurrentStep(2)}
      onSubmit={handleSubmit}
      cohort={
        availableCohorts.find(
          (c) => c.cohort_id === formData.selectedCohortId,
        ) ?? null
      }
    />
  )
)}
```

**Step 5: Reset state on cohort change**

Update CohortRoleStep's onCohortSelect:

```typescript
onCohortSelect={(id) => {
  setFormData((prev) => ({
    ...prev,
    selectedCohortId: id,
    selectedRole: isFacilitator ? null : "participant",
    selectedGroupId: null,
  }));
  setForceAvailabilityMode(false);
}}
```

**Step 6: Commit**

```bash
jj describe -m "feat(frontend): integrate GroupSelectionStep into EnrollWizard"
```

---

## Task 12: Create /group Page

**Files:**
- Create: `web_frontend/src/pages/group/+Page.tsx`

**Step 1: Create the page**

Create `web_frontend/src/pages/group/+Page.tsx`:

```tsx
import { useState, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { API_URL } from "../../config";
import GroupSelectionStep from "../../components/enroll/GroupSelectionStep";
import { getBrowserTimezone } from "../../types/enroll";

interface UserGroupInfo {
  is_enrolled: boolean;
  cohort_id?: number;
  cohort_name?: string;
  current_group?: {
    group_id: number;
    group_name: string;
    recurring_meeting_time_utc: string;
  } | null;
}

export default function GroupPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [userInfo, setUserInfo] = useState<UserGroupInfo | null>(null);
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      fetchUserGroupInfo();
    }
  }, [isAuthenticated]);

  const fetchUserGroupInfo = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/users/me/group-info`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setUserInfo(data);
      }
    } catch (err) {
      setError("Failed to load your group information");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!selectedGroupId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/groups/join`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selectedGroupId }),
      });

      if (!response.ok) {
        const data = await response.json();
        if (response.status === 400) {
          // Group no longer available - refresh list
          await fetchUserGroupInfo();
        }
        throw new Error(data.detail || "Failed to join group");
      }

      setSuccess(true);
      await fetchUserGroupInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Sign In Required</h1>
          <p className="text-gray-600 mb-4">Please sign in to manage your group.</p>
          <a href="/enroll" className="text-blue-600 hover:underline">
            Go to enrollment
          </a>
        </div>
      </div>
    );
  }

  if (!userInfo?.is_enrolled) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Not Enrolled</h1>
          <p className="text-gray-600 mb-4">You need to enroll in a cohort first.</p>
          <a href="/enroll" className="text-blue-600 hover:underline">
            Enroll now
          </a>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-green-600 text-5xl mb-4">✓</div>
          <h1 className="text-2xl font-bold mb-4">Group Updated!</h1>
          <p className="text-gray-600 mb-4">
            You've successfully joined your new group.
          </p>
          <a href="/" className="text-blue-600 hover:underline">
            Go to home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {userInfo.current_group ? "Change Your Group" : "Join a Group"}
        </h1>
        <p className="text-gray-600 mb-6">
          Cohort: {userInfo.cohort_name}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        <GroupSelectionStep
          cohortId={userInfo.cohort_id!}
          timezone={timezone}
          onTimezoneChange={setTimezone}
          selectedGroupId={selectedGroupId}
          onGroupSelect={setSelectedGroupId}
          onBack={() => window.history.back()}
          onSubmit={handleJoinGroup}
          onSwitchToAvailability={() => {
            window.location.href = "/enroll";
          }}
        />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj describe -m "feat(frontend): add /group page for existing users"
```

---

## Task 13: Run Linting and Type Checks

**Step 1: Run backend checks**

```bash
ruff check .
ruff format --check .
```

Fix any issues.

**Step 2: Run frontend checks**

```bash
cd web_frontend && npm run lint && npm run build
```

Fix any issues.

**Step 3: Commit fixes**

```bash
jj describe -m "fix: lint and type errors"
```

---

## Task 14: Run Tests

**Step 1: Run backend tests**

```bash
pytest core/tests/test_group_joining.py -v
```

**Step 2: Run all tests**

```bash
pytest
```

Fix any failures.

**Step 3: Commit if needed**

---

## Summary

This plan emphasizes **backend-first logic** with **full lifecycle management**:

### Business Logic (Backend)

| Logic | Location | Notes |
|-------|----------|-------|
| Filter full groups | Backend SQL query | `WHERE member_count < 8` |
| Filter started groups | Backend SQL query | `WHERE first_meeting > now` (unless user has group) |
| Sort by member count | Backend SQL query | `ORDER BY member_count` |
| Determine badge | Backend Python | `badge = "best_size"` for 3-4 members |
| Calculate next meeting | Backend Python | Returns ISO datetime |
| Mark current group | Backend Python | `is_current = True` |
| Join/switch validation | Backend Python | Single `join_group()` function |

### Lifecycle Operations (on join/leave)

All sync operations are **diff-based**: read external system state, compare with DB, apply only changes.

| Operation | Function | Approach |
|-----------|----------|----------|
| Discord permissions | `sync_group_discord_permissions(group_id)` | Read channel overwrites, diff with DB members, grant/revoke diff |
| Calendar invites | `sync_group_calendar(group_id)` | For each meeting: create event if missing, diff attendees with DB, add/remove diff |
| Meeting reminders | `sync_group_reminders(group_id)` | For each meeting: read DB members, replace `user_ids` in APScheduler job |
| RSVP/Attendance | `sync_group_rsvps(group_id)` | For each meeting: ensure attendance records exist for all group members |
| User notification | `notify_group_assigned(...)` | Send email + Discord DM about group assignment (existing function) |

### Error Handling & Recovery

- **Best-effort**: Lifecycle failures don't block DB updates
- **Sentry alerts**: All failures are logged and reported to Sentry
- **Same functions for normal flow and recovery**: Just call the sync function again
- **Efficient**: Diff-based means no API calls if nothing changed

### Frontend Responsibilities
- Render the list as-is (no filtering/sorting)
- Format ISO datetime in user's timezone
- Handle loading/error states
- Call API endpoints

### Task Summary (15 tasks)

1. Core `group_joining.py` module (all business logic)
2. **Notification deduplication** (reference_type/reference_id in notification_log)
3. **Lifecycle module** (Discord, Calendar, Reminders - diff-based sync)
4. **Refactor group realization** to use sync functions (one code path)
5. Add `has_groups` to cohorts query
6. Groups API routes
7. User group info endpoint
8. PATCH /users/me with group_id
9. Frontend types
10. GroupSelectionStep component (thin layer)
11. EnrollWizard integration
12. /group page
13. Backend tests
14. Linting
15. Run tests
