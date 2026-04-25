"""Tests for scheduling tools (schedule_reminder, list_my_reminders, cancel_reminder)."""

import pytest
from datetime import datetime, timezone, timedelta

from core.agents.tools.scheduling_tools import (
    execute_schedule_reminder,
    execute_list_my_reminders,
    execute_cancel_reminder,
    SCHEDULING_TOOL_SCHEMAS,
    MAX_PENDING_JOBS,
    MAX_FUTURE_DAYS,
)


async def _setup_user(user_id: int):
    from core.database import get_transaction
    from core.tables import users
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    async with get_transaction() as conn:
        await conn.execute(
            pg_insert(users)
            .values(user_id=user_id, discord_id=f"test_st_{user_id}")
            .on_conflict_do_nothing()
        )


@pytest.mark.asyncio
async def test_schedule_reminder_creates_job():
    await _setup_user(70001)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    result = await execute_schedule_reminder(70001, fire_at, "Check-in")
    assert "Scheduled" in result or "scheduled" in result


@pytest.mark.asyncio
async def test_schedule_reminder_rejects_past():
    await _setup_user(70002)
    fire_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    result = await execute_schedule_reminder(70002, fire_at, "Too late")
    assert "past" in result.lower()


@pytest.mark.asyncio
async def test_schedule_reminder_rejects_too_far_future():
    await _setup_user(70003)
    fire_at = (datetime.now(timezone.utc) + timedelta(days=MAX_FUTURE_DAYS + 1)).isoformat()
    result = await execute_schedule_reminder(70003, fire_at, "Way out")
    assert "90 days" in result or "too far" in result.lower()


@pytest.mark.asyncio
async def test_schedule_reminder_rate_limit():
    await _setup_user(70004)
    for i in range(MAX_PENDING_JOBS):
        fire_at = (datetime.now(timezone.utc) + timedelta(hours=i + 1)).isoformat()
        await execute_schedule_reminder(70004, fire_at, f"Reminder {i}")

    fire_at = (datetime.now(timezone.utc) + timedelta(hours=MAX_PENDING_JOBS + 1)).isoformat()
    result = await execute_schedule_reminder(70004, fire_at, "One too many")
    assert "20 pending" in result or "limit" in result.lower()


@pytest.mark.asyncio
async def test_list_my_reminders_shows_pending():
    await _setup_user(70005)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    await execute_schedule_reminder(70005, fire_at, "Morning check")
    result = await execute_list_my_reminders(70005)
    assert "Morning check" in result


@pytest.mark.asyncio
async def test_list_my_reminders_empty():
    await _setup_user(70006)
    result = await execute_list_my_reminders(70006)
    assert "no pending" in result.lower() or "none" in result.lower()


@pytest.mark.asyncio
async def test_cancel_reminder_updates_status():
    await _setup_user(70007)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    schedule_result = await execute_schedule_reminder(70007, fire_at, "To cancel")
    # Extract job_id from result — format: "Scheduled reminder <uuid> for <date>."
    job_id = schedule_result.split("reminder ")[1].split(" for")[0]
    cancel_result = await execute_cancel_reminder(70007, job_id)
    assert "Cancelled" in cancel_result or "cancelled" in cancel_result


@pytest.mark.asyncio
async def test_cancel_reminder_wrong_user():
    await _setup_user(70008)
    await _setup_user(70009)
    fire_at = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    schedule_result = await execute_schedule_reminder(70008, fire_at, "Not yours")
    job_id = schedule_result.split("reminder ")[1].split(" for")[0]
    result = await execute_cancel_reminder(70009, job_id)
    assert "not found" in result.lower()


@pytest.mark.asyncio
async def test_cancel_reminder_nonexistent():
    result = await execute_cancel_reminder(1, "00000000-0000-0000-0000-000000000000")
    assert "not found" in result.lower()


def test_schemas_have_correct_names():
    names = {s["function"]["name"] for s in SCHEDULING_TOOL_SCHEMAS}
    assert names == {"schedule_reminder", "list_my_reminders", "cancel_reminder"}
