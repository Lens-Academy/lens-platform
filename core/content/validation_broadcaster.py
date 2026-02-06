"""Manages SSE connections and background polling for live validation updates."""

import asyncio
import logging

from core.content.cache import get_cache, CacheNotInitializedError

logger = logging.getLogger(__name__)


class ValidationBroadcaster:
    """Manages SSE subscribers, broadcasts validation state, and polls GitHub."""

    def __init__(self, poll_interval: int = 10):
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
            "known_sha_timestamp": (
                cache.known_sha_timestamp.isoformat()
                if cache.known_sha_timestamp
                else None
            ),
            "fetched_sha": cache.fetched_sha,
            "fetched_sha_timestamp": (
                cache.fetched_sha_timestamp.isoformat()
                if cache.fetched_sha_timestamp
                else None
            ),
            "processed_sha": cache.processed_sha,
            "processed_sha_timestamp": (
                cache.processed_sha_timestamp.isoformat()
                if cache.processed_sha_timestamp
                else None
            ),
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
                    # handle_content_update does two-phase broadcast:
                    # Phase 1: sets known_sha + broadcasts immediately
                    # Phase 2: broadcasts full results after refresh
                    await handle_content_update(latest_sha)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Poll error: {e}")

            try:
                await asyncio.sleep(self._poll_interval)
            except asyncio.CancelledError:
                break

        logger.info("Poll loop exiting (no subscribers)")

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
