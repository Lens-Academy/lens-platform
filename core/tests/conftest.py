"""Pytest fixtures for core tests."""

import pytest_asyncio
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine


@pytest_asyncio.fixture
async def db_conn():
    """
    Provide a DB connection that rolls back after each test.

    Creates a fresh engine per test to avoid event loop issues.
    """
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
