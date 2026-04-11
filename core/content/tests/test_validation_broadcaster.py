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
            validation_errors=[
                {
                    "file": "test.md",
                    "message": "error",
                    "severity": "error",
                    "category": "production",
                }
            ],
        )
        set_cache(cache)

        queue = await self.broadcaster.subscribe()
        msg = queue.get_nowait()
        assert msg["processed_sha"] == "abc123"
        assert msg["summary"]["production"]["errors"] == 1
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
            assert (
                self.broadcaster._poll_task is None
                or self.broadcaster._poll_task.done()
            )

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
