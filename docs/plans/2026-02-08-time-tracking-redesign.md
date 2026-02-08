# Time Tracking Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix time tracking so heartbeats write to lens, LO, and module levels; completion propagates upward; and chat activity keeps the heartbeat alive.

**Architecture:** Existing `user_content_progress` table, no schema changes. Backend gets three UUIDs per heartbeat from the frontend. Completion of the last required lens auto-completes the parent LO and module.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React/TypeScript (frontend), pytest with real database (tests)

---

## Task 1: Fix `mark_content_complete` snapshot bug

The existing `mark_content_complete` overwrites `time_to_complete_s` with a parameter (often 0) instead of snapshotting the accumulated `total_time_spent_s`.

**Files:**
- Modify: `core/modules/progress.py:67-108`
- Modify: `core/modules/tests/test_progress.py`

**Step 1: Write the failing test**

Add to `core/modules/tests/test_progress.py`:

```python
@pytest.mark.asyncio
async def test_mark_content_complete_snapshots_accumulated_time(test_user_id, content_id):
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
        await update_time_spent(
            conn,
            user_id=test_user_id,
            anonymous_token=None,
            content_id=content_id,
            time_delta_s=120,
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

    # time_to_complete_s should be 120 (accumulated), not 0 (parameter)
    assert progress["time_to_complete_s"] == 120
```

**Step 2: Run test to verify it fails**

```bash
../.venv/bin/pytest core/modules/tests/test_progress.py::test_mark_content_complete_snapshots_accumulated_time -v
```

Expected: FAIL — `assert 0 == 120` because current code uses the `time_spent_s` parameter.

**Step 3: Fix `mark_content_complete` in `core/modules/progress.py`**

Change `mark_content_complete` (line 96-105) to snapshot from the existing record instead of using the parameter:

```python
    # Update to mark complete
    now = datetime.now(timezone.utc)
    result = await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.id == progress["id"])
        .values(
            completed_at=now,
            time_to_complete_s=progress["total_time_spent_s"],
        )
        .returning(user_content_progress)
    )
```

The `time_spent_s` parameter is now unused for setting `time_to_complete_s`. Keep the parameter for backwards compatibility but it no longer affects the snapshot.

**Step 4: Run test to verify it passes**

```bash
../.venv/bin/pytest core/modules/tests/test_progress.py -v
```

Expected: ALL PASS. The new test passes, and the existing `test_mark_content_complete_creates_and_completes` test needs updating — it currently asserts `time_to_complete_s == 120` because it passes `time_spent_s=120` but accumulates 0. Update that test to first accumulate time, then complete.

**Note:** The existing test `test_mark_content_complete_creates_and_completes` passes `time_spent_s=120` and asserts `time_to_complete_s == 120`. After the fix, `time_to_complete_s` will be 0 (no time accumulated via heartbeats). Update this test: accumulate 120s first via `update_time_spent`, then complete, then assert 120.

Similarly, `test_mark_content_complete_sets_time_to_complete_once` passes `time_spent_s=100` and asserts `time_to_complete_s == 100`. Update: accumulate 100s first, then complete.

**Step 5: Commit**

```bash
jj commit -m "fix: snapshot accumulated time in mark_content_complete instead of using parameter"
```

---

## Task 2: Multi-level heartbeat — backend `POST /api/progress/time`

Extend the time heartbeat endpoint to accept LO and module UUIDs and update all three levels.

**Files:**
- Modify: `web_api/routes/progress.py:57-59` (TimeUpdateRequest model)
- Modify: `web_api/routes/progress.py:243-282` (update_time_endpoint)
- Modify: `core/modules/progress.py:111-151` (update_time_spent)

**Step 1: Write the failing test**

Create a new end-to-end test file. This test sends an HTTP request and checks the database.

Create: `web_api/tests/test_progress_e2e.py`

```python
"""End-to-end tests for progress tracking.

These tests send real HTTP requests and verify database state.
No mocking of core functions — tests the full request-to-database chain.
"""

import uuid
import pytest
import pytest_asyncio
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import text, select
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


@pytest_asyncio.fixture
async def test_user_id():
    """Create a test user and return their user_id. Cleans up after test."""
    unique_id = str(uuid.uuid4())[:8]
    discord_id = f"test_{unique_id}"

    async with get_transaction() as conn:
        result = await conn.execute(
            text("""
                INSERT INTO users (discord_id, discord_username)
                VALUES (:discord_id, :username)
                RETURNING user_id
            """),
            {"discord_id": discord_id, "username": f"test_user_{unique_id}"},
        )
        row = result.fetchone()
        user_id = row[0]

    yield user_id

    async with get_transaction() as conn:
        await conn.execute(
            text("DELETE FROM users WHERE user_id = :user_id"),
            {"user_id": user_id},
        )


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

    def test_heartbeat_creates_records_at_all_three_levels(
        self, anon_token, lens_id, lo_id, module_id
    ):
        """Sending a heartbeat should create progress records for lens, LO, and module."""
        from main import app

        client = TestClient(app)

        response = client.post(
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
        import asyncio

        async def check():
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

        asyncio.get_event_loop().run_until_complete(check())

    def test_heartbeat_accumulates_time_across_calls(
        self, anon_token, lens_id, lo_id, module_id
    ):
        """Two heartbeats should sum their deltas at all three levels."""
        from main import app

        client = TestClient(app)
        payload = {
            "content_id": lens_id,
            "time_delta_s": 30,
            "lo_id": lo_id,
            "module_id": module_id,
        }

        client.post("/api/progress/time", json=payload, headers={"X-Anonymous-Token": anon_token})
        client.post("/api/progress/time", json=payload, headers={"X-Anonymous-Token": anon_token})

        import asyncio

        async def check():
            lens = await get_progress_record(lens_id, anon_token)
            lo = await get_progress_record(lo_id, anon_token)
            module = await get_progress_record(module_id, anon_token)

            assert lens["total_time_spent_s"] == 60
            assert lo["total_time_spent_s"] == 60
            assert module["total_time_spent_s"] == 60

        asyncio.get_event_loop().run_until_complete(check())
```

**Step 2: Run test to verify it fails**

```bash
../.venv/bin/pytest web_api/tests/test_progress_e2e.py::TestHeartbeatMultiLevel::test_heartbeat_creates_records_at_all_three_levels -v
```

Expected: FAIL — the endpoint doesn't accept `lo_id`/`module_id` yet, and doesn't create records at those levels.

**Step 3: Implement multi-level heartbeat**

3a. Update `TimeUpdateRequest` in `web_api/routes/progress.py`:

```python
class TimeUpdateRequest(BaseModel):
    content_id: UUID
    time_delta_s: int
    lo_id: UUID | None = None
    module_id: UUID | None = None
```

3b. Update `update_time_endpoint` in `web_api/routes/progress.py` to create records and update time at all levels:

```python
@router.post("/time", status_code=204)
async def update_time_endpoint(
    request: Request,
    body: TimeUpdateRequest | None = None,
    auth: tuple = Depends(get_user_or_token),
):
    user_id, anonymous_token = auth

    # Handle sendBeacon (raw JSON body without Content-Type header)
    if body is None:
        try:
            raw = await request.body()
            data = json.loads(raw)
            content_id = UUID(data["content_id"])
            time_delta_s = data["time_delta_s"]
            lo_id = UUID(data["lo_id"]) if data.get("lo_id") else None
            module_id = UUID(data["module_id"]) if data.get("module_id") else None
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            raise HTTPException(400, f"Invalid request body: {e}")
    else:
        content_id = body.content_id
        time_delta_s = body.time_delta_s
        lo_id = body.lo_id
        module_id = body.module_id

    async with get_transaction() as conn:
        # Ensure records exist at all levels, then update time
        await get_or_create_progress(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=content_id,
            content_type="lens",
            content_title="",
        )
        await update_time_spent(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=content_id,
            time_delta_s=time_delta_s,
        )

        if lo_id:
            await get_or_create_progress(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=lo_id,
                content_type="lo",
                content_title="",
            )
            await update_time_spent(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=lo_id,
                time_delta_s=time_delta_s,
            )

        if module_id:
            await get_or_create_progress(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=module_id,
                content_type="module",
                content_title="",
            )
            await update_time_spent(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=module_id,
                time_delta_s=time_delta_s,
            )
```

Add the missing import at the top of `web_api/routes/progress.py`:

```python
from core.modules.progress import (
    get_or_create_progress,
    mark_content_complete,
    update_time_spent,
    get_module_progress,
)
```

**Step 4: Run tests to verify they pass**

```bash
../.venv/bin/pytest web_api/tests/test_progress_e2e.py -v
```

Expected: ALL PASS.

**Step 5: Commit**

```bash
jj commit -m "feat: multi-level heartbeat writes time to lens, LO, and module"
```

---

## Task 3: Completion propagation — auto-complete LO and module

When a lens is marked complete, check if the parent LO and module should also be marked complete.

**Files:**
- Modify: `web_api/routes/progress.py:97-240` (complete_content endpoint)
- Modify: `web_api/routes/modules.py:227-339` (update_module_progress endpoint)
- Create: `core/modules/completion.py` (completion propagation logic)

**Step 1: Write the failing test**

Add to `web_api/tests/test_progress_e2e.py`:

```python
class TestCompletionPropagation:
    """Completing the last required lens auto-completes LO and module."""

    def test_completing_last_lens_autocompletes_lo_and_module(
        self, anon_token
    ):
        """When all required lenses in an LO are complete, the LO and module should auto-complete."""
        from main import app
        from core.content import set_cache, clear_cache, ContentCache
        from core.modules.flattened_types import FlattenedModule
        from datetime import datetime

        lens_1 = str(uuid.uuid4())
        lens_2 = str(uuid.uuid4())
        lo = str(uuid.uuid4())
        mod = str(uuid.uuid4())

        # Set up a module with 2 required lenses in one LO
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

        client = TestClient(app)
        headers = {"X-Anonymous-Token": anon_token}

        # Send heartbeats to accumulate time
        for lens in [lens_1, lens_2]:
            client.post(
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
        client.post(
            "/api/modules/test-module/progress",
            json={"contentId": lens_1, "completed": True},
            headers=headers,
        )

        # LO should NOT be complete yet (only 1 of 2 lenses done)
        import asyncio

        async def check_partial():
            lo_record = await get_progress_record(lo, anon_token)
            assert lo_record is None or lo_record["completed_at"] is None

        asyncio.get_event_loop().run_until_complete(check_partial())

        # Complete lens 2
        client.post(
            "/api/modules/test-module/progress",
            json={"contentId": lens_2, "completed": True},
            headers=headers,
        )

        # Now LO and module should both be complete
        async def check_complete():
            lo_record = await get_progress_record(lo, anon_token)
            mod_record = await get_progress_record(mod, anon_token)

            assert lo_record is not None, "LO record should exist"
            assert lo_record["completed_at"] is not None, "LO should be complete"
            assert lo_record["time_to_complete_s"] == 120  # Snapshot of accumulated time

            assert mod_record is not None, "Module record should exist"
            assert mod_record["completed_at"] is not None, "Module should be complete"

        asyncio.get_event_loop().run_until_complete(check_complete())

        clear_cache()

    def test_already_completed_lo_not_overwritten(self, anon_token):
        """An already-completed LO should not have its completion timestamp or time changed."""
        from main import app
        from core.content import set_cache, clear_cache, ContentCache
        from core.modules.flattened_types import FlattenedModule
        from datetime import datetime

        lens_1 = str(uuid.uuid4())
        lens_2 = str(uuid.uuid4())
        lens_3 = str(uuid.uuid4())
        lo = str(uuid.uuid4())
        mod = str(uuid.uuid4())

        # Phase 1: Module with 2 lenses in one LO
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

        client = TestClient(app)
        headers = {"X-Anonymous-Token": anon_token}

        # Accumulate time and complete both lenses → LO auto-completes
        for lens in [lens_1, lens_2]:
            client.post("/api/progress/time", json={"content_id": lens, "time_delta_s": 60, "lo_id": lo, "module_id": mod}, headers=headers)
            client.post("/api/modules/test-module/progress", json={"contentId": lens, "completed": True}, headers=headers)

        import asyncio

        async def get_lo_completion():
            record = await get_progress_record(lo, anon_token)
            return record["completed_at"], record["time_to_complete_s"]

        original_completed_at, original_time = asyncio.get_event_loop().run_until_complete(get_lo_completion())

        # Phase 2: Module gains a new lens in the same LO
        cache.flattened_modules["test-module"].sections.append({
            "type": "article",
            "contentId": lens_3,
            "learningOutcomeId": lo,
            "meta": {"title": "Lens 3"},
            "segments": [],
            "optional": False,
        })

        # Complete the new lens
        client.post("/api/progress/time", json={"content_id": lens_3, "time_delta_s": 30, "lo_id": lo, "module_id": mod}, headers=headers)
        client.post("/api/modules/test-module/progress", json={"contentId": lens_3, "completed": True}, headers=headers)

        # LO completion should be unchanged
        async def check_unchanged():
            record = await get_progress_record(lo, anon_token)
            assert record["completed_at"] == original_completed_at
            assert record["time_to_complete_s"] == original_time

        asyncio.get_event_loop().run_until_complete(check_unchanged())

        clear_cache()
```

**Step 2: Run test to verify it fails**

```bash
../.venv/bin/pytest web_api/tests/test_progress_e2e.py::TestCompletionPropagation::test_completing_last_lens_autocompletes_lo_and_module -v
```

Expected: FAIL — no completion propagation exists yet.

**Step 3: Create `core/modules/completion.py`**

```python
"""Completion propagation for multi-level progress tracking.

When a lens is completed, checks if the parent LO and module should
also be marked complete (all current required lenses done).
"""

from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncConnection

from core.tables import user_content_progress
from core.modules.progress import get_or_create_progress


async def propagate_completion(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    module_sections: list[dict],
    completed_lens_id: UUID,
) -> None:
    """After a lens is completed, check and auto-complete parent LO and module.

    Args:
        conn: Database connection (within a transaction)
        user_id: Authenticated user ID (or None)
        anonymous_token: Anonymous token (or None)
        module_sections: The flattened module sections list
        completed_lens_id: The lens that was just completed
    """
    # Find the completed lens's LO and the module content_id
    completed_section = None
    for section in module_sections:
        cid = section.get("contentId")
        if cid and UUID(cid) == completed_lens_id:
            completed_section = section
            break

    if not completed_section:
        return

    lo_id_str = completed_section.get("learningOutcomeId")

    # Collect all required lens IDs, grouped by LO
    required_lens_ids = []
    lo_lens_ids = []
    for section in module_sections:
        cid = section.get("contentId")
        if not cid or section.get("optional", False):
            continue
        required_lens_ids.append(UUID(cid))
        if lo_id_str and section.get("learningOutcomeId") == lo_id_str:
            lo_lens_ids.append(UUID(cid))

    # Query completion status for all required lenses
    all_ids = list(set(required_lens_ids))
    if user_id is not None:
        where = and_(
            user_content_progress.c.user_id == user_id,
            user_content_progress.c.content_id.in_(all_ids),
        )
    elif anonymous_token is not None:
        where = and_(
            user_content_progress.c.anonymous_token == anonymous_token,
            user_content_progress.c.content_id.in_(all_ids),
        )
    else:
        return

    result = await conn.execute(select(user_content_progress).where(where))
    progress_map = {row.content_id: dict(row._mapping) for row in result.fetchall()}

    now = datetime.now(timezone.utc)

    # Check LO completion
    if lo_id_str and lo_lens_ids:
        lo_all_complete = all(
            progress_map.get(lid, {}).get("completed_at") is not None
            for lid in lo_lens_ids
        )
        if lo_all_complete:
            await _mark_complete_if_not_already(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=UUID(lo_id_str),
                content_type="lo",
                now=now,
            )

    # Check module completion
    module_all_complete = all(
        progress_map.get(lid, {}).get("completed_at") is not None
        for lid in required_lens_ids
    )
    if module_all_complete:
        # Find the module content_id from any section's parent module
        # The module content_id is passed in through the flattened module
        # We need it from the caller — but we don't have it here.
        # The caller should pass it. For now, skip module completion
        # if we can't determine the module UUID.
        pass  # Module completion handled by caller who has module.content_id


async def _mark_complete_if_not_already(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    content_id: UUID,
    content_type: str,
    now: datetime,
) -> None:
    """Mark content complete only if not already completed. Idempotent."""
    # Get existing record
    progress = await get_or_create_progress(
        conn,
        user_id=user_id,
        anonymous_token=anonymous_token,
        content_id=content_id,
        content_type=content_type,
        content_title="",
    )

    if progress.get("completed_at"):
        return  # Already complete, preserve historical record

    await conn.execute(
        update(user_content_progress)
        .where(user_content_progress.c.id == progress["id"])
        .values(
            completed_at=now,
            time_to_complete_s=progress["total_time_spent_s"],
        )
    )
```

Update the signature to also accept `module_content_id`:

```python
async def propagate_completion(
    conn: AsyncConnection,
    *,
    user_id: int | None,
    anonymous_token: UUID | None,
    module_sections: list[dict],
    module_content_id: UUID,
    completed_lens_id: UUID,
) -> None:
```

And replace the `pass` in module completion with:

```python
    if module_all_complete and module_content_id:
        await _mark_complete_if_not_already(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=module_content_id,
            content_type="module",
            now=now,
        )
```

**Step 4: Wire up completion propagation in the API routes**

In `web_api/routes/modules.py`, after `mark_content_complete` succeeds (line 294-302), add:

```python
from core.modules.completion import propagate_completion

# ... inside the transaction, after mark_content_complete:
if body.completed and module.content_id:
    await propagate_completion(
        conn,
        user_id=user_id,
        anonymous_token=anonymous_token,
        module_sections=module.sections,
        module_content_id=module.content_id,
        completed_lens_id=body.contentId,
    )
```

Similarly in `web_api/routes/progress.py` `complete_content`, after `mark_content_complete` (line 125-133), add propagation when `module_slug` is provided:

```python
if body.module_slug:
    from core.modules.loader import load_flattened_module, ModuleNotFoundError
    try:
        module = load_flattened_module(body.module_slug)
        if module.content_id:
            await propagate_completion(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                module_sections=module.sections,
                module_content_id=module.content_id,
                completed_lens_id=body.content_id,
            )
    except ModuleNotFoundError:
        pass
```

**Step 5: Run tests to verify they pass**

```bash
../.venv/bin/pytest web_api/tests/test_progress_e2e.py -v
```

Expected: ALL PASS.

**Step 6: Commit**

```bash
jj commit -m "feat: auto-complete LO and module when all required lenses are done"
```

---

## Task 4: Multi-level heartbeat in `POST /api/modules/{slug}/progress`

The module-specific progress endpoint also handles heartbeats. It should write to LO and module levels too.

**Files:**
- Modify: `web_api/routes/modules.py:41-47` (ProgressUpdateRequest)
- Modify: `web_api/routes/modules.py:291-327` (heartbeat path)

**Step 1: Write the failing test**

Add to `web_api/tests/test_progress_e2e.py`:

```python
class TestModuleProgressEndpointMultiLevel:
    """POST /api/modules/{slug}/progress writes time at all levels."""

    def test_module_progress_heartbeat_writes_all_levels(self, anon_token):
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
                    sections=[{
                        "type": "article",
                        "contentId": lens,
                        "learningOutcomeId": lo,
                        "meta": {"title": "Lens"},
                        "segments": [],
                        "optional": False,
                    }],
                ),
            },
            parsed_learning_outcomes={},
            parsed_lenses={},
            articles={},
            video_transcripts={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        client = TestClient(app)
        response = client.post(
            "/api/modules/test-mod/progress",
            json={"contentId": lens, "timeSpentS": 30, "completed": False},
            headers={"X-Anonymous-Token": anon_token},
        )
        assert response.status_code == 200

        import asyncio

        async def check():
            lens_rec = await get_progress_record(lens, anon_token)
            lo_rec = await get_progress_record(lo, anon_token)
            mod_rec = await get_progress_record(mod, anon_token)

            assert lens_rec is not None
            assert lens_rec["total_time_spent_s"] == 30

            assert lo_rec is not None
            assert lo_rec["total_time_spent_s"] == 30

            assert mod_rec is not None
            assert mod_rec["total_time_spent_s"] == 30

        asyncio.get_event_loop().run_until_complete(check())
        clear_cache()
```

**Step 2: Run test to verify it fails**

```bash
../.venv/bin/pytest web_api/tests/test_progress_e2e.py::TestModuleProgressEndpointMultiLevel -v
```

Expected: FAIL — the endpoint only writes to the lens level.

**Step 3: Implement multi-level writes in module progress endpoint**

In `web_api/routes/modules.py`, inside the heartbeat path (the `else` branch at line 303-327), after updating lens time, add LO and module updates:

```python
        else:
            # Heartbeat: ensure record exists and update time
            progress = await get_or_create_progress(
                conn,
                user_id=user_id,
                anonymous_token=anonymous_token,
                content_id=body.contentId,
                content_type="lens",
                content_title=content_title,
            )

            if body.timeSpentS > 0:
                await update_time_spent(
                    conn,
                    user_id=user_id,
                    anonymous_token=anonymous_token,
                    content_id=body.contentId,
                    time_delta_s=body.timeSpentS,
                )
                progress["total_time_spent_s"] = (
                    progress.get("total_time_spent_s", 0) + body.timeSpentS
                )

                # Update LO and module time
                lo_id_str = matching_section.get("learningOutcomeId")
                if lo_id_str:
                    lo_uuid = UUID(lo_id_str)
                    await get_or_create_progress(
                        conn,
                        user_id=user_id,
                        anonymous_token=anonymous_token,
                        content_id=lo_uuid,
                        content_type="lo",
                        content_title="",
                    )
                    await update_time_spent(
                        conn,
                        user_id=user_id,
                        anonymous_token=anonymous_token,
                        content_id=lo_uuid,
                        time_delta_s=body.timeSpentS,
                    )

                if module.content_id:
                    await get_or_create_progress(
                        conn,
                        user_id=user_id,
                        anonymous_token=anonymous_token,
                        content_id=module.content_id,
                        content_type="module",
                        content_title="",
                    )
                    await update_time_spent(
                        conn,
                        user_id=user_id,
                        anonymous_token=anonymous_token,
                        content_id=module.content_id,
                        time_delta_s=body.timeSpentS,
                    )
```

**Step 4: Run tests to verify they pass**

```bash
../.venv/bin/pytest web_api/tests/test_progress_e2e.py -v
```

Expected: ALL PASS.

**Step 5: Commit**

```bash
jj commit -m "feat: module progress endpoint writes time at lens, LO, and module levels"
```

---

## Task 5: Frontend — send LO and module UUIDs in heartbeats

Update the frontend to include `lo_id` and `module_id` in heartbeat payloads.

**Files:**
- Modify: `web_frontend/src/api/progress.ts:61-79` (updateTimeSpent)
- Modify: `web_frontend/src/hooks/useActivityTracker.ts` (pass through LO/module IDs)
- Modify: `web_frontend/src/views/Module.tsx:493-519` (pass IDs to tracker)

**Step 1: Update `updateTimeSpent` API client**

In `web_frontend/src/api/progress.ts`, add `loId` and `moduleId` parameters:

```typescript
export async function updateTimeSpent(
  contentId: string,
  timeDeltaS: number,
  isAuthenticated: boolean,
  loId?: string | null,
  moduleId?: string | null,
): Promise<void> {
  await fetchWithRefresh(`${API_BASE}/api/progress/time`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(isAuthenticated),
    },
    credentials: "include",
    body: JSON.stringify({
      content_id: contentId,
      time_delta_s: timeDeltaS,
      lo_id: loId ?? undefined,
      module_id: moduleId ?? undefined,
    }),
  });
}
```

**Step 2: Update `useActivityTracker` hook**

In `web_frontend/src/hooks/useActivityTracker.ts`, add `loId` and `moduleId` to options and pass them through:

```typescript
interface ActivityTrackerOptions {
  contentId?: string;
  loId?: string | null;
  moduleId?: string | null;
  isAuthenticated?: boolean;
  inactivityTimeout?: number;
  heartbeatInterval?: number;
  enabled?: boolean;
}

export function useActivityTracker({
  contentId,
  loId,
  moduleId,
  isAuthenticated = false,
  // ... rest unchanged
}: ActivityTrackerOptions) {
```

Update `sendProgressHeartbeat` to pass the new IDs:

```typescript
  const sendProgressHeartbeat = useCallback(async () => {
    if (!enabled || !contentId) return;

    const now = Date.now();
    const lastTime = lastHeartbeatTimeRef.current;
    const timeDeltaS = lastTime ? Math.floor((now - lastTime) / 1000) : 0;
    lastHeartbeatTimeRef.current = now;

    if (timeDeltaS <= 0) return;

    try {
      await updateTimeSpent(contentId, timeDeltaS, isAuthenticated, loId, moduleId);
    } catch (error) {
      console.debug("Progress heartbeat failed:", error);
    }
  }, [contentId, loId, moduleId, isAuthenticated, enabled]);
```

Also update the `sendBeacon` in the `beforeunload` handler to include `lo_id` and `module_id` in the payload.

**Step 3: Update `Module.tsx` to pass LO and module IDs to trackers**

In `web_frontend/src/views/Module.tsx`, update the three `useActivityTracker` calls (lines 493-519) to pass through the section's `learningOutcomeId` and the module's `content_id`:

```typescript
  // Get module content ID for time tracking
  const moduleContentId = module?.sections?.[0]
    ? /* module content_id from API response */ undefined
    : undefined;
```

Wait — the module response already includes `module.id` (the module's content UUID) from the `GET /api/modules/{slug}/progress` response. Check how the module data flows to the view and use that ID.

Pass to each tracker:

```typescript
  useActivityTracker({
    contentId: currentSection?.contentId ?? undefined,
    loId: currentSection?.learningOutcomeId,
    moduleId: moduleContentId,
    isAuthenticated,
    inactivityTimeout: 180_000,
    enabled: !!currentSection?.contentId && (currentSectionType === "article" || currentSection?.type === "text"),
  });
```

Apply the same pattern to all three tracker instances.

**Step 4: Verify manually**

Start the dev server, open a module page, and check the Network tab to confirm heartbeats include `lo_id` and `module_id`.

**Step 5: Commit**

```bash
jj commit -m "feat: frontend sends LO and module UUIDs in heartbeat payloads"
```

---

## Task 6: Frontend — fix chat activity tracking

Make the activity tracker keep ticking during chat interactions.

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:570-575` (handleSendMessage)
- Modify: `web_frontend/src/views/Module.tsx:493-519` (consolidate trackers)

**Step 1: Consolidate to a single activity tracker per section**

The current code creates three separate `useActivityTracker` instances (article, video, chat). Since we want unified time tracking per section regardless of content type, consolidate to one tracker:

```typescript
  const { triggerActivity } = useActivityTracker({
    contentId: currentSection?.contentId ?? undefined,
    loId: currentSection?.learningOutcomeId,
    moduleId: moduleContentId,
    isAuthenticated,
    inactivityTimeout: 300_000, // 5 min — generous for chat reading
    enabled: !!currentSection?.contentId,
  });
```

**Step 2: Trigger activity on chat events**

In `handleSendMessage` (line 571-574), call `triggerActivity()` when a message is sent (already exists).

Add a new trigger when a streaming response is being received. In the SSE handler for chat responses, call `triggerActivity()` periodically (e.g., on each chunk) so the user stays "active" while reading the AI's response:

```typescript
// In the SSE event handler for chat streaming:
triggerActivity(); // Keep user active while AI response streams
```

The exact location depends on how the chat streaming is wired — look for the `EventSource` or `fetch` streaming handler in `Module.tsx` or its chat component.

**Step 3: Verify manually**

Open a module with a chat segment. Send a message, wait for the response, and confirm heartbeats continue during the chat interaction.

**Step 4: Commit**

```bash
jj commit -m "fix: chat activity keeps heartbeat alive during conversations"
```

---

## Task 7: Run full test suite and verify

**Step 1: Run all backend tests**

```bash
../.venv/bin/pytest -v
```

Expected: ALL PASS.

**Step 2: Run linting**

```bash
cd web_frontend && npm run lint && cd ..
ruff check .
ruff format --check .
```

**Step 3: Build frontend**

```bash
cd web_frontend && npm run build
```

**Step 4: Commit any fixes**

```bash
jj commit -m "chore: fix lint/type issues from time tracking changes"
```
