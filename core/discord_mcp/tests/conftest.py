"""Pytest fixtures for discord_mcp tests."""

import pytest
from core.database import reset_engine


@pytest.fixture(autouse=True)
def reset_db_engine():
    """Reset the database engine before each test to avoid event loop conflicts."""
    reset_engine()
    yield
    reset_engine()
