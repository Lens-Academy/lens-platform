"""Pytest fixtures for agents tests."""

import pytest
from core.database import reset_engine


@pytest.fixture(autouse=True)
async def reset_db_engine():
    """Reset the DB engine singleton before each test.

    Each async test gets its own event loop (asyncio_default_fixture_loop_scope=function).
    The global engine singleton holds connections bound to the previous loop, which
    causes 'Future attached to a different loop' errors on the second test.
    Resetting before each test forces a fresh engine on the new loop.
    """
    reset_engine()
    yield
    reset_engine()
