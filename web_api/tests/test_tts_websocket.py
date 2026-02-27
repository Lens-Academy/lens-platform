"""Integration tests for /ws/tts WebSocket endpoint.

Tests the full WebSocket handler: JSON protocol -> synthesize() -> audio chunks.
Requires INWORLD_API_KEY in .env / .env.local.

Uses Starlette TestClient which runs the ASGI app in a background thread.

NOTE: Tests involving asyncio.create_task (streaming mode, simulate_streaming)
fail under Starlette TestClient because it uses a different event loop thread
than the websockets library expects. These are tested via core/tts/tests/ instead.
"""

import json
import sys
from pathlib import Path

import pytest

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from starlette.testclient import TestClient

from core.tts import is_tts_available
from main import app

pytestmark = pytest.mark.skipif(
    not is_tts_available(),
    reason="INWORLD_API_KEY not set",
)


def _collect_audio(ws, timeout: float = 20.0) -> tuple[int, bool, str | None]:
    """Read messages from WS until done/error/close.

    Returns (total_audio_bytes, got_done, error_message).
    """
    import time

    audio_bytes = 0
    got_done = False
    error = None
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        msg = ws.receive()
        if "bytes" in msg and msg["bytes"]:
            audio_bytes += len(msg["bytes"])
        elif "text" in msg and msg["text"]:
            data = json.loads(msg["text"])
            if data.get("done"):
                got_done = True
                break
            if data.get("error"):
                error = data["error"]
                break

    return audio_bytes, got_done, error


# -- Single-shot mode (no background tasks, works under TestClient) --


def test_single_shot_produces_audio():
    """Send full text, expect binary audio chunks + done signal."""
    client = TestClient(app)
    with client.websocket_connect("/ws/tts") as ws:
        ws.send_json(
            {
                "text": "Hello, this is a test.",
                "voice": "Ashley",
                "audio_encoding": "LINEAR16",
            }
        )

        audio_bytes, got_done, error = _collect_audio(ws)

        assert error is None, f"TTS error: {error}"
        assert got_done, "Never received done signal"
        assert audio_bytes > 100, f"Too few audio bytes: {audio_bytes}"


def test_single_shot_mp3():
    """MP3 encoding also works."""
    client = TestClient(app)
    with client.websocket_connect("/ws/tts") as ws:
        ws.send_json(
            {
                "text": "Hello, MP3 test.",
                "voice": "Ashley",
                "audio_encoding": "MP3",
            }
        )

        audio_bytes, got_done, error = _collect_audio(ws)

        assert error is None, f"TTS error: {error}"
        assert got_done, "Never received done signal"
        assert audio_bytes > 100, f"Too few audio bytes: {audio_bytes}"


def test_single_shot_no_text_returns_error():
    """Empty text should return an error, not crash."""
    client = TestClient(app)
    with client.websocket_connect("/ws/tts") as ws:
        ws.send_json(
            {
                "text": "",
                "voice": "Ashley",
                "audio_encoding": "LINEAR16",
            }
        )

        msg = ws.receive()
        data = json.loads(msg["text"])
        assert "error" in data


# -- Streaming / simulate_streaming: skipped under TestClient --
# These use asyncio.create_task internally (in synthesize()
# and _llm_token_iter), which conflicts with TestClient's background-thread
# event loop. The streaming path is integration-tested in:
#   core/tts/tests/test_inworld_integration.py (test_multi_chunk_synthesize,
#   test_queue_iterator_synthesis)
