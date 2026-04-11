# Group Sync Infrastructure Design

## Overview

Refactor group realization to follow the same diff-based, idempotent pattern as group synchronization. Merge infrastructure creation into `sync_group()` with an `allow_create` flag.

**Goals:**
- Single entry point for all group sync operations
- Idempotent: safe to call repeatedly
- Self-healing: fills in missing infrastructure when allowed
- Robust error handling: best-effort, skip dependencies, report everything

## API

```python
async def sync_group(group_id: int, allow_create: bool = False) -> dict
```

**Parameters:**
- `group_id`: The group to sync
- `allow_create`: If `True`, create missing infrastructure. If `False`, error if infrastructure missing.

**Preconditions:**
- If `allow_create=True` and group has zero members in DB, skip infrastructure creation and stay `preview`

**Return value:**
```python
{
    "infrastructure": {
        "category": {"status": "existed", "id": "123"},
        "text_channel": {"status": "created", "id": "456"},
        "voice_channel": {"status": "failed", "error": "rate_limited"},
        "meetings": {"created": 0, "existed": 8},
        "discord_events": {"created": 0, "existed": 8, "skipped": 0},
    },
    "discord": {"granted": 1, "revoked": 0, "unchanged": 2, "failed": 0, "granted_user_ids": [1], "revoked_user_ids": []},
    "calendar": {"meetings": 8, "created": 0, "patched": 2, "unchanged": 6, "failed": 0},
    "reminders": {"meetings": 8},
    "rsvps": {"meetings": 8},
    "notifications": {"sent": 1, "skipped": 2},
}
```

## Infrastructure Creation

When `allow_create=True`, the following infrastructure is created if missing:

| Resource | Required for status=active | Notes |
|----------|---------------------------|-------|
| Cohort category | Yes | Created in Discord, ID saved to `cohorts` table |
| Text channel | Yes | Created in Discord, ID saved to `groups` table, welcome message sent |
| Voice channel | Yes | Created in Discord, ID saved to `groups` table |
| Meeting records | Yes | Created in `meetings` table |
| Discord scheduled events | No | Created if voice channel exists, skipped otherwise |

**Order of operations:**
1. `ensure_cohort_category()` - check/create Discord category
2. `ensure_group_channels()` - check/create text and voice channels
3. `ensure_group_meetings()` - check/create meeting records in DB
4. `ensure_meeting_discord_events()` - check/create Discord events (skip if no voice channel)

**Verification strategy:**
- Discord resources: verify via `bot.get_channel()` (cache lookup, not API call)
- DB records: trust the database

**Partial failure handling:**
- Continue with what we can do
- Skip steps that depend on missing prerequisites
- Report everything in the result
- Don't auto-fix unexpected states (e.g., channel deleted) - flag for review

## Membership Sync

Always runs after infrastructure (whether created or pre-existing):

1. `sync_group_discord_permissions()` - grant/revoke channel access based on DB membership
2. `sync_group_calendar()` - add/remove calendar event attendees
3. `sync_group_reminders()` - sync APScheduler reminder jobs
4. `sync_group_rsvps()` - sync RSVP records

These functions are diff-based and idempotent (unchanged from current implementation).

**Change to `sync_group_discord_permissions()`:** Return `granted_user_ids` and `revoked_user_ids` lists in addition to counts, for notification logic.

## Status Transitions

**Group status values:**
- `preview`: Infrastructure not yet created
- `active`: Fully realized and usable

**Transition criteria (`preview` → `active`):**
- Category exists in Discord
- Text channel exists in Discord
- Voice channel exists in Discord
- Meeting records exist in DB
- At least one member has channel access

```python
def is_fully_realized(infrastructure_result: dict, discord_result: dict) -> bool:
    required = ["category", "text_channel", "voice_channel", "meetings"]
    for key in required:
        info = infrastructure_result.get(key, {})
        if info.get("status") == "failed":
            return False
        if key == "meetings":
            total = info.get("created", 0) + info.get("existed", 0)
            if total == 0:
                return False

    # At least one member must have access
    if discord_result.get("granted", 0) + discord_result.get("unchanged", 0) == 0:
        return False

    return True
```

## Notifications

Notifications are handled inside `sync_group()` based on what changed.

**Detection logic:**

```python
# For each user granted permissions:
already_notified = await was_notification_sent(
    user_id, "group_assigned", NotificationReferenceType.group_id, group_id
)

if already_notified:
    # Re-sync, skip notification
    pass
elif transitioned_to_active:
    # Initial realization - send long welcome
    await notify_group_assigned(user_id, group_id)
else:
    # Late join - send short messages
    await notify_member_joined(user_id, group_id)        # DM to user
    await notify_channel_member_joined(group_id, user_id) # Channel announcement
```

**Message types:**
- `group_assigned`: Long welcome message (initial realization)
- `member_joined`: Short "you joined" message (late join, to user)
- `member_joined_channel`: Short "X joined" message (late join, to channel)

## Command Changes

**Rename:** `/realize-groups` → `/realize-cohort`

**Implementation:**
```python
@app_commands.command(name="realize-cohort")
async def realize_cohort(self, interaction: discord.Interaction, cohort: int):
    await interaction.response.defer()

    async with get_connection() as conn:
        groups = await get_preview_groups_for_cohort(conn, cohort)

    results = []
    for group in groups:
        result = await sync_group(group["group_id"], allow_create=True)
        results.append({"group": group["group_name"], "result": result})

    # Show summary embed
```

## Caller Changes

**`sync_after_group_change()`:**
- Calls `sync_group(group_id, allow_create=False)`
- No longer handles notifications (moved into `sync_group()`)
- Simplified to just orchestrate syncing old and new groups

```python
async def sync_after_group_change(
    group_id: int,
    previous_group_id: int | None = None,
) -> dict:
    results = {}

    if previous_group_id:
        results["old_group"] = await sync_group(previous_group_id, allow_create=False)

    results["new_group"] = await sync_group(group_id, allow_create=False)

    return results
```

**Web API group join:**
- Calls `sync_after_group_change()` after DB commit
- No other changes needed

## File Organization

All new code in `core/sync.py`:
- `ensure_cohort_category()`
- `ensure_group_channels()`
- `ensure_group_meetings()`
- `ensure_meeting_discord_events()`
- `send_sync_notifications()`
- Updated `sync_group()`
- Simplified `sync_after_group_change()`

Helper functions are private to the module, not exported.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Group has zero members in DB | Skip infrastructure creation, stay `preview` |
| Infrastructure missing, `allow_create=False` | Return `{"needs_infrastructure": True}` |
| Infrastructure missing, `allow_create=True` | Create it |
| Discord channel deleted (DB has ID, Discord returns None) | Return `{"channel_missing": True}`, don't auto-recreate |
| Partial infrastructure exists | Fill in what's missing (idempotent) |
| API rate limit during creation | Mark as failed, continue with other resources |
| Permission grant fails | Capture in result, schedule retry |

## Migration

1. Implement new `sync_group()` with `allow_create` parameter
2. Add helper functions for infrastructure creation
3. Update `/realize-groups` → `/realize-cohort` to use new API
4. Update `sync_after_group_change()` to remove notification logic
5. Update `sync_group_discord_permissions()` to return user ID lists
6. Add new notification message types if needed
