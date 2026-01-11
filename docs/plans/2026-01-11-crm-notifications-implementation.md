# CRM/Notifications System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an internal notification system that sends emails and Discord messages based on course events (signups, group assignments, meeting reminders, lesson nudges).

**Architecture:** New `core/notifications/` module with SendGrid for email, APScheduler for job scheduling, and YAML-based message templates. Integrates with existing FastAPI lifespan and Discord bot.

**Tech Stack:** SendGrid (email), APScheduler + PostgreSQL (scheduling), PyYAML (templates), icalendar (calendar invites)

---

## Prerequisites

Before starting, ensure you have:
- SendGrid account with API key
- Access to the database (for APScheduler job store)

---

## Task 1: Add Dependencies

**Files:**
- Modify: `requirements.txt`

**Step 1: Add new dependencies**

Add to `requirements.txt`:

```
# Notifications
sendgrid>=6.11.0
apscheduler>=3.10.0
PyYAML>=6.0
icalendar>=5.0.0
```

**Step 2: Install dependencies**

Run: `pip install -r requirements.txt`
Expected: All packages install successfully

**Step 3: Commit**

```bash
jj describe -m "chore: add notification system dependencies"
```

---

## Task 2: Create Notification Module Structure

**Files:**
- Create: `core/notifications/__init__.py`
- Create: `core/notifications/channels/__init__.py`

**Step 1: Create directory structure**

```bash
mkdir -p core/notifications/channels
```

**Step 2: Create module init files**

Create `core/notifications/__init__.py`:

```python
"""
Notification system for sending emails and Discord messages.

Public API:
    send_notification(user_id, message_type, context) - Send immediately
    schedule_reminder(job_id, run_at, ...) - Schedule for later
    cancel_reminders(pattern) - Cancel scheduled jobs
"""

from .dispatcher import send_notification
from .scheduler import schedule_reminder, cancel_reminders, init_scheduler, shutdown_scheduler

__all__ = [
    "send_notification",
    "schedule_reminder",
    "cancel_reminders",
    "init_scheduler",
    "shutdown_scheduler",
]
```

Create `core/notifications/channels/__init__.py`:

```python
"""Notification delivery channels (email, Discord, calendar)."""
```

**Step 3: Commit**

```bash
jj describe -m "chore: create notification module structure"
```

---

## Task 3: Message Templates (YAML)

**Files:**
- Create: `core/notifications/messages.yaml`
- Create: `core/notifications/templates.py`
- Create: `core/notifications/tests/__init__.py`
- Create: `core/notifications/tests/test_templates.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/__init__.py`:

```python
"""Tests for notification system."""
```

Create `core/notifications/tests/test_templates.py`:

```python
"""Tests for message template loading and rendering."""

import pytest
from core.notifications.templates import load_templates, render_message


class TestLoadTemplates:
    def test_loads_yaml_file(self):
        templates = load_templates()
        assert isinstance(templates, dict)
        assert "welcome" in templates

    def test_welcome_has_required_fields(self):
        templates = load_templates()
        welcome = templates["welcome"]
        assert "email_subject" in welcome
        assert "email_body" in welcome
        assert "discord" in welcome


class TestRenderMessage:
    def test_renders_simple_variable(self):
        result = render_message("Hello {name}!", {"name": "Alice"})
        assert result == "Hello Alice!"

    def test_renders_multiple_variables(self):
        result = render_message(
            "Hi {name}, your group is {group_name}",
            {"name": "Alice", "group_name": "Curious Capybaras"},
        )
        assert result == "Hi Alice, your group is Curious Capybaras"

    def test_missing_variable_raises(self):
        with pytest.raises(KeyError):
            render_message("Hello {name}!", {})
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_templates.py -v`
Expected: FAIL with "ModuleNotFoundError" or "cannot import name"

**Step 3: Create messages.yaml**

Create `core/notifications/messages.yaml`:

```yaml
# All user-facing messages sent by the notification system.
# Edit this file to change any communication.
#
# Template variables use {variable_name} syntax.
# Common variables: {name}, {email}, {group_name}, {meeting_time},
#   {lesson_url}, {discord_channel_url}, {profile_url}

welcome:
  email_subject: Welcome to the AI Safety Course
  email_body: |
    Hi {name},

    Thanks for signing up! We're excited to have you.

    Next steps:
    - Complete your availability form: {profile_url}
    - We'll match you with a study group

    Questions? Reply to this email.

    Best,
    The AI Safety Course Team
  discord: |
    Welcome {name}! Thanks for signing up.
    Complete your availability form to get matched with a group: {profile_url}

group_assigned:
  email_subject: "You've been assigned to a group: {group_name}"
  email_body: |
    Hi {name},

    Great news! You've been matched with a study group.

    Group: {group_name}
    Meeting time: {meeting_time}
    Your groupmates: {member_names}

    Chat with your group on Discord: {discord_channel_url}

    A calendar invite is attached.

    Best,
    The AI Safety Course Team
  discord: |
    You've been assigned to **{group_name}**!
    Meeting time: {meeting_time}
    Check your email for the calendar invite.
  calendar_title: "AI Safety Study Group: {group_name}"
  calendar_description: |
    Weekly study group meeting.
    Group members: {member_names}

meeting_reminder_24h:
  email_subject: "Reminder: {group_name} meeting tomorrow"
  email_body: |
    Hi {name},

    Your study group meets tomorrow at {meeting_time}.

    Lessons to complete before the meeting:
    {lesson_list}

    Continue here: {lesson_url}

    Questions? Chat with your group: {discord_channel_url}

    Best,
    The AI Safety Course Team
  discord_channel: |
    Reminder: Meeting tomorrow at {meeting_time}!

meeting_reminder_1h:
  email_subject: "Reminder: {group_name} meeting in 1 hour"
  email_body: |
    Hi {name},

    Your study group meets in 1 hour at {meeting_time}.

    Join your group channel: {discord_channel_url}

    See you there!

    Best,
    The AI Safety Course Team
  discord_channel: |
    Meeting starting in 1 hour!

lesson_nudge:
  email_subject: "Don't forget: {lessons_remaining} lessons before your meeting"
  email_body: |
    Hi {name},

    Your next meeting is on {meeting_date}. You have {lessons_remaining}
    lessons left to complete:

    {lesson_list}

    Continue here: {lesson_url}

    Questions for your group? {discord_channel_url}

    Best,
    The AI Safety Course Team
  discord: |
    Heads up! You have {lessons_remaining} lessons to finish before
    your meeting on {meeting_date}. Continue here: {lesson_url}

trial_nudge:
  email_subject: Finish your trial lesson?
  email_body: |
    Hi {name},

    You started the trial lesson but didn't finish.
    Pick up where you left off: {lesson_url}

    Best,
    The AI Safety Course Team
  discord: |
    Hey {name}! You started the trial lesson yesterday.
    Want to finish it? {lesson_url}
```

**Step 4: Write templates.py**

Create `core/notifications/templates.py`:

```python
"""Message template loading and rendering."""

from pathlib import Path

import yaml


_templates: dict | None = None


def load_templates() -> dict:
    """
    Load message templates from YAML file.

    Caches templates after first load.
    """
    global _templates
    if _templates is not None:
        return _templates

    yaml_path = Path(__file__).parent / "messages.yaml"
    with open(yaml_path) as f:
        _templates = yaml.safe_load(f)

    return _templates


def render_message(template: str, context: dict) -> str:
    """
    Render a message template with context variables.

    Args:
        template: String with {variable} placeholders
        context: Dict of variable names to values

    Returns:
        Rendered string

    Raises:
        KeyError: If a required variable is missing from context
    """
    return template.format(**context)


def get_message(message_type: str, channel: str, context: dict) -> str:
    """
    Get and render a message for a specific type and channel.

    Args:
        message_type: e.g., "welcome", "group_assigned"
        channel: e.g., "email_subject", "email_body", "discord"
        context: Variables to substitute

    Returns:
        Rendered message string
    """
    templates = load_templates()
    template = templates[message_type][channel]
    return render_message(template, context)
```

**Step 5: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_templates.py -v`
Expected: PASS (3 tests)

**Step 6: Commit**

```bash
jj describe -m "feat: add message templates with YAML loading"
```

---

## Task 4: Email Channel (SendGrid)

**Files:**
- Create: `core/notifications/channels/email.py`
- Create: `core/notifications/tests/test_email.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_email.py`:

```python
"""Tests for email channel."""

import pytest
from unittest.mock import patch, MagicMock

from core.notifications.channels.email import send_email, EmailMessage


class TestEmailMessage:
    def test_creates_message(self):
        msg = EmailMessage(
            to_email="alice@example.com",
            subject="Test Subject",
            body="Test body",
        )
        assert msg.to_email == "alice@example.com"
        assert msg.subject == "Test Subject"
        assert msg.body == "Test body"


class TestSendEmail:
    @patch("core.notifications.channels.email._get_sendgrid_client")
    def test_sends_email_via_sendgrid(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_client.send.return_value = mock_response

        result = send_email(
            to_email="alice@example.com",
            subject="Test Subject",
            body="Test body",
        )

        assert result is True
        mock_client.send.assert_called_once()

    @patch("core.notifications.channels.email._get_sendgrid_client")
    def test_returns_false_on_failure(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.send.side_effect = Exception("API error")

        result = send_email(
            to_email="alice@example.com",
            subject="Test",
            body="Test",
        )

        assert result is False

    def test_returns_false_when_not_configured(self):
        with patch.dict("os.environ", {}, clear=True):
            with patch("core.notifications.channels.email.SENDGRID_API_KEY", None):
                result = send_email(
                    to_email="alice@example.com",
                    subject="Test",
                    body="Test",
                )
                assert result is False
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_email.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write email channel implementation**

Create `core/notifications/channels/email.py`:

```python
"""SendGrid email delivery channel."""

import os
from dataclasses import dataclass

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail


SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "noreply@aisafetycourse.com")

_client: SendGridAPIClient | None = None


@dataclass
class EmailMessage:
    """Email message data."""

    to_email: str
    subject: str
    body: str
    calendar_ics: str | None = None


def _get_sendgrid_client() -> SendGridAPIClient | None:
    """Get or create SendGrid client singleton."""
    global _client
    if _client is None and SENDGRID_API_KEY:
        _client = SendGridAPIClient(SENDGRID_API_KEY)
    return _client


def send_email(
    to_email: str,
    subject: str,
    body: str,
    calendar_ics: str | None = None,
) -> bool:
    """
    Send an email via SendGrid.

    Args:
        to_email: Recipient email address
        subject: Email subject line
        body: Plain text email body
        calendar_ics: Optional iCal data for calendar invite

    Returns:
        True if sent successfully, False otherwise
    """
    client = _get_sendgrid_client()
    if not client:
        print("Warning: SendGrid not configured (SENDGRID_API_KEY not set)")
        return False

    try:
        message = Mail(
            from_email=FROM_EMAIL,
            to_emails=to_email,
            subject=subject,
            plain_text_content=body,
        )

        # Add calendar invite if provided
        if calendar_ics:
            from sendgrid.helpers.mail import (
                Attachment,
                ContentId,
                Disposition,
                FileContent,
                FileName,
                FileType,
            )
            import base64

            encoded = base64.b64encode(calendar_ics.encode()).decode()
            attachment = Attachment(
                FileContent(encoded),
                FileName("invite.ics"),
                FileType("text/calendar; method=REQUEST"),
                Disposition("attachment"),
                ContentId("calendar-invite"),
            )
            message.add_attachment(attachment)

        response = client.send(message)
        return response.status_code in (200, 201, 202)

    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")
        return False
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_email.py -v`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
jj describe -m "feat: add SendGrid email channel"
```

---

## Task 5: Calendar Invite Generation

**Files:**
- Create: `core/notifications/channels/calendar.py`
- Create: `core/notifications/tests/test_calendar.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_calendar.py`:

```python
"""Tests for calendar invite generation."""

import pytest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from core.notifications.channels.calendar import create_calendar_invite


class TestCreateCalendarInvite:
    def test_creates_valid_ics(self):
        start = datetime(2026, 1, 15, 14, 0, tzinfo=ZoneInfo("UTC"))
        end = start + timedelta(hours=1)

        ics = create_calendar_invite(
            title="AI Safety Study Group",
            description="Weekly meeting",
            start=start,
            end=end,
            attendee_emails=["alice@example.com"],
            organizer_email="course@example.com",
        )

        assert "BEGIN:VCALENDAR" in ics
        assert "BEGIN:VEVENT" in ics
        assert "AI Safety Study Group" in ics
        assert "METHOD:REQUEST" in ics
        assert "ATTENDEE" in ics
        assert "alice@example.com" in ics

    def test_includes_recurrence_rule(self):
        start = datetime(2026, 1, 15, 14, 0, tzinfo=ZoneInfo("UTC"))
        end = start + timedelta(hours=1)

        ics = create_calendar_invite(
            title="Study Group",
            description="Weekly",
            start=start,
            end=end,
            attendee_emails=["alice@example.com"],
            organizer_email="course@example.com",
            recurrence_weeks=8,
        )

        assert "RRULE:FREQ=WEEKLY;COUNT=8" in ics
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_calendar.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write calendar channel implementation**

Create `core/notifications/channels/calendar.py`:

```python
"""Calendar invite generation using iCalendar format."""

from datetime import datetime
from uuid import uuid4

from icalendar import Calendar, Event, vCalAddress, vText


def create_calendar_invite(
    title: str,
    description: str,
    start: datetime,
    end: datetime,
    attendee_emails: list[str],
    organizer_email: str,
    location: str | None = None,
    recurrence_weeks: int | None = None,
) -> str:
    """
    Create an iCalendar invite string (iTIP format).

    Args:
        title: Event title
        description: Event description
        start: Start datetime (must be timezone-aware)
        end: End datetime (must be timezone-aware)
        attendee_emails: List of attendee email addresses
        organizer_email: Organizer's email address
        location: Optional location string
        recurrence_weeks: If set, creates weekly recurring event for N weeks

    Returns:
        iCalendar string with METHOD:REQUEST for invite
    """
    cal = Calendar()
    cal.add("prodid", "-//AI Safety Course//aisafetycourse.com//")
    cal.add("version", "2.0")
    cal.add("method", "REQUEST")  # This makes it an invite, not just an event

    event = Event()
    event.add("uid", f"{uuid4()}@aisafetycourse.com")
    event.add("dtstamp", datetime.utcnow())
    event.add("dtstart", start)
    event.add("dtend", end)
    event.add("summary", title)
    event.add("description", description)

    if location:
        event.add("location", location)

    # Add recurrence rule if specified
    if recurrence_weeks:
        event.add("rrule", {"freq": "weekly", "count": recurrence_weeks})

    # Add organizer
    organizer = vCalAddress(f"mailto:{organizer_email}")
    organizer.params["cn"] = vText("AI Safety Course")
    organizer.params["role"] = vText("CHAIR")
    event.add("organizer", organizer)

    # Add attendees
    for email in attendee_emails:
        attendee = vCalAddress(f"mailto:{email}")
        attendee.params["cn"] = vText(email.split("@")[0])
        attendee.params["role"] = vText("REQ-PARTICIPANT")
        attendee.params["rsvp"] = vText("TRUE")
        event.add("attendee", attendee, encode=0)

    cal.add_component(event)
    return cal.to_ical().decode("utf-8")
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_calendar.py -v`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
jj describe -m "feat: add calendar invite generation"
```

---

## Task 6: Discord Channel (DMs and Channel Messages)

**Files:**
- Create: `core/notifications/channels/discord.py`
- Create: `core/notifications/tests/test_discord_channel.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_discord_channel.py`:

```python
"""Tests for Discord notification channel."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestSendDiscordDM:
    @pytest.mark.asyncio
    async def test_sends_dm_to_user(self):
        from core.notifications.channels.discord import send_discord_dm

        mock_bot = MagicMock()
        mock_user = AsyncMock()
        mock_bot.fetch_user = AsyncMock(return_value=mock_user)

        with patch("core.notifications.channels.discord._bot", mock_bot):
            result = await send_discord_dm(
                discord_id="123456789",
                message="Hello!",
            )

        assert result is True
        mock_bot.fetch_user.assert_called_once_with(123456789)
        mock_user.send.assert_called_once_with("Hello!")

    @pytest.mark.asyncio
    async def test_returns_false_when_bot_not_set(self):
        from core.notifications.channels.discord import send_discord_dm

        with patch("core.notifications.channels.discord._bot", None):
            result = await send_discord_dm(
                discord_id="123456789",
                message="Hello!",
            )

        assert result is False


class TestSendDiscordChannelMessage:
    @pytest.mark.asyncio
    async def test_sends_message_to_channel(self):
        from core.notifications.channels.discord import send_discord_channel_message

        mock_bot = MagicMock()
        mock_channel = AsyncMock()
        mock_bot.fetch_channel = AsyncMock(return_value=mock_channel)

        with patch("core.notifications.channels.discord._bot", mock_bot):
            result = await send_discord_channel_message(
                channel_id="987654321",
                message="Meeting reminder!",
            )

        assert result is True
        mock_bot.fetch_channel.assert_called_once_with(987654321)
        mock_channel.send.assert_called_once_with("Meeting reminder!")
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_discord_channel.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write Discord channel implementation**

Create `core/notifications/channels/discord.py`:

```python
"""Discord notification delivery channel (DMs and channel messages)."""

import asyncio
from discord import Client


# Set by main.py when bot starts
_bot: Client | None = None

# Rate limiting: 1 DM per second to avoid Discord throttling
_dm_semaphore: asyncio.Semaphore | None = None


def set_bot(bot: Client) -> None:
    """Set the Discord bot instance for sending messages."""
    global _bot, _dm_semaphore
    _bot = bot
    _dm_semaphore = asyncio.Semaphore(1)


async def send_discord_dm(discord_id: str, message: str) -> bool:
    """
    Send a direct message to a Discord user.

    Rate-limited to ~1 DM/second to avoid Discord throttling.

    Args:
        discord_id: Discord user ID (as string)
        message: Message content

    Returns:
        True if sent successfully, False otherwise
    """
    if not _bot:
        print("Warning: Discord bot not configured for notifications")
        return False

    try:
        # Rate limit DMs
        if _dm_semaphore:
            async with _dm_semaphore:
                user = await _bot.fetch_user(int(discord_id))
                await user.send(message)
                await asyncio.sleep(1)  # 1 second delay between DMs
        else:
            user = await _bot.fetch_user(int(discord_id))
            await user.send(message)

        return True

    except Exception as e:
        print(f"Failed to send DM to {discord_id}: {e}")
        return False


async def send_discord_channel_message(channel_id: str, message: str) -> bool:
    """
    Send a message to a Discord channel.

    No rate limiting needed for channel messages.

    Args:
        channel_id: Discord channel ID (as string)
        message: Message content

    Returns:
        True if sent successfully, False otherwise
    """
    if not _bot:
        print("Warning: Discord bot not configured for notifications")
        return False

    try:
        channel = await _bot.fetch_channel(int(channel_id))
        await channel.send(message)
        return True

    except Exception as e:
        print(f"Failed to send message to channel {channel_id}: {e}")
        return False
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_discord_channel.py -v`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
jj describe -m "feat: add Discord notification channel"
```

---

## Task 7: Notification Dispatcher

**Files:**
- Create: `core/notifications/dispatcher.py`
- Create: `core/notifications/tests/test_dispatcher.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_dispatcher.py`:

```python
"""Tests for notification dispatcher."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


class TestSendNotification:
    @pytest.mark.asyncio
    async def test_sends_email_when_enabled(self):
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "email_notifications_enabled": True,
            "dm_notifications_enabled": False,
        }

        with patch("core.notifications.dispatcher.get_user_by_id", AsyncMock(return_value=mock_user)):
            with patch("core.notifications.dispatcher.send_email", return_value=True) as mock_email:
                with patch("core.notifications.dispatcher.send_discord_dm", AsyncMock(return_value=True)):
                    result = await send_notification(
                        user_id=1,
                        message_type="welcome",
                        context={"profile_url": "https://example.com/profile"},
                    )

        assert result["email"] is True
        assert result["discord"] is False
        mock_email.assert_called_once()

    @pytest.mark.asyncio
    async def test_sends_discord_when_enabled(self):
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "email_notifications_enabled": False,
            "dm_notifications_enabled": True,
        }

        with patch("core.notifications.dispatcher.get_user_by_id", AsyncMock(return_value=mock_user)):
            with patch("core.notifications.dispatcher.send_email", return_value=True):
                with patch("core.notifications.dispatcher.send_discord_dm", AsyncMock(return_value=True)) as mock_dm:
                    result = await send_notification(
                        user_id=1,
                        message_type="welcome",
                        context={"profile_url": "https://example.com/profile"},
                    )

        assert result["email"] is False
        assert result["discord"] is True
        mock_dm.assert_called_once()

    @pytest.mark.asyncio
    async def test_sends_both_when_both_enabled(self):
        from core.notifications.dispatcher import send_notification

        mock_user = {
            "user_id": 1,
            "email": "alice@example.com",
            "discord_id": "123456",
            "nickname": "Alice",
            "email_notifications_enabled": True,
            "dm_notifications_enabled": True,
        }

        with patch("core.notifications.dispatcher.get_user_by_id", AsyncMock(return_value=mock_user)):
            with patch("core.notifications.dispatcher.send_email", return_value=True) as mock_email:
                with patch("core.notifications.dispatcher.send_discord_dm", AsyncMock(return_value=True)) as mock_dm:
                    result = await send_notification(
                        user_id=1,
                        message_type="welcome",
                        context={"profile_url": "https://example.com/profile"},
                    )

        assert result["email"] is True
        assert result["discord"] is True
        mock_email.assert_called_once()
        mock_dm.assert_called_once()
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_dispatcher.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write dispatcher implementation**

Create `core/notifications/dispatcher.py`:

```python
"""
Notification dispatcher - routes messages to channels based on user preferences.
"""

from core.notifications.templates import get_message, load_templates
from core.notifications.channels.email import send_email
from core.notifications.channels.discord import send_discord_dm, send_discord_channel_message


async def get_user_by_id(user_id: int) -> dict | None:
    """Fetch user data from database."""
    from sqlalchemy import select
    from core.database import get_connection
    from core.tables import users

    async with get_connection() as conn:
        result = await conn.execute(
            select(users).where(users.c.user_id == user_id)
        )
        row = result.mappings().first()
        return dict(row) if row else None


async def send_notification(
    user_id: int,
    message_type: str,
    context: dict,
    channel_id: str | None = None,
    calendar_ics: str | None = None,
) -> dict:
    """
    Send a notification to a user via their preferred channels.

    Args:
        user_id: Database user ID
        message_type: Message type key from messages.yaml (e.g., "welcome")
        context: Template variables
        channel_id: Optional Discord channel ID (for channel messages instead of DMs)
        calendar_ics: Optional calendar invite to attach to email

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
                calendar_ics=calendar_ics,
            )

    # Send Discord message if enabled
    if user.get("dm_notifications_enabled", True) and user.get("discord_id"):
        # Use channel message if channel_id provided, otherwise DM
        if channel_id and "discord_channel" in message_templates:
            message = get_message(message_type, "discord_channel", full_context)
            result["discord"] = await send_discord_channel_message(channel_id, message)
        elif "discord" in message_templates:
            message = get_message(message_type, "discord", full_context)
            result["discord"] = await send_discord_dm(user["discord_id"], message)

    return result


async def send_channel_notification(
    channel_id: str,
    message_type: str,
    context: dict,
) -> bool:
    """
    Send a notification to a Discord channel (not tied to a specific user).

    Args:
        channel_id: Discord channel ID
        message_type: Message type key from messages.yaml
        context: Template variables

    Returns:
        True if sent successfully
    """
    templates = load_templates()
    message_templates = templates.get(message_type, {})

    if "discord_channel" not in message_templates:
        print(f"Warning: No discord_channel template for {message_type}")
        return False

    message = get_message(message_type, "discord_channel", context)
    return await send_discord_channel_message(channel_id, message)
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_dispatcher.py -v`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
jj describe -m "feat: add notification dispatcher"
```

---

## Task 8: APScheduler Setup

**Files:**
- Create: `core/notifications/scheduler.py`
- Create: `core/notifications/tests/test_scheduler.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_scheduler.py`:

```python
"""Tests for notification scheduler."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock


class TestScheduleReminder:
    def test_schedules_job(self):
        from core.notifications.scheduler import schedule_reminder, _scheduler

        mock_scheduler = MagicMock()

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            schedule_reminder(
                job_id="meeting_123_reminder_24h",
                run_at=datetime.utcnow() + timedelta(hours=24),
                message_type="meeting_reminder_24h",
                user_ids=[1, 2, 3],
                context={"meeting_time": "3pm UTC"},
            )

        mock_scheduler.add_job.assert_called_once()
        call_kwargs = mock_scheduler.add_job.call_args[1]
        assert call_kwargs["id"] == "meeting_123_reminder_24h"


class TestCancelReminders:
    def test_cancels_matching_jobs(self):
        from core.notifications.scheduler import cancel_reminders

        mock_scheduler = MagicMock()
        mock_job1 = MagicMock()
        mock_job1.id = "meeting_123_reminder_24h"
        mock_job2 = MagicMock()
        mock_job2.id = "meeting_123_reminder_1h"
        mock_job3 = MagicMock()
        mock_job3.id = "meeting_456_reminder_24h"
        mock_scheduler.get_jobs.return_value = [mock_job1, mock_job2, mock_job3]

        with patch("core.notifications.scheduler._scheduler", mock_scheduler):
            count = cancel_reminders("meeting_123_*")

        assert count == 2
        mock_job1.remove.assert_called_once()
        mock_job2.remove.assert_called_once()
        mock_job3.remove.assert_not_called()
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_scheduler.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write scheduler implementation**

Create `core/notifications/scheduler.py`:

```python
"""
APScheduler-based job scheduler for notifications.

Jobs are persisted to PostgreSQL so they survive restarts.
"""

import asyncio
import fnmatch
import os
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore


_scheduler: AsyncIOScheduler | None = None


def _get_database_url() -> str:
    """Get sync database URL for APScheduler (it uses sync SQLAlchemy)."""
    database_url = os.environ.get("DATABASE_URL", "")
    # APScheduler needs sync URL (not asyncpg)
    if "postgresql+asyncpg://" in database_url:
        return database_url.replace("postgresql+asyncpg://", "postgresql://")
    return database_url


def init_scheduler() -> AsyncIOScheduler:
    """
    Initialize and start the APScheduler.

    Call this during app startup (in FastAPI lifespan).
    """
    global _scheduler

    if _scheduler is not None:
        return _scheduler

    database_url = _get_database_url()

    jobstores = {}
    if database_url:
        jobstores["default"] = SQLAlchemyJobStore(
            url=database_url,
            tablename="apscheduler_jobs",
        )

    _scheduler = AsyncIOScheduler(
        jobstores=jobstores,
        job_defaults={
            "coalesce": True,  # Combine missed runs into one
            "max_instances": 1,
            "misfire_grace_time": 3600,  # Allow 1 hour late execution
        },
    )
    _scheduler.start()
    print("Notification scheduler started")

    return _scheduler


def shutdown_scheduler() -> None:
    """
    Shutdown the scheduler gracefully.

    Call this during app shutdown.
    """
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=True)
        _scheduler = None
        print("Notification scheduler stopped")


def schedule_reminder(
    job_id: str,
    run_at: datetime,
    message_type: str,
    user_ids: list[int],
    context: dict,
    channel_id: str | None = None,
    condition: dict | None = None,
) -> None:
    """
    Schedule a reminder notification for later.

    Args:
        job_id: Unique job identifier (e.g., "meeting_123_reminder_24h")
        run_at: When to send the notification
        message_type: Message type from messages.yaml
        user_ids: List of user IDs to notify
        context: Template variables
        channel_id: Optional Discord channel for channel messages
        condition: Optional condition to check before sending (e.g., lesson progress)
    """
    if not _scheduler:
        print("Warning: Scheduler not initialized, cannot schedule reminder")
        return

    _scheduler.add_job(
        _execute_reminder,
        trigger="date",
        run_date=run_at,
        id=job_id,
        replace_existing=True,
        kwargs={
            "message_type": message_type,
            "user_ids": user_ids,
            "context": context,
            "channel_id": channel_id,
            "condition": condition,
        },
    )


def cancel_reminders(pattern: str) -> int:
    """
    Cancel scheduled reminders matching a pattern.

    Args:
        pattern: Glob pattern to match job IDs (e.g., "meeting_123_*")

    Returns:
        Number of jobs cancelled
    """
    if not _scheduler:
        return 0

    cancelled = 0
    for job in _scheduler.get_jobs():
        if fnmatch.fnmatch(job.id, pattern):
            job.remove()
            cancelled += 1

    return cancelled


async def _execute_reminder(
    message_type: str,
    user_ids: list[int],
    context: dict,
    channel_id: str | None = None,
    condition: dict | None = None,
) -> None:
    """
    Execute a scheduled reminder.

    This is the job function called by APScheduler.
    """
    from core.notifications.dispatcher import send_notification, send_channel_notification

    # Check condition if specified (e.g., lesson progress)
    if condition:
        should_send = await _check_condition(condition, user_ids)
        if not should_send:
            print(f"Skipping reminder {message_type}: condition not met")
            return

    # Send to channel if channel_id provided (for meeting reminders)
    if channel_id:
        await send_channel_notification(channel_id, message_type, context)

    # Send individual notifications to each user
    for user_id in user_ids:
        await send_notification(
            user_id=user_id,
            message_type=message_type,
            context=context,
            channel_id=None,  # Don't send to channel again per-user
        )


async def _check_condition(condition: dict, user_ids: list[int]) -> bool:
    """
    Check if a reminder condition is met.

    Used for conditional reminders like lesson progress nudges.

    Args:
        condition: Dict with condition type and parameters
        user_ids: Users to check

    Returns:
        True if condition is met and reminder should send
    """
    condition_type = condition.get("type")

    if condition_type == "lesson_progress":
        # Check if user hasn't completed required lessons
        meeting_id = condition.get("meeting_id")
        threshold = condition.get("threshold", 1.0)  # 1.0 = 100%
        # TODO: Implement lesson progress check
        # For now, always return True
        return True

    return True
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_scheduler.py -v`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
jj describe -m "feat: add APScheduler-based notification scheduler"
```

---

## Task 9: Integrate Scheduler with Main App

**Files:**
- Modify: `main.py`

**Step 1: Read current main.py**

Already read above. Need to add scheduler init/shutdown to lifespan.

**Step 2: Update main.py imports and lifespan**

Add import near top of `main.py` (after other core imports around line 57-58):

```python
from core.notifications import init_scheduler, shutdown_scheduler
from core.notifications.channels.discord import set_bot as set_notification_bot
```

Update the `lifespan` function to initialize scheduler and set bot reference.

In the `lifespan` function, after `print("Starting Discord bot...")` (around line 191), add:

```python
    # Initialize notification scheduler
    print("Starting notification scheduler...")
    init_scheduler()
```

After `_bot_task = asyncio.create_task(start_bot())` (around line 192), add a callback to set bot reference when ready:

```python
    # Set bot reference for notifications once bot is ready
    async def on_bot_ready():
        await asyncio.sleep(2)  # Wait for bot to be ready
        if bot.is_ready():
            set_notification_bot(bot)
            print("Notification system connected to Discord bot")
    asyncio.create_task(on_bot_ready())
```

In the shutdown section (after `await stop_vite_dev()`), add:

```python
    shutdown_scheduler()
```

**Step 3: Test manually**

Run: `python main.py --no-bot --dev`
Expected: See "Notification scheduler started" in output

**Step 4: Commit**

```bash
jj describe -m "feat: integrate notification scheduler with main app"
```

---

## Task 10: URL Builder Utility

**Files:**
- Create: `core/notifications/urls.py`
- Create: `core/notifications/tests/test_urls.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_urls.py`:

```python
"""Tests for URL builder utilities."""

import pytest
from unittest.mock import patch


class TestBuildUrls:
    def test_builds_lesson_url(self):
        from core.notifications.urls import build_lesson_url

        with patch("core.notifications.urls.get_frontend_url", return_value="https://aisafety.com"):
            url = build_lesson_url("lesson-123")

        assert url == "https://aisafety.com/lesson/lesson-123"

    def test_builds_profile_url(self):
        from core.notifications.urls import build_profile_url

        with patch("core.notifications.urls.get_frontend_url", return_value="https://aisafety.com"):
            url = build_profile_url()

        assert url == "https://aisafety.com/signup"

    def test_builds_discord_channel_url(self):
        from core.notifications.urls import build_discord_channel_url

        url = build_discord_channel_url(
            server_id="111111",
            channel_id="222222",
        )

        assert url == "https://discord.com/channels/111111/222222"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_urls.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write URL builder implementation**

Create `core/notifications/urls.py`:

```python
"""URL builder utilities for notification templates."""

import os

from core.config import get_frontend_url


DISCORD_SERVER_ID = os.environ.get("DISCORD_SERVER_ID", "")


def build_lesson_url(lesson_id: str) -> str:
    """Build URL to a lesson page."""
    base = get_frontend_url()
    return f"{base}/lesson/{lesson_id}"


def build_profile_url() -> str:
    """Build URL to user profile/signup page."""
    base = get_frontend_url()
    return f"{base}/signup"


def build_discord_channel_url(server_id: str | None = None, channel_id: str = "") -> str:
    """
    Build URL to a Discord channel.

    Args:
        server_id: Discord server ID (uses env var if not provided)
        channel_id: Discord channel ID
    """
    sid = server_id or DISCORD_SERVER_ID
    return f"https://discord.com/channels/{sid}/{channel_id}"
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_urls.py -v`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
jj describe -m "feat: add URL builder utilities for notifications"
```

---

## Task 11: High-Level Notification Functions

**Files:**
- Create: `core/notifications/actions.py`
- Create: `core/notifications/tests/test_actions.py`

**Step 1: Write the failing test**

Create `core/notifications/tests/test_actions.py`:

```python
"""Tests for high-level notification actions."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock
from zoneinfo import ZoneInfo


class TestNotifyGroupAssigned:
    @pytest.mark.asyncio
    async def test_sends_notification_with_calendar(self):
        from core.notifications.actions import notify_group_assigned

        mock_send = AsyncMock(return_value={"email": True, "discord": True})
        mock_schedule = MagicMock()

        with patch("core.notifications.actions.send_notification", mock_send):
            with patch("core.notifications.actions.schedule_reminder", mock_schedule):
                with patch("core.notifications.actions.create_calendar_invite", return_value="ICS_DATA"):
                    await notify_group_assigned(
                        user_id=1,
                        group_name="Curious Capybaras",
                        meeting_time_utc="Wednesday 15:00",
                        member_names=["Alice", "Bob"],
                        discord_channel_id="123456",
                        meeting_id=42,
                    )

        mock_send.assert_called_once()
        call_kwargs = mock_send.call_args[1]
        assert call_kwargs["message_type"] == "group_assigned"
        assert "calendar_ics" in call_kwargs


class TestScheduleMeetingReminders:
    def test_schedules_24h_and_1h_reminders(self):
        from core.notifications.actions import schedule_meeting_reminders

        mock_schedule = MagicMock()
        meeting_time = datetime.now(ZoneInfo("UTC")) + timedelta(days=2)

        with patch("core.notifications.actions.schedule_reminder", mock_schedule):
            schedule_meeting_reminders(
                meeting_id=42,
                meeting_time=meeting_time,
                user_ids=[1, 2, 3],
                group_name="Test Group",
                discord_channel_id="123456",
            )

        # Should schedule 4 jobs: 24h, 1h, 3d lesson nudge, 1d lesson nudge
        assert mock_schedule.call_count == 4
```

**Step 2: Run test to verify it fails**

Run: `pytest core/notifications/tests/test_actions.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write actions implementation**

Create `core/notifications/actions.py`:

```python
"""
High-level notification actions.

These functions are called by business logic (cogs, routes) to send notifications.
They handle building context, generating calendar invites, and scheduling reminders.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from core.notifications.dispatcher import send_notification
from core.notifications.scheduler import schedule_reminder, cancel_reminders
from core.notifications.channels.calendar import create_calendar_invite
from core.notifications.urls import build_profile_url, build_discord_channel_url, build_lesson_url


async def notify_welcome(user_id: int) -> dict:
    """
    Send welcome notification when user signs up.

    Args:
        user_id: Database user ID

    Returns:
        Delivery status dict
    """
    return await send_notification(
        user_id=user_id,
        message_type="welcome",
        context={
            "profile_url": build_profile_url(),
        },
    )


async def notify_group_assigned(
    user_id: int,
    group_name: str,
    meeting_time_utc: str,
    member_names: list[str],
    discord_channel_id: str,
    meeting_id: int,
    meeting_datetime: datetime | None = None,
    recurrence_weeks: int = 8,
) -> dict:
    """
    Send notification when user is assigned to a group.

    Also schedules meeting reminders.

    Args:
        user_id: Database user ID
        group_name: Name of the assigned group
        meeting_time_utc: Human-readable meeting time (e.g., "Wednesday 15:00 UTC")
        member_names: List of group member names
        discord_channel_id: Discord channel ID for the group
        meeting_id: Database meeting ID (for scheduling reminders)
        meeting_datetime: First meeting datetime (for calendar invite)
        recurrence_weeks: Number of weeks for recurring meetings
    """
    from core.notifications.dispatcher import get_user_by_id

    user = await get_user_by_id(user_id)
    if not user:
        return {"email": False, "discord": False}

    # Generate calendar invite if we have meeting datetime
    calendar_ics = None
    if meeting_datetime and user.get("email"):
        calendar_ics = create_calendar_invite(
            title=f"AI Safety Study Group: {group_name}",
            description=f"Weekly study group meeting.\nGroup members: {', '.join(member_names)}",
            start=meeting_datetime,
            end=meeting_datetime + timedelta(hours=1),
            attendee_emails=[user["email"]],
            organizer_email="noreply@aisafetycourse.com",
            recurrence_weeks=recurrence_weeks,
        )

    return await send_notification(
        user_id=user_id,
        message_type="group_assigned",
        context={
            "group_name": group_name,
            "meeting_time": meeting_time_utc,
            "member_names": ", ".join(member_names),
            "discord_channel_url": build_discord_channel_url(channel_id=discord_channel_id),
        },
        calendar_ics=calendar_ics,
    )


def schedule_meeting_reminders(
    meeting_id: int,
    meeting_time: datetime,
    user_ids: list[int],
    group_name: str,
    discord_channel_id: str,
    lesson_url: str | None = None,
) -> None:
    """
    Schedule all reminders for a meeting.

    Schedules:
    - 24h before: meeting reminder
    - 1h before: meeting reminder
    - 3d before: lesson nudge (if <50% done)
    - 1d before: lesson nudge (if <100% done)
    """
    context = {
        "group_name": group_name,
        "meeting_time": meeting_time.strftime("%A at %H:%M UTC"),
        "meeting_date": meeting_time.strftime("%A, %B %d"),
        "lesson_url": lesson_url or build_lesson_url("next"),
        "discord_channel_url": build_discord_channel_url(channel_id=discord_channel_id),
        "lesson_list": "- Check your course dashboard for assigned lessons",
        "lessons_remaining": "some",
    }

    # 24h reminder
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_reminder_24h",
        run_at=meeting_time - timedelta(hours=24),
        message_type="meeting_reminder_24h",
        user_ids=user_ids,
        context=context,
        channel_id=discord_channel_id,
    )

    # 1h reminder
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_reminder_1h",
        run_at=meeting_time - timedelta(hours=1),
        message_type="meeting_reminder_1h",
        user_ids=user_ids,
        context=context,
        channel_id=discord_channel_id,
    )

    # 3d lesson nudge (conditional: <50% complete)
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_lesson_nudge_3d",
        run_at=meeting_time - timedelta(days=3),
        message_type="lesson_nudge",
        user_ids=user_ids,
        context=context,
        condition={"type": "lesson_progress", "meeting_id": meeting_id, "threshold": 0.5},
    )

    # 1d lesson nudge (conditional: <100% complete)
    schedule_reminder(
        job_id=f"meeting_{meeting_id}_lesson_nudge_1d",
        run_at=meeting_time - timedelta(days=1),
        message_type="lesson_nudge",
        user_ids=user_ids,
        context=context,
        condition={"type": "lesson_progress", "meeting_id": meeting_id, "threshold": 1.0},
    )


def cancel_meeting_reminders(meeting_id: int) -> int:
    """
    Cancel all reminders for a meeting.

    Call this when a meeting is deleted or rescheduled.

    Returns:
        Number of jobs cancelled
    """
    return cancel_reminders(f"meeting_{meeting_id}_*")


def reschedule_meeting_reminders(
    meeting_id: int,
    new_meeting_time: datetime,
    user_ids: list[int],
    group_name: str,
    discord_channel_id: str,
) -> None:
    """
    Reschedule all reminders for a meeting.

    Cancels existing reminders and schedules new ones.
    """
    cancel_meeting_reminders(meeting_id)
    schedule_meeting_reminders(
        meeting_id=meeting_id,
        meeting_time=new_meeting_time,
        user_ids=user_ids,
        group_name=group_name,
        discord_channel_id=discord_channel_id,
    )


def schedule_trial_nudge(session_id: int, user_id: int, lesson_url: str) -> None:
    """
    Schedule a nudge for incomplete trial lesson.

    Sends 24h after user started trial lesson.
    """
    schedule_reminder(
        job_id=f"trial_{session_id}_nudge",
        run_at=datetime.utcnow() + timedelta(hours=24),
        message_type="trial_nudge",
        user_ids=[user_id],
        context={"lesson_url": lesson_url},
    )


def cancel_trial_nudge(session_id: int) -> int:
    """Cancel trial nudge (e.g., when user completes lesson or signs up)."""
    return cancel_reminders(f"trial_{session_id}_nudge")
```

**Step 4: Run test to verify it passes**

Run: `pytest core/notifications/tests/test_actions.py -v`
Expected: PASS (2 tests)

**Step 5: Update module exports**

Update `core/notifications/__init__.py` to export action functions:

```python
"""
Notification system for sending emails and Discord messages.

Public API:
    send_notification(user_id, message_type, context) - Send immediately
    schedule_reminder(job_id, run_at, ...) - Schedule for later
    cancel_reminders(pattern) - Cancel scheduled jobs

High-level actions:
    notify_welcome(user_id) - Send welcome notification
    notify_group_assigned(...) - Send group assignment + calendar invite
    schedule_meeting_reminders(...) - Schedule meeting reminders
    cancel_meeting_reminders(meeting_id) - Cancel meeting reminders
    reschedule_meeting_reminders(...) - Reschedule meeting reminders
    schedule_trial_nudge(...) - Schedule trial lesson nudge
"""

from .dispatcher import send_notification
from .scheduler import schedule_reminder, cancel_reminders, init_scheduler, shutdown_scheduler
from .actions import (
    notify_welcome,
    notify_group_assigned,
    schedule_meeting_reminders,
    cancel_meeting_reminders,
    reschedule_meeting_reminders,
    schedule_trial_nudge,
    cancel_trial_nudge,
)

__all__ = [
    # Low-level
    "send_notification",
    "schedule_reminder",
    "cancel_reminders",
    "init_scheduler",
    "shutdown_scheduler",
    # High-level actions
    "notify_welcome",
    "notify_group_assigned",
    "schedule_meeting_reminders",
    "cancel_meeting_reminders",
    "reschedule_meeting_reminders",
    "schedule_trial_nudge",
    "cancel_trial_nudge",
]
```

**Step 6: Commit**

```bash
jj describe -m "feat: add high-level notification action functions"
```

---

## Task 12: Run All Tests

**Step 1: Run full test suite**

Run: `pytest core/notifications/tests/ -v`
Expected: All tests pass

**Step 2: Run existing project tests to check for regressions**

Run: `pytest discord_bot/tests/ -v`
Expected: All tests pass (no regressions)

**Step 3: Commit if needed**

If any fixes were required, commit them.

---

## Task 13: Update Core Exports (Optional)

**Files:**
- Modify: `core/__init__.py`

**Step 1: Add notification exports to core module**

Add to `core/__init__.py` imports:

```python
# Notifications
from .notifications import (
    notify_welcome,
    notify_group_assigned,
    schedule_meeting_reminders,
    cancel_meeting_reminders,
)
```

Add to `__all__`:

```python
    # Notifications
    'notify_welcome', 'notify_group_assigned',
    'schedule_meeting_reminders', 'cancel_meeting_reminders',
```

**Step 2: Commit**

```bash
jj describe -m "feat: export notification functions from core module"
```

---

## Summary

After completing all tasks, you will have:

1. **SendGrid email integration** with calendar invite support
2. **APScheduler** for persistent job scheduling
3. **YAML-based message templates** in a single file
4. **Discord notification channel** with rate limiting
5. **High-level action functions** for common notification scenarios
6. **Full test coverage** for all components

**Next steps (not in this plan):**
- Hook `notify_group_assigned` into the group realization flow
- Hook `schedule_meeting_reminders` into meeting creation
- Hook `schedule_trial_nudge` into lesson session creation
- Add `SENDGRID_API_KEY` and `DISCORD_SERVER_ID` to environment
