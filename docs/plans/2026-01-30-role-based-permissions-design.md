# Role-Based Discord Permissions

## Overview

Replace per-member channel permission overwrites with Discord roles. Each group gets a role, users are assigned to the role, and the role has permissions on the group's channels plus a shared cohort-wide channel.

## Motivation

Current system sets individual permission overwrites per member per channel. Role-based approach:
- Cleaner permission management (roles visible in member profiles)
- Easier to audit (can see role membership in Discord UI)
- Fewer API calls (one role assignment vs multiple channel overwrites)
- Better scaling (if a group gets new channels, role already has access)

## Constraints

- **250 roles max** per Discord guild (hard limit, cannot be increased)
- **500 channels max** per guild
- We're not implementing role cleanup for now - will address if we approach limits

## Database Changes

Add columns to `core/tables.py`:

```python
# groups table - add after discord_voice_channel_id
Column("discord_role_id", Text),

# cohorts table - add after discord_category_id
Column("discord_cohort_channel_id", Text),
```

## Naming Conventions

Names are computed from DB fields, not stored directly:

| Entity | Name Format | Example |
|--------|-------------|---------|
| Role | `Cohort <cohort_name> - Group <group_name>` | `Cohort January 2026 - Group Alpha` |
| Cohort channel | `general (<cohort_name>)` | `general (January 2026)` |
| Group text channel | `<group_name>` lowercased, spaces to dashes | `group-alpha` |
| Group voice channel | `<group_name> Voice` | `Group Alpha Voice` |

## Channel Structure

```
Cohort Category (e.g., "AI Safety - January 2026")
├── #general (January 2026)  ← All group roles have access, @everyone denied
├── #group-alpha             ← Only "Cohort January 2026 - Group Alpha" role
├── #group-beta              ← Only "Cohort January 2026 - Group Beta" role
├── 🔊 Group Alpha Voice     ← Only "Cohort January 2026 - Group Alpha" role
├── 🔊 Group Beta Voice      ← Only "Cohort January 2026 - Group Beta" role
```

## Architecture: Primitives vs Orchestration

Following existing patterns, we separate:
- **`core/discord_outbound/`** - Pure Discord primitives (take Discord objects, return Discord objects, no DB access)
- **`core/sync.py`** - Orchestration logic (queries DB, calls primitives, updates DB)

## New Primitives: `core/discord_outbound/roles.py`

Pure Discord operations, no database access:

```python
async def create_role(
    guild: discord.Guild,
    name: str,
    reason: str = "Group sync",
) -> discord.Role:
    """Create a Discord role. Raises on failure."""

async def delete_role(
    role: discord.Role,
    reason: str = "Group sync",
) -> bool:
    """Delete a Discord role. Returns True on success."""

async def rename_role(
    role: discord.Role,
    name: str,
    reason: str = "Group sync",
) -> bool:
    """Rename a Discord role. Returns True on success."""

async def set_role_channel_permissions(
    role: discord.Role,
    channel: discord.abc.GuildChannel,
    view_channel: bool = True,
    send_messages: bool | None = None,  # Text channels only
    read_message_history: bool | None = None,  # Text channels only
    connect: bool | None = None,  # Voice channels only
    speak: bool | None = None,  # Voice channels only
    reason: str = "Group sync",
) -> bool:
    """Set role permissions on a single channel. Returns True on success."""

def get_role_member_ids(role: discord.Role) -> set[str]:
    """Get Discord IDs (as strings) of all members with this role."""
```

## New Orchestration Functions: `core/sync.py`

### `_ensure_group_role(group_id: int) -> dict`

```python
async def _ensure_group_role(group_id: int) -> dict:
    """
    Ensure a Discord role exists for this group.

    1. Check role limit (warn if >240, fail if >=250)
    2. Read groups.discord_role_id from DB
    3. If exists, verify role still exists in Discord
       - If missing in Discord, return {"status": "role_missing", ...}
    4. If no ID in DB, create role with name "Cohort X - Group Y"
    5. Sync name if changed (compare computed name vs Discord name)
    6. Save role ID to DB if newly created

    Returns:
        {
            "status": "existed"|"created"|"role_missing"|"failed",
            "id": str | None,
            "error"?: str
        }
    """
```

### `_ensure_cohort_channel(cohort_id: int) -> dict`

```python
async def _ensure_cohort_channel(cohort_id: int) -> dict:
    """
    Ensure cohort has a shared #general channel.

    1. Read cohorts.discord_cohort_channel_id from DB
    2. If exists, verify channel still exists in Discord
       - If missing in Discord, return {"status": "channel_missing", ...}
    3. If no ID in DB, create "general (<cohort_name>)" in cohort category
       - Set @everyone to view_channel=False (deny)
    4. Sync name if changed
    5. Save channel ID to DB if newly created

    Returns:
        {
            "status": "existed"|"created"|"channel_missing"|"failed",
            "id": str | None,
            "error"?: str
        }
    """
```

### `_set_group_role_permissions(...) -> dict`

```python
async def _set_group_role_permissions(
    role: discord.Role,
    text_channel: discord.TextChannel,
    voice_channel: discord.VoiceChannel | None,
    cohort_channel: discord.TextChannel | None,
) -> dict:
    """
    Set role permissions on all group-related channels.

    - Text channel: view_channel, send_messages, read_message_history
    - Voice channel: view_channel, connect, speak
    - Cohort channel: view_channel, send_messages, read_message_history

    Returns:
        {"text": bool, "voice": bool, "cohort": bool}
    """
```

## Modified Function: `sync_group_discord_permissions`

Updated to use role-based permissions instead of per-member overwrites:

```python
async def sync_group_discord_permissions(group_id: int) -> dict:
    """
    Sync Discord role membership with DB membership (diff-based).

    1. Ensure group role exists (create if missing, sync name)
    2. Ensure cohort channel exists
    3. Ensure role has permissions on group channels + cohort channel
    4. Get expected members from DB (users with active group membership)
    5. Get current role members from Discord (role.members)
    6. Diff and add/remove role assignments:
       - await member.add_roles(role) for new members
       - await member.remove_roles(role) for removed members
       - Skip users not in guild (they'll get role on join via on_member_join)

    Returns:
        {"granted": N, "revoked": N, "unchanged": N, "failed": N, ...}
    """
```

## Name Sync Behavior

On each sync, names are verified and updated if changed:

1. Compute expected name from DB fields (`cohort_name`, `group_name`)
2. Compare to current Discord name
3. If different, call `.edit(name=expected_name)` to update

Cost: 0 extra API calls when names match, 1 call per renamed entity when changed.

## Edge Cases and Error Handling

### Role Limit
- Before creating a role, check `len(guild.roles)`
- Log warning if >240 roles
- Return `{"status": "failed", "error": "role_limit_reached"}` if >=250

### Role/Channel Missing in Discord
- If DB has ID but Discord object doesn't exist (manually deleted):
- Return `{"status": "role_missing"}` or `{"status": "channel_missing"}`
- Caller can decide to recreate or flag for manual review

### User Not in Guild
- Skip role assignment for users not in the Discord server
- They'll receive the role automatically via `on_member_join` event when they join

### Partial Failure
- No rollback on partial failure
- Sync is idempotent - re-running will pick up where it left off
- Return counts include `failed` for tracking

### Rate Limits
- Discord has stricter rate limits for role operations
- Add `asyncio.sleep(0.1)` between bulk role assignments if needed
- Log warnings if hitting rate limits

### Permission Check
- Before role operations, verify bot has "Manage Roles" permission
- Return `{"status": "failed", "error": "missing_manage_roles_permission"}` if not

### @everyone on Cohort Channel
- Cohort channel inherits @everyone deny from category
- Explicitly verify/set `view_channel=False` for @everyone on creation

## Migration

- New system applies to both new and existing groups
- User manually removes old per-member permission overwrites
- Sync is idempotent and diff-based (safe to run multiple times)

## Testing

### E2E Tests

Rename `test_scheduling_e2e.py` → `test_discord_e2e.py`

Extend cleanup fixture to handle roles:

```python
@pytest_asyncio.fixture
async def cleanup_discord(guild):
    """Track and clean up Discord channels, events, and roles."""
    # Clean up stale E2E test roles at START
    for role in guild.roles:
        if E2E_TEST_PREFIX in role.name:
            try:
                await role.delete(reason="E2E stale cleanup")
                await asyncio.sleep(0.3)
            except discord.HTTPException as e:
                print(f"Warning: Could not clean up stale role {role}: {e}")

    created = {
        "channels": [],
        "events": [],
        "roles": [],  # NEW
    }
    yield created

    # Cleanup roles FIRST (before channels, as roles may reference channels)
    for role in created["roles"]:
        try:
            await role.delete(reason="E2E test cleanup")
            await asyncio.sleep(0.3)
        except discord.NotFound:
            pass
        except discord.HTTPException as e:
            print(f"Warning: Could not delete role {role}: {e}")

    # Then cleanup channels and events as before...
```

### Test Cases

**Role Creation & Assignment:**
- Role created with correct name format
- Role has permissions on group text channel
- Role has permissions on group voice channel
- Role has permissions on cohort-wide channel
- Member receives role after sync
- Role ID saved to `groups.discord_role_id`

**Cohort Channel:**
- Cohort channel created with correct name
- @everyone cannot view cohort channel
- All group roles in cohort can view cohort channel
- Channel ID saved to `cohorts.discord_cohort_channel_id`

**Sync Behavior:**
- Idempotency (running sync twice doesn't create duplicates)
- Role assignment skipped for user not in server (no error)
- Role removed when user removed from group in DB
- Name sync updates Discord when cohort/group name changes in DB

**Edge Cases:**
- Role limit reached returns error
- Concurrent sync calls don't create duplicate roles
- Missing role in Discord detected and reported

### Unit Tests

Add unit tests for `core/discord_outbound/roles.py` primitives with mocked Discord objects, following existing pattern in `core/notifications/tests/test_discord_channel.py`.

## Logging

Add logging for observability:

```python
logger.info(f"Created role '{role.name}' for group {group_id}")
logger.info(f"Role sync for group {group_id}: granted={granted}, revoked={revoked}, unchanged={unchanged}")
logger.warning(f"Role limit approaching: {len(guild.roles)}/250 roles")
logger.warning(f"Role {role_id} missing in Discord for group {group_id}")
```
