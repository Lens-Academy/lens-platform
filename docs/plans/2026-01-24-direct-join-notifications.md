# Direct Group Join Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send email notification and Discord channel welcome message when a user joins a group directly (via API), but NOT when groups are realized via /realize-groups.

**Architecture:** Add a `notify_member_joined()` function in `core/notifications/actions.py` that sends both email to the joining user and a Discord channel message. Call this from `sync_after_group_change()` in `core/sync.py` with a `user_id` parameter to distinguish direct joins from realization.

**Tech Stack:** Python, FastAPI, Discord.py, SendGrid (email), existing notification system

**Key insight:** The dispatcher already supports `channel_id` parameter for sending channel messages (not just DMs), so no dispatcher changes needed.

---

### Task 1: Add "member_joined" message template

**Files:**
- Modify: `core/notifications/messages.yaml`

**Step 1: Add the template to messages.yaml**

Add this section to `core/notifications/messages.yaml` after the `group_assigned` section (after line 56):

```yaml
member_joined:
  email_subject: "Welcome to {group_name}!"
  email_body: |
    Hi {name},

    You've joined {group_name}!

    Meeting time: {meeting_time}
    Your groupmates: {member_names}

    Chat with your group on Discord: {discord_channel_url}

    A calendar invite has been sent to your email.

    Best,
    Luc
    Founder of Lens Academy
  discord_channel: |
    Welcome {member_mention}! 👋 They've joined the group.
```

**Step 2: Verify template loads**

Run: `python -c "from core.notifications.templates import load_templates; t = load_templates(); print('member_joined' in t)"`
Expected: `True`

**Step 3: Commit**

```bash
jj describe -m "feat: add member_joined notification template"
jj new
```

---

### Task 2: Add notify_member_joined() action function (TDD)

**Files:**
- Create test: `core/notifications/tests/test_actions_member_joined.py`
- Modify: `core/notifications/actions.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_actions_member_joined.py`:

```python
"""Tests for notify_member_joined action."""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_notify_member_joined_sends_email_and_channel_message():
    """notify_member_joined should send email and Discord channel message."""
    with patch(
        "core.notifications.actions.send_notification", new_callable=AsyncMock
    ) as mock_send:
        mock_send.return_value = {"email": "sent", "discord": "sent"}

        from core.notifications.actions import notify_member_joined

        result = await notify_member_joined(
            user_id=123,
            group_name="Test Group",
            meeting_time_utc="Wednesday 15:00",
            member_names=["Alice", "Bob"],
            discord_channel_id="999888777",
            discord_user_id="111222333",
        )

        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args.kwargs

        assert call_kwargs["user_id"] == 123
        assert call_kwargs["message_type"] == "member_joined"
        assert call_kwargs["context"]["group_name"] == "Test Group"
        assert call_kwargs["context"]["meeting_time"] == "Wednesday 15:00"
        assert "Alice, Bob" in call_kwargs["context"]["member_names"]
        assert call_kwargs["context"]["member_mention"] == "<@111222333>"
        # IMPORTANT: dispatcher expects channel_id, not discord_channel_id
        assert call_kwargs["channel_id"] == "999888777"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_actions_member_joined.py -v`
Expected: FAIL with "cannot import name 'notify_member_joined'"

**Step 3: Write minimal implementation**

Add to `core/notifications/actions.py` after `notify_group_assigned()` (after line 77):

```python
async def notify_member_joined(
    user_id: int,
    group_name: str,
    meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    discord_user_id: str,
) -> dict:
    """
    Send notification when a user directly joins a group.

    Unlike notify_group_assigned (used during realization), this is for
    users who join an existing group via the web UI. It sends:
    - Email to the joining user
    - Discord message to the group channel (welcoming the new member)

    Args:
        user_id: Database user ID of the joining user
        group_name: Name of the group they joined
        meeting_time_utc: Human-readable meeting time
        member_names: List of all group member names (including new member)
        discord_channel_id: Discord channel ID for the group
        discord_user_id: Discord user ID for mention in channel message
    """
    return await send_notification(
        user_id=user_id,
        message_type="member_joined",
        context={
            "group_name": group_name,
            "meeting_time": meeting_time_utc,
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(
                channel_id=discord_channel_id
            ),
            "member_mention": f"<@{discord_user_id}>",
        },
        channel_id=discord_channel_id,  # dispatcher expects channel_id
    )
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_actions_member_joined.py -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add notify_member_joined action function"
jj new
```

---

### Task 3: Export notify_member_joined from core

**Files:**
- Modify: `core/notifications/__init__.py`
- Modify: `core/__init__.py`

**Step 1: Add export to core/notifications/__init__.py**

Add `notify_member_joined` to the imports in `core/notifications/__init__.py`:

```python
from .actions import (
    notify_welcome,
    notify_group_assigned,
    notify_member_joined,  # Add this
    schedule_meeting_reminders,
    cancel_meeting_reminders,
    reschedule_meeting_reminders,
)
```

**Step 2: Add export to core/__init__.py**

Add `notify_member_joined` to the notifications imports in `core/__init__.py` (around lines 89-94):

```python
from .notifications import (
    notify_welcome,
    notify_group_assigned,
    notify_member_joined,  # Add this
    schedule_meeting_reminders,
    cancel_meeting_reminders,
)
```

**Step 3: Verify import works**

Run: `python -c "from core import notify_member_joined; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
jj describe -m "feat: export notify_member_joined from core"
jj new
```

---

### Task 4: Update sync_after_group_change to send notifications (TDD)

**Files:**
- Modify: `core/tests/test_sync.py`
- Modify: `core/sync.py`

**Step 1: Write the failing test**

Add to `core/tests/test_sync.py` at the end of the file, after `TestSyncGroup` class:

```python
class TestSyncAfterGroupChange:
    """Tests for sync_after_group_change()."""

    @pytest.mark.asyncio
    async def test_sends_notification_for_direct_join(self):
        """sync_after_group_change should send member_joined notification when user_id provided."""
        with (
            patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync,
            patch("core.sync.notify_member_joined", new_callable=AsyncMock) as mock_notify,
            patch("core.sync.get_connection") as mock_conn_ctx,
            patch("core.sync.get_group_member_names", new_callable=AsyncMock) as mock_names,
            patch("core.sync.get_group_with_details", new_callable=AsyncMock) as mock_details,
        ):
            mock_sync.return_value = {"discord": {"granted": 1}}
            mock_names.return_value = ["Alice", "Bob"]
            mock_details.return_value = {
                "group_name": "Test Group",
                "recurring_meeting_time_utc": "Wednesday 15:00",
                "discord_text_channel_id": "123456",
            }

            # Mock user query
            mock_conn = AsyncMock()
            mock_conn_ctx.return_value.__aenter__.return_value = mock_conn
            mock_user_result = AsyncMock()
            mock_user_result.mappings.return_value.first.return_value = {
                "discord_id": "999888",
            }
            mock_conn.execute.return_value = mock_user_result

            from core.sync import sync_after_group_change

            result = await sync_after_group_change(
                group_id=1,
                previous_group_id=None,
                user_id=123,
            )

            mock_notify.assert_called_once()
            call_kwargs = mock_notify.call_args.kwargs
            assert call_kwargs["user_id"] == 123
            assert call_kwargs["group_name"] == "Test Group"
            assert call_kwargs["discord_channel_id"] == "123456"
            assert result["notification"] is not None

    @pytest.mark.asyncio
    async def test_no_notification_without_user_id(self):
        """sync_after_group_change should NOT send notification when user_id is None."""
        with (
            patch("core.sync.sync_group", new_callable=AsyncMock) as mock_sync,
            patch("core.sync.notify_member_joined", new_callable=AsyncMock) as mock_notify,
        ):
            mock_sync.return_value = {"discord": {"granted": 1}}

            from core.sync import sync_after_group_change

            result = await sync_after_group_change(
                group_id=1,
                previous_group_id=None,
                user_id=None,
            )

            mock_notify.assert_not_called()
            assert result["notification"] is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_sync.py::TestSyncAfterGroupChange -v`
Expected: FAIL (sync_after_group_change doesn't accept user_id parameter yet)

**Step 3: Update sync_after_group_change**

Modify `sync_after_group_change()` in `core/sync.py` (starting at line 481). Replace the entire function:

```python
async def sync_after_group_change(
    group_id: int,
    previous_group_id: int | None = None,
    user_id: int | None = None,
) -> dict[str, Any]:
    """
    Sync external systems after a group membership change.

    Call this AFTER the database transaction is committed.
    Syncs both the new group and the previous group (if switching).

    When user_id is provided (direct join via API), also sends
    a notification to the user and welcome message to the channel.

    Args:
        group_id: The group the user joined
        previous_group_id: The group the user left (if switching)
        user_id: The user who joined (for direct join notifications)

    Returns:
        Dict with results for new group (and old group if switching):
        {
            "new_group": {...},
            "old_group": {...} | None,
            "notification": {...} | None,
        }
    """
    from .database import get_connection
    from .notifications.actions import notify_member_joined
    from .queries.groups import get_group_member_names, get_group_with_details
    from .tables import users
    from sqlalchemy import select

    results: dict[str, Any] = {"new_group": None, "old_group": None, "notification": None}

    # Sync old group first (if switching) - revokes permissions, removes from calendar
    if previous_group_id:
        logger.info(f"Syncing old group {previous_group_id} after membership change")
        results["old_group"] = await sync_group(previous_group_id)

    # Sync new group - grants permissions, adds to calendar
    logger.info(f"Syncing new group {group_id} after membership change")
    results["new_group"] = await sync_group(group_id)

    # Send notification for direct joins (when user_id is provided)
    if user_id:
        try:
            async with get_connection() as conn:
                # Get group details using existing query function
                group_details = await get_group_with_details(conn, group_id)

                if group_details and group_details.get("discord_text_channel_id"):
                    # Get user's Discord ID
                    user_result = await conn.execute(
                        select(users.c.discord_id).where(users.c.user_id == user_id)
                    )
                    user_row = user_result.mappings().first()

                    # Get member names
                    member_names = await get_group_member_names(conn, group_id)

                    if user_row and user_row.get("discord_id"):
                        results["notification"] = await notify_member_joined(
                            user_id=user_id,
                            group_name=group_details["group_name"],
                            meeting_time_utc=group_details["recurring_meeting_time_utc"] or "TBD",
                            member_names=member_names,
                            discord_channel_id=group_details["discord_text_channel_id"],
                            discord_user_id=user_row["discord_id"],
                        )
        except Exception as e:
            logger.error(f"Failed to send direct join notification: {e}")
            sentry_sdk.capture_exception(e)
            results["notification"] = {"error": str(e)}

    return results
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_sync.py::TestSyncAfterGroupChange -v`
Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat: send notification on direct group join"
jj new
```

---

### Task 5: Update API route to pass user_id

**Files:**
- Modify: `web_api/routes/groups.py`

**Step 1: Update the join_group_endpoint**

Modify `web_api/routes/groups.py` at lines 83-87. Change the sync_after_group_change call to include user_id:

```python
    # Transaction committed - now sync external systems
    # This runs AFTER commit so sync functions can see the changes
    if result.get("success"):
        await sync_after_group_change(
            group_id=result["group_id"],
            previous_group_id=result.get("previous_group_id"),
            user_id=db_user["user_id"],  # Pass user_id for direct join notification
        )
```

**Step 2: Run any existing route tests**

Run: `pytest web_api/tests/ -v -k groups` (if exists)
Expected: All pass

**Step 3: Commit**

```bash
jj describe -m "feat: pass user_id to sync_after_group_change for notifications"
jj new
```

---

### Task 6: Final verification

**Step 1: Run all tests**

Run: `pytest`
Expected: All tests pass

**Step 2: Run linting**

Run: `ruff check . && ruff format --check .`
Expected: No errors

**Step 3: Verify template loading works end-to-end**

Run:
```bash
python -c "
from core.notifications.templates import get_message
msg = get_message('member_joined', 'discord_channel', {'member_mention': '@test'})
print('Discord channel message:', msg)
"
```
Expected: Shows the welcome message with @test mention

**Step 4: Commit if any cleanup needed**

```bash
jj describe -m "test: verify direct join notifications work"
```
