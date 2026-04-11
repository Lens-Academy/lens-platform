---
phase: 10-core-conversation
plan: 03
subsystem: ui
tags: [react, components, roleplay, chat-ui, voice, tts, lucide-react]

# Dependency graph
requires:
  - phase: 10-core-conversation (plan 01)
    provides: "Backend roleplay API routes (SSE chat, history, complete, retry)"
  - phase: 10-core-conversation (plan 02)
    provides: "useRoleplaySession, useRoleplayToggles, useRoleplayTTS hooks, API client, extractCharacterName"
provides:
  - "RoleplaySection: complete roleplay conversation UI component"
  - "RoleplayBriefing: scenario briefing card"
  - "RoleplayToolbar: three-toggle toolbar (text display, TTS, input mode)"
  - "VoiceInputBar: push-to-talk mic with immediate send and cancel"
  - "SpeakingIndicator: visual feedback for text-off mode"
  - "Module.tsx case 'roleplay' in renderSegment switch"
affects: [10-core-conversation plan 04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Indigo accent for roleplay AI messages (distinct from tutor gray)"
    - "Push-to-talk with cancel via useRef flag (ignore transcription on cancel)"
    - "CSS-only pulsing dot animation for speaking indicator"
    - "Isolated roleplay component with its own hooks (no shared Module.tsx chat state)"

key-files:
  created:
    - web_frontend/src/components/module/RoleplayBriefing.tsx
    - web_frontend/src/components/module/RoleplayToolbar.tsx
    - web_frontend/src/components/module/VoiceInputBar.tsx
    - web_frontend/src/components/module/SpeakingIndicator.tsx
    - web_frontend/src/components/module/RoleplaySection.tsx
  modified:
    - web_frontend/src/views/Module.tsx

key-decisions:
  - "VoiceInputBar cancel uses a useRef flag to suppress transcription result rather than adding cancel support to useVoiceRecording hook"
  - "Indigo send button in roleplay (bg-indigo-600) to distinguish from tutor chat blue (bg-blue-600)"
  - "SpeakingIndicator uses inline CSS keyframes for pulsing dots rather than Tailwind animation utilities"

patterns-established:
  - "Roleplay UI pattern: briefing card always visible, toolbar controls toggle independently, conversation area swaps between message list and speaking indicator"
  - "Module.tsx integration: single case + import, component manages all its own state"

# Metrics
duration: 5min
completed: 2026-02-25
---

# Phase 10 Plan 03: Roleplay Conversation UI Summary

**Five roleplay UI components (briefing, toolbar, voice input, speaking indicator, main section) with indigo accent theme and Module.tsx integration**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-25T18:53:14Z
- **Completed:** 2026-02-25T18:58:30Z
- **Tasks:** 2
- **Files created:** 5, **modified:** 1

## Accomplishments

- Five new roleplay UI components: briefing card, three-toggle toolbar, push-to-talk voice input, speaking indicator, and main RoleplaySection wiring them all together
- Module.tsx integration via single case "roleplay" in renderSegment switch -- RoleplaySection manages all its own state
- Indigo accent theme for AI messages (bg-indigo-50, text-indigo-600) clearly distinguishing roleplay from tutor chat
- Complete conversation flow: briefing, text/voice input, streaming responses, completion, and retry

## Task Commits

Each task was committed atomically:

1. **Task 1: Create sub-components (RoleplayBriefing, RoleplayToolbar, VoiceInputBar, SpeakingIndicator)** - `95f9a49` (feat)
2. **Task 2: Create RoleplaySection component and add renderSegment case in Module.tsx** - `be40e4f` (feat)

## Files Created/Modified

- `web_frontend/src/components/module/RoleplayBriefing.tsx` - Scenario briefing card with indigo accent, always visible
- `web_frontend/src/components/module/RoleplayToolbar.tsx` - Three independent toggle buttons (text display, TTS, input mode) using lucide-react icons
- `web_frontend/src/components/module/VoiceInputBar.tsx` - Push-to-talk mic button with cancel support, immediate send on transcription
- `web_frontend/src/components/module/SpeakingIndicator.tsx` - CSS-animated pulsing dots for AI speaking, mic icon for user turn
- `web_frontend/src/components/module/RoleplaySection.tsx` - Main component wiring useRoleplaySession, useRoleplayToggles, useRoleplayTTS hooks with all sub-components
- `web_frontend/src/views/Module.tsx` - Added RoleplaySection import and case "roleplay" in renderSegment switch

## Decisions Made

- VoiceInputBar cancel uses a useRef flag to suppress transcription result rather than modifying the useVoiceRecording hook -- keeps the shared hook simple and unchanged
- Indigo send button (bg-indigo-600) in roleplay to distinguish from tutor chat's blue (bg-blue-600)
- SpeakingIndicator uses inline CSS keyframes for pulsing dots since Tailwind v4 custom animations would require configuration changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All roleplay UI components are complete and integrated into Module.tsx
- Plan 04 (polish, testing, or any remaining work) can proceed
- Full end-to-end flow works: briefing card visible, conversation with character name in indigo, text/voice modes, toggles, complete/retry

## Self-Check: PASSED

All 6 files verified on disk (5 created, 1 modified). Both commits found in jj log. TypeScript: 0 errors from new files. ESLint: clean. Production build: succeeds.

---
*Phase: 10-core-conversation*
*Completed: 2026-02-25*
