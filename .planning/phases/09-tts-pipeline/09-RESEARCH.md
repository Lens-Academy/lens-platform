# Phase 9: TTS Pipeline - Research

**Researched:** 2026-02-25
**Domain:** Inworld TTS WebSocket integration, streaming audio pipeline, browser audio playback
**Confidence:** MEDIUM (Inworld API docs are behind a login portal; protocol details reconstructed from pipecat/LiveKit open-source implementations and partial doc fetches)

## Summary

Phase 9 builds a streaming TTS pipeline: LLM text tokens flow from the backend to Inworld TTS via WebSocket, audio chunks flow back, and the backend streams those chunks to the browser for real-time playback. The architecture has three segments: (1) backend Inworld WebSocket client, (2) backend-to-browser audio transport, (3) browser audio playback.

Inworld provides both REST and WebSocket APIs. The WebSocket API (`wss://api.inworld.ai/tts/v1/voice:streamBidirectional`) is the correct choice because it maintains a persistent connection, supports incremental text sending (ideal for LLM token streaming), and has smart buffering that automatically flushes text into audio chunks. The REST streaming endpoint (`POST /tts/v1/voice:stream`) is also viable for simpler cases but requires a new HTTP request per synthesis, making it unsuitable for token-by-token LLM streaming.

For backend-to-browser transport, a **FastAPI WebSocket endpoint** is the right choice over SSE. The existing chat uses SSE for text streaming, but audio requires binary data at high throughput. A WebSocket carries base64-encoded audio chunks (or raw binary frames) with lower overhead than SSE's text-based protocol. The browser plays audio using the Web Audio API's `AudioContext` + `AudioBufferSourceNode` scheduling pattern for seamless gapless playback.

**Primary recommendation:** Use `websockets` library (already installed at v16.0) for the backend Inworld connection, a new FastAPI WebSocket endpoint for browser transport, and Web Audio API `decodeAudioData` + scheduled `AudioBufferSourceNode` for browser playback. Use MP3 encoding (not PCM) to minimize bandwidth and simplify browser decoding.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `websockets` | 16.0 | Async WebSocket client to Inworld TTS | Already installed, pure asyncio, used by pipecat/LiveKit for same purpose |
| FastAPI WebSocket | (built-in) | Backend-to-browser audio streaming | Built into FastAPI/Starlette, no additional deps |
| Web Audio API | (browser built-in) | Client-side audio decoding and playback | Universal browser support, precise scheduling |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `httpx` | (already installed) | REST TTS fallback / voice listing / health checks | Non-streaming TTS calls, listing available voices |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| WebSocket (backend-to-browser) | SSE with base64 audio | SSE works but has higher overhead for binary data; WebSocket is more natural for bidirectional audio and carries binary frames natively |
| Web Audio API | MediaSource Extensions (MSE) | MSE is designed for media segment appending but has codec container requirements that add complexity; Web Audio API decodeAudioData is simpler for our chunk sizes |
| MP3 encoding | LINEAR16 (PCM) | PCM is lower latency but 10x bandwidth; MP3 at 48kHz/128kbps is well-supported by decodeAudioData and much smaller |

**Installation:**
```bash
# No new packages needed. websockets 16.0 already installed.
# FastAPI WebSocket support is built into uvicorn[standard].
```

## Architecture Patterns

### Recommended Project Structure
```
core/
  tts/
    __init__.py          # Public API: stream_tts(), get_voices()
    inworld_ws.py        # Inworld WebSocket client (persistent connection, context mgmt)
    config.py            # TTS configuration (voice, model, encoding, buffering)
web_api/
  routes/
    tts_stream.py        # FastAPI WebSocket endpoint for browser audio streaming
web_frontend/
  src/
    hooks/
      useAudioPlayback.ts  # Web Audio API hook for streaming audio chunk playback
```

### Pattern 1: Inworld WebSocket Client (Persistent Connection)
**What:** A singleton async WebSocket client that maintains a persistent connection to Inworld, creates contexts per synthesis request, and streams text tokens in, audio chunks out.
**When to use:** Every TTS synthesis request reuses this connection.
**Example:**
```python
# Source: Reconstructed from pipecat InworldTTSService source code
# (https://reference-server.pipecat.ai/en/latest/_modules/pipecat/services/inworld/tts.html)

import asyncio
import base64
import json
import os
from typing import AsyncIterator
from websockets.asyncio.client import connect

INWORLD_WS_URL = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional"

class InworldTTSClient:
    """Persistent WebSocket connection to Inworld TTS."""

    def __init__(self):
        self._ws = None
        self._lock = asyncio.Lock()

    async def _ensure_connected(self):
        """Connect or reconnect to Inworld WebSocket."""
        if self._ws is None or self._ws.close_code is not None:
            api_key = os.environ["INWORLD_API_KEY"]
            self._ws = await connect(
                INWORLD_WS_URL,
                additional_headers={
                    "Authorization": f"Basic {api_key}",
                },
            )

    async def synthesize(
        self,
        text_chunks: AsyncIterator[str],
        voice_id: str = "Ashley",
        model_id: str = "inworld-tts-1.5-mini",
        context_id: str = "ctx-1",
    ) -> AsyncIterator[bytes]:
        """Stream text tokens in, yield audio chunks out.

        Args:
            text_chunks: Async iterator of text tokens from LLM
            voice_id: Inworld voice ID
            model_id: Inworld model ID
            context_id: Unique context for this synthesis

        Yields:
            Raw audio bytes (MP3 chunks, base64-decoded)
        """
        async with self._lock:
            await self._ensure_connected()

        # 1. Create context
        create_msg = {
            "create": {
                "voiceId": voice_id,
                "modelId": model_id,
                "audioConfig": {
                    "audioEncoding": "MP3",
                    "sampleRateHertz": 48000,
                    "bitRate": 128000,
                },
                "bufferCharThreshold": 250,
                "maxBufferDelayMs": 3000,
                "autoMode": True,
            },
            "contextId": context_id,
        }
        await self._ws.send(json.dumps(create_msg))

        # Wait for contextCreated confirmation
        while True:
            msg = json.loads(await self._ws.recv())
            if "contextCreated" in msg:
                break

        # 2. Stream text tokens to Inworld
        async def send_text():
            async for token in text_chunks:
                send_msg = {
                    "send_text": {"text": token},
                    "contextId": context_id,
                }
                await self._ws.send(json.dumps(send_msg))
            # All text sent, flush remaining buffer
            await self._ws.send(json.dumps({
                "flush_context": {},
                "contextId": context_id,
            }))

        send_task = asyncio.create_task(send_text())

        # 3. Receive audio chunks until flushCompleted
        try:
            while True:
                msg = json.loads(await self._ws.recv())
                if "audioChunk" in msg:
                    audio_b64 = msg["audioChunk"]["audioContent"]
                    yield base64.b64decode(audio_b64)
                elif "flushCompleted" in msg:
                    break
        finally:
            await send_task
            # Close context
            await self._ws.send(json.dumps({
                "close_context": {},
                "contextId": context_id,
            }))
```

### Pattern 2: FastAPI WebSocket for Audio Streaming to Browser
**What:** A WebSocket endpoint that accepts a TTS request, coordinates with the Inworld client, and forwards audio chunks to the browser as binary frames.
**When to use:** When the frontend requests TTS for a roleplay response.
**Example:**
```python
# Source: Standard FastAPI WebSocket pattern
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json

router = APIRouter(tags=["tts"])

@router.websocket("/ws/tts")
async def tts_stream(websocket: WebSocket):
    """Stream TTS audio to browser via WebSocket.

    Protocol:
    1. Client sends JSON: {"text": "...", "voice": "Ashley"}
       or {"text_stream": true} to indicate streaming mode
    2. Server sends binary frames (MP3 audio chunks)
    3. Server sends JSON: {"done": true} when complete
    """
    await websocket.accept()
    try:
        # Receive request
        data = await websocket.receive_json()
        text = data.get("text", "")
        voice = data.get("voice", "Ashley")

        # Synthesize and stream
        async for audio_chunk in tts_client.synthesize(
            text_chunks=iter_text(text),
            voice_id=voice,
        ):
            await websocket.send_bytes(audio_chunk)

        # Signal completion
        await websocket.send_json({"done": True})
    except WebSocketDisconnect:
        pass
```

### Pattern 3: Browser Audio Playback (Web Audio API Scheduling)
**What:** Queue-based audio playback that schedules `AudioBufferSourceNode` instances for gapless playback of streaming MP3 chunks.
**When to use:** Playing TTS audio as chunks arrive from WebSocket.
**Example:**
```typescript
// Source: Web Audio API MDN + community patterns for chunk scheduling

class StreamingAudioPlayer {
  private ctx: AudioContext;
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;

  constructor() {
    this.ctx = new AudioContext();
  }

  async playChunk(mp3Bytes: ArrayBuffer): Promise<void> {
    // Decode MP3 chunk to AudioBuffer
    const audioBuffer = await this.ctx.decodeAudioData(mp3Bytes);

    // Create source node (one-shot, cannot be reused)
    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    // Schedule playback: either now or after previous chunk
    const now = this.ctx.currentTime;
    const startTime = Math.max(this.nextStartTime, now);
    source.start(startTime);

    // Update next start time for gapless playback
    this.nextStartTime = startTime + audioBuffer.duration;
    this.isPlaying = true;
  }

  stop(): void {
    this.ctx.close();
    this.isPlaying = false;
  }
}
```

### Pattern 4: End-to-End Pipeline (LLM -> Inworld -> Browser)
**What:** The full pipeline connecting LLM text streaming to browser audio playback.
**When to use:** When a roleplay message arrives and voice mode is enabled.
**Flow:**
```
1. Frontend sends roleplay message via existing SSE chat endpoint
2. Backend streams LLM text response via SSE (text appears on screen)
3. Simultaneously, backend tees text tokens to Inworld TTS WebSocket
4. Inworld returns audio chunks
5. Backend forwards audio chunks to browser via separate WebSocket
6. Browser plays audio chunks via Web Audio API while text streams

Two parallel channels:
  SSE:       text tokens -> frontend renders text
  WebSocket: audio chunks -> frontend plays audio
```

### Anti-Patterns to Avoid
- **Single-channel transport:** Do NOT try to multiplex text and audio on the same SSE connection. Base64-encoding audio into SSE events wastes bandwidth and adds latency. Use two channels: SSE for text, WebSocket for audio.
- **Waiting for full audio:** Do NOT buffer all audio before sending to browser. The whole point of the WebSocket pipeline is streaming. Send each chunk as it arrives from Inworld.
- **PCM audio over the network:** Do NOT use LINEAR16 encoding for browser transport. PCM is 10x the bandwidth of MP3. Use MP3 or OGG_OPUS for compressed streaming.
- **New HTTP request per sentence:** Do NOT use the REST endpoint for token-by-token streaming. The WebSocket API exists specifically for this use case.
- **Browser-direct Inworld connection:** The requirements explicitly state backend mediates all TTS traffic. API keys must never reach the browser.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio chunk scheduling | Custom timing logic with setTimeout | Web Audio API `AudioBufferSourceNode.start(when)` | Browser's audio clock is sample-accurate; JS timers are not |
| WebSocket reconnection | Manual retry loops | `websockets` library with reconnect wrapper or simple try/reconnect | The library handles protocol-level details |
| MP3 decoding in browser | JS MP3 decoder library | `AudioContext.decodeAudioData()` | Built into every browser, hardware-accelerated |
| Audio format conversion | Server-side ffmpeg | Request MP3 directly from Inworld API | Inworld supports MP3 natively, no conversion needed |
| Connection keepalive | Custom ping logic | Inworld WebSocket keepalive (send empty text every 60s, per pipecat impl) | Server expects this pattern |

**Key insight:** The browser's Web Audio API and Inworld's WebSocket API handle the hard parts (audio scheduling, buffering, format encoding). The backend is a thin relay that connects LLM output to Inworld input and Inworld output to browser input.

## Common Pitfalls

### Pitfall 1: AudioContext Autoplay Policy
**What goes wrong:** `AudioContext` is created but stays in "suspended" state because the browser requires a user gesture to start audio.
**Why it happens:** Modern browsers block audio autoplay. Creating an AudioContext without a user click leaves it suspended.
**How to avoid:** Create or resume `AudioContext` inside a click/tap event handler. The "Start Conversation" or first message send button is the natural place.
**Warning signs:** Audio chunks decode successfully but no sound plays. `ctx.state === "suspended"`.

### Pitfall 2: MP3 Chunk Boundary Artifacts
**What goes wrong:** Clicks or gaps between sequential MP3 chunks during playback.
**Why it happens:** `decodeAudioData` resamples each chunk independently, and MP3 frames at chunk boundaries may not align perfectly.
**How to avoid:** Use adequately sized chunks (Inworld's buffer threshold of 250 chars / 3000ms delay produces reasonable chunk sizes). Overlap scheduling slightly. The `autoMode: true` setting on Inworld contexts produces sentence-level chunks which decode cleanly.
**Warning signs:** Audible clicks between sentences or words.

### Pitfall 3: WebSocket Connection Lifetime
**What goes wrong:** The Inworld WebSocket connection drops after idle periods, and the next TTS request fails.
**Why it happens:** WebSocket connections are not indefinitely persistent. Network timeouts, server-side limits (20 concurrent connections, 5 contexts per connection).
**How to avoid:** Implement keepalive (send empty text every 60 seconds per pipecat pattern). Implement reconnect-on-failure. Check connection state before each synthesis.
**Warning signs:** Sporadic "connection closed" errors, especially after pauses in conversation.

### Pitfall 4: Race Condition Between Text and Audio Channels
**What goes wrong:** Text appears on screen significantly before audio starts, or audio plays for text that has already scrolled past.
**Why it happens:** SSE text delivery is near-instant; TTS has 120-200ms TTFA (time-to-first-audio) plus encoding/decoding time.
**How to avoid:** Accept some latency gap -- text will always lead audio slightly. Do NOT delay text to sync with audio (that defeats the purpose of text streaming). The UX should feel like "reading subtitles slightly ahead of speech."
**Warning signs:** Users confused about which text is being spoken.

### Pitfall 5: Memory Leaks from AudioBufferSourceNodes
**What goes wrong:** Browser memory grows during long conversations.
**Why it happens:** Each chunk creates a new `AudioBufferSourceNode` and decoded `AudioBuffer`. If not garbage collected, memory accumulates.
**How to avoid:** Let source nodes disconnect and go out of scope after playback completes. Use `source.onended` callback to clean up references. Do NOT keep arrays of all decoded buffers.
**Warning signs:** Page becomes sluggish after 20+ messages in voice mode.

### Pitfall 6: Forgetting to Flush After LLM Stream Ends
**What goes wrong:** The last sentence of TTS audio never plays.
**Why it happens:** Inworld buffers text until a threshold is reached. If the LLM stream ends with a short final sentence, it sits in the buffer unflushed.
**How to avoid:** ALWAYS send `flush_context` after the last text token. The pipecat implementation does this, and our code must too.
**Warning signs:** Last few words of AI response are silent.

## Code Examples

### Inworld REST API (for voice listing and health checks)
```python
# Source: https://docs.inworld.ai/docs/quickstart-tts (verified via WebFetch)
import httpx
import os

async def list_voices(language: str = "en") -> list[dict]:
    """List available Inworld TTS voices."""
    api_key = os.environ["INWORLD_API_KEY"]
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.inworld.ai/tts/v1/voices",
            params={"language": language},
            headers={"Authorization": f"Basic {api_key}"},
        )
        resp.raise_for_status()
        return resp.json().get("voices", [])
```

### Inworld WebSocket Message Protocol
```python
# Source: Reconstructed from pipecat source + Inworld blog
# (https://inworld.ai/blog/tts-custom-pronunciation-timestamps-websockets)

# 1. Create context
{"create": {
    "voiceId": "Ashley",
    "modelId": "inworld-tts-1.5-mini",
    "audioConfig": {
        "audioEncoding": "MP3",
        "sampleRateHertz": 48000,
        "bitRate": 128000
    },
    "bufferCharThreshold": 250,
    "maxBufferDelayMs": 3000,
    "autoMode": True
}, "contextId": "ctx-1"}

# Response: {"contextCreated": {...}, "contextId": "ctx-1"}

# 2. Send text tokens (call repeatedly as LLM streams)
{"send_text": {"text": "Hello, "}, "contextId": "ctx-1"}
{"send_text": {"text": "how are "}, "contextId": "ctx-1"}
{"send_text": {"text": "you today?"}, "contextId": "ctx-1"}

# 3. Flush remaining buffer
{"flush_context": {}, "contextId": "ctx-1"}

# Audio responses (interleaved with sends):
{"audioChunk": {
    "audioContent": "<base64-encoded-mp3>",
    "usage": {"processedCharactersCount": 42, "modelId": "inworld-tts-1.5-mini"},
    "timestampInfo": {"wordAlignment": {...}}
}, "contextId": "ctx-1"}

# End signal:
{"flushCompleted": {}, "contextId": "ctx-1"}

# 4. Close context
{"close_context": {}, "contextId": "ctx-1"}
# Response: {"contextClosed": {}, "contextId": "ctx-1"}
```

### Browser WebSocket + Web Audio API Integration
```typescript
// Source: Web Audio API MDN + FastAPI WebSocket patterns

function connectTTSWebSocket(
  text: string,
  voice: string,
  onAudioChunk: (buffer: AudioBuffer) => void,
  onDone: () => void
): WebSocket {
  const ws = new WebSocket(`ws://${location.host}/ws/tts`);
  const audioCtx = new AudioContext();

  ws.onopen = () => {
    ws.send(JSON.stringify({ text, voice }));
  };

  ws.onmessage = async (event) => {
    if (event.data instanceof Blob) {
      // Binary frame = audio chunk
      const arrayBuffer = await event.data.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      onAudioChunk(audioBuffer);
    } else {
      // JSON frame = control message
      const msg = JSON.parse(event.data);
      if (msg.done) onDone();
    }
  };

  return ws;
}
```

### Keepalive Pattern
```python
# Source: pipecat InworldTTSService._keepalive_task_handler
async def keepalive_loop(ws):
    """Send keepalive every 60 seconds to prevent connection timeout."""
    while True:
        try:
            await asyncio.sleep(60)
            await ws.send(json.dumps({
                "send_text": {"text": ""},
                "contextId": "keepalive",
            }))
        except Exception:
            break  # Connection lost, will reconnect on next use
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| REST-only TTS (one request per utterance) | WebSocket streaming TTS (persistent connection, incremental text) | Nov 2025 (Inworld blog) | Enables LLM token-by-token streaming to TTS |
| Inworld TTS-1 | Inworld TTS-1.5 (Max and Mini) | Late 2025 | 30% more expressive, 40% lower word error rate, <130ms TTFA for Mini |
| HTML5 Audio element for playback | Web Audio API scheduling | Long established | Enables gapless chunk playback without full audio buffering |

**Deprecated/outdated:**
- `inworld-tts-1` and `inworld-tts-1-max`: Previous generation models. Still functional but TTS-1.5 variants are strictly better in quality and latency.

## Open Questions

1. **Inworld API Key Provisioning**
   - What we know: Authentication uses `Basic {base64_key}` header. Key is obtained from Inworld Portal.
   - What's unclear: Whether the user already has an Inworld API key, and what the free tier limits are.
   - Recommendation: Add `INWORLD_API_KEY` to `.env` configuration. The test harness should validate the key on startup. If no key is set, voice mode should gracefully disable rather than error.

2. **Optimal Audio Encoding for Browser Streaming**
   - What we know: Inworld supports MP3, LINEAR16, OGG_OPUS, ALAW, MULAW, FLAC. Browser `decodeAudioData` supports MP3, AAC, OGG, WAV, FLAC.
   - What's unclear: Whether MP3 chunk boundaries cause audible artifacts with `decodeAudioData`, or if OGG_OPUS would be cleaner.
   - Recommendation: Start with MP3 (widest browser support, good compression). If artifacts appear, test OGG_OPUS as alternative. The encoding is a config value, easy to change.

3. **Concurrent Voice Sessions**
   - What we know: Inworld allows 20 concurrent connections, 5 contexts per connection.
   - What's unclear: Whether we need one connection per user or can multiplex users on one connection with different context IDs.
   - Recommendation: For Phase 9 test harness, use one connection with one context. In Phase 10, evaluate whether a connection pool is needed based on expected concurrent users.

4. **Text Chunking Strategy from LLM**
   - What we know: LLM streams individual tokens (words or sub-words). Inworld's `autoMode` buffers text and flushes at sentence boundaries.
   - What's unclear: Whether sending every individual token is optimal, or if we should batch tokens into small groups before sending to Inworld.
   - Recommendation: Send tokens individually with `autoMode: true` on the Inworld context. Inworld's smart buffering handles sentence detection. This is what pipecat and LiveKit do.

## Sources

### Primary (HIGH confidence)
- Pipecat InworldTTSService source code (https://reference-server.pipecat.ai/en/latest/_modules/pipecat/services/inworld/tts.html) -- Full Python WebSocket implementation with all message formats
- Inworld REST API reference (https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech) -- Verified endpoint URL, auth, request/response schema
- Inworld Developer Quickstart (https://docs.inworld.ai/docs/quickstart-tts) -- Verified Python code example, auth pattern
- LiveKit Inworld TTS plugin docs (https://docs.livekit.io/agents/integrations/tts/inworld/) -- Voice defaults, model IDs, config params

### Secondary (MEDIUM confidence)
- Inworld TTS blog post on WebSocket feature (https://inworld.ai/blog/tts-custom-pronunciation-timestamps-websockets) -- WebSocket launch date (Nov 2025), feature overview
- Inworld TTS models page (https://docs.inworld.ai/docs/tts/tts-models) -- Model IDs confirmed: `inworld-tts-1.5-max`, `inworld-tts-1.5-mini`
- LiveKit plugins-inworld PyPI (https://pypi.org/project/livekit-plugins-inworld/) -- Streaming API pattern, config options

### Tertiary (LOW confidence)
- Web Audio API chunk playback patterns -- Assembled from MDN docs and community articles, not a single authoritative streaming-specific guide. The scheduling approach is well-established but exact MP3 chunk behavior needs validation.

## Metadata

**Confidence breakdown:**
- Inworld API protocol: MEDIUM-HIGH -- Reconstructed from pipecat open source (HIGH) and partial doc fetches (MEDIUM). The pipecat implementation is a production-grade reference.
- Backend architecture: HIGH -- Uses existing FastAPI patterns, `websockets` library already installed, standard async Python.
- Browser playback: MEDIUM -- Web Audio API is well-documented, but streaming MP3 chunk playback has edge cases around chunk boundaries that need testing.
- End-to-end pipeline: MEDIUM -- The dual-channel (SSE for text + WebSocket for audio) pattern is architecturally sound but has timing coordination subtleties.

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (Inworld API is actively evolving; recheck before Phase 10)
