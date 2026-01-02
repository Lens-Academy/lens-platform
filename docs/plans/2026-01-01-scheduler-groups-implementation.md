# Scheduler and Groups Refactor - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor scheduling to persist groups to database, and add `/realize-groups` command to create Discord channels from DB.

**Architecture:** Two-step process: (1) `/schedule` runs algorithm and saves groups to DB, (2) `/realize-groups` creates Discord channels/events for persisted groups. Core handles all business logic; Discord cog is thin adapter.

**Tech Stack:** SQLAlchemy Core (async), PostgreSQL, discord.py with app_commands

---

## Task 1: Schema Migration - Add Columns to Cohorts Table

**Files:**
- Modify: `core/tables.py:154-172`
- Create: `migrations/add_cohort_columns.sql` (manual migration script)

**Step 1: Update tables.py with new columns**

In `core/tables.py`, find the `cohorts` table definition and add two columns after `status`:

```python
cohorts = Table(
    "cohorts",
    metadata,
    Column("cohort_id", Integer, primary_key=True, autoincrement=True),
    Column("cohort_name", Text),
    Column(
        "course_id",
        Integer,
        ForeignKey("courses.course_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("cohort_start_date", Date, nullable=False),
    Column("duration_days", Integer, nullable=False),
    Column("number_of_group_meetings", Integer, nullable=False),  # NEW
    Column("discord_category_id", Text),  # NEW
    Column("status", cohort_status_enum, server_default="active"),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_cohorts_course_id", "course_id"),
    Index("idx_cohorts_start_date", "cohort_start_date"),
)
```

**Step 2: Create SQL migration script**

Create `migrations/add_cohort_columns.sql`:

```sql
-- Add number_of_group_meetings and discord_category_id to cohorts table
-- Run manually: psql $DATABASE_URL -f migrations/add_cohort_columns.sql

ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS number_of_group_meetings INTEGER;
ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS discord_category_id TEXT;

-- For existing cohorts, set a default (can be updated later)
UPDATE cohorts SET number_of_group_meetings = 8 WHERE number_of_group_meetings IS NULL;

-- Now make it NOT NULL
ALTER TABLE cohorts ALTER COLUMN number_of_group_meetings SET NOT NULL;
```

**Step 3: Run migration**

```bash
psql $DATABASE_URL -f migrations/add_cohort_columns.sql
```

**Step 4: Commit**

```bash
jj describe -m "feat: add number_of_group_meetings and discord_category_id to cohorts table"
```

---

## Task 2: Create core/queries/cohorts.py - Cohort Query Functions

**Files:**
- Create: `core/queries/cohorts.py`
- Modify: `core/queries/__init__.py`

**Step 1: Create cohorts.py with get_schedulable_cohorts**

Create `core/queries/cohorts.py`:

```python
"""Cohort-related database queries using SQLAlchemy Core."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import cohorts, courses, courses_users


async def get_schedulable_cohorts(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get cohorts that have users awaiting grouping.

    Returns list of dicts with cohort_id, cohort_name, course_name, pending_users count.
    """
    # Subquery to count pending users per cohort
    pending_count = (
        select(
            courses_users.c.cohort_id,
            func.count().label("pending_users")
        )
        .where(courses_users.c.grouping_status == "awaiting_grouping")
        .group_by(courses_users.c.cohort_id)
        .subquery()
    )

    # Join cohorts with courses and pending counts
    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            courses.c.course_name,
            pending_count.c.pending_users,
        )
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .join(pending_count, cohorts.c.cohort_id == pending_count.c.cohort_id)
        .where(pending_count.c.pending_users > 0)
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    return [dict(row) for row in result.mappings()]


async def get_realizable_cohorts(
    conn: AsyncConnection,
) -> list[dict[str, Any]]:
    """
    Get cohorts that have groups without Discord channels.

    Returns cohorts where at least one group has NULL discord_text_channel_id.
    """
    from ..tables import groups

    # Subquery: cohorts with unrealized groups
    unrealized = (
        select(groups.c.cohort_id)
        .where(groups.c.discord_text_channel_id.is_(None))
        .distinct()
        .subquery()
    )

    query = (
        select(
            cohorts.c.cohort_id,
            cohorts.c.cohort_name,
            courses.c.course_name,
            cohorts.c.number_of_group_meetings,
        )
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .join(unrealized, cohorts.c.cohort_id == unrealized.c.cohort_id)
        .order_by(cohorts.c.cohort_start_date)
    )

    result = await conn.execute(query)
    return [dict(row) for row in result.mappings()]


async def get_cohort_by_id(
    conn: AsyncConnection,
    cohort_id: int,
) -> dict[str, Any] | None:
    """Get a cohort by ID with course name."""
    query = (
        select(cohorts, courses.c.course_name)
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .where(cohorts.c.cohort_id == cohort_id)
    )
    result = await conn.execute(query)
    row = result.mappings().first()
    return dict(row) if row else None


async def save_cohort_category_id(
    conn: AsyncConnection,
    cohort_id: int,
    discord_category_id: str,
) -> None:
    """Update cohort with Discord category ID."""
    await conn.execute(
        update(cohorts)
        .where(cohorts.c.cohort_id == cohort_id)
        .values(
            discord_category_id=discord_category_id,
            updated_at=datetime.now(timezone.utc),
        )
    )
```

**Step 2: Update core/queries/__init__.py**

```python
"""Query layer for database operations using SQLAlchemy Core."""

from .auth import create_auth_code, validate_auth_code
from .users import create_user, get_or_create_user, get_user_by_discord_id, update_user
from .cohorts import (
    get_schedulable_cohorts,
    get_realizable_cohorts,
    get_cohort_by_id,
    save_cohort_category_id,
)

__all__ = [
    # Users
    "get_user_by_discord_id",
    "create_user",
    "update_user",
    "get_or_create_user",
    # Auth
    "create_auth_code",
    "validate_auth_code",
    # Cohorts
    "get_schedulable_cohorts",
    "get_realizable_cohorts",
    "get_cohort_by_id",
    "save_cohort_category_id",
]
```

**Step 3: Commit**

```bash
jj describe -m "feat: add cohort query functions for scheduling and realization"
```

---

## Task 3: Create core/queries/groups.py - Group Query Functions

**Files:**
- Create: `core/queries/groups.py`
- Modify: `core/queries/__init__.py`

**Step 1: Create groups.py**

Create `core/queries/groups.py`:

```python
"""Group-related database queries using SQLAlchemy Core."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from ..tables import cohorts, courses, groups, groups_users, users
from ..enums import GroupUserRole


async def create_group(
    conn: AsyncConnection,
    cohort_id: int,
    group_name: str,
    recurring_meeting_time_utc: str,
) -> dict[str, Any]:
    """
    Create a new group and return the created record.

    Args:
        cohort_id: The cohort this group belongs to
        group_name: Display name (e.g., "Group 1")
        recurring_meeting_time_utc: Meeting time (e.g., "Wednesday 15:00")
    """
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name=group_name,
            recurring_meeting_time_utc=recurring_meeting_time_utc,
            status="forming",
        )
        .returning(groups)
    )
    row = result.mappings().first()
    return dict(row)


async def add_user_to_group(
    conn: AsyncConnection,
    group_id: int,
    user_id: int,
    role: str = "participant",
) -> dict[str, Any]:
    """Add a user to a group with specified role."""
    result = await conn.execute(
        insert(groups_users)
        .values(
            group_id=group_id,
            user_id=user_id,
            role=role,
            status="active",
        )
        .returning(groups_users)
    )
    row = result.mappings().first()
    return dict(row)


async def get_cohort_groups_for_realization(
    conn: AsyncConnection,
    cohort_id: int,
) -> dict[str, Any] | None:
    """
    Get structured data for realizing a cohort's groups in Discord.

    Returns:
        {
            "cohort_id": 1,
            "cohort_name": "AI Safety - Jan 2025",
            "course_name": "AI Safety Fundamentals",
            "cohort_start_date": date,
            "number_of_group_meetings": 8,
            "discord_category_id": None,  # or existing ID
            "groups": [
                {
                    "group_id": 1,
                    "group_name": "Group 1",
                    "recurring_meeting_time_utc": "Wednesday 15:00",
                    "discord_text_channel_id": None,
                    "discord_voice_channel_id": None,
                    "members": [
                        {"user_id": 1, "discord_id": "123", "nickname": "Alice", "role": "facilitator", "timezone": "UTC"},
                        ...
                    ]
                },
                ...
            ]
        }
    """
    # Get cohort info
    cohort_query = (
        select(cohorts, courses.c.course_name)
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .where(cohorts.c.cohort_id == cohort_id)
    )
    cohort_result = await conn.execute(cohort_query)
    cohort_row = cohort_result.mappings().first()

    if not cohort_row:
        return None

    # Get groups for this cohort
    groups_query = (
        select(groups)
        .where(groups.c.cohort_id == cohort_id)
        .order_by(groups.c.group_id)
    )
    groups_result = await conn.execute(groups_query)
    groups_list = []

    for group_row in groups_result.mappings():
        group_data = dict(group_row)

        # Get members for this group
        members_query = (
            select(
                users.c.user_id,
                users.c.discord_id,
                users.c.nickname,
                users.c.discord_username,
                users.c.timezone,
                groups_users.c.role,
            )
            .join(groups_users, users.c.user_id == groups_users.c.user_id)
            .where(groups_users.c.group_id == group_data["group_id"])
            .where(groups_users.c.status == "active")
        )
        members_result = await conn.execute(members_query)
        members = []
        for member_row in members_result.mappings():
            member = dict(member_row)
            # Use nickname if set, otherwise discord_username
            member["name"] = member.get("nickname") or member.get("discord_username") or f"User {member['user_id']}"
            members.append(member)

        groups_list.append({
            "group_id": group_data["group_id"],
            "group_name": group_data["group_name"],
            "recurring_meeting_time_utc": group_data["recurring_meeting_time_utc"],
            "discord_text_channel_id": group_data["discord_text_channel_id"],
            "discord_voice_channel_id": group_data["discord_voice_channel_id"],
            "members": members,
        })

    return {
        "cohort_id": cohort_row["cohort_id"],
        "cohort_name": cohort_row["cohort_name"],
        "course_name": cohort_row["course_name"],
        "cohort_start_date": cohort_row["cohort_start_date"],
        "number_of_group_meetings": cohort_row["number_of_group_meetings"],
        "discord_category_id": cohort_row["discord_category_id"],
        "groups": groups_list,
    }


async def save_discord_channel_ids(
    conn: AsyncConnection,
    group_id: int,
    text_channel_id: str,
    voice_channel_id: str,
) -> None:
    """Update group with Discord channel IDs after realization."""
    await conn.execute(
        update(groups)
        .where(groups.c.group_id == group_id)
        .values(
            discord_text_channel_id=text_channel_id,
            discord_voice_channel_id=voice_channel_id,
            updated_at=datetime.now(timezone.utc),
        )
    )


async def get_group_welcome_data(
    conn: AsyncConnection,
    group_id: int,
) -> dict[str, Any] | None:
    """
    Get structured data for welcome message.

    Returns:
        {
            "group_name": "Group 1",
            "cohort_name": "AI Safety - Jan 2025",
            "course_name": "AI Safety Fundamentals",
            "meeting_time_utc": "Wednesday 15:00",
            "cohort_start_date": date,
            "number_of_group_meetings": 8,
            "members": [
                {"name": "Alice", "discord_id": "123", "role": "facilitator", "timezone": "America/New_York"},
                ...
            ]
        }
    """
    # Get group with cohort and course info
    query = (
        select(
            groups.c.group_id,
            groups.c.group_name,
            groups.c.recurring_meeting_time_utc,
            cohorts.c.cohort_name,
            cohorts.c.cohort_start_date,
            cohorts.c.number_of_group_meetings,
            courses.c.course_name,
        )
        .join(cohorts, groups.c.cohort_id == cohorts.c.cohort_id)
        .join(courses, cohorts.c.course_id == courses.c.course_id)
        .where(groups.c.group_id == group_id)
    )
    result = await conn.execute(query)
    row = result.mappings().first()

    if not row:
        return None

    # Get members
    members_query = (
        select(
            users.c.discord_id,
            users.c.nickname,
            users.c.discord_username,
            users.c.timezone,
            groups_users.c.role,
        )
        .join(groups_users, users.c.user_id == groups_users.c.user_id)
        .where(groups_users.c.group_id == group_id)
        .where(groups_users.c.status == "active")
    )
    members_result = await conn.execute(members_query)
    members = []
    for member_row in members_result.mappings():
        member = dict(member_row)
        member["name"] = member.get("nickname") or member.get("discord_username") or "Unknown"
        members.append(member)

    return {
        "group_name": row["group_name"],
        "cohort_name": row["cohort_name"],
        "course_name": row["course_name"],
        "meeting_time_utc": row["recurring_meeting_time_utc"],
        "cohort_start_date": row["cohort_start_date"],
        "number_of_group_meetings": row["number_of_group_meetings"],
        "members": members,
    }
```

**Step 2: Update core/queries/__init__.py to include group functions**

Add to imports and __all__:

```python
from .groups import (
    create_group,
    add_user_to_group,
    get_cohort_groups_for_realization,
    save_discord_channel_ids,
    get_group_welcome_data,
)

# Add to __all__:
    # Groups
    "create_group",
    "add_user_to_group",
    "get_cohort_groups_for_realization",
    "save_discord_channel_ids",
    "get_group_welcome_data",
```

**Step 3: Commit**

```bash
jj describe -m "feat: add group query functions for creation and realization"
```

---

## Task 4: Add schedule_cohort Function to core/scheduling.py

**Files:**
- Modify: `core/scheduling.py`
- Modify: `core/__init__.py`

**Step 1: Add imports at top of scheduling.py**

Add after existing imports:

```python
from dataclasses import dataclass
from typing import Optional

from .database import get_transaction
from .queries.cohorts import get_cohort_by_id
from .queries.groups import create_group, add_user_to_group
from .tables import courses_users, users
from sqlalchemy import select, update
```

**Step 2: Add CohortSchedulingResult dataclass**

Add after existing dataclasses:

```python
@dataclass
class CohortSchedulingResult:
    """Result of scheduling a single cohort."""
    cohort_id: int
    cohort_name: str
    groups_created: int
    users_grouped: int
    users_ungroupable: int
    groups: list  # list of dicts with group_id, group_name, member_count, meeting_time
```

**Step 3: Add schedule_cohort function**

Add at end of file before the existing `schedule` function:

```python
async def schedule_cohort(
    cohort_id: int,
    meeting_length: int = 60,
    min_people: int = 4,
    max_people: int = 8,
    num_iterations: int = 1000,
    balance: bool = True,
    use_if_needed: bool = True,
    progress_callback=None,
) -> CohortSchedulingResult:
    """
    Run scheduling for a specific cohort and persist results to database.

    1. Load users from courses_users WHERE cohort_id=X AND grouping_status='awaiting_grouping'
    2. Get their availability from users table
    3. Run scheduling algorithm
    4. Insert groups into 'groups' table
    5. Insert memberships into 'groups_users' table
    6. Update courses_users.grouping_status to 'grouped' or 'ungroupable'

    Returns: CohortSchedulingResult with summary
    """
    async with get_transaction() as conn:
        # Get cohort info
        cohort = await get_cohort_by_id(conn, cohort_id)
        if not cohort:
            raise ValueError(f"Cohort {cohort_id} not found")

        # Load users awaiting grouping for this cohort
        query = (
            select(
                users.c.user_id,
                users.c.discord_id,
                users.c.nickname,
                users.c.discord_username,
                users.c.timezone,
                users.c.availability_utc,
                users.c.if_needed_availability_utc,
                courses_users.c.cohort_role,
            )
            .join(courses_users, users.c.user_id == courses_users.c.user_id)
            .where(courses_users.c.cohort_id == cohort_id)
            .where(courses_users.c.grouping_status == "awaiting_grouping")
        )
        result = await conn.execute(query)
        user_rows = [dict(row) for row in result.mappings()]

        if not user_rows:
            return CohortSchedulingResult(
                cohort_id=cohort_id,
                cohort_name=cohort["cohort_name"],
                groups_created=0,
                users_grouped=0,
                users_ungroupable=0,
                groups=[],
            )

        # Convert to Person objects for scheduling
        people = []
        user_id_map = {}  # discord_id -> user_id for later
        facilitator_ids = set()

        for row in user_rows:
            discord_id = row["discord_id"]
            user_id_map[discord_id] = row["user_id"]

            # Parse availability
            intervals = parse_interval_string(row["availability_utc"] or "")
            if_needed = parse_interval_string(row["if_needed_availability_utc"] or "")

            if not intervals and not if_needed:
                continue  # Skip users with no availability

            name = row["nickname"] or row["discord_username"] or f"User {row['user_id']}"
            person = Person(
                id=discord_id,
                name=name,
                intervals=intervals,
                if_needed_intervals=if_needed,
                timezone=row["timezone"] or "UTC",
            )
            people.append(person)

            if row["cohort_role"] == "facilitator":
                facilitator_ids.add(discord_id)

        if not people:
            return CohortSchedulingResult(
                cohort_id=cohort_id,
                cohort_name=cohort["cohort_name"],
                groups_created=0,
                users_grouped=0,
                users_ungroupable=len(user_rows),
                groups=[],
            )

        # Run scheduling algorithm
        facilitator_ids_param = facilitator_ids if facilitator_ids else None
        solution, score, best_iter, total_iter = await run_scheduling(
            people=people,
            meeting_length=meeting_length,
            min_people=min_people,
            max_people=max_people,
            num_iterations=num_iterations,
            facilitator_ids=facilitator_ids_param,
            use_if_needed=use_if_needed,
            progress_callback=progress_callback,
        )

        # Balance if requested
        if balance and solution and len(solution) >= 2:
            balance_cohorts(solution, meeting_length, use_if_needed=use_if_needed)

        # Persist groups to database
        created_groups = []
        grouped_user_ids = set()

        if solution:
            for i, group in enumerate(solution, 1):
                # Format meeting time
                if group.selected_time:
                    meeting_time = format_time_range(*group.selected_time)
                else:
                    meeting_time = "TBD"

                # Create group record
                group_record = await create_group(
                    conn,
                    cohort_id=cohort_id,
                    group_name=f"Group {i}",
                    recurring_meeting_time_utc=meeting_time,
                )

                # Add members to group
                for person in group.people:
                    user_id = user_id_map.get(person.id)
                    if user_id:
                        role = "facilitator" if person.id in facilitator_ids else "participant"
                        await add_user_to_group(conn, group_record["group_id"], user_id, role)
                        grouped_user_ids.add(user_id)

                created_groups.append({
                    "group_id": group_record["group_id"],
                    "group_name": group_record["group_name"],
                    "member_count": len(group.people),
                    "meeting_time": meeting_time,
                })

        # Update grouping_status for all users
        all_user_ids = [row["user_id"] for row in user_rows]
        ungroupable_user_ids = [uid for uid in all_user_ids if uid not in grouped_user_ids]

        if grouped_user_ids:
            await conn.execute(
                update(courses_users)
                .where(courses_users.c.cohort_id == cohort_id)
                .where(courses_users.c.user_id.in_(list(grouped_user_ids)))
                .values(grouping_status="grouped")
            )

        if ungroupable_user_ids:
            await conn.execute(
                update(courses_users)
                .where(courses_users.c.cohort_id == cohort_id)
                .where(courses_users.c.user_id.in_(ungroupable_user_ids))
                .values(grouping_status="ungroupable")
            )

        return CohortSchedulingResult(
            cohort_id=cohort_id,
            cohort_name=cohort["cohort_name"],
            groups_created=len(created_groups),
            users_grouped=len(grouped_user_ids),
            users_ungroupable=len(ungroupable_user_ids),
            groups=created_groups,
        )
```

**Step 4: Export from core/__init__.py**

Add to imports:

```python
from .scheduling import (
    # ... existing imports ...
    CohortSchedulingResult,
    schedule_cohort,
)
```

Add to __all__:

```python
    'CohortSchedulingResult',
    'schedule_cohort',
```

**Step 5: Commit**

```bash
jj describe -m "feat: add schedule_cohort function to persist scheduling results to DB"
```

---

## Task 5: Refactor scheduler_cog.py with Cohort Autocomplete

**Files:**
- Modify: `discord_bot/cogs/scheduler_cog.py`

**Step 1: Rewrite scheduler_cog.py**

Replace entire file content:

```python
"""
Scheduler Cog - Discord adapter for the scheduling algorithm.
"""

import discord
from discord import app_commands
from discord.ext import commands

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import (
    format_time_range,
    schedule_cohort,
    CohortSchedulingResult,
)
from core.database import get_connection
from core.queries.cohorts import get_schedulable_cohorts


class SchedulerCog(commands.Cog):
    """Cog for cohort scheduling functionality."""

    def __init__(self, bot):
        self.bot = bot

    async def cohort_autocomplete(
        self,
        interaction: discord.Interaction,
        current: str,
    ) -> list[app_commands.Choice[int]]:
        """Autocomplete for cohorts with users awaiting grouping."""
        async with get_connection() as conn:
            cohorts = await get_schedulable_cohorts(conn)

        choices = []
        for cohort in cohorts[:25]:  # Discord limit
            display_name = f"{cohort['cohort_name']} ({cohort['pending_users']} pending)"
            if current.lower() in display_name.lower():
                choices.append(
                    app_commands.Choice(name=display_name[:100], value=cohort["cohort_id"])
                )

        return choices[:25]

    @app_commands.command(name="schedule", description="Run scheduling for a cohort")
    @app_commands.checks.has_permissions(administrator=True)
    @app_commands.describe(
        cohort="The cohort to schedule",
        meeting_length="Meeting length in minutes (default: 60)",
        min_people="Minimum people per group (default: 4)",
        max_people="Maximum people per group (default: 8)",
        iterations="Number of iterations to run (default: 1000)",
        balance="Balance group sizes after scheduling (default: True)",
        use_if_needed="Include 'if needed' times in scheduling (default: True)",
    )
    @app_commands.autocomplete(cohort=cohort_autocomplete)
    async def schedule(
        self,
        interaction: discord.Interaction,
        cohort: int,
        meeting_length: int = 60,
        min_people: int = 4,
        max_people: int = 8,
        iterations: int = 1000,
        balance: bool = True,
        use_if_needed: bool = True,
    ):
        """Run the scheduling algorithm for a specific cohort."""
        await interaction.response.defer()

        # Progress message
        progress_msg = await interaction.followup.send(
            "Running scheduling algorithm...",
            ephemeral=False
        )

        async def update_progress(current, total, best_score, total_people):
            try:
                await progress_msg.edit(
                    content=f"Scheduling...\n"
                            f"Iteration: {current}/{total} | "
                            f"Best: {best_score}/{total_people}"
                )
            except Exception:
                pass

        # Run scheduling
        try:
            result = await schedule_cohort(
                cohort_id=cohort,
                meeting_length=meeting_length,
                min_people=min_people,
                max_people=max_people,
                num_iterations=iterations,
                balance=balance,
                use_if_needed=use_if_needed,
                progress_callback=update_progress,
            )
        except ValueError as e:
            await progress_msg.edit(content=f"Error: {e}")
            return

        # Build results embed
        total_users = result.users_grouped + result.users_ungroupable
        placement_rate = (result.users_grouped * 100 // total_users) if total_users else 0

        embed = discord.Embed(
            title=f"Scheduling Complete: {result.cohort_name}",
            color=discord.Color.green() if placement_rate >= 80 else discord.Color.yellow()
        )

        embed.add_field(
            name="Summary",
            value=f"**Groups created:** {result.groups_created}\n"
                  f"**Users grouped:** {result.users_grouped}\n"
                  f"**Ungroupable:** {result.users_ungroupable}\n"
                  f"**Placement rate:** {placement_rate}%",
            inline=False
        )

        # List groups
        for group in result.groups:
            embed.add_field(
                name=f"{group['group_name']} ({group['member_count']} members)",
                value=f"**Meeting time:** {group['meeting_time']}",
                inline=True
            )

        embed.set_footer(text="Use /realize-groups to create Discord channels")

        await progress_msg.edit(content=None, embed=embed)


async def setup(bot):
    await bot.add_cog(SchedulerCog(bot))
```

**Step 2: Commit**

```bash
jj describe -m "refactor: update scheduler_cog with cohort autocomplete and DB persistence"
```

---

## Task 6: Rewrite groups_cog.py as /realize-groups Command

**Files:**
- Modify: `discord_bot/cogs/groups_cog.py`

**Step 1: Rewrite groups_cog.py**

Replace entire file content:

```python
"""
Groups Cog - Discord adapter for realizing groups from database.
Creates Discord channels, scheduled events, and welcome messages.
"""

import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timedelta
import pytz

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.database import get_connection, get_transaction
from core.queries.cohorts import get_realizable_cohorts, save_cohort_category_id
from core.queries.groups import (
    get_cohort_groups_for_realization,
    save_discord_channel_ids,
    get_group_welcome_data,
)
from core.cohorts import format_local_time


class GroupsCog(commands.Cog):
    """Cog for realizing groups in Discord from database."""

    def __init__(self, bot):
        self.bot = bot

    async def cohort_autocomplete(
        self,
        interaction: discord.Interaction,
        current: str,
    ) -> list[app_commands.Choice[int]]:
        """Autocomplete for cohorts with unrealized groups."""
        async with get_connection() as conn:
            cohorts = await get_realizable_cohorts(conn)

        choices = []
        for cohort in cohorts[:25]:
            display_name = f"{cohort['cohort_name']} - {cohort['course_name']}"
            if current.lower() in display_name.lower():
                choices.append(
                    app_commands.Choice(name=display_name[:100], value=cohort["cohort_id"])
                )

        return choices[:25]

    @app_commands.command(name="realize-groups", description="Create Discord channels for a cohort's groups")
    @app_commands.checks.has_permissions(administrator=True)
    @app_commands.describe(cohort="The cohort to create Discord channels for")
    @app_commands.autocomplete(cohort=cohort_autocomplete)
    async def realize_groups(
        self,
        interaction: discord.Interaction,
        cohort: int,
    ):
        """Create Discord category, channels, events, and welcome messages for cohort groups."""
        await interaction.response.defer()

        progress_msg = await interaction.followup.send(
            "Loading cohort data...",
            ephemeral=False
        )

        # Get cohort groups data
        async with get_connection() as conn:
            cohort_data = await get_cohort_groups_for_realization(conn, cohort)

        if not cohort_data:
            await progress_msg.edit(content="Cohort not found!")
            return

        if not cohort_data["groups"]:
            await progress_msg.edit(content="No groups found for this cohort. Run /schedule first.")
            return

        # Create category if it doesn't exist
        category = None
        if cohort_data["discord_category_id"]:
            try:
                category = await interaction.guild.fetch_channel(int(cohort_data["discord_category_id"]))
            except discord.NotFound:
                category = None

        if not category:
            await progress_msg.edit(content="Creating category...")
            category_name = f"{cohort_data['course_name']} - {cohort_data['cohort_name']}"[:100]
            category = await interaction.guild.create_category(
                name=category_name,
                reason=f"Realizing cohort {cohort}"
            )
            # Hide from everyone by default
            await category.set_permissions(interaction.guild.default_role, view_channel=False)

            # Save category ID
            async with get_transaction() as conn:
                await save_cohort_category_id(conn, cohort, str(category.id))

        # Create channels for each group
        created_count = 0
        for group_data in cohort_data["groups"]:
            # Skip if already realized
            if group_data["discord_text_channel_id"]:
                continue

            await progress_msg.edit(content=f"Creating channels for {group_data['group_name']}...")

            # Create text channel
            text_channel = await interaction.guild.create_text_channel(
                name=group_data["group_name"].lower().replace(" ", "-"),
                category=category,
                reason=f"Group channel for {group_data['group_name']}"
            )

            # Create voice channel
            voice_channel = await interaction.guild.create_voice_channel(
                name=f"{group_data['group_name']} Voice",
                category=category,
                reason=f"Voice channel for {group_data['group_name']}"
            )

            # Set permissions - only group members can see
            await text_channel.set_permissions(interaction.guild.default_role, view_channel=False)
            await voice_channel.set_permissions(interaction.guild.default_role, view_channel=False)

            for member_data in group_data["members"]:
                discord_id = member_data.get("discord_id")
                if discord_id:
                    try:
                        member = await interaction.guild.fetch_member(int(discord_id))
                        await text_channel.set_permissions(
                            member,
                            view_channel=True,
                            send_messages=True,
                            read_message_history=True,
                        )
                        await voice_channel.set_permissions(
                            member,
                            view_channel=True,
                            connect=True,
                            speak=True,
                        )
                    except discord.NotFound:
                        pass  # Member not in guild

            # Create scheduled events
            await progress_msg.edit(content=f"Creating events for {group_data['group_name']}...")

            events = await self._create_scheduled_events(
                interaction.guild,
                voice_channel,
                group_data,
                cohort_data,
            )

            # Save channel IDs to database
            async with get_transaction() as conn:
                await save_discord_channel_ids(
                    conn,
                    group_data["group_id"],
                    str(text_channel.id),
                    str(voice_channel.id),
                )

            # Send welcome message
            await self._send_welcome_message(
                text_channel,
                group_data,
                cohort_data,
                events[0].url if events else None,
            )

            created_count += 1

        # Summary
        embed = discord.Embed(
            title=f"Groups Realized: {cohort_data['cohort_name']}",
            color=discord.Color.green()
        )
        embed.add_field(
            name="Summary",
            value=f"**Category:** {category.name}\n"
                  f"**Groups created:** {created_count}\n"
                  f"**Total groups:** {len(cohort_data['groups'])}",
            inline=False
        )

        await progress_msg.edit(content=None, embed=embed)

    async def _create_scheduled_events(
        self,
        guild: discord.Guild,
        voice_channel: discord.VoiceChannel,
        group_data: dict,
        cohort_data: dict,
    ) -> list[discord.ScheduledEvent]:
        """Create scheduled events for group meetings."""
        events = []

        # Parse meeting time (e.g., "Wednesday 15:00-16:00")
        meeting_time_str = group_data.get("recurring_meeting_time_utc", "")
        if not meeting_time_str or meeting_time_str == "TBD":
            return events

        # Extract day and hour from format like "Wednesday 15:00-16:00"
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day_num = None
        hour = None

        for i, day in enumerate(day_names):
            if day in meeting_time_str:
                day_num = i
                # Extract hour
                parts = meeting_time_str.split()
                for part in parts:
                    if ":" in part:
                        hour = int(part.split(":")[0])
                        break
                break

        if day_num is None or hour is None:
            return events

        # Calculate first meeting date
        start_date = cohort_data["cohort_start_date"]
        if isinstance(start_date, str):
            start_date = datetime.fromisoformat(start_date)

        # Find first occurrence of the meeting day
        first_meeting = datetime.combine(start_date, datetime.min.time())
        first_meeting = first_meeting.replace(hour=hour, minute=0, tzinfo=pytz.UTC)

        days_ahead = day_num - first_meeting.weekday()
        if days_ahead < 0:
            days_ahead += 7
        first_meeting += timedelta(days=days_ahead)

        # Create events for each meeting
        num_meetings = cohort_data.get("number_of_group_meetings", 8)
        for week in range(num_meetings):
            meeting_time = first_meeting + timedelta(weeks=week)

            # Skip if in the past
            if meeting_time < datetime.now(pytz.UTC):
                continue

            try:
                event = await guild.create_scheduled_event(
                    name=f"{group_data['group_name']} - Week {week + 1}",
                    start_time=meeting_time,
                    end_time=meeting_time + timedelta(hours=1),
                    channel=voice_channel,
                    description=f"Weekly meeting for {group_data['group_name']}",
                    entity_type=discord.EntityType.voice,
                    privacy_level=discord.PrivacyLevel.guild_only,
                )
                events.append(event)
            except discord.HTTPException:
                pass  # Skip if event creation fails

        return events

    async def _send_welcome_message(
        self,
        channel: discord.TextChannel,
        group_data: dict,
        cohort_data: dict,
        first_event_url: str | None,
    ):
        """Send welcome message to group channel."""
        # Build member list
        member_lines = []
        for member in group_data["members"]:
            discord_id = member.get("discord_id")
            role = member.get("role", "participant")
            role_badge = " (Facilitator)" if role == "facilitator" else ""

            if discord_id:
                member_lines.append(f"- <@{discord_id}>{role_badge}")
            else:
                member_lines.append(f"- {member.get('name', 'Unknown')}{role_badge}")

        # Build schedule with local times
        schedule_lines = []
        meeting_time = group_data.get("recurring_meeting_time_utc", "TBD")

        for member in group_data["members"]:
            tz = member.get("timezone") or "UTC"
            discord_id = member.get("discord_id")

            # TODO: Convert UTC time to local for each member
            # For now, just show UTC
            if discord_id:
                schedule_lines.append(f"- <@{discord_id}>: {meeting_time} (UTC)")

        event_line = f"\n**First event:** {first_event_url}" if first_event_url else ""

        message = f"""**Welcome to {group_data['group_name']}!**

**Course:** {cohort_data['course_name']}
**Cohort:** {cohort_data['cohort_name']}

**Your group:**
{chr(10).join(member_lines)}

**Meeting time (UTC):** {meeting_time}
**Number of meetings:** {cohort_data.get('number_of_group_meetings', 8)}{event_line}

**Getting started:**
1. Introduce yourself!
2. Check your scheduled events
3. Prepare for Week 1

Questions? Ask in this channel. We're here to help each other learn!
"""
        await channel.send(message)


async def setup(bot):
    await bot.add_cog(GroupsCog(bot))
```

**Step 2: Commit**

```bash
jj describe -m "refactor: rewrite groups_cog as /realize-groups command"
```

---

## Task 7: Update core/__init__.py Exports

**Files:**
- Modify: `core/__init__.py`

**Step 1: Add new exports**

Add to the imports section:

```python
# Scheduling (with DB persistence)
from .scheduling import (
    Person, Group, CourseSchedulingResult, MultiCourseSchedulingResult,
    CohortSchedulingResult,  # NEW
    DAY_MAP,
    SchedulingError, NoUsersError, NoFacilitatorsError,
    parse_interval_string, calculate_total_available_time,
    is_group_valid, find_cohort_time_options, format_time_range,
    group_people_by_course, remove_blocked_intervals,
    run_greedy_iteration, run_scheduling, balance_cohorts,
    schedule_people, schedule, convert_user_data_to_people,
    schedule_cohort,  # NEW
)
```

Add to __all__:

```python
    'CohortSchedulingResult',
    'schedule_cohort',
```

**Step 2: Commit**

```bash
jj describe -m "chore: export new scheduling functions from core"
```

---

## Task 8: Test the Implementation

**Step 1: Run existing tests to check for regressions**

```bash
pytest discord_bot/tests/test_scheduler.py -v
```

Expected: All existing tests should pass.

**Step 2: Manual testing checklist**

1. Start the bot: `python main.py --dev --no-bot` (just to verify imports work)
2. Run the SQL migration if not done
3. Create a test cohort in the database with users
4. Test `/schedule` autocomplete
5. Test `/schedule` execution
6. Test `/realize-groups` autocomplete
7. Test `/realize-groups` execution

**Step 3: Final commit**

```bash
jj describe -m "feat: complete scheduler and groups refactor with DB persistence

- Add number_of_group_meetings and discord_category_id to cohorts table
- Add core/queries/cohorts.py with get_schedulable_cohorts, get_realizable_cohorts
- Add core/queries/groups.py with create_group, get_cohort_groups_for_realization
- Add schedule_cohort() to persist scheduling results to database
- Refactor /schedule with cohort autocomplete
- Rewrite /realize-groups to create Discord channels from DB"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Schema migration | `core/tables.py`, `migrations/` |
| 2 | Cohort query functions | `core/queries/cohorts.py` |
| 3 | Group query functions | `core/queries/groups.py` |
| 4 | schedule_cohort function | `core/scheduling.py` |
| 5 | Refactor scheduler_cog | `discord_bot/cogs/scheduler_cog.py` |
| 6 | Rewrite groups_cog | `discord_bot/cogs/groups_cog.py` |
| 7 | Update exports | `core/__init__.py` |
| 8 | Testing | Tests + manual verification |
