"""Tests for progress tools (get_my_progress, get_my_upcoming_deadlines)."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, date, timezone, timedelta
from core.agents.tools.progress_tools import (
    execute_get_my_progress,
    execute_get_my_upcoming_deadlines,
    get_user_course_slug,
    PROGRESS_TOOL_SCHEMAS,
)


@pytest.mark.asyncio
async def test_get_user_course_slug_returns_slug():
    """Returns course_slug when user is in an active group."""
    from core.database import get_transaction
    from core.tables import users, cohorts, groups, groups_users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(pg_insert(users).values(user_id=80001, discord_id="test_pt_80001").on_conflict_do_nothing())
        await conn.execute(
            pg_insert(cohorts).values(
                cohort_id=8001, cohort_name="Test Cohort", course_slug="test-course",
                cohort_start_date=date(2026, 1, 1), duration_days=56, number_of_group_meetings=8,
            ).on_conflict_do_nothing()
        )
        await conn.execute(pg_insert(groups).values(group_id=8001, group_name="Test Group", cohort_id=8001).on_conflict_do_nothing())
        await conn.execute(
            pg_insert(groups_users).values(user_id=80001, group_id=8001, role="participant", status="active").on_conflict_do_nothing()
        )

    slug = await get_user_course_slug(80001)
    assert slug == "test-course"


@pytest.mark.asyncio
async def test_get_user_course_slug_returns_none_for_unenrolled():
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(pg_insert(users).values(user_id=80002, discord_id="test_pt_80002").on_conflict_do_nothing())

    slug = await get_user_course_slug(80002)
    assert slug is None


@pytest.mark.asyncio
async def test_get_my_progress_unenrolled():
    result = await execute_get_my_progress(80002)
    assert "not enrolled" in result.lower() or "not currently" in result.lower()


@pytest.mark.asyncio
@patch("core.agents.tools.progress_tools.load_course")
@patch("core.agents.tools.progress_tools.load_flattened_module")
@patch("core.agents.tools.progress_tools.get_completed_content_ids", new_callable=AsyncMock)
async def test_get_my_progress_formats_output(mock_completed, mock_module, mock_course):
    mod1 = MagicMock(); mod1.slug = "mod-1"; mod1.optional = False
    mod2 = MagicMock(); mod2.slug = "mod-2"; mod2.optional = False
    course = MagicMock(); course.title = "AI Safety Fundamentals"; course.progression = [mod1, mod2]
    mock_course.return_value = course

    flat_mod1 = MagicMock(); flat_mod1.title = "Introduction"
    flat_mod1.sections = [{"contentId": "uuid-1", "type": "lens"}, {"contentId": "uuid-2", "type": "lens"}]
    flat_mod2 = MagicMock(); flat_mod2.title = "Risks"
    flat_mod2.sections = [{"contentId": "uuid-3", "type": "lens"}, {"contentId": "uuid-4", "type": "lens"}, {"contentId": "uuid-5", "type": "lens"}]
    mock_module.side_effect = lambda slug: {"mod-1": flat_mod1, "mod-2": flat_mod2}[slug]

    mock_completed.return_value = {"uuid-1", "uuid-2"}

    result = await execute_get_my_progress(80001)
    assert "AI Safety Fundamentals" in result
    assert "2/5" in result
    assert "Introduction" in result
    assert "2/2" in result
    assert "Risks" in result
    assert "0/3" in result


@pytest.mark.asyncio
async def test_get_my_upcoming_deadlines_unenrolled():
    result = await execute_get_my_upcoming_deadlines(80002)
    assert "not enrolled" in result.lower() or "not currently" in result.lower()


@pytest.mark.asyncio
@patch("core.agents.tools.progress_tools.get_meeting_dates_for_user", new_callable=AsyncMock)
@patch("core.agents.tools.progress_tools.load_course")
@patch("core.agents.tools.progress_tools.get_due_by_meeting")
@patch("core.agents.tools.progress_tools.load_flattened_module")
async def test_get_my_upcoming_deadlines_formats_output(mock_flat, mock_due_by, mock_course, mock_meetings):
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    mock_meetings.return_value = {4: tomorrow}

    mod1 = MagicMock(); mod1.slug = "mod-1"; mod1.optional = False
    course = MagicMock(); course.title = "AI Safety"; course.progression = [mod1]
    mock_course.return_value = course
    mock_due_by.return_value = 4

    flat_mod1 = MagicMock(); flat_mod1.title = "Introduction"
    mock_flat.return_value = flat_mod1

    result = await execute_get_my_upcoming_deadlines(80001)
    assert "Meeting 4" in result


def test_schemas_have_correct_names():
    names = {s["function"]["name"] for s in PROGRESS_TOOL_SCHEMAS}
    assert names == {"get_my_progress", "get_my_upcoming_deadlines"}
