# Live Validation Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the click-to-validate flow with a live-updating SSE-powered dashboard that shows validation results in real-time as content changes flow from Obsidian through GitHub.

**Architecture:** Add three-stage SHA tracking to the cache (known → fetched → processed), a `ValidationBroadcaster` that manages SSE client connections and background GitHub polling, and a frontend `EventSource` that receives live updates. The webhook and poller both feed into the broadcaster.

**Tech Stack:** Python (FastAPI `StreamingResponse` for SSE), asyncio (background polling), TypeScript/React (`EventSource` API)

**Design doc:** `docs/plans/2026-02-06-live-validation-dashboard-design.md`

---

### Task 1: Add three-stage SHA tracking to ContentCache

**Files:**
- Modify: `core/content/cache.py:16-40`
- Test: `core/content/tests/test_cache.py`

**Step 1: Write the failing test**

Add to `core/content/tests/test_cache.py`:

```python
def test_cache_stores_three_stage_shas(self):
    """Should store known, fetched, and processed SHAs with timestamps."""
    now = datetime(2026, 2, 6, 12, 0, 0)
    cache = ContentCache(
        courses={},
        flattened_modules={},
        articles={},
        video_transcripts={},
        parsed_learning_outcomes={},
        parsed_lenses={},
        last_refreshed=now,
        known_sha="aaa111",
        known_sha_timestamp=now,
        fetched_sha="bbb222",
        fetched_sha_timestamp=now,
        processed_sha="ccc333",
        processed_sha_timestamp=now,
    )
    set_cache(cache)
    retrieved = get_cache()
    assert retrieved.known_sha == "aaa111"
    assert retrieved.known_sha_timestamp == now
    assert retrieved.fetched_sha == "bbb222"
    assert retrieved.fetched_sha_timestamp == now
    assert retrieved.processed_sha == "ccc333"
    assert retrieved.processed_sha_timestamp == now
```

**Step 2: Run test to verify it fails**

Run: `pytest core/content/tests/test_cache.py::TestContentCache::test_cache_stores_three_stage_shas -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'known_sha'`

**Step 3: Write minimal implementation**

In `core/content/cache.py`, **keep** the existing `last_commit_sha` field for backward compatibility and **add** the new fields to the `ContentCache` dataclass:

```python
@dataclass
class ContentCache:
    """Cache for all educational content.

    Modules are stored in flattened form - all Learning Outcome and
    Uncategorized references resolved to lens-video/lens-article sections
    by the TypeScript processor.
    """

    courses: dict[str, ParsedCourse]  # slug -> parsed course
    flattened_modules: dict[str, FlattenedModule]  # slug -> flattened module
    # Legacy fields - kept for compatibility but always empty (TypeScript handles these)
    parsed_learning_outcomes: dict[str, Any]  # Always {} - TypeScript handles
    parsed_lenses: dict[str, Any]  # Always {} - TypeScript handles
    articles: dict[str, str]  # path -> raw markdown (for metadata extraction)
    video_transcripts: dict[str, str]  # path -> raw markdown (for metadata extraction)
    last_refreshed: datetime
    video_timestamps: dict[str, list[dict]] | None = (
        None  # video_id -> timestamp word list
    )
    # --- Three-stage SHA tracking ---
    # Latest commit we've heard about (from webhook or polling GitHub API)
    known_sha: str | None = None
    known_sha_timestamp: datetime | None = None  # commit's author timestamp
    # Raw files in cache are from this commit
    fetched_sha: str | None = None
    fetched_sha_timestamp: datetime | None = None
    # Validation results (parsed/processed) are from this commit
    processed_sha: str | None = None
    processed_sha_timestamp: datetime | None = None
    # Legacy — keep for backward compat during migration, alias for processed_sha
    last_commit_sha: str | None = None
    # Raw files for incremental updates - all files sent to TypeScript processor
    raw_files: dict[str, str] | None = None  # path -> raw content
    # Validation errors/warnings from last content processing
    validation_errors: list[dict] | None = None
    # Diff from last incremental refresh (from GitHub Compare API)
    last_diff: list[dict] | None = None
```

**Step 4: Run test to verify it passes**

Run: `pytest core/content/tests/test_cache.py -v`
Expected: ALL PASS

**Step 5: Commit**

```
feat: add three-stage SHA tracking to ContentCache
```

---

### Task 2: Add diff storage to CommitComparison and compare_commits

**Files:**
- Modify: `core/content/github_fetcher.py:71-85` (dataclasses), `core/content/github_fetcher.py:224-278` (compare_commits)
- Test: `core/content/tests/test_github_fetcher.py` (add new test)

The GitHub Compare API already returns `additions`, `deletions`, and `patch` per file. We currently discard these. We need to capture them.

**Step 1: Write the failing test**

Add to `core/content/tests/test_github_fetcher.py`:

```python
class TestCompareCommitsDiffData:
    """Test that compare_commits captures diff data from GitHub API."""

    @pytest.mark.asyncio
    async def test_compare_commits_captures_diff_stats(self):
        """Should capture additions, deletions, and patch from GitHub Compare API."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "files": [
                {
                    "filename": "modules/intro.md",
                    "status": "modified",
                    "additions": 3,
                    "deletions": 1,
                    "patch": "@@ -1,4 +1,6 @@\n old line\n+new line",
                },
            ]
        }

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client.get.return_value = mock_response
            mock_client_class.return_value = mock_client

            with patch.dict(
                os.environ,
                {"EDUCATIONAL_CONTENT_BRANCH": "main", "GITHUB_TOKEN": "test"},
            ):
                result = await compare_commits("old_sha", "new_sha")

        assert len(result.files) == 1
        assert result.files[0].additions == 3
        assert result.files[0].deletions == 1
        assert result.files[0].patch == "@@ -1,4 +1,6 @@\n old line\n+new line"
```

**Step 2: Run test to verify it fails**

Run: `pytest core/content/tests/test_github_fetcher.py::TestCompareCommitsDiffData -v`
Expected: FAIL — `AttributeError: 'ChangedFile' object has no attribute 'additions'`

**Step 3: Write minimal implementation**

Update `ChangedFile` dataclass in `core/content/github_fetcher.py:71-77`:

```python
@dataclass
class ChangedFile:
    """Represents a file changed between two commits."""

    path: str
    status: Literal["added", "modified", "removed", "renamed"]
    previous_path: str | None = None  # For renamed files
    additions: int = 0
    deletions: int = 0
    patch: str | None = None
```

Update `compare_commits()` at `core/content/github_fetcher.py:267-273` to capture the new fields:

```python
            changed_files.append(
                ChangedFile(
                    path=file_info["filename"],
                    status=status,
                    previous_path=previous_path,
                    additions=file_info.get("additions", 0),
                    deletions=file_info.get("deletions", 0),
                    patch=file_info.get("patch"),
                )
            )
```

**Step 4: Run test to verify it passes**

Run: `pytest core/content/tests/test_github_fetcher.py::TestCompareCommitsDiffData -v`
Expected: PASS

Then run all existing tests: `pytest core/content/tests/test_github_fetcher.py -v`
Expected: ALL PASS (new fields have defaults, no breakage)

**Step 5: Commit**

```
feat: capture diff stats from GitHub Compare API
```

---

### Task 3: Update incremental_refresh to populate three-stage SHAs and diff

**Files:**
- Modify: `core/content/github_fetcher.py:667-865` (incremental_refresh), `core/content/github_fetcher.py:435-449` (fetch_all_content cache construction)
- Test: `core/content/tests/test_github_fetcher.py`

This task updates `incremental_refresh()` to:
1. Store the diff from `compare_commits()` in `cache.last_diff`
2. Update `fetched_sha` + timestamp after fetching files
3. Update `processed_sha` + timestamp after TypeScript processing
4. Keep `last_commit_sha` as an alias of `processed_sha` for backward compatibility

Also update `fetch_all_content()` to populate the new fields.

**Note on timestamps:** The design doc says timestamps should be the commit's author timestamp from GitHub. However, for the initial implementation we use `datetime.now()` (server time). This tells content creators "when did the server process this" rather than "when was this committed." The GitHub Commits API returns `data["commit"]["author"]["date"]` which could be extracted later if the commit timestamp is more useful. For now `datetime.now()` is simpler and still sufficient to answer "is my recent change reflected?"

**Step 1: Write the failing test**

Add to `core/content/tests/test_github_fetcher.py`. This test checks that after an incremental refresh, the three SHAs and diff are populated:

```python
class TestIncrementalRefreshSHATracking:
    """Test three-stage SHA tracking in incremental_refresh."""

    def setup_method(self):
        clear_cache()

    def teardown_method(self):
        clear_cache()

    @pytest.mark.asyncio
    async def test_incremental_refresh_updates_three_shas(self):
        """After incremental refresh, fetched_sha and processed_sha should be set."""
        # Set up initial cache at old SHA
        initial_cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            last_commit_sha="old_sha_111",
            processed_sha="old_sha_111",
            raw_files={"modules/test.md": "---\ntitle: Test\nslug: test\n---\n"},
        )
        set_cache(initial_cache)

        mock_comparison = CommitComparison(
            files=[
                ChangedFile(
                    path="modules/test.md",
                    status="modified",
                    additions=2,
                    deletions=1,
                    patch="@@ -1 +1,2 @@\n+new line",
                )
            ],
            is_truncated=False,
        )

        with patch("core.content.github_fetcher.compare_commits", new_callable=AsyncMock, return_value=mock_comparison):
            with patch("core.content.github_fetcher._fetch_file_with_client", new_callable=AsyncMock, return_value="---\ntitle: Test Updated\nslug: test\n---\n"):
                with patch("core.content.github_fetcher.process_content_typescript", new_callable=AsyncMock, return_value={"modules": [], "courses": [], "errors": []}):
                    result = await incremental_refresh("new_sha_222")

        cache = get_cache()
        assert cache.fetched_sha == "new_sha_222"
        assert cache.processed_sha == "new_sha_222"
        assert cache.last_commit_sha == "new_sha_222"
        assert cache.fetched_sha_timestamp is not None
        assert cache.processed_sha_timestamp is not None

    @pytest.mark.asyncio
    async def test_incremental_refresh_stores_diff(self):
        """After incremental refresh, last_diff should contain file change info."""
        initial_cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            last_commit_sha="old_sha_111",
            processed_sha="old_sha_111",
            raw_files={"modules/test.md": "---\ntitle: Test\nslug: test\n---\n"},
        )
        set_cache(initial_cache)

        mock_comparison = CommitComparison(
            files=[
                ChangedFile(
                    path="modules/test.md",
                    status="modified",
                    additions=2,
                    deletions=1,
                    patch="@@ -1 +1,2 @@\n+new line",
                )
            ],
            is_truncated=False,
        )

        with patch("core.content.github_fetcher.compare_commits", new_callable=AsyncMock, return_value=mock_comparison):
            with patch("core.content.github_fetcher._fetch_file_with_client", new_callable=AsyncMock, return_value="updated content"):
                with patch("core.content.github_fetcher.process_content_typescript", new_callable=AsyncMock, return_value={"modules": [], "courses": [], "errors": []}):
                    await incremental_refresh("new_sha_222")

        cache = get_cache()
        assert cache.last_diff is not None
        assert len(cache.last_diff) == 1
        assert cache.last_diff[0]["filename"] == "modules/test.md"
        assert cache.last_diff[0]["status"] == "modified"
        assert cache.last_diff[0]["additions"] == 2
        assert cache.last_diff[0]["deletions"] == 1
        assert cache.last_diff[0]["patch"] == "@@ -1 +1,2 @@\n+new line"
```

**Step 2: Run tests to verify they fail**

Run: `pytest core/content/tests/test_github_fetcher.py::TestIncrementalRefreshSHATracking -v`
Expected: FAIL — `fetched_sha` is None, `last_diff` is None

**Step 3: Write minimal implementation**

In `incremental_refresh()` at `core/content/github_fetcher.py`:

After the compare_commits call (~line 714), store the diff:
```python
        comparison = await compare_commits(cache.last_commit_sha, new_commit_sha)

        # Store diff for frontend display
        diff_data = [
            {
                "filename": c.path,
                "status": c.status,
                "additions": c.additions,
                "deletions": c.deletions,
                "patch": c.patch,
            }
            for c in comparison.files
        ]
```

After fetching files (~line 761), update fetched_sha:
```python
        cache.fetched_sha = new_commit_sha
        cache.fetched_sha_timestamp = datetime.now()
```

In the cache update block (~lines 845-854), add the new fields:
```python
        cache.last_commit_sha = new_commit_sha
        cache.fetched_sha = new_commit_sha
        cache.fetched_sha_timestamp = datetime.now()  # (or keep from earlier)
        cache.processed_sha = new_commit_sha
        cache.processed_sha_timestamp = datetime.now()
        cache.last_diff = diff_data
```

Also update `fetch_all_content()` (~line 435-449) to populate the new fields when building the initial cache:
```python
        cache = ContentCache(
            # ... existing fields ...
            last_commit_sha=commit_sha,
            known_sha=commit_sha,
            known_sha_timestamp=datetime.now(),
            fetched_sha=commit_sha,
            fetched_sha_timestamp=datetime.now(),
            processed_sha=commit_sha,
            processed_sha_timestamp=datetime.now(),
            # ... rest ...
        )
```

**Step 4: Run tests to verify they pass**

Run: `pytest core/content/tests/test_github_fetcher.py::TestIncrementalRefreshSHATracking -v`
Expected: PASS

Then run: `pytest core/content/tests/ -v`
Expected: ALL PASS

**Step 5: Commit**

```
feat: populate three-stage SHAs and diff in incremental_refresh
```

---

### Task 4: Create ValidationBroadcaster

**Files:**
- Create: `core/content/validation_broadcaster.py`
- Test: `core/content/tests/test_validation_broadcaster.py`

This is the core new component. It manages SSE subscribers, broadcasts cache state, and runs a background poller when clients are connected.

**Step 1: Write the failing tests**

Create `core/content/tests/test_validation_broadcaster.py`:

```python
"""Tests for ValidationBroadcaster."""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from core.content.cache import ContentCache, set_cache, clear_cache
from core.content.validation_broadcaster import ValidationBroadcaster


class TestValidationBroadcaster:
    """Test SSE subscriber management and broadcasting."""

    def setup_method(self):
        clear_cache()
        self.broadcaster = ValidationBroadcaster(poll_interval=30)

    def teardown_method(self):
        clear_cache()

    @pytest.mark.asyncio
    async def test_subscribe_returns_queue(self):
        """subscribe() should return an asyncio.Queue."""
        queue = await self.broadcaster.subscribe()
        assert isinstance(queue, asyncio.Queue)
        await self.broadcaster.unsubscribe(queue)

    @pytest.mark.asyncio
    async def test_subscribe_sends_current_cache_state(self):
        """On subscribe, the queue should immediately receive current cache state."""
        cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            processed_sha="abc123",
            processed_sha_timestamp=datetime.now(),
            validation_errors=[{"file": "test.md", "message": "error", "severity": "error"}],
        )
        set_cache(cache)

        queue = await self.broadcaster.subscribe()
        msg = queue.get_nowait()
        assert msg["processed_sha"] == "abc123"
        assert msg["summary"]["errors"] == 1
        await self.broadcaster.unsubscribe(queue)

    @pytest.mark.asyncio
    async def test_subscribe_sends_no_cache_when_uninitialized(self):
        """When cache not initialized, subscribe sends a no_cache message."""
        queue = await self.broadcaster.subscribe()
        msg = queue.get_nowait()
        assert msg["status"] == "no_cache"
        await self.broadcaster.unsubscribe(queue)

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all_subscribers(self):
        """broadcast() should put the message in all subscriber queues."""
        q1 = await self.broadcaster.subscribe()
        q2 = await self.broadcaster.subscribe()

        # Drain the initial messages
        q1.get_nowait()
        q2.get_nowait()

        await self.broadcaster.broadcast({"test": "data"})

        assert q1.get_nowait() == {"test": "data"}
        assert q2.get_nowait() == {"test": "data"}

        await self.broadcaster.unsubscribe(q1)
        await self.broadcaster.unsubscribe(q2)

    @pytest.mark.asyncio
    async def test_unsubscribe_removes_queue(self):
        """After unsubscribe, broadcasts should not reach the queue."""
        queue = await self.broadcaster.subscribe()
        queue.get_nowait()  # drain initial

        await self.broadcaster.unsubscribe(queue)
        await self.broadcaster.broadcast({"test": "data"})

        assert queue.empty()

    @pytest.mark.asyncio
    async def test_subscriber_count(self):
        """subscriber_count should track active subscribers."""
        assert self.broadcaster.subscriber_count == 0

        q1 = await self.broadcaster.subscribe()
        assert self.broadcaster.subscriber_count == 1

        q2 = await self.broadcaster.subscribe()
        assert self.broadcaster.subscriber_count == 2

        await self.broadcaster.unsubscribe(q1)
        assert self.broadcaster.subscriber_count == 1

        await self.broadcaster.unsubscribe(q2)
        assert self.broadcaster.subscriber_count == 0
```

**Step 2: Run tests to verify they fail**

Run: `pytest core/content/tests/test_validation_broadcaster.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.content.validation_broadcaster'`

**Step 3: Write minimal implementation**

Create `core/content/validation_broadcaster.py`:

```python
"""Manages SSE connections and background polling for live validation updates."""

import asyncio
import logging

from core.content.cache import get_cache, CacheNotInitializedError

logger = logging.getLogger(__name__)


class ValidationBroadcaster:
    """Manages SSE subscribers, broadcasts validation state, and polls GitHub."""

    def __init__(self, poll_interval: int = 30):
        self._subscribers: set[asyncio.Queue] = set()
        self._poll_task: asyncio.Task | None = None
        self._poll_interval = poll_interval

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def _build_cache_snapshot(self) -> dict:
        """Build a JSON-serializable snapshot of current cache state."""
        try:
            cache = get_cache()
        except CacheNotInitializedError:
            return {"status": "no_cache"}

        errors = cache.validation_errors or []
        error_count = len([e for e in errors if e.get("severity") == "error"])
        warning_count = len([e for e in errors if e.get("severity") == "warning"])

        return {
            "status": "ok",
            "known_sha": cache.known_sha,
            "known_sha_timestamp": cache.known_sha_timestamp.isoformat() if cache.known_sha_timestamp else None,
            "fetched_sha": cache.fetched_sha,
            "fetched_sha_timestamp": cache.fetched_sha_timestamp.isoformat() if cache.fetched_sha_timestamp else None,
            "processed_sha": cache.processed_sha,
            "processed_sha_timestamp": cache.processed_sha_timestamp.isoformat() if cache.processed_sha_timestamp else None,
            "summary": {"errors": error_count, "warnings": warning_count},
            "issues": errors,
            "diff": cache.last_diff,
        }

    async def subscribe(self) -> asyncio.Queue:
        """Add a subscriber. Immediately sends current cache state."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        # Send current state immediately
        snapshot = self._build_cache_snapshot()
        queue.put_nowait(snapshot)
        logger.info(f"SSE client connected ({self.subscriber_count} total)")
        return queue

    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        """Remove a subscriber."""
        self._subscribers.discard(queue)
        logger.info(f"SSE client disconnected ({self.subscriber_count} total)")

    async def broadcast(self, result: dict) -> None:
        """Push a message to all subscribers."""
        dead_queues = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(result)
            except asyncio.QueueFull:
                dead_queues.append(queue)
        for q in dead_queues:
            self._subscribers.discard(q)


# Singleton
broadcaster = ValidationBroadcaster()
```

**Step 4: Run tests to verify they pass**

Run: `pytest core/content/tests/test_validation_broadcaster.py -v`
Expected: ALL PASS

**Step 5: Commit**

```
feat: add ValidationBroadcaster for SSE client management
```

---

### Task 5: Add background polling to ValidationBroadcaster

**Files:**
- Modify: `core/content/validation_broadcaster.py`
- Test: `core/content/tests/test_validation_broadcaster.py`

**Step 1: Write the failing tests**

Add to `core/content/tests/test_validation_broadcaster.py`:

```python
class TestValidationBroadcasterPolling:
    """Test background polling behavior."""

    def setup_method(self):
        clear_cache()
        self.broadcaster = ValidationBroadcaster(poll_interval=1)

    def teardown_method(self):
        clear_cache()
        # Ensure polling is stopped
        if self.broadcaster._poll_task and not self.broadcaster._poll_task.done():
            self.broadcaster._poll_task.cancel()

    @pytest.mark.asyncio
    async def test_polling_starts_on_first_subscriber(self):
        """Polling task should start when first subscriber connects."""
        with patch.object(self.broadcaster, "_poll_loop", new_callable=AsyncMock):
            queue = await self.broadcaster.subscribe()
            assert self.broadcaster._poll_task is not None
            await self.broadcaster.unsubscribe(queue)

    @pytest.mark.asyncio
    async def test_polling_stops_when_no_subscribers(self):
        """Polling task should be cancelled when last subscriber disconnects."""
        with patch.object(self.broadcaster, "_poll_loop", new_callable=AsyncMock):
            queue = await self.broadcaster.subscribe()
            assert self.broadcaster._poll_task is not None

            await self.broadcaster.unsubscribe(queue)
            # Give the event loop a chance to process
            await asyncio.sleep(0.01)
            assert self.broadcaster._poll_task is None or self.broadcaster._poll_task.done()

    @pytest.mark.asyncio
    async def test_poll_loop_detects_new_commit(self):
        """Poll loop should detect new commits and trigger refresh."""
        cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
            known_sha="old_sha",
            processed_sha="old_sha",
        )
        set_cache(cache)

        poll_triggered = asyncio.Event()

        async def mock_handle_update(sha):
            poll_triggered.set()
            return {"status": "ok", "commit_sha": sha}

        with patch(
            "core.content.github_fetcher.get_latest_commit_sha",
            new_callable=AsyncMock,
            return_value="new_sha_from_github",
        ):
            with patch(
                "core.content.webhook_handler.handle_content_update",
                side_effect=mock_handle_update,
            ):
                queue = await self.broadcaster.subscribe()
                queue.get_nowait()  # drain initial

                # Start polling
                self.broadcaster.start_polling()

                # Wait for poll to detect new commit
                await asyncio.wait_for(poll_triggered.wait(), timeout=3.0)

                await self.broadcaster.unsubscribe(queue)
                self.broadcaster.stop_polling()
```

**Step 2: Run tests to verify they fail**

Run: `pytest core/content/tests/test_validation_broadcaster.py::TestValidationBroadcasterPolling -v`
Expected: FAIL — `start_polling` / `_poll_loop` not implemented

**Step 3: Write minimal implementation**

Add to `ValidationBroadcaster` in `core/content/validation_broadcaster.py`:

```python
    def start_polling(self) -> None:
        """Start background polling if not already running."""
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.create_task(self._poll_loop())
            logger.info("Background polling started")

    def stop_polling(self) -> None:
        """Stop background polling."""
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            self._poll_task = None
            logger.info("Background polling stopped")

    async def _poll_loop(self) -> None:
        """Poll GitHub for new commits while subscribers are connected."""
        from core.content.github_fetcher import get_latest_commit_sha
        from core.content.webhook_handler import handle_content_update

        while self._subscribers:
            try:
                latest_sha = await get_latest_commit_sha()

                try:
                    cache = get_cache()
                    current_sha = cache.known_sha or cache.last_commit_sha
                except CacheNotInitializedError:
                    current_sha = None

                if latest_sha != current_sha:
                    logger.info(f"Poll detected new commit: {latest_sha[:8]}")

                    # Update known_sha immediately and broadcast
                    try:
                        cache = get_cache()
                        cache.known_sha = latest_sha
                        cache.known_sha_timestamp = datetime.now()
                        await self.broadcast(self._build_cache_snapshot())
                    except CacheNotInitializedError:
                        pass

                    # Trigger refresh
                    result = await handle_content_update(latest_sha)
                    await self.broadcast(self._build_cache_snapshot())

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Poll error: {e}")

            try:
                await asyncio.sleep(self._poll_interval)
            except asyncio.CancelledError:
                break

        logger.info("Poll loop exiting (no subscribers)")
```

Also add the `datetime` import and update `subscribe()`/`unsubscribe()` to auto-start/stop polling:

```python
    async def subscribe(self) -> asyncio.Queue:
        """Add a subscriber. Immediately sends current cache state."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        snapshot = self._build_cache_snapshot()
        queue.put_nowait(snapshot)
        # Start polling if this is the first subscriber
        if self.subscriber_count == 1:
            self.start_polling()
        logger.info(f"SSE client connected ({self.subscriber_count} total)")
        return queue

    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        """Remove a subscriber."""
        self._subscribers.discard(queue)
        # Stop polling if no subscribers left
        if self.subscriber_count == 0:
            self.stop_polling()
        logger.info(f"SSE client disconnected ({self.subscriber_count} total)")
```

**Step 4: Run tests to verify they pass**

Run: `pytest core/content/tests/test_validation_broadcaster.py -v`
Expected: ALL PASS

**Step 5: Commit**

```
feat: add background polling to ValidationBroadcaster
```

---

### Task 6: Hook webhook handler into broadcaster

**Files:**
- Modify: `core/content/webhook_handler.py:55-109`
- Test: `core/content/tests/test_webhook_handler.py`

When a webhook fires, we want to: (1) immediately update `known_sha` and broadcast "new commit detected", (2) after refresh completes, broadcast the full results. This two-phase broadcast lets the frontend show "fetching..." while the refresh is in progress.

**Step 1: Write the failing tests**

Add to `core/content/tests/test_webhook_handler.py`:

```python
from core.content.cache import ContentCache, set_cache, clear_cache


class TestWebhookBroadcasting:
    """Test that webhook handler broadcasts to SSE subscribers."""

    def setup_method(self):
        _reset_fetch_state()
        clear_cache()

    def teardown_method(self):
        _reset_fetch_state()
        clear_cache()

    @pytest.mark.asyncio
    async def test_handle_content_update_broadcasts_after_refresh(self):
        """Should call broadcaster.broadcast() after refresh completes."""
        commit_sha = "abc123def456789012345678901234567890abcd"

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            new_callable=AsyncMock,
            return_value=[],
        ):
            with patch(
                "core.content.webhook_handler.broadcaster"
            ) as mock_broadcaster:
                mock_broadcaster.broadcast = AsyncMock()
                mock_broadcaster.subscriber_count = 1
                mock_broadcaster._build_cache_snapshot.return_value = {"status": "ok"}

                result = await handle_content_update(commit_sha)

                assert result["status"] == "ok"
                # Should have broadcast at least twice:
                # 1. Immediately with known_sha update
                # 2. After refresh completes with full results
                assert mock_broadcaster.broadcast.call_count >= 2

    @pytest.mark.asyncio
    async def test_handle_content_update_updates_known_sha_immediately(self):
        """Should update known_sha in cache before starting refresh."""
        commit_sha = "abc123def456789012345678901234567890abcd"

        cache = ContentCache(
            courses={},
            flattened_modules={},
            articles={},
            video_transcripts={},
            parsed_learning_outcomes={},
            parsed_lenses={},
            last_refreshed=datetime.now(),
        )
        set_cache(cache)

        known_sha_during_refresh = None

        async def capture_known_sha(sha):
            nonlocal known_sha_during_refresh
            from core.content.cache import get_cache
            known_sha_during_refresh = get_cache().known_sha
            return []

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            side_effect=capture_known_sha,
        ):
            with patch(
                "core.content.webhook_handler.broadcaster"
            ) as mock_broadcaster:
                mock_broadcaster.broadcast = AsyncMock()
                mock_broadcaster.subscriber_count = 1
                mock_broadcaster._build_cache_snapshot.return_value = {"status": "ok"}

                await handle_content_update(commit_sha)

        # known_sha should have been set BEFORE incremental_refresh was called
        assert known_sha_during_refresh == commit_sha
```

**Step 2: Run test to verify it fails**

Run: `pytest core/content/tests/test_webhook_handler.py::TestWebhookBroadcasting -v`
Expected: FAIL — `broadcaster` not imported in webhook_handler

**Step 3: Write minimal implementation**

In `core/content/webhook_handler.py`, add the imports:

```python
from datetime import datetime

from .validation_broadcaster import broadcaster
from .cache import get_cache, CacheNotInitializedError
```

In `handle_content_update()`, add immediate `known_sha` broadcast before the refresh, and full results broadcast after:

```python
    # Phase 1: Immediately update known_sha and broadcast "new commit detected"
    if broadcaster.subscriber_count > 0:
        try:
            cache = get_cache()
            cache.known_sha = commit_sha
            cache.known_sha_timestamp = datetime.now()
        except CacheNotInitializedError:
            pass
        await broadcaster.broadcast(broadcaster._build_cache_snapshot())

    async with _fetch_lock:
        current_sha = commit_sha
        refreshes = 0
        validation_errors: list[dict] = []

        while True:
            _refetch_pending = False
            logger.info(f"Starting refresh for commit {current_sha[:8]}")
            validation_errors = await incremental_refresh(current_sha)
            refreshes += 1

            if not _refetch_pending:
                break

            current_sha = _pending_commit_sha or current_sha
            logger.info(f"Pending refresh detected, continuing with {current_sha[:8]}")

        # Build summary
        error_count = len([e for e in validation_errors if e.get("severity") == "error"])
        warning_count = len([e for e in validation_errors if e.get("severity") == "warning"])

        result = {
            "status": "ok",
            "message": f"Cache refreshed ({refreshes} refresh(es))",
            "commit_sha": current_sha,
            "summary": {
                "errors": error_count,
                "warnings": warning_count,
            },
            "issues": validation_errors,
        }

        # Phase 2: Broadcast full results after refresh
        if broadcaster.subscriber_count > 0:
            await broadcaster.broadcast(broadcaster._build_cache_snapshot())

        return result
```

**Step 4: Run tests to verify they pass**

Run: `pytest core/content/tests/test_webhook_handler.py -v`
Expected: ALL PASS

**Step 5: Commit**

```
feat: broadcast to SSE subscribers after webhook refresh
```

---

### Task 7: Add SSE endpoint to FastAPI

**Files:**
- Modify: `web_api/routes/content.py`
- Test: Manual testing (SSE endpoints are hard to unit test with FastAPI TestClient; the broadcaster is already tested)

**Step 1: Write the failing test**

Add to `web_api/tests/` or test manually. A minimal integration test:

Create `web_api/tests/test_content_sse.py`:

```python
"""Tests for SSE validation stream endpoint."""

import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

from main import app


class TestValidationStreamEndpoint:
    """Test the SSE endpoint exists and responds correctly."""

    @pytest.mark.asyncio
    async def test_validation_stream_returns_event_stream(self):
        """GET /api/content/validation-stream should return text/event-stream."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            async with client.stream("GET", "/api/content/validation-stream") as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers["content-type"]
                # Read first chunk (should be initial cache state)
                first_chunk = b""
                async for chunk in response.aiter_bytes():
                    first_chunk += chunk
                    if b"\n\n" in first_chunk:
                        break
                assert b"event: validation" in first_chunk

    @pytest.mark.asyncio
    async def test_refresh_validation_returns_ok(self):
        """POST /api/content/refresh-validation should return status ok."""
        with patch(
            "web_api.routes.content.handle_content_update",
            new_callable=AsyncMock,
            return_value={"status": "ok"},
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/content/refresh-validation")
                assert response.status_code == 200
```

**Step 2: Run test to verify it fails**

Run: `pytest web_api/tests/test_content_sse.py -v`
Expected: FAIL — 404 (endpoint doesn't exist)

**Step 3: Write minimal implementation**

Add to `web_api/routes/content.py`:

```python
import asyncio
import json
from starlette.responses import StreamingResponse

from core.content.validation_broadcaster import broadcaster
```

Add the SSE endpoint:

```python
@router.get("/validation-stream")
async def validation_stream(request: Request):
    """
    SSE endpoint for live validation updates.

    Returns a text/event-stream that:
    1. Immediately sends current cached validation state
    2. Pushes new events whenever validation results change
    3. Stays open until the client disconnects
    """
    queue = await broadcaster.subscribe()

    async def event_generator():
        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                try:
                    # Wait for next message with timeout (for disconnect checking)
                    msg = await asyncio.wait_for(queue.get(), timeout=30.0)
                    data = json.dumps(msg, default=str)
                    yield f"event: validation\ndata: {data}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        finally:
            await broadcaster.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
```

Add the manual refresh endpoint:

```python
@router.post("/refresh-validation")
async def refresh_validation():
    """
    Manual refresh fallback. Triggers incremental refresh.

    The SSE stream will push updated results to connected clients.
    """
    from core.content.github_fetcher import get_latest_commit_sha

    try:
        commit_sha = await get_latest_commit_sha()
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch latest commit: {e}",
        )

    # Fire in background — SSE will push results when done
    async def _refresh_with_error_handling():
        try:
            await handle_content_update(commit_sha)
        except Exception as e:
            logger.error(f"Background refresh failed: {e}")

    asyncio.create_task(_refresh_with_error_handling())

    return {"status": "ok", "message": "Refresh triggered"}
```

**Step 4: Run tests to verify they pass**

Run: `pytest web_api/tests/test_content_sse.py -v`
Expected: PASS

Then: `pytest web_api/tests/ -v`
Expected: ALL PASS

**Step 5: Commit**

```
feat: add SSE validation-stream and refresh-validation endpoints
```

---

### Task 8: Update frontend ContentValidator to use EventSource

**Files:**
- Modify: `web_frontend/src/views/ContentValidator.tsx`

**Step 1: Implement the new component**

Replace the contents of `web_frontend/src/views/ContentValidator.tsx` with the SSE-powered version. Since this is a frontend component where TDD is impractical for SSE behavior, we implement and test manually.

```typescript
import { useState, useEffect } from "react";
import { API_URL } from "../config";

interface ValidationIssue {
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
  severity: "error" | "warning";
}

interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface ValidationState {
  status: string;
  known_sha?: string;
  known_sha_timestamp?: string;
  fetched_sha?: string;
  fetched_sha_timestamp?: string;
  processed_sha?: string;
  processed_sha_timestamp?: string;
  summary?: { errors: number; warnings: number };
  issues?: ValidationIssue[];
  diff?: DiffFile[];
}

type ConnectionStatus = "connecting" | "connected" | "reconnecting";

export default function ContentValidator() {
  const [state, setState] = useState<ValidationState | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const source = new EventSource(
      `${API_URL}/api/content/validation-stream`
    );

    source.addEventListener("validation", (event) => {
      const data: ValidationState = JSON.parse(event.data);
      setState(data);
      setConnectionStatus("connected");
    });

    source.onopen = () => setConnectionStatus("connected");
    source.onerror = () => setConnectionStatus("reconnecting");

    return () => source.close();
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch(`${API_URL}/api/content/refresh-validation`, {
        method: "POST",
      });
    } catch {
      // SSE will push the update
    } finally {
      // Keep spinner briefly so it's visible
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  };

  const issues = state?.issues || [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="py-8 max-w-4xl mx-auto px-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Content Validator</h1>
        <div className="flex items-center gap-3">
          <ConnectionIndicator status={connectionStatus} />
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50
                       text-gray-700 px-3 py-1.5 rounded-md"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <p className="text-gray-600 mb-6">
        Live validation status. Updates automatically when content changes.
      </p>

      {/* Pipeline status */}
      {state && state.status !== "no_cache" && (
        <PipelineStatus state={state} />
      )}

      {state?.status === "no_cache" && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 mb-6">
          Cache not initialized. Click Refresh to load content.
        </div>
      )}

      {/* Diff section */}
      {state?.diff && state.diff.length > 0 && (
        <DiffSummary diff={state.diff} />
      )}

      {/* Results */}
      {state && state.status !== "no_cache" && (
        <div className="space-y-6">
          {/* Summary badges */}
          <div className="flex items-center gap-4">
            <div
              className={`px-4 py-2 rounded-lg font-medium ${
                (state.summary?.errors ?? errors.length) > 0
                  ? "bg-red-100 text-red-800"
                  : "bg-green-100 text-green-800"
              }`}
            >
              {state.summary?.errors ?? errors.length}{" "}
              {(state.summary?.errors ?? errors.length) === 1
                ? "error"
                : "errors"}
            </div>
            <div
              className={`px-4 py-2 rounded-lg font-medium ${
                (state.summary?.warnings ?? warnings.length) > 0
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {state.summary?.warnings ?? warnings.length}{" "}
              {(state.summary?.warnings ?? warnings.length) === 1
                ? "warning"
                : "warnings"}
            </div>
          </div>

          {/* Success message */}
          {(state.summary?.errors ?? 0) === 0 &&
            (state.summary?.warnings ?? 0) === 0 && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
                All content is valid. No issues found.
              </div>
            )}

          {/* Errors */}
          {errors.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-red-700 mb-3">
                Errors
              </h2>
              <div className="space-y-3">
                {errors.map((issue, idx) => (
                  <IssueCard key={`error-${idx}`} issue={issue} />
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-yellow-700 mb-3">
                Warnings
              </h2>
              <div className="space-y-3">
                {warnings.map((issue, idx) => (
                  <IssueCard key={`warning-${idx}`} issue={issue} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const colors = {
    connecting: "bg-yellow-400",
    connected: "bg-green-400",
    reconnecting: "bg-yellow-400 animate-pulse",
  };
  const labels = {
    connecting: "Connecting...",
    connected: "Live",
    reconnecting: "Reconnecting...",
  };

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
      {labels[status]}
    </div>
  );
}

function PipelineStatus({ state }: { state: ValidationState }) {
  const isProcessing =
    state.known_sha &&
    state.processed_sha &&
    state.known_sha !== state.processed_sha;

  const sha = state.processed_sha || state.known_sha;
  const timestamp = state.processed_sha_timestamp || state.known_sha_timestamp;

  return (
    <div className="mb-6 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
      {isProcessing ? (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>
            New commit{" "}
            <code className="text-xs bg-gray-200 px-1 rounded">
              {state.known_sha?.slice(0, 8)}
            </code>{" "}
            detected.{" "}
            {state.fetched_sha === state.known_sha
              ? "Processing..."
              : "Fetching..."}
          </span>
        </div>
      ) : (
        <span>
          Validated:{" "}
          <code className="text-xs bg-gray-200 px-1 rounded">
            {sha?.slice(0, 8)}
          </code>
          {timestamp && <> &middot; {formatRelativeTime(timestamp)}</>}
        </span>
      )}
    </div>
  );
}

function DiffSummary({ diff }: { diff: DiffFile[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-500 mb-2 uppercase tracking-wide">
        Latest Changes
      </h2>
      <div className="space-y-1">
        {diff.map((file) => (
          <div key={file.filename}>
            <button
              onClick={() =>
                setExpanded(
                  expanded === file.filename ? null : file.filename
                )
              }
              className="w-full text-left flex items-center gap-2 p-2 rounded
                         hover:bg-gray-50 text-sm font-mono"
            >
              <StatusBadge status={file.status} />
              <span className="flex-1 truncate">{file.filename}</span>
              <span className="text-green-600 text-xs">+{file.additions}</span>
              <span className="text-red-600 text-xs">-{file.deletions}</span>
              <span className="text-gray-400 text-xs">
                {expanded === file.filename ? "▼" : "▶"}
              </span>
            </button>
            {expanded === file.filename && file.patch && (
              <pre className="mx-2 p-3 bg-gray-900 text-gray-100 rounded text-xs overflow-x-auto">
                {file.patch.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith("+")
                        ? "text-green-400"
                        : line.startsWith("-")
                          ? "text-red-400"
                          : line.startsWith("@@")
                            ? "text-blue-400"
                            : ""
                    }
                  >
                    {line}
                  </div>
                ))}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    added: { label: "A", color: "bg-green-100 text-green-700" },
    modified: { label: "M", color: "bg-blue-100 text-blue-700" },
    removed: { label: "D", color: "bg-red-100 text-red-700" },
    renamed: { label: "R", color: "bg-purple-100 text-purple-700" },
  };
  const c = config[status] || { label: "?", color: "bg-gray-100 text-gray-700" };

  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${c.color}`}
    >
      {c.label}
    </span>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function IssueCard({ issue }: { issue: ValidationIssue }) {
  const isError = issue.severity === "error";

  return (
    <div
      className={`p-4 rounded-lg border ${
        isError
          ? "bg-red-50 border-red-200"
          : "bg-yellow-50 border-yellow-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm text-gray-600 mb-1">
            {issue.file}
            {issue.line && `:${issue.line}`}
          </div>
          <div
            className={`font-medium ${isError ? "text-red-800" : "text-yellow-800"}`}
          >
            {issue.message}
          </div>
          {issue.suggestion && (
            <div className="mt-1 text-sm text-gray-600">
              {issue.suggestion}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Build and verify**

Run: `cd web_frontend && npm run build`
Expected: BUILD SUCCESS (no TypeScript errors)

Run: `cd web_frontend && npm run lint`
Expected: No lint errors

**Step 3: Manual test**

1. Start the dev server: `python main.py --dev`
2. Start the frontend: `cd web_frontend && npm run dev`
3. Open `http://localhost:3001/validate`
4. Verify: page shows "Connecting..." then "Live" indicator
5. Verify: current cache state appears immediately
6. Verify: clicking "Refresh" triggers a refresh and results update via SSE

**Step 4: Commit**

```
feat: replace click-to-validate with live SSE-powered dashboard
```

---

### Task 9: Update references to last_commit_sha

**Files:**
- Modify: `web_api/routes/content.py:145-162` (set-commit-sha endpoint)
- Modify: `web_api/routes/content.py:165-198` (cache-status endpoint)

These endpoints reference `cache.last_commit_sha`. Update them to use the new fields while keeping `last_commit_sha` working as a backward-compat alias.

**Step 1: Update cache-status endpoint**

In `web_api/routes/content.py`, update the `cache_status()` function to return the three SHAs:

```python
@router.get("/cache-status")
async def cache_status():
    """Get current cache status for debugging."""
    try:
        branch = get_content_branch()
    except Exception as e:
        branch = f"ERROR: {e}"

    try:
        cache = get_cache()
        return {
            "status": "ok",
            "watching_branch": branch,
            "known_sha": cache.known_sha,
            "known_sha_timestamp": cache.known_sha_timestamp.isoformat() if cache.known_sha_timestamp else None,
            "fetched_sha": cache.fetched_sha,
            "fetched_sha_timestamp": cache.fetched_sha_timestamp.isoformat() if cache.fetched_sha_timestamp else None,
            "processed_sha": cache.processed_sha,
            "processed_sha_timestamp": cache.processed_sha_timestamp.isoformat() if cache.processed_sha_timestamp else None,
            "last_commit_sha": cache.last_commit_sha,
            "last_refreshed": cache.last_refreshed.isoformat()
            if cache.last_refreshed
            else None,
            "counts": {
                "courses": len(cache.courses),
                "modules": len(cache.flattened_modules),
                "articles": len(cache.articles),
                "video_transcripts": len(cache.video_transcripts),
            },
        }
    except CacheNotInitializedError:
        return {
            "status": "not_initialized",
            "watching_branch": branch,
            "message": "Cache not yet initialized",
        }
```

**Step 2: Update set-commit-sha endpoint**

Update to set all three SHAs for testing purposes:

```python
@router.post("/set-commit-sha")
async def set_commit_sha(commit_sha: str):
    """Set the cache's commit SHA (dev only, for testing incremental refresh)."""
    try:
        cache = get_cache()
        old_sha = cache.last_commit_sha
        cache.last_commit_sha = commit_sha
        cache.known_sha = commit_sha
        cache.fetched_sha = commit_sha
        cache.processed_sha = commit_sha
        return {
            "status": "ok",
            "old_commit_sha": old_sha,
            "new_commit_sha": commit_sha,
        }
    except CacheNotInitializedError:
        raise HTTPException(status_code=400, detail="Cache not initialized")
```

**Step 3: Verify**

Run: `pytest web_api/tests/ -v`
Expected: ALL PASS

Run: `ruff check web_api/`
Expected: No errors

**Step 4: Commit**

```
refactor: update cache-status and set-commit-sha for three-stage SHAs
```

---

### Task 10: End-to-end verification

**Files:** None (verification only)

**Step 1: Run all Python tests**

```bash
pytest
```

Expected: ALL PASS

**Step 2: Run Python linting**

```bash
ruff check .
ruff format --check .
```

Expected: Clean

**Step 3: Run frontend build**

```bash
cd web_frontend && npm run build
```

Expected: BUILD SUCCESS

**Step 4: Run frontend lint**

```bash
cd web_frontend && npm run lint
```

Expected: Clean

**Step 5: Manual integration test**

1. Start backend: `python main.py --dev`
2. Start frontend: `cd web_frontend && npm run dev`
3. Open `/validate` — should see live connection indicator and current state
4. Trigger a content change (or call `POST /api/content/refresh-validation`)
5. Verify the page updates without manual interaction
6. Verify the diff section shows changed files
7. Verify the pipeline status shows progress (known → fetched → processed)

**Step 6: Commit any final fixes, then done**
