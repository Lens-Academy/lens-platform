"""Tests for facilitator panel access control and progress queries.

Uses real database with rollback fixture (unit+1 integration tests).
"""

import pytest
from datetime import date, timedelta

from sqlalchemy import insert

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sqlalchemy import update

from core.tables import (
    users,
    cohorts,
    groups,
    groups_users,
)
from core.queries.facilitator import (
    is_admin,
    get_facilitator_group_ids,
    get_accessible_groups,
    can_access_group,
)


# ============================================================================
# Test Fixtures - Helpers for creating test data
# ============================================================================


async def create_test_user(conn, discord_id: str, username: str = None) -> dict:
    """Create a test user and return the row."""
    result = await conn.execute(
        insert(users)
        .values(
            discord_id=discord_id,
            discord_username=username or f"user_{discord_id}",
        )
        .returning(users)
    )
    return dict(result.mappings().first())


async def create_test_cohort(
    conn, name: str = "Test Cohort", course_slug: str = "test-course"
) -> dict:
    """Create a test cohort and return the row."""
    result = await conn.execute(
        insert(cohorts)
        .values(
            cohort_name=name,
            course_slug=course_slug,
            cohort_start_date=date.today() + timedelta(days=30),
            duration_days=56,
            number_of_group_meetings=8,
        )
        .returning(cohorts)
    )
    return dict(result.mappings().first())


async def create_test_group(conn, cohort_id: int, name: str = "Test Group") -> dict:
    """Create a test group and return the row."""
    result = await conn.execute(
        insert(groups)
        .values(
            cohort_id=cohort_id,
            group_name=name,
            status="active",
        )
        .returning(groups)
    )
    return dict(result.mappings().first())


async def add_user_to_group(
    conn, user_id: int, group_id: int, role: str = "participant"
) -> dict:
    """Add a user to a group with specified role."""
    result = await conn.execute(
        insert(groups_users)
        .values(
            user_id=user_id,
            group_id=group_id,
            role=role,
            status="active",
        )
        .returning(groups_users)
    )
    return dict(result.mappings().first())


async def make_admin(conn, user_id: int) -> None:
    """Grant admin role to a user by setting is_admin flag."""
    await conn.execute(
        update(users).where(users.c.user_id == user_id).values(is_admin=True)
    )


# ============================================================================
# Access Control Tests
# ============================================================================


class TestIsAdmin:
    """Tests for is_admin query."""

    @pytest.mark.asyncio
    async def test_returns_false_for_regular_user(self, db_conn):
        """Regular user should not be admin."""
        user = await create_test_user(db_conn, "regular_user_1")

        result = await is_admin(db_conn, user["user_id"])

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_for_admin(self, db_conn):
        """User with admin role should return True."""
        user = await create_test_user(db_conn, "admin_user_1")
        await make_admin(db_conn, user["user_id"])

        result = await is_admin(db_conn, user["user_id"])

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_for_nonexistent_user(self, db_conn):
        """Nonexistent user should return False."""
        result = await is_admin(db_conn, 99999)

        assert result is False


class TestGetFacilitatorGroupIds:
    """Tests for get_facilitator_group_ids query."""

    @pytest.mark.asyncio
    async def test_returns_empty_for_non_facilitator(self, db_conn):
        """User who isn't a facilitator should get empty list."""
        user = await create_test_user(db_conn, "non_fac_user")

        result = await get_facilitator_group_ids(db_conn, user["user_id"])

        assert result == []

    @pytest.mark.asyncio
    async def test_returns_group_ids_for_facilitator(self, db_conn):
        """Facilitator should get their group IDs."""
        user = await create_test_user(db_conn, "fac_user_1")
        cohort = await create_test_cohort(db_conn)
        group1 = await create_test_group(db_conn, cohort["cohort_id"], "Group A")
        group2 = await create_test_group(db_conn, cohort["cohort_id"], "Group B")

        # Make user facilitator of both groups
        await add_user_to_group(
            db_conn, user["user_id"], group1["group_id"], "facilitator"
        )
        await add_user_to_group(
            db_conn, user["user_id"], group2["group_id"], "facilitator"
        )

        result = await get_facilitator_group_ids(db_conn, user["user_id"])

        assert set(result) == {group1["group_id"], group2["group_id"]}

    @pytest.mark.asyncio
    async def test_excludes_participant_groups(self, db_conn):
        """Should not include groups where user is participant, not facilitator."""
        user = await create_test_user(db_conn, "mixed_role_user")
        cohort = await create_test_cohort(db_conn)
        fac_group = await create_test_group(
            db_conn, cohort["cohort_id"], "Facilitating"
        )
        part_group = await create_test_group(
            db_conn, cohort["cohort_id"], "Participating"
        )

        await add_user_to_group(
            db_conn, user["user_id"], fac_group["group_id"], "facilitator"
        )
        await add_user_to_group(
            db_conn, user["user_id"], part_group["group_id"], "participant"
        )

        result = await get_facilitator_group_ids(db_conn, user["user_id"])

        assert result == [fac_group["group_id"]]


class TestCanAccessGroup:
    """Tests for can_access_group query."""

    @pytest.mark.asyncio
    async def test_admin_can_access_any_group(self, db_conn):
        """Admin should have access to any group."""
        admin = await create_test_user(db_conn, "admin_access_test")
        await make_admin(db_conn, admin["user_id"])

        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])

        result = await can_access_group(db_conn, admin["user_id"], group["group_id"])

        assert result is True

    @pytest.mark.asyncio
    async def test_facilitator_can_access_own_group(self, db_conn):
        """Facilitator should access their own group."""
        user = await create_test_user(db_conn, "fac_access_own")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        await add_user_to_group(
            db_conn, user["user_id"], group["group_id"], "facilitator"
        )

        result = await can_access_group(db_conn, user["user_id"], group["group_id"])

        assert result is True

    @pytest.mark.asyncio
    async def test_facilitator_cannot_access_other_group(self, db_conn):
        """Facilitator should NOT access groups they don't facilitate."""
        user = await create_test_user(db_conn, "fac_no_access")
        cohort = await create_test_cohort(db_conn)
        own_group = await create_test_group(db_conn, cohort["cohort_id"], "Own Group")
        other_group = await create_test_group(
            db_conn, cohort["cohort_id"], "Other Group"
        )
        await add_user_to_group(
            db_conn, user["user_id"], own_group["group_id"], "facilitator"
        )

        result = await can_access_group(
            db_conn, user["user_id"], other_group["group_id"]
        )

        assert result is False

    @pytest.mark.asyncio
    async def test_participant_cannot_access_group_as_facilitator(self, db_conn):
        """Participant should NOT have facilitator access to their group."""
        user = await create_test_user(db_conn, "participant_no_fac_access")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        await add_user_to_group(
            db_conn, user["user_id"], group["group_id"], "participant"
        )

        result = await can_access_group(db_conn, user["user_id"], group["group_id"])

        assert result is False


class TestGetAccessibleGroups:
    """Tests for get_accessible_groups query."""

    @pytest.mark.asyncio
    async def test_admin_sees_all_groups(self, db_conn):
        """Admin should see all groups."""
        admin = await create_test_user(db_conn, "admin_all_groups")
        await make_admin(db_conn, admin["user_id"])

        cohort = await create_test_cohort(db_conn)
        group1 = await create_test_group(db_conn, cohort["cohort_id"], "Group 1")
        group2 = await create_test_group(db_conn, cohort["cohort_id"], "Group 2")

        result = await get_accessible_groups(db_conn, admin["user_id"])

        group_ids = [g["group_id"] for g in result]
        assert group1["group_id"] in group_ids
        assert group2["group_id"] in group_ids

    @pytest.mark.asyncio
    async def test_facilitator_sees_only_own_groups(self, db_conn):
        """Facilitator should only see their own groups."""
        fac = await create_test_user(db_conn, "fac_own_only")
        cohort = await create_test_cohort(db_conn)
        own_group = await create_test_group(db_conn, cohort["cohort_id"], "Own")
        other_group = await create_test_group(db_conn, cohort["cohort_id"], "Other")
        await add_user_to_group(
            db_conn, fac["user_id"], own_group["group_id"], "facilitator"
        )

        result = await get_accessible_groups(db_conn, fac["user_id"])

        group_ids = [g["group_id"] for g in result]
        assert own_group["group_id"] in group_ids
        assert other_group["group_id"] not in group_ids


# ============================================================================
# Progress Aggregation Tests - REMOVED
# ============================================================================
# The following test classes were removed because they tested functions from
# core/queries/progress.py which used the old module_sessions and content_events
# tables that have been removed:
# - TestGetGroupMembersSummary
# - TestGetUserProgressForGroup
# - TestGetUserChatSessions
#
# These tests need to be rewritten when facilitator progress features are
# reimplemented using the new user_content_progress and chat_sessions tables.
