"""Tests for group name generation."""

import datetime

import pytest
from sqlalchemy import insert, text

from core.group_names import GROUP_NAMES, pick_available_name
from core.tables import cohorts, groups

# Shared cohort defaults for test inserts
_COHORT_DEFAULTS = dict(
    cohort_name="Test Cohort",
    course_slug="default",
    cohort_start_date=datetime.date(2026, 1, 1),
    duration_days=60,
    number_of_group_meetings=8,
)


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
        insert(cohorts).values(**_COHORT_DEFAULTS).returning(cohorts.c.cohort_id)
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
        insert(cohorts).values(**_COHORT_DEFAULTS).returning(cohorts.c.cohort_id)
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
async def test_pick_available_name_excludes_by_expected_end_date(db_conn):
    """Names excluded via expected_end_date when actual_end_date is NULL."""
    result = await db_conn.execute(
        insert(cohorts).values(**_COHORT_DEFAULTS).returning(cohorts.c.cohort_id)
    )
    cohort_id = result.scalar()

    # Create a completed group with no actual_end_date, expected_end_date 10 days ago
    await db_conn.execute(
        insert(groups).values(
            cohort_id=cohort_id,
            group_name=GROUP_NAMES[0],
            recurring_meeting_time_utc="Wednesday 15:00",
            status="completed",
            actual_end_date=None,
            expected_end_date=text("CURRENT_DATE - INTERVAL '10 days'"),
        )
    )

    # That name should be excluded (falls back to expected_end_date)
    for _ in range(20):
        picked = await pick_available_name(db_conn)
        assert picked != GROUP_NAMES[0]


@pytest.mark.asyncio
async def test_pick_available_name_allows_old_ended(db_conn):
    """Names from groups that ended over 30 days ago can be reused."""
    result = await db_conn.execute(
        insert(cohorts).values(**_COHORT_DEFAULTS).returning(cohorts.c.cohort_id)
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
        insert(cohorts).values(**_COHORT_DEFAULTS).returning(cohorts.c.cohort_id)
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


@pytest.mark.asyncio
async def test_pick_available_name_excludes_null_end_dates(db_conn):
    """Completed groups with no end dates at all are treated as in cooldown."""
    result = await db_conn.execute(
        insert(cohorts).values(**_COHORT_DEFAULTS).returning(cohorts.c.cohort_id)
    )
    cohort_id = result.scalar()

    await db_conn.execute(
        insert(groups).values(
            cohort_id=cohort_id,
            group_name=GROUP_NAMES[0],
            recurring_meeting_time_utc="Wednesday 15:00",
            status="completed",
            actual_end_date=None,
            expected_end_date=None,
        )
    )

    # Name should be excluded (no end date = assume still in cooldown)
    for _ in range(20):
        picked = await pick_available_name(db_conn)
        assert picked != GROUP_NAMES[0]


@pytest.mark.asyncio
async def test_pick_available_name_unique_within_transaction(db_conn):
    """Multiple picks in the same transaction return unique names."""
    result = await db_conn.execute(
        insert(cohorts).values(**_COHORT_DEFAULTS).returning(cohorts.c.cohort_id)
    )
    cohort_id = result.scalar()

    # Pick 5 names, inserting each as a group (mimicking scheduling loop)
    picked_names = []
    for _ in range(5):
        name = await pick_available_name(db_conn)
        picked_names.append(name)
        await db_conn.execute(
            insert(groups).values(
                cohort_id=cohort_id,
                group_name=name,
                recurring_meeting_time_utc="Wednesday 15:00",
                status="preview",
            )
        )

    assert len(picked_names) == len(set(picked_names)), (
        f"Duplicate names: {picked_names}"
    )


def test_group_names_pool_size():
    """Pool has ~50 names."""
    assert len(GROUP_NAMES) >= 45
    assert len(GROUP_NAMES) <= 60


def test_group_names_no_duplicates():
    """No duplicate names in the pool."""
    assert len(GROUP_NAMES) == len(set(GROUP_NAMES))
