# Incremental Webhook Content Refresh Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Date:** 2026-01-19
**Status:** Draft

## Overview

Replace the current full-refetch webhook behavior with incremental updates using GitHub's Compare API. This enables fast content refreshes suitable for real-time editing workflows where Obsidian syncs to GitHub every ~10 seconds.

## Goals

- **Incremental updates:** Only fetch files that changed between commits
- **Fetch locking:** Prevent concurrent fetches while ensuring new webhooks trigger immediate re-fetch
- **Webhook verification:** Validate webhook signatures for security
- **Fast feedback:** Editors see changes on staging within seconds of saving

## Architecture

```
┌─────────────────┐                    ┌──────────────────────────────────┐
│  GitHub Repo    │    POST webhook    │  FastAPI Server                  │
│  (push event)   │ ──────────────────►│                                  │
└─────────────────┘   includes:        │  ┌────────────────────────────┐  │
                      - commit SHA     │  │  Webhook Handler           │  │
                      - signature      │  │  - verify signature        │  │
                                       │  │  - acquire fetch lock      │  │
                                       │  │  - set refetch_pending     │  │
                                       │  └────────────┬───────────────┘  │
                                       │               │                  │
                                       │               ▼                  │
                                       │  ┌────────────────────────────┐  │
                                       │  │  Incremental Fetcher       │  │
                                       │  │  - compare last_sha...new  │  │
                                       │  │  - fetch only changed files│  │
                                       │  │  - update cache in-place   │  │
                                       │  └────────────────────────────┘  │
                                       │               │                  │
                                       │               ▼                  │
                                       │  ┌────────────────────────────┐  │
                                       │  │  ContentCache              │  │
                                       │  │  + last_commit_sha: str    │  │
                                       │  └────────────────────────────┘  │
                                       └──────────────────────────────────┘
```

## GitHub Compare API

**Endpoint:** `GET /repos/{owner}/{repo}/compare/{base}...{head}`

**Response includes:**
```json
{
  "files": [
    {
      "filename": "modules/intro.md",
      "status": "modified"  // added | modified | removed | renamed
    }
  ],
  "status": "ahead",  // ahead | behind | diverged | identical
  "total_commits": 3
}
```

**Limits:**
- Max 250 commits in comparison
- Max 300 files in response
- If exceeded, fall back to full refresh

## Cache Changes

### `core/content/cache.py`

Add `last_commit_sha` field to track which commit the cache reflects:

```python
@dataclass
class ContentCache:
    courses: dict[str, ParsedCourse]
    modules: dict[str, ParsedModule]
    articles: dict[str, str]
    video_transcripts: dict[str, str]
    last_refreshed: datetime
    last_commit_sha: str | None  # NEW: Git commit SHA of current cache state
```

## Fetcher Changes

### `core/content/github_fetcher.py`

**New functions:**

```python
async def get_latest_commit_sha() -> str:
    """Get the SHA of the latest commit on the content branch.

    Uses: GET /repos/{owner}/{repo}/commits/{branch}
    Returns just the SHA, not full commit data.
    """

async def compare_commits(base_sha: str, head_sha: str) -> CommitComparison:
    """Compare two commits and return changed files.

    Uses: GET /repos/{owner}/{repo}/compare/{base}...{head}

    Returns:
        CommitComparison with:
        - files: list of ChangedFile (path, status)
        - is_truncated: True if >300 files (need full refresh)
    """

async def incremental_refresh(new_commit_sha: str) -> None:
    """Refresh cache incrementally based on changed files.

    1. Get current cache's last_commit_sha
    2. If None, do full refresh (first run)
    3. Compare commits to get changed files
    4. If truncated, do full refresh
    5. For each changed file:
       - added/modified: fetch and update cache
       - removed: delete from cache
       - renamed: delete old path, fetch new path
    6. Update last_commit_sha
    """
```

**New dataclasses:**

```python
@dataclass
class ChangedFile:
    path: str
    status: Literal["added", "modified", "removed", "renamed"]
    previous_path: str | None = None  # For renamed files

@dataclass
class CommitComparison:
    files: list[ChangedFile]
    is_truncated: bool  # True if GitHub's 300 file limit exceeded
```

**Modified functions:**

```python
async def fetch_all_content() -> ContentCache:
    """Fetch all content and include the current commit SHA."""
    # ... existing code ...
    commit_sha = await get_latest_commit_sha()
    return ContentCache(
        # ... existing fields ...
        last_commit_sha=commit_sha,
    )
```

## Fetch Locking

### `core/content/webhook_handler.py` (new file)

```python
import asyncio
from typing import Optional

_fetch_lock = asyncio.Lock()
_refetch_pending = False
_pending_commit_sha: Optional[str] = None

async def handle_content_update(commit_sha: str) -> dict:
    """Handle a content update request with fetch locking.

    If a fetch is in progress:
        - Sets refetch_pending flag
        - Returns immediately (current fetch will handle it)

    If no fetch in progress:
        - Acquires lock
        - Performs incremental refresh
        - Loops while refetch_pending is set

    Returns:
        Status dict with refresh details
    """
    global _refetch_pending, _pending_commit_sha

    if _fetch_lock.locked():
        _refetch_pending = True
        _pending_commit_sha = commit_sha
        return {"status": "queued", "message": "Refresh already in progress, queued"}

    async with _fetch_lock:
        current_sha = commit_sha
        refreshes = 0

        while True:
            _refetch_pending = False
            await incremental_refresh(current_sha)
            refreshes += 1

            if not _refetch_pending:
                break

            # Another webhook came in, use its SHA
            current_sha = _pending_commit_sha or current_sha

        return {
            "status": "ok",
            "message": f"Cache refreshed ({refreshes} refresh(es))",
            "commit_sha": current_sha,
        }
```

## Webhook Signature Verification

### `core/content/webhook_handler.py`

```python
import hmac
import hashlib
import os

class WebhookSignatureError(Exception):
    """Raised when webhook signature verification fails."""
    pass

def verify_webhook_signature(payload: bytes, signature_header: str) -> None:
    """Verify GitHub webhook signature.

    Args:
        payload: Raw request body bytes
        signature_header: Value of X-Hub-Signature-256 header

    Raises:
        WebhookSignatureError: If signature is invalid or secret not configured
    """
    secret = os.getenv("GITHUB_WEBHOOK_SECRET")
    if not secret:
        raise WebhookSignatureError("GITHUB_WEBHOOK_SECRET not configured")

    if not signature_header or not signature_header.startswith("sha256="):
        raise WebhookSignatureError("Invalid signature header format")

    expected_sig = signature_header[7:]  # Remove "sha256=" prefix

    computed_sig = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, computed_sig):
        raise WebhookSignatureError("Signature verification failed")
```

## Route Changes

### `web_api/routes/content.py`

```python
from fastapi import APIRouter, Request, HTTPException, Header
from core.content.webhook_handler import (
    handle_content_update,
    verify_webhook_signature,
    WebhookSignatureError,
)

@router.post("/webhook")
async def github_webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(None),
    x_github_event: str | None = Header(None),
):
    """Handle GitHub push webhook to refresh content cache."""

    # Verify signature
    body = await request.body()
    try:
        verify_webhook_signature(body, x_hub_signature_256)
    except WebhookSignatureError as e:
        logger.warning(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=401, detail=str(e))

    # Only handle push events
    if x_github_event != "push":
        return {"status": "ignored", "message": f"Event type '{x_github_event}' ignored"}

    # Parse payload for commit SHA
    payload = await request.json()
    commit_sha = payload.get("after")  # SHA of the head commit after push

    if not commit_sha:
        raise HTTPException(status_code=400, detail="Missing 'after' commit SHA in payload")

    # Check branch matches configured branch
    ref = payload.get("ref", "")  # e.g., "refs/heads/staging"
    expected_branch = get_content_branch()
    if not ref.endswith(f"/{expected_branch}"):
        return {
            "status": "ignored",
            "message": f"Push to '{ref}' ignored (watching '{expected_branch}')",
        }

    # Handle the update with fetch locking
    result = await handle_content_update(commit_sha)
    logger.info(f"Webhook processed: {result}")
    return result
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Recommended | PAT for API access (increases rate limit from 60 to 5000/hr) |
| `EDUCATIONAL_CONTENT_BRANCH` | Yes | Branch to watch (`staging` or `main`) |
| `GITHUB_WEBHOOK_SECRET` | Yes (production) | Secret for webhook signature verification |

## Edge Cases

### First run (no last_commit_sha)
Full fetch. This happens on server startup or if cache was cleared.

### Force push / history rewrite
Compare API may fail or return unexpected results. Detect and fall back to full refresh.

### File outside tracked directories
If webhook reports a changed file not in `modules/`, `courses/`, `articles/`, or `video_transcripts/`, ignore it (e.g., README changes).

### Deleted directory
If a directory is deleted entirely, remove all cached items with that path prefix.

### Parse error on modified file
Log error, skip file, continue with other updates. Don't fail entire refresh.

## Fallback Strategy

Always fall back to full refresh when:
1. `last_commit_sha` is None (first run / cache cleared)
2. Compare API returns truncated results (>300 files)
3. Compare API fails (network error, force push, etc.)
4. Any unexpected error during incremental update

```python
async def incremental_refresh(new_commit_sha: str) -> None:
    cache = get_cache()

    # Fallback: no previous SHA
    if not cache.last_commit_sha:
        await full_refresh()
        return

    try:
        comparison = await compare_commits(cache.last_commit_sha, new_commit_sha)

        # Fallback: too many changes
        if comparison.is_truncated:
            await full_refresh()
            return

        # Apply incremental changes
        await apply_changes(comparison.files)
        cache.last_commit_sha = new_commit_sha
        cache.last_refreshed = datetime.now()

    except Exception as e:
        logger.warning(f"Incremental refresh failed, falling back to full: {e}")
        await full_refresh()
```

## File Changes Summary

### New Files
- `core/content/webhook_handler.py` - Fetch locking, signature verification, update coordination

### Modified Files
- `core/content/cache.py` - Add `last_commit_sha` field to `ContentCache`
- `core/content/github_fetcher.py` - Add compare API, incremental refresh, new dataclasses
- `web_api/routes/content.py` - Add signature verification, branch filtering, commit SHA parsing

## Testing Strategy

### Unit Tests
1. `test_verify_webhook_signature` - Valid/invalid signatures, missing secret
2. `test_compare_commits` - Normal comparison, truncated results, API errors
3. `test_incremental_refresh` - Added/modified/removed/renamed files, fallback to full
4. `test_fetch_locking` - Concurrent webhooks queued correctly

### Integration Tests
1. Mock GitHub API responses for compare endpoint
2. Verify cache updates correctly for each change type
3. Verify fallback triggers appropriately

### Manual Testing
1. Set up webhook on test repo
2. Make edits in Obsidian, verify staging updates within seconds
3. Force push, verify graceful fallback to full refresh

## GitHub Webhook Setup

1. Go to educational content repo → Settings → Webhooks → Add webhook
2. **Payload URL:** `https://<server>/api/content/webhook`
3. **Content type:** `application/json`
4. **Secret:** Generate secure random string, add to server as `GITHUB_WEBHOOK_SECRET`
5. **Events:** Select "Just the push event"
6. **Active:** Check the box

For staging: Point to staging server URL, configure to watch `staging` branch.
For production: Point to production server URL, configure to watch `main` branch.

## Implementation Order

1. Add `last_commit_sha` to cache, update `fetch_all_content` to populate it
2. Implement `get_latest_commit_sha()`
3. Implement `compare_commits()` with dataclasses
4. Implement `incremental_refresh()` with fallback logic
5. Implement webhook signature verification
6. Implement fetch locking in `handle_content_update()`
7. Update webhook route with signature verification and branch filtering
8. Add tests
9. Deploy to staging, set up webhook
10. Test real-time editing workflow
11. Deploy to production
