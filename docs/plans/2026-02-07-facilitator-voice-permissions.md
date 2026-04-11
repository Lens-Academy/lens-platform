# Facilitator Voice Channel Permissions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move facilitator `connect=True` member-level permission on voice channels from the breakout tool to the sync system, so facilitators always have connect access regardless of breakout state.

**Architecture:** During `sync_group_discord_permissions`, diff-sync facilitator member-level `connect=True` overwrites on the group voice channel: query DB for desired facilitators, read current member overwrites from Discord, compute grant/revoke sets, and apply only the diff. Remove the facilitator permission logic from `breakout_cog.py` entirely — the breakout tool should only deny connect on group roles during breakout, trusting that facilitators already have member-level connect from sync. Self-healing: demoted facilitators lose their overwrite on next sync, missing overwrites get re-added.

**Tech Stack:** Python, SQLAlchemy, discord.py, pytest

---

## Context

### Current State
- `core/sync.py:sync_group_discord_permissions` (line 1139) handles role membership sync but does NOT differentiate facilitators from participants
- `core/sync.py:_set_group_role_permissions` (line 551) sets role-level permissions on voice channels (`connect=True`, `view_channel=True`, `speak=True`) — applies to all group members via role
- `discord_bot/cogs/breakout_cog.py` (line 762-770) currently sets a member-level `connect=True` for the facilitator during breakout creation
- `discord_bot/cogs/breakout_cog.py` (line 559-567) removes the facilitator member-level overwrite during collect
- `core/enums.py:GroupUserRole` has `participant` and `facilitator` values
- `core/tables.py` `groups_users` table has a `role` column using `group_user_role_enum`

### Why This Matters
Discord permission hierarchy: member overwrites > role overwrites > @everyone. During breakout, the breakout tool denies `connect` on the group role. Without a member-level `connect=True`, the facilitator gets locked out too. Currently the breakout tool sets this, but it should be set during sync so:
1. Facilitator always has connect even if breakout is started by a different mechanism
2. Facilitator connect persists if bot restarts during breakout
3. Clean separation of concerns: sync manages permissions, breakout only locks/unlocks roles

### Key Files
- `core/sync.py` — `sync_group_discord_permissions` (line 1139), `_set_group_role_permissions` (line 551)
- `core/discord_outbound/permissions.py` — `grant_channel_access`, `revoke_channel_access`
- `core/discord_outbound/__init__.py` — exports
- `core/tables.py` — `groups_users` table (line 163-172)
- `core/enums.py` — `GroupUserRole` (line 27-29)
- `core/tests/test_sync.py` — existing sync tests (line 36+)
- `discord_bot/cogs/breakout_cog.py` — breakout tool

---

### Task 1: Add Diff-Based Facilitator Voice Permission to Sync

**Files:**
- Test: `core/tests/test_sync.py`
- Modify: `core/sync.py:1139-1342` (inside `sync_group_discord_permissions`)

**Step 1: Write the failing test — grant facilitator connect**

Add a new test to `core/tests/test_sync.py` in the `TestSyncGroupDiscordPermissions` class:

```python
@pytest.mark.asyncio
async def test_grants_facilitator_connect_on_voice_channel(self):
    """Should set member-level connect=True on voice channel for facilitators (diff-based)."""
    from core.sync import sync_group_discord_permissions
    import discord

    mock_conn = AsyncMock()

    # Query 1: _ensure_group_role - get group/cohort info
    mock_role_query_result = MagicMock()
    mock_role_query_result.mappings.return_value.first.return_value = {
        "group_id": 1,
        "group_name": "Test Group",
        "discord_role_id": "777888999",
        "cohort_id": 1,
        "cohort_name": "Jan 2026",
    }

    # Query 2: get group channel info
    mock_group_result = MagicMock()
    mock_group_result.mappings.return_value.first.return_value = {
        "cohort_id": 1,
        "discord_text_channel_id": "123456789",
        "discord_voice_channel_id": "987654321",
    }

    # Query 3: _ensure_cohort_channel - get cohort info
    mock_cohort_result = MagicMock()
    mock_cohort_result.mappings.return_value.first.return_value = {
        "cohort_id": 1,
        "cohort_name": "Jan 2026",
        "discord_category_id": "555666777",
        "discord_cohort_channel_id": "888999000",
    }

    # Query 4: get expected members from DB (discord_ids)
    mock_members_result = MagicMock()
    mock_members_result.mappings.return_value = [
        {"discord_id": "111"},
        {"discord_id": "222"},
    ]

    # Query 5: get facilitator discord_ids for this group
    mock_facilitator_result = MagicMock()
    mock_facilitator_result.mappings.return_value = [
        {"discord_id": "111"},  # User 111 is a facilitator
    ]

    mock_conn.execute = AsyncMock(
        side_effect=[
            mock_role_query_result,
            mock_group_result,
            mock_cohort_result,
            mock_members_result,
            mock_facilitator_result,
        ]
    )

    # Mock Discord objects
    mock_role = MagicMock(spec=discord.Role)
    mock_role.id = 777888999
    mock_role.name = "Cohort Jan 2026 - Group Test Group"
    mock_role.members = []

    mock_text_channel = MagicMock(spec=discord.TextChannel)
    mock_text_channel.id = 123456789
    mock_text_channel.set_permissions = AsyncMock()

    # Voice channel has NO existing member overwrites (fresh state)
    mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
    mock_voice_channel.id = 987654321
    mock_voice_channel.set_permissions = AsyncMock()
    mock_voice_channel.overwrites = {}  # No existing overwrites

    mock_cohort_channel = MagicMock(spec=discord.TextChannel)
    mock_cohort_channel.id = 888999000
    mock_cohort_channel.name = "general-jan-2026"
    mock_cohort_channel.set_permissions = AsyncMock()

    mock_guild = MagicMock(spec=discord.Guild)
    mock_guild.roles = [mock_role]
    mock_guild.me = MagicMock()
    mock_guild.me.guild_permissions = MagicMock()
    mock_guild.me.guild_permissions.manage_roles = True
    mock_guild.get_role.return_value = mock_role
    mock_role.guild = mock_guild

    mock_facilitator_member = MagicMock(spec=discord.Member)
    mock_facilitator_member.id = 111
    mock_facilitator_member.add_roles = AsyncMock()
    mock_facilitator_member.remove_roles = AsyncMock()

    mock_participant_member = MagicMock(spec=discord.Member)
    mock_participant_member.id = 222
    mock_participant_member.add_roles = AsyncMock()
    mock_participant_member.remove_roles = AsyncMock()

    async def mock_fetch(guild, discord_id):
        if discord_id == 111:
            return mock_facilitator_member
        if discord_id == 222:
            return mock_participant_member
        return None

    mock_bot = MagicMock()
    mock_bot.guilds = [mock_guild]
    mock_bot.get_channel.side_effect = lambda id: {
        123456789: mock_text_channel,
        987654321: mock_voice_channel,
        888999000: mock_cohort_channel,
        555666777: MagicMock(),
    }.get(id)

    with patch("core.discord_outbound.bot._bot", mock_bot):
        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.discord_outbound.get_or_fetch_member",
                side_effect=mock_fetch,
            ):
                with patch(
                    "core.discord_outbound.get_role_member_ids",
                    return_value=set(),
                ):
                    with patch(
                        "core.sync._set_group_role_permissions",
                        new_callable=AsyncMock,
                    ) as mock_set_perms:
                        mock_set_perms.return_value = {
                            "text": True,
                            "voice": True,
                            "cohort": True,
                        }
                        result = await sync_group_discord_permissions(
                            group_id=1
                        )

    # Verify facilitator got member-level connect=True on voice channel
    mock_voice_channel.set_permissions.assert_any_call(
        mock_facilitator_member,
        connect=True,
        reason="Facilitator voice access",
    )

    # Verify result includes facilitator stats
    assert result["facilitator_granted"] == 1
    assert result["facilitator_revoked"] == 0
```

**Step 2: Write the failing test — revoke demoted facilitator**

```python
@pytest.mark.asyncio
async def test_revokes_demoted_facilitator_connect(self):
    """Should remove member-level connect overwrite when facilitator is demoted."""
    from core.sync import sync_group_discord_permissions
    import discord

    mock_conn = AsyncMock()

    mock_role_query_result = MagicMock()
    mock_role_query_result.mappings.return_value.first.return_value = {
        "group_id": 1,
        "group_name": "Test Group",
        "discord_role_id": "777888999",
        "cohort_id": 1,
        "cohort_name": "Jan 2026",
    }

    mock_group_result = MagicMock()
    mock_group_result.mappings.return_value.first.return_value = {
        "cohort_id": 1,
        "discord_text_channel_id": "123456789",
        "discord_voice_channel_id": "987654321",
    }

    mock_cohort_result = MagicMock()
    mock_cohort_result.mappings.return_value.first.return_value = {
        "cohort_id": 1,
        "cohort_name": "Jan 2026",
        "discord_category_id": "555666777",
        "discord_cohort_channel_id": "888999000",
    }

    # Both 111 and 222 are active members
    mock_members_result = MagicMock()
    mock_members_result.mappings.return_value = [
        {"discord_id": "111"},
        {"discord_id": "222"},
    ]

    # No facilitators in DB (111 was demoted)
    mock_facilitator_result = MagicMock()
    mock_facilitator_result.mappings.return_value = []

    mock_conn.execute = AsyncMock(
        side_effect=[
            mock_role_query_result,
            mock_group_result,
            mock_cohort_result,
            mock_members_result,
            mock_facilitator_result,
        ]
    )

    mock_role = MagicMock(spec=discord.Role)
    mock_role.id = 777888999
    mock_role.name = "Cohort Jan 2026 - Group Test Group"
    mock_role.members = []

    mock_text_channel = MagicMock(spec=discord.TextChannel)
    mock_text_channel.id = 123456789
    mock_text_channel.set_permissions = AsyncMock()

    # Member 111 has a stale connect=True overwrite (was facilitator, now demoted)
    mock_former_facilitator = MagicMock(spec=discord.Member)
    mock_former_facilitator.id = 111
    mock_former_facilitator.add_roles = AsyncMock()
    mock_former_facilitator.remove_roles = AsyncMock()

    stale_overwrite = MagicMock(spec=discord.PermissionOverwrite)
    stale_overwrite.connect = True

    mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
    mock_voice_channel.id = 987654321
    mock_voice_channel.set_permissions = AsyncMock()
    mock_voice_channel.overwrites = {
        mock_former_facilitator: stale_overwrite,  # Stale overwrite from when they were facilitator
    }

    mock_cohort_channel = MagicMock(spec=discord.TextChannel)
    mock_cohort_channel.id = 888999000
    mock_cohort_channel.name = "general-jan-2026"
    mock_cohort_channel.set_permissions = AsyncMock()

    mock_guild = MagicMock(spec=discord.Guild)
    mock_guild.roles = [mock_role]
    mock_guild.me = MagicMock()
    mock_guild.me.guild_permissions = MagicMock()
    mock_guild.me.guild_permissions.manage_roles = True
    mock_guild.get_role.return_value = mock_role
    mock_role.guild = mock_guild

    mock_participant = MagicMock(spec=discord.Member)
    mock_participant.id = 222
    mock_participant.add_roles = AsyncMock()
    mock_participant.remove_roles = AsyncMock()

    async def mock_fetch(guild, discord_id):
        if discord_id == 111:
            return mock_former_facilitator
        if discord_id == 222:
            return mock_participant
        return None

    mock_bot = MagicMock()
    mock_bot.guilds = [mock_guild]
    mock_bot.get_channel.side_effect = lambda id: {
        123456789: mock_text_channel,
        987654321: mock_voice_channel,
        888999000: mock_cohort_channel,
        555666777: MagicMock(),
    }.get(id)

    with patch("core.discord_outbound.bot._bot", mock_bot):
        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.discord_outbound.get_or_fetch_member",
                side_effect=mock_fetch,
            ):
                with patch(
                    "core.discord_outbound.get_role_member_ids",
                    return_value={"111", "222"},
                ):
                    with patch(
                        "core.sync._set_group_role_permissions",
                        new_callable=AsyncMock,
                    ) as mock_set_perms:
                        mock_set_perms.return_value = {
                            "text": True,
                            "voice": True,
                            "cohort": True,
                        }
                        result = await sync_group_discord_permissions(
                            group_id=1
                        )

    # Verify the stale overwrite was removed
    mock_voice_channel.set_permissions.assert_any_call(
        mock_former_facilitator,
        overwrite=None,
        reason="Facilitator voice access removed",
    )

    # Verify result stats
    assert result["facilitator_granted"] == 0
    assert result["facilitator_revoked"] == 1
```

**Step 3: Write the failing test — idempotent (no-op when already correct)**

```python
@pytest.mark.asyncio
async def test_facilitator_sync_is_idempotent(self):
    """Should make no API calls when facilitator overwrites are already correct."""
    from core.sync import sync_group_discord_permissions
    import discord

    mock_conn = AsyncMock()

    mock_role_query_result = MagicMock()
    mock_role_query_result.mappings.return_value.first.return_value = {
        "group_id": 1,
        "group_name": "Test Group",
        "discord_role_id": "777888999",
        "cohort_id": 1,
        "cohort_name": "Jan 2026",
    }

    mock_group_result = MagicMock()
    mock_group_result.mappings.return_value.first.return_value = {
        "cohort_id": 1,
        "discord_text_channel_id": "123456789",
        "discord_voice_channel_id": "987654321",
    }

    mock_cohort_result = MagicMock()
    mock_cohort_result.mappings.return_value.first.return_value = {
        "cohort_id": 1,
        "cohort_name": "Jan 2026",
        "discord_category_id": "555666777",
        "discord_cohort_channel_id": "888999000",
    }

    mock_members_result = MagicMock()
    mock_members_result.mappings.return_value = [
        {"discord_id": "111"},
    ]

    # User 111 is a facilitator in DB
    mock_facilitator_result = MagicMock()
    mock_facilitator_result.mappings.return_value = [
        {"discord_id": "111"},
    ]

    mock_conn.execute = AsyncMock(
        side_effect=[
            mock_role_query_result,
            mock_group_result,
            mock_cohort_result,
            mock_members_result,
            mock_facilitator_result,
        ]
    )

    mock_role = MagicMock(spec=discord.Role)
    mock_role.id = 777888999
    mock_role.members = []

    mock_text_channel = MagicMock(spec=discord.TextChannel)
    mock_text_channel.id = 123456789

    # User 111 already has connect=True overwrite (already synced)
    mock_facilitator_member = MagicMock(spec=discord.Member)
    mock_facilitator_member.id = 111
    mock_facilitator_member.add_roles = AsyncMock()

    existing_overwrite = MagicMock(spec=discord.PermissionOverwrite)
    existing_overwrite.connect = True

    mock_voice_channel = MagicMock(spec=discord.VoiceChannel)
    mock_voice_channel.id = 987654321
    mock_voice_channel.set_permissions = AsyncMock()
    mock_voice_channel.overwrites = {
        mock_facilitator_member: existing_overwrite,  # Already has connect=True
    }

    mock_cohort_channel = MagicMock(spec=discord.TextChannel)
    mock_cohort_channel.id = 888999000
    mock_cohort_channel.name = "general-jan-2026"

    mock_guild = MagicMock(spec=discord.Guild)
    mock_guild.roles = [mock_role]
    mock_guild.me = MagicMock()
    mock_guild.me.guild_permissions = MagicMock()
    mock_guild.me.guild_permissions.manage_roles = True
    mock_guild.get_role.return_value = mock_role
    mock_role.guild = mock_guild

    async def mock_fetch(guild, discord_id):
        if discord_id == 111:
            return mock_facilitator_member
        return None

    mock_bot = MagicMock()
    mock_bot.guilds = [mock_guild]
    mock_bot.get_channel.side_effect = lambda id: {
        123456789: mock_text_channel,
        987654321: mock_voice_channel,
        888999000: mock_cohort_channel,
        555666777: MagicMock(),
    }.get(id)

    with patch("core.discord_outbound.bot._bot", mock_bot):
        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch(
                "core.discord_outbound.get_or_fetch_member",
                side_effect=mock_fetch,
            ):
                with patch(
                    "core.discord_outbound.get_role_member_ids",
                    return_value={"111"},
                ):
                    with patch(
                        "core.sync._set_group_role_permissions",
                        new_callable=AsyncMock,
                    ) as mock_set_perms:
                        mock_set_perms.return_value = {
                            "text": True,
                            "voice": True,
                            "cohort": True,
                        }
                        result = await sync_group_discord_permissions(
                            group_id=1
                        )

    # No set_permissions calls — already in correct state
    mock_voice_channel.set_permissions.assert_not_called()

    # Stats reflect no changes
    assert result["facilitator_granted"] == 0
    assert result["facilitator_revoked"] == 0
```

**Step 4: Run tests to verify they all fail**

Run: `pytest core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_grants_facilitator_connect_on_voice_channel core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_revokes_demoted_facilitator_connect core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_facilitator_sync_is_idempotent -v`
Expected: ALL FAIL — sync_group_discord_permissions does not query facilitators or diff member overwrites

**Step 5: Implement diff-based facilitator voice permission in sync**

In `core/sync.py`, add a new step between Step 3 (role permissions) and Step 4 (get expected members). Insert after line 1270:

```python
    # Step 3b: Sync facilitator member-level connect on voice channel (diff-based)
    facilitator_granted, facilitator_revoked = 0, 0
    if voice_channel:
        # Desired state: facilitator discord_ids from DB
        async with get_connection() as conn:
            from .enums import GroupUserRole
            facilitator_result = await conn.execute(
                select(users.c.discord_id)
                .join(groups_users, users.c.user_id == groups_users.c.user_id)
                .where(groups_users.c.group_id == group_id)
                .where(groups_users.c.status == GroupUserStatus.active)
                .where(groups_users.c.role == GroupUserRole.facilitator)
                .where(users.c.discord_id.isnot(None))
            )
            desired_facilitator_ids = {
                row["discord_id"] for row in facilitator_result.mappings()
            }

        # Current state: members with connect=True overwrite on voice channel
        current_connect_ids = {
            str(target.id)
            for target, perms in voice_channel.overwrites.items()
            if isinstance(target, discord.Member) and perms.connect is True
        }

        # Diff
        to_grant_connect = desired_facilitator_ids - current_connect_ids
        to_revoke_connect = current_connect_ids - desired_facilitator_ids

        guild = role.guild
        for discord_id in to_grant_connect:
            fac_member = await get_or_fetch_member(guild, int(discord_id))
            if fac_member:
                try:
                    await voice_channel.set_permissions(
                        fac_member,
                        connect=True,
                        reason="Facilitator voice access",
                    )
                    facilitator_granted += 1
                except discord.HTTPException as e:
                    logger.error(
                        f"Failed to set facilitator connect for {discord_id}: {e}"
                    )
                    sentry_sdk.capture_exception(e)
                await asyncio.sleep(0.1)

        for discord_id in to_revoke_connect:
            member_to_revoke = await get_or_fetch_member(guild, int(discord_id))
            if member_to_revoke:
                try:
                    await voice_channel.set_permissions(
                        member_to_revoke,
                        overwrite=None,
                        reason="Facilitator voice access removed",
                    )
                    facilitator_revoked += 1
                except discord.HTTPException as e:
                    logger.error(
                        f"Failed to remove facilitator connect for {discord_id}: {e}"
                    )
                    sentry_sdk.capture_exception(e)
                await asyncio.sleep(0.1)
```

Also add `facilitator_granted` and `facilitator_revoked` to the return dict (at the bottom of the function, around line 1333):

```python
    return {
        "granted": granted,
        "revoked": revoked,
        "unchanged": len(unchanged),
        "failed": failed,
        "granted_discord_ids": granted_discord_ids,
        "revoked_discord_ids": revoked_discord_ids,
        "role_status": role_status,
        "cohort_channel_status": cohort_channel_status,
        "facilitator_granted": facilitator_granted,
        "facilitator_revoked": facilitator_revoked,
    }
```

**Step 6: Run tests to verify they pass**

Run: `pytest core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_grants_facilitator_connect_on_voice_channel core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_revokes_demoted_facilitator_connect core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_facilitator_sync_is_idempotent -v`
Expected: ALL PASS

**Step 7: Run all existing sync tests to verify no regressions**

Run: `pytest core/tests/test_sync.py -v`
Expected: All existing tests PASS. The existing test `test_returns_granted_and_revoked_discord_ids` may need its `mock_conn.execute` side_effect updated to include the new facilitator query. If it fails, add a 5th entry to its `side_effect` list:

```python
# Query 5: facilitator query (no facilitators in this test)
mock_facilitator_result = MagicMock()
mock_facilitator_result.mappings.return_value = []
```

And set `mock_voice_channel.overwrites = {}`. Same for `test_returns_error_when_group_has_no_channel` — check if it reaches the facilitator query.

Run: `pytest core/tests/test_sync.py -v`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add core/sync.py core/tests/test_sync.py
git commit -m "feat: diff-based facilitator connect=True on voice channel during sync

Facilitators now get a member-level connect=True overwrite on the group
voice channel during permission sync. Diff-based and self-healing:
- Compares desired facilitators (DB) vs current member overwrites (Discord)
- Only makes API calls for the diff (grant new, revoke demoted)
- Idempotent: second sync run is a no-op
- Demoted facilitators lose their overwrite automatically"
```

---

### Task 2: Remove Facilitator Permission Logic from Breakout Tool

**Files:**
- Modify: `discord_bot/cogs/breakout_cog.py:762-770` (remove facilitator connect grant)
- Modify: `discord_bot/cogs/breakout_cog.py:559-567` (remove facilitator connect cleanup)

**Step 1: Remove facilitator connect=True during breakout creation**

In `discord_bot/cogs/breakout_cog.py`, delete lines 762-770 (the "Allow facilitator to stay in the source channel" block):

```python
            # REMOVE THIS BLOCK:
            # Allow facilitator to stay in the source channel
            try:
                await source_channel.set_permissions(
                    member,
                    connect=True,
                    reason="Facilitator access during breakout",
                )
            except discord.HTTPException:
                pass
```

**Step 2: Remove facilitator overwrite cleanup during collect**

In `discord_bot/cogs/breakout_cog.py`, delete lines 559-567 (the "Remove facilitator's member-level overwrite" block in `_countdown_and_collect`):

```python
            # REMOVE THIS BLOCK:
            # Remove facilitator's member-level overwrite
            facilitator = guild.get_member(session.facilitator_id)
            if facilitator:
                try:
                    await source_channel.set_permissions(
                        facilitator, overwrite=None, reason="Breakout session ended"
                    )
                except discord.HTTPException:
                    pass
```

**Step 3: Verify breakout still works conceptually**

The breakout tool now:
1. Denies connect on group roles (line 747-760) — participants can't rejoin source
2. Facilitator already has member-level connect=True from sync — member overwrite > role overwrite, so facilitator can still connect
3. On collect, restores connect=True on group roles (line 542-557) — participants can rejoin
4. No facilitator overwrite to clean up — sync owns it

**Step 4: Run all tests**

Run: `pytest core/tests/ discord_bot/tests/ -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add discord_bot/cogs/breakout_cog.py
git commit -m "refactor: remove facilitator permission logic from breakout tool

Facilitator member-level connect is now managed by sync, not breakout.
The breakout tool only denies/restores connect on group roles."
```

---

### Task 3: Add Test for Facilitator Overwrite Not Removed by Reset Command

**Files:**
- Test: `discord_bot/tests/test_breakout_cog.py` (create if needed)
- Modify: `discord_bot/cogs/breakout_cog.py:952-964` (update reset-permissions if needed)

**Step 1: Verify reset-permissions behavior**

The `breakout-reset-permissions` command (line 940-985) removes all member-specific overwrites and restores connect=True on locked group roles.

After our changes, facilitators have a permanent member-level `connect=True` overwrite set by sync. The reset command currently removes ALL member overwrites (line 954-964). This is fine for breakout cleanup — sync will re-add the facilitator overwrite on the next sync.

No code changes needed here, but document this behavior.

**Step 2: Commit (documentation only, skip if no changes)**

No commit needed — this is a verification step.

---

### Task 4: Manual Integration Test

**Step 1: Start the dev server**

Run: `PYTHONUNBUFFERED=1 /home/penguin/code/lens-platform/ws1/.venv/bin/python main.py --port 8100`

**Step 2: Trigger sync for a test group**

Use Discord `/sync` or trigger programmatically. Verify:
- Group role permissions set on voice channel (connect=True, view_channel=True, speak=True)
- Facilitator member gets member-level connect=True on voice channel
- Participants do NOT get member-level overwrites

**Step 3: Test breakout flow**

1. Join voice channel as facilitator
2. Have test bots join
3. Run `/breakout`
4. Verify: facilitator can stay in source channel (member overwrite > role deny)
5. Verify: participants moved to breakout rooms
6. Run `/collect`
7. Verify: everyone back, role permissions restored
8. Verify: facilitator member-level connect=True still present (sync owns it)

**Step 4: Test edge case: reset-permissions**

1. Run `/breakout-reset-permissions`
2. Verify: all member overwrites removed (including facilitator's)
3. Run sync again
4. Verify: facilitator member-level connect=True restored by sync
