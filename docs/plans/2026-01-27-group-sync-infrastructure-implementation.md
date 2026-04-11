# Group Sync Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor group realization into `sync_group()` with an `allow_create` flag, making it idempotent and diff-based.

**Architecture:** Extend `sync_group()` with infrastructure creation helpers (`ensure_*` functions). When `allow_create=True`, check/create missing infrastructure before syncing membership. Move notifications inside `sync_group()` based on diff detection.

**Tech Stack:** Python, SQLAlchemy, Discord.py, pytest

**Testing approach:** Unit+1 tests (one-step integration tests) - test functions with their immediate dependencies mocked at the boundary, not every internal call.

---

## Task 1: Update `sync_group_discord_permissions()` to return user IDs

Currently returns counts only. Need user IDs for notification logic.

**Files:**
- Modify: `core/sync.py` (lines 34-166)
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

Add to `core/tests/test_sync.py` in `TestSyncGroupDiscordPermissions`:

```python
@pytest.mark.asyncio
async def test_returns_granted_and_revoked_user_ids(self):
    """Should return lists of user IDs that were granted/revoked access."""
    from core.sync import sync_group_discord_permissions
    import discord

    # Setup: mock DB returns two expected members (discord_ids 111, 222)
    # Discord channel currently has one member (discord_id 333)
    # Expected: grant 111, 222; revoke 333

    mock_conn = AsyncMock()

    # Query 1: get group channels
    mock_group_result = MagicMock()
    mock_group_result.mappings.return_value.first.return_value = {
        "discord_text_channel_id": "123456789",
        "discord_voice_channel_id": "987654321",
    }

    # Query 2: get active members from DB
    mock_members_result = MagicMock()
    mock_members_result.mappings.return_value = [
        {"discord_id": "111"},
        {"discord_id": "222"},
    ]

    mock_conn.execute = AsyncMock(side_effect=[mock_group_result, mock_members_result])

    # Mock Discord channel with existing permission for user 333
    mock_member_333 = MagicMock(spec=discord.Member)
    mock_member_333.id = 333

    mock_perms = MagicMock()
    mock_perms.view_channel = True

    mock_text_channel = MagicMock()
    mock_text_channel.overwrites = {mock_member_333: mock_perms}
    mock_text_channel.guild = MagicMock()

    mock_voice_channel = MagicMock()

    mock_bot = MagicMock()
    mock_bot.get_channel.side_effect = lambda id: {
        123456789: mock_text_channel,
        987654321: mock_voice_channel,
    }.get(id)

    # Mock get_or_fetch_member to return members for grants, None for revoke (left server)
    async def mock_fetch(guild, discord_id):
        if discord_id in [111, 222]:
            m = MagicMock(spec=discord.Member)
            m.id = discord_id
            return m
        return None  # User 333 left server

    with patch("core.sync._bot", mock_bot):
        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            # Patch where it's used (sync.py), not where it's defined
            with patch("core.sync.get_or_fetch_member", side_effect=mock_fetch):
                result = await sync_group_discord_permissions(group_id=1)

    # Verify user ID lists are returned
    assert "granted_user_ids" in result
    assert "revoked_user_ids" in result
    assert set(result["granted_user_ids"]) == {111, 222}
    # 333 was in revoke set but member not found, so not in revoked_user_ids
    assert result["granted"] == 2
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_returns_granted_and_revoked_user_ids -v
```

Expected: FAIL with `KeyError: 'granted_user_ids'`

**Step 3: Update implementation**

In `core/sync.py`, modify `sync_group_discord_permissions()` (around line 108):

Change:
```python
    granted, revoked, failed = 0, 0, 0
```

To:
```python
    granted, revoked, failed = 0, 0, 0
    granted_user_ids = []
    revoked_user_ids = []
```

In the grant loop (around line 135), after `granted += 1`:
```python
            granted += 1
            granted_user_ids.append(int(discord_id))
```

In the revoke loop (around line 155), after `revoked += 1`:
```python
            revoked += 1
            revoked_user_ids.append(int(discord_id))
```

Update the return statement (around line 161):
```python
    return {
        "granted": granted,
        "revoked": revoked,
        "unchanged": len(unchanged),
        "failed": failed,
        "granted_user_ids": granted_user_ids,
        "revoked_user_ids": revoked_user_ids,
    }
```

**Step 4: Run test to verify it passes**

```bash
pytest core/tests/test_sync.py::TestSyncGroupDiscordPermissions::test_returns_granted_and_revoked_user_ids -v
```

Expected: PASS

**Step 5: Run all sync tests to verify no regressions**

```bash
pytest core/tests/test_sync.py -v
```

Expected: All tests pass

**Step 6: Commit**

```bash
jj describe -m "feat(sync): return granted/revoked user IDs from Discord permissions sync

Needed for notification logic - sync_group() will send notifications
based on who was granted/revoked access."
```

---

## Task 2: Add `allow_create` parameter to `sync_group()` (skeleton)

Add the parameter and infrastructure result structure, but no actual creation logic yet.

**Files:**
- Modify: `core/sync.py` (lines 410-480)
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

Add new test class to `core/tests/test_sync.py`:

```python
class TestSyncGroupAllowCreate:
    """Tests for sync_group() with allow_create parameter."""

    @pytest.mark.asyncio
    async def test_allow_create_false_returns_needs_infrastructure_when_no_channels(self):
        """When allow_create=False and group has no channels, should return needs_infrastructure."""
        from core.sync import sync_group

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "status": "preview",
            "discord_text_channel_id": None,
            "discord_voice_channel_id": None,
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await sync_group(group_id=1, allow_create=False)

        assert result.get("needs_infrastructure") is True
        assert "infrastructure" in result

    @pytest.mark.asyncio
    async def test_allow_create_default_is_false(self):
        """Default behavior should be allow_create=False (backwards compatible)."""
        from core.sync import sync_group

        # Mock all sub-syncs to isolate the test
        with (
            patch("core.sync.sync_group_discord_permissions", new_callable=AsyncMock) as mock_discord,
            patch("core.sync.sync_group_calendar", new_callable=AsyncMock) as mock_calendar,
            patch("core.sync.sync_group_reminders", new_callable=AsyncMock) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch("core.sync._get_group_for_sync", new_callable=AsyncMock) as mock_get_group,
        ):
            mock_get_group.return_value = {
                "group_id": 1,
                "status": "active",
                "discord_text_channel_id": "123",
                "discord_voice_channel_id": "456",
                "cohort_id": 1,
            }
            mock_discord.return_value = {"granted": 0, "revoked": 0, "unchanged": 1, "failed": 0, "granted_user_ids": [], "revoked_user_ids": []}
            mock_calendar.return_value = {"meetings": 0, "created": 0, "patched": 0, "unchanged": 0, "failed": 0}
            mock_reminders.return_value = {"meetings": 0}
            mock_rsvps.return_value = {"meetings": 0}

            # Call without allow_create - should work for active group with channels
            result = await sync_group(group_id=1)

            # Should have called sub-syncs (not returned needs_infrastructure)
            mock_discord.assert_called_once()
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestSyncGroupAllowCreate -v
```

Expected: FAIL (parameter doesn't exist, helper function doesn't exist)

**Step 3: Implement the skeleton**

In `core/sync.py`, add helper function before `sync_group()` (around line 408):

```python
async def _get_group_for_sync(group_id: int) -> dict | None:
    """Fetch group data needed for sync decisions."""
    from .database import get_connection
    from .tables import groups
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.status,
                groups.c.discord_text_channel_id,
                groups.c.discord_voice_channel_id,
                groups.c.cohort_id,
            ).where(groups.c.group_id == group_id)
        )
        row = result.mappings().first()
        return dict(row) if row else None
```

Update `sync_group()` signature and add infrastructure check (replace entire function):

```python
async def sync_group(group_id: int, allow_create: bool = False) -> dict[str, Any]:
    """
    Sync all external systems for a group.

    This is the unified sync function that should be called whenever
    group membership changes. It syncs:
    - Discord channel permissions
    - Google Calendar event attendees
    - Meeting reminder jobs
    - RSVP records

    When allow_create=True, also creates missing infrastructure:
    - Discord category (cohort level)
    - Discord text/voice channels
    - Meeting records
    - Discord scheduled events

    Errors are captured in the results dict, not raised. Failed syncs
    are automatically scheduled for retry.

    Args:
        group_id: The group to sync
        allow_create: If True, create missing infrastructure. If False, error if missing.

    Returns:
        Dict with results from each sync operation.
    """
    from .notifications.scheduler import schedule_sync_retry

    results: dict[str, Any] = {
        "infrastructure": {
            "category": {"status": "skipped"},
            "text_channel": {"status": "skipped"},
            "voice_channel": {"status": "skipped"},
            "meetings": {"created": 0, "existed": 0},
            "discord_events": {"created": 0, "existed": 0, "skipped": 0},
        },
    }

    # Get group data
    group = await _get_group_for_sync(group_id)
    if not group:
        return {"error": "group_not_found", **results}

    initial_status = group["status"]
    has_channels = bool(group.get("discord_text_channel_id"))

    # Check if infrastructure is needed
    if not has_channels:
        if not allow_create:
            results["needs_infrastructure"] = True
            return results
        # TODO: Infrastructure creation will be added in later tasks

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

**Step 4: Run tests**

```bash
pytest core/tests/test_sync.py::TestSyncGroupAllowCreate -v
pytest core/tests/test_sync.py::TestSyncGroup -v
```

Expected: All pass

**Step 5: Commit**

```bash
jj describe -m "feat(sync): add allow_create parameter to sync_group()

Skeleton implementation - checks for infrastructure and returns
needs_infrastructure flag when allow_create=False and channels missing.
Actual creation logic to be added in subsequent tasks."
```

---

## Task 3: Implement `ensure_cohort_category()`

Creates Discord category for cohort if missing.

**Files:**
- Modify: `core/sync.py`
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

Add new test class to `core/tests/test_sync.py`:

```python
class TestEnsureCohortCategory:
    """Tests for ensure_cohort_category() helper."""

    @pytest.mark.asyncio
    async def test_returns_existed_when_category_exists_in_db_and_discord(self):
        """When category ID in DB and channel exists in Discord, return existed."""
        from core.sync import _ensure_cohort_category

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "January 2026",
            "course_slug": "aisf",
            "discord_category_id": "999888777",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_category = MagicMock()
        mock_category.id = 999888777

        mock_bot = MagicMock()
        mock_bot.get_channel.return_value = mock_category

        with patch("core.notifications.channels.discord._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await _ensure_cohort_category(cohort_id=1)

        assert result["status"] == "existed"
        assert result["id"] == "999888777"

    @pytest.mark.asyncio
    async def test_returns_channel_missing_when_db_has_id_but_discord_doesnt(self):
        """When category ID in DB but Discord returns None, flag as missing."""
        from core.sync import _ensure_cohort_category

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "cohort_id": 1,
            "cohort_name": "January 2026",
            "course_slug": "aisf",
            "discord_category_id": "999888777",
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_bot = MagicMock()
        mock_bot.get_channel.return_value = None  # Deleted from Discord

        with patch("core.notifications.channels.discord._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await _ensure_cohort_category(cohort_id=1)

        assert result["status"] == "channel_missing"
        assert result["id"] == "999888777"
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestEnsureCohortCategory -v
```

Expected: FAIL with `cannot import name '_ensure_cohort_category'`

**Step 3: Implement the function**

Add to `core/sync.py` before `_get_group_for_sync()`:

```python
async def _ensure_cohort_category(cohort_id: int) -> dict:
    """
    Ensure cohort has a Discord category. Check if exists, create if missing.

    Returns:
        {"status": "existed"|"created"|"channel_missing"|"failed", "id": str|None, "error"?: str}
    """
    from .database import get_connection, get_transaction
    from .notifications.channels.discord import _bot
    from .tables import cohorts
    from .modules.course_loader import load_course
    from sqlalchemy import select, update

    if not _bot:
        return {"status": "failed", "error": "bot_unavailable", "id": None}

    async with get_connection() as conn:
        result = await conn.execute(
            select(
                cohorts.c.cohort_id,
                cohorts.c.cohort_name,
                cohorts.c.course_slug,
                cohorts.c.discord_category_id,
            ).where(cohorts.c.cohort_id == cohort_id)
        )
        cohort = result.mappings().first()

    if not cohort:
        return {"status": "failed", "error": "cohort_not_found", "id": None}

    # Check if category already exists
    if cohort["discord_category_id"]:
        category = _bot.get_channel(int(cohort["discord_category_id"]))
        if category:
            return {"status": "existed", "id": cohort["discord_category_id"]}
        else:
            # DB has ID but Discord doesn't have the channel - flag for review
            return {"status": "channel_missing", "id": cohort["discord_category_id"]}

    # No category ID in DB - need to create
    # Get guild from bot (assumes single guild)
    guilds = list(_bot.guilds)
    if not guilds:
        return {"status": "failed", "error": "no_guild", "id": None}
    guild = guilds[0]

    # Build category name
    course = load_course(cohort["course_slug"])
    category_name = f"{course.title} - {cohort['cohort_name']}"[:100]

    try:
        category = await guild.create_category(
            name=category_name,
            reason=f"Realizing cohort {cohort_id}",
        )
        # Hide from everyone by default
        await category.set_permissions(
            guild.default_role, view_channel=False
        )

        # Save category ID to database
        async with get_transaction() as conn:
            await conn.execute(
                update(cohorts)
                .where(cohorts.c.cohort_id == cohort_id)
                .values(discord_category_id=str(category.id))
            )

        return {"status": "created", "id": str(category.id)}
    except Exception as e:
        logger.error(f"Failed to create category for cohort {cohort_id}: {e}")
        sentry_sdk.capture_exception(e)
        return {"status": "failed", "error": str(e), "id": None}
```

**Step 4: Run tests**

```bash
pytest core/tests/test_sync.py::TestEnsureCohortCategory -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(sync): add _ensure_cohort_category() helper

Creates Discord category for cohort if missing. Returns status indicating
whether category existed, was created, is missing from Discord, or failed."
```

---

## Task 4: Implement `_ensure_group_channels()`

Creates text and voice channels for a group if missing.

**Files:**
- Modify: `core/sync.py`
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

```python
class TestEnsureGroupChannels:
    """Tests for _ensure_group_channels() helper."""

    @pytest.mark.asyncio
    async def test_returns_existed_when_both_channels_exist(self):
        """When both channel IDs in DB and Discord has them, return existed."""
        from core.sync import _ensure_group_channels

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "discord_text_channel_id": "111",
            "discord_voice_channel_id": "222",
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_text = MagicMock()
        mock_text.id = 111
        mock_voice = MagicMock()
        mock_voice.id = 222

        mock_bot = MagicMock()
        mock_bot.get_channel.side_effect = lambda id: {111: mock_text, 222: mock_voice}.get(id)

        with patch("core.notifications.channels.discord._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                result = await _ensure_group_channels(group_id=1, category=MagicMock())

        assert result["text_channel"]["status"] == "existed"
        assert result["voice_channel"]["status"] == "existed"

    @pytest.mark.asyncio
    async def test_creates_missing_voice_channel_when_text_exists(self):
        """When text exists but voice missing, should create voice only."""
        from core.sync import _ensure_group_channels
        import discord

        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "discord_text_channel_id": "111",
            "discord_voice_channel_id": None,
            "cohort_id": 1,
        }
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_text = MagicMock(spec=discord.TextChannel)
        mock_text.id = 111

        mock_new_voice = MagicMock(spec=discord.VoiceChannel)
        mock_new_voice.id = 333

        mock_bot = MagicMock()
        mock_bot.get_channel.side_effect = lambda id: {111: mock_text}.get(id)

        mock_category = MagicMock()
        mock_category.guild = MagicMock()
        mock_category.guild.create_voice_channel = AsyncMock(return_value=mock_new_voice)

        with patch("core.notifications.channels.discord._bot", mock_bot):
            with patch("core.database.get_connection") as mock_get_conn:
                mock_get_conn.return_value.__aenter__.return_value = mock_conn
                with patch("core.database.get_transaction") as mock_get_tx:
                    mock_get_tx.return_value.__aenter__.return_value = mock_conn
                    result = await _ensure_group_channels(group_id=1, category=mock_category)

        assert result["text_channel"]["status"] == "existed"
        assert result["voice_channel"]["status"] == "created"
        assert result["voice_channel"]["id"] == "333"
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestEnsureGroupChannels -v
```

Expected: FAIL

**Step 3: Implement the function**

Add to `core/sync.py`:

```python
async def _ensure_group_channels(group_id: int, category) -> dict:
    """
    Ensure group has text and voice channels. Create if missing.

    Args:
        group_id: The group to check/create channels for
        category: Discord category to create channels in (required for creation)

    Returns:
        {
            "text_channel": {"status": "existed"|"created"|"channel_missing"|"failed", "id": str|None},
            "voice_channel": {"status": "existed"|"created"|"channel_missing"|"failed", "id": str|None},
            "welcome_message_sent": bool,
        }
    """
    from .database import get_connection, get_transaction
    from .notifications.channels.discord import _bot
    from .tables import groups
    from sqlalchemy import select, update

    result = {
        "text_channel": {"status": "skipped", "id": None},
        "voice_channel": {"status": "skipped", "id": None},
        "welcome_message_sent": False,
    }

    if not _bot:
        result["text_channel"] = {"status": "failed", "error": "bot_unavailable", "id": None}
        result["voice_channel"] = {"status": "failed", "error": "bot_unavailable", "id": None}
        return result

    async with get_connection() as conn:
        group_result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.group_name,
                groups.c.discord_text_channel_id,
                groups.c.discord_voice_channel_id,
                groups.c.cohort_id,
            ).where(groups.c.group_id == group_id)
        )
        group = group_result.mappings().first()

    if not group:
        result["text_channel"] = {"status": "failed", "error": "group_not_found", "id": None}
        result["voice_channel"] = {"status": "failed", "error": "group_not_found", "id": None}
        return result

    group_name = group["group_name"]
    text_channel = None
    voice_channel = None
    text_created = False

    # Check/create text channel
    if group["discord_text_channel_id"]:
        text_channel = _bot.get_channel(int(group["discord_text_channel_id"]))
        if text_channel:
            result["text_channel"] = {"status": "existed", "id": group["discord_text_channel_id"]}
        else:
            result["text_channel"] = {"status": "channel_missing", "id": group["discord_text_channel_id"]}
    elif category:
        try:
            text_channel = await category.guild.create_text_channel(
                name=group_name.lower().replace(" ", "-"),
                category=category,
                reason=f"Group channel for {group_name}",
            )
            result["text_channel"] = {"status": "created", "id": str(text_channel.id)}
            text_created = True
        except Exception as e:
            logger.error(f"Failed to create text channel for group {group_id}: {e}")
            sentry_sdk.capture_exception(e)
            result["text_channel"] = {"status": "failed", "error": str(e), "id": None}

    # Check/create voice channel
    if group["discord_voice_channel_id"]:
        voice_channel = _bot.get_channel(int(group["discord_voice_channel_id"]))
        if voice_channel:
            result["voice_channel"] = {"status": "existed", "id": group["discord_voice_channel_id"]}
        else:
            result["voice_channel"] = {"status": "channel_missing", "id": group["discord_voice_channel_id"]}
    elif category:
        try:
            voice_channel = await category.guild.create_voice_channel(
                name=f"{group_name} Voice",
                category=category,
                reason=f"Voice channel for {group_name}",
            )
            result["voice_channel"] = {"status": "created", "id": str(voice_channel.id)}
        except Exception as e:
            logger.error(f"Failed to create voice channel for group {group_id}: {e}")
            sentry_sdk.capture_exception(e)
            result["voice_channel"] = {"status": "failed", "error": str(e), "id": None}

    # Save channel IDs to database if any were created
    text_id = result["text_channel"].get("id") if result["text_channel"]["status"] in ("created", "existed") else None
    voice_id = result["voice_channel"].get("id") if result["voice_channel"]["status"] in ("created", "existed") else None

    if text_id or voice_id:
        update_values = {}
        if text_id and result["text_channel"]["status"] == "created":
            update_values["discord_text_channel_id"] = text_id
        if voice_id and result["voice_channel"]["status"] == "created":
            update_values["discord_voice_channel_id"] = voice_id

        if update_values:
            async with get_transaction() as conn:
                await conn.execute(
                    update(groups)
                    .where(groups.c.group_id == group_id)
                    .values(**update_values)
                )

    # Send welcome message if text channel was just created
    if text_created and text_channel:
        try:
            await _send_channel_welcome_message(text_channel, group_id)
            result["welcome_message_sent"] = True
        except Exception as e:
            logger.error(f"Failed to send welcome message for group {group_id}: {e}")

    return result
```

Also add the welcome message helper:

```python
async def _send_channel_welcome_message(channel, group_id: int) -> None:
    """Send welcome message to newly created group channel."""
    from .database import get_connection
    from .queries.groups import get_group_welcome_data

    async with get_connection() as conn:
        data = await get_group_welcome_data(conn, group_id)

    if not data:
        return

    member_lines = []
    for member in data["members"]:
        discord_id = member.get("discord_id")
        role = member.get("role", "participant")
        role_badge = " (Facilitator)" if role == "facilitator" else ""
        if discord_id:
            member_lines.append(f"- <@{discord_id}>{role_badge}")
        else:
            member_lines.append(f"- {member.get('name', 'Unknown')}{role_badge}")

    meeting_time = data.get("meeting_time_utc", "TBD")

    message = f"""**Welcome to {data["group_name"]}!**

**Course:** {data.get("cohort_name", "AI Safety")}

**Your group:**
{chr(10).join(member_lines)}

**Meeting time (UTC):** {meeting_time}
**Number of meetings:** {data.get("number_of_group_meetings", 8)}

**Getting started:**
1. Introduce yourself!
2. Check your scheduled events
3. Prepare for Week 1

Questions? Ask in this channel. We're here to help each other learn!
"""
    await channel.send(message)
```

**Step 4: Run tests**

```bash
pytest core/tests/test_sync.py::TestEnsureGroupChannels -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(sync): add _ensure_group_channels() helper

Creates text and voice channels for group if missing. Sends welcome
message when creating a new text channel."
```

---

## Task 5: Implement `_ensure_group_meetings()`

Creates meeting records in DB if missing.

**Files:**
- Modify: `core/sync.py`
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

```python
class TestEnsureGroupMeetings:
    """Tests for _ensure_group_meetings() helper."""

    @pytest.mark.asyncio
    async def test_returns_existed_count_when_meetings_exist(self):
        """When meetings already exist in DB, return existed count."""
        from core.sync import _ensure_group_meetings

        mock_conn = AsyncMock()

        # Query 1: get group info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "recurring_meeting_time_utc": "Wednesday 15:00",
            "cohort_id": 1,
        }

        # Query 2: count existing meetings
        mock_count_result = MagicMock()
        mock_count_result.scalar.return_value = 8

        mock_conn.execute = AsyncMock(side_effect=[mock_group_result, mock_count_result])

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await _ensure_group_meetings(group_id=1)

        assert result["existed"] == 8
        assert result["created"] == 0

    @pytest.mark.asyncio
    async def test_creates_meetings_when_none_exist(self):
        """When no meetings exist, should create them."""
        from core.sync import _ensure_group_meetings
        from datetime import date

        mock_conn = AsyncMock()

        # Query 1: get group info
        mock_group_result = MagicMock()
        mock_group_result.mappings.return_value.first.return_value = {
            "group_id": 1,
            "group_name": "Group Alpha",
            "recurring_meeting_time_utc": "Wednesday 15:00",
            "cohort_id": 1,
        }

        # Query 2: count existing meetings = 0
        mock_count_result = MagicMock()
        mock_count_result.scalar.return_value = 0

        # Query 3: get cohort info
        mock_cohort_result = MagicMock()
        mock_cohort_result.mappings.return_value.first.return_value = {
            "cohort_start_date": date(2026, 2, 1),
            "number_of_group_meetings": 8,
        }

        mock_conn.execute = AsyncMock(side_effect=[mock_group_result, mock_count_result, mock_cohort_result])

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            with patch("core.meetings.create_meetings_for_group", new_callable=AsyncMock) as mock_create:
                mock_create.return_value = [1, 2, 3, 4, 5, 6, 7, 8]
                result = await _ensure_group_meetings(group_id=1)

        assert result["created"] == 8
        assert result["existed"] == 0
        mock_create.assert_called_once()
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestEnsureGroupMeetings -v
```

Expected: FAIL

**Step 3: Implement the function**

Add to `core/sync.py`:

```python
async def _ensure_group_meetings(group_id: int) -> dict:
    """
    Ensure meeting records exist for the group. Create if missing.

    Returns:
        {"created": int, "existed": int, "error"?: str}
    """
    from .database import get_connection
    from .tables import groups, meetings, cohorts
    from .meetings import create_meetings_for_group
    from datetime import datetime, timedelta
    from sqlalchemy import select, func
    import pytz

    async with get_connection() as conn:
        # Get group info
        group_result = await conn.execute(
            select(
                groups.c.group_id,
                groups.c.group_name,
                groups.c.recurring_meeting_time_utc,
                groups.c.cohort_id,
                groups.c.discord_voice_channel_id,
            ).where(groups.c.group_id == group_id)
        )
        group = group_result.mappings().first()

        if not group:
            return {"created": 0, "existed": 0, "error": "group_not_found"}

        # Count existing meetings
        count_result = await conn.execute(
            select(func.count()).select_from(meetings).where(meetings.c.group_id == group_id)
        )
        existing_count = count_result.scalar() or 0

        if existing_count > 0:
            return {"created": 0, "existed": existing_count}

        # No meetings - need to create them
        # Get cohort info for start date and meeting count
        cohort_result = await conn.execute(
            select(
                cohorts.c.cohort_start_date,
                cohorts.c.number_of_group_meetings,
            ).where(cohorts.c.cohort_id == group["cohort_id"])
        )
        cohort = cohort_result.mappings().first()

        if not cohort:
            return {"created": 0, "existed": 0, "error": "cohort_not_found"}

    # Parse meeting time to calculate first meeting
    meeting_time_str = group.get("recurring_meeting_time_utc", "")
    if not meeting_time_str or meeting_time_str == "TBD":
        return {"created": 0, "existed": 0, "error": "no_meeting_time"}

    first_meeting = _calculate_first_meeting(
        cohort["cohort_start_date"],
        meeting_time_str,
    )

    if not first_meeting:
        return {"created": 0, "existed": 0, "error": "invalid_meeting_time"}

    num_meetings = cohort.get("number_of_group_meetings", 8)

    # Create meeting records
    try:
        meeting_ids = await create_meetings_for_group(
            group_id=group_id,
            cohort_id=group["cohort_id"],
            group_name=group["group_name"],
            first_meeting=first_meeting,
            num_meetings=num_meetings,
            discord_voice_channel_id=group.get("discord_voice_channel_id") or "",
        )
        return {"created": len(meeting_ids), "existed": 0}
    except Exception as e:
        logger.error(f"Failed to create meetings for group {group_id}: {e}")
        sentry_sdk.capture_exception(e)
        return {"created": 0, "existed": 0, "error": str(e)}


def _calculate_first_meeting(start_date, meeting_time_str: str) -> datetime | None:
    """Calculate first meeting datetime from cohort start date and meeting time string."""
    from datetime import datetime, timedelta
    import pytz

    if isinstance(start_date, str):
        start_date = datetime.fromisoformat(start_date).date()

    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    day_num = None
    hour = None
    minute = 0

    for i, day in enumerate(day_names):
        if day in meeting_time_str:
            day_num = i
            parts = meeting_time_str.split()
            for part in parts:
                if ":" in part:
                    time_parts = part.split(":")
                    hour = int(time_parts[0])
                    minute = int(time_parts[1].split("-")[0])  # Handle "15:00-16:00" format
                    break
            break

    if day_num is None or hour is None:
        return None

    first_meeting = datetime.combine(start_date, datetime.min.time())
    first_meeting = first_meeting.replace(hour=hour, minute=minute, tzinfo=pytz.UTC)

    days_ahead = day_num - first_meeting.weekday()
    if days_ahead < 0:
        days_ahead += 7
    first_meeting += timedelta(days=days_ahead)

    return first_meeting
```

**Step 4: Run tests**

```bash
pytest core/tests/test_sync.py::TestEnsureGroupMeetings -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(sync): add _ensure_group_meetings() helper

Creates meeting records in DB if none exist for the group.
Calculates first meeting from cohort start date and recurring time."
```

---

## Task 6: Implement `_ensure_meeting_discord_events()`

Creates Discord scheduled events for meetings if missing.

**Files:**
- Modify: `core/sync.py`
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

```python
class TestEnsureMeetingDiscordEvents:
    """Tests for _ensure_meeting_discord_events() helper."""

    @pytest.mark.asyncio
    async def test_skips_all_when_no_voice_channel(self):
        """When voice_channel is None, should skip all events."""
        from core.sync import _ensure_meeting_discord_events

        result = await _ensure_meeting_discord_events(group_id=1, voice_channel=None)

        assert result["skipped"] > 0 or result == {"created": 0, "existed": 0, "skipped": 0, "failed": 0}

    @pytest.mark.asyncio
    async def test_returns_existed_when_events_already_have_discord_ids(self):
        """When meetings already have discord_event_id, count as existed."""
        from core.sync import _ensure_meeting_discord_events
        from datetime import datetime, timezone, timedelta

        mock_conn = AsyncMock()
        future_time = datetime.now(timezone.utc) + timedelta(days=7)

        mock_result = MagicMock()
        mock_result.mappings.return_value = [
            {"meeting_id": 1, "discord_event_id": "event123", "scheduled_at": future_time, "meeting_number": 1},
            {"meeting_id": 2, "discord_event_id": "event456", "scheduled_at": future_time + timedelta(weeks=1), "meeting_number": 2},
        ]
        mock_conn.execute = AsyncMock(return_value=mock_result)

        mock_voice = MagicMock()
        mock_voice.guild = MagicMock()

        with patch("core.database.get_connection") as mock_get_conn:
            mock_get_conn.return_value.__aenter__.return_value = mock_conn
            result = await _ensure_meeting_discord_events(group_id=1, voice_channel=mock_voice)

        assert result["existed"] == 2
        assert result["created"] == 0
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestEnsureMeetingDiscordEvents -v
```

Expected: FAIL

**Step 3: Implement the function**

Add to `core/sync.py`:

```python
async def _ensure_meeting_discord_events(group_id: int, voice_channel) -> dict:
    """
    Ensure Discord scheduled events exist for all future meetings.

    Args:
        group_id: The group to create events for
        voice_channel: Discord voice channel for the events (None to skip)

    Returns:
        {"created": int, "existed": int, "skipped": int, "failed": int}
    """
    from .database import get_connection, get_transaction
    from .tables import meetings, groups
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, update
    import discord

    result = {"created": 0, "existed": 0, "skipped": 0, "failed": 0}

    if not voice_channel:
        # Can't create events without voice channel
        return result

    async with get_connection() as conn:
        # Get group name for event titles
        group_result = await conn.execute(
            select(groups.c.group_name).where(groups.c.group_id == group_id)
        )
        group_row = group_result.mappings().first()
        group_name = group_row["group_name"] if group_row else f"Group {group_id}"

        # Get all future meetings
        now = datetime.now(timezone.utc)
        meetings_result = await conn.execute(
            select(
                meetings.c.meeting_id,
                meetings.c.discord_event_id,
                meetings.c.scheduled_at,
                meetings.c.meeting_number,
            )
            .where(meetings.c.group_id == group_id)
            .where(meetings.c.scheduled_at > now)
            .order_by(meetings.c.scheduled_at)
        )
        meeting_rows = list(meetings_result.mappings())

    if not meeting_rows:
        return result

    guild = voice_channel.guild

    for meeting in meeting_rows:
        if meeting["discord_event_id"]:
            result["existed"] += 1
            continue

        # Skip if meeting is in the past (edge case)
        if meeting["scheduled_at"] < datetime.now(timezone.utc):
            result["skipped"] += 1
            continue

        try:
            event = await guild.create_scheduled_event(
                name=f"{group_name} - Week {meeting['meeting_number']}",
                start_time=meeting["scheduled_at"],
                end_time=meeting["scheduled_at"] + timedelta(hours=1),
                channel=voice_channel,
                description=f"Weekly meeting for {group_name}",
                entity_type=discord.EntityType.voice,
                privacy_level=discord.PrivacyLevel.guild_only,
            )

            # Save event ID to database
            async with get_transaction() as conn:
                await conn.execute(
                    update(meetings)
                    .where(meetings.c.meeting_id == meeting["meeting_id"])
                    .values(discord_event_id=str(event.id))
                )

            result["created"] += 1
        except Exception as e:
            logger.error(f"Failed to create event for meeting {meeting['meeting_id']}: {e}")
            sentry_sdk.capture_exception(e)
            result["failed"] += 1

    return result
```

**Step 4: Run tests**

```bash
pytest core/tests/test_sync.py::TestEnsureMeetingDiscordEvents -v
```

Expected: PASS

**Step 5: Commit**

```bash
jj describe -m "feat(sync): add _ensure_meeting_discord_events() helper

Creates Discord scheduled events for meetings that don't have them.
Skips if no voice channel provided."
```

---

## Task 7: Wire up infrastructure creation in `sync_group()`

Connect all the ensure_* functions into sync_group() when allow_create=True.

**Files:**
- Modify: `core/sync.py`
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_allow_create_true_creates_infrastructure(self):
    """When allow_create=True and infrastructure missing, should create it."""
    from core.sync import sync_group

    with (
        patch("core.sync._get_group_for_sync", new_callable=AsyncMock) as mock_get_group,
        patch("core.sync._get_group_member_count", new_callable=AsyncMock) as mock_member_count,
        patch("core.sync._ensure_cohort_category", new_callable=AsyncMock) as mock_category,
        patch("core.sync._ensure_group_channels", new_callable=AsyncMock) as mock_channels,
        patch("core.sync._ensure_group_meetings", new_callable=AsyncMock) as mock_meetings,
        patch("core.sync._ensure_meeting_discord_events", new_callable=AsyncMock) as mock_events,
        patch("core.sync.sync_group_discord_permissions", new_callable=AsyncMock) as mock_discord,
        patch("core.sync.sync_group_calendar", new_callable=AsyncMock) as mock_calendar,
        patch("core.sync.sync_group_reminders", new_callable=AsyncMock) as mock_reminders,
        patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
    ):
        mock_get_group.return_value = {
            "group_id": 1,
            "status": "preview",
            "discord_text_channel_id": None,
            "discord_voice_channel_id": None,
            "cohort_id": 1,
        }
        mock_member_count.return_value = 3  # Has members
        mock_category.return_value = {"status": "created", "id": "cat123"}
        mock_channels.return_value = {
            "text_channel": {"status": "created", "id": "txt123"},
            "voice_channel": {"status": "created", "id": "vox123"},
            "welcome_message_sent": True,
        }
        mock_meetings.return_value = {"created": 8, "existed": 0}
        mock_events.return_value = {"created": 8, "existed": 0, "skipped": 0, "failed": 0}
        mock_discord.return_value = {"granted": 3, "revoked": 0, "unchanged": 0, "failed": 0, "granted_user_ids": [1,2,3], "revoked_user_ids": []}
        mock_calendar.return_value = {"meetings": 8, "created": 8, "patched": 0, "unchanged": 0, "failed": 0}
        mock_reminders.return_value = {"meetings": 8}
        mock_rsvps.return_value = {"meetings": 8}

        result = await sync_group(group_id=1, allow_create=True)

    # Should have called infrastructure creation
    mock_category.assert_called_once()
    mock_channels.assert_called_once()
    mock_meetings.assert_called_once()
    mock_events.assert_called_once()

    # Infrastructure results should be in response
    assert result["infrastructure"]["category"]["status"] == "created"
    assert result["infrastructure"]["text_channel"]["status"] == "created"
```

Add this test to the `TestSyncGroupAllowCreate` class.

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestSyncGroupAllowCreate::test_allow_create_true_creates_infrastructure -v
```

Expected: FAIL

**Step 3: Implement the wiring**

First, add the member count helper:

```python
async def _get_group_member_count(group_id: int) -> int:
    """Get count of active members in a group."""
    from .database import get_connection
    from .tables import groups_users
    from .enums import GroupUserStatus
    from sqlalchemy import select, func

    async with get_connection() as conn:
        result = await conn.execute(
            select(func.count())
            .select_from(groups_users)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == GroupUserStatus.active)
        )
        return result.scalar() or 0
```

Then update `sync_group()` to wire up infrastructure creation. Replace the infrastructure check section:

```python
async def sync_group(group_id: int, allow_create: bool = False) -> dict[str, Any]:
    """..."""  # Keep existing docstring
    from .notifications.scheduler import schedule_sync_retry
    from .notifications.channels.discord import _bot

    results: dict[str, Any] = {
        "infrastructure": {
            "category": {"status": "skipped"},
            "text_channel": {"status": "skipped"},
            "voice_channel": {"status": "skipped"},
            "meetings": {"created": 0, "existed": 0},
            "discord_events": {"created": 0, "existed": 0, "skipped": 0, "failed": 0},
        },
    }

    # Get group data
    group = await _get_group_for_sync(group_id)
    if not group:
        return {"error": "group_not_found", **results}

    initial_status = group["status"]
    has_channels = bool(group.get("discord_text_channel_id"))

    # Check if infrastructure is needed
    if not has_channels:
        if not allow_create:
            results["needs_infrastructure"] = True
            return results

        # Check precondition: group must have members
        member_count = await _get_group_member_count(group_id)
        if member_count == 0:
            results["needs_infrastructure"] = True
            results["error"] = "no_members"
            return results

        # Create infrastructure
        # 1. Ensure cohort category
        category_result = await _ensure_cohort_category(group["cohort_id"])
        results["infrastructure"]["category"] = category_result

        # Get category object for channel creation
        category = None
        if category_result.get("id") and _bot:
            category = _bot.get_channel(int(category_result["id"]))

        # 2. Ensure group channels (needs category)
        if category:
            channels_result = await _ensure_group_channels(group_id, category)
            results["infrastructure"]["text_channel"] = channels_result["text_channel"]
            results["infrastructure"]["voice_channel"] = channels_result["voice_channel"]
            results["infrastructure"]["welcome_message_sent"] = channels_result.get("welcome_message_sent", False)
        else:
            results["infrastructure"]["text_channel"] = {"status": "skipped", "error": "no_category"}
            results["infrastructure"]["voice_channel"] = {"status": "skipped", "error": "no_category"}

        # 3. Ensure meeting records
        meetings_result = await _ensure_group_meetings(group_id)
        results["infrastructure"]["meetings"] = meetings_result

        # 4. Ensure Discord events (needs voice channel)
        voice_channel = None
        voice_id = results["infrastructure"]["voice_channel"].get("id")
        if voice_id and _bot:
            voice_channel = _bot.get_channel(int(voice_id))

        events_result = await _ensure_meeting_discord_events(group_id, voice_channel)
        results["infrastructure"]["discord_events"] = events_result

        # Refresh group data after infrastructure creation
        group = await _get_group_for_sync(group_id)
        has_channels = bool(group.get("discord_text_channel_id"))

    # If still no channels after creation attempt, can't sync
    if not has_channels:
        results["needs_infrastructure"] = True
        return results

    # ... rest of sync logic (Discord permissions, calendar, etc.) stays the same
```

**Step 4: Run tests**

```bash
pytest core/tests/test_sync.py::TestSyncGroupAllowCreate -v
pytest core/tests/test_sync.py::TestSyncGroup -v
```

Expected: All pass

**Step 5: Commit**

```bash
jj describe -m "feat(sync): wire up infrastructure creation in sync_group()

When allow_create=True, creates category, channels, meetings, and
Discord events before syncing permissions."
```

---

## Task 8: Add status transition and notification logic

Transition group from preview to active when fully realized, and send appropriate notifications.

**Key design decision:** Notifications require full context (group_name, meeting_time, member_names, discord_channel_id, etc.). We fetch this data once using the existing `get_group_welcome_data()` query, then pass it through to `_send_sync_notifications()`.

**Files:**
- Modify: `core/sync.py`
- Test: `core/tests/test_sync.py`

**Step 1: Write the failing test**

```python
class TestSyncGroupStatusTransition:
    """Tests for group status transitions in sync_group()."""

    @pytest.mark.asyncio
    async def test_transitions_to_active_when_fully_realized(self):
        """Should set status to active when infrastructure complete and member has access."""
        from core.sync import sync_group

        with (
            patch("core.sync._get_group_for_sync", new_callable=AsyncMock) as mock_get_group,
            patch("core.sync._get_group_member_count", new_callable=AsyncMock) as mock_member_count,
            patch("core.sync._ensure_cohort_category", new_callable=AsyncMock) as mock_category,
            patch("core.sync._ensure_group_channels", new_callable=AsyncMock) as mock_channels,
            patch("core.sync._ensure_group_meetings", new_callable=AsyncMock) as mock_meetings,
            patch("core.sync._ensure_meeting_discord_events", new_callable=AsyncMock) as mock_events,
            patch("core.sync.sync_group_discord_permissions", new_callable=AsyncMock) as mock_discord,
            patch("core.sync.sync_group_calendar", new_callable=AsyncMock) as mock_calendar,
            patch("core.sync.sync_group_reminders", new_callable=AsyncMock) as mock_reminders,
            patch("core.sync.sync_group_rsvps", new_callable=AsyncMock) as mock_rsvps,
            patch("core.sync._update_group_status", new_callable=AsyncMock) as mock_update_status,
            patch("core.sync._send_sync_notifications", new_callable=AsyncMock) as mock_notify,
            patch("core.sync._get_notification_context", new_callable=AsyncMock) as mock_context,
            patch("core.notifications.channels.discord._bot") as mock_bot,
        ):
            # First call returns preview, second call (after infra) returns with channels
            mock_get_group.side_effect = [
                {"group_id": 1, "status": "preview", "discord_text_channel_id": None, "discord_voice_channel_id": None, "cohort_id": 1},
                {"group_id": 1, "status": "preview", "discord_text_channel_id": "123", "discord_voice_channel_id": "456", "cohort_id": 1},
            ]
            mock_member_count.return_value = 2
            mock_category.return_value = {"status": "created", "id": "cat123"}
            mock_channels.return_value = {"text_channel": {"status": "created", "id": "123"}, "voice_channel": {"status": "created", "id": "456"}, "welcome_message_sent": True}
            mock_meetings.return_value = {"created": 8, "existed": 0}
            mock_events.return_value = {"created": 8, "existed": 0, "skipped": 0, "failed": 0}
            mock_discord.return_value = {"granted": 2, "revoked": 0, "unchanged": 0, "failed": 0, "granted_user_ids": [1, 2], "revoked_user_ids": []}
            mock_calendar.return_value = {"meetings": 8, "created": 8, "patched": 0, "unchanged": 0, "failed": 0}
            mock_reminders.return_value = {"meetings": 8}
            mock_rsvps.return_value = {"meetings": 8}
            mock_bot.get_channel.return_value = MagicMock()
            mock_context.return_value = {
                "group_name": "Test Group",
                "meeting_time_utc": "Wednesday 15:00",
                "discord_channel_id": "123",
                "members": [{"name": "Alice", "discord_id": "111"}, {"name": "Bob", "discord_id": "222"}],
            }

            result = await sync_group(group_id=1, allow_create=True)

        # Should have transitioned to active
        mock_update_status.assert_called_once_with(1, "active")

        # Should have sent notifications with is_initial_realization=True
        mock_notify.assert_called_once()
        call_kwargs = mock_notify.call_args.kwargs
        assert call_kwargs["is_initial_realization"] is True
```

**Step 2: Run test to verify it fails**

```bash
pytest core/tests/test_sync.py::TestSyncGroupStatusTransition -v
```

Expected: FAIL

**Step 3: Implement status transition and notifications**

Add helper functions:

```python
def _is_fully_realized(infrastructure: dict, discord_result: dict) -> bool:
    """Check if group is fully realized and ready to be active."""
    required = ["category", "text_channel", "voice_channel"]
    for key in required:
        info = infrastructure.get(key, {})
        if info.get("status") not in ("existed", "created"):
            return False

    meetings = infrastructure.get("meetings", {})
    if meetings.get("created", 0) + meetings.get("existed", 0) == 0:
        return False

    # At least one member must have access
    granted = discord_result.get("granted", 0)
    unchanged = discord_result.get("unchanged", 0)
    if granted + unchanged == 0:
        return False

    return True


async def _update_group_status(group_id: int, status: str) -> None:
    """Update group status in database."""
    from .database import get_transaction
    from .tables import groups
    from .enums import GroupStatus
    from datetime import datetime, timezone
    from sqlalchemy import update

    status_enum = GroupStatus(status)
    async with get_transaction() as conn:
        await conn.execute(
            update(groups)
            .where(groups.c.group_id == group_id)
            .values(status=status_enum, updated_at=datetime.now(timezone.utc))
        )


async def _get_notification_context(group_id: int, discord_channel_id: str | None = None) -> dict:
    """
    Fetch all data needed for notifications.

    Returns:
        {
            "group_name": str,
            "meeting_time_utc": str,
            "discord_channel_id": str,
            "members": [{"name": str, "discord_id": str, "user_id": int}, ...],
            "member_names": [str, ...],
        }
    """
    from .database import get_connection
    from .queries.groups import get_group_welcome_data
    from .tables import groups, users, groups_users
    from sqlalchemy import select

    async with get_connection() as conn:
        # Get group welcome data (has most of what we need)
        welcome_data = await get_group_welcome_data(conn, group_id)

        if not welcome_data:
            return {}

        # Also need user_ids for the granted users
        # Get user_id -> discord_id mapping for members
        member_query = (
            select(
                users.c.user_id,
                users.c.discord_id,
                users.c.nickname,
                users.c.discord_username,
            )
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_id)
            .where(groups_users.c.status == "active")
        )
        result = await conn.execute(member_query)
        member_rows = list(result.mappings())

        # If no discord_channel_id provided, try to get from DB
        if not discord_channel_id:
            channel_result = await conn.execute(
                select(groups.c.discord_text_channel_id)
                .where(groups.c.group_id == group_id)
            )
            row = channel_result.scalar()
            discord_channel_id = row or ""

    # Build member list with user_ids
    members_with_ids = []
    for row in member_rows:
        members_with_ids.append({
            "user_id": row["user_id"],
            "discord_id": row["discord_id"],
            "name": row.get("nickname") or row.get("discord_username") or "Unknown",
        })

    return {
        "group_name": welcome_data["group_name"],
        "meeting_time_utc": welcome_data.get("meeting_time_utc", "TBD"),
        "discord_channel_id": discord_channel_id,
        "members": members_with_ids,
        "member_names": [m["name"] for m in members_with_ids],
    }


async def _send_sync_notifications(
    group_id: int,
    granted_user_ids: list[int],
    revoked_user_ids: list[int],
    is_initial_realization: bool,
    notification_context: dict,
) -> dict:
    """
    Send notifications based on sync results.

    Args:
        group_id: The group being synced
        granted_user_ids: User IDs (DB user_ids) who were granted access
        revoked_user_ids: User IDs who were revoked access
        is_initial_realization: True if this is the group's first realization
        notification_context: Dict with group_name, meeting_time_utc, discord_channel_id, members
    """
    from .notifications.dispatcher import was_notification_sent
    from .notifications.actions import notify_group_assigned, notify_member_joined
    from .notifications.channels.discord import send_discord_channel_message
    from .enums import NotificationReferenceType

    result = {"sent": 0, "skipped": 0, "channel_announcements": 0}

    if not notification_context:
        logger.warning(f"No notification context for group {group_id}, skipping notifications")
        return result

    group_name = notification_context.get("group_name", "Unknown Group")
    meeting_time_utc = notification_context.get("meeting_time_utc", "TBD")
    discord_channel_id = notification_context.get("discord_channel_id", "")
    member_names = notification_context.get("member_names", [])
    members_by_user_id = {m["user_id"]: m for m in notification_context.get("members", [])}

    for user_id in granted_user_ids:
        already_notified = await was_notification_sent(
            user_id=user_id,
            message_type="group_assigned",
            reference_type=NotificationReferenceType.group_id,
            reference_id=group_id,
        )

        if already_notified:
            result["skipped"] += 1
            continue

        member_info = members_by_user_id.get(user_id, {})
        discord_user_id = member_info.get("discord_id", "")

        try:
            if is_initial_realization:
                # Long welcome message for initial realization
                await notify_group_assigned(
                    user_id=user_id,
                    group_name=group_name,
                    meeting_time_utc=meeting_time_utc,
                    member_names=member_names,
                    discord_channel_id=discord_channel_id,
                    reference_type=NotificationReferenceType.group_id,
                    reference_id=group_id,
                )
            else:
                # Short "you joined" message for late join (DM to user)
                await notify_member_joined(
                    user_id=user_id,
                    group_name=group_name,
                    meeting_time_utc=meeting_time_utc,
                    member_names=member_names,
                    discord_channel_id=discord_channel_id,
                    discord_user_id=discord_user_id,
                )

                # Also send channel announcement for late joins
                if discord_channel_id and discord_user_id:
                    try:
                        user_name = member_info.get("name", "Someone")
                        await send_discord_channel_message(
                            channel_id=discord_channel_id,
                            message=f"**Welcome {user_name}!** <@{discord_user_id}> has joined the group.",
                        )
                        result["channel_announcements"] += 1
                    except Exception as e:
                        logger.warning(f"Failed to send channel announcement for user {user_id}: {e}")

            result["sent"] += 1
        except Exception as e:
            logger.error(f"Failed to send notification to user {user_id}: {e}")
            sentry_sdk.capture_exception(e)

    return result
```

Then update the end of `sync_group()` to add status transition and notifications:

```python
    # ... after all sync operations ...

    # Check if we should transition to active
    transitioned_to_active = False
    if initial_status == "preview" and allow_create:
        if _is_fully_realized(results["infrastructure"], results.get("discord", {})):
            await _update_group_status(group_id, "active")
            transitioned_to_active = True

    # Send notifications
    discord_result = results.get("discord", {})
    granted_user_ids = discord_result.get("granted_user_ids", [])
    revoked_user_ids = discord_result.get("revoked_user_ids", [])

    if granted_user_ids:
        # Get channel ID from infrastructure result or group data
        text_channel_id = results["infrastructure"].get("text_channel", {}).get("id")
        if not text_channel_id:
            refreshed_group = await _get_group_for_sync(group_id)
            text_channel_id = refreshed_group.get("discord_text_channel_id") if refreshed_group else None

        # Fetch notification context
        notification_context = await _get_notification_context(group_id, text_channel_id)

        results["notifications"] = await _send_sync_notifications(
            group_id=group_id,
            granted_user_ids=granted_user_ids,
            revoked_user_ids=revoked_user_ids,
            is_initial_realization=transitioned_to_active,
            notification_context=notification_context,
        )

    return results
```

**Step 4: Run tests**

```bash
pytest core/tests/test_sync.py::TestSyncGroupStatusTransition -v
pytest core/tests/test_sync.py -v
```

Expected: All pass

**Step 5: Commit**

```bash
jj describe -m "feat(sync): add status transition and notification logic

Transitions group from preview to active when fully realized.
Sends appropriate notifications (initial realization vs late join).
Late joins also get a channel announcement welcoming the new member."
```

---

## Task 9: Simplify `sync_after_group_change()`

Remove notification logic since it's now in sync_group().

**Files:**
- Modify: `core/sync.py` (lines 483-577)
- Test: `core/tests/test_sync.py`

**Step 1: Update the function**

Replace `sync_after_group_change()` with simplified version:

```python
async def sync_after_group_change(
    group_id: int,
    previous_group_id: int | None = None,
    user_id: int | None = None,  # Kept for backwards compatibility but not used
) -> dict[str, Any]:
    """
    Sync external systems after a group membership change.

    Call this AFTER the database transaction is committed.
    Syncs both the new group and the previous group (if switching).

    Notifications are handled inside sync_group() based on diff detection.

    Args:
        group_id: The group the user joined
        previous_group_id: The group the user left (if switching)
        user_id: Deprecated - kept for backwards compatibility

    Returns:
        Dict with results for new group (and old group if switching):
        {
            "new_group": {...},
            "old_group": {...} | None,
        }
    """
    results: dict[str, Any] = {
        "new_group": None,
        "old_group": None,
    }

    # Sync old group first (if switching) - revokes permissions, removes from calendar
    if previous_group_id:
        logger.info(f"Syncing old group {previous_group_id} after membership change")
        results["old_group"] = await sync_group(previous_group_id, allow_create=False)

    # Sync new group - grants permissions, adds to calendar
    logger.info(f"Syncing new group {group_id} after membership change")
    results["new_group"] = await sync_group(group_id, allow_create=False)

    return results
```

**Step 2: Update tests**

Update `TestSyncAfterGroupChange` tests to reflect the new behavior (notifications now in sync_group).

**Step 3: Run tests**

```bash
pytest core/tests/test_sync.py::TestSyncAfterGroupChange -v
pytest core/tests/test_sync.py -v
```

**Step 4: Commit**

```bash
jj describe -m "refactor(sync): simplify sync_after_group_change()

Notifications are now handled inside sync_group() based on diff
detection, so this function just orchestrates syncing old/new groups."
```

---

## Task 10: Update Discord cog to use new API

Rename command and simplify implementation.

**Files:**
- Modify: `discord_bot/cogs/groups_cog.py`
- Test: Manual testing (Discord commands)

**Step 1: Rename command and simplify**

Update `groups_cog.py`:

1. Rename `realize_groups` to `realize_cohort`
2. Remove infrastructure creation code (now in sync_group)
3. Call `sync_group(group_id, allow_create=True)` for each preview group

```python
@app_commands.command(
    name="realize-cohort",
    description="Create Discord channels for a cohort's groups",
)
@app_commands.default_permissions(administrator=True)
@app_commands.checks.has_permissions(administrator=True)
@app_commands.describe(cohort="The cohort to create Discord channels for")
@app_commands.autocomplete(cohort=cohort_autocomplete)
async def realize_cohort(
    self,
    interaction: discord.Interaction,
    cohort: int,
):
    """Create Discord category, channels, events, and welcome messages for cohort groups."""
    await interaction.response.defer()

    progress_msg = await interaction.followup.send(
        "Loading cohort data...", ephemeral=False
    )

    # Get cohort groups data
    async with get_connection() as conn:
        cohort_data = await get_cohort_groups_for_realization(conn, cohort)

    if not cohort_data:
        await progress_msg.edit(content="Cohort not found!")
        return

    if not cohort_data["groups"]:
        await progress_msg.edit(
            content="No groups found for this cohort. Run /schedule first."
        )
        return

    # Process each preview group
    created_count = 0
    failed_count = 0
    results = []

    for group_data in cohort_data["groups"]:
        if group_data.get("status") != "preview":
            continue

        group_name = group_data["group_name"]
        group_id = group_data["group_id"]

        await progress_msg.edit(content=f"Processing {group_name}...")

        try:
            result = await sync_group(group_id, allow_create=True)
            results.append({"group": group_name, "result": result})

            if result.get("error") or result.get("needs_infrastructure"):
                failed_count += 1
            else:
                created_count += 1
        except Exception as e:
            logger.error(f"Failed to realize group {group_id}: {e}")
            failed_count += 1
            results.append({"group": group_name, "error": str(e)})

    # Summary
    color = discord.Color.green() if failed_count == 0 else discord.Color.orange()
    embed = discord.Embed(
        title=f"Cohort Realized: {cohort_data['cohort_name']}",
        color=color,
    )
    summary = f"**Groups processed:** {created_count + failed_count}\n**Successful:** {created_count}"
    if failed_count > 0:
        summary += f"\n**Failed:** {failed_count}"
    embed.add_field(name="Summary", value=summary, inline=False)
    embed.set_footer(text="Members not in the guild will get access automatically when they join.")

    await progress_msg.edit(content=None, embed=embed)
```

**Step 2: Remove unused methods**

Remove `_sync_group_lifecycle`, `_create_scheduled_events`, `_send_welcome_message` as they're now in core/sync.py.

Keep `_grant_channel_permissions` for the `on_member_join` event handler.

**Step 3: Run linting**

```bash
ruff check discord_bot/cogs/groups_cog.py
ruff format discord_bot/cogs/groups_cog.py
```

**Step 4: Commit**

```bash
jj describe -m "refactor(discord): use sync_group(allow_create=True) in realize-cohort

Renames /realize-groups to /realize-cohort.
Moves all infrastructure creation logic to core/sync.py.
Command now just loops through preview groups and calls sync_group()."
```

---

## Task 11: Final verification and cleanup

**Step 1: Run all tests**

```bash
pytest
```

**Step 2: Run linting**

```bash
ruff check .
ruff format --check .
```

**Step 3: Manual testing checklist**

- [ ] Start dev server: `python main.py --dev`
- [ ] Test `/realize-cohort` with a test cohort
- [ ] Verify channels are created
- [ ] Verify welcome messages are sent
- [ ] Verify permissions are granted
- [ ] Test joining a group via web API
- [ ] Verify late join notifications work

**Step 4: Final commit**

```bash
jj describe -m "feat: complete group sync infrastructure refactor

- sync_group() now supports allow_create=True for infrastructure creation
- Idempotent fill-in of missing infrastructure
- Notifications handled inside sync based on diff detection
- Status transitions from preview to active when fully realized
- /realize-groups renamed to /realize-cohort"
```

---

## Summary of Changes

| File | Changes |
|------|---------|
| `core/sync.py` | Add `allow_create` param, `ensure_*` helpers, notification logic |
| `core/tests/test_sync.py` | Add tests for new functionality |
| `discord_bot/cogs/groups_cog.py` | Rename command, simplify to use `sync_group()` |

**New functions in `core/sync.py`:**
- `_get_group_for_sync()`
- `_get_group_member_count()`
- `_ensure_cohort_category()`
- `_ensure_group_channels()`
- `_ensure_group_meetings()`
- `_ensure_meeting_discord_events()`
- `_is_fully_realized()`
- `_update_group_status()`
- `_send_sync_notifications()`
- `_send_channel_welcome_message()`
- `_calculate_first_meeting()`
