"""Test course progress with UUID-based tracking."""

import pytest


@pytest.mark.asyncio
async def test_course_progress_includes_lens_completion():
    """Course progress should show lens-level completion from new tables.

    The /api/courses/{slug}/progress endpoint should:
    1. Extract lens UUIDs from parsed modules
    2. Query user_content_progress for those UUIDs
    3. Return completion status per stage (lens)
    4. Calculate module status from lens completions
    """
    # This test documents the expected behavior after migration
    # The endpoint should return completion status per lens UUID
    pass  # Placeholder - actual test depends on implementation


@pytest.mark.asyncio
async def test_course_progress_anonymous_user():
    """Anonymous users should be able to track progress via session token.

    The endpoint accepts X-Session-Token header for anonymous users
    and should return their lens completion progress.
    """
    pass  # Placeholder


@pytest.mark.asyncio
async def test_course_progress_no_auth():
    """Without auth or session token, progress should show as not_started.

    All modules should have status "not_started" and completed counts of 0.
    """
    pass  # Placeholder


@pytest.mark.asyncio
async def test_module_status_calculation():
    """Module status should be derived from lens completions.

    - "not_started": 0 lenses completed
    - "in_progress": some but not all required lenses completed
    - "completed": all required lenses completed
    """
    pass  # Placeholder


@pytest.mark.asyncio
async def test_optional_lenses_excluded_from_completion():
    """Optional lenses should not count toward module completion.

    Only required (non-optional) lenses determine module status.
    """
    pass  # Placeholder
