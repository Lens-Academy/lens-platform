# Automatic Group Names Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace generic "Group 1" names with randomly-assigned names from a curated list of ~50 notable thinkers.

**Architecture:** New `core/group_names.py` module with a name pool and an async `pick_available_name(conn)` function. It queries the DB for names currently in use (active/preview groups, or groups that ended within the last 30 days), then picks randomly from the remaining pool. Called from `core/scheduling.py` during group creation.

**Tech Stack:** Python, SQLAlchemy async, PostgreSQL

---

### Task 1: Create `core/group_names.py` with name pool and picker

**Files:**
- Create: `core/group_names.py`
- Test: `core/tests/test_group_names.py`

**Step 1: Write the failing test**

Create `core/tests/test_group_names.py`:

```python
"""Tests for group name generation."""

import pytest
import pytest_asyncio
from sqlalchemy import insert, text

from core.group_names import GROUP_NAMES, pick_available_name
from core.tables import cohorts, groups


@pytest.mark.asyncio
async def test_pick_available_name_returns_name_from_pool(db_conn):
    """pick_available_name returns a name from GROUP_NAMES."""
    name = await pick_available_name(db_conn)
    assert name in GROUP_NAMES


@pytest.mark.asyncio
async def test_pick_available_name_excludes_active_groups(db_conn):
    """Names used by active/preview groups are excluded."""
    # Create a cohort first
    result = await db_conn.execute(
        insert(cohorts).values(
            cohort_name="Test Cohort",
            course_slug="default",
        ).returning(cohorts.c.cohort_id)
    )
    cohort_id = result.scalar()

    # Create groups using all but one name
    for name in GROUP_NAMES[:-1]:
        await db_conn.execute(
            insert(groups).values(
                cohort_id=cohort_id,
                group_name=name,
                recurring_meeting_time_utc="Wednesday 15:00",
                status="active",
            )
        )

    # The only available name should be the last one
    picked = await pick_available_name(db_conn)
    assert picked == GROUP_NAMES[-1]


@pytest.mark.asyncio
async def test_pick_available_name_excludes_recently_ended(db_conn):
    """Names used by groups that ended within 30 days are excluded."""
    result = await db_conn.execute(
        insert(cohorts).values(
            cohort_name="Test Cohort",
            course_slug="default",
        ).returning(cohorts.c.cohort_id)
    )
    cohort_id = result.scalar()

    # Create a completed group that ended 10 days ago
    await db_conn.execute(
        insert(groups).values(
            cohort_id=cohort_id,
            group_name=GROUP_NAMES[0],
            recurring_meeting_time_utc="Wednesday 15:00",
            status="completed",
            actual_end_date=text("CURRENT_DATE - INTERVAL '10 days'"),
        )
    )

    # That name should be excluded
    for _ in range(20):
        picked = await pick_available_name(db_conn)
        assert picked != GROUP_NAMES[0]


@pytest.mark.asyncio
async def test_pick_available_name_allows_old_ended(db_conn):
    """Names from groups that ended over 30 days ago can be reused."""
    result = await db_conn.execute(
        insert(cohorts).values(
            cohort_name="Test Cohort",
            course_slug="default",
        ).returning(cohorts.c.cohort_id)
    )
    cohort_id = result.scalar()

    # Use all names as completed groups that ended 60 days ago
    for name in GROUP_NAMES:
        await db_conn.execute(
            insert(groups).values(
                cohort_id=cohort_id,
                group_name=name,
                recurring_meeting_time_utc="Wednesday 15:00",
                status="completed",
                actual_end_date=text("CURRENT_DATE - INTERVAL '60 days'"),
            )
        )

    # All names should be available again
    picked = await pick_available_name(db_conn)
    assert picked in GROUP_NAMES


@pytest.mark.asyncio
async def test_pick_available_name_fallback_when_exhausted(db_conn):
    """Falls back to numbered names when all names are in use."""
    result = await db_conn.execute(
        insert(cohorts).values(
            cohort_name="Test Cohort",
            course_slug="default",
        ).returning(cohorts.c.cohort_id)
    )
    cohort_id = result.scalar()

    # Use ALL names as active groups
    for name in GROUP_NAMES:
        await db_conn.execute(
            insert(groups).values(
                cohort_id=cohort_id,
                group_name=name,
                recurring_meeting_time_utc="Wednesday 15:00",
                status="active",
            )
        )

    # Should fall back to numbered name
    picked = await pick_available_name(db_conn)
    assert picked.startswith("Group ")


def test_group_names_pool_size():
    """Pool has ~50 names."""
    assert len(GROUP_NAMES) >= 45
    assert len(GROUP_NAMES) <= 60


def test_group_names_no_duplicates():
    """No duplicate names in the pool."""
    assert len(GROUP_NAMES) == len(set(GROUP_NAMES))
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/penguin/code/lens-platform/ws1 && .venv/bin/pytest core/tests/test_group_names.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.group_names'`

**Step 3: Write the implementation**

Create `core/group_names.py`:

```python
"""Group name generation — assigns memorable names to study groups."""

import random

from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import groups

# ~50 notable thinkers spanning math, CS, philosophy, and science.
# Diverse across gender, era, and geography.
GROUP_NAMES = [
    "Archimedes",
    "Aristotle",
    "Babbage",
    "Bayes",
    "Boole",
    "Chomsky",
    "Church",
    "Copernicus",
    "Curie",
    "Darwin",
    "Descartes",
    "Dijkstra",
    "Dirac",
    "Einstein",
    "Erdős",
    "Euclid",
    "Euler",
    "Faraday",
    "Fermi",
    "Feynman",
    "Franklin",
    "Galileo",
    "Gauss",
    "Gödel",
    "Hamming",
    "Hawking",
    "Hopper",
    "Hypatia",
    "Kepler",
    "Knuth",
    "Kolmogorov",
    "Leibniz",
    "Lovelace",
    "Maxwell",
    "Mendeleev",
    "Newton",
    "Noether",
    "Pascal",
    "Pasteur",
    "Planck",
    "Poincaré",
    "Ramanujan",
    "Riemann",
    "Russell",
    "Shannon",
    "Socrates",
    "Tesla",
    "Turing",
    "Von Neumann",
    "Wiener",
]

COOLDOWN_DAYS = 30


async def pick_available_name(conn: AsyncConnection) -> str:
    """
    Pick a random group name not currently in use.

    A name is "in use" if:
    - An active or preview group uses it, OR
    - A completed/merged/cancelled group uses it and ended within the last 30 days
      (based on actual_end_date, falling back to expected_end_date)

    Falls back to "Group N" if all names are exhausted.
    """
    from sqlalchemy import func, text

    # Find names currently in use
    recently_ended = and_(
        groups.c.status.notin_(["active", "preview"]),
        func.coalesce(groups.c.actual_end_date, groups.c.expected_end_date)
        > text(f"CURRENT_DATE - INTERVAL '{COOLDOWN_DAYS} days'"),
    )

    active_or_preview = groups.c.status.in_(["active", "preview"])

    query = select(groups.c.group_name).where(
        or_(active_or_preview, recently_ended)
    )
    result = await conn.execute(query)
    used_names = {row.group_name for row in result}

    available = [n for n in GROUP_NAMES if n not in used_names]

    if available:
        return random.choice(available)

    # Fallback: find next unused number
    n = 1
    while f"Group {n}" in used_names:
        n += 1
    return f"Group {n}"
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/penguin/code/lens-platform/ws1 && .venv/bin/pytest core/tests/test_group_names.py -v`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
jj describe -m "feat: add group name pool and picker (core/group_names.py)"
```

---

### Task 2: Wire up group name picker in scheduling

**Files:**
- Modify: `core/scheduling.py:427-440` (the group creation loop)

**Step 1: Write the failing test**

Add to `core/tests/test_group_names.py`:

```python
@pytest.mark.asyncio
async def test_scheduling_uses_named_groups(db_conn):
    """Verify that schedule_cohort creates groups with names from the pool, not 'Group N'."""
    # This is an integration-level check — we just verify that created groups
    # have names from GROUP_NAMES (not "Group 1", "Group 2", etc.)
    # We can't easily run the full scheduler without availability data,
    # so we test the wiring indirectly by checking that create_group
    # is called with a name from the pool in the scheduling code.
    # The unit tests for pick_available_name cover the logic.
    pass  # Covered by Task 1 tests + manual verification
```

Actually, skip a separate test for this — the wiring is trivial (one line change) and `pick_available_name` is already tested.

**Step 1: Modify `core/scheduling.py`**

At the top of the file, add the import:

```python
from .group_names import pick_available_name
```

In the group creation loop (~line 437-440), change:

```python
                # Create group record
                group_record = await create_group(
                    conn,
                    cohort_id=cohort_id,
                    group_name=f"Group {i}",
                    recurring_meeting_time_utc=meeting_time,
                )
```

to:

```python
                # Create group record
                group_name = await pick_available_name(conn)
                group_record = await create_group(
                    conn,
                    cohort_id=cohort_id,
                    group_name=group_name,
                    recurring_meeting_time_utc=meeting_time,
                )
```

**Step 2: Run existing tests to verify nothing breaks**

Run: `cd /home/penguin/code/lens-platform/ws1 && .venv/bin/pytest core/tests/ -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
jj describe -m "feat: wire up group name picker in scheduling"
```

---

### Task 3: Update exports and remove old cohort naming

**Files:**
- Modify: `core/__init__.py:24-25, 167-168`
- Modify: `discord_bot/utils/__init__.py:26-27, 40-41`
- Delete: `core/cohort_names.py`

**Step 1: Update `core/__init__.py`**

Replace:

```python
# Cohort name generation
from .cohort_names import CohortNameGenerator, COHORT_NAMES
```

with:

```python
# Group name generation
from .group_names import GROUP_NAMES, pick_available_name
```

In `__all__`, replace:

```python
    # Cohort names
    "CohortNameGenerator",
    "COHORT_NAMES",
```

with:

```python
    # Group names
    "GROUP_NAMES",
    "pick_available_name",
```

**Step 2: Update `discord_bot/utils/__init__.py`**

Replace:

```python
    COHORT_NAMES,
    CohortNameGenerator,
```

with:

```python
    GROUP_NAMES,
    pick_available_name,
```

And in its `__all__`, replace:

```python
    "COHORT_NAMES",
    "CohortNameGenerator",
```

with:

```python
    "GROUP_NAMES",
    "pick_available_name",
```

**Step 3: Delete `core/cohort_names.py`**

```bash
rm core/cohort_names.py
```

**Step 4: Run all tests**

Run: `cd /home/penguin/code/lens-platform/ws1 && .venv/bin/pytest -v`
Expected: All tests PASS

**Step 5: Run lint**

Run: `cd /home/penguin/code/lens-platform/ws1 && ruff check . && ruff format --check .`
Expected: No errors

**Step 6: Commit**

```bash
jj describe -m "refactor: replace cohort naming with group naming exports"
```
