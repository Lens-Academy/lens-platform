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
    module_sessions,
    content_events,
)
from core.enums import ContentEventType
from core.queries.facilitator import (
    is_admin,
    get_facilitator_group_ids,
    get_accessible_groups,
    can_access_group,
)
from core.queries.progress import (
    get_group_members_summary,
    get_user_progress_for_group,
    get_user_chat_sessions,
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


async def create_module_session(
    conn, user_id: int, module_slug: str, completed: bool = False
) -> dict:
    """Create a module session for a user."""
    from datetime import datetime, timezone

    values = {
        "user_id": user_id,
        "module_slug": module_slug,
        "current_stage_index": 0,
        "messages": [],
    }
    if completed:
        values["completed_at"] = datetime.now(timezone.utc)

    result = await conn.execute(
        insert(module_sessions).values(**values).returning(module_sessions)
    )
    return dict(result.mappings().first())


async def create_heartbeat(
    conn,
    user_id: int,
    session_id: int,
    module_slug: str,
    stage_index: int,
    stage_type: str,
) -> dict:
    """Create a heartbeat event."""
    result = await conn.execute(
        insert(content_events)
        .values(
            user_id=user_id,
            session_id=session_id,
            module_slug=module_slug,
            stage_index=stage_index,
            stage_type=stage_type,
            event_type=ContentEventType.heartbeat,
        )
        .returning(content_events)
    )
    return dict(result.mappings().first())


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
# Progress Aggregation Tests
# ============================================================================


class TestGetGroupMembersSummary:
    """Tests for get_group_members_summary query."""

    @pytest.mark.asyncio
    async def test_returns_members_with_zero_progress(self, db_conn):
        """Should return members even with no activity."""
        user = await create_test_user(db_conn, "member_no_progress", "Alice")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        await add_user_to_group(
            db_conn, user["user_id"], group["group_id"], "participant"
        )

        result = await get_group_members_summary(db_conn, group["group_id"])

        assert len(result) == 1
        assert result[0]["user_id"] == user["user_id"]
        assert result[0]["name"] == "Alice"
        assert result[0]["lessons_completed"] == 0
        assert result[0]["total_time_seconds"] == 0

    @pytest.mark.asyncio
    async def test_counts_completed_lessons(self, db_conn):
        """Should count completed lesson sessions."""
        user = await create_test_user(db_conn, "member_completed")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        await add_user_to_group(
            db_conn, user["user_id"], group["group_id"], "participant"
        )

        # Create completed and incomplete sessions
        await create_module_session(
            db_conn, user["user_id"], "lesson-1", completed=True
        )
        await create_module_session(
            db_conn, user["user_id"], "lesson-2", completed=True
        )
        await create_module_session(
            db_conn, user["user_id"], "lesson-3", completed=False
        )

        result = await get_group_members_summary(db_conn, group["group_id"])

        assert result[0]["lessons_completed"] == 2

    @pytest.mark.asyncio
    async def test_calculates_time_from_heartbeats(self, db_conn):
        """Should calculate time as heartbeat_count * 30 seconds."""
        user = await create_test_user(db_conn, "member_heartbeats")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])
        await add_user_to_group(
            db_conn, user["user_id"], group["group_id"], "participant"
        )

        session = await create_module_session(db_conn, user["user_id"], "lesson-1")

        # Create 4 heartbeats = 120 seconds
        for _ in range(4):
            await create_heartbeat(
                db_conn,
                user["user_id"],
                session["session_id"],
                "lesson-1",
                0,
                "article",
            )

        result = await get_group_members_summary(db_conn, group["group_id"])

        assert result[0]["total_time_seconds"] == 120  # 4 * 30


class TestGetUserProgressForGroup:
    """Tests for get_user_progress_for_group query."""

    @pytest.mark.asyncio
    async def test_returns_empty_for_no_progress(self, db_conn):
        """Should return empty modules for user with no sessions."""
        user = await create_test_user(db_conn, "no_progress_user")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])

        result = await get_user_progress_for_group(
            db_conn, user["user_id"], group["group_id"]
        )

        assert result["modules"] == []
        assert result["total_time_seconds"] == 0

    @pytest.mark.asyncio
    async def test_groups_heartbeats_by_module_and_stage(self, db_conn):
        """Should group heartbeats by module and stage."""
        user = await create_test_user(db_conn, "progress_user")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])

        session = await create_module_session(db_conn, user["user_id"], "intro-module")

        # Article stage: 2 heartbeats = 60 sec
        await create_heartbeat(
            db_conn,
            user["user_id"],
            session["session_id"],
            "intro-module",
            0,
            "article",
        )
        await create_heartbeat(
            db_conn,
            user["user_id"],
            session["session_id"],
            "intro-module",
            0,
            "article",
        )

        # Chat stage: 3 heartbeats = 90 sec
        await create_heartbeat(
            db_conn, user["user_id"], session["session_id"], "intro-module", 1, "chat"
        )
        await create_heartbeat(
            db_conn, user["user_id"], session["session_id"], "intro-module", 1, "chat"
        )
        await create_heartbeat(
            db_conn, user["user_id"], session["session_id"], "intro-module", 1, "chat"
        )

        result = await get_user_progress_for_group(
            db_conn, user["user_id"], group["group_id"]
        )

        assert len(result["modules"]) == 1
        module = result["modules"][0]
        assert module["module_slug"] == "intro-module"
        assert module["time_spent_seconds"] == 150  # 60 + 90
        assert len(module["stages"]) == 2

        # Find stages by index
        article_stage = next(s for s in module["stages"] if s["stage_index"] == 0)
        chat_stage = next(s for s in module["stages"] if s["stage_index"] == 1)

        assert article_stage["time_spent_seconds"] == 60
        assert chat_stage["time_spent_seconds"] == 90


class TestGetUserChatSessions:
    """Tests for get_user_chat_sessions query."""

    @pytest.mark.asyncio
    async def test_returns_sessions_with_messages(self, db_conn):
        """Should return chat sessions with message history."""
        user = await create_test_user(db_conn, "chat_user")
        cohort = await create_test_cohort(db_conn)
        group = await create_test_group(db_conn, cohort["cohort_id"])

        # Create session with messages
        result = await db_conn.execute(
            insert(module_sessions)
            .values(
                user_id=user["user_id"],
                module_slug="chat-module",
                current_stage_index=0,
                messages=[
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "Hi there!"},
                ],
            )
            .returning(module_sessions)
        )
        dict(result.mappings().first())

        result = await get_user_chat_sessions(
            db_conn, user["user_id"], group["group_id"]
        )

        assert len(result) == 1
        assert result[0]["module_slug"] == "chat-module"
        assert len(result[0]["messages"]) == 2
        assert result[0]["messages"][0]["content"] == "Hello"
