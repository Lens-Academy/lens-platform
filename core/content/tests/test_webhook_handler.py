"""Tests for webhook signature verification and fetch locking."""

import asyncio
import hmac
import hashlib
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from core.content.webhook_handler import (
    verify_webhook_signature,
    WebhookSignatureError,
    handle_content_update,
    _reset_fetch_state,
    _fetch_lock,
)
from core.content.cache import ContentCache, set_cache, clear_cache


class TestVerifyWebhookSignature:
    """Test webhook signature verification."""

    def setup_method(self):
        """Set up test fixtures."""
        self.test_secret = "test-secret-key-12345"
        self.test_payload = b'{"ref": "refs/heads/main", "after": "abc123"}'

    def _compute_signature(self, payload: bytes, secret: str) -> str:
        """Compute a valid GitHub-style signature for testing."""
        sig = hmac.new(
            secret.encode(),
            payload,
            hashlib.sha256,
        ).hexdigest()
        return f"sha256={sig}"

    def test_valid_signature_passes(self, monkeypatch):
        """Should accept a valid signature."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        signature = self._compute_signature(self.test_payload, self.test_secret)

        # Should not raise
        verify_webhook_signature(self.test_payload, signature)

    def test_invalid_signature_raises_error(self, monkeypatch):
        """Should reject an invalid signature."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        # Use wrong secret to compute signature
        wrong_signature = self._compute_signature(self.test_payload, "wrong-secret")

        with pytest.raises(WebhookSignatureError) as exc_info:
            verify_webhook_signature(self.test_payload, wrong_signature)

        assert "Signature verification failed" in str(exc_info.value)

    def test_missing_secret_raises_error(self, monkeypatch):
        """Should raise error when GITHUB_WEBHOOK_SECRET is not configured."""
        monkeypatch.delenv("GITHUB_WEBHOOK_SECRET", raising=False)

        signature = self._compute_signature(self.test_payload, self.test_secret)

        with pytest.raises(WebhookSignatureError) as exc_info:
            verify_webhook_signature(self.test_payload, signature)

        assert "GITHUB_WEBHOOK_SECRET not configured" in str(exc_info.value)

    def test_missing_signature_header_raises_error(self, monkeypatch):
        """Should raise error when signature header is None."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        with pytest.raises(WebhookSignatureError) as exc_info:
            verify_webhook_signature(self.test_payload, None)

        assert "Invalid signature header format" in str(exc_info.value)

    def test_malformed_signature_header_no_prefix_raises_error(self, monkeypatch):
        """Should raise error when signature header doesn't have sha256= prefix."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        # Missing sha256= prefix
        raw_sig = hmac.new(
            self.test_secret.encode(),
            self.test_payload,
            hashlib.sha256,
        ).hexdigest()

        with pytest.raises(WebhookSignatureError) as exc_info:
            verify_webhook_signature(self.test_payload, raw_sig)

        assert "Invalid signature header format" in str(exc_info.value)

    def test_malformed_signature_header_wrong_prefix_raises_error(self, monkeypatch):
        """Should raise error when signature header has wrong prefix."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        # Wrong prefix (sha1 instead of sha256)
        sig = hmac.new(
            self.test_secret.encode(),
            self.test_payload,
            hashlib.sha256,
        ).hexdigest()
        wrong_prefix_sig = f"sha1={sig}"

        with pytest.raises(WebhookSignatureError) as exc_info:
            verify_webhook_signature(self.test_payload, wrong_prefix_sig)

        assert "Invalid signature header format" in str(exc_info.value)

    def test_empty_signature_header_raises_error(self, monkeypatch):
        """Should raise error when signature header is empty string."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        with pytest.raises(WebhookSignatureError) as exc_info:
            verify_webhook_signature(self.test_payload, "")

        assert "Invalid signature header format" in str(exc_info.value)

    def test_tampered_payload_fails_verification(self, monkeypatch):
        """Should reject when payload has been tampered with."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        # Compute signature for original payload
        signature = self._compute_signature(self.test_payload, self.test_secret)

        # Tamper with payload
        tampered_payload = b'{"ref": "refs/heads/main", "after": "TAMPERED"}'

        with pytest.raises(WebhookSignatureError) as exc_info:
            verify_webhook_signature(tampered_payload, signature)

        assert "Signature verification failed" in str(exc_info.value)

    def test_different_payloads_produce_different_signatures(self, monkeypatch):
        """Verify that different payloads produce different signatures."""
        monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", self.test_secret)

        payload1 = b'{"data": "first"}'
        payload2 = b'{"data": "second"}'

        sig1 = self._compute_signature(payload1, self.test_secret)
        sig2 = self._compute_signature(payload2, self.test_secret)

        # Signatures should be different
        assert sig1 != sig2

        # Each signature should verify its own payload
        verify_webhook_signature(payload1, sig1)
        verify_webhook_signature(payload2, sig2)

        # But not cross-verify
        with pytest.raises(WebhookSignatureError):
            verify_webhook_signature(payload1, sig2)


class TestHandleContentUpdate:
    """Test handle_content_update with fetch locking."""

    def setup_method(self):
        """Reset fetch state before each test."""
        _reset_fetch_state()

    def teardown_method(self):
        """Reset fetch state after each test."""
        _reset_fetch_state()

    @pytest.mark.asyncio
    async def test_single_update_succeeds(self):
        """Should complete a single update successfully."""
        commit_sha = "abc123def456789012345678901234567890abcd"

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            new_callable=AsyncMock,
        ) as mock_refresh:
            result = await handle_content_update(commit_sha)

            assert result["status"] == "ok"
            assert "1 refresh" in result["message"]
            assert result["commit_sha"] == commit_sha
            mock_refresh.assert_called_once_with(commit_sha)

    @pytest.mark.asyncio
    async def test_concurrent_updates_are_queued(self):
        """Second call while first is in progress should return 'queued' status."""
        commit_sha_1 = "abc123def456789012345678901234567890abcd"
        commit_sha_2 = "def456abc789012345678901234567890abcdef"

        # Create an event to control when the first refresh completes
        refresh_started = asyncio.Event()
        refresh_continue = asyncio.Event()

        async def slow_refresh(sha: str) -> list[dict]:
            refresh_started.set()
            await refresh_continue.wait()
            return []

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            side_effect=slow_refresh,
        ):
            # Start first update
            task1 = asyncio.create_task(handle_content_update(commit_sha_1))

            # Wait for refresh to start
            await refresh_started.wait()

            # Second update should return immediately with "queued" status
            result2 = await handle_content_update(commit_sha_2)
            assert result2["status"] == "queued"
            assert "already in progress" in result2["message"]

            # Let the first update complete
            refresh_continue.set()
            result1 = await task1

            # First update should have processed the queued SHA too
            assert result1["status"] == "ok"
            assert result1["commit_sha"] == commit_sha_2  # Used the queued SHA

    @pytest.mark.asyncio
    async def test_pending_updates_processed_after_current_finishes(self):
        """Pending update should be processed after current one finishes."""
        commit_sha_1 = "abc123def456789012345678901234567890abcd"
        commit_sha_2 = "def456abc789012345678901234567890abcdef"

        refresh_calls = []
        refresh_started = asyncio.Event()
        refresh_continue = asyncio.Event()
        first_call = True

        async def tracking_refresh(sha: str) -> list[dict]:
            nonlocal first_call
            refresh_calls.append(sha)
            if first_call:
                first_call = False
                refresh_started.set()
                await refresh_continue.wait()
            return []

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            side_effect=tracking_refresh,
        ):
            # Start first update
            task1 = asyncio.create_task(handle_content_update(commit_sha_1))

            # Wait for refresh to start
            await refresh_started.wait()

            # Queue second update
            result2 = await handle_content_update(commit_sha_2)
            assert result2["status"] == "queued"

            # Let first update complete - it should then process the pending one
            refresh_continue.set()
            result1 = await task1

            # Should have done 2 refreshes
            assert result1["status"] == "ok"
            assert "2 refresh" in result1["message"]
            assert len(refresh_calls) == 2
            assert refresh_calls[0] == commit_sha_1
            assert refresh_calls[1] == commit_sha_2

    @pytest.mark.asyncio
    async def test_multiple_queued_updates_coalesced(self):
        """Multiple queued updates should be coalesced into one."""
        commit_sha_1 = "abc123def456789012345678901234567890abcd"
        commit_sha_2 = "def456abc789012345678901234567890abcdef"
        commit_sha_3 = "789012abc345678901234567890abcdef012345"

        refresh_calls = []
        refresh_started = asyncio.Event()
        refresh_continue = asyncio.Event()
        first_call = True

        async def tracking_refresh(sha: str) -> list[dict]:
            nonlocal first_call
            refresh_calls.append(sha)
            if first_call:
                first_call = False
                refresh_started.set()
                await refresh_continue.wait()
            return []

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            side_effect=tracking_refresh,
        ):
            # Start first update
            task1 = asyncio.create_task(handle_content_update(commit_sha_1))

            # Wait for refresh to start
            await refresh_started.wait()

            # Queue multiple updates (only the last one should be used)
            result2 = await handle_content_update(commit_sha_2)
            assert result2["status"] == "queued"

            result3 = await handle_content_update(commit_sha_3)
            assert result3["status"] == "queued"

            # Let first update complete
            refresh_continue.set()
            result1 = await task1

            # Should have done 2 refreshes total (first + coalesced pending)
            assert result1["status"] == "ok"
            assert "2 refresh" in result1["message"]
            assert len(refresh_calls) == 2
            assert refresh_calls[0] == commit_sha_1
            # The second refresh should use the LAST queued SHA (sha_3)
            assert refresh_calls[1] == commit_sha_3
            assert result1["commit_sha"] == commit_sha_3

    @pytest.mark.asyncio
    async def test_lock_released_on_completion(self):
        """Lock should be released after update completes."""
        commit_sha = "abc123def456789012345678901234567890abcd"

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            new_callable=AsyncMock,
        ):
            await handle_content_update(commit_sha)

            # Lock should be released
            assert not _fetch_lock.locked()

    @pytest.mark.asyncio
    async def test_lock_released_on_error(self):
        """Lock should be released even if refresh raises an exception."""
        commit_sha = "abc123def456789012345678901234567890abcd"

        with patch(
            "core.content.webhook_handler.incremental_refresh",
            side_effect=Exception("Test error"),
        ):
            with pytest.raises(Exception, match="Test error"):
                await handle_content_update(commit_sha)

            # Lock should be released
            assert not _fetch_lock.locked()


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
            with patch("core.content.webhook_handler.broadcaster") as mock_broadcaster:
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
            with patch("core.content.webhook_handler.broadcaster") as mock_broadcaster:
                mock_broadcaster.broadcast = AsyncMock()
                mock_broadcaster.subscriber_count = 1
                mock_broadcaster._build_cache_snapshot.return_value = {"status": "ok"}

                await handle_content_update(commit_sha)

        # known_sha should have been set BEFORE incremental_refresh was called
        assert known_sha_during_refresh == commit_sha
