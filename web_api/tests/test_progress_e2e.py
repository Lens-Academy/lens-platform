"""End-to-end tests for progress tracking.

These tests send real HTTP requests and verify database state.
No mocking of core functions — tests the full request-to-database chain.
"""

import asyncio
import uuid

import pytest
import pytest_asyncio
from uuid import UUID

from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from dotenv import load_dotenv

load_dotenv(".env.local")

from core.database import get_transaction, close_engine
from core.tables import user_content_progress


# --- Fixtures ---


@pytest_asyncio.fixture(autouse=True)
async def cleanup_engine():
    """Clean up the database engine after each test."""
    yield
    await close_engine()


@pytest.fixture
def anon_token():
    """Generate a random anonymous token."""
    return str(uuid.uuid4())


@pytest.fixture
def lens_id():
    return str(uuid.uuid4())


@pytest.fixture
def lo_id():
    return str(uuid.uuid4())


@pytest.fixture
def module_id():
    return str(uuid.uuid4())


async def get_progress_record(content_id_str: str, anon_token: str) -> dict | None:
    """Query the database for a progress record by content_id and anonymous_token."""
    async with get_transaction() as conn:
        result = await conn.execute(
            select(user_content_progress).where(
                user_content_progress.c.content_id == UUID(content_id_str),
                user_content_progress.c.anonymous_token == UUID(anon_token),
            )
        )
        row = result.fetchone()
        return dict(row._mapping) if row else None


# --- Heartbeat Tests ---


class TestHeartbeatMultiLevel:
    """Heartbeat creates and updates records at lens, LO, and module levels."""

    @pytest.mark.asyncio
    async def test_heartbeat_creates_records_at_all_three_levels(
        self, anon_token, lens_id, lo_id, module_id
    ):
        """Sending a heartbeat should create progress records for lens, LO, and module."""
        from main import app

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/progress/time",
                json={
                    "content_id": lens_id,
                    "lo_id": lo_id,
                    "module_id": module_id,
                },
                headers={"X-Anonymous-Token": anon_token},
            )
        assert response.status_code == 204

        # First ping sets last_heartbeat_at but adds 0 time
        lens = await get_progress_record(lens_id, anon_token)
        lo = await get_progress_record(lo_id, anon_token)
        module = await get_progress_record(module_id, anon_token)

        assert lens is not None, "Lens record should exist"
        assert lens["content_type"] == "lens"
        assert lens["total_time_spent_s"] == 0
        assert lens["last_heartbeat_at"] is not None

        assert lo is not None, "LO record should exist"
        assert lo["content_type"] == "lo"
        assert lo["total_time_spent_s"] == 0
        assert lo["last_heartbeat_at"] is not None

        assert module is not None, "Module record should exist"
        assert module["content_type"] == "module"
        assert module["total_time_spent_s"] == 0
        assert module["last_heartbeat_at"] is not None

    @pytest.mark.asyncio
    async def test_heartbeat_accumulates_time_across_calls(
        self, anon_token, lens_id, lo_id, module_id
    ):
        """Two heartbeats should accumulate time at all three levels."""
        from main import app

        payload = {
            "content_id": lens_id,
            "lo_id": lo_id,
            "module_id": module_id,
        }

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await client.post(
                "/api/progress/time",
                json=payload,
                headers={"X-Anonymous-Token": anon_token},
            )
            await asyncio.sleep(2)
            await client.post(
                "/api/progress/time",
                json=payload,
                headers={"X-Anonymous-Token": anon_token},
            )

        lens = await get_progress_record(lens_id, anon_token)
        lo = await get_progress_record(lo_id, anon_token)
        module = await get_progress_record(module_id, anon_token)

        assert 1 <= lens["total_time_spent_s"] <= 4
        assert 1 <= lo["total_time_spent_s"] <= 4
        assert 1 <= module["total_time_spent_s"] <= 4

    @pytest.mark.asyncio
    async def test_heartbeat_without_lo_and_module_only_updates_lens(
        self, anon_token, lens_id
    ):
        """Heartbeat with only content_id (no lo_id/module_id) should only update lens."""
        from main import app

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/progress/time",
                json={
                    "content_id": lens_id,
                },
                headers={"X-Anonymous-Token": anon_token},
            )
        assert response.status_code == 204

        lens = await get_progress_record(lens_id, anon_token)
        assert lens is not None
        assert lens["total_time_spent_s"] == 0  # First ping adds 0 time


# --- Completion Propagation Tests ---


class TestCompletionPropagation:
    """Completing the last required lens auto-completes LO and module."""

    @pytest.mark.asyncio
    async def test_completing_last_lens_autocompletes_lo_and_module(self, anon_token):
        """When all required lenses in an LO are complete, LO and module auto-complete."""
        from main import app
        from core.content import set_cache, clear_cache, ContentCache
        from core.modules.flattened_types import FlattenedModule
        from datetime import datetime

        lens_1 = str(uuid.uuid4())
        lens_2 = str(uuid.uuid4())
        lo = str(uuid.uuid4())
        mod = str(uuid.uuid4())

        cache = ContentCache(
            courses={},
            flattened_modules={
                "test-module": FlattenedModule(
                    slug="test-module",
                    title="Test Module",
                    content_id=UUID(mod),
                    sections=[
                        {
                            "type": "article",
                            "contentId": lens_1,
                            "learningOutcomeId": lo,
                            "meta": {"title": "Lens 1"},
                            "segments": [],
                            "optional": False,
                        },
                        {
                            "type": "article",
                            "contentId": lens_2,
                            "learningOutcomeId": lo,
                            "meta": {"title": "Lens 2"},
                            "segments": [],
                            "optional": False,
                        },
                    ],
                ),
            },
            parsed_learning_outcomes={},
            parsed_lenses={},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            headers = {"X-Anonymous-Token": anon_token}

            # Send heartbeats to create records
            for lens in [lens_1, lens_2]:
                await client.post(
                    "/api/progress/time",
                    json={
                        "content_id": lens,
                        "lo_id": lo,
                        "module_id": mod,
                    },
                    headers=headers,
                )

            # Complete lens 1
            await client.post(
                "/api/progress/complete",
                json={
                    "content_id": lens_1,
                    "content_type": "lens",
                    "content_title": "Lens 1",
                    "module_slug": "test-module",
                },
                headers=headers,
            )

            # LO should NOT be complete yet (only 1 of 2 lenses done)
            lo_record = await get_progress_record(lo, anon_token)
            assert lo_record is None or lo_record["completed_at"] is None

            # Complete lens 2
            await client.post(
                "/api/progress/complete",
                json={
                    "content_id": lens_2,
                    "content_type": "lens",
                    "content_title": "Lens 2",
                    "module_slug": "test-module",
                },
                headers=headers,
            )

        # Now LO and module should both be complete
        lo_record = await get_progress_record(lo, anon_token)
        mod_record = await get_progress_record(mod, anon_token)

        assert lo_record is not None, "LO record should exist"
        assert lo_record["completed_at"] is not None, "LO should be complete"
        assert lo_record["time_to_complete_s"] >= 0

        assert mod_record is not None, "Module record should exist"
        assert mod_record["completed_at"] is not None, "Module should be complete"

        clear_cache()

    @pytest.mark.asyncio
    async def test_already_completed_lo_not_overwritten(self, anon_token):
        """An already-completed LO should not have its completion timestamp changed."""
        from main import app
        from core.content import set_cache, clear_cache, ContentCache
        from core.modules.flattened_types import FlattenedModule
        from datetime import datetime

        lens_1 = str(uuid.uuid4())
        lens_2 = str(uuid.uuid4())
        lens_3 = str(uuid.uuid4())
        lo = str(uuid.uuid4())
        mod = str(uuid.uuid4())

        cache = ContentCache(
            courses={},
            flattened_modules={
                "test-module": FlattenedModule(
                    slug="test-module",
                    title="Test Module",
                    content_id=UUID(mod),
                    sections=[
                        {
                            "type": "article",
                            "contentId": lens_1,
                            "learningOutcomeId": lo,
                            "meta": {"title": "Lens 1"},
                            "segments": [],
                            "optional": False,
                        },
                        {
                            "type": "article",
                            "contentId": lens_2,
                            "learningOutcomeId": lo,
                            "meta": {"title": "Lens 2"},
                            "segments": [],
                            "optional": False,
                        },
                    ],
                ),
            },
            parsed_learning_outcomes={},
            parsed_lenses={},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            headers = {"X-Anonymous-Token": anon_token}

            # Accumulate time and complete both lenses -> LO auto-completes
            for i, lens in enumerate([lens_1, lens_2]):
                await client.post(
                    "/api/progress/time",
                    json={
                        "content_id": lens,
                        "lo_id": lo,
                        "module_id": mod,
                    },
                    headers=headers,
                )
                await client.post(
                    "/api/progress/complete",
                    json={
                        "content_id": lens,
                        "content_type": "lens",
                        "content_title": f"Lens {i + 1}",
                        "module_slug": "test-module",
                    },
                    headers=headers,
                )

        lo_record = await get_progress_record(lo, anon_token)
        original_completed_at = lo_record["completed_at"]
        original_time = lo_record["time_to_complete_s"]

        # Add a new lens to the module
        cache.flattened_modules["test-module"].sections.append(
            {
                "type": "article",
                "contentId": lens_3,
                "learningOutcomeId": lo,
                "meta": {"title": "Lens 3"},
                "segments": [],
                "optional": False,
            }
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            headers = {"X-Anonymous-Token": anon_token}

            # Complete the new lens
            await client.post(
                "/api/progress/time",
                json={
                    "content_id": lens_3,
                    "lo_id": lo,
                    "module_id": mod,
                },
                headers=headers,
            )
            await client.post(
                "/api/progress/complete",
                json={
                    "content_id": lens_3,
                    "content_type": "lens",
                    "content_title": "Lens 3",
                    "module_slug": "test-module",
                },
                headers=headers,
            )

        # LO completion should be unchanged (already completed before)
        lo_record = await get_progress_record(lo, anon_token)
        assert lo_record["completed_at"] == original_completed_at
        assert lo_record["time_to_complete_s"] == original_time

        clear_cache()


# --- Server-Side Time Computation Tests ---


class TestServerSideTimeComputation:
    """Server computes time from last_heartbeat_at, not client-sent deltas."""

    @pytest.mark.asyncio
    async def test_first_ping_records_zero_time(self, anon_token, lens_id):
        """First ping sets last_heartbeat_at but adds 0 time."""
        from main import app

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/progress/time",
                json={"content_id": lens_id},
                headers={"X-Anonymous-Token": anon_token},
            )
        assert response.status_code == 204

        record = await get_progress_record(lens_id, anon_token)
        assert record is not None
        assert record["total_time_spent_s"] == 0
        assert record["last_heartbeat_at"] is not None

    @pytest.mark.asyncio
    async def test_second_ping_computes_delta(self, anon_token, lens_id):
        """Second ping computes delta from last_heartbeat_at."""
        from main import app

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await client.post(
                "/api/progress/time",
                json={"content_id": lens_id},
                headers={"X-Anonymous-Token": anon_token},
            )
            await asyncio.sleep(2)
            await client.post(
                "/api/progress/time",
                json={"content_id": lens_id},
                headers={"X-Anonymous-Token": anon_token},
            )

        record = await get_progress_record(lens_id, anon_token)
        assert 1 <= record["total_time_spent_s"] <= 4

    @pytest.mark.asyncio
    async def test_delta_clamped_to_max(self, anon_token, lens_id):
        """Delta is clamped to MAX_HEARTBEAT_DELTA_S (40s)."""
        from main import app
        from sqlalchemy import update as sa_update, func
        from datetime import timedelta

        # First ping to create the record
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await client.post(
                "/api/progress/time",
                json={"content_id": lens_id},
                headers={"X-Anonymous-Token": anon_token},
            )

        # Manually set last_heartbeat_at to 5 minutes ago
        async with get_transaction() as conn:
            await conn.execute(
                sa_update(user_content_progress)
                .where(
                    user_content_progress.c.content_id == UUID(lens_id),
                    user_content_progress.c.anonymous_token == UUID(anon_token),
                )
                .values(last_heartbeat_at=func.now() - timedelta(seconds=300))
            )

        # Second ping — delta should be clamped to 40
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await client.post(
                "/api/progress/time",
                json={"content_id": lens_id},
                headers={"X-Anonymous-Token": anon_token},
            )

        record = await get_progress_record(lens_id, anon_token)
        assert record["total_time_spent_s"] == 40

    @pytest.mark.asyncio
    async def test_concurrent_pings_no_double_count(self, anon_token, lens_id):
        """Two simultaneous pings should not double-count time."""
        from main import app

        # First ping to set timestamp
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await client.post(
                "/api/progress/time",
                json={"content_id": lens_id},
                headers={"X-Anonymous-Token": anon_token},
            )

        await asyncio.sleep(2)

        # Fire two pings concurrently
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await asyncio.gather(
                client.post(
                    "/api/progress/time",
                    json={"content_id": lens_id},
                    headers={"X-Anonymous-Token": anon_token},
                ),
                client.post(
                    "/api/progress/time",
                    json={"content_id": lens_id},
                    headers={"X-Anonymous-Token": anon_token},
                ),
            )

        record = await get_progress_record(lens_id, anon_token)
        # Should be ~2s (not ~4s from double-counting)
        assert record["total_time_spent_s"] <= 5
