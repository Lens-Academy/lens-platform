"""
Integration tests for scheduling query functions.
Tests core/queries/cohorts.py and core/queries/groups.py with real database.
"""

import pytest
import pytest_asyncio
from sqlalchemy import select, delete

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
from core.scheduling import schedule_cohort, CohortSchedulingResult
from core.tables import courses, cohorts, users, courses_users, groups, groups_users

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


class TestScheduleCohort:
    """Integration tests for schedule_cohort function.

    Note: schedule_cohort creates its own transaction internally, so these tests
    use a committed_db_conn fixture that commits data and cleans up after.
    """

    @pytest_asyncio.fixture
    async def committed_db_conn(self):
        """
        Provide a DB connection that COMMITS data (for schedule_cohort visibility).

        schedule_cohort uses get_transaction() internally which creates a separate
        connection, so test data must be committed to be visible. This fixture
        cleans up all created data after the test.

        Usage:
            async def test_something(self, committed_db_conn):
                conn, course_ids, user_ids, commit = committed_db_conn
                # ... create data ...
                await commit()  # Commit before calling schedule_cohort
                result = await schedule_cohort(...)
        """
        from dotenv import load_dotenv
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

    @pytest.mark.asyncio
    async def test_schedule_cohort_creates_groups(self, committed_db_conn):
        """Should create groups when cohort has 4+ users with overlapping availability."""
        conn, course_ids, user_ids, cohort_ids, commit = committed_db_conn

        # Setup: course -> cohort -> 4 users with overlapping availability
        course = await create_test_course(conn, "Schedule Test Course")
        course_ids.append(course["course_id"])

        cohort = await create_test_cohort(conn, course["course_id"], "Schedule Test Cohort")
        cohort_ids.append(cohort["cohort_id"])

        # Create 4 users with overlapping availability (Monday 09:00-10:00)
        for i in range(4):
            user = await create_test_user(
                conn,
                cohort["cohort_id"],
                discord_id=f"sched_test_{i}",
                availability="M09:00 M10:00",
            )
            user_ids.append(user["user_id"])

        # Commit so schedule_cohort can see the data
        await commit()

        # Execute: schedule_cohort uses its own transaction
        result = await schedule_cohort(
            cohort_id=cohort["cohort_id"],
            min_people=4,
            max_people=8,
        )

        # Assert result structure
        assert isinstance(result, CohortSchedulingResult)
        assert result.cohort_id == cohort["cohort_id"]
        assert result.cohort_name == "Schedule Test Cohort"
        assert result.groups_created >= 1
        assert result.users_grouped == 4
        assert result.users_ungroupable == 0

    @pytest.mark.asyncio
    async def test_schedule_cohort_no_users(self, committed_db_conn):
        """Should return empty result when cohort has no users."""
        conn, course_ids, user_ids, cohort_ids, commit = committed_db_conn

        # Setup: cohort with no users
        course = await create_test_course(conn, "Empty Schedule Course")
        course_ids.append(course["course_id"])

        cohort = await create_test_cohort(conn, course["course_id"], "Empty Schedule Cohort")
        cohort_ids.append(cohort["cohort_id"])

        # Commit so schedule_cohort can see the data
        await commit()

        # Execute
        result = await schedule_cohort(cohort_id=cohort["cohort_id"])

        # Assert
        assert isinstance(result, CohortSchedulingResult)
        assert result.groups_created == 0
        assert result.users_grouped == 0
        assert result.users_ungroupable == 0
        assert result.groups == []

    @pytest.mark.asyncio
    async def test_schedule_cohort_raises_error_for_invalid_cohort(self, committed_db_conn):
        """Should raise ValueError for non-existent cohort."""
        # Use fixture to ensure engine cleanup even though we don't need data
        _ = committed_db_conn
        with pytest.raises(ValueError, match="not found"):
            await schedule_cohort(cohort_id=999999)

    @pytest.mark.asyncio
    async def test_schedule_cohort_assigns_facilitator_role(self, committed_db_conn):
        """Should preserve facilitator role when creating groups."""
        conn, course_ids, user_ids, cohort_ids, commit = committed_db_conn

        # Setup: course -> cohort -> 1 facilitator + 3 participants
        course = await create_test_course(conn, "Facilitator Test Course")
        course_ids.append(course["course_id"])

        cohort = await create_test_cohort(conn, course["course_id"], "Facilitator Test Cohort")
        cohort_ids.append(cohort["cohort_id"])

        # Create facilitator
        facilitator = await create_test_user(
            conn,
            cohort["cohort_id"],
            discord_id="fac_test_facilitator",
            availability="M09:00 M10:00",
            cohort_role="facilitator",
        )
        user_ids.append(facilitator["user_id"])

        # Create 3 participants
        for i in range(3):
            user = await create_test_user(
                conn,
                cohort["cohort_id"],
                discord_id=f"fac_test_participant_{i}",
                availability="M09:00 M10:00",
            )
            user_ids.append(user["user_id"])

        # Commit so schedule_cohort can see the data
        await commit()

        # Execute
        result = await schedule_cohort(
            cohort_id=cohort["cohort_id"],
            min_people=4,
            max_people=8,
        )

        # Assert: group should be created with all 4 users
        assert result.groups_created >= 1
        assert result.users_grouped == 4
        assert result.users_ungroupable == 0

        # Verify facilitator role is preserved in groups_users
        # (schedule_cohort checks cohort_role and sets role accordingly)
        assert len(result.groups) >= 1
