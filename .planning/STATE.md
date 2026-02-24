# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-24)

**Core value:** Students can engage with course content and demonstrate understanding while the platform collects data to improve both teaching and measurement.
**Current focus:** v3.1 AI Roleplay

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-02-24 — Milestone v3.1 started

## Milestone Summary

**v1.0 Mobile Responsiveness:**
- 5 phases, 13 plans completed
- 29/29 requirements satisfied
- 2 days from start to ship
- Tagged: v1.0

**v3.0 Prompt Lab:**
- 2 phases (6-7), 4/5 plans completed in Phase 6
- Phase 7 deferred (blocked on ws3 merge)
- Archived as-is

## Accumulated Context

### Decisions

v2.0 decisions:
- Free-text only (no MC) for richer AI assessment signal
- Scores hidden from users until scoring accuracy improves
- Tests at end of module for time-gap measurement
- JSONB for assessment scores (schema flexibility)
- JSONB for answer_metadata (voice_used, time_taken_s, etc.)
- Separate assessment_scores table from responses (scores async in Phase 9)
- No unique constraint on (user, question) -- multiple attempts as separate records
- claim pattern for assessment responses follows existing progress claim pattern
- question segment allowed in all section types (page, lens-article, lens-video)
- parseSegments/convertSegment exported from lens.ts for reuse by test section parser
- test sections with no source create ParsedTestRef with empty segments array (not undefined)
- Position-based questionId (moduleSlug:sectionIndex:segmentIndex) for stable answer linking
- completed_at as nullable TIMESTAMP to distinguish finished from in-progress answers
- 2.5s default debounce for auto-save
- Ownership-checked PATCH with OR condition (user_id OR anonymous_token)
- FIELD_PATTERN regex must use [\w-]+ to support hyphenated field names
- Voice recording requires secure context guard (isSecureContext check before getUserMedia)
- AnswerBox gets optional onComplete callback for parent notification (used by TestSection)
- Test stage type uses type assertion in progress bar (Stage union doesn't include 'test')
- isActive is false when testState === 'completed' so all questions show collapsed
- ModuleHeader.tsx needs testModeActive passthrough since it wraps StageProgressBar in mobile view
- Content hiding is a speed bump, not a wall -- URL hash manipulation still works per user decision
- All disabled navigation uses cursor-default, never cursor-not-allowed
- Socratic vs assessment mode determined by section type (test = assessment, all others = socratic)
- SCORING_PROVIDER env var for independent model selection, defaults to DEFAULT_PROVIDER
- Background scoring tasks tracked in module-level set to prevent garbage collection
- Scoring trigger checks body.completed_at (request intent), not row state, to avoid re-triggering
- enqueue_scoring called after 404 check to ensure row exists before scoring begins
- Score retrieval returns empty list (not 404) when no scores or wrong response_id -- no information leakage
- JSONB fields extracted with .get() defaults so missing keys become None rather than errors
- feedback field follows existing boolean field pattern (optional, undefined when not set, true when enabled)
- UUID5(NAMESPACE_URL, questionId) for deterministic feedback session content_id derivation
- Feedback prompt returns string (not tuple like scoring) -- simpler since messages come from chat session
- Best-effort archive endpoint (always returns ok:true) -- idempotent, no error on missing session
- Reuses _resolve_question_details from core/scoring.py for question context resolution

### Pending Todos

1 todo in `.planning/todos/pending/`:
- Collapse references section on mobile

### Blockers/Concerns

(None yet)

## Session Continuity

Last session: 2026-02-24
Stopped at: Starting v3.1 milestone
Resume file: None
