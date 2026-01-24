# Personalized Timezone in Email Reminders

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show meeting times in the user's local timezone with explicit offset (e.g., "Wednesday at 5:00 PM (UTC+7)") instead of UTC.

**Architecture:** Store meeting time as ISO string in scheduler context. When sending notifications, look up user's timezone and format the time locally. Fall back to UTC for users without timezone or for channel messages.

**Tech Stack:** Python, pytz, APScheduler, pytest

---

## Task 1: Add timezone formatting utility function

**Files:**
- Modify: `core/timezone.py`
- Create: `core/tests/test_timezone_formatting.py`

**Step 1: Write the failing test**

Create test file `core/tests/test_timezone_formatting.py`:

```python
"""Tests for timezone formatting utilities."""

import pytest
from datetime import datetime
from zoneinfo import ZoneInfo


class TestFormatDatetimeInTimezone:
    def test_formats_in_user_timezone_with_offset(self):
        """Meeting at Wed 15:00 UTC should show as Wed 10:00 PM (UTC+7) in Bangkok."""
        from core.timezone import format_datetime_in_timezone

        utc_dt = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))  # Wed 15:00 UTC
        result = format_datetime_in_timezone(utc_dt, "Asia/Bangkok")

        assert "Wednesday" in result
        assert "10:00 PM" in result
        assert "(UTC+7)" in result

    def test_formats_date_correctly_when_day_changes(self):
        """Meeting at Wed 01:00 UTC should show as Tue in PST (day changes)."""
        from core.timezone import format_datetime_in_timezone

        utc_dt = datetime(2024, 1, 10, 1, 0, tzinfo=ZoneInfo("UTC"))  # Wed 01:00 UTC
        result = format_datetime_in_timezone(utc_dt, "America/Los_Angeles")

        assert "Tuesday" in result  # Day changed due to -8 offset
        assert "(UTC-8)" in result

    def test_falls_back_to_utc_for_invalid_timezone(self):
        """Invalid timezone should fall back to UTC."""
        from core.timezone import format_datetime_in_timezone

        utc_dt = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))
        result = format_datetime_in_timezone(utc_dt, "Invalid/Timezone")

        assert "Wednesday" in result
        assert "3:00 PM" in result
        assert "(UTC)" in result

    def test_formats_naive_datetime_as_utc(self):
        """Naive datetime should be treated as UTC."""
        from core.timezone import format_datetime_in_timezone

        naive_dt = datetime(2024, 1, 10, 15, 0)  # No timezone
        result = format_datetime_in_timezone(naive_dt, "Asia/Tokyo")

        assert "Thursday" in result  # +9 hours from Wed 15:00 = Thu 00:00
        assert "(UTC+9)" in result


class TestFormatDateInTimezone:
    def test_formats_date_only(self):
        """Should format just the date portion."""
        from core.timezone import format_date_in_timezone

        utc_dt = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))
        result = format_date_in_timezone(utc_dt, "America/New_York")

        assert "Wednesday" in result
        assert "January 10" in result
        # No time component
        assert ":" not in result

    def test_date_changes_with_timezone(self):
        """Date should change when timezone crosses midnight."""
        from core.timezone import format_date_in_timezone

        # Wed Jan 10 at 01:00 UTC = Tue Jan 9 in LA
        utc_dt = datetime(2024, 1, 10, 1, 0, tzinfo=ZoneInfo("UTC"))
        result = format_date_in_timezone(utc_dt, "America/Los_Angeles")

        assert "Tuesday" in result
        assert "January 9" in result
```

**Step 2: Run test to verify it fails**

Run: `pytest core/tests/test_timezone_formatting.py -v`
Expected: FAIL with `ImportError: cannot import name 'format_datetime_in_timezone'`

**Step 3: Write minimal implementation**

Add to `core/timezone.py`:

```python
def format_datetime_in_timezone(
    utc_dt: datetime,
    tz_name: str,
) -> str:
    """
    Format a UTC datetime in the user's local timezone with explicit offset.

    Args:
        utc_dt: Datetime in UTC (naive datetimes treated as UTC)
        tz_name: Timezone string (e.g., "America/New_York")

    Returns:
        Formatted string like "Wednesday at 3:00 PM (UTC-5)"
    """
    # Ensure datetime is timezone-aware (treat naive as UTC)
    if utc_dt.tzinfo is None:
        utc_dt = pytz.UTC.localize(utc_dt)

    # Try to convert to user timezone, fall back to UTC
    try:
        tz = pytz.timezone(tz_name)
        local_dt = utc_dt.astimezone(tz)
    except pytz.UnknownTimeZoneError:
        local_dt = utc_dt.astimezone(pytz.UTC)

    # Format the time
    day_name = local_dt.strftime("%A")
    time_str = local_dt.strftime("%I:%M %p").lstrip("0")  # "3:00 PM" not "03:00 PM"

    # Get UTC offset string (e.g., "UTC+7" or "UTC-5")
    offset = local_dt.strftime("%z")  # "+0700" or "-0500"
    if offset:
        hours = int(offset[:3])
        minutes = int(offset[0] + offset[3:5])
        if minutes == 0:
            offset_str = f"UTC{hours:+d}" if hours != 0 else "UTC"
        else:
            offset_str = f"UTC{hours:+d}:{abs(minutes):02d}"
    else:
        offset_str = "UTC"

    return f"{day_name} at {time_str} ({offset_str})"


def format_date_in_timezone(
    utc_dt: datetime,
    tz_name: str,
) -> str:
    """
    Format a UTC datetime as just a date in the user's local timezone.

    Args:
        utc_dt: Datetime in UTC (naive datetimes treated as UTC)
        tz_name: Timezone string (e.g., "America/New_York")

    Returns:
        Formatted string like "Wednesday, January 10"
    """
    # Ensure datetime is timezone-aware (treat naive as UTC)
    if utc_dt.tzinfo is None:
        utc_dt = pytz.UTC.localize(utc_dt)

    # Try to convert to user timezone, fall back to UTC
    try:
        tz = pytz.timezone(tz_name)
        local_dt = utc_dt.astimezone(tz)
    except pytz.UnknownTimeZoneError:
        local_dt = utc_dt.astimezone(pytz.UTC)

    return local_dt.strftime("%A, %B %d").replace(" 0", " ")  # "January 9" not "January 09"
```

**Step 4: Run test to verify it passes**

Run: `pytest core/tests/test_timezone_formatting.py -v`
Expected: PASS

**Step 5: Commit**

```bash
jj new -m "feat(notifications): add timezone formatting utilities

Add format_datetime_in_timezone() and format_date_in_timezone() to
convert UTC datetimes to user's local timezone with explicit offset
display (e.g., 'Wednesday at 3:00 PM (UTC+7)').

This enables personalized meeting time display in email reminders."
```

---

## Task 2: Store ISO timestamp in scheduler context

**Files:**
- Modify: `core/notifications/actions.py:160-168`
- Modify: `core/notifications/tests/test_actions.py`

**Step 1: Write the failing test**

Add to `core/notifications/tests/test_actions.py`:

```python
class TestScheduleMeetingRemindersContext:
    def test_context_includes_iso_timestamp(self):
        """Context should include meeting_time_utc as ISO string for per-user formatting."""
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime(2024, 1, 10, 15, 0, tzinfo=ZoneInfo("UTC"))

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
                user_ids=[1, 2, 3],
                group_name="Test Group",
                discord_channel_id="123456",
            )

        # Get the context from the first call (24h reminder)
        call_kwargs = mock_schedule.call_args_list[0][1]
        context = call_kwargs["context"]

        # Should have ISO timestamp for per-user formatting
        assert "meeting_time_utc" in context
        assert context["meeting_time_utc"] == "2024-01-10T15:00:00+00:00"

        # Should still have UTC fallback for channel messages
        assert "meeting_time" in context
        assert "UTC" in context["meeting_time"]
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_actions.py::TestScheduleMeetingRemindersContext -v`
Expected: FAIL with `KeyError: 'meeting_time_utc'`

**Step 3: Write minimal implementation**

Edit `core/notifications/actions.py`, change lines 160-168 to:

```python
    context = {
        "group_name": group_name,
        # ISO timestamp for per-user timezone formatting
        "meeting_time_utc": meeting_time.isoformat(),
        "meeting_date_utc": meeting_time.isoformat(),
        # UTC fallback for channel messages (no user context)
        "meeting_time": meeting_time.strftime("%A at %H:%M UTC"),
        "meeting_date": meeting_time.strftime("%A, %B %d"),
        "module_url": module_url or build_module_url("next"),
        "discord_channel_url": build_discord_channel_url(channel_id=discord_channel_id),
        "module_list": "- Check your course dashboard for assigned modules",
        "modules_remaining": "some",
    }
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_actions.py -v`
Expected: PASS

**Step 5: Commit**

```bash
jj new -m "feat(notifications): store ISO timestamp in reminder context

Add meeting_time_utc and meeting_date_utc as ISO strings to the
scheduler context. This enables per-user timezone formatting when
notifications are sent, while preserving UTC fallback for channel
messages."
```

---

## Task 3: Format times per-user in dispatcher

**Files:**
- Modify: `core/notifications/dispatcher.py:127-137`
- Modify: `core/notifications/tests/test_dispatcher.py`

**Step 1: Write the failing test**

Add to `core/notifications/tests/test_dispatcher.py`:

```python
class TestTimezoneFormatting:
    @pytest.mark.asyncio
    async def test_formats_meeting_time_in_user_timezone(self):
        """meeting_time should be formatted in user's timezone when sending."""
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "timezone": "Asia/Bangkok",  # UTC+7
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        captured_body = None

        def capture_email(to_email, subject, body):
            nonlocal captured_body
            captured_body = body
            return True

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email",
                side_effect=capture_email,
            ):
                await send_notification(
                    user_id=1,
                    message_type="meeting_reminder_24h",
                    context={
                        "meeting_time_utc": "2024-01-10T15:00:00+00:00",  # Wed 15:00 UTC
                        "meeting_time": "Wednesday at 15:00 UTC",  # Fallback
                        "group_name": "Test Group",
                        "module_url": "https://example.com",
                        "module_list": "- Module 1",
                        "discord_channel_url": "https://discord.com/channels/123",
                    },
                )

        # Should be formatted in Bangkok time (UTC+7)
        assert captured_body is not None
        assert "Wednesday at 10:00 PM (UTC+7)" in captured_body
        assert "15:00 UTC" not in captured_body

    @pytest.mark.asyncio
    async def test_uses_utc_fallback_when_no_timezone(self):
        """Should use UTC fallback when user has no timezone set."""
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "timezone": None,  # No timezone
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        captured_body = None

        def capture_email(to_email, subject, body):
            nonlocal captured_body
            captured_body = body
            return True

        with patch(
            "core.notifications.dispatcher.get_user_by_id",
            AsyncMock(return_value=mock_user),
        ):
            with patch(
                "core.notifications.dispatcher.send_email",
                side_effect=capture_email,
            ):
                await send_notification(
                    user_id=1,
                    message_type="meeting_reminder_24h",
                    context={
                        "meeting_time_utc": "2024-01-10T15:00:00+00:00",
                        "meeting_time": "Wednesday at 15:00 UTC",
                        "group_name": "Test Group",
                        "module_url": "https://example.com",
                        "module_list": "- Module 1",
                        "discord_channel_url": "https://discord.com/channels/123",
                    },
                )

        # Should fall back to UTC
        assert captured_body is not None
        assert "Wednesday at 15:00 UTC" in captured_body
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_dispatcher.py::TestTimezoneFormatting -v`
Expected: FAIL with `AssertionError: assert 'Wednesday at 10:00 PM (UTC+7)' in ...`

**Step 3: Write minimal implementation**

Edit `core/notifications/dispatcher.py`. Add import at top:

```python
from datetime import datetime
from core.timezone import format_datetime_in_timezone, format_date_in_timezone
```

Then modify the `send_notification` function, after line 137 (after `full_context` is created), add:

```python
    # Format meeting times in user's timezone if available
    user_tz = user.get("timezone")
    if user_tz:
        if "meeting_time_utc" in context:
            try:
                utc_dt = datetime.fromisoformat(context["meeting_time_utc"])
                full_context["meeting_time"] = format_datetime_in_timezone(utc_dt, user_tz)
            except (ValueError, TypeError):
                pass  # Keep original meeting_time
        if "meeting_date_utc" in context:
            try:
                utc_dt = datetime.fromisoformat(context["meeting_date_utc"])
                full_context["meeting_date"] = format_date_in_timezone(utc_dt, user_tz)
            except (ValueError, TypeError):
                pass  # Keep original meeting_date
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_dispatcher.py -v`
Expected: PASS

**Step 5: Commit**

```bash
jj new -m "feat(notifications): personalize meeting times per user timezone

When sending notifications, format meeting_time and meeting_date in
the user's local timezone with explicit offset (e.g., 'Wednesday at
10:00 PM (UTC+7)'). Falls back to UTC for users without timezone set.

Fixes bug where email reminders showed wrong day for users in
different timezones."
```

---

## Task 4: Run full test suite and verify

**Files:**
- None (verification only)

**Step 1: Run all notification tests**

Run: `pytest core/notifications/tests/ -v`
Expected: All tests PASS

**Step 2: Run linting**

Run: `ruff check core/notifications/ core/timezone.py core/tests/test_timezone_formatting.py`
Expected: No errors

**Step 3: Run formatting check**

Run: `ruff format --check core/notifications/ core/timezone.py core/tests/test_timezone_formatting.py`
Expected: No changes needed (or run `ruff format` to fix)

**Step 4: Commit any fixes**

If linting/formatting required changes:
```bash
jj new -m "chore: fix linting issues"
```

---

## Task 5: Manual verification (optional)

**Files:**
- None

**Step 1: Start dev server**

Run: `python main.py --dev --no-bot`

**Step 2: Check a user's timezone in database**

Verify a test user has a timezone set, or set one manually.

**Step 3: Trigger a test notification**

Use the admin panel or API to send a test meeting reminder.

**Step 4: Verify email content**

Check that the email shows the time in the user's timezone with explicit offset.

---

## Summary of Changes

| File | Change |
|------|--------|
| `core/timezone.py` | Add `format_datetime_in_timezone()` and `format_date_in_timezone()` |
| `core/tests/test_timezone_formatting.py` | New test file for formatting utilities |
| `core/notifications/actions.py` | Add `meeting_time_utc` and `meeting_date_utc` ISO strings to context |
| `core/notifications/dispatcher.py` | Format times per-user when sending notifications |
| `core/notifications/tests/test_dispatcher.py` | Add tests for timezone formatting |
| `core/notifications/tests/test_actions.py` | Add test for ISO timestamp in context |
