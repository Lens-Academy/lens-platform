# core/content/tests/test_github_integration.py
"""Shallow integration test for GitHub fetching.

This test hits the real GitHub API to verify:
1. Credentials work (GITHUB_TOKEN)
2. Can reach the content repository
3. Basic fetch functionality works

Uses a dedicated test fixture file that never changes.
"""

import os
import pytest

# Skip if no GitHub token configured
pytestmark = pytest.mark.skipif(
    not os.getenv("GITHUB_TOKEN"),
    reason="GITHUB_TOKEN not set - skipping GitHub integration test",
)


@pytest.mark.asyncio
async def test_fetch_test_fixture():
    """Fetch the test fixture file and verify its content."""
    # Must set branch for the test
    os.environ.setdefault("EDUCATIONAL_CONTENT_BRANCH", "staging")

    from core.content.github_fetcher import fetch_file

    content = await fetch_file("_test-fixture.md")

    # Verify expected content (hardcoded - fixture must not change)
    assert "# Test Fixture" in content
    assert "test: true" in content
    assert "DO NOT MODIFY" in content
