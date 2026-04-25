"""Tests for per-turn context injection."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timezone, timedelta
from core.agents.coach.context import build_context_block


@pytest.mark.asyncio
@patch("core.agents.coach.context.get_user_course_slug", new_callable=AsyncMock, return_value=None)
async def test_unenrolled_user_gets_minimal_context(mock_slug):
    result = await build_context_block(user_id=1)
    assert result is not None
    assert isinstance(result, str)


@pytest.mark.asyncio
@patch("core.agents.coach.context.get_meeting_dates_for_user", new_callable=AsyncMock)
@patch("core.agents.coach.context.get_completed_content_ids", new_callable=AsyncMock)
@patch("core.agents.coach.context.load_flattened_module")
@patch("core.agents.coach.context.load_course")
@patch("core.agents.coach.context.get_user_course_slug", new_callable=AsyncMock)
async def test_enrolled_user_gets_full_context(
    mock_slug, mock_course, mock_module, mock_completed, mock_meetings
):
    mock_slug.return_value = "test-course"

    mod1 = MagicMock(); mod1.slug = "mod-1"; mod1.optional = False
    course = MagicMock(); course.title = "AI Safety"; course.progression = [mod1]
    mock_course.return_value = course

    flat = MagicMock(); flat.title = "Intro"
    flat.sections = [
        {"contentId": "uuid-1", "type": "lens"},
        {"contentId": "uuid-2", "type": "lens"},
    ]
    mock_module.return_value = flat

    mock_completed.return_value = {"uuid-1"}

    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    mock_meetings.return_value = {4: tomorrow}

    result = await build_context_block(user_id=1)
    assert "1/2" in result
    assert "Meeting 4" in result


@pytest.mark.asyncio
@patch("core.agents.coach.context.get_user_course_slug", new_callable=AsyncMock, return_value="test")
@patch("core.agents.coach.context.load_course", side_effect=Exception("cache not init"))
async def test_context_gracefully_handles_errors(mock_course, mock_slug):
    result = await build_context_block(user_id=1)
    assert result is not None  # Returns something, even on error
