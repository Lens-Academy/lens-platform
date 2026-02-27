"""WebSocket endpoint for streaming TTS audio to the browser.

Supports two protocols:

**Single-shot** (default):
1. Client sends JSON: {"text": "...", "voice": "Ashley"}
2. Server streams binary audio chunks
3. Server sends {"done": true}

**Streaming** (for parallel LLM+TTS):
1. Client sends JSON: {"streaming": true, "voice": "Ashley"}
2. Client sends {"text": "token"} messages as LLM tokens arrive
3. Client sends {"flush": true} when LLM is done
4. Server streams binary audio chunks concurrently
5. Server sends {"done": true}
"""

import asyncio
import logging
import time
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.tts import (
    TTSConfig,
    QueueIterator,
    find_split,
    get_tts_client,
    get_api_key,
    is_tts_available,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tts"])

# In-memory cache for voice list (voices rarely change)
_voices_cache: list[dict] | None = None
_voices_cache_time: float = 0
_VOICES_CACHE_TTL = 3600  # 1 hour


@router.get("/api/tts/voices")
async def list_voices() -> list[dict]:
    """Return available Inworld TTS voices.

    Fetches from Inworld REST API and caches in-memory for 1 hour.
    """
    global _voices_cache, _voices_cache_time

    if (
        _voices_cache is not None
        and (time.monotonic() - _voices_cache_time) < _VOICES_CACHE_TTL
    ):
        return _voices_cache

    api_key = get_api_key()
    if not api_key:
        return []

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.inworld.ai/tts/v1/voices",
            params={"language": "en"},
            headers={"Authorization": f"Basic {api_key}"},
            timeout=10,
        )
        resp.raise_for_status()

    voices = resp.json().get("voices", [])
    _voices_cache = voices
    _voices_cache_time = time.monotonic()
    return voices


async def _single_chunk_iter(text: str) -> AsyncIterator[str]:
    """Wrap full text as a single-chunk async iterator."""
    yield text


async def _llm_token_iter(text: str, delay: float = 0.05) -> AsyncIterator[str]:
    """Simulate LLM token streaming by yielding words with small delays."""
    for word in text.split():
        yield word + " "
        await asyncio.sleep(delay)


# _QueueIterator moved to core.tts.sentence_buffer → imported as QueueIterator


def _parse_config(data: dict) -> TTSConfig:
    """Extract TTSConfig from the initial WebSocket JSON message."""
    return TTSConfig(
        voice_id=data.get("voice", "Ashley"),
        model_id=data.get("model", "inworld-tts-1.5-mini"),
        audio_encoding=data.get("audio_encoding", "MP3"),
        speaking_rate=data.get("speaking_rate"),
    )


# _find_split / _SENTENCE_END / _CLAUSE_END moved to core.tts.sentence_buffer → imported as find_split


async def _handle_single_shot(websocket: WebSocket, data: dict) -> None:
    """Handle single-shot TTS: full text sent upfront."""
    text = data.get("text", "")
    if not text:
        await websocket.send_json({"error": "No text provided"})
        await websocket.close()
        return

    config = _parse_config(data)

    # Choose text iterator: simulated streaming or single chunk
    simulate = data.get("simulate_streaming", False)
    token_delay = data.get("token_delay", 0.05)
    if simulate:
        word_count = len(text.split())
        logger.info(
            "TTS simulate_streaming: %d words, %.3fs delay", word_count, token_delay
        )
        text_iter: AsyncIterator[str] = _llm_token_iter(text, token_delay)
    else:
        text_iter = _single_chunk_iter(text)

    client = get_tts_client()
    async for audio_chunk in client.synthesize(text_iter, config):
        await websocket.send_bytes(audio_chunk)

    await websocket.send_json({"done": True})


async def _handle_streaming(websocket: WebSocket, data: dict) -> None:
    """Handle streaming TTS: text tokens arrive incrementally from client.

    A background task reads subsequent WebSocket messages and feeds them
    into a queue-backed async iterator that the TTS client consumes.
    """
    config = _parse_config(data)
    queue_iter = QueueIterator()

    async def receive_tokens() -> None:
        """Read text/flush messages from client, buffer into sentences."""
        buffer = ""
        first_sent = False  # Has any text been sent to Inworld yet?

        try:
            while True:
                msg = await websocket.receive_json()
                if msg.get("flush"):
                    # Send remaining buffer, then end stream
                    if buffer.strip():
                        await queue_iter.put(buffer)
                    await queue_iter.put(None)
                    return

                text = msg.get("text", "")
                if not text:
                    continue
                buffer += text

                # Try to extract complete chunks from buffer
                while True:
                    split_pos = find_split(buffer, aggressive=not first_sent)
                    if split_pos < 0:
                        break
                    chunk = buffer[:split_pos]
                    buffer = buffer[split_pos:]
                    if chunk.strip():
                        await queue_iter.put(chunk)
                        first_sent = True
        except WebSocketDisconnect:
            if buffer.strip():
                await queue_iter.put(buffer)
            await queue_iter.put(None)
        except Exception:
            logger.exception("Error receiving streaming tokens")
            if buffer.strip():
                await queue_iter.put(buffer)
            await queue_iter.put(None)

    # Start receiving tokens concurrently with synthesis
    receive_task = asyncio.create_task(receive_tokens())

    try:
        client = get_tts_client()
        async for audio_chunk in client.synthesize(queue_iter, config):
            await websocket.send_bytes(audio_chunk)

        await websocket.send_json({"done": True})
    finally:
        # Ensure receive task completes
        if not receive_task.done():
            receive_task.cancel()
            try:
                await receive_task
            except asyncio.CancelledError:
                pass


@router.websocket("/ws/tts")
async def tts_stream(websocket: WebSocket) -> None:
    """Stream TTS audio to browser via WebSocket."""
    await websocket.accept()

    try:
        data = await websocket.receive_json()

        if not is_tts_available():
            await websocket.send_json(
                {"error": "TTS not configured (INWORLD_API_KEY not set)"}
            )
            await websocket.close()
            return

        if data.get("streaming"):
            await _handle_streaming(websocket, data)
        else:
            await _handle_single_shot(websocket, data)

    except WebSocketDisconnect:
        logger.info("TTS WebSocket client disconnected")
    except Exception:
        logger.exception("TTS streaming error")
        try:
            await websocket.send_json({"error": "TTS streaming failed"})
            await websocket.close()
        except Exception:
            pass  # Client already disconnected
