# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-14)

**Core value:** Students can engage with course content and demonstrate understanding — through reading, discussion, and assessment — while the platform collects data to improve both teaching and measurement.
**Current focus:** v2.0 Tests & Answer Boxes — Phases 10-11 added (Score Retrieval + Answer Feedback)

## Current Position

Phase: 10 of 11 (Score Retrieval API)
Plan: 1 of 1 in current phase
Status: Phase 10 complete
Last activity: 2026-02-20 — Completed 10-01 Score Retrieval API

Progress: [=========================] 100% (23/24 plans across all milestones)

## Performance Metrics

**Velocity:**
- Total plans completed: 23 (13 v1.0 + 10 v2.0)
- Average duration: ~45 min (v1.0 estimate)
- Total execution time: ~10 hours (v1.0) + 37 min (v2.0)

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation | 2 | - | - |
| 2. Layout | 3 | - | - |
| 3. Content | 2 | - | - |
| 4. Chat | 2 | - | - |
| 5. Polish | 4 | - | - |

*v1.0 metrics not tracked in detail; tracking starts fresh for v2.0*

**By Phase (v2.0):**

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 6. Data Foundation | 01 | 3 min | 2 | 4 |
| 6. Data Foundation | 02 | 5 min | 2 | 10 |
| 7. Answer Box | 01 | 11 min | 3 | 12 |
| 7. Answer Box | 02 | manual | 3 | 5 |
| 8. Test Sections | 01 | 9 min | 3 | 11 |
| 8. Test Sections | 02 | 6 min | 3 | 6 |
| 9. AI Assessment | 01 | 6 min | 2 | 4 |
| 9. AI Assessment | 02 | 3 min | 2 | 2 |
| 10. Score Retrieval | 01 | 3 min | 2 | 3 |

## Accumulated Context

### Decisions

All v1.0 decisions archived in:
- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/PROJECT.md` Key Decisions table

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

### Pending Todos

1 todo in `.planning/todos/pending/`:
- Collapse references section on mobile

### Roadmap Evolution

- Phase 10 added: Score Retrieval API — GET endpoint completing assessment_scores CRUD layer
- Phase 11 added: Answer Feedback Chat — AI feedback conversation after answer submission

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-20
Stopped at: Completed 10-01-PLAN.md (Score Retrieval API) -- Phase 10 complete
Resume file: None
