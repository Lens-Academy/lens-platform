---
phase: 09-tts-pipeline
plan: 01
subsystem: api
tags: [websocket, tts, inworld, streaming, audio, fastapi]

# Dependency graph
requires:
  - phase: 08-foundation
    provides: "Chat session model, roleplay prompt assembly"
provides:
  - "core/tts/ module with InworldTTSClient for persistent WebSocket TTS"
  - "TTSConfig dataclass for synthesis configuration"
  - "Singleton TTS client management (get_tts_client / close_tts_client)"
  - "/ws/tts FastAPI WebSocket endpoint for browser audio streaming"
affects: [09-02-PLAN, phase-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Persistent WebSocket client with asyncio.Lock serialization"
    - "Async generator pipeline: text chunks -> audio chunks"
    - "Binary WebSocket frames for audio transport to browser"
    - "Singleton pattern with lazy init and shutdown cleanup"

key-files:
  created:
    - core/tts/__init__.py
    - core/tts/config.py
    - core/tts/inworld_ws.py
    - web_api/routes/tts_stream.py
  modified:
    - main.py

key-decisions:
  - "Single-synthesis-at-a-time via asyncio.Lock (Phase 10 may add concurrent dispatch)"
  - "Full text as single chunk for Phase 9 test harness (Phase 10 provides LLM token stream)"
  - "MP3 encoding at 48kHz/128kbps for browser Web Audio API compatibility"
  - "Graceful degradation: missing INWORLD_API_KEY disables TTS, does not crash"

patterns-established:
  - "Inworld WebSocket protocol: create context -> send text -> flush -> receive audio -> close context"
  - "Binary WebSocket frames for audio streaming to browser (not base64 over SSE)"
  - "TTS client lifecycle tied to app lifespan (close_tts_client in shutdown)"

# Metrics
duration: 2min
completed: 2026-02-25
---

# Phase 9 Plan 01: Backend TTS Pipeline Summary

**Inworld WebSocket TTS client with persistent connection, async generator synthesize(), and /ws/tts FastAPI WebSocket endpoint for streaming MP3 audio to browser**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-25T09:59:29Z
- **Completed:** 2026-02-25T10:02:13Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- core/tts/ module with InworldTTSClient that connects to Inworld WebSocket, streams text in / audio out
- TTSConfig dataclass with voice, model, encoding, and buffering defaults
- /ws/tts WebSocket endpoint accepting text + voice, streaming binary MP3 frames
- Singleton TTS client with lifecycle management and shutdown cleanup in main.py
- Graceful degradation when INWORLD_API_KEY is not set

## Task Commits

Each task was committed atomically:

1. **Task 1: Create core/tts/ module** - `dd7fa22` (feat)
2. **Task 2: Create FastAPI WebSocket endpoint and register in main.py** - `0d94f97` (feat)

## Files Created/Modified
- `core/tts/__init__.py` - Public API: InworldTTSClient, TTSConfig, get_tts_client, close_tts_client
- `core/tts/config.py` - TTSConfig dataclass, INWORLD_WS_URL constant, get_api_key/is_tts_available
- `core/tts/inworld_ws.py` - Persistent Inworld WebSocket client with synthesize() async generator
- `web_api/routes/tts_stream.py` - FastAPI WebSocket endpoint /ws/tts for browser audio streaming
- `main.py` - Router registration and TTS client shutdown cleanup

## Decisions Made
- Single-synthesis-at-a-time via asyncio.Lock -- Phase 10 may add a message dispatch layer for concurrent synthesis
- Full text sent as single chunk for Phase 9 test harness -- Phase 10 will provide actual LLM token stream
- MP3 at 48kHz/128kbps chosen for browser Web Audio API compatibility and low bandwidth
- Missing INWORLD_API_KEY gracefully disables TTS rather than crashing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added TTS client shutdown cleanup to main.py lifespan**
- **Found during:** Task 2 (registering router in main.py)
- **Issue:** Plan specified registering the router but not adding shutdown cleanup for the TTS WebSocket connection
- **Fix:** Added `close_tts_client()` call in main.py lifespan shutdown section
- **Files modified:** main.py
- **Verification:** ruff check passes, import resolves
- **Committed in:** 0d94f97 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for clean shutdown. No scope creep.

## Issues Encountered
None

## User Setup Required

**External services require manual configuration.** INWORLD_API_KEY environment variable needed for TTS functionality:
- Source: Inworld Portal (https://studio.inworld.ai/) -> Account Settings -> API Keys
- Add to `.env.local`: `INWORLD_API_KEY=your_key_here`
- Verification: `python -c "from core.tts import is_tts_available; print(is_tts_available())"`
- Without the key, TTS gracefully disables (no crash)

## Next Phase Readiness
- core/tts/ module ready for Phase 9 Plan 02 (browser audio playback integration)
- /ws/tts endpoint ready to be connected to frontend WebSocket client
- Phase 10 can replace single-chunk text iterator with LLM token stream

## Self-Check: PASSED

All 4 created files verified on disk. Both commit hashes (dd7fa22, 0d94f97) verified in jj log.

---
*Phase: 09-tts-pipeline*
*Completed: 2026-02-25*
