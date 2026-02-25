# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** Students can engage with course content and demonstrate understanding while the platform collects data to improve both teaching and measurement.
**Current focus:** v3.1 AI Roleplay -- Phase 8 Foundation

## Current Position

Phase: 8 of 11 (Foundation)
Plan: 2 of 2 in current phase
Status: Phase 8 complete
Last activity: 2026-02-25 -- Completed 08-02-PLAN.md

Progress: [##........] 20%

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
- Total plans completed: 2 (v3.1)
- Average duration: 9min
- Total execution time: 18min

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
- Phase 10 TODO for roleplay-aware claim dedup in claim_chat_sessions

### Pending Todos

1 todo in `.planning/todos/pending/`:
- Collapse references section on mobile

### Blockers/Concerns

(None yet)

## Session Continuity

Last session: 2026-02-25
Stopped at: Completed 08-02-PLAN.md (Phase 8 complete)
Resume file: None
