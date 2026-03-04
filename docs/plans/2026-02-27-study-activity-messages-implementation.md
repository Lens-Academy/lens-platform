# Study Activity Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Post one Discord message per group per day that builds up as members complete sections, showing real-time study activity with early-bird callouts.

**Architecture:** Hook into the existing `POST /api/progress/complete` endpoint. After section completion, query `user_content_progress` for today's completions across the user's group, render a message, and either create or edit a Discord message. Message IDs stored in an in-memory dict.

**Tech Stack:** Python, SQLAlchemy (async), discord.py (message send/edit), FastAPI (route hook), pytest + unittest.mock

---

### Task 1: Extend `send_channel_message` to Return Message ID

**Files:**
- Modify: `core/discord_outbound/messages.py:27-37`
- Test: `core/notifications/tests/test_discord_channel.py`

**Step 1: Update the existing test expectation**

The existing test at `core/notifications/tests/test_discord_channel.py:39-56` asserts `result is True`. Update it to expect the message ID string instead.

In `core/notifications/tests/test_discord_channel.py`, find the `TestSendChannelMessage` class and update:

```python
class TestSendChannelMessage:
    @pytest.mark.asyncio
    async def test_sends_message_to_channel(self):
        from core.discord_outbound import send_channel_message

        mock_bot = MagicMock()
        mock_channel = AsyncMock()
        mock_message = MagicMock()
        mock_message.id = 111222333444
        mock_channel.send = AsyncMock(return_value=mock_message)
        mock_bot.fetch_channel = AsyncMock(return_value=mock_channel)

        with patch("core.discord_outbound.bot._bot", mock_bot):
            result = await send_channel_message(
                channel_id="987654321",
                message="Meeting reminder!",
            )

        assert result == "111222333444"
        mock_bot.fetch_channel.assert_called_once_with(987654321)
        mock_channel.send.assert_called_once_with("Meeting reminder!")
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_discord_channel.py::TestSendChannelMessage -v`
Expected: FAIL — `assert True == "111222333444"`

**Step 3: Update `send_channel_message` to return message ID**

In `core/discord_outbound/messages.py`, change `send_channel_message`:

```python
async def send_channel_message(channel_id: str, message: str) -> str | None:
    """Send a message to a channel. Returns the message ID as string, or None on failure."""
    bot = get_bot()
    if not bot:
        return None
    try:
        channel = await bot.fetch_channel(int(channel_id))
        msg = await channel.send(message)
        return str(msg.id)
    except Exception:
        return None
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_discord_channel.py::TestSendChannelMessage -v`
Expected: PASS

**Step 5: Verify all callers handle the new return type**

Run: `grep -rn "send_channel_message" core/ --include="*.py"` to find all callers. Verify each:

- `core/notifications/dispatcher.py:187` — assigns to `result["discord"]`. A non-None string is truthy, so existing `if result["discord"]` checks still work. **OK.**
- `core/guest_notifications.py:56,64` — calls without using return value (`await send_channel_message(...)`). **OK.**
- `core/notifications/scheduler.py` (if any) — check usage pattern.

Then run the **full existing test suite** to confirm nothing breaks:

Run: `pytest core/notifications/tests/ core/tests/test_guest_notifications.py -v`
Expected: All PASS. If any test checks `result is True` explicitly, update it to check truthiness instead.

**Step 6: Add test for bot-not-set returning None**

In the same test file, update or add:

```python
    @pytest.mark.asyncio
    async def test_returns_none_when_bot_not_set(self):
        from core.discord_outbound import send_channel_message

        with patch("core.discord_outbound.bot._bot", None):
            result = await send_channel_message(
                channel_id="987654321",
                message="Hello!",
            )

        assert result is None
```

Run: `pytest core/notifications/tests/test_discord_channel.py -v`
Expected: All PASS

**Step 7: Commit**

Message: `feat: send_channel_message returns message ID instead of bool`

---

### Task 2: Add `edit_channel_message` Function

**Files:**
- Modify: `core/discord_outbound/messages.py`
- Modify: `core/discord_outbound/__init__.py:12,32`
- Test: `core/notifications/tests/test_discord_channel.py`

**Step 1: Write the failing test**

Add to `core/notifications/tests/test_discord_channel.py`:

```python
class TestEditChannelMessage:
    @pytest.mark.asyncio
    async def test_edits_message_in_channel(self):
        from core.discord_outbound.messages import edit_channel_message

        mock_bot = MagicMock()
        mock_message = AsyncMock()
        mock_channel = AsyncMock()
        mock_channel.fetch_message = AsyncMock(return_value=mock_message)
        mock_bot.fetch_channel = AsyncMock(return_value=mock_channel)

        with patch("core.discord_outbound.bot._bot", mock_bot):
            result = await edit_channel_message(
                channel_id="987654321",
                message_id="111222333444",
                content="Updated content!",
            )

        assert result is True
        mock_bot.fetch_channel.assert_called_once_with(987654321)
        mock_channel.fetch_message.assert_called_once_with(111222333444)
        mock_message.edit.assert_called_once_with(content="Updated content!")

    @pytest.mark.asyncio
    async def test_returns_false_when_bot_not_set(self):
        from core.discord_outbound.messages import edit_channel_message

        with patch("core.discord_outbound.bot._bot", None):
            result = await edit_channel_message(
                channel_id="987654321",
                message_id="111222333444",
                content="Updated!",
            )

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_on_exception(self):
        from core.discord_outbound.messages import edit_channel_message

        mock_bot = MagicMock()
        mock_bot.fetch_channel = AsyncMock(side_effect=Exception("Not found"))

        with patch("core.discord_outbound.bot._bot", mock_bot):
            result = await edit_channel_message(
                channel_id="987654321",
                message_id="111222333444",
                content="Updated!",
            )

        assert result is False
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_discord_channel.py::TestEditChannelMessage -v`
Expected: FAIL — ImportError (function doesn't exist yet)

**Step 3: Implement `edit_channel_message`**

Add to `core/discord_outbound/messages.py` after `send_channel_message`:

```python
async def edit_channel_message(channel_id: str, message_id: str, content: str) -> bool:
    """Edit an existing message in a channel. Returns True on success."""
    bot = get_bot()
    if not bot:
        return False
    try:
        channel = await bot.fetch_channel(int(channel_id))
        message = await channel.fetch_message(int(message_id))
        await message.edit(content=content)
        return True
    except Exception:
        return False
```

**Step 4: Export from `__init__.py`**

In `core/discord_outbound/__init__.py`, add `edit_channel_message` to the import on line 12 and the `__all__` list:

```python
from .messages import send_channel_message, send_dm, edit_channel_message
```

Add `"edit_channel_message"` to the `__all__` list after `"send_channel_message"`.

**Step 5: Run tests**

Run: `pytest core/notifications/tests/test_discord_channel.py -v`
Expected: All PASS

**Step 6: Commit**

Message: `feat: add edit_channel_message to discord_outbound`

---

### Task 3: Create `study_activity.py` — Message Rendering

**Files:**
- Create: `core/notifications/study_activity.py`
- Create: `core/notifications/tests/test_study_activity.py`

This task implements the pure rendering logic (no DB, no Discord). The function takes structured data and returns a Discord message string.

**Step 1: Write the failing test**

Create `core/notifications/tests/test_study_activity.py`:

```python
"""Tests for study activity message rendering."""

import pytest


class TestRenderMessage:
    def test_single_user_in_progress(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 3,
                "sections_total": 8,
                "module_completed": False,
                "early_bird_days": None,
            }
        ]

        result = render_study_activity_message(entries)
        assert "Today's Study Activity" in result
        assert "<@123>" in result
        assert "Cognitive Superpowers" in result
        assert "3/8 sections" in result

    def test_completed_module(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": None,
            }
        ]

        result = render_study_activity_message(entries)
        assert "completed" in result.lower()

    def test_early_bird_tag(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": 4,
            }
        ]

        result = render_study_activity_message(entries)
        assert "early bird" in result.lower()
        assert "4 days" in result

    def test_multiple_users_completed_first(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "456",
                "display_name": "Bob",
                "module_title": "Decision Theory",
                "sections_completed": 2,
                "sections_total": 5,
                "module_completed": False,
                "early_bird_days": None,
            },
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": None,
            },
        ]

        result = render_study_activity_message(entries)
        lines = result.strip().split("\n")
        # Find the user lines (skip header)
        user_lines = [l for l in lines if "<@" in l]
        # Completed users should appear before in-progress
        alice_idx = next(i for i, l in enumerate(user_lines) if "Alice" in l)
        bob_idx = next(i for i, l in enumerate(user_lines) if "Bob" in l)
        assert alice_idx < bob_idx, "Completed user (Alice) should appear before in-progress (Bob)"

    def test_empty_entries(self):
        from core.notifications.study_activity import render_study_activity_message

        result = render_study_activity_message([])
        assert result is None
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_study_activity.py::TestRenderMessage -v`
Expected: FAIL — ImportError

**Step 3: Implement rendering**

Create `core/notifications/study_activity.py`:

```python
"""Daily study activity messages for group channels.

Posts one Discord message per group per day that builds up as members
complete sections, showing real-time study activity with early-bird callouts.
"""

import logging
from datetime import timedelta

logger = logging.getLogger(__name__)


def render_study_activity_message(entries: list[dict]) -> str | None:
    """Render the study activity message from structured entry data.

    Args:
        entries: List of dicts with keys: discord_id, display_name,
                 module_title, sections_completed, sections_total,
                 module_completed, early_bird_days

    Returns:
        Formatted Discord message string, or None if no entries.
    """
    if not entries:
        return None

    # Sort: completed first, then in-progress
    sorted_entries = sorted(entries, key=lambda e: (not e["module_completed"],))

    lines = ["\U0001f4da **Today's Study Activity**", ""]

    for entry in sorted_entries:
        mention = f"<@{entry['discord_id']}>"
        module = f"*{entry['module_title']}*"
        sections = f"{entry['sections_completed']}/{entry['sections_total']} sections"

        if entry["module_completed"]:
            line = f"\U0001f389 {mention} \u2014 completed {module}! ({sections}"
            if entry.get("early_bird_days") and entry["early_bird_days"] >= 2:
                line += f" \u00b7 early bird \u2014 {entry['early_bird_days']} days before meeting"
            line += ")"
        else:
            line = f"\U0001f4d6 {mention} \u2014 studying {module} ({sections})"

        lines.append(line)

    return "\n".join(lines)
```

**Step 4: Run tests**

Run: `pytest core/notifications/tests/test_study_activity.py::TestRenderMessage -v`
Expected: All PASS

**Step 5: Commit**

Message: `feat: add study activity message rendering`

---

### Task 4: Create `study_activity.py` — Data Gathering, Early Bird, and Group Info

**Files:**
- Modify: `core/notifications/study_activity.py`
- Modify: `core/notifications/tests/test_study_activity.py`

This task adds:
1. `gather_group_study_data()` — queries today's completions for a group, **scoped to the specific module's section content IDs** (not all lenses)
2. `compute_early_bird_days()` — calculates days until the meeting deadline
3. `get_user_group_info()` — looks up user's group with Discord channel info

**Important:** The progress query MUST filter by the module's section content IDs. Without this, completions from other modules would be counted against the wrong module's total.

**Step 1: Write the failing tests**

Add to `core/notifications/tests/test_study_activity.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, date, timedelta
from uuid import UUID


def _mock_execute_results(*results):
    """Helper: create a mock conn.execute that returns results in order.

    Each result should be a list of dicts (rows). Returns a mock connection
    whose .execute() yields mock result objects in sequence.
    """
    mock_results = []
    for rows in results:
        mock_result = MagicMock()
        mock_result.mappings.return_value.fetchall.return_value = rows
        mock_result.mappings.return_value.first.return_value = rows[0] if rows else None
        mock_results.append(mock_result)
    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock(side_effect=mock_results)
    return mock_conn


def _mock_module(title="Cognitive Superpowers", num_sections=8, content_id_int=100):
    """Helper: create a mock FlattenedModule."""
    mock = MagicMock()
    mock.title = title
    mock.sections = [
        {"contentId": str(UUID(int=i + 1)), "optional": False}
        for i in range(num_sections)
    ]
    mock.content_id = UUID(int=content_id_int)
    return mock


class TestGatherGroupStudyData:
    """Tests for gathering study activity data from the database."""

    @pytest.mark.asyncio
    async def test_returns_entries_for_group_members_who_studied_today(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module(num_sections=8)
        section_ids = [UUID(s["contentId"]) for s in mock_module.sections]

        # 3 queries: members, today's completions (filtered by section IDs), module completion check
        mock_conn = _mock_execute_results(
            # Q1: group members
            [
                {"user_id": 1, "discord_id": "111", "nickname": "Alice", "discord_username": "alice"},
                {"user_id": 2, "discord_id": "222", "nickname": "Bob", "discord_username": "bob"},
            ],
            # Q2: today's lens completions (only 3 of this module's sections, by user 1)
            [
                {"user_id": 1, "content_id": section_ids[0], "content_type": "lens", "completed_at": datetime.now(timezone.utc)},
                {"user_id": 1, "content_id": section_ids[1], "content_type": "lens", "completed_at": datetime.now(timezone.utc)},
                {"user_id": 1, "content_id": section_ids[2], "content_type": "lens", "completed_at": datetime.now(timezone.utc)},
            ],
            # Q3: module completion check (no one completed the full module)
            [],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn,
                group_id=1,
                module_slug="cognitive-superpowers",
                today=date.today(),
            )

        assert len(entries) == 1  # Only user 1 studied
        assert entries[0]["discord_id"] == "111"
        assert entries[0]["display_name"] == "Alice"
        assert entries[0]["sections_completed"] == 3
        assert entries[0]["sections_total"] == 8
        assert entries[0]["module_completed"] is False
        # Verify 3 queries were made (members, progress, module check)
        assert mock_conn.execute.call_count == 3

    @pytest.mark.asyncio
    async def test_module_completed_flag_set_correctly(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module(num_sections=2)
        section_ids = [UUID(s["contentId"]) for s in mock_module.sections]

        mock_conn = _mock_execute_results(
            # Q1: group members
            [{"user_id": 1, "discord_id": "111", "nickname": "Alice", "discord_username": "alice"}],
            # Q2: today's completions (both sections done)
            [
                {"user_id": 1, "content_id": section_ids[0], "content_type": "lens", "completed_at": datetime.now(timezone.utc)},
                {"user_id": 1, "content_id": section_ids[1], "content_type": "lens", "completed_at": datetime.now(timezone.utc)},
            ],
            # Q3: module is completed
            [{"user_id": 1}],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn, group_id=1,
                module_slug="test", today=date.today(),
            )

        assert len(entries) == 1
        assert entries[0]["module_completed"] is True

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_one_studied(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module()

        mock_conn = _mock_execute_results(
            # Q1: group members
            [{"user_id": 1, "discord_id": "111", "nickname": "Alice", "discord_username": "alice"}],
            # Q2: no completions today
            [],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn, group_id=1,
                module_slug="test", today=date.today(),
            )

        assert entries == []
        # Should NOT make the 3rd query since there are no completions
        assert mock_conn.execute.call_count == 2

    @pytest.mark.asyncio
    async def test_uses_nickname_over_discord_username(self):
        from core.notifications.study_activity import gather_group_study_data

        mock_module = _mock_module(num_sections=4)
        section_ids = [UUID(s["contentId"]) for s in mock_module.sections]

        mock_conn = _mock_execute_results(
            [{"user_id": 1, "discord_id": "111", "nickname": "CustomName", "discord_username": "discord_user"}],
            [{"user_id": 1, "content_id": section_ids[0], "content_type": "lens", "completed_at": datetime.now(timezone.utc)}],
            [],
        )

        with patch(
            "core.notifications.study_activity.load_flattened_module",
            return_value=mock_module,
        ):
            entries = await gather_group_study_data(
                conn=mock_conn, group_id=1,
                module_slug="test", today=date.today(),
            )

        assert entries[0]["display_name"] == "CustomName"


class TestComputeEarlyBirdDays:
    """Tests for early bird day calculation."""

    @pytest.mark.asyncio
    async def test_returns_days_when_meeting_is_far(self):
        from core.notifications.study_activity import compute_early_bird_days

        # Meeting is 5 days from now
        meeting_time = datetime.now(timezone.utc) + timedelta(days=5)
        mock_conn = _mock_execute_results(
            [{"scheduled_at": meeting_time}],
        )

        with patch("core.notifications.study_activity.load_course") as mock_load, \
             patch("core.notifications.study_activity.get_due_by_meeting", return_value=2):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn, group_id=1, module_slug="test", course_slug="ai-safety",
            )

        assert result == 5

    @pytest.mark.asyncio
    async def test_returns_none_when_meeting_is_tomorrow(self):
        from core.notifications.study_activity import compute_early_bird_days

        # Meeting is 1 day from now (below threshold of 2)
        meeting_time = datetime.now(timezone.utc) + timedelta(days=1)
        mock_conn = _mock_execute_results(
            [{"scheduled_at": meeting_time}],
        )

        with patch("core.notifications.study_activity.load_course") as mock_load, \
             patch("core.notifications.study_activity.get_due_by_meeting", return_value=1):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn, group_id=1, module_slug="test", course_slug="ai-safety",
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_no_meeting_found(self):
        from core.notifications.study_activity import compute_early_bird_days

        mock_conn = _mock_execute_results(
            [],  # No meeting row
        )

        with patch("core.notifications.study_activity.load_course") as mock_load, \
             patch("core.notifications.study_activity.get_due_by_meeting", return_value=3):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn, group_id=1, module_slug="test", course_slug="ai-safety",
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_module_not_due_for_any_meeting(self):
        from core.notifications.study_activity import compute_early_bird_days

        mock_conn = AsyncMock()

        with patch("core.notifications.study_activity.load_course") as mock_load, \
             patch("core.notifications.study_activity.get_due_by_meeting", return_value=None):
            mock_load.return_value = MagicMock()
            result = await compute_early_bird_days(
                mock_conn, group_id=1, module_slug="test", course_slug="ai-safety",
            )

        assert result is None
        mock_conn.execute.assert_not_called()  # Should short-circuit

    @pytest.mark.asyncio
    async def test_returns_none_when_course_not_found(self):
        from core.notifications.study_activity import compute_early_bird_days

        mock_conn = AsyncMock()

        with patch("core.notifications.study_activity.load_course", side_effect=Exception("not found")):
            result = await compute_early_bird_days(
                mock_conn, group_id=1, module_slug="test", course_slug="bad-slug",
            )

        assert result is None


class TestGetUserGroupInfo:
    """Tests for looking up user's group with Discord channel info."""

    @pytest.mark.asyncio
    async def test_returns_group_info_for_active_member(self):
        from core.notifications.study_activity import get_user_group_info

        mock_conn = _mock_execute_results(
            [{"group_id": 5, "discord_text_channel_id": "CH999", "cohort_id": 10, "course_slug": "ai-safety"}],
        )
        result = await get_user_group_info(mock_conn, user_id=1)

        assert result is not None
        assert result["group_id"] == 5
        assert result["discord_text_channel_id"] == "CH999"
        assert result["course_slug"] == "ai-safety"

    @pytest.mark.asyncio
    async def test_returns_none_when_not_in_group(self):
        from core.notifications.study_activity import get_user_group_info

        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = None
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(return_value=mock_result)

        result = await get_user_group_info(mock_conn, user_id=1)
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_group_has_no_channel(self):
        from core.notifications.study_activity import get_user_group_info

        mock_conn = _mock_execute_results(
            [{"group_id": 5, "discord_text_channel_id": None, "cohort_id": 10, "course_slug": "ai-safety"}],
        )
        result = await get_user_group_info(mock_conn, user_id=1)
        assert result is None
```

**Step 2: Run tests to verify they fail**

Run: `pytest core/notifications/tests/test_study_activity.py::TestGatherGroupStudyData core/notifications/tests/test_study_activity.py::TestComputeEarlyBirdDays core/notifications/tests/test_study_activity.py::TestGetUserGroupInfo -v`
Expected: FAIL — ImportError (functions don't exist yet)

**Step 3: Implement data gathering**

Add to `core/notifications/study_activity.py`:

```python
from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy import select, and_, cast, Date, func
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import users, groups, groups_users, user_content_progress, meetings, cohorts
from core.enums import GroupUserStatus


async def get_user_group_info(conn: AsyncConnection, user_id: int) -> dict | None:
    """Get user's active group with Discord channel and course info.

    Returns dict with group_id, discord_text_channel_id, cohort_id, course_slug
    or None if user is not in an active group with a channel.
    """
    query = (
        select(
            groups.c.group_id,
            groups.c.discord_text_channel_id,
            groups.c.cohort_id,
            func.coalesce(groups.c.course_slug_override, cohorts.c.course_slug).label("course_slug"),
        )
        .select_from(
            groups_users
            .join(groups, groups_users.c.group_id == groups.c.group_id)
            .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        )
        .where(groups_users.c.user_id == user_id)
        .where(groups_users.c.status == GroupUserStatus.active)
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    if not row or not row["discord_text_channel_id"]:
        return None
    return dict(row)


async def gather_group_study_data(
    conn: AsyncConnection,
    *,
    group_id: int,
    module_slug: str,
    today: date,
) -> list[dict]:
    """Query today's study progress for all members of a group on a specific module.

    IMPORTANT: The progress query is filtered to only count completions of
    sections belonging to this module (by content ID). This prevents
    cross-module completion counts from corrupting the section tally.

    Args:
        conn: Database connection
        group_id: The group to query
        module_slug: Current module slug being studied
        today: The date to check completions for (UTC)

    Returns:
        List of entry dicts suitable for render_study_activity_message().
    """
    from core.modules.loader import load_flattened_module, ModuleNotFoundError

    # Load module FIRST — we need its section content IDs for the query filter
    try:
        module = load_flattened_module(module_slug)
    except ModuleNotFoundError:
        logger.warning(f"Module {module_slug} not found for study activity")
        return []

    required_sections = [s for s in module.sections if not s.get("optional", False)]
    total_sections = len(required_sections)
    section_content_ids = [
        UUID(s["contentId"]) for s in required_sections if s.get("contentId")
    ]

    if not section_content_ids:
        return []

    # Get group members with their discord info
    members_query = (
        select(
            users.c.user_id,
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
        )
        .select_from(
            groups_users.join(users, groups_users.c.user_id == users.c.user_id)
        )
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.status == GroupUserStatus.active)
    )
    members_result = await conn.execute(members_query)
    members = members_result.mappings().fetchall()

    if not members:
        return []

    member_user_ids = [m["user_id"] for m in members]

    # Get today's lens completions for these users — FILTERED BY THIS MODULE'S SECTIONS
    progress_query = (
        select(user_content_progress)
        .where(
            and_(
                user_content_progress.c.user_id.in_(member_user_ids),
                user_content_progress.c.content_id.in_(section_content_ids),
                user_content_progress.c.content_type == "lens",
                user_content_progress.c.completed_at.isnot(None),
                cast(user_content_progress.c.completed_at, Date) == today,
            )
        )
    )
    progress_result = await conn.execute(progress_query)
    completions = progress_result.mappings().fetchall()

    if not completions:
        return []

    # Count completions per user
    user_completion_count: dict[int, int] = {}
    for row in completions:
        uid = row["user_id"]
        user_completion_count[uid] = user_completion_count.get(uid, 0) + 1

    # Check if any user completed the module (module content_id has completed_at set)
    module_completed_users: set[int] = set()
    if module.content_id:
        module_progress_query = (
            select(user_content_progress.c.user_id)
            .where(
                and_(
                    user_content_progress.c.user_id.in_(list(user_completion_count.keys())),
                    user_content_progress.c.content_id == module.content_id,
                    user_content_progress.c.content_type == "module",
                    user_content_progress.c.completed_at.isnot(None),
                )
            )
        )
        module_result = await conn.execute(module_progress_query)
        module_completed_users = {row["user_id"] for row in module_result.mappings().fetchall()}

    # Build entries
    members_by_id = {m["user_id"]: m for m in members}
    entries = []
    for uid, count in user_completion_count.items():
        member = members_by_id.get(uid)
        if not member or not member["discord_id"]:
            continue
        display_name = member["nickname"] or member["discord_username"] or "Unknown"
        entries.append({
            "discord_id": member["discord_id"],
            "display_name": display_name,
            "module_title": module.title,
            "sections_completed": min(count, total_sections),
            "sections_total": total_sections,
            "module_completed": uid in module_completed_users,
            "early_bird_days": None,  # Filled in by caller
        })

    return entries


async def compute_early_bird_days(
    conn: AsyncConnection,
    *,
    group_id: int,
    module_slug: str,
    course_slug: str,
) -> int | None:
    """Compute days until the meeting this module is due for.

    Returns number of days until meeting (if >= 2), or None.
    """
    from core.modules.course_loader import load_course, get_due_by_meeting

    try:
        course = load_course(course_slug)
    except Exception:
        return None

    due_by_meeting = get_due_by_meeting(course, module_slug)
    if due_by_meeting is None:
        return None

    # Find the meeting with this number for this group
    query = (
        select(meetings.c.scheduled_at)
        .where(
            and_(
                meetings.c.group_id == group_id,
                meetings.c.meeting_number == due_by_meeting,
            )
        )
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    if not row:
        return None

    meeting_dt = row["scheduled_at"]
    now = datetime.now(timezone.utc)
    delta = (meeting_dt - now).days
    return delta if delta >= 2 else None
```

**Step 4: Run tests**

Run: `pytest core/notifications/tests/test_study_activity.py -v`
Expected: All PASS

**Step 5: Commit**

Message: `feat: add study activity data gathering, early bird calc, and group info lookup`

---

### Task 5: Create `study_activity.py` — Main Entry Point (Send/Edit Message)

**Files:**
- Modify: `core/notifications/study_activity.py`
- Modify: `core/notifications/tests/test_study_activity.py`

This task adds the main `update_study_activity()` function that orchestrates: look up group, gather data, compute early bird, render, send or edit. Also adds memory pruning for `_daily_messages`.

**Step 1: Write the failing tests**

Add to `core/notifications/tests/test_study_activity.py`:

```python
import contextlib


@contextlib.asynccontextmanager
async def _mock_update_context(*, group_info, entries, early_bird_days=None):
    """Shared test fixture for update_study_activity tests.

    Mocks get_connection, get_user_group_info, gather_group_study_data,
    compute_early_bird_days, send_channel_message, and edit_channel_message.

    Yields a dict of all mocks for assertion.
    """
    with (
        patch("core.notifications.study_activity.get_connection") as mock_get_conn,
        patch(
            "core.notifications.study_activity.get_user_group_info",
            new_callable=AsyncMock, return_value=group_info,
        ) as mock_group_info,
        patch(
            "core.notifications.study_activity.gather_group_study_data",
            new_callable=AsyncMock, return_value=entries,
        ) as mock_gather,
        patch(
            "core.notifications.study_activity.compute_early_bird_days",
            new_callable=AsyncMock, return_value=early_bird_days,
        ) as mock_early_bird,
        patch(
            "core.notifications.study_activity.send_channel_message",
            new_callable=AsyncMock, return_value="MSG456",
        ) as mock_send,
        patch(
            "core.notifications.study_activity.edit_channel_message",
            new_callable=AsyncMock, return_value=True,
        ) as mock_edit,
    ):
        mock_conn = AsyncMock()
        mock_get_conn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_get_conn.return_value.__aexit__ = AsyncMock(return_value=None)

        yield {
            "send": mock_send,
            "edit": mock_edit,
            "gather": mock_gather,
            "group_info": mock_group_info,
            "early_bird": mock_early_bird,
        }


_SAMPLE_GROUP_INFO = {
    "group_id": 1,
    "discord_text_channel_id": "CH123",
    "cohort_id": 10,
    "course_slug": "ai-safety",
}

_SAMPLE_ENTRY = {
    "discord_id": "111",
    "display_name": "Alice",
    "module_title": "Cognitive Superpowers",
    "sections_completed": 3,
    "sections_total": 8,
    "module_completed": False,
    "early_bird_days": None,
}


class TestUpdateStudyActivity:
    """Tests for the main update_study_activity entry point."""

    @pytest.mark.asyncio
    async def test_creates_new_message_when_none_exists(self):
        from core.notifications.study_activity import update_study_activity, _daily_messages
        _daily_messages.clear()

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["send"].assert_called_once()
        mocks["edit"].assert_not_called()
        assert len(_daily_messages) == 1

    @pytest.mark.asyncio
    async def test_edits_existing_message(self):
        from core.notifications.study_activity import update_study_activity, _daily_messages
        _daily_messages.clear()
        _daily_messages[(1, date.today())] = "EXISTING_MSG"

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["edit"].assert_called_once()
        mocks["send"].assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_when_user_not_in_group(self):
        from core.notifications.study_activity import update_study_activity

        async with _mock_update_context(
            group_info=None, entries=[]
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="test")

        mocks["send"].assert_not_called()
        mocks["gather"].assert_not_called()

    @pytest.mark.asyncio
    async def test_creates_new_message_when_edit_fails(self):
        from core.notifications.study_activity import update_study_activity, _daily_messages
        _daily_messages.clear()
        _daily_messages[(1, date.today())] = "DELETED_MSG"

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ) as mocks:
            mocks["edit"].return_value = False  # Edit fails
            mocks["send"].return_value = "NEW_MSG_ID"
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        mocks["edit"].assert_called_once()
        mocks["send"].assert_called_once()
        assert _daily_messages[(1, date.today())] == "NEW_MSG_ID"

    @pytest.mark.asyncio
    async def test_prunes_old_entries_from_daily_messages(self):
        from core.notifications.study_activity import update_study_activity, _daily_messages
        _daily_messages.clear()
        # Add stale entries from 3 days ago
        old_date = date.today() - timedelta(days=3)
        _daily_messages[(1, old_date)] = "OLD_MSG"
        _daily_messages[(2, old_date)] = "OLD_MSG2"

        async with _mock_update_context(
            group_info=_SAMPLE_GROUP_INFO, entries=[_SAMPLE_ENTRY]
        ) as mocks:
            await update_study_activity(user_id=1, module_slug="cognitive-superpowers")

        # Old entries should be pruned
        assert (1, old_date) not in _daily_messages
        assert (2, old_date) not in _daily_messages
        # Today's entry should exist
        assert (1, date.today()) in _daily_messages
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_study_activity.py::TestUpdateStudyActivity -v`
Expected: FAIL — ImportError

**Step 3: Implement the entry point**

Add to `core/notifications/study_activity.py`:

```python
from core.database import get_connection
from core.discord_outbound import send_channel_message
from core.discord_outbound.messages import edit_channel_message

# In-memory storage: (group_id, date) -> discord_message_id
_daily_messages: dict[tuple[int, date], str] = {}

# Note: get_user_group_info and compute_early_bird_days were added in Task 4.


def _prune_old_messages() -> None:
    """Remove entries older than 2 days to prevent unbounded memory growth."""
    cutoff = date.today() - timedelta(days=2)
    stale_keys = [k for k in _daily_messages if k[1] < cutoff]
    for k in stale_keys:
        del _daily_messages[k]


async def update_study_activity(
    user_id: int,
    module_slug: str,
) -> None:
    """Main entry point: update the daily study activity message for a user's group.

    Called after a section is marked complete. Looks up the user's group,
    gathers today's study data, renders the message, and creates or edits
    the Discord message.

    Runs as a fire-and-forget asyncio task. All exceptions are caught and
    logged to prevent "Task exception was never retrieved" warnings.
    """
    try:
        today = date.today()
        _prune_old_messages()

        async with get_connection() as conn:
            # Look up user's group
            group_info = await get_user_group_info(conn, user_id)
            if not group_info:
                return

            group_id = group_info["group_id"]
            channel_id = group_info["discord_text_channel_id"]
            course_slug = group_info["course_slug"]

            # Gather today's study data
            entries = await gather_group_study_data(
                conn,
                group_id=group_id,
                module_slug=module_slug,
                today=today,
            )
            if not entries:
                return

            # Compute early bird for completed modules
            for entry in entries:
                if entry["module_completed"]:
                    days = await compute_early_bird_days(
                        conn,
                        group_id=group_id,
                        module_slug=module_slug,
                        course_slug=course_slug,
                    )
                    entry["early_bird_days"] = days

            # Render message
            content = render_study_activity_message(entries)
            if not content:
                return

            # Send or edit
            key = (group_id, today)
            existing_msg_id = _daily_messages.get(key)

            if existing_msg_id:
                success = await edit_channel_message(channel_id, existing_msg_id, content)
                if not success:
                    # Message was deleted or inaccessible, create new
                    new_id = await send_channel_message(channel_id, content)
                    if new_id:
                        _daily_messages[key] = new_id
            else:
                new_id = await send_channel_message(channel_id, content)
                if new_id:
                    _daily_messages[key] = new_id

    except Exception:
        logger.exception("Failed to update study activity message")
```

**Step 4: Run tests**

Run: `pytest core/notifications/tests/test_study_activity.py -v`
Expected: All PASS

**Step 5: Commit**

Message: `feat: add study activity message orchestration (send/edit daily message)`

---

### Task 6: Hook into Progress Completion Route

**Files:**
- Modify: `web_api/routes/progress.py:140-214`
- Create: `web_api/tests/test_progress_study_activity.py`

**Step 1: Write the failing tests**

Create `web_api/tests/test_progress_study_activity.py`:

```python
"""Tests for study activity hook in the progress completion route."""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from uuid import UUID


class TestStudyActivityHook:
    """Verify that completing a lens triggers the study activity update."""

    @pytest.mark.asyncio
    async def test_lens_completion_with_module_slug_triggers_update(self):
        """POST /api/progress/complete with content_type=lens and module_slug
        should create an asyncio task calling update_study_activity."""
        created_tasks = []
        original_create_task = asyncio.create_task

        def capture_create_task(coro, **kwargs):
            """Capture coros passed to create_task without actually scheduling."""
            created_tasks.append(coro)
            # Close the coroutine to avoid RuntimeWarning
            coro.close()
            return MagicMock()

        with (
            patch("web_api.routes.progress.asyncio.create_task", side_effect=capture_create_task),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch(
                "web_api.routes.progress.get_transaction",
            ) as mock_txn,
            patch(
                "web_api.routes.progress.get_user_or_token",
                return_value=(42, None),  # authenticated user_id=42
            ),
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest
            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="lens",
                content_title="Test Section",
                module_slug="cognitive-superpowers",
            )
            await complete_content(body=body, auth=(42, None))

        # Should have created exactly one task for study activity
        assert len(created_tasks) == 1

    @pytest.mark.asyncio
    async def test_module_completion_does_not_trigger_update(self):
        """content_type='module' should NOT trigger study activity update."""
        created_tasks = []

        def capture_create_task(coro, **kwargs):
            created_tasks.append(coro)
            coro.close()
            return MagicMock()

        with (
            patch("web_api.routes.progress.asyncio.create_task", side_effect=capture_create_task),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch("web_api.routes.progress.get_transaction") as mock_txn,
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest
            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="module",
                content_title="Test Module",
                module_slug="cognitive-superpowers",
            )
            await complete_content(body=body, auth=(42, None))

        assert len(created_tasks) == 0

    @pytest.mark.asyncio
    async def test_anonymous_user_does_not_trigger_update(self):
        """Anonymous users (user_id=None) should NOT trigger study activity update."""
        created_tasks = []

        def capture_create_task(coro, **kwargs):
            created_tasks.append(coro)
            coro.close()
            return MagicMock()

        with (
            patch("web_api.routes.progress.asyncio.create_task", side_effect=capture_create_task),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch("web_api.routes.progress.get_transaction") as mock_txn,
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest
            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="lens",
                content_title="Test Section",
                module_slug="cognitive-superpowers",
            )
            await complete_content(body=body, auth=(None, UUID(int=99)))

        assert len(created_tasks) == 0

    @pytest.mark.asyncio
    async def test_no_module_slug_does_not_trigger_update(self):
        """Lens completion without module_slug should NOT trigger study activity update."""
        created_tasks = []

        def capture_create_task(coro, **kwargs):
            created_tasks.append(coro)
            coro.close()
            return MagicMock()

        with (
            patch("web_api.routes.progress.asyncio.create_task", side_effect=capture_create_task),
            patch(
                "web_api.routes.progress.mark_content_complete",
                new_callable=AsyncMock,
                return_value={"completed_at": None},
            ),
            patch("web_api.routes.progress.get_transaction") as mock_txn,
        ):
            mock_conn = AsyncMock()
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=None)

            from web_api.routes.progress import complete_content, MarkCompleteRequest
            body = MarkCompleteRequest(
                content_id=UUID(int=1),
                content_type="lens",
                content_title="Test Section",
                # No module_slug
            )
            await complete_content(body=body, auth=(42, None))

        assert len(created_tasks) == 0
```

**Step 2: Run tests to verify they fail**

Run: `pytest web_api/tests/test_progress_study_activity.py -v`
Expected: FAIL — the `asyncio.create_task` call doesn't exist in the route yet (no tasks captured)

**Step 3: Add the hook to the progress route**

In `web_api/routes/progress.py`, add the import at the top (after existing imports):

```python
import asyncio
```

Then, after the `async with get_transaction() as conn:` block ends (after line 247, before the `return` on line 248), add:

```python
    # Fire-and-forget: update study activity message in group channel
    # Only for authenticated users completing lens content with a module_slug
    if body.module_slug and user_id and body.content_type == "lens":
        from core.notifications.study_activity import update_study_activity

        asyncio.create_task(
            update_study_activity(
                user_id=user_id,
                module_slug=body.module_slug,
            )
        )
```

The full context around the insertion point — add it between the end of the `async with` block and the `return`:

```python
    # ... end of async with get_transaction() block ...

    # Fire-and-forget: update study activity message in group channel
    # Only for authenticated users completing lens content with a module_slug
    if body.module_slug and user_id and body.content_type == "lens":
        from core.notifications.study_activity import update_study_activity

        asyncio.create_task(
            update_study_activity(
                user_id=user_id,
                module_slug=body.module_slug,
            )
        )

    return MarkCompleteResponse(
        completed_at=(
            ...
```

**Step 4: Run all tests**

Run: `pytest web_api/tests/test_progress_study_activity.py core/notifications/tests/test_study_activity.py -v`
Expected: All PASS

**Step 5: Commit**

Message: `feat: hook study activity messages into section completion endpoint`

---

### Task 7: Manual Integration Testing

**No code changes — verification only.**

**Step 1: Start the dev server**

```bash
cd /home/penguin/code/lens-platform/ws1
python main.py --dev --port 8100
```

**Step 2: Check logs**

Open the frontend at `http://dev.vps:3100`, log in as a user who is in a study group, navigate to a module, and complete a section. Watch the server logs for:
- `"Failed to update study activity message"` (error case)
- Or no error (success case — check Discord channel)

**Step 3: Verify in Discord**

Check the user's group channel for the study activity message. Complete another section and verify the message is **edited** (not a new message).

**Step 4: Run full test suite**

```bash
pytest
ruff check .
ruff format --check .
```

Expected: All pass, no lint issues.

---

### Task 8: Final Review and Cleanup

**Step 1: Review all changes**

```bash
jj diff
```

Verify:
- `core/discord_outbound/messages.py` — `send_channel_message` returns `str | None`, new `edit_channel_message`
- `core/discord_outbound/__init__.py` — exports `edit_channel_message`
- `core/notifications/study_activity.py` — new file with render, gather, get_user_group_info, compute_early_bird_days, update functions, and `_prune_old_messages`
- `core/notifications/tests/test_study_activity.py` — new test file with tests for all functions
- `core/notifications/tests/test_discord_channel.py` — updated tests
- `web_api/routes/progress.py` — fire-and-forget hook with condition guards
- `web_api/tests/test_progress_study_activity.py` — integration tests for the hook

**Step 2: Run full test suite and linting**

```bash
pytest
ruff check .
ruff format --check .
```

Expected: All pass, no lint issues.

**Step 3: Squash or organize commits if needed**

All 6 commits should be clean and focused. If the user wants to squash into fewer commits, use `jj squash`.
