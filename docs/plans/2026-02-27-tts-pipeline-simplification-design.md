# TTS Pipeline Simplification Design

## Problem

The E2E roleplay test consistently produces partial audio: the LLM completes and all text arrives, but audio cuts off partway through the response.

**Root cause**: The Inworld WebSocket termination detection in `core/tts/inworld_ws.py:292-306` breaks prematurely. After the explicit flush and at least one `flushCompleted`, any non-audio/non-flush message (status, metadata, or a response to the keepalive context) triggers an early break, cutting off remaining audio.

**Deeper issue**: The persistent WebSocket architecture multiplexes messages from multiple contexts (synthesis + keepalive) on one connection, and the termination heuristic guesses when synthesis is complete based on `flushCompleted` patterns that can't distinguish auto-flushes from explicit flushes.

## Approach: Fresh Connection + Timeout Termination

Replace the persistent `InworldTTSClient` (345 lines, complex state machine) with a stateless `synthesize()` function that creates a fresh WebSocket per call (~80 lines).

### What Changes

**`core/tts/inworld_ws.py`** - Complete rewrite:
- `InworldTTSClient` class becomes a simple `synthesize()` async generator function
- Each call opens a fresh WebSocket to Inworld
- Creates one context, sends text, flushes, reads audio, closes
- Termination: after explicit flush + at least one `flushCompleted`, if no audio chunk arrives for 1 second, synthesis is done
- No persistent connection, no keepalive, no lock, no reconnection logic

**`core/tts/__init__.py`** - Simplify exports:
- Remove `_client` singleton, `get_tts_client()`, `close_tts_client()`
- Export the `synthesize()` function directly

**`core/tts/config.py`** - No changes. `TTSConfig` stays as-is with `auto_mode=True`.

**`core/tts/sentence_buffer.py`** - No changes. `find_split()` and `QueueIterator` stay.

**`web_api/routes/tts_stream.py`** - Update callers:
- Replace `get_tts_client()` + `client.synthesize(...)` with `synthesize(...)` direct call

**`web_api/routes/roleplay_ws.py`** - Update callers:
- Same caller change as above

**Frontend** - No changes. Same WebSocket protocol, same binary audio chunks.

### What Gets Removed

| Component | Lines | Why |
|-----------|-------|-----|
| `_ws` persistent connection | ~20 | Fresh connection per call |
| `_lock` (asyncio.Lock) | ~10 | No shared state to protect |
| `_keepalive_loop()` | ~20 | No persistent connection to keep alive |
| `_ensure_connected()` | ~25 | Connection created inline |
| `_synthesize_locked()` | ~20 | No lock wrapper needed |
| Heuristic termination (flush counting, early-break) | ~60 | Replaced by simple timeout |
| Connection retry logic | ~15 | Fresh connection per call, no retry needed |
| Singleton (`get_tts_client`, `close_tts_client`) | ~25 | Stateless function |

**Estimated**: ~150 lines removed, ~80 lines added. Net reduction ~70 lines.

### New `synthesize()` Pseudocode

```python
async def synthesize(
    text_chunks: AsyncIterator[str],
    config: TTSConfig | None = None,
) -> AsyncIterator[bytes]:
    config = config or TTSConfig()
    context_id = str(uuid4())

    # 1. Fresh connection
    ws = await websockets.connect(INWORLD_WS_URL, headers=auth_headers())

    try:
        # 2. Create context
        await ws.send(json.dumps({"create": {...}, "contextId": context_id}))
        await wait_for_context_created(ws, context_id)

        # 3. Background task: send text chunks + flush
        send_done = asyncio.Event()
        send_task = asyncio.create_task(send_text_and_flush(ws, text_chunks, context_id, send_done))

        # 4. Read audio until done
        last_audio_time = None
        got_flush_after_send = False

        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            except asyncio.TimeoutError:
                if send_done.is_set() and got_flush_after_send:
                    break  # No data for 2s after flush → done
                continue

            msg = json.loads(raw).get("result", {})

            if "audioChunk" in msg:
                yield base64.b64decode(msg["audioChunk"]["audioContent"])
                last_audio_time = time.monotonic()
            elif "flushCompleted" in msg and send_done.is_set():
                got_flush_after_send = True
                # Check: has 1s passed since last audio chunk?
                if last_audio_time and (time.monotonic() - last_audio_time) > 1.0:
                    break

        await send_task
    finally:
        # 5. Close context + connection
        try:
            await ws.send(json.dumps({"close_context": {}, "contextId": context_id}))
        except Exception:
            pass
        await ws.close()
```

### Termination Strategy

After the send task completes (all text sent + explicit `flush_context`):
1. Keep reading messages from the WebSocket
2. Yield any `audioChunk` data
3. On `flushCompleted`: check if it's been >1s since the last audio chunk. If yes, we're done.
4. On recv timeout (2s with no messages at all): if we've seen at least one post-send flush, we're done.
5. Safety valve: break after 30 seconds regardless (prevents infinite hang).

The 1-second tail latency is acceptable for roleplay. With a fresh WebSocket (no cross-context noise), false termination is eliminated.

### Trade-offs

| | Current | Proposed |
|---|---------|----------|
| Connection overhead | Zero (persistent) | ~100-200ms per turn (hidden by LLM latency) |
| Termination | Heuristic (buggy) | Timeout (reliable, +1s tail) |
| Code complexity | High (345 lines, state machine) | Low (~80 lines, stateless) |
| Concurrent synthesis | Serialized via lock | Naturally parallel (separate connections) |
| Cross-context pollution | Possible (keepalive) | Impossible (isolated connection) |

## Non-Goals

- Changing the sentence buffer (`find_split`) - it works well
- Changing the frontend audio playback (`useAudioPlayback`) - it works well
- Changing the WebSocket protocol between backend and browser
- Switching TTS providers
- Adding support for concurrent synthesis (not needed for roleplay)
