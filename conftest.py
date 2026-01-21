"""Root pytest configuration."""

import pytest


@pytest.fixture(scope="session")
def event_loop_policy():
    """Use default event loop policy for all async tests."""
    import asyncio

    return asyncio.DefaultEventLoopPolicy()
