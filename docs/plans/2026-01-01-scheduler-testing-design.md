# Scheduler and Groups Testing Strategy

## Overview

Testing strategy for `/schedule` and `/realize-groups` commands, covering unit tests, integration tests with real database, and E2E tests with real Discord.

## Test Layers

| Layer | What | DB | Discord | When to run |
|-------|------|-----|---------|-------------|
| Unit | Scheduling algorithm | No | No | Every commit |
| Integration | Query functions, `schedule_cohort()` | Real + rollback | No | Every commit |
| E2E | Discord cogs | Real + rollback | Real dev server | Manual / CI nightly |

## Database Testing Approach

**Transaction rollback pattern:** Each test runs in a database transaction that gets rolled back after the test completes. This provides:

- Test isolation (tests can't affect each other)
- Clean database (no leftover test data)
- Fast execution (no cleanup queries needed)

**Dev database kept empty:** No persistent dev data. Tests start from a clean slate.

```python
# tests/conftest.py

@pytest_asyncio.fixture
async def db_conn():
    """Provide a DB connection that rolls back after each test."""
    from dotenv import load_dotenv
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

## Test Files

### 1. `test_scheduler.py` (existing)

Pure unit tests for scheduling algorithm. No changes needed.

- 68 existing tests
- No DB or Discord dependencies
- Tests: `parse_interval_string`, `is_group_valid`, `run_greedy_iteration`, etc.

### 2. `test_scheduling_queries.py` (new)

Integration tests for query functions and `schedule_cohort()`.

**Query function tests:**

| Test | Purpose |
|------|---------|
| `test_get_schedulable_cohorts_returns_pending` | Only returns cohorts with `awaiting_grouping` users |
| `test_get_schedulable_cohorts_empty` | Returns empty list when no pending users |
| `test_get_realizable_cohorts_returns_unrealized` | Only returns cohorts with NULL channel IDs |
| `test_get_realizable_cohorts_excludes_realized` | Excludes cohorts where all groups have channels |
| `test_create_group_returns_record` | Group created with correct fields |
| `test_add_user_to_group` | Membership saved with correct role |

**schedule_cohort tests:**

| Test | Purpose |
|------|---------|
| `test_schedule_cohort_creates_groups` | Basic flow - users grouped, groups saved to DB |
| `test_schedule_cohort_no_users` | Returns empty result when no users awaiting grouping |
| `test_schedule_cohort_updates_grouping_status` | Users marked as `grouped` or `ungroupable` |
| `test_schedule_cohort_assigns_facilitators` | Facilitator role preserved in `groups_users` |
| `test_schedule_cohort_invalid_cohort` | Raises `ValueError` for non-existent cohort |
| `test_schedule_cohort_respects_min_people` | Users below threshold marked ungroupable |

### 3. `test_scheduling_e2e.py` (new)

E2E tests using real Discord dev server.

**Approach:**
- Call cog methods directly (not through Discord slash command)
- Use `FakeInteraction` that wraps real guild
- Real channels/events get created
- Clean up after each test

**FakeInteraction class:**

```python
class FakeInteraction:
    """Minimal interaction mock that wraps a real guild."""

    def __init__(self, guild: discord.Guild, response_channel: discord.TextChannel):
        self.guild = guild
        self.user = guild.me
        self._response_channel = response_channel
        self._deferred = False
        self.followup = self._Followup(response_channel)
        self.response = self._Response(self)

    class _Response:
        def __init__(self, parent):
            self._parent = parent

        async def defer(self):
            self._parent._deferred = True

        def is_done(self):
            return self._parent._deferred

    class _Followup:
        def __init__(self, channel):
            self._channel = channel
            self.last_message = None

        async def send(self, content=None, embed=None, **kwargs):
            # Send to test channel for visibility, or just capture
            self.last_message = content or embed
            return await self._channel.send(content=content, embed=embed)
```

**E2E tests:**

| Test | Purpose |
|------|---------|
| `test_realize_groups_creates_category` | Category created with correct name |
| `test_realize_groups_creates_channels` | Text and voice channels created per group |
| `test_realize_groups_sets_permissions` | Members can see their channels, others can't |
| `test_realize_groups_creates_events` | Scheduled events created for each meeting |
| `test_realize_groups_saves_channel_ids` | Discord IDs saved back to database |

**Cleanup fixture:**

```python
@pytest_asyncio.fixture
async def cleanup_channels():
    """Track and clean up Discord channels created during tests."""
    created = []
    yield created
    for channel in created:
        try:
            await channel.delete()
        except discord.NotFound:
            pass
```

## Test Helpers

```python
# tests/helpers.py

async def create_test_course(conn, name="Test Course"):
    """Create a course for testing."""
    result = await conn.execute(
        insert(courses).values(course_name=name).returning(courses)
    )
    return dict(result.mappings().first())

async def create_test_cohort(conn, course_id, name="Test Cohort", num_meetings=8):
    """Create a cohort for testing."""
    result = await conn.execute(
        insert(cohorts).values(
            cohort_name=name,
            course_id=course_id,
            cohort_start_date=date.today() + timedelta(days=7),
            duration_days=56,
            number_of_group_meetings=num_meetings,
        ).returning(cohorts)
    )
    return dict(result.mappings().first())

async def create_test_user(conn, cohort_id, discord_id, availability="M09:00 M10:00", role="participant"):
    """Create a user enrolled in a cohort for testing."""
    # Create user
    user_result = await conn.execute(
        insert(users).values(
            discord_id=discord_id,
            discord_username=f"testuser_{discord_id}",
            availability_utc=availability,
            timezone="UTC",
        ).returning(users)
    )
    user = dict(user_result.mappings().first())

    # Enroll in cohort
    await conn.execute(
        insert(courses_users).values(
            user_id=user["user_id"],
            cohort_id=cohort_id,
            grouping_status="awaiting_grouping",
            cohort_role=role,
        )
    )
    return user
```

## Running Tests

```bash
# Unit tests only (fast, no dependencies)
pytest discord_bot/tests/test_scheduler.py -v

# Integration tests (needs local DB)
pytest discord_bot/tests/test_scheduling_queries.py -v

# E2E tests (needs local DB + Discord dev server)
pytest discord_bot/tests/test_scheduling_e2e.py -v

# All tests
pytest discord_bot/tests/ -v
```

## Rate Limits

E2E tests interact with real Discord API. To avoid rate limits:

- Keep E2E test count low (5-10 tests)
- Run E2E tests manually or in nightly CI, not on every commit
- Clean up channels after each test
- Add small delays if needed (`await asyncio.sleep(0.5)`)

## Future: Seed Data Script

If manual testing with persistent data is needed later:

```bash
python scripts/seed_dev_data.py
```

This would populate the dev DB with realistic test data. Not implemented yet.
