# Live Validation Dashboard - Design

**Date**: 2026-02-06

## Problem

Content creators edit in Obsidian, which syncs to GitHub via Relay (~10s delay). Currently, they must manually click "Validate Now" on `/validate` and wait for a full refresh cycle. The page also has bugs with stale results not updating properly.

We want the `/validate` page to show live validation results that update automatically as content changes flow through.

## Design

### Overview

Replace the click-to-validate flow with a live-updating dashboard powered by Server-Sent Events (SSE). When a user opens `/validate`, they immediately see the current cached validation state and receive live updates as new content arrives.

```
Obsidian → Relay (~10s) → GitHub → webhook → server refresh → SSE push → frontend updates
                                                    ↑
                                   polling fallback (dev servers)
```

### Cache Changes

**`core/content/cache.py` - ContentCache dataclass**

Replace the single `last_commit_sha` with three SHA tracking fields, each with a timestamp:

```python
# Replaces: last_commit_sha, last_refreshed

# 1. Latest commit we've heard about (from webhook or polling GitHub API)
known_sha: str | None = None
known_sha_timestamp: datetime | None = None  # commit's author timestamp

# 2. Raw files in cache are from this commit
fetched_sha: str | None = None
fetched_sha_timestamp: datetime | None = None

# 3. Validation results (parsed/processed) are from this commit
processed_sha: str | None = None
processed_sha_timestamp: datetime | None = None
```

This lets the frontend show progress: "New commit detected → fetching → processing → done."

The timestamps are the **commit's author timestamps** from GitHub (when the content was actually pushed), so content creators see "content from 2 minutes ago."

### Cache: Diff Storage

Store the latest diff summary from GitHub's Compare API:

```python
# Diff from last refresh (from GitHub Compare API)
last_diff: list[dict] | None = None
# Each entry: {"filename": str, "status": str, "additions": int, "deletions": int, "patch": str}
```

`incremental_refresh()` already calls the Compare API - we just need to keep the result instead of discarding it.

### Backend: SSE Endpoint

**New endpoint:** `GET /api/content/validation-stream`

Returns an SSE stream (`text/event-stream`). Events:

```
event: validation
data: {
  "known_sha": "abc1234", "known_sha_timestamp": "2026-02-06T14:32:00Z",
  "fetched_sha": "abc1234", "fetched_sha_timestamp": "2026-02-06T14:32:00Z",
  "processed_sha": "abc1234", "processed_sha_timestamp": "2026-02-06T14:32:00Z",
  "summary": {"errors": 3, "warnings": 1},
  "issues": [...],
  "diff": [{"filename": "Lenses/10 reasons.md", "status": "modified", "additions": 3, "deletions": 2, "patch": "..."}]
}
```

Behavior:
1. On connection: immediately send current cached state (or `{"status": "no_cache"}` if cache not initialized)
2. Keep connection open
3. Whenever state changes (new commit known, files fetched, processing complete), send a new event
4. On client disconnect: clean up

**New endpoint:** `POST /api/content/refresh-validation`

Manual refresh fallback. Triggers an incremental refresh. Returns `{"status": "ok"}`. The SSE stream pushes the actual results to connected clients.

### Backend: Connection Manager

**New file:** `core/content/validation_broadcaster.py`

Manages SSE clients and the background poller:

```python
class ValidationBroadcaster:
    """Manages SSE connections and background polling for live validation updates."""

    _subscribers: set[asyncio.Queue]
    _poll_task: asyncio.Task | None
    _poll_interval: int  # seconds, e.g. 30

    async def subscribe() -> asyncio.Queue
        # Add a queue, start poller if first subscriber
        # Immediately put current cache state into the queue

    async def unsubscribe(queue: asyncio.Queue)
        # Remove queue, stop poller if no subscribers left

    async def broadcast(result: dict)
        # Push result to all subscriber queues

    async def _poll_loop()
        # While subscribers exist:
        #   Fetch latest commit SHA from GitHub API
        #   If different from cache.known_sha:
        #     Update known_sha + timestamp, broadcast (frontend shows "new commit detected")
        #     Trigger incremental_refresh()
        #     Broadcast again with full results
        #   Sleep poll_interval
```

Singleton instance. Both the webhook handler and the poller call `broadcast()` after state changes.

### Backend: Integration Points

**`core/content/webhook_handler.py`**
- On webhook receipt: update `known_sha` + timestamp, broadcast immediately ("new commit detected")
- After `handle_content_update()` completes refresh: broadcast full results

**`core/content/github_fetcher.py`**
- In `incremental_refresh()`:
  - After fetching files: update `fetched_sha` + timestamp
  - After processing: update `processed_sha` + timestamp
  - Store diff summary from Compare API in `cache.last_diff`
  - Extract commit timestamps from GitHub API responses

**`web_api/routes/content.py`**
- Add SSE endpoint + manual refresh endpoint
- SSE endpoint uses FastAPI's `StreamingResponse` with `media_type="text/event-stream"`

### Frontend: EventSource

**`web_frontend/src/views/ContentValidator.tsx`**

Replace the current fetch-on-click with:

```typescript
useEffect(() => {
  const source = new EventSource(`${API_URL}/api/content/validation-stream`);

  source.addEventListener("validation", (event) => {
    const data = JSON.parse(event.data);
    setResult(data);
  });

  source.onerror = () => {
    // EventSource auto-reconnects; optionally show "reconnecting..." status
  };

  return () => source.close(); // cleanup on unmount
}, []);
```

**UI shows:**
- **Pipeline status:** Shows progress through known → fetched → processed SHAs
  - "New commit `abc1234` detected (30s ago)... fetching..."
  - "Fetched. Processing..."
  - "Validated `abc1234` (30s ago) — 3 errors, 1 warning"
- **Diff summary:** Which files changed, with +/- counts. Expandable to show full patch (unified diff with green/red lines)
- **Connection indicator:** Connected / reconnecting
- **Manual refresh button:** Fallback, calls `POST /refresh-validation`
- **Issues list:** Grouped by severity (errors first, then warnings). Each shows file, line, message, suggestion

### Polling Details

- **Poll interval:** 30 seconds (configurable)
- **Polling only runs when SSE clients are connected** - no wasted GitHub API calls
- **Polling checks:** Fetch latest commit SHA from GitHub API, compare with `cache.known_sha`. If different, trigger refresh
- **Webhook is faster:** When available (prod/staging), the webhook fires immediately on push. Polling is the fallback for dev servers where webhooks can't reach localhost

### What Stays the Same

- The existing webhook endpoint (`POST /api/content/webhook`) - still receives GitHub pushes
- `incremental_refresh()` logic - still does SHA comparison, fetches only changed files, runs TypeScript processor
- `handle_content_update()` locking - still prevents concurrent refreshes
- TypeScript content processor - no changes

### Authentication

The SSE endpoint does not require authentication. The validation data is not sensitive (file paths and error messages from a public content repo), and SSE + auth adds complexity (EventSource doesn't support custom headers natively).

If auth is needed later, we can use cookie-based auth which EventSource supports.

## Summary of Changes

| Layer | File | Change |
|-------|------|--------|
| Cache | `core/content/cache.py` | Replace single SHA with three SHA+timestamp pairs; add `last_diff` |
| Broadcaster | `core/content/validation_broadcaster.py` | **New file** - SSE client management + background polling |
| Webhook | `core/content/webhook_handler.py` | Update `known_sha` on receipt; broadcast after refresh |
| Fetcher | `core/content/github_fetcher.py` | Update three SHAs at appropriate stages; store diff from Compare API |
| API | `web_api/routes/content.py` | Add SSE endpoint + manual refresh endpoint |
| Frontend | `web_frontend/src/views/ContentValidator.tsx` | EventSource, live updates, pipeline status, diff display |
