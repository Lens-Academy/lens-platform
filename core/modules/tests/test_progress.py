"""Tests for progress tracking service."""

import uuid
from datetime import timedelta

import pytest

from core.modules.progress import (
    get_or_create_progress,
    mark_content_complete,
    update_time_spent,
    get_module_progress,
    claim_progress_records,
)
from core.database import get_transaction


async def set_last_heartbeat(
    conn, content_id, user_id=None, anonymous_token=None, seconds_ago=30
):
    """Set last_heartbeat_at to a specific time in the past for testing."""
    from core.tables import user_content_progress
    from sqlalchemy import update, and_, func

    where = []
    if user_id is not None:
        where.append(user_content_progress.c.user_id == user_id)
    if anonymous_token is not None:
        where.append(user_content_progress.c.anonymous_token == anonymous_token)
    where.append(user_content_progress.c.content_id == content_id)
    await conn.execute(
        update(user_content_progress)
        .where(and_(*where))
        .values(last_heartbeat_at=func.now() - timedelta(seconds=seconds_ago))
    )


@pytest.fixture
def content_id():
    """Generate a random content UUID for testing."""
    return uuid.uuid4()


@pytest.fixture
def anonymous_token():
    """Generate a random session token UUID for testing."""
    return uuid.uuid4()


@pytest.mark.asyncio
async def test_get_or_create_progress_creates_new_record(test_user_id, content_id):
    """get_or_create_progress should create a new record if none exists."""
    async with get_transaction() as conn:
        progress = await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test Lens",
        )

    assert progress["user_id"] == test_user_id
    assert progress["content_id"] == content_id
    assert progress["content_type"] == "lens"
    assert progress["content_title"] == "Test Lens"
    assert progress["completed_at"] is None
    assert progress["time_to_complete_s"] == 0


@pytest.mark.asyncio
async def test_get_or_create_progress_returns_existing_record(test_user_id, content_id):
    """get_or_create_progress should return existing record without creating duplicate."""
    async with get_transaction() as conn:
        progress1 = await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test Lens",
        )

    async with get_transaction() as conn:
        progress2 = await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Different Title",  # Shouldn't update
        )

    assert progress1["id"] == progress2["id"]
    assert progress2["content_title"] == "Test Lens"  # Original title preserved


@pytest.mark.asyncio
async def test_get_or_create_progress_requires_identity():
    """get_or_create_progress should raise error when neither user_id nor anonymous_token provided."""
    content_id = uuid.uuid4()

    async with get_transaction() as conn:
        with pytest.raises(ValueError, match="Either user_id or anonymous_token"):
            await get_or_create_progress(
                conn,
                user_id=None,
                anonymous_token=None,
                content_id=content_id,
                content_type="lens",
                content_title="Test",
            )


@pytest.mark.asyncio
async def test_get_or_create_progress_anonymous_user(anonymous_token, content_id):
    """get_or_create_progress should work with anonymous_token for anonymous users."""
    async with get_transaction() as conn:
        progress = await get_or_create_progress(
            conn,
            user_id=None,
            anonymous_token=anonymous_token,
            content_id=content_id,
            content_type="lens",
            content_title="Anonymous Test",
        )

    assert progress["user_id"] is None
    assert progress["anonymous_token"] == anonymous_token
    assert progress["content_id"] == content_id


@pytest.mark.asyncio
async def test_mark_content_complete_creates_and_completes(test_user_id, content_id):
    """mark_content_complete should create record if none exists and mark it complete."""
    # Accumulate time first via heartbeats
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test Lens",
        )

    # Set last_heartbeat_at to 30s ago so update_time_spent computes ~30s delta
    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    async with get_transaction() as conn:
        progress = await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test Lens",
        )

    assert progress["completed_at"] is not None
    assert 28 <= progress["time_to_complete_s"] <= 32


@pytest.mark.asyncio
async def test_mark_content_complete_idempotent(test_user_id, content_id):
    """Calling mark_content_complete twice should return same record."""
    # Accumulate time first
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test Lens",
        )

    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    async with get_transaction() as conn:
        progress1 = await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test Lens",
        )

    first_time_to_complete = progress1["time_to_complete_s"]
    assert 28 <= first_time_to_complete <= 32

    # More time accumulated after completion
    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    async with get_transaction() as conn:
        progress2 = await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test Lens",
        )

    assert progress1["id"] == progress2["id"]
    assert (
        progress2["time_to_complete_s"] == first_time_to_complete
    )  # Original time preserved


@pytest.mark.asyncio
async def test_update_time_spent(test_user_id, content_id):
    """update_time_spent should add to total_time_spent_s."""
    # Create progress first
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    # Set last_heartbeat_at to 30s ago
    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    # Update time
    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    # Check via get_or_create
    async with get_transaction() as conn:
        progress = await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    assert 28 <= progress["total_time_spent_s"] <= 32
    assert progress["time_to_complete_s"] == 0  # Stays 0 until completion


@pytest.mark.asyncio
async def test_update_time_spent_after_completion(test_user_id, content_id):
    """update_time_spent after completion should only update total_time_spent_s."""
    # Create and accumulate time
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    # Complete — snapshots time_to_complete_s ~ 30
    async with get_transaction() as conn:
        await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    # Update time after completion
    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    # Check
    async with get_transaction() as conn:
        progress = await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    assert 56 <= progress["total_time_spent_s"] <= 64  # ~30 + ~30
    assert 28 <= progress["time_to_complete_s"] <= 32  # Frozen at completion (~30)


@pytest.mark.asyncio
async def test_get_module_progress(test_user_id):
    """get_module_progress should return progress for multiple content items."""
    lens_ids = [uuid.uuid4() for _ in range(3)]

    # Create progress for first two
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=lens_ids[0],
            content_type="lens",
            content_title="Lens 1",
        )

    async with get_transaction() as conn:
        await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=lens_ids[1],
            content_type="lens",
            content_title="Lens 2",
            time_spent_s=100,
        )

    # Get progress for all three
    async with get_transaction() as conn:
        progress = await get_module_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            lens_ids=lens_ids,
        )

    assert len(progress) == 2  # Third has no progress
    assert lens_ids[0] in progress
    assert lens_ids[1] in progress
    assert lens_ids[2] not in progress
    assert progress[lens_ids[1]]["completed_at"] is not None


@pytest.mark.asyncio
async def test_get_module_progress_empty_list(test_user_id):
    """get_module_progress with empty list should return empty dict."""
    async with get_transaction() as conn:
        progress = await get_module_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            lens_ids=[],
        )

    assert progress == {}


@pytest.mark.asyncio
async def test_claim_progress_records(test_user_id, anonymous_token):
    """claim_progress_records should transfer anonymous progress to user."""
    content_ids = [uuid.uuid4() for _ in range(2)]

    # Create anonymous progress
    for i, cid in enumerate(content_ids):
        async with get_transaction() as conn:
            await get_or_create_progress(
                conn,
                user_id=None,
                anonymous_token=anonymous_token,
                content_id=cid,
                content_type="lens",
                content_title=f"Lens {i}",
            )

    # Claim records
    async with get_transaction() as conn:
        count = await claim_progress_records(
            conn,
            anonymous_token=anonymous_token,
            user_id=test_user_id,
        )

    assert count == 2

    # Verify they're now associated with user
    async with get_transaction() as conn:
        progress = await get_module_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            lens_ids=content_ids,
        )

    assert len(progress) == 2
    for cid in content_ids:
        assert progress[cid]["user_id"] == test_user_id
        assert progress[cid]["anonymous_token"] is None


@pytest.mark.asyncio
async def test_claim_progress_records_no_records(test_user_id):
    """claim_progress_records with no matching records should return 0."""
    async with get_transaction() as conn:
        count = await claim_progress_records(
            conn,
            anonymous_token=uuid.uuid4(),  # Non-existent token
            user_id=test_user_id,
        )

    assert count == 0


@pytest.mark.asyncio
async def test_claim_progress_records_merges_with_existing(
    test_user_id, anonymous_token
):
    """claim_progress_records should not fail if user already has progress for same content.

    If user has existing progress and claims records for the same content_id,
    the anonymous records should be skipped (due to unique constraint).
    """
    content_id = uuid.uuid4()

    # Create authenticated progress first
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="User Progress",
        )

    # Create anonymous progress for same content
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=None,
            anonymous_token=anonymous_token,
            content_id=content_id,
            content_type="lens",
            content_title="Anonymous Progress",
        )

    # Also create a different content for anonymous
    other_content_id = uuid.uuid4()
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=None,
            anonymous_token=anonymous_token,
            content_id=other_content_id,
            content_type="lens",
            content_title="Other Progress",
        )

    # Claim - should handle the conflict gracefully
    # Note: The current implementation may fail on unique constraint
    # This test documents the expected behavior
    async with get_transaction() as conn:
        # The claim will try to update anonymous_token records to set user_id
        # For records where user already has progress, this violates unique constraint
        # Current implementation returns rowcount, which may include failed updates
        count = await claim_progress_records(
            conn,
            anonymous_token=anonymous_token,
            user_id=test_user_id,
        )

    # Should claim at least the non-conflicting record
    assert count >= 1


@pytest.mark.asyncio
async def test_get_or_create_progress_prefers_user_id(
    test_user_id, anonymous_token, content_id
):
    """When both user_id and anonymous_token are provided, user_id takes precedence."""
    async with get_transaction() as conn:
        progress = await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=anonymous_token,  # Should be ignored
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    assert progress["user_id"] == test_user_id
    # anonymous_token should not be set since user_id takes precedence
    assert progress["anonymous_token"] is None


@pytest.mark.asyncio
async def test_mark_content_complete_sets_time_to_complete_once(
    test_user_id, content_id
):
    """time_to_complete_s should be set on first completion and never change."""
    # Accumulate ~30s of time
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    # First completion — snapshots time_to_complete_s ~ 30
    async with get_transaction() as conn:
        progress1 = await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    assert 28 <= progress1["time_to_complete_s"] <= 32
    first_completed_at = progress1["completed_at"]
    first_time_to_complete = progress1["time_to_complete_s"]

    # Accumulate more time after completion
    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    # Try to complete again — should be idempotent
    async with get_transaction() as conn:
        progress2 = await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    # Values should be unchanged from first completion
    assert progress2["time_to_complete_s"] == first_time_to_complete
    assert progress2["completed_at"] == first_completed_at


@pytest.mark.asyncio
async def test_update_time_spent_increments_total(test_user_id, content_id):
    """update_time_spent should accumulate time across multiple calls."""
    # Create progress
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    # Update time in multiple increments
    for _ in range(3):
        async with get_transaction() as conn:
            await set_last_heartbeat(
                conn, content_id, user_id=test_user_id, seconds_ago=30
            )

        async with get_transaction() as conn:
            await update_time_spent(
                conn,
                user_id=test_user_id,
                anonymous_token=None,
                content_id=content_id,
            )

    # Verify accumulated time
    async with get_transaction() as conn:
        progress = await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    assert 84 <= progress["total_time_spent_s"] <= 96  # ~30 * 3
    assert progress["time_to_complete_s"] == 0  # Stays 0 until completion


@pytest.mark.asyncio
async def test_update_time_spent_nonexistent_record(test_user_id, content_id):
    """update_time_spent on nonexistent record should silently do nothing."""
    # Try to update time for non-existent progress
    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    # No error should be raised, and no record should be created
    async with get_transaction() as conn:
        progress = await get_module_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            lens_ids=[content_id],
        )

    assert content_id not in progress


@pytest.mark.asyncio
async def test_update_time_spent_no_identity():
    """update_time_spent with neither user_id nor anonymous_token should do nothing."""
    content_id = uuid.uuid4()

    # Should not raise, just return silently
    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=None,
            anonymous_token=None,
            content_id=content_id,
        )


@pytest.mark.asyncio
async def test_get_module_progress_no_identity():
    """get_module_progress with neither user_id nor anonymous_token should return empty."""
    lens_ids = [uuid.uuid4() for _ in range(3)]

    async with get_transaction() as conn:
        progress = await get_module_progress(
            conn,
            user_id=None,
            anonymous_token=None,
            lens_ids=lens_ids,
        )

    assert progress == {}


@pytest.mark.asyncio
async def test_mark_content_complete_snapshots_accumulated_time(
    test_user_id, content_id
):
    """mark_content_complete should snapshot total_time_spent_s, not use the time_spent_s parameter."""
    # Accumulate time via heartbeats
    async with get_transaction() as conn:
        await get_or_create_progress(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
        )

    async with get_transaction() as conn:
        await set_last_heartbeat(conn, content_id, user_id=test_user_id, seconds_ago=30)

    async with get_transaction() as conn:
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
        )

    # Complete with time_spent_s=0 (simulating frontend not sending time)
    async with get_transaction() as conn:
        progress = await mark_content_complete(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            content_type="lens",
            content_title="Test",
            time_spent_s=0,
        )

    # time_to_complete_s should be ~30 (accumulated), not 0 (parameter)
    assert 28 <= progress["time_to_complete_s"] <= 32
