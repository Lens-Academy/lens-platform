# Scheduler and Groups Refactor

## Overview

**Problem:**
The current `groups_cog.py` manually creates groups with broken dependencies on removed course JSON files. The scheduler runs in memory and doesn't persist results. There's no connection between the scheduling algorithm and Discord channel creation.

**Solution:**
Split into two distinct operations:

1. **Scheduling** (`/schedule`) — Runs the algorithm and persists groups to the database
2. **Realization** (`/realize-groups`) — Creates Discord infrastructure for persisted groups

This separation allows:
- Reviewing/editing groups in the database before creating Discord channels
- Re-running scheduling without affecting existing Discord channels
- Future automation via cron jobs
- Multi-platform output (Discord now, email later)

**Architecture:**
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Discord Cog    │────▶│  Core Backend   │────▶│    Database     │
│  (thin adapter) │     │  (business      │     │   (PostgreSQL)  │
│                 │◀────│   logic)        │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- **Discord cog**: UI only (slash commands, autocomplete, channel creation)
- **Core**: All business logic (queries, scheduling algorithm, structured data for messages)
- **Database**: Source of truth for cohorts, groups, memberships

---

## The `/schedule` Command

**User Flow:**
1. Admin types `/schedule`
2. Autocomplete shows cohorts that have users awaiting grouping
3. Admin selects a cohort (e.g., "AI Safety Fundamentals - Jan 2025")
4. Bot shows progress ("Scheduling 24 users...")
5. Bot displays results summary (groups formed, unassigned users)

**Core Functions:**

```python
# core/queries/cohorts.py

async def get_schedulable_cohorts() -> list[dict]:
    """
    Returns cohorts that have users with grouping_status='awaiting_grouping'.

    Returns: [{"cohort_id": 1, "cohort_name": "AI Safety - Jan 2025", "pending_users": 24}, ...]
    """
```

```python
# core/scheduling.py

async def schedule_cohort(cohort_id: int) -> SchedulingResult:
    """
    1. Load users from courses_users WHERE cohort_id=X AND grouping_status='awaiting_grouping'
    2. Get their availability from users table
    3. Run scheduling algorithm
    4. Insert groups into 'groups' table
    5. Insert memberships into 'groups_users' table
    6. Update courses_users.grouping_status to 'grouped' or 'ungroupable'

    Returns: SchedulingResult with groups formed, unassigned users, etc.
    """
```

**Discord Cog** (thin adapter):
- Implements autocomplete by calling `get_schedulable_cohorts()`
- Calls `schedule_cohort(cohort_id)`
- Formats result into Discord embed

---

## The `/realize-groups` Command

**User Flow:**
1. Admin types `/realize-groups`
2. Autocomplete shows cohorts that have groups without Discord channels
3. Admin selects a cohort
4. Bot creates Discord infrastructure and reports progress
5. Bot confirms completion with summary

**What Gets Created (per cohort):**
- 1 Discord **category** named after the cohort (e.g., "AI Safety - Jan 2025")
- Per group:
  - 1 **text channel** (e.g., `#group-1`)
  - 1 **voice channel** (e.g., `Group 1 Voice`)
  - N **scheduled events** (where N = `cohorts.number_of_group_meetings`)
  - 1 **welcome message** in the text channel

**Permissions:**
- Category hidden from `@everyone`
- Each group's channels visible only to that group's members

**Core Functions:**

```python
# core/queries/cohorts.py

async def get_realizable_cohorts() -> list[dict]:
    """Returns cohorts with groups that have no Discord channels yet."""
```

```python
# core/queries/groups.py

async def get_cohort_groups_for_realization(cohort_id: int) -> dict:
    """
    Returns structured data for Discord realization:
    {
        "cohort_id": 1,
        "cohort_name": "AI Safety - Jan 2025",
        "cohort_start_date": "2025-01-15",
        "number_of_group_meetings": 8,
        "groups": [
            {
                "group_id": 1,
                "group_name": "Group 1",
                "meeting_time_utc": "Wednesday 15:00",
                "members": [
                    {"user_id": 123, "discord_id": "123456", "name": "Alice", "role": "facilitator", "timezone": "America/New_York"},
                    {"user_id": 456, "discord_id": "789012", "name": "Bob", "role": "participant", "timezone": "Europe/London"},
                ],
            },
            ...
        ]
    }
    """

async def save_discord_channel_ids(group_id: int, text_channel_id: str, voice_channel_id: str):
    """Updates groups table with Discord channel IDs after creation."""

async def save_cohort_category_id(cohort_id: int, category_id: str):
    """Updates cohorts table with Discord category ID after creation."""
```

**Discord Cog** handles:
- Creating Discord category, channels, scheduled events
- Setting permissions
- Formatting and sending welcome message
- Calling core functions to persist Discord IDs

---

## Welcome Message Structure

Core returns structured data, Discord cog (and future email adapter) formats it:

```python
# core/queries/groups.py

async def get_group_welcome_data(group_id: int) -> dict:
    """
    Returns structured data for welcome message:
    {
        "group_name": "Group 1",
        "cohort_name": "AI Safety Fundamentals - Jan 2025",
        "meeting_time_utc": {"day": "Wednesday", "hour": 15, "minute": 0},
        "first_meeting_date": "2025-01-22",
        "number_of_meetings": 8,
        "first_event_url": "https://discord.com/events/...",  # Added by cog after creating events
        "members": [
            {"name": "Alice", "discord_id": "123456", "role": "facilitator", "timezone": "America/New_York"},
            {"name": "Bob", "discord_id": "789012", "role": "participant", "timezone": "Europe/London"},
        ]
    }
    """
```

Discord cog uses this to:
- Build member list with `@mentions` and timezone-local meeting times
- Link to the first scheduled event
- Format as embed or plain message

---

## Schema Changes

**Add columns to `cohorts` table:**

```sql
ALTER TABLE cohorts ADD COLUMN number_of_group_meetings INTEGER NOT NULL;
ALTER TABLE cohorts ADD COLUMN discord_category_id TEXT;
```

**Update `core/tables.py`:**

```python
cohorts = Table(
    "cohorts",
    metadata,
    # ... existing columns ...
    Column("number_of_group_meetings", Integer, nullable=False),
    Column("discord_category_id", Text),  # Nullable - set after realization
)
```

**Existing columns we'll use (no changes needed):**

| Table | Column | Purpose |
|-------|--------|---------|
| `groups` | `discord_text_channel_id` | Store text channel ID after realization |
| `groups` | `discord_voice_channel_id` | Store voice channel ID after realization |
| `groups` | `recurring_meeting_time_utc` | Meeting time for scheduled events |
| `courses_users` | `grouping_status` | Track `awaiting_grouping` → `grouped` / `ungroupable` |
| `groups_users` | `role` | `participant` or `facilitator` |

---

## File Structure

**Files to modify:**

| File | Changes |
|------|---------|
| `core/tables.py` | Add `number_of_group_meetings` and `discord_category_id` to cohorts |
| `core/scheduling.py` | Add `schedule_cohort()`, update to persist to DB |
| `discord_bot/cogs/scheduler_cog.py` | Add cohort autocomplete, call new core functions |
| `discord_bot/cogs/groups_cog.py` | Rewrite as `/realize-groups` command |

**New files:**

| File | Purpose |
|------|---------|
| `core/queries/groups.py` | DB queries for groups (get, save, update Discord IDs) |
| `core/queries/cohorts.py` | DB queries for cohorts (get schedulable, get realizable) |

---

## Implementation Order

1. Schema migration (add columns to `cohorts`)
2. Core query functions (`core/queries/cohorts.py`, `core/queries/groups.py`)
3. Update `core/scheduling.py` to persist results
4. Refactor `scheduler_cog.py` with autocomplete
5. Rewrite `groups_cog.py` as `/realize-groups`
6. Welcome message formatting
