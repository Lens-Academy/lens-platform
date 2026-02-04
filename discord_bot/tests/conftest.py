"""
Pytest fixtures for scheduler tests.
"""

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.fixture(autouse=True)
def init_content_cache():
    """Initialize a minimal content cache for tests that need course data.

    This is autouse=True so it runs before every test. Tests that call
    load_course("default") will find the mock course in the cache.
    """
    from core.content.cache import set_cache, clear_cache, ContentCache
    from core.modules.flattened_types import ParsedCourse

    # Create minimal cache with "default" course
    test_cache = ContentCache(
        courses={
            "default": ParsedCourse(
                slug="default",
                title="AI Safety Course",
                progression=[],
            )
        },
        flattened_modules={},
        articles={},
        video_transcripts={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        last_refreshed=datetime.now(timezone.utc),
        last_commit_sha=None,
    )
    set_cache(test_cache)

    yield

    # Clean up after test
    clear_cache()


@pytest_asyncio.fixture
async def db_conn():
    """
    Provide a DB connection that rolls back after each test.

    All changes made during the test are visible within the test,
    but rolled back afterward so DB stays clean.

    Creates a fresh engine per test and injects it into core.database
    so that functions using get_connection()/get_transaction() use the
    same engine (avoiding event loop mismatch).
    """
    load_dotenv(".env.local")

    import os
    from core.database import set_engine

    database_url = os.environ.get("DATABASE_URL", "")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # Create fresh engine for this test (avoids event loop mismatch)
    engine = create_async_engine(
        database_url,
        connect_args={"statement_cache_size": 0},
    )

    # Inject engine into core.database singleton so functions using
    # get_connection()/get_transaction() use this same engine
    set_engine(engine)

    async with engine.connect() as conn:
        txn = await conn.begin()
        try:
            yield conn
        finally:
            await txn.rollback()

    # Clean up: remove injected engine
    set_engine(None)
    await engine.dispose()
