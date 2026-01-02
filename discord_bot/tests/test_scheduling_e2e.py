"""
End-to-end tests for scheduling commands using real Discord.

These tests:
- Create real Discord channels in the dev server
- Use FakeInteraction to call cog methods directly
- Clean up channels after each test

Run sparingly to avoid rate limits.

Usage:
    pytest discord_bot/tests/test_scheduling_e2e.py -v -s
"""

import pytest
import pytest_asyncio
import discord
import asyncio
import os
from dotenv import load_dotenv
from sqlalchemy import select, delete

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from discord_bot.cogs.groups_cog import GroupsCog
from .fake_interaction import FakeInteraction
from .helpers import (
    create_test_course,
    create_test_cohort,
    create_test_user,
    create_test_group,
)
from core.queries.groups import add_user_to_group
from core.tables import courses, cohorts, users, courses_users, groups, groups_users


# Load environment (.env first, then .env.local overrides)
load_dotenv('.env')
load_dotenv('.env.local', override=True)

# Dev server IDs - set these in .env.local
DEV_GUILD_ID = int(os.getenv("TEST_GUILD_ID", "0"))
TEST_CHANNEL_ID = int(os.getenv("TEST_CHANNEL_ID", "0"))
# Test users (non-admin bots in the dev server)
TEST_USER_ID_1 = os.getenv("TEST_USER_ID_1", "0")
TEST_USER_ID_2 = os.getenv("TEST_USER_ID_2", "0")
# Set E2E_PAUSE=1 to pause before cleanup for manual inspection
E2E_PAUSE = os.getenv("E2E_PAUSE", "0") == "1"


@pytest_asyncio.fixture
async def bot():
    """Create a minimal bot instance for testing."""
    intents = discord.Intents.default()
    intents.guilds = True
    intents.members = True

    bot = discord.Client(intents=intents)

    # Connect to Discord
    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        pytest.skip("DISCORD_BOT_TOKEN not set")

    asyncio.create_task(bot.start(token))

    # Wait for ready
    for _ in range(30):
        if bot.is_ready():
            break
        await asyncio.sleep(0.5)
    else:
        pytest.fail("Bot did not connect in time")

    yield bot

    await bot.close()


@pytest_asyncio.fixture
async def guild(bot):
    """Get the dev guild."""
    if DEV_GUILD_ID == 0:
        pytest.skip("TEST_GUILD_ID not set in .env.local")

    guild = bot.get_guild(DEV_GUILD_ID)
    if not guild:
        pytest.fail(f"Could not find guild {DEV_GUILD_ID}")

    return guild


@pytest_asyncio.fixture
async def test_channel(guild):
    """Get the test output channel."""
    if TEST_CHANNEL_ID == 0:
        pytest.skip("TEST_CHANNEL_ID not set in .env.local")

    channel = guild.get_channel(TEST_CHANNEL_ID)
    if not channel:
        pytest.fail(f"Could not find channel {TEST_CHANNEL_ID}")

    return channel


@pytest_asyncio.fixture
async def cleanup_channels(guild):
    """
    Track and clean up Discord channels and events created during tests.

    Usage:
        async def test_something(cleanup_channels):
            category = await guild.create_category("Test")
            cleanup_channels["channels"].append(category)
            # ... test ...
            # category deleted automatically after test
    """
    created = {
        "channels": [],
        "events": [],
    }
    yield created

    # Cancel scheduled events first
    for event in created["events"]:
        try:
            await event.cancel(reason="E2E test cleanup")
            await asyncio.sleep(0.3)  # Rate limit buffer
        except discord.NotFound:
            pass
        except discord.HTTPException as e:
            print(f"Warning: Could not cancel event {event}: {e}")

    # Cleanup channels in reverse order (channels before categories)
    for channel in reversed(created["channels"]):
        try:
            await channel.delete(reason="E2E test cleanup")
            await asyncio.sleep(0.3)  # Rate limit buffer
        except discord.NotFound:
            pass
        except discord.HTTPException as e:
            print(f"Warning: Could not delete {channel}: {e}")


@pytest_asyncio.fixture
async def committed_db_conn():
    """
    Provide a DB connection that COMMITS data for E2E tests.

    realize_groups uses get_connection() and get_transaction() internally which
    create separate connections, so test data must be committed to be visible.
    This fixture cleans up all created data after the test.

    Usage:
        async def test_something(self, committed_db_conn):
            conn, course_ids, user_ids, cohort_ids, commit = committed_db_conn
            # ... create data ...
            await commit()  # Commit before calling realize_groups
            # ... call cog method ...
    """
    load_dotenv('.env.local')

    from core.database import get_engine, close_engine
    engine = get_engine()

    # Track IDs for cleanup
    created_course_ids = []
    created_user_ids = []
    created_cohort_ids = []

    conn = await engine.connect()
    txn = await conn.begin()

    async def commit():
        """Commit current transaction and start a new one."""
        nonlocal txn
        await txn.commit()
        txn = await conn.begin()

    try:
        yield conn, created_course_ids, created_user_ids, created_cohort_ids, commit
    finally:
        # Rollback any uncommitted changes
        if txn.is_active:
            await txn.rollback()
        await conn.close()

        # Cleanup: delete in reverse dependency order using a new connection
        async with engine.begin() as cleanup_conn:
            for user_id in created_user_ids:
                await cleanup_conn.execute(delete(groups_users).where(groups_users.c.user_id == user_id))
                await cleanup_conn.execute(delete(courses_users).where(courses_users.c.user_id == user_id))
                await cleanup_conn.execute(delete(users).where(users.c.user_id == user_id))

            for cohort_id in created_cohort_ids:
                # Delete groups and their memberships
                group_result = await cleanup_conn.execute(
                    select(groups.c.group_id).where(groups.c.cohort_id == cohort_id)
                )
                group_ids = [row[0] for row in group_result.fetchall()]
                for group_id in group_ids:
                    await cleanup_conn.execute(delete(groups_users).where(groups_users.c.group_id == group_id))
                await cleanup_conn.execute(delete(groups).where(groups.c.cohort_id == cohort_id))
                await cleanup_conn.execute(delete(cohorts).where(cohorts.c.cohort_id == cohort_id))

            for course_id in created_course_ids:
                await cleanup_conn.execute(delete(courses).where(courses.c.course_id == course_id))

        # Close engine so next test gets a fresh one in its event loop
        await close_engine()


class TestRealizeGroupsE2E:
    """E2E tests for /realize-groups command."""

    @pytest.mark.asyncio
    async def test_realize_groups_full_flow(
        self,
        committed_db_conn,
        bot,
        guild,
        test_channel,
        cleanup_channels,
    ):
        """
        Comprehensive E2E test for /realize-groups command.

        Verifies:
        1. Discord category and channels are created
        2. Permissions are set correctly (@everyone can't see)
        3. Channel IDs are saved back to database
        """
        conn, course_ids, user_ids, cohort_ids, commit = committed_db_conn

        # === SETUP ===
        course = await create_test_course(conn, "E2E Test Course")
        course_ids.append(course["course_id"])

        cohort = await create_test_cohort(conn, course["course_id"], "E2E Test Cohort", num_meetings=2)
        cohort_ids.append(cohort["cohort_id"])

        group = await create_test_group(conn, cohort["cohort_id"], "Test Group")
        group_id = group["group_id"]

        # Create two test users (non-admin bots in the dev server)
        if TEST_USER_ID_1 == "0" or TEST_USER_ID_2 == "0":
            pytest.skip("TEST_USER_ID_1 and TEST_USER_ID_2 not set in .env.local")

        user1 = await create_test_user(conn, cohort["cohort_id"], TEST_USER_ID_1)
        user_ids.append(user1["user_id"])
        user2 = await create_test_user(conn, cohort["cohort_id"], TEST_USER_ID_2)
        user_ids.append(user2["user_id"])

        await add_user_to_group(conn, group_id, user1["user_id"])
        await add_user_to_group(conn, group_id, user2["user_id"])
        await commit()

        # === EXECUTE ===
        cog = GroupsCog(bot)
        interaction = FakeInteraction(guild, test_channel)
        await cog.realize_groups.callback(cog, interaction, cohort["cohort_id"])

        # === CLEANUP REGISTRATION (before assertions to avoid orphans) ===
        category_name = "E2E Test Course - E2E Test Cohort"[:100]
        category = discord.utils.get(guild.categories, name=category_name)
        if category:
            cleanup_channels["channels"].append(category)
            for ch in category.channels:
                cleanup_channels["channels"].append(ch)
            # Also register scheduled events for cleanup
            for event in guild.scheduled_events:
                if event.channel_id and any(ch.id == event.channel_id for ch in category.channels):
                    cleanup_channels["events"].append(event)

        # === VERIFY: Category created ===
        assert category is not None, f"Category '{category_name}' not created"

        # === VERIFY: Channels created ===
        text_channel = discord.utils.get(guild.text_channels, name="test-group", category_id=category.id)
        voice_channel = discord.utils.get(guild.voice_channels, name="Test Group Voice", category_id=category.id)

        assert text_channel is not None, "Text channel 'test-group' not created"
        assert voice_channel is not None, "Voice channel 'Test Group Voice' not created"

        # === VERIFY: Permissions set correctly ===
        default_role = guild.default_role

        # Category has @everyone denied
        category_overwrites = category.overwrites
        assert default_role in category_overwrites, "Category: @everyone not in permission overwrites"
        assert category_overwrites[default_role].view_channel == False, "Category: @everyone can still view"

        # Verify @everyone effectively cannot view channels
        # (permissions_for checks inherited + explicit permissions)
        everyone_text_perms = text_channel.permissions_for(default_role)
        everyone_voice_perms = voice_channel.permissions_for(default_role)
        assert not everyone_text_perms.view_channel, "Text channel: @everyone can view"
        assert not everyone_voice_perms.view_channel, "Voice channel: @everyone can view"

        # Verify group members CAN view channels
        for discord_id in [TEST_USER_ID_1, TEST_USER_ID_2]:
            member = await guild.fetch_member(int(discord_id))
            member_text_perms = text_channel.permissions_for(member)
            member_voice_perms = voice_channel.permissions_for(member)
            assert member_text_perms.view_channel, f"Member {discord_id} cannot view text channel"
            assert member_voice_perms.view_channel, f"Member {discord_id} cannot view voice channel"

        # === VERIFY: IDs saved to database ===
        from core.database import get_connection
        async with get_connection() as fresh_conn:
            # Check group channel IDs
            result = await fresh_conn.execute(
                select(groups).where(groups.c.group_id == group_id)
            )
            updated_group = result.mappings().first()

            # Check cohort category ID
            result = await fresh_conn.execute(
                select(cohorts).where(cohorts.c.cohort_id == cohort["cohort_id"])
            )
            updated_cohort = result.mappings().first()

        assert updated_group is not None, f"Group {group_id} not found in database"
        assert updated_group["discord_text_channel_id"] is not None, "Text channel ID not saved to DB"
        assert updated_group["discord_voice_channel_id"] is not None, "Voice channel ID not saved to DB"
        assert updated_group["discord_text_channel_id"].isdigit(), "Text channel ID should be numeric string"
        assert updated_group["discord_voice_channel_id"].isdigit(), "Voice channel ID should be numeric string"

        assert updated_cohort is not None, f"Cohort not found in database"
        assert updated_cohort["discord_category_id"] is not None, "Category ID not saved to cohort"
        assert updated_cohort["discord_category_id"] == str(category.id), "Category ID mismatch"

        # === VERIFY: Scheduled events created ===
        # The test group has meeting time "Monday 09:00-10:00" and num_meetings=2
        # So we expect 2 scheduled events (unless some are in the past)
        scheduled_events = [
            event for event in guild.scheduled_events
            if event.channel_id == voice_channel.id
        ]
        # At least 1 event should be created (some may be skipped if in the past)
        assert len(scheduled_events) >= 1, "No scheduled events created for group"
        # Verify event naming convention
        assert any("Test Group" in event.name for event in scheduled_events), \
            "Scheduled event doesn't have expected group name"

        # === VERIFY: Idempotency (running again doesn't create duplicates) ===
        await cog.realize_groups.callback(cog, interaction, cohort["cohort_id"])

        # Check no duplicate categories
        matching_categories = [c for c in guild.categories if c.name == category_name]
        assert len(matching_categories) == 1, f"Idempotency failed: expected 1 category, found {len(matching_categories)}"

        # Check no duplicate channels
        text_channels = [ch for ch in guild.text_channels
                        if ch.name == "test-group" and ch.category_id == category.id]
        voice_channels = [ch for ch in guild.voice_channels
                         if ch.name == "Test Group Voice" and ch.category_id == category.id]

        assert len(text_channels) == 1, f"Idempotency failed: expected 1 text channel, found {len(text_channels)}"
        assert len(voice_channels) == 1, f"Idempotency failed: expected 1 voice channel, found {len(voice_channels)}"

        # === OPTIONAL PAUSE FOR MANUAL INSPECTION ===
        if E2E_PAUSE:
            import tempfile
            signal_file = Path(tempfile.gettempdir()) / "e2e_continue"
            # Remove signal file if it exists from previous run
            signal_file.unlink(missing_ok=True)

            print("\n" + "=" * 60)
            print("E2E_PAUSE enabled - pausing for manual inspection")
            print(f"Category: {category.name}")
            print(f"Text channel: #{text_channel.name}")
            print(f"Voice channel: {voice_channel.name}")
            print(f"Scheduled events: {len(scheduled_events)}")
            print("=" * 60)
            print(f"To continue, run: touch {signal_file}")
            print("Waiting...")

            # Poll for signal file
            while not signal_file.exists():
                await asyncio.sleep(1)
            signal_file.unlink()
            print("Continuing with cleanup...")
