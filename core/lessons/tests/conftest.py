"""Pytest fixtures for lesson tests."""

import uuid
import pytest_asyncio
from sqlalchemy import text

from core.database import get_connection


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def test_user_id():
    """Create a test user and return their user_id. Cleans up after all tests in module."""
    unique_id = str(uuid.uuid4())[:8]
    async with get_connection() as conn:
        result = await conn.execute(
            text("""
                INSERT INTO users (discord_id, discord_username)
                VALUES (:discord_id, :username)
                RETURNING user_id
            """),
            {"discord_id": f"test_{unique_id}", "username": f"test_user_{unique_id}"}
        )
        row = result.fetchone()
        user_id = row[0]
        await conn.commit()

    yield user_id

    # Cleanup: delete the test user (cascades to lesson_sessions)
    async with get_connection() as conn:
        await conn.execute(
            text("DELETE FROM users WHERE user_id = :user_id"),
            {"user_id": user_id}
        )
        await conn.commit()
