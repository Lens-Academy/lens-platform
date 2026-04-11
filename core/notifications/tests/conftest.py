"""Pytest fixtures for notification tests."""

import uuid

import pytest_asyncio
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


@pytest_asyncio.fixture
async def db_conn():
    """Provide a DB connection that rolls back after each test."""
    load_dotenv(".env.local")

    import os

    database_url = os.environ.get("DATABASE_URL", "")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(
        database_url,
        connect_args={"statement_cache_size": 0},
    )

    async with engine.connect() as conn:
        txn = await conn.begin()
        try:
            yield conn
        finally:
            await txn.rollback()

    await engine.dispose()


async def create_test_user(conn, discord_id) -> dict:
    unique = str(uuid.uuid4())[:8]
    result = await conn.execute(
        text("""
            INSERT INTO users (discord_id, discord_username)
            VALUES (:discord_id, :username)
            RETURNING user_id
        """),
        {"discord_id": f"{discord_id}_{unique}", "username": f"test_{unique}"},
    )
    return {"user_id": result.fetchone()[0]}


async def create_test_cohort(conn, course_slug) -> dict:
    unique = str(uuid.uuid4())[:8]
    result = await conn.execute(
        text("""
            INSERT INTO cohorts (cohort_name, course_slug, cohort_start_date, duration_days, number_of_group_meetings)
            VALUES (:name, :course_slug, CURRENT_DATE, 30, 8)
            RETURNING cohort_id
        """),
        {"name": f"test_cohort_{unique}", "course_slug": course_slug},
    )
    return {"cohort_id": result.fetchone()[0]}


async def create_test_group(conn, cohort_id) -> dict:
    unique = str(uuid.uuid4())[:8]
    result = await conn.execute(
        text("""
            INSERT INTO groups (group_name, cohort_id, status)
            VALUES (:name, :cohort_id, 'active')
            RETURNING group_id
        """),
        {"name": f"test_group_{unique}", "cohort_id": cohort_id},
    )
    return {"group_id": result.fetchone()[0]}


async def create_test_meeting(
    conn, group_id, cohort_id, meeting_number, scheduled_at=None
) -> dict:
    result = await conn.execute(
        text("""
            INSERT INTO meetings (group_id, cohort_id, meeting_number, scheduled_at)
            VALUES (:group_id, :cohort_id, :meeting_number, COALESCE(:scheduled_at, NOW() + INTERVAL '3 days'))
            RETURNING meeting_id
        """),
        {
            "group_id": group_id,
            "cohort_id": cohort_id,
            "meeting_number": meeting_number,
            "scheduled_at": scheduled_at,
        },
    )
    return {"meeting_id": result.fetchone()[0]}


async def insert_section_progress(conn, user_id, content_id, completed=True) -> None:
    if completed:
        await conn.execute(
            text("""
                INSERT INTO user_content_progress (user_id, content_id, content_type, content_title, completed_at)
                VALUES (:user_id, :content_id, 'lens', 'Test Section', NOW())
            """),
            {"user_id": user_id, "content_id": content_id},
        )
    else:
        await conn.execute(
            text("""
                INSERT INTO user_content_progress (user_id, content_id, content_type, content_title, completed_at)
                VALUES (:user_id, :content_id, 'lens', 'Test Section', NULL)
            """),
            {"user_id": user_id, "content_id": content_id},
        )
