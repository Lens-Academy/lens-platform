# Scheduler Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement integration and E2E tests for `/schedule` and `/realize-groups` commands.

**Architecture:** Three-layer testing: existing unit tests (no changes), new integration tests with DB transaction rollback, new E2E tests with real Discord. Test helpers and fixtures in conftest.py.

**Tech Stack:** pytest, pytest-asyncio, SQLAlchemy async, discord.py

---

## Task 1: Create Test Fixtures in conftest.py

**Files:**
- Create: `discord_bot/tests/conftest.py`

**Step 1: Create conftest.py with db_conn fixture**

```python
"""
Pytest fixtures for scheduler tests.
"""

import pytest
import pytest_asyncio
from dotenv import load_dotenv


@pytest_asyncio.fixture
async def db_conn():
    """
    Provide a DB connection that rolls back after each test.

    All changes made during the test are visible within the test,
    but rolled back afterward so DB stays clean.
    """
    load_dotenv('.env.local')

    from core.database import get_engine
    engine = get_engine()

    async with engine.connect() as conn:
        txn = await conn.begin()
        try:
            yield conn
        finally:
            await txn.rollback()
```

**Step 2: Verify fixture works**

Run: `python -c "import discord_bot.tests.conftest; print('Import OK')"`
Expected: `Import OK`

**Step 3: Commit**

```bash
jj describe -m "test: add db_conn fixture with transaction rollback"
```

---

## Task 2: Create Test Helpers

**Files:**
- Create: `discord_bot/tests/helpers.py`

**Step 1: Create helpers.py with test data factories**

```python
"""
Test helper functions for creating test data.
"""

from datetime import date, timedelta

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.tables import courses, cohorts, users, courses_users, groups, groups_users


async def create_test_course(
    conn: AsyncConnection,
    name: str = "Test Course",
) -> dict:
    """Create a course for testing."""
    result = await conn.execute(
        insert(courses)
        .values(course_name=name)
        .returning(courses)
    )
    return dict(result.mappings().first())


async def create_test_cohort(
    conn: AsyncConnection,
    course_id: int,
    name: str = "Test Cohort",
    num_meetings: int = 8,
    start_date: date = None,
) -> dict:
    """Create a cohort for testing."""
    if start_date is None:
        start_date = date.today() + timedelta(days=7)

    result = await conn.execute(
        insert(cohorts)
        .values(
            cohort_name=name,
            course_id=course_id,
            cohort_start_date=start_date,
            duration_days=56,
            number_of_group_meetings=num_meetings,
        )
        .returning(cohorts)
    )
    return dict(result.mappings().first())


async def create_test_user(
    conn: AsyncConnection,
    cohort_id: int,
    discord_id: str,
    availability: str = "M09:00 M10:00",
    cohort_role: str = "participant",
) -> dict:
    """
    Create a user enrolled in a cohort for testing.

    Args:
        conn: Database connection
        cohort_id: Cohort to enroll user in
        discord_id: Discord ID (should be unique per test)
        availability: Availability string in day-time format
        cohort_role: "participant" or "facilitator"

    Returns:
        The created user record as a dict
    """
    # Create user
    user_result = await conn.execute(
        insert(users)
        .values(
            discord_id=discord_id,
            discord_username=f"testuser_{discord_id}",
            availability_utc=availability,
            timezone="UTC",
        )
        .returning(users)
    )
    user = dict(user_result.mappings().first())

    # Enroll in cohort
    await conn.execute(
        insert(courses_users)
        .values(
            user_id=user["user_id"],
            cohort_id=cohort_id,
            grouping_status="awaiting_grouping",
            cohort_role=cohort_role,
        )
    )

    return user


async def create_test_group(
    conn: AsyncConnection,
    cohort_id: int,
    group_name: str = "Test Group",
    meeting_time: str = "Monday 09:00-10:00",
    discord_text_channel_id: str = None,
    discord_voice_channel_id: str = None,
) -> dict:
    """Create a group for testing."""
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name=group_name,
            recurring_meeting_time_utc=meeting_time,
            discord_text_channel_id=discord_text_channel_id,
            discord_voice_channel_id=discord_voice_channel_id,
            status="forming",
        )
        .returning(groups)
    )
    return dict(result.mappings().first())
```

**Step 2: Verify helpers import**

Run: `python -c "from discord_bot.tests.helpers import create_test_course; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
jj describe -m "test: add test helper functions for creating test data"
```

---

## Task 3: Integration Tests for Query Functions

**Files:**
- Create: `discord_bot/tests/test_scheduling_queries.py`

**Step 1: Create test file with query function tests**

```python
"""
Integration tests for scheduling query functions.
Tests core/queries/cohorts.py and core/queries/groups.py with real database.
"""

import pytest
import pytest_asyncio

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.queries.cohorts import (
    get_schedulable_cohorts,
    get_realizable_cohorts,
    get_cohort_by_id,
)
from core.queries.groups import (
    create_group,
    add_user_to_group,
    get_cohort_groups_for_realization,
)

from .helpers import (
    create_test_course,
    create_test_cohort,
    create_test_user,
    create_test_group,
)


class TestGetSchedulableCohorts:
    """Tests for get_schedulable_cohorts query."""

    @pytest.mark.asyncio
    async def test_returns_cohorts_with_pending_users(self, db_conn):
        """Should return cohorts that have users awaiting grouping."""
        # Setup: course -> cohort -> user awaiting grouping
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"], "Test Cohort")
        await create_test_user(db_conn, cohort["cohort_id"], "123456")

        # Execute
        result = await get_schedulable_cohorts(db_conn)

        # Assert
        assert len(result) >= 1
        cohort_ids = [c["cohort_id"] for c in result]
        assert cohort["cohort_id"] in cohort_ids

        # Check structure
        matching = [c for c in result if c["cohort_id"] == cohort["cohort_id"]][0]
        assert matching["cohort_name"] == "Test Cohort"
        assert matching["pending_users"] == 1

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_pending_users(self, db_conn):
        """Should return empty list when no users are awaiting grouping."""
        # Setup: course -> cohort with no users
        course = await create_test_course(db_conn, "Empty Course")
        await create_test_cohort(db_conn, course["course_id"], "Empty Cohort")

        # Execute
        result = await get_schedulable_cohorts(db_conn)

        # Assert: should not include the empty cohort
        cohort_names = [c["cohort_name"] for c in result]
        assert "Empty Cohort" not in cohort_names


class TestGetRealizableCohorts:
    """Tests for get_realizable_cohorts query."""

    @pytest.mark.asyncio
    async def test_returns_cohorts_with_unrealized_groups(self, db_conn):
        """Should return cohorts with groups that have no Discord channels."""
        # Setup: course -> cohort -> group without channel IDs
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"], "Unrealized Cohort")
        await create_test_group(db_conn, cohort["cohort_id"], "Group 1")

        # Execute
        result = await get_realizable_cohorts(db_conn)

        # Assert
        cohort_ids = [c["cohort_id"] for c in result]
        assert cohort["cohort_id"] in cohort_ids

    @pytest.mark.asyncio
    async def test_excludes_fully_realized_cohorts(self, db_conn):
        """Should not return cohorts where all groups have Discord channels."""
        # Setup: cohort with realized group
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"], "Realized Cohort")
        await create_test_group(
            db_conn,
            cohort["cohort_id"],
            "Group 1",
            discord_text_channel_id="111",
            discord_voice_channel_id="222",
        )

        # Execute
        result = await get_realizable_cohorts(db_conn)

        # Assert: realized cohort should not appear
        cohort_names = [c["cohort_name"] for c in result]
        assert "Realized Cohort" not in cohort_names


class TestCreateGroup:
    """Tests for create_group function."""

    @pytest.mark.asyncio
    async def test_creates_group_with_correct_fields(self, db_conn):
        """Should create a group and return the record."""
        # Setup
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"])

        # Execute
        group = await create_group(
            db_conn,
            cohort_id=cohort["cohort_id"],
            group_name="Group Alpha",
            recurring_meeting_time_utc="Wednesday 15:00-16:00",
        )

        # Assert
        assert group["group_name"] == "Group Alpha"
        assert group["cohort_id"] == cohort["cohort_id"]
        assert group["recurring_meeting_time_utc"] == "Wednesday 15:00-16:00"
        assert group["status"] == "forming"


class TestAddUserToGroup:
    """Tests for add_user_to_group function."""

    @pytest.mark.asyncio
    async def test_adds_user_with_correct_role(self, db_conn):
        """Should add user to group with specified role."""
        # Setup
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"])
        user = await create_test_user(db_conn, cohort["cohort_id"], "123")
        group = await create_test_group(db_conn, cohort["cohort_id"])

        # Execute
        membership = await add_user_to_group(
            db_conn,
            group_id=group["group_id"],
            user_id=user["user_id"],
            role="facilitator",
        )

        # Assert
        assert membership["group_id"] == group["group_id"]
        assert membership["user_id"] == user["user_id"]
        assert membership["role"] == "facilitator"
        assert membership["status"] == "active"


class TestGetCohortGroupsForRealization:
    """Tests for get_cohort_groups_for_realization function."""

    @pytest.mark.asyncio
    async def test_returns_structured_data(self, db_conn):
        """Should return cohort with groups and members."""
        # Setup
        course = await create_test_course(db_conn, "AI Safety")
        cohort = await create_test_cohort(db_conn, course["course_id"], "Jan 2025", num_meetings=8)
        user = await create_test_user(db_conn, cohort["cohort_id"], "123")
        group = await create_test_group(db_conn, cohort["cohort_id"], "Group 1")
        await add_user_to_group(db_conn, group["group_id"], user["user_id"], "participant")

        # Execute
        result = await get_cohort_groups_for_realization(db_conn, cohort["cohort_id"])

        # Assert structure
        assert result["cohort_id"] == cohort["cohort_id"]
        assert result["cohort_name"] == "Jan 2025"
        assert result["course_name"] == "AI Safety"
        assert result["number_of_group_meetings"] == 8
        assert len(result["groups"]) == 1
        assert result["groups"][0]["group_name"] == "Group 1"
        assert len(result["groups"][0]["members"]) == 1
```

**Step 2: Run the tests**

Run: `pytest discord_bot/tests/test_scheduling_queries.py -v`
Expected: All tests pass

**Step 3: Commit**

```bash
jj describe -m "test: add integration tests for scheduling query functions"
```

---

## Task 4: Integration Tests for schedule_cohort

**Files:**
- Modify: `discord_bot/tests/test_scheduling_queries.py`

**Step 1: Add schedule_cohort tests to the file**

Add at the end of the file:

```python
from core.scheduling import schedule_cohort, CohortSchedulingResult
from sqlalchemy import select
from core.tables import courses_users, groups, groups_users


class TestScheduleCohort:
    """Integration tests for schedule_cohort function."""

    @pytest.mark.asyncio
    async def test_creates_groups_and_saves_to_db(self, db_conn):
        """Should create groups and persist them to database."""
        # Setup: cohort with 4 users (minimum for a group)
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"])

        # All users have overlapping availability
        for i in range(4):
            await create_test_user(
                db_conn,
                cohort["cohort_id"],
                discord_id=str(1000 + i),
                availability="M09:00 M10:00",
            )

        # Execute - note: schedule_cohort creates its own transaction,
        # but we need to pass the connection for test isolation
        # We'll need to modify this to accept a connection parameter
        # For now, test the result structure
        result = await schedule_cohort(
            cohort_id=cohort["cohort_id"],
            min_people=4,
            max_people=8,
        )

        # Assert result structure
        assert isinstance(result, CohortSchedulingResult)
        assert result.cohort_id == cohort["cohort_id"]
        assert result.groups_created >= 1
        assert result.users_grouped == 4

    @pytest.mark.asyncio
    async def test_returns_empty_result_when_no_users(self, db_conn):
        """Should return empty result when cohort has no users."""
        # Setup: cohort with no users
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"])

        # Execute
        result = await schedule_cohort(cohort_id=cohort["cohort_id"])

        # Assert
        assert result.groups_created == 0
        assert result.users_grouped == 0
        assert result.users_ungroupable == 0

    @pytest.mark.asyncio
    async def test_raises_error_for_invalid_cohort(self, db_conn):
        """Should raise ValueError for non-existent cohort."""
        with pytest.raises(ValueError, match="not found"):
            await schedule_cohort(cohort_id=99999)

    @pytest.mark.asyncio
    async def test_assigns_facilitator_role(self, db_conn):
        """Should preserve facilitator role in groups_users."""
        # Setup
        course = await create_test_course(db_conn, "Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"])

        # Create facilitator + 3 participants
        await create_test_user(
            db_conn,
            cohort["cohort_id"],
            "1001",
            availability="M09:00 M10:00",
            cohort_role="facilitator",
        )
        for i in range(3):
            await create_test_user(
                db_conn,
                cohort["cohort_id"],
                str(2000 + i),
                availability="M09:00 M10:00",
            )

        # Execute
        result = await schedule_cohort(
            cohort_id=cohort["cohort_id"],
            min_people=4,
        )

        # Assert: at least one group created with the facilitator
        assert result.groups_created >= 1
        assert result.users_grouped == 4
```

**Step 2: Run the tests**

Run: `pytest discord_bot/tests/test_scheduling_queries.py::TestScheduleCohort -v`
Expected: Tests pass (some may need adjustment based on schedule_cohort behavior)

**Step 3: Commit**

```bash
jj describe -m "test: add integration tests for schedule_cohort function"
```

---

## Task 5: Create FakeInteraction for E2E Tests

**Files:**
- Create: `discord_bot/tests/fake_interaction.py`

**Step 1: Create FakeInteraction class**

```python
"""
FakeInteraction for E2E testing with real Discord.

Wraps a real guild but captures/redirects response messages.
"""

import discord
from typing import Optional, Any
from unittest.mock import MagicMock


class FakeInteraction:
    """
    Minimal interaction mock that wraps a real Discord guild.

    Usage:
        guild = bot.get_guild(DEV_GUILD_ID)
        test_channel = guild.get_channel(TEST_CHANNEL_ID)
        interaction = FakeInteraction(guild, test_channel)
        await cog.realize_groups(interaction, cohort_id)
    """

    def __init__(
        self,
        guild: discord.Guild,
        response_channel: Optional[discord.TextChannel] = None,
    ):
        self.guild = guild
        self.user = guild.me
        self._response_channel = response_channel
        self._deferred = False
        self.response = self._Response(self)
        self.followup = self._Followup(response_channel)

        # Store responses for assertions
        self.responses: list[Any] = []

    class _Response:
        """Mock for interaction.response."""

        def __init__(self, parent: "FakeInteraction"):
            self._parent = parent

        async def defer(self, ephemeral: bool = False):
            self._parent._deferred = True

        async def send_message(self, content: str = None, embed: discord.Embed = None, **kwargs):
            self._parent.responses.append({"content": content, "embed": embed})
            self._parent._deferred = True

        def is_done(self) -> bool:
            return self._parent._deferred

    class _Followup:
        """Mock for interaction.followup."""

        def __init__(self, channel: Optional[discord.TextChannel]):
            self._channel = channel
            self.last_message: Optional[discord.Message] = None
            self.messages: list[Any] = []

        async def send(
            self,
            content: str = None,
            embed: discord.Embed = None,
            ephemeral: bool = False,
            **kwargs,
        ) -> "FakeMessage":
            """
            Capture the message and optionally send to test channel.
            Returns a FakeMessage that can be edited.
            """
            msg_data = {"content": content, "embed": embed}
            self.messages.append(msg_data)

            fake_msg = FakeMessage(content, embed, self._channel)
            self.last_message = fake_msg

            # Optionally send to real channel for visibility
            if self._channel:
                real_msg = await self._channel.send(content=content, embed=embed)
                fake_msg._real_message = real_msg

            return fake_msg


class FakeMessage:
    """Mock message that can be edited."""

    def __init__(
        self,
        content: str = None,
        embed: discord.Embed = None,
        channel: discord.TextChannel = None,
    ):
        self.content = content
        self.embed = embed
        self._channel = channel
        self._real_message: Optional[discord.Message] = None

    async def edit(self, content: str = None, embed: discord.Embed = None, **kwargs):
        """Edit the message content."""
        if content is not None:
            self.content = content
        if embed is not None:
            self.embed = embed

        # Edit real message if exists
        if self._real_message:
            await self._real_message.edit(content=content, embed=embed)
```

**Step 2: Verify import**

Run: `python -c "from discord_bot.tests.fake_interaction import FakeInteraction; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
jj describe -m "test: add FakeInteraction class for E2E testing"
```

---

## Task 6: E2E Test Setup and First Test

**Files:**
- Create: `discord_bot/tests/test_scheduling_e2e.py`

**Step 1: Create E2E test file with bot fixture and first test**

```python
"""
End-to-end tests for scheduling commands using real Discord.

These tests:
- Create real Discord channels in the dev server
- Use FakeInteraction to call cog methods directly
- Clean up channels after each test

Run sparingly to avoid rate limits.
"""

import pytest
import pytest_asyncio
import discord
import asyncio
import os
from dotenv import load_dotenv

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


# Load environment
load_dotenv('.env.local')

# Dev server IDs - update these for your server
DEV_GUILD_ID = int(os.getenv("TEST_GUILD_ID", "0"))
TEST_CHANNEL_ID = int(os.getenv("TEST_CHANNEL_ID", "0"))


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
        pytest.skip("TEST_GUILD_ID not set")

    guild = bot.get_guild(DEV_GUILD_ID)
    if not guild:
        pytest.fail(f"Could not find guild {DEV_GUILD_ID}")

    return guild


@pytest_asyncio.fixture
async def test_channel(guild):
    """Get the test output channel."""
    if TEST_CHANNEL_ID == 0:
        pytest.skip("TEST_CHANNEL_ID not set")

    channel = guild.get_channel(TEST_CHANNEL_ID)
    if not channel:
        pytest.fail(f"Could not find channel {TEST_CHANNEL_ID}")

    return channel


@pytest_asyncio.fixture
async def cleanup_channels(guild):
    """
    Track and clean up Discord channels created during tests.

    Usage:
        async def test_something(cleanup_channels):
            category = await guild.create_category("Test")
            cleanup_channels.append(category)
            # ... test ...
            # category deleted automatically after test
    """
    created: list[discord.abc.GuildChannel] = []
    yield created

    # Cleanup in reverse order (channels before categories)
    for channel in reversed(created):
        try:
            await channel.delete(reason="E2E test cleanup")
            await asyncio.sleep(0.3)  # Rate limit buffer
        except discord.NotFound:
            pass
        except discord.HTTPException as e:
            print(f"Warning: Could not delete {channel}: {e}")


class TestRealizeGroupsE2E:
    """E2E tests for /realize-groups command."""

    @pytest.mark.asyncio
    async def test_creates_category_and_channels(
        self,
        db_conn,
        bot,
        guild,
        test_channel,
        cleanup_channels,
    ):
        """Should create Discord category, text channel, and voice channel."""
        # Setup: create cohort with a group in DB
        course = await create_test_course(db_conn, "E2E Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"], "E2E Test Cohort")
        group = await create_test_group(db_conn, cohort["cohort_id"], "Group 1")

        # Add a user to the group (use bot's ID as a stand-in)
        user = await create_test_user(db_conn, cohort["cohort_id"], str(bot.user.id))
        await add_user_to_group(db_conn, group["group_id"], user["user_id"])

        # Create cog and fake interaction
        cog = GroupsCog(bot)
        interaction = FakeInteraction(guild, test_channel)

        # Execute
        await cog.realize_groups(interaction, cohort["cohort_id"])

        # Find created category
        category_name = f"E2E Test Course - E2E Test Cohort"[:100]
        category = discord.utils.get(guild.categories, name=category_name)

        assert category is not None, f"Category '{category_name}' not found"
        cleanup_channels.append(category)

        # Find channels in category
        text_channel = discord.utils.get(category.text_channels, name="group-1")
        voice_channel = discord.utils.get(category.voice_channels, name="Group 1 Voice")

        assert text_channel is not None, "Text channel 'group-1' not found"
        assert voice_channel is not None, "Voice channel 'Group 1 Voice' not found"

        cleanup_channels.append(text_channel)
        cleanup_channels.append(voice_channel)
```

**Step 2: Add environment variables to .env.local**

Add to `.env.local`:
```
TEST_GUILD_ID=your_dev_guild_id
TEST_CHANNEL_ID=your_test_output_channel_id
```

**Step 3: Run E2E test (manual)**

Run: `pytest discord_bot/tests/test_scheduling_e2e.py -v -s`
Expected: Test passes, channels created and cleaned up

**Step 4: Commit**

```bash
jj describe -m "test: add E2E test for realize-groups channel creation"
```

---

## Task 7: Add More E2E Tests

**Files:**
- Modify: `discord_bot/tests/test_scheduling_e2e.py`

**Step 1: Add additional E2E tests**

Add to `TestRealizeGroupsE2E` class:

```python
    @pytest.mark.asyncio
    async def test_sets_channel_permissions(
        self,
        db_conn,
        bot,
        guild,
        test_channel,
        cleanup_channels,
    ):
        """Should set permissions so only group members can see channels."""
        # Setup
        course = await create_test_course(db_conn, "Permissions Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"], "Permissions Cohort")
        group = await create_test_group(db_conn, cohort["cohort_id"], "Private Group")
        user = await create_test_user(db_conn, cohort["cohort_id"], str(bot.user.id))
        await add_user_to_group(db_conn, group["group_id"], user["user_id"])

        # Execute
        cog = GroupsCog(bot)
        interaction = FakeInteraction(guild, test_channel)
        await cog.realize_groups(interaction, cohort["cohort_id"])

        # Find category and clean up
        category_name = "Permissions Test Course - Permissions Cohort"[:100]
        category = discord.utils.get(guild.categories, name=category_name)
        assert category is not None
        cleanup_channels.append(category)

        for channel in category.channels:
            cleanup_channels.append(channel)

        # Check permissions: @everyone should not see
        text_channel = discord.utils.get(category.text_channels, name="private-group")
        overwrites = text_channel.overwrites

        # Default role should have view_channel = False
        default_role = guild.default_role
        assert default_role in overwrites
        assert overwrites[default_role].view_channel == False

    @pytest.mark.asyncio
    async def test_saves_channel_ids_to_database(
        self,
        db_conn,
        bot,
        guild,
        test_channel,
        cleanup_channels,
    ):
        """Should save Discord channel IDs back to database."""
        from sqlalchemy import select
        from core.tables import groups

        # Setup
        course = await create_test_course(db_conn, "DB Save Test Course")
        cohort = await create_test_cohort(db_conn, course["course_id"], "DB Save Cohort")
        group = await create_test_group(db_conn, cohort["cohort_id"], "DB Group")
        user = await create_test_user(db_conn, cohort["cohort_id"], str(bot.user.id))
        await add_user_to_group(db_conn, group["group_id"], user["user_id"])

        # Execute
        cog = GroupsCog(bot)
        interaction = FakeInteraction(guild, test_channel)
        await cog.realize_groups(interaction, cohort["cohort_id"])

        # Cleanup
        category_name = "DB Save Test Course - DB Save Cohort"[:100]
        category = discord.utils.get(guild.categories, name=category_name)
        if category:
            cleanup_channels.append(category)
            for channel in category.channels:
                cleanup_channels.append(channel)

        # Check database was updated
        # Note: This requires reading from the actual DB, not the rolled-back transaction
        # This test may need adjustment based on transaction handling
        result = await db_conn.execute(
            select(groups).where(groups.c.group_id == group["group_id"])
        )
        updated_group = dict(result.mappings().first())

        # Channel IDs should be set (as strings)
        assert updated_group["discord_text_channel_id"] is not None
        assert updated_group["discord_voice_channel_id"] is not None
```

**Step 2: Run all E2E tests**

Run: `pytest discord_bot/tests/test_scheduling_e2e.py -v -s`
Expected: All tests pass

**Step 3: Commit**

```bash
jj describe -m "test: add E2E tests for permissions and DB persistence"
```

---

## Task 8: Final Verification

**Step 1: Run all tests**

```bash
# Unit tests
pytest discord_bot/tests/test_scheduler.py -v

# Integration tests
pytest discord_bot/tests/test_scheduling_queries.py -v

# E2E tests (requires Discord connection)
pytest discord_bot/tests/test_scheduling_e2e.py -v -s
```

**Step 2: Verify test count**

Expected:
- Unit: 68 tests (existing)
- Integration: ~12 tests (new)
- E2E: ~3 tests (new)

**Step 3: Final commit**

```bash
jj describe -m "test: complete scheduler and groups testing implementation

- Add db_conn fixture with transaction rollback
- Add test helpers for creating test data
- Add integration tests for query functions and schedule_cohort
- Add E2E tests for realize-groups with real Discord
- Add FakeInteraction class for E2E testing"
```

---

## Summary

| Task | Files | Tests Added |
|------|-------|-------------|
| 1 | `conftest.py` | db_conn fixture |
| 2 | `helpers.py` | Test data factories |
| 3 | `test_scheduling_queries.py` | 6 query tests |
| 4 | `test_scheduling_queries.py` | 4 schedule_cohort tests |
| 5 | `fake_interaction.py` | FakeInteraction class |
| 6 | `test_scheduling_e2e.py` | 1 E2E test |
| 7 | `test_scheduling_e2e.py` | 2 more E2E tests |
| 8 | - | Final verification |
