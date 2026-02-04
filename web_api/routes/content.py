"""
Content management API routes.

Endpoints:
- POST /api/content/webhook - Handle GitHub push webhook to refresh cache
- POST /api/content/refresh - Manual refresh for development
"""

import logging
import sys
from pathlib import Path

from fastapi import APIRouter, Request, HTTPException, Header

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.content import refresh_cache, get_cache, CacheNotInitializedError
from core.content.github_fetcher import get_content_branch
from core.content.webhook_handler import (
    handle_content_update,
    verify_webhook_signature,
    WebhookSignatureError,
)

router = APIRouter(prefix="/api/content", tags=["content"])

logger = logging.getLogger(__name__)


@router.post("/webhook")
async def github_webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(None),
    x_github_event: str | None = Header(None),
):
    """
    Handle GitHub push webhook to refresh content cache.

    Called by GitHub when content repo is pushed to.
    Verifies signature, checks branch, then triggers incremental refresh.
    """
    # Verify signature
    body = await request.body()
    try:
        verify_webhook_signature(body, x_hub_signature_256)
    except WebhookSignatureError as e:
        logger.warning(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=401, detail=str(e))

    # Only handle push events
    if x_github_event != "push":
        return {
            "status": "ignored",
            "message": f"Event type '{x_github_event}' ignored",
        }

    # Parse payload for commit SHA and branch
    payload = await request.json()
    commit_sha = payload.get("after")  # SHA of the head commit after push

    if not commit_sha:
        raise HTTPException(
            status_code=400, detail="Missing 'after' commit SHA in payload"
        )

    # Check branch matches configured branch
    ref = payload.get("ref", "")  # e.g., "refs/heads/staging"
    expected_branch = get_content_branch()
    if not ref.endswith(f"/{expected_branch}"):
        print(f"Webhook ignored: push to '{ref}' (watching '{expected_branch}')")
        return {
            "status": "ignored",
            "message": f"Push to '{ref}' ignored (watching '{expected_branch}')",
        }

    print(f"Webhook processing: push to '{ref}' with commit {commit_sha[:8]}")

    # Handle the update with fetch locking
    try:
        result = await handle_content_update(commit_sha)
        logger.info(f"Webhook processed: {result}")
        return result
    except Exception as e:
        logger.error(f"Cache refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")


@router.post("/refresh")
async def manual_refresh():
    """
    Manually refresh the content cache (full refresh).

    For local development when webhooks aren't available.
    TODO: Add admin authentication
    """
    logger.info("Manual cache refresh requested...")

    try:
        await refresh_cache()
        logger.info("Content cache refreshed successfully via manual request")
        return {"status": "ok", "message": "Cache refreshed (full)"}
    except Exception as e:
        logger.error(f"Cache refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")


@router.post("/refresh-incremental")
async def manual_incremental_refresh(commit_sha: str | None = None):
    """
    Manually trigger an incremental refresh (dev only).

    Simulates a GitHub webhook without signature verification.
    If commit_sha is not provided, fetches the latest from GitHub.

    TODO: Add admin authentication or disable in production
    """
    import httpx

    from core.content.github_fetcher import CONTENT_REPO, get_content_branch

    # If no commit SHA provided, fetch the latest from GitHub
    if not commit_sha:
        branch = get_content_branch()
        url = f"https://api.github.com/repos/{CONTENT_REPO}/commits/{branch}"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to fetch latest commit: {resp.status_code}",
                )
            commit_sha = resp.json()["sha"]

    logger.info(f"Manual incremental refresh requested for commit {commit_sha[:8]}...")

    try:
        result = await handle_content_update(commit_sha)
        logger.info(f"Incremental refresh completed: {result}")
        return result
    except Exception as e:
        logger.error(f"Incremental refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Incremental refresh failed: {e}")


@router.post("/set-commit-sha")
async def set_commit_sha(commit_sha: str):
    """
    Set the cache's commit SHA (dev only, for testing incremental refresh).

    This allows simulating being at an older commit to test incremental updates.
    """
    try:
        cache = get_cache()
        old_sha = cache.last_commit_sha
        cache.last_commit_sha = commit_sha
        return {
            "status": "ok",
            "old_commit_sha": old_sha,
            "new_commit_sha": commit_sha,
        }
    except CacheNotInitializedError:
        raise HTTPException(status_code=400, detail="Cache not initialized")


@router.get("/cache-status")
async def cache_status():
    """
    Get current cache status for debugging.

    Returns commit SHA, last refresh time, item counts, and watched branch.
    """
    try:
        branch = get_content_branch()
    except Exception as e:
        branch = f"ERROR: {e}"

    try:
        cache = get_cache()
        return {
            "status": "ok",
            "watching_branch": branch,
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
