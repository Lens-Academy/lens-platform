# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Students can engage with course content and demonstrate understanding while the platform collects data to improve both teaching and measurement.
**Current focus:** v3.0 Prompt Lab — Phase 6: Chat Evaluation

## Current Position

Phase: 6 of 7 (Chat Evaluation)
Plan: 5 of 5
Status: Executing
Last activity: 2026-02-20 — Completed 06-04 Prompt Lab interactive UI

Progress: [████████░░] 80%

## Milestone Summary

**v1.0 Mobile Responsiveness:**
- 5 phases, 13 plans completed
- 29/29 requirements satisfied
- 2 days from start to ship
- Tagged: v1.0

## Performance Metrics

**Velocity:**
- Total plans completed: 4 (v3.0)
- Average duration: 6min
- Total execution time: 22min

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 06-chat-evaluation | 4/5 | 22min | 6min |

## Accumulated Context

### Decisions

- Fixtures stored as JSON in repo, not database (version-controlled, curated)
- Prompt Lab calls llm.py directly via core/promptlab/ — does not modify chat.py or scoring.py
- Manual fixture extraction via Claude Code (small dataset, no UI needed)
- ChatMarkdown exported as default export for simple import syntax
- Fixture loading is synchronous (small local JSON files, no async needed)
- Fixtures sorted by name in list_fixtures() for deterministic ordering
- Thinking mode bypasses stream_chat() and calls acompletion() directly with thinking parameter
- continue_conversation() delegates to regenerate_response() (functionally identical)
- X-Accel-Buffering: no header on SSE responses for reverse proxy compatibility
- FixtureBrowser uses select dropdown for module filtering (not text search)
- PromptLab view placeholder shows fixture info when selected (Plan 04 replaces with full UI)
- API client systemPrompt param is string (not object) matching backend RegenerateRequest schema
- System prompt assembled in view from fixture parts (base + instructions + previousContent)
- Follow-up messages marked isRegenerated:true since they are Prompt Lab generations

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

- Phase 7 (Assessment Evaluation) blocked until ws3 merges `complete()` function and `SCORE_SCHEMA`

## Session Continuity

Last session: 2026-02-20
Stopped at: Completed 06-04-PLAN.md
Resume file: None
