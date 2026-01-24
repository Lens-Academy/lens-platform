# Signup Overview View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a database view `signup_overview` that joins users, signups, groups, and groups_users to provide a consolidated view of signup data with group assignments.

**Architecture:** Manual Alembic migration with raw SQL (no new dependencies). Optionally add a SQLAlchemy Table definition for type-safe queries.

**Tech Stack:** PostgreSQL, Alembic, SQLAlchemy Core

---

## Background

### Tables Involved

| Table | Relevant Columns |
|-------|-----------------|
| `users` | `user_id`, `nickname`, `timezone`, `availability_local` |
| `signups` | `signup_id`, `user_id`, `cohort_id`, `role` (cohort_role), `ungroupable_reason` |
| `groups` | `group_id`, `cohort_id`, `recurring_meeting_time_utc` |
| `groups_users` | `user_id`, `group_id`, `status` |

### Output Columns

| Column | Source | Type |
|--------|--------|------|
| `signup_id` | `signups.signup_id` | Integer (PK) |
| `user_id` | `signups.user_id` | Integer |
| `cohort_id` | `signups.cohort_id` | Integer |
| `cohort_role` | `signups.role` | Enum (cohort_role_enum) |
| `ungroupable_reason` | `signups.ungroupable_reason` | Enum (nullable) |
| `nickname` | `users.nickname` | Text (nullable) |
| `timezone` | `users.timezone` | Text (nullable) |
| `availability_local` | `users.availability_local` | Text (nullable) |
| `group_id` | `groups.group_id` | Integer (nullable) |
| `recurring_meeting_time_utc` | `groups.recurring_meeting_time_utc` | Text (nullable) |

### Join Logic

```sql
signups
  LEFT JOIN users
    ON signups.user_id = users.user_id
  LEFT JOIN groups_users
    ON signups.user_id = groups_users.user_id
    AND groups_users.status = 'active'           -- Only active group memberships
  LEFT JOIN groups
    ON groups_users.group_id = groups.group_id
    AND groups.cohort_id = signups.cohort_id     -- Match cohort context
```

**Key design decisions:**
1. `groups_users.status = 'active'` - Excludes users who left groups (matches existing query patterns in `core/queries/groups.py`)
2. `groups.cohort_id = signups.cohort_id` - Ensures correct group for multi-cohort users
3. `signup_id` included as true primary key
4. `group_id` comes from `groups` table (not `groups_users`) to ensure it's NULL when cohort doesn't match

---

## Task 1: Create the Alembic Migration

**Step 1: Generate empty migration**

```bash
alembic revision -m "add signup_overview view"
```

**Step 2: Edit the generated migration file**

Open the new file in `alembic/versions/` and replace the contents with:

```python
"""add signup_overview view

Revision ID: <generated>
Revises: <previous>
Create Date: <generated>
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "<generated>"
down_revision = "<previous>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE VIEW signup_overview AS
        SELECT
            s.signup_id,
            s.user_id,
            s.cohort_id,
            s.role AS cohort_role,
            s.ungroupable_reason,
            u.nickname,
            u.timezone,
            u.availability_local,
            g.group_id,
            g.recurring_meeting_time_utc
        FROM signups s
        LEFT JOIN users u
            ON s.user_id = u.user_id
        LEFT JOIN groups_users gu
            ON s.user_id = gu.user_id
            AND gu.status = 'active'
        LEFT JOIN groups g
            ON gu.group_id = g.group_id
            AND g.cohort_id = s.cohort_id
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS signup_overview")
```

**Step 3: Commit**

```bash
jj desc -m "migration: add signup_overview view"
```

---

## Task 2: Apply Migration Locally

**Step 1: Run the migration**

```bash
alembic upgrade head
```

**Step 2: Verify the view works**

```bash
python -c "
from core.database import get_sync_database_url
from sqlalchemy import create_engine, text
engine = create_engine(get_sync_database_url())
with engine.connect() as conn:
    result = conn.execute(text('SELECT * FROM signup_overview LIMIT 5'))
    for row in result:
        print(dict(row._mapping))
"
```

**Step 3: Test edge cases**

```bash
python -c "
from core.database import get_sync_database_url
from sqlalchemy import create_engine, text
engine = create_engine(get_sync_database_url())
with engine.connect() as conn:
    # Check for any unexpected duplicates
    result = conn.execute(text('''
        SELECT signup_id, COUNT(*) as cnt
        FROM signup_overview
        GROUP BY signup_id
        HAVING COUNT(*) > 1
    '''))
    dupes = list(result)
    if dupes:
        print(f'WARNING: Found {len(dupes)} duplicate signup_ids')
    else:
        print('OK: No duplicates found')
"
```

---

## Task 3: Add SQLAlchemy Table Definition (Optional)

**Files:**
- Modify: `core/tables.py`

**Step 1: Add view table definition at the end of tables.py**

After the `content_events` table (after line 375), add:

```python
# =====================================================
# VIEWS
# =====================================================

# Signup Overview View - read-only table definition for querying
# The actual view is created via Alembic migration
signup_overview = Table(
    "signup_overview",
    metadata,
    Column("signup_id", Integer, primary_key=True),
    Column("user_id", Integer),
    Column("cohort_id", Integer),
    Column("cohort_role", cohort_role_enum),
    Column("ungroupable_reason", ungroupable_reason_enum),
    Column("nickname", Text),
    Column("timezone", Text),
    Column("availability_local", Text),
    Column("group_id", Integer),
    Column("recurring_meeting_time_utc", Text),
)
```

**Step 2: Verify import works**

```bash
python -c "from core.tables import signup_overview; print('Table definition loaded')"
```

**Step 3: Commit**

```bash
jj desc -m "feat: add signup_overview table definition for queries"
```

---

## Task 4: Add Query Helpers (Optional)

**Files:**
- Create: `core/queries/signup_overview.py`

**Step 1: Create the query helper file**

Create `core/queries/signup_overview.py`:

```python
"""Query helpers for the signup_overview view."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import signup_overview


async def get_signups_by_cohort(
    conn: AsyncConnection,
    cohort_id: int,
) -> list[dict[str, Any]]:
    """Get all signups for a cohort with user and group data."""
    query = select(signup_overview).where(signup_overview.c.cohort_id == cohort_id)
    result = await conn.execute(query)
    return [dict(row._mapping) for row in result]


async def get_signups_by_user(
    conn: AsyncConnection,
    user_id: int,
) -> list[dict[str, Any]]:
    """Get all signups for a user across cohorts."""
    query = select(signup_overview).where(signup_overview.c.user_id == user_id)
    result = await conn.execute(query)
    return [dict(row._mapping) for row in result]


async def get_ungrouped_signups(
    conn: AsyncConnection,
    cohort_id: int,
) -> list[dict[str, Any]]:
    """Get signups without an active group assignment."""
    query = (
        select(signup_overview)
        .where(signup_overview.c.cohort_id == cohort_id)
        .where(signup_overview.c.group_id.is_(None))
    )
    result = await conn.execute(query)
    return [dict(row._mapping) for row in result]
```

**Step 2: Run lint**

```bash
ruff check core/queries/signup_overview.py
ruff format core/queries/signup_overview.py
```

**Step 3: Commit**

```bash
jj desc -m "feat: add signup_overview query helpers"
```

---

## Task 5: Run Full Checks

**Step 1: Run Python linting**

```bash
ruff check .
ruff format --check .
```

**Step 2: Run tests**

```bash
pytest core/tests/ -v
```

**Step 3: Fix any issues found**

**Step 4: Final commit**

```bash
jj desc -m "chore: cleanup after signup_overview view"
```

---

## Summary

| File | Change |
|------|--------|
| `alembic/versions/xxx_add_signup_overview_view.py` | Migration with CREATE VIEW |
| `core/tables.py` | Table definition for type-safe queries (optional) |
| `core/queries/signup_overview.py` | Query helpers (optional) |

**No new dependencies required.**

**View columns:**
- `signup_id` - primary key
- `user_id`, `cohort_id` - signup identifiers
- `cohort_role` - participant or facilitator
- `ungroupable_reason` - why user couldn't be grouped (nullable)
- `nickname`, `timezone`, `availability_local` - user data
- `group_id`, `recurring_meeting_time_utc` - group assignment (nullable if ungrouped)
