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
    from core.modules.markdown_parser import ParsedCourse

    # Create minimal cache with "default" course
    test_cache = ContentCache(
        courses={
            "default": ParsedCourse(
                slug="default",
                title="AI Safety Course",
                progression=[],
            )
        },
        modules={},
        articles={},
        video_transcripts={},
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

    Creates a fresh engine per test to avoid event loop issues.
    """
    load_dotenv(".env.local")

    import os

    database_url = os.environ.get("DATABASE_URL", "")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # Create fresh engine for this test (avoids event loop mismatch)
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
