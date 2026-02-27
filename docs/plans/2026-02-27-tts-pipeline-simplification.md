# TTS Pipeline Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the buggy persistent InworldTTSClient with a stateless `synthesize()` function that creates a fresh WebSocket per call, fixing audio cutoff in roleplay.

**Architecture:** The `InworldTTSClient` class (persistent connection, keepalive, lock, heuristic termination) is replaced by a module-level `synthesize()` async generator. Each call opens a fresh WebSocket to Inworld, creates one context, sends text, flushes, reads audio with timeout-based termination, then closes. The singleton pattern is removed. Callers change from `get_tts_client().synthesize(...)` to `synthesize(...)`.

**Tech Stack:** Python asyncio, websockets library, Inworld TTS WebSocket API

**Design doc:** `docs/plans/2026-02-27-tts-pipeline-simplification-design.md`

---

### Task 1: Rewrite `core/tts/inworld_ws.py` — new stateless `synthesize()`

**Files:**
- Rewrite: `core/tts/inworld_ws.py` (entire file)

**Step 1: Replace the file contents**

Delete the entire `InworldTTSClient` class and replace with:

```python
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
import websockets.exceptions

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

        # Wait for contextCreated
        while True:
            raw = json.loads(await ws.recv())
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
                await ws.send(json.dumps({
                    "send_text": {"text": token},
                    "contextId": context_id,
                }))
                token_count += 1
                chars_sent += len(token)

            # All text sent — flush
            await ws.send(json.dumps({
                "flush_context": {},
                "contextId": context_id,
            }))
            logger.info(
                "All text sent and flushed (%s): %d tokens, %d chars",
                context_id[:8], token_count, chars_sent,
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
                    logger.warning("Safety valve: synthesis exceeded %ds", _MAX_SYNTHESIS_SECONDS)
                    break

                try:
                    raw = json.loads(await asyncio.wait_for(ws.recv(), timeout=_RECV_TIMEOUT))
                except asyncio.TimeoutError:
                    # No message for _RECV_TIMEOUT seconds
                    if send_done.is_set() and got_flush_after_send:
                        logger.info("Recv timeout after flush — synthesis complete (%s)", context_id[:8])
                        break
                    if send_done.is_set():
                        logger.debug("Recv timeout, send done but no flush yet — continuing")
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
                            chunk_count, context_id[:8], len(decoded), total_bytes,
                        )
                    yield decoded

                elif "flushCompleted" in msg:
                    if send_done.is_set():
                        got_flush_after_send = True
                        # Check silence window: if last audio was >_AUDIO_SILENCE_TIMEOUT ago, done
                        if last_audio_time and (time.monotonic() - last_audio_time) > _AUDIO_SILENCE_TIMEOUT:
                            logger.info(
                                "Flush + silence — synthesis complete (%s): %d chunks, %d bytes",
                                context_id[:8], chunk_count, total_bytes,
                            )
                            break
                    else:
                        logger.debug("Ignoring flushCompleted (send still in progress)")

                else:
                    # Ignore non-audio/non-flush messages (status, metadata, etc.)
                    logger.debug("Ignoring Inworld msg (%s): %s", context_id[:8], list(msg.keys()))

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
            context_id[:8], chunk_count, total_bytes, chars_sent,
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
```

**Step 2: Verify the file looks correct**

Run: `python -c "import ast; ast.parse(open('core/tts/inworld_ws.py').read()); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
jj describe -m "refactor: rewrite InworldTTSClient as stateless synthesize() function

Fresh WebSocket per call, timeout-based termination. Removes persistent
connection, keepalive, lock, and heuristic flush-counting termination."
```

---

### Task 2: Update `core/tts/__init__.py` — remove singleton

**Files:**
- Modify: `core/tts/__init__.py`

**Step 1: Replace the file**

```python
"""Inworld TTS streaming module.

Public API:
    synthesize() - Stateless TTS synthesis (fresh WebSocket per call)
    TTSConfig - Configuration dataclass for synthesis requests
    is_tts_available() - Check if INWORLD_API_KEY is set
    get_api_key() - Read INWORLD_API_KEY from environment
"""

from .config import TTSConfig, get_api_key, is_tts_available
from .inworld_ws import synthesize
from .sentence_buffer import QueueIterator, find_split

__all__ = [
    "QueueIterator",
    "TTSConfig",
    "find_split",
    "get_api_key",
    "is_tts_available",
    "synthesize",
]
```

Note: `InworldTTSClient`, `get_tts_client()`, and `close_tts_client()` are removed.

**Step 2: Check for other imports of removed symbols**

Run: `grep -rn "get_tts_client\|close_tts_client\|InworldTTSClient" --include="*.py" .`

Update any hits (expected: `tts_stream.py`, `roleplay_ws.py`, `test_inworld_integration.py`, `test_roleplay_ws.py`, `main.py` shutdown handler). These are handled in Tasks 3-5.

**Step 3: Commit**

```bash
jj describe -m "refactor: remove TTS singleton, export stateless synthesize()"
```

---

### Task 3: Update callers — `web_api/routes/tts_stream.py`

**Files:**
- Modify: `web_api/routes/tts_stream.py`

**Step 1: Update imports**

Change:
```python
from core.tts import (
    TTSConfig,
    QueueIterator,
    find_split,
    get_tts_client,
    get_api_key,
    is_tts_available,
)
```

To:
```python
from core.tts import (
    TTSConfig,
    QueueIterator,
    find_split,
    synthesize,
    get_api_key,
    is_tts_available,
)
```

**Step 2: Update `_handle_single_shot` (line ~128-132)**

Change:
```python
    client = get_tts_client()
    async for audio_chunk in client.synthesize(text_iter, config):
        await websocket.send_bytes(audio_chunk)
```

To:
```python
    async for audio_chunk in synthesize(text_iter, config):
        await websocket.send_bytes(audio_chunk)
```

**Step 3: Update `_handle_streaming` (line ~188-189)**

Change:
```python
        client = get_tts_client()
        async for audio_chunk in client.synthesize(queue_iter, config):
            await websocket.send_bytes(audio_chunk)
```

To:
```python
        async for audio_chunk in synthesize(queue_iter, config):
            await websocket.send_bytes(audio_chunk)
```

**Step 4: Commit**

```bash
jj describe -m "refactor: update tts_stream.py to use stateless synthesize()"
```

---

### Task 4: Update callers — `web_api/routes/roleplay_ws.py`

**Files:**
- Modify: `web_api/routes/roleplay_ws.py`

**Step 1: Update imports**

Change:
```python
from core.tts import (
    TTSConfig,
    QueueIterator,
    find_split,
    get_tts_client,
    is_tts_available,
)
```

To:
```python
from core.tts import (
    TTSConfig,
    QueueIterator,
    find_split,
    synthesize as tts_synthesize,
    is_tts_available,
)
```

(Alias to `tts_synthesize` to avoid ambiguity with the word "synthesize" in this module.)

**Step 2: Update `_handle_turn_with_tts` tts_task (around line 351-352)**

Change:
```python
            client = get_tts_client()
            async for audio_chunk in client.synthesize(queue_iter, tts_config):
```

To:
```python
            async for audio_chunk in tts_synthesize(queue_iter, tts_config):
```

**Step 3: Update `_handle_opening_message` (around line 456-457)**

Change:
```python
            client = get_tts_client()
            async for audio_chunk in client.synthesize(_single_iter(), tts_config):
```

To:
```python
            async for audio_chunk in tts_synthesize(_single_iter(), tts_config):
```

**Step 4: Commit**

```bash
jj describe -m "refactor: update roleplay_ws.py to use stateless synthesize()"
```

---

### Task 5: Update callers — `main.py` shutdown handler

**Files:**
- Modify: `main.py`

**Step 1: Find and remove the shutdown cleanup**

Search for `close_tts_client` in `main.py`. If it exists in a shutdown/lifespan handler, remove the import and the call. The stateless `synthesize()` has no global state to clean up.

If `close_tts_client` is not in `main.py`, skip this task.

**Step 2: Commit (if changes made)**

```bash
jj describe -m "chore: remove TTS client shutdown cleanup (no longer needed)"
```

---

### Task 6: Update integration tests — `core/tts/tests/test_inworld_integration.py`

**Files:**
- Modify: `core/tts/tests/test_inworld_integration.py`

**Step 1: Update imports and fixture**

Change the imports:
```python
from core.tts import InworldTTSClient, TTSConfig, is_tts_available
```
To:
```python
from core.tts import synthesize, TTSConfig, is_tts_available
```

Remove the `client` fixture entirely (no more class to instantiate).

**Step 2: Update all test functions**

Each test currently takes a `client` fixture and calls `client.synthesize(...)`. Change all to call `synthesize(...)` directly. Also remove the `client` parameter.

Example — `test_single_chunk_synthesize`:
```python
async def test_single_chunk_synthesize():
    """Send full text as one chunk, expect at least one audio chunk back."""

    async def single_chunk():
        yield SHORT_TEXT

    config = TTSConfig(audio_encoding="LINEAR16")
    chunks: list[bytes] = []

    async for audio in synthesize(single_chunk(), config):
        chunks.append(audio)

    assert len(chunks) > 0, "Expected at least one audio chunk"
    total_bytes = sum(len(c) for c in chunks)
    min_bytes = 48000 * 2 * 1  # 1 second
    assert total_bytes > min_bytes, (
        f"Audio too short: {total_bytes} bytes = {total_bytes / 2 / 48000:.2f}s "
        f"(expected >1s for '{SHORT_TEXT[:30]}...')"
    )
```

Apply the same pattern to all 5 tests:
- `test_single_chunk_synthesize` — remove `client` param, call `synthesize()`
- `test_multi_chunk_synthesize` — same
- `test_queue_iterator_synthesis` — same
- `test_multi_sentence_synthesis_complete_audio` — same
- `test_mp3_encoding` — same

**Step 3: Commit**

```bash
jj describe -m "test: update TTS integration tests for stateless synthesize()"
```

---

### Task 7: Update roleplay WS tests — `web_api/tests/test_roleplay_ws.py`

**Files:**
- Modify: `web_api/tests/test_roleplay_ws.py`

**Step 1: Update TTS integration test class**

The `TestRoleplayWSTTS` class (line 336+) uses `tts_module._client` singleton to reset state. This is no longer needed. Remove the singleton reset lines:

```python
        # These lines should be REMOVED:
        import core.tts as tts_module
        if tts_module._client is not None:
            await tts_module._client.close()
            tts_module._client = None
```

The `_handle_turn_with_tts` function now calls `synthesize()` (via `tts_synthesize`) which creates a fresh connection each time — no singleton reset needed.

If the tests mock `get_tts_client`, update the mock target:
- Change `patch("web_api.routes.roleplay_ws.get_tts_client", ...)` to `patch("web_api.routes.roleplay_ws.tts_synthesize", ...)`

Check whether any mocks reference the old API and update.

**Step 2: Run unit tests**

Run: `pytest web_api/tests/test_roleplay_ws.py -v`
Expected: All `TestRoleplayWS` tests pass (they mock LLM/DB, no TTS involved). The `TestRoleplayWSTTS` tests are skipped without INWORLD_API_KEY.

**Step 3: Commit**

```bash
jj describe -m "test: update roleplay WS tests for stateless synthesize()"
```

---

### Task 8: Run full test suite

**Step 1: Run linting**

```bash
ruff check .
ruff format --check .
```

Fix any issues.

**Step 2: Run all unit tests**

```bash
pytest -v
```

Expected: All tests pass (TTS integration tests skipped without API key).

**Step 3: Run integration tests (requires INWORLD_API_KEY)**

```bash
pytest core/tts/tests/test_inworld_integration.py -v
```

The critical test: `test_multi_sentence_synthesis_complete_audio` — this is the 8-sentence test that previously failed due to premature termination. It should now produce ≥15s of audio.

**Step 4: Commit any fixes**

---

### Task 9: Manual E2E verification with test harness

**Step 1: Start the dev server**

```bash
python main.py --dev --port 8300
# In another terminal:
cd web_frontend && npm run dev
```

**Step 2: Open the TTS test page**

Navigate to `http://dev.vps:3300/tts-test`

**Step 3: Test direct TTS**

- Enter 2-3 sentences of text
- Click "Speak" with streaming mode
- Verify all audio plays to completion
- Check event log for "synthesis complete (done=true)"

**Step 4: Test E2E roleplay**

- Open "E2E Roleplay Test" section
- Send a message like "Tell me about AI alignment in detail"
- Verify:
  - Full text response appears
  - Audio plays for the entire response (not just first few sentences)
  - Event log shows "Turn done" with reasonable audio bytes/chunks
  - Latency breakdown looks sensible

**Step 5: Final commit if needed**

```bash
jj describe -m "feat: TTS pipeline simplification — fresh WS per synthesis

Replaces persistent InworldTTSClient (345 lines, heuristic termination)
with stateless synthesize() function (~100 lines, timeout termination).

Fixes: audio cutoff in E2E roleplay (root cause: cross-context message
pollution from keepalive + premature break on non-audio messages)."
```
