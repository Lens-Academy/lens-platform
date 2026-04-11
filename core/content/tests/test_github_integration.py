# core/content/tests/test_github_integration.py
"""Shallow integration test for GitHub fetching.

This test hits the real GitHub API to verify:
1. Credentials work (GITHUB_TOKEN)
2. Can reach the content repository
3. Basic fetch functionality works

Uses a dedicated test fixture file that never changes.
"""

import pytest

# Skip: fetch_file() now reads from a local git clone directory, which
# doesn't exist in the test environment. A full integration test would
# need to run git clone first, which is too heavyweight for unit tests.
pytestmark = pytest.mark.skip(
    reason="fetch_file() requires a local git clone; not available in test env"
)


@pytest.mark.asyncio
async def test_fetch_test_fixture():
    """Fetch the test fixture file and verify its content.

    NOTE: Disabled -- fetch_file() now reads from disk (local clone),
    not from the GitHub API. To run this test, first clone the content repo
    to the expected path, or use a dedicated integration test harness.
    """
    import os

    os.environ.setdefault("EDUCATIONAL_CONTENT_BRANCH", "staging")

    from core.content.github_fetcher import fetch_file

    content = await fetch_file("_test-fixture.md")

    # Verify expected content (hardcoded - fixture must not change)
    assert "# Test Fixture" in content
    assert "test: true" in content
    assert "DO NOT MODIFY" in content
