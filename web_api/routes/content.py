"""
Content management API routes.

Endpoints:
- POST /api/content/webhook - Handle GitHub push webhook to refresh cache
- POST /api/content/refresh - Manual refresh for development
- GET /api/content/validation-stream - SSE endpoint for live validation updates
- POST /api/content/refresh-validation - Manual refresh trigger for validation dashboard
- GET /api/content/graph - Graph data for concentric overview visualization
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, Request, HTTPException, Header
from starlette.responses import StreamingResponse

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core.content import refresh_cache, get_cache, CacheNotInitializedError
from core.content.github_fetcher import get_content_branch
from core.modules.tools.content_index import ContentIndex
from core.content.validation_broadcaster import broadcaster
from core.modules.flattened_types import ModuleRef
from core.content.webhook_handler import (
    handle_content_update,
    verify_webhook_signature,
    WebhookSignatureError,
)

router = APIRouter(prefix="/api/content", tags=["content"])


def _rebuild_content_index(request: Request) -> None:
    """Rebuild the content index after a cache refresh."""
    try:
        cache = get_cache()
        request.app.state.content_index = ContentIndex(
            cache.courses, cache.flattened_modules
        )
        logger.info(
            "Content index rebuilt: %d lenses",
            len(request.app.state.content_index.list_paths()),
        )
    except Exception as e:
        logger.warning("Failed to rebuild content index: %s", e)


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
        _rebuild_content_index(request)
        logger.info(f"Webhook processed: {result}")
        return result
    except Exception as e:
        logger.error(f"Cache refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")


@router.post("/refresh")
async def manual_refresh(request: Request):
    """
    Manually refresh the content cache (full refresh).

    For local development when webhooks aren't available.
    TODO: Add admin authentication
    """
    logger.info("Manual cache refresh requested...")

    try:
        await refresh_cache()
        _rebuild_content_index(request)
        logger.info("Content cache refreshed successfully via manual request")
        return {"status": "ok", "message": "Cache refreshed (full)"}
    except Exception as e:
        logger.error(f"Cache refresh failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cache refresh failed: {e}")


@router.post("/refresh-incremental")
async def manual_incremental_refresh(request: Request, commit_sha: str | None = None):
    """
    Manually trigger an incremental refresh (dev only).

    Simulates a GitHub webhook without signature verification.
    If commit_sha is not provided, fetches the latest from GitHub.

    TODO: Add admin authentication or disable in production
    """
    from core.content.github_fetcher import get_latest_commit_sha

    # If no commit SHA provided, fetch the latest
    if not commit_sha:
        try:
            commit_sha = await get_latest_commit_sha()
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to fetch latest commit: {e}",
            )

    logger.info(f"Manual incremental refresh requested for commit {commit_sha[:8]}...")

    try:
        result = await handle_content_update(commit_sha)
        _rebuild_content_index(request)
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
            "known_sha": cache.known_sha,
            "known_sha_timestamp": cache.known_sha_timestamp.isoformat()
            if cache.known_sha_timestamp
            else None,
            "fetched_sha": cache.fetched_sha,
            "fetched_sha_timestamp": cache.fetched_sha_timestamp.isoformat()
            if cache.fetched_sha_timestamp
            else None,
            "processed_sha": cache.processed_sha,
            "processed_sha_timestamp": cache.processed_sha_timestamp.isoformat()
            if cache.processed_sha_timestamp
            else None,
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


@router.get("/graph")
async def content_graph():
    """
    Assemble graph data from ContentCache for the concentric overview visualization.

    Returns nodes (courses, modules, lenses) and links between them.
    """
    try:
        cache = get_cache()
    except CacheNotInitializedError:
        raise HTTPException(status_code=503, detail="Content cache not initialized")

    nodes = []
    links = []

    # Collect all module slugs referenced by courses (for orphan detection)
    referenced_module_slugs: set[str] = set()
    seen_lens_ids: set[str] = set()

    # Build parent→children mapping from parent_slug fields.
    # Parent modules may not exist in flattened_modules themselves —
    # we synthesize them from child metadata.
    parent_children: dict[str, list[str]] = {}  # parent_slug → [child slugs]
    parent_titles: dict[str, str] = {}  # parent_slug → title
    for slug, module in cache.flattened_modules.items():
        if slug.startswith("lens/"):
            continue
        if module.parent_slug:
            parent_children.setdefault(module.parent_slug, []).append(slug)
            if module.parent_title:
                parent_titles[module.parent_slug] = module.parent_title

    # Virtual root node — gives courses their own ring instead of all
    # sharing the center point (ring 0) where dagMode can't separate them.
    nodes.append(
        {
            "id": "root",
            "type": "root",
            "title": "",
            "slug": "",
            "band": 0,
        }
    )

    # 1. Course nodes + course→module/parent-module edges
    for slug, course in cache.courses.items():
        nodes.append(
            {
                "id": f"course:{slug}",
                "type": "course",
                "title": course.title,
                "slug": slug,
                "band": 1,
            }
        )
        links.append(
            {
                "source": "root",
                "target": f"course:{slug}",
            }
        )
        for item in course.progression:
            if isinstance(item, ModuleRef):
                referenced_module_slugs.add(item.slug)
                mod = cache.flattened_modules.get(item.slug)
                if mod and mod.parent_slug:
                    # Submodule — course links to parent, parent links to child
                    # (parent→child edge added below; just mark parent as referenced)
                    referenced_module_slugs.add(mod.parent_slug)
                    links.append(
                        {
                            "source": f"course:{slug}",
                            "target": f"module:{mod.parent_slug}",
                        }
                    )
                else:
                    # Standalone module — course links directly
                    links.append(
                        {
                            "source": f"course:{slug}",
                            "target": f"module:{item.slug}",
                        }
                    )

    # Deduplicate course→parent links (multiple children share one parent)
    seen_links: set[tuple[str, str]] = set()
    deduped_links = []
    for link in links:
        key = (link["source"], link["target"])
        if key not in seen_links:
            seen_links.add(key)
            deduped_links.append(link)
    links = deduped_links

    # 2. Parent module nodes (synthesized from children)
    for parent_slug, children in parent_children.items():
        orphan = parent_slug not in referenced_module_slugs
        # Check if the parent exists as an actual module in cache
        parent_mod = cache.flattened_modules.get(parent_slug)
        wip = parent_mod.error is not None if parent_mod else False
        nodes.append(
            {
                "id": f"module:{parent_slug}",
                "type": "parent-module",
                "title": parent_titles.get(parent_slug, parent_slug),
                "slug": parent_slug,
                "orphan": orphan,
                "wip": wip,
                "file": f"Modules/{parent_slug}.md",
                "band": 2,
            }
        )
        # Parent→child edges
        for child_slug in children:
            links.append(
                {
                    "source": f"module:{parent_slug}",
                    "target": f"module:{child_slug}",
                }
            )

    # 3. Module nodes (skip lens/ prefixed and parent-only modules) + lens nodes
    for slug, module in cache.flattened_modules.items():
        if slug.startswith("lens/"):
            continue
        # Skip if this slug is a synthesized parent (already added above)
        if slug in parent_children:
            continue

        orphan = slug not in referenced_module_slugs
        wip = module.error is not None

        nodes.append(
            {
                "id": f"module:{slug}",
                "type": "module",
                "title": module.title,
                "slug": slug,
                "orphan": orphan,
                "wip": wip,
                "file": f"Modules/{slug}.md",
                "band": 2,
            }
        )

        # Lens nodes from sections with contentId
        for section in module.sections:
            content_id = section.get("contentId")
            if content_id is None:
                continue
            lens_id = f"lens:{content_id}"
            if lens_id not in seen_lens_ids:
                seen_lens_ids.add(lens_id)
                nodes.append(
                    {
                        "id": lens_id,
                        "type": "lens",
                        "title": section.get("meta", {}).get("title", ""),
                        "slug": slug,  # parent module slug for navigation
                        "sectionType": section.get("type"),
                        "file": None,
                        "orphan": orphan,
                        "wip": wip,
                        "band": 3,
                    }
                )
            links.append(
                {
                    "source": f"module:{slug}",
                    "target": lens_id,
                }
            )

    return {"nodes": nodes, "links": links}


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
