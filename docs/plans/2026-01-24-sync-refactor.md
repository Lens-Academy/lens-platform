# Sync Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate group sync logic into a unified `sync_group()` function in `core/sync.py`, eliminating duplication between Discord bot and web API.

**Architecture:** Rename `core/lifecycle.py` to `core/sync.py`. Create a unified `sync_group()` function that calls all sub-sync functions with retry scheduling. Both Discord bot and web API will call this single function. The `sync_after_group_change()` function moves from `group_joining.py` into `sync.py`.

**Tech Stack:** Python, SQLAlchemy, Discord.py, APScheduler

---

## Task 1: Rename `lifecycle.py` to `sync.py`

**Files:**
- Rename: `core/lifecycle.py` → `core/sync.py`
- Modify: `core/__init__.py` (lines 113-119)
- Modify: `core/group_joining.py` (lines 389-394)
- Modify: `core/notifications/scheduler.py` (lines 363-368)
- Modify: `discord_bot/cogs/groups_cog.py` (lines 28-33)
- Rename: `core/tests/test_lifecycle.py` → `core/tests/test_sync.py`
- Rename: `core/tests/test_lifecycle_calendar.py` → `core/tests/test_sync_calendar.py`

**Step 1: Rename the main file**

```bash
jj st && mv core/lifecycle.py core/sync.py
```

**Step 2: Rename the test files**

```bash
mv core/tests/test_lifecycle.py core/tests/test_sync.py
mv core/tests/test_lifecycle_calendar.py core/tests/test_sync_calendar.py
```

**Step 3: Update imports in `core/__init__.py`**

Change lines 113-119 from:
```python
# Lifecycle operations (sync functions for group membership changes)
from .lifecycle import (
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
)
```

To:
```python
# Sync operations (sync functions for group membership changes)
from .sync import (
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
)
```

Also update line 208 comment from `# Lifecycle operations (sync functions)` to `# Sync operations`.

**Step 4: Update imports in `core/group_joining.py`**

Change lines 389-394 from:
```python
    from .lifecycle import (
        sync_group_calendar,
        sync_group_discord_permissions,
        sync_group_reminders,
        sync_group_rsvps,
    )
```

To:
```python
    from .sync import (
        sync_group_calendar,
        sync_group_discord_permissions,
        sync_group_reminders,
        sync_group_rsvps,
    )
```

**Step 5: Update imports in `core/notifications/scheduler.py`**

Change lines 363-368 from:
```python
    from core.lifecycle import (
        sync_group_calendar,
        sync_group_discord_permissions,
        sync_group_reminders,
        sync_group_rsvps,
    )
```

To:
```python
    from core.sync import (
        sync_group_calendar,
        sync_group_discord_permissions,
        sync_group_reminders,
        sync_group_rsvps,
    )
```

**Step 6: Update imports in `discord_bot/cogs/groups_cog.py`**

Change lines 28-33 from:
```python
from core.lifecycle import (
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
)
```

To:
```python
from core.sync import (
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
)
```

**Step 7: Update imports in test files**

In `core/tests/test_sync.py`, update all imports. Change these lines:
- Line 98: `from core.lifecycle import` → `from core.sync import`
- Line 108: `from core.lifecycle import` → `from core.sync import`
- Line 130: `from core.lifecycle import` → `from core.sync import`
- Line 164: `from core.lifecycle import` → `from core.sync import`
- Line 190: `from core.lifecycle import` → `from core.sync import`
- Line 206: `from core.lifecycle import` → `from core.sync import`
- Line 235: `from core.lifecycle import` → `from core.sync import`
- Line 251: `from core.lifecycle import` → `from core.sync import`

In `core/tests/test_sync_calendar.py`, update all imports (search and replace `from core.lifecycle import` → `from core.sync import`).

**Step 8: Run tests to verify rename worked**

Run: `pytest core/tests/test_sync.py core/tests/test_sync_calendar.py -v`
Expected: All tests pass

**Step 9: Run full test suite**

Run: `pytest`
Expected: All tests pass

**Step 10: Commit**

```bash
jj describe -m "refactor: rename lifecycle.py to sync.py

Clearer naming - these are sync functions, not lifecycle hooks."
```

---

## Task 2: Create unified `sync_group()` function

**Files:**
- Modify: `core/sync.py` (add new function at end)
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

Add to end of `core/tests/test_sync.py`:

```python
class TestSyncGroup:
    """Test unified sync_group function."""

    @pytest.mark.asyncio
    async def test_sync_group_calls_all_sub_syncs(self):
        """Should call all four sub-sync functions for a group."""
        from core.sync import sync_group

        with patch("core.sync.sync_group_discord_permissions", new_callable=AsyncMock) as mock_discord, \
             patch("core.sync.sync_group_calendar", new_callable=AsyncMock) as mock_calendar, \
             patch("core.sync.sync_group_reminders", new_callable=AsyncMock) as mock_reminders, \
             patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps:

            mock_discord.return_value = {"granted": 1, "revoked": 0, "unchanged": 0, "failed": 0}
            mock_calendar.return_value = {"meetings": 5, "created": 0, "patched": 2, "unchanged": 3, "failed": 0}
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            result = await sync_group(group_id=123)

            mock_discord.assert_called_once_with(123)
            mock_calendar.assert_called_once_with(123)
            mock_reminders.assert_called_once_with(123)
            mock_rsvps.assert_called_once_with(123)

            assert result["discord"] == {"granted": 1, "revoked": 0, "unchanged": 0, "failed": 0}
            assert result["calendar"]["patched"] == 2
            assert result["reminders"]["meetings"] == 5
            assert result["rsvps"]["meetings"] == 5

    @pytest.mark.asyncio
    async def test_sync_group_returns_errors_without_raising(self):
        """Should capture errors in results without raising exceptions."""
        from core.sync import sync_group

        with patch("core.sync.sync_group_discord_permissions", new_callable=AsyncMock) as mock_discord, \
             patch("core.sync.sync_group_calendar", new_callable=AsyncMock) as mock_calendar, \
             patch("core.sync.sync_group_reminders", new_callable=AsyncMock) as mock_reminders, \
             patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps:

            mock_discord.side_effect = Exception("Discord error")
            mock_calendar.return_value = {"error": "quota_exceeded"}
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            result = await sync_group(group_id=123)

            assert "error" in result["discord"]
            assert result["calendar"]["error"] == "quota_exceeded"
            assert result["reminders"]["meetings"] == 5

    @pytest.mark.asyncio
    async def test_sync_group_schedules_retries_on_failure(self):
        """Should schedule retries for failed syncs."""
        from core.sync import sync_group

        with patch("core.sync.sync_group_discord_permissions", new_callable=AsyncMock) as mock_discord, \
             patch("core.sync.sync_group_calendar", new_callable=AsyncMock) as mock_calendar, \
             patch("core.sync.sync_group_reminders", new_callable=AsyncMock) as mock_reminders, \
             patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps, \
             patch("core.notifications.scheduler.schedule_sync_retry") as mock_retry:

            mock_discord.return_value = {"granted": 0, "revoked": 0, "unchanged": 0, "failed": 2}
            mock_calendar.return_value = {"meetings": 5, "created": 0, "patched": 0, "unchanged": 0, "failed": 5}
            mock_reminders.return_value = {"meetings": 5}
            mock_rsvps.return_value = {"meetings": 5}

            await sync_group(group_id=123)

            # Should schedule retries for discord and calendar (both had failures)
            calls = mock_retry.call_args_list
            sync_types = [call[1]["sync_type"] for call in calls]
            assert "discord" in sync_types
            assert "calendar" in sync_types
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_sync.py::TestSyncGroup -v`
Expected: FAIL with "cannot import name 'sync_group'"

**Step 3: Write minimal implementation**

Add to end of `core/sync.py`:

```python
async def sync_group(group_id: int) -> dict[str, Any]:
    """
    Sync all external systems for a group.

    This is the unified sync function that should be called whenever
    group membership changes. It syncs:
    - Discord channel permissions
    - Google Calendar event attendees
    - Meeting reminder jobs
    - RSVP records

    Errors are captured in the results dict, not raised. Failed syncs
    are automatically scheduled for retry.

    Args:
        group_id: The group to sync

    Returns:
        Dict with results from each sync operation:
        {
            "discord": {...},
            "calendar": {...},
            "reminders": {...},
            "rsvps": {...},
        }
    """
    from .notifications.scheduler import schedule_sync_retry

    results: dict[str, Any] = {}

    # Sync Discord permissions
    try:
        results["discord"] = await sync_group_discord_permissions(group_id)
        if results["discord"].get("failed", 0) > 0 or results["discord"].get("error"):
            schedule_sync_retry(sync_type="discord", group_id=group_id, attempt=0)
    except Exception as e:
        logger.error(f"Discord sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["discord"] = {"error": str(e)}
        schedule_sync_retry(sync_type="discord", group_id=group_id, attempt=0)

    # Sync Calendar
    try:
        results["calendar"] = await sync_group_calendar(group_id)
        if results["calendar"].get("failed", 0) > 0 or results["calendar"].get("error"):
            schedule_sync_retry(sync_type="calendar", group_id=group_id, attempt=0)
    except Exception as e:
        logger.error(f"Calendar sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["calendar"] = {"error": str(e)}
        schedule_sync_retry(sync_type="calendar", group_id=group_id, attempt=0)

    # Sync Reminders
    try:
        results["reminders"] = await sync_group_reminders(group_id)
    except Exception as e:
        logger.error(f"Reminders sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["reminders"] = {"error": str(e)}
        schedule_sync_retry(sync_type="reminders", group_id=group_id, attempt=0)

    # Sync RSVPs
    try:
        results["rsvps"] = await sync_group_rsvps(group_id)
    except Exception as e:
        logger.error(f"RSVPs sync failed for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        results["rsvps"] = {"error": str(e)}
        schedule_sync_retry(sync_type="rsvps", group_id=group_id, attempt=0)

    return results
```

Also add `from typing import Any` at top of file if not already present.

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_sync.py::TestSyncGroup -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add unified sync_group() function

Single entry point for syncing all external systems for a group.
Handles errors gracefully and schedules retries automatically."
```

---

## Task 3: Move `sync_after_group_change()` to `sync.py`

**Files:**
- Modify: `core/sync.py` (add function)
- Modify: `core/group_joining.py` (lines 369-473 - remove function)
- Modify: `core/__init__.py` (lines 104-111 - update imports)

**Step 1: Add `sync_after_group_change()` to `core/sync.py`**

Add after `sync_group()`:

```python
async def sync_after_group_change(
    group_id: int,
    previous_group_id: int | None = None,
) -> dict[str, Any]:
    """
    Sync external systems after a group membership change.

    Call this AFTER the database transaction is committed.
    Syncs both the new group and the previous group (if switching).

    Args:
        group_id: The group the user joined
        previous_group_id: The group the user left (if switching)

    Returns:
        Dict with results for new group (and old group if switching):
        {
            "new_group": {...},
            "old_group": {...} | None,
        }
    """
    results: dict[str, Any] = {"new_group": None, "old_group": None}

    # Sync old group first (if switching) - revokes permissions, removes from calendar
    if previous_group_id:
        logger.info(f"Syncing old group {previous_group_id} after membership change")
        results["old_group"] = await sync_group(previous_group_id)

    # Sync new group - grants permissions, adds to calendar
    logger.info(f"Syncing new group {group_id} after membership change")
    results["new_group"] = await sync_group(group_id)

    return results
```

**Step 2: Remove `sync_after_group_change()` from `core/group_joining.py`**

Delete lines 369-473 (the entire `sync_after_group_change` function and its helper `sync_with_retry`).

Also remove the now-unused imports inside the function (they were imported inside the function so they'll be gone with the function).

**Step 3: Update `core/__init__.py` imports**

Change lines 104-111 from:
```python
# Group joining
from .group_joining import (
    get_joinable_groups,
    get_user_current_group,
    join_group,
    get_user_group_info,
    sync_after_group_change,
)
```

To:
```python
# Group joining
from .group_joining import (
    get_joinable_groups,
    get_user_current_group,
    join_group,
    get_user_group_info,
)
```

**Step 4: Add `sync_group` and `sync_after_group_change` exports from sync.py**

Update lines 113-119 (the sync imports) to:
```python
# Sync operations (sync functions for group membership changes)
from .sync import (
    sync_group,
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
    sync_after_group_change,
)
```

**Step 5: Update `__all__` list**

In the `__all__` list, add `"sync_group"` in the Sync operations section. The `"sync_after_group_change"` should be moved from the Group joining section to the Sync operations section.

**Step 6: Run tests**

Run: `pytest core/tests/ -v`
Expected: All tests pass

**Step 7: Commit**

```bash
jj describe -m "refactor: move sync_after_group_change to sync.py

Consolidates all sync logic in one module. Uses the new unified
sync_group() function for both old and new groups."
```

---

## Task 4: Update Discord bot to use `sync_group()`

**Files:**
- Modify: `discord_bot/cogs/groups_cog.py` (lines 28-33, 67-134)

**Step 1: Update imports at top of file**

Change lines 28-33 from:
```python
from core.sync import (
    sync_group_discord_permissions,
    sync_group_calendar,
    sync_group_reminders,
    sync_group_rsvps,
)
```

To:
```python
from core.sync import sync_group
```

**Step 2: Simplify `_sync_group_lifecycle()` to use `sync_group()`**

Replace the `_sync_group_lifecycle` method (lines 67-134) with:

```python
    async def _sync_group_lifecycle(
        self,
        group_id: int,
        user_ids: list[int],
    ) -> None:
        """
        Sync all external systems for a newly realized group.

        Uses the unified sync_group() function from core, then sends
        notifications to users who haven't been notified yet.
        """
        # Sync all external systems using unified function
        print(f"Group {group_id}: Running sync_group()...")
        result = await sync_group(group_id)
        print(f"Group {group_id}: Sync result: {result}")

        # Send notifications (with deduplication)
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

**Step 3: Run tests**

Run: `pytest discord_bot/tests/ -v`
Expected: All tests pass

**Step 4: Commit**

```bash
jj describe -m "refactor: use sync_group() in Discord bot

Simplifies _sync_group_lifecycle to use the unified sync function
from core instead of calling individual sync functions."
```

---

## Task 5: Update documentation

**Files:**
- Modify: `core/sync.py` (lines 1-15 - module docstring)
- Modify: `core/CLAUDE.md` (add entry to Base Modules table)

**Step 1: Update module docstring in `core/sync.py`**

Replace lines 1-9 with:

```python
"""
Sync operations for group membership.

Provides functions to sync external systems (Discord, Google Calendar,
APScheduler reminders, RSVPs) with the current group membership state.

All sync functions are diff-based and idempotent - they compare desired
state with actual state and only make changes for differences.

Main entry points:
- sync_group(group_id) - Sync all systems for a single group
- sync_after_group_change(group_id, previous_group_id) - Sync after membership change

Individual sync functions:
- sync_group_discord_permissions(group_id) - Discord channel access
- sync_group_calendar(group_id) - Google Calendar event attendees
- sync_group_reminders(group_id) - APScheduler reminder jobs
- sync_group_rsvps(group_id) - RSVP records from calendar
"""
```

**Step 2: Add entry to `core/CLAUDE.md` Base Modules table**

Add after line 29 (`| `data.py` | JSON persistence (legacy) |`):

```markdown
| `sync.py` | Sync external systems (Discord, Calendar, Reminders) with group membership |
| `group_joining.py` | Direct group joining logic, joinable groups queries |
```

**Step 3: Commit**

```bash
jj describe -m "docs: add documentation for sync.py"
```

---

## Task 6: Final verification

**Step 1: Run linting**

```bash
ruff check core/sync.py core/group_joining.py discord_bot/cogs/groups_cog.py
ruff format --check core/sync.py core/group_joining.py discord_bot/cogs/groups_cog.py
```

Expected: No errors. If there are formatting issues, run:
```bash
ruff format core/sync.py core/group_joining.py discord_bot/cogs/groups_cog.py
```

**Step 2: Run full test suite**

```bash
pytest
```

Expected: All tests pass

**Step 3: Run the dev server and test manually**

```bash
python main.py --dev
```

Test by:
1. Going to `/group` page
2. Joining a test group
3. Verifying Discord permissions sync works (check server logs for "sync_group()" output)

**Step 4: Final commit (squash if desired)**

```bash
jj log  # Review commits
jj squash --into <first-commit-id>  # Optional: squash into single commit
```

---

## Summary of Changes

| Before | After |
|--------|-------|
| `core/lifecycle.py` | `core/sync.py` |
| `sync_after_group_change()` in `group_joining.py` | `sync_after_group_change()` in `sync.py` |
| Duplicate sync logic in Discord bot | Uses `sync_group()` from core |
| No unified sync function | `sync_group(group_id)` as single entry point |

**Files Changed:**
- `core/lifecycle.py` → `core/sync.py` (renamed + new functions)
- `core/group_joining.py` (removed `sync_after_group_change`)
- `core/__init__.py` (updated imports and exports)
- `core/notifications/scheduler.py` (updated imports)
- `discord_bot/cogs/groups_cog.py` (simplified to use `sync_group()`)
- `core/tests/test_lifecycle.py` → `core/tests/test_sync.py` (renamed + new tests)
- `core/tests/test_lifecycle_calendar.py` → `core/tests/test_sync_calendar.py` (renamed)
- `core/CLAUDE.md` (added sync.py entry)
