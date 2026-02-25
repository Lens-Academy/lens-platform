"""WebSocket endpoint for streaming TTS audio to the browser.

Protocol:
1. Client connects to /ws/tts
2. Client sends JSON: {"text": "...", "voice": "Ashley", "model": "inworld-tts-1.5-mini"}
3. Server sends binary WebSocket frames (MP3 audio chunks) as they arrive
4. Server sends JSON {"done": true} when all audio has been sent
5. Server sends JSON {"error": "message"} if TTS fails
"""

import logging
import time
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.tts import TTSConfig, get_tts_client, get_api_key, is_tts_available

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

    if _voices_cache is not None and (time.monotonic() - _voices_cache_time) < _VOICES_CACHE_TTL:
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
    """Wrap full text as a single-chunk async iterator.

    For Phase 9 test harness: yields the complete text as one chunk.
    Phase 10 will provide an actual LLM token stream instead.
    """
    yield text


@router.websocket("/ws/tts")
async def tts_stream(websocket: WebSocket) -> None:
    """Stream TTS audio to browser via WebSocket.

    Accepts a JSON request with text and optional voice,
    streams back binary MP3 audio frames from Inworld TTS,
    then sends a JSON completion signal.
    """
    await websocket.accept()

    try:
        # Receive JSON request
        data = await websocket.receive_json()
        text = data.get("text", "")
        voice = data.get("voice", "Ashley")
        model = data.get("model", "inworld-tts-1.5-mini")
        audio_encoding = data.get("audio_encoding", "MP3")
        speaking_rate = data.get("speaking_rate")  # None = use default (1.0)

        if not text:
            await websocket.send_json({"error": "No text provided"})
            await websocket.close()
            return

        # Check if TTS is available
        if not is_tts_available():
            await websocket.send_json(
                {"error": "TTS not configured (INWORLD_API_KEY not set)"}
            )
            await websocket.close()
            return

        # Create config with requested voice and model
        config = TTSConfig(voice_id=voice, model_id=model, audio_encoding=audio_encoding, speaking_rate=speaking_rate)

        # Create async text iterator (single chunk for Phase 9)
        text_iter = _single_chunk_iter(text)

        # Synthesize and stream audio chunks
        client = get_tts_client()
        async for audio_chunk in client.synthesize(text_iter, config):
            await websocket.send_bytes(audio_chunk)

        # Signal completion
        await websocket.send_json({"done": True})

    except WebSocketDisconnect:
        logger.info("TTS WebSocket client disconnected")
    except Exception:
        logger.exception("TTS streaming error")
        try:
            await websocket.send_json({"error": "TTS streaming failed"})
            await websocket.close()
        except Exception:
            pass  # Client already disconnected
