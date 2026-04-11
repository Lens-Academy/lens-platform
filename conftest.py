"""Root pytest configuration."""

from pathlib import Path

import pytest
from dotenv import load_dotenv

# Load environment variables before tests run
_root = Path(__file__).parent
load_dotenv(_root / ".env")
load_dotenv(_root / ".env.local", override=True)


@pytest.fixture(scope="session")
def event_loop_policy():
    """Use default event loop policy for all async tests."""
    import asyncio

    return asyncio.DefaultEventLoopPolicy()
