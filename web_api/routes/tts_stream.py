"""WebSocket endpoint for streaming TTS audio to the browser.

Protocol:
1. Client connects to /ws/tts
2. Client sends JSON: {"text": "full text to synthesize", "voice": "Ashley"}
3. Server sends binary WebSocket frames (MP3 audio chunks) as they arrive
4. Server sends JSON {"done": true} when all audio has been sent
5. Server sends JSON {"error": "message"} if TTS fails
"""

import logging
from typing import AsyncIterator

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.tts import TTSConfig, get_tts_client, is_tts_available

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tts"])


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

        # Create config with requested voice
        config = TTSConfig(voice_id=voice)

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
