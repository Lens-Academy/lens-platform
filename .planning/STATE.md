# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-14)

**Core value:** Students can engage with course content and demonstrate understanding — through reading, discussion, and assessment — while the platform collects data to improve both teaching and measurement.
**Current focus:** v2.0 Tests & Answer Boxes — Phase 6 in progress

## Current Position

Phase: 6 of 9 (Data Foundation) -- COMPLETE
Plan: 2 of 2 in current phase
Status: Phase complete
Last activity: 2026-02-14 — Completed 06-02 (content parsing and assessment API)

Progress: [===============...........] 62% (15/24 plans across all milestones)

## Performance Metrics

**Velocity:**
- Total plans completed: 15 (13 v1.0 + 2 v2.0)
- Average duration: ~45 min (v1.0 estimate)
- Total execution time: ~10 hours (v1.0) + 8 min (v2.0)

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

### Pending Todos

1 todo in `.planning/todos/pending/`:
- Collapse references section on mobile

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 06-02-PLAN.md (Phase 6 complete)
Resume file: None
