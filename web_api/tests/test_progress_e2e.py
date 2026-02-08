"""End-to-end tests for progress tracking.

These tests send real HTTP requests and verify database state.
No mocking of core functions — tests the full request-to-database chain.
"""

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
                    "time_delta_s": 30,
                    "lo_id": lo_id,
                    "module_id": module_id,
                },
                headers={"X-Anonymous-Token": anon_token},
            )
        assert response.status_code == 204

        # Verify all three records exist in database
        lens = await get_progress_record(lens_id, anon_token)
        lo = await get_progress_record(lo_id, anon_token)
        module = await get_progress_record(module_id, anon_token)

        assert lens is not None, "Lens record should exist"
        assert lens["content_type"] == "lens"
        assert lens["total_time_spent_s"] == 30

        assert lo is not None, "LO record should exist"
        assert lo["content_type"] == "lo"
        assert lo["total_time_spent_s"] == 30

        assert module is not None, "Module record should exist"
        assert module["content_type"] == "module"
        assert module["total_time_spent_s"] == 30

    @pytest.mark.asyncio
    async def test_heartbeat_accumulates_time_across_calls(
        self, anon_token, lens_id, lo_id, module_id
    ):
        """Two heartbeats should sum their deltas at all three levels."""
        from main import app

        payload = {
            "content_id": lens_id,
            "time_delta_s": 30,
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
            await client.post(
                "/api/progress/time",
                json=payload,
                headers={"X-Anonymous-Token": anon_token},
            )

        lens = await get_progress_record(lens_id, anon_token)
        lo = await get_progress_record(lo_id, anon_token)
        module = await get_progress_record(module_id, anon_token)

        assert lens["total_time_spent_s"] == 60
        assert lo["total_time_spent_s"] == 60
        assert module["total_time_spent_s"] == 60

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
                    "time_delta_s": 30,
                },
                headers={"X-Anonymous-Token": anon_token},
            )
        assert response.status_code == 204

        lens = await get_progress_record(lens_id, anon_token)
        assert lens is not None
        assert lens["total_time_spent_s"] == 30


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

            # Send heartbeats to accumulate time
            for lens in [lens_1, lens_2]:
                await client.post(
                    "/api/progress/time",
                    json={
                        "content_id": lens,
                        "time_delta_s": 60,
                        "lo_id": lo,
                        "module_id": mod,
                    },
                    headers=headers,
                )

            # Complete lens 1
            await client.post(
                "/api/modules/test-module/progress",
                json={"contentId": lens_1, "completed": True},
                headers=headers,
            )

            # LO should NOT be complete yet (only 1 of 2 lenses done)
            lo_record = await get_progress_record(lo, anon_token)
            assert lo_record is None or lo_record["completed_at"] is None

            # Complete lens 2
            await client.post(
                "/api/modules/test-module/progress",
                json={"contentId": lens_2, "completed": True},
                headers=headers,
            )

        # Now LO and module should both be complete
        lo_record = await get_progress_record(lo, anon_token)
        mod_record = await get_progress_record(mod, anon_token)

        assert lo_record is not None, "LO record should exist"
        assert lo_record["completed_at"] is not None, "LO should be complete"
        assert lo_record["time_to_complete_s"] == 120  # Snapshot of accumulated time

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
            for lens in [lens_1, lens_2]:
                await client.post(
                    "/api/progress/time",
                    json={
                        "content_id": lens,
                        "time_delta_s": 60,
                        "lo_id": lo,
                        "module_id": mod,
                    },
                    headers=headers,
                )
                await client.post(
                    "/api/modules/test-module/progress",
                    json={"contentId": lens, "completed": True},
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
                    "time_delta_s": 30,
                    "lo_id": lo,
                    "module_id": mod,
                },
                headers=headers,
            )
            await client.post(
                "/api/modules/test-module/progress",
                json={"contentId": lens_3, "completed": True},
                headers=headers,
            )

        # LO completion should be unchanged (already completed before)
        lo_record = await get_progress_record(lo, anon_token)
        assert lo_record["completed_at"] == original_completed_at
        assert lo_record["time_to_complete_s"] == original_time

        clear_cache()


# --- Module Progress Endpoint Multi-Level Tests ---


class TestModuleProgressEndpointMultiLevel:
    """POST /api/modules/{slug}/progress writes time at all levels."""

    @pytest.mark.asyncio
    async def test_module_progress_heartbeat_writes_all_levels(self, anon_token):
        """Heartbeat via module progress endpoint should update lens, LO, and module time."""
        from main import app
        from core.content import set_cache, clear_cache, ContentCache
        from core.modules.flattened_types import FlattenedModule
        from datetime import datetime

        lens = str(uuid.uuid4())
        lo = str(uuid.uuid4())
        mod = str(uuid.uuid4())

        cache = ContentCache(
            courses={},
            flattened_modules={
                "test-mod": FlattenedModule(
                    slug="test-mod",
                    title="Test",
                    content_id=UUID(mod),
                    sections=[
                        {
                            "type": "article",
                            "contentId": lens,
                            "learningOutcomeId": lo,
                            "meta": {"title": "Lens"},
                            "segments": [],
                            "optional": False,
                        }
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
            response = await client.post(
                "/api/modules/test-mod/progress",
                json={"contentId": lens, "timeSpentS": 30, "completed": False},
                headers={"X-Anonymous-Token": anon_token},
            )
        assert response.status_code == 200

        lens_rec = await get_progress_record(lens, anon_token)
        lo_rec = await get_progress_record(lo, anon_token)
        mod_rec = await get_progress_record(mod, anon_token)

        assert lens_rec is not None
        assert lens_rec["total_time_spent_s"] == 30

        assert lo_rec is not None, "LO record should exist"
        assert lo_rec["total_time_spent_s"] == 30

        assert mod_rec is not None, "Module record should exist"
        assert mod_rec["total_time_spent_s"] == 30

        clear_cache()
