"""
Pytest fixtures for scheduler tests.
"""

import pytest
import pytest_asyncio
from dotenv import load_dotenv


@pytest_asyncio.fixture
async def db_conn():
    """
    Provide a DB connection that rolls back after each test.

    All changes made during the test are visible within the test,
    but rolled back afterward so DB stays clean.
    """
    load_dotenv('.env.local')

    from core.database import get_engine, close_engine
    engine = get_engine()

    async with engine.connect() as conn:
        txn = await conn.begin()
        try:
            yield conn
        finally:
            await txn.rollback()

    # Dispose engine to ensure clean state for next test
    await close_engine()
