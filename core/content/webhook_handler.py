"""Webhook handling for GitHub content updates."""

import asyncio
import hmac
import hashlib
import logging
import os
from datetime import UTC, datetime
from typing import Optional

from .cache import get_cache, CacheNotInitializedError, build_category_summary
from .github_fetcher import incremental_refresh
from .validation_broadcaster import broadcaster

logger = logging.getLogger(__name__)

# Fetch locking state
_fetch_lock = asyncio.Lock()
_refetch_pending = False
_pending_commit_sha: Optional[str] = None


class WebhookSignatureError(Exception):
    """Raised when webhook signature verification fails."""

    pass


def verify_webhook_signature(payload: bytes, signature_header: str | None) -> None:
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
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, computed_sig):
        raise WebhookSignatureError("Signature verification failed")


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
        logger.info(f"Refresh already in progress, queued commit {commit_sha[:8]}")
        return {"status": "queued", "message": "Refresh already in progress, queued"}

    # Phase 1: Immediately update known_sha and broadcast "new commit detected"
    if broadcaster.subscriber_count > 0:
        try:
            cache = get_cache()
            cache.known_sha = commit_sha
            cache.known_sha_timestamp = datetime.now(UTC)
            cache.last_diff = None  # Clear stale diff from previous refresh
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

            # Another webhook came in, use its SHA
            current_sha = _pending_commit_sha or current_sha
            logger.info(f"Pending refresh detected, continuing with {current_sha[:8]}")

        # Build category-keyed summary
        summary = build_category_summary(validation_errors)

        result = {
            "status": "ok",
            "message": f"Cache refreshed ({refreshes} refresh(es))",
            "commit_sha": current_sha,
            "summary": summary,
            "issues": validation_errors,
        }

        # Phase 2: Broadcast full results after refresh
        if broadcaster.subscriber_count > 0:
            await broadcaster.broadcast(broadcaster._build_cache_snapshot())

        return result


def _reset_fetch_state() -> None:
    """Reset fetch locking state. For testing only."""
    global _refetch_pending, _pending_commit_sha
    _refetch_pending = False
    _pending_commit_sha = None
