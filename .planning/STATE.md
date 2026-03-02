# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** Students can engage with course content and demonstrate understanding while the platform collects data to improve both teaching and measurement.
**Current focus:** v3.1 AI Roleplay -- Phase 11 Assessment

## Current Position

Phase: 11 of 11 (Assessment)
Plan: 2 of 4 in current phase
Status: Executing Phase 11
Last activity: 2026-03-02 -- Completed 11-02-PLAN.md

Progress: [########..] 80%

## Milestone Summary

**v1.0 Mobile Responsiveness:**
- 5 phases, 13 plans completed
- 29/29 requirements satisfied
- Tagged: v1.0

**v3.0 Prompt Lab:**
- 2 phases (6-7), 4/5 plans completed in Phase 6
- Phase 7 deferred (blocked on ws3 merge)
- Archived as-is

**v3.1 AI Roleplay:**
- 4 phases (8-11), 23 requirements
- TTS pipeline (Phase 9) is highest-risk, prioritized early
- Manual completion button is only end trigger (no auto-triggers)

## Performance Metrics

**Velocity:**
- Total plans completed: 8 (v3.1)
- Average duration: 6min
- Total execution time: 48min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 11-assessment | 02 | 4min | 1 | 3 |
| Phase 11-assessment P01 | 10min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

v3.1 decisions:
- Manual completion button (CONV-05) is the ONLY end trigger -- no message count, time, or AI-monitored triggers
- TTS pipeline (Inworld WebSocket) built early as highest architectural risk
- segment_key column on chat_sessions for session isolation (load-bearing, expensive to reverse)
- roleplay.py prompt assembly completely separate from tutor chat.py (no shared base prompt)
- Zero new dependencies except Inworld TTS external service
- Roleplay valid in all Lens section types (page, lens-article, lens-video)
- ai-instructions field added to MARKDOWN_CONTENT_FIELDS for heading disambiguation
- Three required roleplay fields: id (UUID), content (briefing), ai-instructions (character behavior)
- Separate partial indexes for tutor/roleplay session isolation (no COALESCE hacks)
- Phase 10 TODO for roleplay-aware claim dedup resolved: uses IS NOT DISTINCT FROM for (module_id, roleplay_id) pairs
- Roleplay routes share /api/chat prefix, use /api/chat/roleplay sub-path
- Opening message persisted as assistant message on new session creation only
- completed_at column distinguishes "finished" from "archived" sessions
- Single-synthesis-at-a-time via asyncio.Lock (Phase 10 may add concurrent dispatch)
- MP3 at 48kHz/128kbps for browser Web Audio API compatibility
- Binary WebSocket frames for audio transport (not base64 over SSE)
- Character name extraction done on frontend via regex (display-only concern, no backend change)
- Buffered TTS: full text sent to /ws/tts after LLM response completes (streaming TTS deferred)
- Default TTS voice hardcoded to "Ashley" for Phase 10
- Toggle defaults: text display ON, TTS OFF, text input -- per locked decision
- Isolated roleplay state per segment (useRoleplaySession), separate from Module.tsx shared chat state
- VoiceInputBar cancel via useRef flag (suppress transcription) rather than modifying shared useVoiceRecording hook
- Indigo send button (bg-indigo-600) in roleplay distinct from tutor chat blue (bg-blue-600)
- SpeakingIndicator uses inline CSS keyframes for pulsing dots
- TestRoleplayCard renders full RoleplaySection when active (not simplified version)
- Promise.allSettled for mixed question/roleplay completion loading in TestSection
- Feedback trigger only includes question answers; roleplays have their own assessment path
- [Phase 11-assessment]: Reuse SCORE_SCHEMA and SCORING_PROVIDER from assessment.py for roleplay scoring (single config source)
- [Phase 11-assessment]: segment_snapshot populated at SSE endpoint session creation (not at completion) so rubric is available for scoring

### Pending Todos

1 todo in `.planning/todos/pending/`:
- Collapse references section on mobile

### Blockers/Concerns

(None yet)

## Session Continuity

Last session: 2026-03-02
Stopped at: Completed 11-01-PLAN.md (+ 11-02-PLAN.md)
Resume file: None
