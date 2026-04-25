"""Tests for the coach scheduled job processor."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timezone, timedelta

from core.agents.job_processor import process_due_coach_jobs, _fire_coach_job


async def _create_test_job(user_id: int, fire_at: datetime, reason: str, status: str = "pending"):
    from core.database import get_transaction
    from core.tables import coach_scheduled_jobs, users
    from sqlalchemy import insert
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=user_id, discord_id=f"test_jp_{user_id}")
            .on_conflict_do_nothing()
        )
        result = await conn.execute(
            insert(coach_scheduled_jobs)
            .values(user_id=user_id, fire_at=fire_at, reason=reason, status=status)
            .returning(coach_scheduled_jobs.c.job_id)
        )
        return result.scalar()


async def _get_job_status(job_id):
    from core.database import get_connection
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs.c.status).where(
                coach_scheduled_jobs.c.job_id == job_id
            )
        )
        return result.scalar()


async def _cancel_pending_jobs_for_user(user_id: int):
    """Cancel all pending jobs for a user to avoid cross-test interference."""
    from core.database import get_transaction
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import update

    async with get_transaction() as conn:
        await conn.execute(
            update(coach_scheduled_jobs)
            .where(
                coach_scheduled_jobs.c.user_id == user_id,
                coach_scheduled_jobs.c.status == "pending",
            )
            .values(status="cancelled")
        )


@pytest.mark.asyncio
@patch("core.agents.job_processor._fire_coach_job", new_callable=AsyncMock)
async def test_process_picks_up_due_jobs(mock_fire):
    # Cancel any stale pending jobs for this user from previous runs
    await _cancel_pending_jobs_for_user(60001)

    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    job_id = await _create_test_job(60001, past, "Check-in")
    await process_due_coach_jobs()
    assert mock_fire.call_count >= 1
    # Verify our specific job was fired
    fired_job_ids = [call.args[0]["job_id"] for call in mock_fire.call_args_list]
    assert job_id in fired_job_ids


@pytest.mark.asyncio
@patch("core.agents.job_processor._fire_coach_job", new_callable=AsyncMock)
async def test_process_skips_future_jobs(mock_fire):
    # Cancel any stale pending jobs from previous runs to ensure no due jobs exist
    # Use a unique user_id to isolate, but we also need to ensure no OTHER user's
    # due jobs exist. We only cancel for this specific user.
    await _cancel_pending_jobs_for_user(60002)

    future = datetime.now(timezone.utc) + timedelta(hours=1)
    await _create_test_job(60002, future, "Not yet")

    # Cancel any other pending due jobs that might interfere
    # by cancelling ALL pending due jobs for any test user
    from core.database import get_transaction
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import update
    now = datetime.now(timezone.utc)

    # Cancel all pending due jobs for test users (user_id 60001-60999)
    async with get_transaction() as conn:
        await conn.execute(
            update(coach_scheduled_jobs)
            .where(
                coach_scheduled_jobs.c.user_id.between(60000, 60999),
                coach_scheduled_jobs.c.status == "pending",
                coach_scheduled_jobs.c.fire_at <= now,
            )
            .values(status="cancelled")
        )

    await process_due_coach_jobs()
    mock_fire.assert_not_called()


@pytest.mark.asyncio
@patch("core.agents.job_processor.send_dm", new_callable=AsyncMock, return_value="msg_123")
@patch("core.agents.job_processor.acompletion", new_callable=AsyncMock)
async def test_fire_sends_dm(mock_llm, mock_dm):
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=60003, discord_id="test_jp_60003")
            .on_conflict_do_nothing()
        )

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    job_id = await _create_test_job(60003, past, "Daily check-in")

    msg = MagicMock()
    msg.content = "Hey! How's studying going today?"
    msg.tool_calls = None
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]
    mock_llm.return_value = response

    from core.database import get_connection
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs).where(coach_scheduled_jobs.c.job_id == job_id)
        )
        job = dict(result.mappings().first())

    await _fire_coach_job(job)

    mock_dm.assert_called_once_with("test_jp_60003", "Hey! How's studying going today?")
    status = await _get_job_status(job_id)
    assert status == "sent"


@pytest.mark.asyncio
@patch("core.agents.job_processor.acompletion", new_callable=AsyncMock)
async def test_fire_skips_no_message(mock_llm):
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=60004, discord_id="test_jp_60004")
            .on_conflict_do_nothing()
        )

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    job_id = await _create_test_job(60004, past, "Check-in")

    msg = MagicMock()
    msg.content = "[NO_MESSAGE]"
    msg.tool_calls = None
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]
    mock_llm.return_value = response

    from core.database import get_connection
    from core.tables import coach_scheduled_jobs
    from sqlalchemy import select

    async with get_connection() as conn:
        result = await conn.execute(
            select(coach_scheduled_jobs).where(coach_scheduled_jobs.c.job_id == job_id)
        )
        job = dict(result.mappings().first())

    await _fire_coach_job(job)
    status = await _get_job_status(job_id)
    assert status == "skipped"
