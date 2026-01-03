"""Tests for cohort query functions."""

import pytest
from datetime import date, timedelta

from sqlalchemy import insert

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.tables import courses, cohorts, courses_users, users
from core.queries.cohorts import get_available_cohorts
from core.enums import CohortRole, GroupingStatus


class TestGetAvailableCohorts:
    """Tests for get_available_cohorts query."""

    @pytest.mark.asyncio
    async def test_returns_future_cohorts(self, db_conn):
        """Should return cohorts with start_date > today."""
        # Create course
        course_result = await db_conn.execute(
            insert(courses).values(course_name="Test Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        # Create future cohort
        future_date = date.today() + timedelta(days=30)
        cohort_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Future Cohort",
                course_id=course["course_id"],
                cohort_start_date=future_date,
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        future_cohort = dict(cohort_result.mappings().first())

        # Create past cohort (should not appear)
        past_date = date.today() - timedelta(days=30)
        await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Past Cohort",
                course_id=course["course_id"],
                cohort_start_date=past_date,
                duration_days=56,
                number_of_group_meetings=8,
            )
        )

        result = await get_available_cohorts(db_conn, user_id=None)

        # Find our created cohorts in results (DB may have existing cohorts)
        available_ids = [c["cohort_id"] for c in result["available"]]
        assert future_cohort["cohort_id"] in available_ids

        # Find our future cohort in results and verify data
        our_cohort = next(
            c for c in result["available"] if c["cohort_id"] == future_cohort["cohort_id"]
        )
        assert our_cohort["cohort_name"] == "Future Cohort"
        assert result["enrolled"] == []

        # Verify past cohort is not in results
        past_cohort_names = [c["cohort_name"] for c in result["available"]]
        assert "Past Cohort" not in past_cohort_names

    @pytest.mark.asyncio
    async def test_shows_enrolled_cohorts_separately(self, db_conn):
        """Should separate enrolled cohorts from available ones."""
        # Create course and user
        course_result = await db_conn.execute(
            insert(courses).values(course_name="Test Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="test_user_123",
                discord_username="testuser",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        # Create two future cohorts
        future_date = date.today() + timedelta(days=30)
        cohort1_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Enrolled Cohort",
                course_id=course["course_id"],
                cohort_start_date=future_date,
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort1 = dict(cohort1_result.mappings().first())

        cohort2_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Available Cohort",
                course_id=course["course_id"],
                cohort_start_date=future_date + timedelta(days=30),
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort2 = dict(cohort2_result.mappings().first())

        # Enroll user in first cohort
        await db_conn.execute(
            insert(courses_users).values(
                user_id=user["user_id"],
                course_id=course["course_id"],
                cohort_id=cohort1["cohort_id"],
                role_in_cohort=CohortRole.participant,
                grouping_status=GroupingStatus.awaiting_grouping,
            )
        )

        result = await get_available_cohorts(db_conn, user_id=user["user_id"])

        # Find our enrolled cohort in results
        enrolled_ids = [c["cohort_id"] for c in result["enrolled"]]
        assert cohort1["cohort_id"] in enrolled_ids

        our_enrolled = next(
            c for c in result["enrolled"] if c["cohort_id"] == cohort1["cohort_id"]
        )
        assert our_enrolled["role"] == "participant"

        # Find our available cohort in results
        available_ids = [c["cohort_id"] for c in result["available"]]
        assert cohort2["cohort_id"] in available_ids

        # Verify enrolled cohort is NOT in available list
        assert cohort1["cohort_id"] not in available_ids


from core.queries.users import is_facilitator_by_user_id
from core.users import become_facilitator


class TestIsFacilitatorByUserId:
    """Tests for is_facilitator_by_user_id query."""

    @pytest.mark.asyncio
    async def test_returns_false_when_not_facilitator(self, db_conn):
        """Should return False for regular user."""
        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="regular_user",
                discord_username="regular",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        result = await is_facilitator_by_user_id(db_conn, user["user_id"])

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_true_when_facilitator(self, db_conn):
        """Should return True for user in facilitators table."""
        from core.tables import facilitators

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="fac_user",
                discord_username="facilitator",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        await db_conn.execute(
            insert(facilitators).values(user_id=user["user_id"])
        )

        result = await is_facilitator_by_user_id(db_conn, user["user_id"])

        assert result is True


class TestBecomeFacilitator:
    """Tests for become_facilitator function."""

    @pytest.mark.asyncio
    async def test_adds_user_to_facilitators(self, db_conn):
        """Should add user to facilitators table."""
        from core.tables import facilitators

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="new_fac",
                discord_username="newfac",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        # Commit so become_facilitator can see the user
        await db_conn.commit()

        result = await become_facilitator("new_fac")

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_true_if_already_facilitator(self, db_conn):
        """Should return True even if already a facilitator."""
        from core.tables import facilitators

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="existing_fac",
                discord_username="existingfac",
            ).returning(users)
        )
        user = dict(user_result.mappings().first())

        await db_conn.execute(
            insert(facilitators).values(user_id=user["user_id"])
        )
        await db_conn.commit()

        result = await become_facilitator("existing_fac")

        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_if_user_doesnt_exist(self, db_conn):
        """Should return False if user doesn't exist."""
        result = await become_facilitator("nonexistent_user_12345")

        assert result is False


from core.users import enroll_in_cohort


class TestEnrollInCohort:
    """Tests for enroll_in_cohort function."""

    @pytest.mark.asyncio
    async def test_creates_enrollment_record(self, db_conn):
        """Should create courses_users record."""
        # Setup
        course_result = await db_conn.execute(
            insert(courses).values(course_name="Test Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        cohort_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Test Cohort",
                course_id=course["course_id"],
                cohort_start_date=date.today() + timedelta(days=30),
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort = dict(cohort_result.mappings().first())

        user_result = await db_conn.execute(
            insert(users).values(
                discord_id="enroll_user",
                discord_username="enrolluser",
            ).returning(users)
        )
        await db_conn.commit()

        # Act
        result = await enroll_in_cohort("enroll_user", cohort["cohort_id"], "participant")

        # Assert
        assert result is not None
        assert result["cohort_id"] == cohort["cohort_id"]
        assert result["role_in_cohort"] == "participant"
        assert result["grouping_status"] == "awaiting_grouping"

    @pytest.mark.asyncio
    async def test_enrolls_as_facilitator(self, db_conn):
        """Should create enrollment record with facilitator role."""
        # Setup
        course_result = await db_conn.execute(
            insert(courses).values(course_name="Facilitator Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        cohort_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="Facilitator Cohort",
                course_id=course["course_id"],
                cohort_start_date=date.today() + timedelta(days=30),
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort = dict(cohort_result.mappings().first())

        await db_conn.execute(
            insert(users).values(
                discord_id="fac_enroll_user",
                discord_username="facenrolluser",
            ).returning(users)
        )
        await db_conn.commit()

        # Act
        result = await enroll_in_cohort("fac_enroll_user", cohort["cohort_id"], "facilitator")

        # Assert
        assert result is not None
        assert result["role_in_cohort"] == "facilitator"

    @pytest.mark.asyncio
    async def test_returns_none_for_invalid_cohort(self, db_conn):
        """Should return None if cohort doesn't exist."""
        await db_conn.execute(
            insert(users).values(
                discord_id="bad_cohort_user",
                discord_username="badcohort",
            ).returning(users)
        )
        await db_conn.commit()

        result = await enroll_in_cohort("bad_cohort_user", 99999, "participant")

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_for_invalid_user(self, db_conn):
        """Should return None if user doesn't exist."""
        # Setup - create a cohort but no user
        course_result = await db_conn.execute(
            insert(courses).values(course_name="No User Course").returning(courses)
        )
        course = dict(course_result.mappings().first())

        cohort_result = await db_conn.execute(
            insert(cohorts).values(
                cohort_name="No User Cohort",
                course_id=course["course_id"],
                cohort_start_date=date.today() + timedelta(days=30),
                duration_days=56,
                number_of_group_meetings=8,
            ).returning(cohorts)
        )
        cohort = dict(cohort_result.mappings().first())
        await db_conn.commit()

        result = await enroll_in_cohort("nonexistent_discord_id_12345", cohort["cohort_id"], "participant")

        assert result is None
