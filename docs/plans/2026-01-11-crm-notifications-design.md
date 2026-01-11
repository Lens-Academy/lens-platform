# CRM / Notifications System Design

**Date:** 2026-01-11
**Status:** Approved

## Overview

Internal notification system for sending emails and Discord messages to users based on course events. Replaces need for external CRM tools like Salesforce.

## Goals

- Send timely notifications across email and Discord
- Meeting reminders with calendar invites
- Lesson progress nudges
- Centralized, editable message templates
- Respect user notification preferences

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Email provider | SendGrid | Industry standard, good free tier, most training examples for AI assistance |
| Scheduler | APScheduler + PostgreSQL | Runs in-process, handles thousands of jobs, clean migration path to Celery if needed |
| Calendar invites | iTIP format (method=REQUEST) | Proper invite UX with Accept/Decline buttons, not just .ics attachment |
| Message templates | YAML (single file) | Easy to review all messages, non-developer friendly |
| Email format | Plain text (for now) | Start simple, design supports HTML base template later |

## Architecture

```
core/notifications/
├── __init__.py          # Public API: send_notification(), schedule_reminder()
├── channels/
│   ├── email.py         # SendGrid integration
│   ├── discord.py       # DM and channel messages (with rate limiting)
│   └── calendar.py      # iCal/iTIP generation
├── scheduler.py         # APScheduler setup, job persistence
├── dispatcher.py        # Routes to channels based on user prefs
├── messages.yaml        # All message templates
└── templates.py         # YAML loader + variable substitution
```

### Integration Points

- Lives in `core/` (platform-agnostic)
- Both Discord bot and FastAPI can trigger notifications
- Scheduler runs in main process (shared asyncio event loop)
- Uses existing database tables: `reminders_log`, `reminder_recipients_log`

### New Database Table

```sql
-- APScheduler job persistence (managed by APScheduler)
notification_jobs
```

## Notification Types

| Event | Email | Discord | Calendar | Trigger |
|-------|-------|---------|----------|---------|
| Welcome | Yes | DM | - | User completes signup |
| Group assigned | Yes | DM | Attached | User assigned to group |
| Meeting reminder (24h) | Yes | Group channel | - | 24h before meeting |
| Meeting reminder (1h) | Yes | Group channel | - | 1h before meeting |
| Lesson nudge (3d before) | Yes | DM | - | 3d before meeting if <50% done |
| Lesson nudge (1d before) | Yes | DM | - | 1d before meeting if <100% done |
| Trial lesson nudge | Yes | DM | - | 24h after starting trial |

## User Preferences

Uses existing database fields:
- `email_notifications_enabled` (boolean, default true)
- `dm_notifications_enabled` (boolean, default true)

Both channels enabled by default. User can disable either globally. No per-notification-type preferences for now.

## Job Scheduling

### Job ID Convention

- `meeting_{id}_reminder_24h`
- `meeting_{id}_reminder_1h`
- `meeting_{id}_lesson_nudge_3d`
- `meeting_{id}_lesson_nudge_1d`
- `trial_{session_id}_nudge`

### Lifecycle

1. **Created** when meeting/session is created
2. **Cancelled and recreated** when meeting is rescheduled
3. **Cancelled** when meeting is deleted
4. **Safety check** at execution time before sending (verify meeting still exists)

### Lesson Nudge Logic

| Timing | Condition | Action |
|--------|-----------|--------|
| 3 days before meeting | < 50% lessons completed | Send nudge |
| 1 day before meeting | < 100% lessons completed | Send nudge |

## Discord Rate Limiting

| Limit | Value |
|-------|-------|
| Global DM rate limit | 5 DMs per 5 seconds |
| Safe throughput | ~1 DM/second |

**Approach:**
- Channel messages (meeting reminders): Send immediately, no significant rate limit
- DMs (welcome, group assigned, lesson nudges): Throttle at ~1/second
- discord.py has built-in rate limit handling as fallback

**For 1,000 users:** DMs drip out over ~17 minutes. Emails send immediately.

## Message Templates

Single YAML file with all user-facing messages:

```yaml
# core/notifications/messages.yaml

welcome:
  email_subject: Welcome to the AI Safety Course
  email_body: |
    Hi {name},

    Thanks for signing up! We're excited to have you.

    Next steps:
    - Complete your availability form: {profile_url}
    - We'll match you with a study group

    Questions? Reply to this email.
  discord: |
    Welcome {name}! Thanks for signing up.
    Complete your availability form to get matched: {profile_url}

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
  discord_channel: |
    Reminder: Meeting tomorrow at {meeting_time}!

meeting_reminder_1h:
  email_subject: "Reminder: {group_name} meeting in 1 hour"
  email_body: |
    Hi {name},

    Your study group meets in 1 hour at {meeting_time}.

    Join your group channel: {discord_channel_url}

    See you there!
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
  discord: |
    Heads up! You have {lessons_remaining} lessons to finish before
    your meeting on {meeting_date}. Continue here: {lesson_url}

trial_nudge:
  email_subject: Finish your trial lesson?
  email_body: |
    Hi {name},

    You started the trial lesson but didn't finish.
    Pick up where you left off: {lesson_url}
  discord: |
    Hey {name}! You started the trial lesson yesterday.
    Want to finish it? {lesson_url}
```

### Template Variables

Common variables available to templates:

| Variable | Description |
|----------|-------------|
| `{name}` | User's display name |
| `{email}` | User's email |
| `{group_name}` | Study group name |
| `{meeting_time}` | Formatted meeting time in user's timezone |
| `{meeting_date}` | Meeting date |
| `{member_names}` | Comma-separated list of group members |
| `{lesson_list}` | Bulleted list of lessons |
| `{lessons_remaining}` | Count of incomplete lessons |
| `{lesson_url}` | Direct link to next/current lesson |
| `{discord_channel_url}` | Link to group's Discord channel |
| `{profile_url}` | Link to user's profile page |

### URL Formats

- Website: `https://{domain}/lessons/{lesson_id}`
- Discord channel: `https://discord.com/channels/{server_id}/{channel_id}`
- Profile: `https://{domain}/profile`

## Calendar Invites

Sent as proper iTIP invites (not .ics attachments):

```
Content-Type: text/calendar; method=REQUEST
```

This gives users Accept/Decline/Maybe buttons in their email client and auto-adds to calendar on accept.

Generated when user is assigned to a group with a recurring meeting time.

## Email Format Roadmap

**Now:** Plain text emails

**Later:** HTML emails with base template

```
┌─────────────────────────┐
│  [Logo]                 │  ← email_base.html
│─────────────────────────│
│                         │
│  {content from YAML}    │  ← messages.yaml (markdown → HTML)
│                         │
│─────────────────────────│
│  Footer / Unsubscribe   │  ← email_base.html
└─────────────────────────┘
```

Single email address field for all communications (no separate calendar email).

## Public API

```python
from core.notifications import send_notification, schedule_reminder, cancel_reminders

# Send immediately
await send_notification(
    user_id=123,
    message_type="welcome",
    context={"name": "Alice", "profile_url": "..."}
)

# Schedule for later
schedule_reminder(
    job_id="meeting_456_reminder_24h",
    run_at=meeting_time - timedelta(hours=24),
    message_type="meeting_reminder_24h",
    recipients=[user_ids],
    context={...}
)

# Cancel (e.g., on meeting reschedule)
cancel_reminders(pattern="meeting_456_*")
```

## Flow Example: User Assigned to Group

1. Scheduling algorithm assigns user to group
2. Code calls `send_notification(user_id, "group_assigned", context)`
3. Dispatcher checks `email_notifications_enabled` → true
4. Dispatcher checks `dm_notifications_enabled` → true
5. Email channel: renders template, attaches calendar invite, sends via SendGrid
6. Discord channel: renders template, queues DM (throttled)
7. Both logged to `reminders_log` with delivery status
8. Scheduler creates jobs: `meeting_{id}_reminder_24h`, `meeting_{id}_reminder_1h`, `meeting_{id}_lesson_nudge_3d`, `meeting_{id}_lesson_nudge_1d`

## Open Questions (for implementation)

- SendGrid API key management (env var)
- Discord server ID storage/configuration
- Lesson progress query (exact schema for `lesson_sessions`)
- Retry policy for failed sends
