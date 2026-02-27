"""Stateless Inworld TTS synthesis via fresh WebSocket per call.

Each synthesize() call opens a new WebSocket to Inworld's bidirectional TTS
endpoint, creates a context, streams text, and yields decoded audio chunks.
No persistent state — connection opens and closes within each call.

Usage:
    async for audio_bytes in synthesize(text_chunks, config):
        await websocket.send_bytes(audio_bytes)
"""

import asyncio
import base64
import json
import logging
import time
from typing import AsyncIterator
from uuid import uuid4

import websockets.asyncio.client

from .config import INWORLD_WS_URL, TTSConfig, get_api_key

logger = logging.getLogger(__name__)

# Timeout (seconds) after the last audio chunk once flush is sent.
# If no new audio arrives within this window, synthesis is considered complete.
_AUDIO_SILENCE_TIMEOUT = 1.0

# Maximum time (seconds) to wait for any single WebSocket message.
_RECV_TIMEOUT = 5.0

# Absolute safety valve — never wait longer than this for a single synthesis.
_MAX_SYNTHESIS_SECONDS = 120


async def synthesize(
    text_chunks: AsyncIterator[str],
    config: TTSConfig | None = None,
) -> AsyncIterator[bytes]:
    """Stream text tokens in, yield audio chunks out.

    Opens a fresh WebSocket to Inworld for each call. No shared state.

    Args:
        text_chunks: Async iterator of text (sentences from LLM or full text).
        config: TTS configuration. Uses defaults if not provided.

    Yields:
        Raw audio bytes (base64-decoded from Inworld).
    """
    if config is None:
        config = TTSConfig()

    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("INWORLD_API_KEY not set — cannot connect to Inworld TTS")

    context_id = str(uuid4())

    # 1. Fresh connection
    ws = await websockets.asyncio.client.connect(
        INWORLD_WS_URL,
        additional_headers={"Authorization": f"Basic {api_key}"},
    )
    logger.info("Inworld TTS connected (context %s)", context_id[:8])

    try:
        # 2. Create context
        create_msg = {
            "create": {
                "voiceId": config.voice_id,
                "modelId": config.model_id,
                "audioConfig": {
                    "audioEncoding": config.audio_encoding,
                    "sampleRateHertz": config.sample_rate_hz,
                    **(
                        {"bitRate": config.bit_rate}
                        if config.audio_encoding not in ("LINEAR16",)
                        else {}
                    ),
                    **(
                        {"speakingRate": config.speaking_rate}
                        if config.speaking_rate is not None
                        else {}
                    ),
                },
                "bufferCharThreshold": config.buffer_char_threshold,
                "maxBufferDelayMs": config.max_buffer_delay_ms,
                "autoMode": config.auto_mode,
            },
            "contextId": context_id,
        }
        await ws.send(json.dumps(create_msg))
        logger.debug("Sent create context: %s", context_id[:8])

        # Wait for contextCreated (with timeout to avoid infinite hang)
        while True:
            raw = json.loads(await asyncio.wait_for(ws.recv(), timeout=_RECV_TIMEOUT))
            msg = raw.get("result", raw)
            if "contextCreated" in msg:
                logger.debug("Context created: %s", context_id[:8])
                break

        # 3. Background task: send text chunks then flush
        send_done = asyncio.Event()
        chars_sent = 0

        async def send_text() -> None:
            nonlocal chars_sent
            token_count = 0
            async for token in text_chunks:
                await ws.send(
                    json.dumps(
                        {
                            "send_text": {"text": token},
                            "contextId": context_id,
                        }
                    )
                )
                token_count += 1
                chars_sent += len(token)

            # All text sent — flush
            await ws.send(
                json.dumps(
                    {
                        "flush_context": {},
                        "contextId": context_id,
                    }
                )
            )
            logger.info(
                "All text sent and flushed (%s): %d tokens, %d chars",
                context_id[:8],
                token_count,
                chars_sent,
            )
            send_done.set()

        send_task = asyncio.create_task(send_text())

        # 4. Read audio until done
        chunk_count = 0
        total_bytes = 0
        last_audio_time: float | None = None
        got_flush_after_send = False
        synthesis_start = time.monotonic()

        try:
            while True:
                # Safety valve
                if time.monotonic() - synthesis_start > _MAX_SYNTHESIS_SECONDS:
                    logger.warning(
                        "Safety valve: synthesis exceeded %ds", _MAX_SYNTHESIS_SECONDS
                    )
                    break

                # Once flush is received after all text was sent, use a shorter
                # timeout — we only need to wait for trailing audio chunks, not
                # new synthesis work.
                timeout = (
                    _AUDIO_SILENCE_TIMEOUT if got_flush_after_send else _RECV_TIMEOUT
                )

                try:
                    raw = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
                except asyncio.TimeoutError:
                    if send_done.is_set() and got_flush_after_send:
                        logger.info(
                            "Recv timeout after flush — synthesis complete (%s)",
                            context_id[:8],
                        )
                        break
                    if send_done.is_set():
                        logger.debug(
                            "Recv timeout, send done but no flush yet — continuing"
                        )
                    continue

                msg = raw.get("result", raw)

                if "audioChunk" in msg:
                    audio_b64 = msg["audioChunk"]["audioContent"]
                    decoded = base64.b64decode(audio_b64)
                    chunk_count += 1
                    total_bytes += len(decoded)
                    last_audio_time = time.monotonic()
                    if chunk_count <= 3 or chunk_count % 50 == 0:
                        logger.debug(
                            "Audio chunk #%d (%s): %d bytes (total: %d)",
                            chunk_count,
                            context_id[:8],
                            len(decoded),
                            total_bytes,
                        )
                    yield decoded

                elif "flushCompleted" in msg:
                    if send_done.is_set():
                        got_flush_after_send = True
                        # Check silence window: if last audio was >_AUDIO_SILENCE_TIMEOUT ago, done
                        if (
                            last_audio_time
                            and (time.monotonic() - last_audio_time)
                            > _AUDIO_SILENCE_TIMEOUT
                        ):
                            logger.info(
                                "Flush + silence — synthesis complete (%s): %d chunks, %d bytes",
                                context_id[:8],
                                chunk_count,
                                total_bytes,
                            )
                            break
                    else:
                        logger.debug("Ignoring flushCompleted (send still in progress)")

                else:
                    # Ignore non-audio/non-flush messages (status, metadata, etc.)
                    logger.debug(
                        "Ignoring Inworld msg (%s): %s",
                        context_id[:8],
                        list(msg.keys()),
                    )

        finally:
            # Ensure send task completes
            if not send_task.done():
                send_task.cancel()
                try:
                    await send_task
                except asyncio.CancelledError:
                    pass
            else:
                await send_task

        logger.info(
            "Synthesis done (%s): %d chunks, %d bytes, %d chars",
            context_id[:8],
            chunk_count,
            total_bytes,
            chars_sent,
        )

    finally:
        # 5. Close context + connection
        try:
            await ws.send(json.dumps({"close_context": {}, "contextId": context_id}))
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass
        logger.info("Inworld TTS disconnected (%s)", context_id[:8])
