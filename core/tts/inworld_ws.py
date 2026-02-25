"""Persistent WebSocket client for Inworld TTS streaming.

Maintains a single WebSocket connection to Inworld's bidirectional TTS
endpoint. Accepts async text token iterators (from LLM streaming) and
yields decoded audio chunks (MP3 bytes).

Usage:
    client = InworldTTSClient()
    async for audio_bytes in client.synthesize(text_chunks):
        await websocket.send_bytes(audio_bytes)
    await client.close()
"""

import asyncio
import base64
import json
import logging
from typing import AsyncIterator
from uuid import uuid4

import websockets.asyncio.client
import websockets.exceptions

from .config import INWORLD_WS_URL, TTSConfig, get_api_key

logger = logging.getLogger(__name__)


class InworldTTSClient:
    """Persistent WebSocket connection to Inworld TTS.

    Serializes synthesis calls via asyncio.Lock (one synthesis at a time).
    Phase 9 is single-user test harness -- concurrent synthesis is not needed.
    Phase 10 may add a message dispatch layer if concurrent synthesis is required.
    """

    def __init__(self) -> None:
        self._ws: websockets.asyncio.client.ClientConnection | None = None
        self._lock = asyncio.Lock()
        self._keepalive_task: asyncio.Task | None = None

    async def _ensure_connected(self) -> None:
        """Connect or reconnect to Inworld WebSocket if needed."""
        if self._ws is not None:
            try:
                # Check if connection is still open
                if self._ws.close_code is None:
                    return
            except Exception:
                pass

        api_key = get_api_key()
        if not api_key:
            raise RuntimeError(
                "INWORLD_API_KEY not set -- cannot connect to Inworld TTS"
            )

        logger.info("Connecting to Inworld TTS WebSocket...")
        self._ws = await websockets.asyncio.client.connect(
            INWORLD_WS_URL,
            additional_headers={
                "Authorization": f"Basic {api_key}",
            },
        )
        logger.info("Connected to Inworld TTS WebSocket")

        # Start keepalive loop
        if self._keepalive_task is not None:
            self._keepalive_task.cancel()
        self._keepalive_task = asyncio.create_task(self._keepalive_loop())

    async def _keepalive_loop(self) -> None:
        """Send empty text every 60 seconds to prevent connection timeout.

        Based on pipecat InworldTTSService keepalive pattern.
        """
        while True:
            try:
                await asyncio.sleep(60)
                if self._ws is not None and self._ws.close_code is None:
                    await self._ws.send(
                        json.dumps(
                            {
                                "send_text": {"text": ""},
                                "contextId": "keepalive",
                            }
                        )
                    )
            except Exception:
                logger.debug("Keepalive failed, connection will reconnect on next use")
                break

    async def synthesize(
        self,
        text_chunks: AsyncIterator[str],
        config: TTSConfig | None = None,
        context_id: str | None = None,
    ) -> AsyncIterator[bytes]:
        """Stream text tokens in, yield audio chunks out.

        Args:
            text_chunks: Async iterator of text tokens (from LLM or full text).
            config: TTS configuration. Uses defaults if not provided.
            context_id: Unique context ID for this synthesis. Auto-generated if None.

        Yields:
            Raw audio bytes (MP3 chunks, base64-decoded from Inworld).

        The entire synthesize call is serialized via asyncio.Lock to prevent
        recv() race conditions between interleaved contexts.
        """
        async with self._lock:
            yield_from = self._synthesize_locked(text_chunks, config, context_id)
            async for chunk in yield_from:
                yield chunk

    async def _synthesize_locked(
        self,
        text_chunks: AsyncIterator[str],
        config: TTSConfig | None,
        context_id: str | None,
    ) -> AsyncIterator[bytes]:
        """Internal synthesis implementation (must be called under lock)."""
        if config is None:
            config = TTSConfig()
        if context_id is None:
            context_id = str(uuid4())

        retry = False
        try:
            async for chunk in self._do_synthesize(text_chunks, config, context_id):
                yield chunk
        except websockets.exceptions.ConnectionClosed:
            logger.warning(
                "Inworld WebSocket connection closed during synthesis, reconnecting..."
            )
            retry = True

        if retry:
            # Reconnect and retry once. Note: text_chunks iterator is consumed,
            # so this retry only works if the failure happened before consuming
            # tokens. For Phase 9 (full-text single chunk), this is fine.
            self._ws = None
            await self._ensure_connected()
            async for chunk in self._do_synthesize(text_chunks, config, context_id):
                yield chunk

    async def _do_synthesize(
        self,
        text_chunks: AsyncIterator[str],
        config: TTSConfig,
        context_id: str,
    ) -> AsyncIterator[bytes]:
        """Execute one synthesis pass against the Inworld WebSocket."""
        await self._ensure_connected()
        assert self._ws is not None

        # 1. Create context with config values
        create_msg = {
            "create": {
                "voiceId": config.voice_id,
                "modelId": config.model_id,
                "audioConfig": {
                    "audioEncoding": config.audio_encoding,
                    "sampleRateHertz": config.sample_rate_hz,
                    "bitRate": config.bit_rate,
                },
                "bufferCharThreshold": config.buffer_char_threshold,
                "maxBufferDelayMs": config.max_buffer_delay_ms,
                "autoMode": config.auto_mode,
            },
            "contextId": context_id,
        }
        await self._ws.send(json.dumps(create_msg))
        logger.debug("Sent create context: %s", context_id)

        # Wait for contextCreated confirmation
        while True:
            msg = json.loads(await self._ws.recv())
            if "contextCreated" in msg:
                logger.debug("Context created: %s", context_id)
                break

        # 2. Start background task to send text chunks, then flush
        send_task: asyncio.Task | None = None

        async def send_text() -> None:
            assert self._ws is not None
            async for token in text_chunks:
                send_msg = {
                    "send_text": {"text": token},
                    "contextId": context_id,
                }
                await self._ws.send(json.dumps(send_msg))
            # All text sent, flush remaining buffer
            await self._ws.send(
                json.dumps(
                    {
                        "flush_context": {},
                        "contextId": context_id,
                    }
                )
            )
            logger.debug("All text sent and flushed for context: %s", context_id)

        try:
            send_task = asyncio.create_task(send_text())

            # 3. Yield decoded audio bytes from audioChunk messages until flushCompleted
            while True:
                msg = json.loads(await self._ws.recv())
                if "audioChunk" in msg:
                    audio_b64 = msg["audioChunk"]["audioContent"]
                    yield base64.b64decode(audio_b64)
                elif "flushCompleted" in msg:
                    logger.debug("Flush completed for context: %s", context_id)
                    break
        finally:
            # Ensure send task completes
            if send_task is not None:
                await send_task

            # 4. Close context to clean up
            if self._ws is not None and self._ws.close_code is None:
                try:
                    await self._ws.send(
                        json.dumps(
                            {
                                "close_context": {},
                                "contextId": context_id,
                            }
                        )
                    )
                    logger.debug("Closed context: %s", context_id)
                except Exception:
                    logger.debug(
                        "Failed to close context %s (connection may be closed)",
                        context_id,
                    )

    async def close(self) -> None:
        """Close the WebSocket connection and stop keepalive."""
        if self._keepalive_task is not None:
            self._keepalive_task.cancel()
            self._keepalive_task = None

        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
            logger.info("Inworld TTS WebSocket connection closed")
