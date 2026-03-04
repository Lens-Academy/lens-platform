---
phase: 10-core-conversation
plan: 02
subsystem: ui
tags: [react, hooks, sse, tts, websocket, localstorage, streaming]

# Dependency graph
requires:
  - phase: 08-foundation
    provides: "RoleplaySegment type, content parsing, session isolation schema"
  - phase: 09-tts-pipeline
    provides: "useAudioPlayback hook, /ws/tts WebSocket endpoint"
  - phase: 10-core-conversation (plan 01)
    provides: "Backend roleplay API routes, completed_at column"
provides:
  - "Roleplay API client (sendRoleplayMessage SSE, getRoleplayHistory, completeRoleplay, retryRoleplay)"
  - "extractCharacterName utility for parsing character names from ai-instructions"
  - "useRoleplaySession hook for isolated session state management with streaming"
  - "useRoleplayToggles hook for three-toggle localStorage persistence"
  - "useRoleplayTTS hook for buffered TTS coordination via useAudioPlayback"
affects: [10-core-conversation plan 03, 10-core-conversation plan 04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Isolated roleplay state management (separate from Module.tsx shared chat state)"
    - "Buffered TTS pattern: send full text to /ws/tts after LLM response completes"
    - "localStorage toggle persistence keyed by roleplay_id"
    - "SSE async generator pattern for roleplay streaming (same as sendMessage in modules.ts)"

key-files:
  created:
    - web_frontend/src/api/roleplay.ts
    - web_frontend/src/utils/extractCharacterName.ts
    - web_frontend/src/hooks/useRoleplaySession.ts
    - web_frontend/src/hooks/useRoleplayToggles.ts
    - web_frontend/src/hooks/useRoleplayTTS.ts
  modified: []

key-decisions:
  - "Character name extraction done on frontend via regex, not backend -- display-only concern"
  - "Buffered TTS: full text sent after LLM response completes, not streaming TTS"
  - "Default voice hardcoded to Ashley for Phase 10"
  - "Toggle defaults: text display ON, TTS OFF, text input mode"

patterns-established:
  - "useRoleplaySession: isolated state per roleplay segment, prevents cross-contamination with tutor chat"
  - "sendRoleplayMessage: async generator yielding SSE events, same pattern as modules.ts sendMessage"
  - "useRoleplayTTS: buffered TTS via WebSocket after LLM response, with AudioContext resume on user gesture"
  - "useRoleplayToggles: localStorage persistence with merge-with-defaults pattern for forward compatibility"

# Metrics
duration: 10min
completed: 2026-02-25
---

# Phase 10 Plan 02: Frontend Roleplay Infrastructure Summary

**Roleplay API client with SSE streaming, three React hooks for session management/toggles/TTS, and character name extraction utility**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-25T18:39:40Z
- **Completed:** 2026-02-25T18:50:09Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments

- API client with 4 functions matching all backend roleplay endpoints (SSE streaming, history, complete, retry)
- useRoleplaySession hook with fully isolated state management: messages, pendingMessage, streamingContent, isLoading, isCompleted, sessionId, lastAssistantResponse
- useRoleplayToggles hook with three independent toggles persisted in localStorage per roleplay_id
- useRoleplayTTS hook coordinating buffered TTS via useAudioPlayback with WebSocket cleanup
- extractCharacterName utility parsing "You are [Name]" and "Character: [Name]" patterns with fallback

## Task Commits

Each task was committed atomically:

1. **Task 1+2: API client, character name extraction, and all three hooks** - `4a73412` (feat)

Note: useRoleplayTTS.ts was committed as part of the 10-01 execution due to concurrent jj working copy. All 5 files verified present and passing lint/type checks.

**Plan metadata:** (pending below)

## Files Created/Modified

- `web_frontend/src/api/roleplay.ts` - API client for all roleplay endpoints (sendRoleplayMessage SSE, getRoleplayHistory, completeRoleplay, retryRoleplay)
- `web_frontend/src/utils/extractCharacterName.ts` - Pure function for parsing character name from ai-instructions text
- `web_frontend/src/hooks/useRoleplaySession.ts` - Session lifecycle hook (load history, send message with streaming, complete, retry, AbortController cleanup)
- `web_frontend/src/hooks/useRoleplayToggles.ts` - Three-toggle state management (textDisplay, ttsEnabled, inputMode) with localStorage persistence
- `web_frontend/src/hooks/useRoleplayTTS.ts` - Buffered TTS coordination (WebSocket to /ws/tts after LLM response, uses useAudioPlayback)

## Decisions Made

- Character name extraction on frontend via regex -- no backend change needed, display-only concern
- Buffered TTS approach (send full text after LLM done) -- simpler than streaming TTS, acceptable latency for Phase 10
- Default voice hardcoded to "Ashley" -- voice selection deferred to future phase
- Toggle defaults: text display ON, TTS OFF, text input mode -- matches locked decision in CONTEXT.md
- Merge-with-defaults pattern in toggle initializer for forward compatibility with future toggle additions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed escaped dots in regex character class**
- **Found during:** Task 1 (extractCharacterName)
- **Issue:** ESLint flagged `\.` inside character class `[.,\n]` as unnecessary escape
- **Fix:** Changed `[\.,\n]` to `[.,\n]` in both regex patterns
- **Files modified:** web_frontend/src/utils/extractCharacterName.ts
- **Verification:** ESLint passes clean
- **Committed in:** 4a73412

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial lint fix. No scope creep.

## Issues Encountered

- Concurrent jj working copy conflict: another Claude executor (10-01) was running simultaneously, causing files to appear and disappear during jj auto-snapshot. Resolved by waiting for the other executor to complete and re-creating files in the clean working copy. The useRoleplayTTS.ts file was inadvertently committed as part of the 10-01 commit during this race, but all 5 files are present and verified in the final tree.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All frontend building blocks are ready for RoleplaySection UI component (Plan 03)
- API client, session hook, toggle hook, TTS hook, and character name extraction utility all verified with TypeScript and ESLint
- Plan 03 can import directly from these modules

## Self-Check: PASSED

- All 5 source files verified on disk
- SUMMARY.md created
- Commit 4a73412 exists in jj log
- TypeScript: 0 errors from new files (28 pre-existing errors in other files)
- ESLint: clean pass

---
*Phase: 10-core-conversation*
*Completed: 2026-02-25*
