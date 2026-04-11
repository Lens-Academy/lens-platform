---
phase: 06-data-foundation
plan: 02
subsystem: content-processor, api
tags: [typescript, fastapi, pydantic, content-parsing, assessment-api, obsidian]

# Dependency graph
requires:
  - phase: 06-01
    provides: "assessment_responses table and core/assessments.py CRUD functions"
provides:
  - "Question segment parsing (#### Question) in content processor with user-instruction, assessment-prompt, max-time, max-chars, enforce-voice fields"
  - "Test section type in flattened module output from ## Test: sections in Learning Outcomes"
  - "Obsidian %% comment %% stripping in lens and learning-outcome parsers"
  - "POST /api/assessments/responses endpoint for submitting student answers"
  - "GET /api/assessments/responses endpoint for listing responses with optional filters"
  - "GET /api/assessments/responses/{question_id} endpoint for question-specific responses"
affects: [07-answer-box-ui, 09-ai-scoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Question segment type with user-instruction as required field and optional assessment-prompt, max-time, max-chars, enforce-voice"
    - "Test section flattening from inline LO ## Test: segments into separate Section with type test"
    - "Obsidian comment stripping as preprocessing step before frontmatter/section parsing"
    - "Assessment API following existing progress.py patterns with dual auth (JWT + anonymous token)"

key-files:
  created:
    - web_api/routes/assessments.py
  modified:
    - content_processor/src/content-schema.ts
    - content_processor/src/parser/lens.ts
    - content_processor/src/parser/learning-outcome.ts
    - content_processor/src/parser/sections.ts
    - content_processor/src/flattener/index.ts
    - content_processor/src/index.ts
    - content_processor/src/content-schema.test.ts
    - content_processor/src/parser/learning-outcome.test.ts
    - main.py

key-decisions:
  - "Export parseSegments and convertSegment from lens.ts so learning-outcome.ts can reuse them for test section parsing"
  - "Test sections with no source and no inline segments still create a ParsedTestRef with empty segments array (rather than undefined)"
  - "Question segment allowed in all section types (page, lens-article, lens-video) for maximum flexibility"
  - "Flattener passes stub lensSection for test segment conversion since question/chat/text segments do not need source file resolution"

patterns-established:
  - "stripObsidianComments preprocessing applied before any parsing in parseLens and parseLearningOutcome"
  - "Assessment API endpoints use Pydantic models for request/response validation following progress.py conventions"

# Metrics
duration: 5min
completed: 2026-02-14
---

# Phase 6 Plan 2: Content Parsing and Assessment API Summary

**Question segment parsing, test section flattening, Obsidian comment stripping in content processor, plus 3 assessment API endpoints for submit/list/get responses**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-14T12:12:36Z
- **Completed:** 2026-02-14T12:18:32Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Content processor extended with `question` segment type supporting user-instruction (required), assessment-prompt, max-time, max-chars, enforce-voice, optional fields
- Test section flattening from inline ## Test: segments in Learning Outcomes producing `test` section type with question/chat/text segments
- Obsidian %% comment %% stripping applied as preprocessing before parsing in both lens.ts and learning-outcome.ts
- Three assessment API endpoints created: POST submit, GET list with filters, GET by question_id
- All 475 existing tests pass with updated assertions for new segment count and test section behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend content processor to parse Question segments, Test sections, and strip Obsidian comments** - `6e9d52f8` (feat)
2. **Task 2: Create assessment API endpoints and register router** - `b01fa85f` (feat)

## Files Created/Modified
- `content_processor/src/content-schema.ts` - Added question segment type to SEGMENT_SCHEMAS
- `content_processor/src/parser/lens.ts` - Added ParsedQuestionSegment, question in LENS_SEGMENT_TYPES and VALID_SEGMENTS_PER_SECTION, convertSegment question case, stripObsidianComments utility, exported parseSegments and convertSegment
- `content_processor/src/parser/learning-outcome.ts` - Obsidian comment stripping, inline test segment parsing using parseSegments/convertSegment, updated ParsedTestRef with segments array
- `content_processor/src/parser/sections.ts` - Added question to ALL_STRUCTURAL_TYPES
- `content_processor/src/index.ts` - Added QuestionSegment interface, updated Segment union and Section.type to include test
- `content_processor/src/flattener/index.ts` - Added question case in convertSegment, test section flattening after lens processing in flattenLearningOutcomeSection, imported QuestionSegment type
- `content_processor/src/content-schema.test.ts` - Updated segment count assertion from 4 to 5
- `content_processor/src/parser/learning-outcome.test.ts` - Updated test section assertion to expect ParsedTestRef with empty segments
- `web_api/routes/assessments.py` - New route file with 3 endpoints, Pydantic models, dual auth
- `main.py` - Registered assessments_router

## Decisions Made
- Exported parseSegments and convertSegment from lens.ts to enable reuse by learning-outcome parser for inline test segments (avoids code duplication)
- Question segment allowed in all section types (page, lens-article, lens-video) for maximum content authoring flexibility
- Test sections with no source and no inline segments still create ParsedTestRef with empty segments array rather than being undefined (consistent behavior)
- Used stub lensSection when converting test segments in flattener since question/chat/text types do not need source file resolution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing tests for new segment type**
- **Found during:** Task 1
- **Issue:** content-schema.test.ts expected exactly 4 segment types, now 5 with question added; learning-outcome.test.ts expected test section without source to be undefined
- **Fix:** Updated content-schema test to expect 5 segment types including question; updated learning-outcome test to expect ParsedTestRef with empty segments array
- **Files modified:** content_processor/src/content-schema.test.ts, content_processor/src/parser/learning-outcome.test.ts
- **Verification:** All 475 tests pass
- **Committed in:** 6e9d52f8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug - test expectations)
**Impact on plan:** Necessary for test suite correctness after additive changes. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Content processor ready to parse question segments and test sections from Obsidian vault content
- Assessment API endpoints ready for frontend integration in Phase 7 (answer box UI)
- All backend data infrastructure (tables, CRUD, content parsing, API) complete for v2.0 Tests & Answer Boxes feature
- Migration from 06-01 still needs user review before running against database

## Self-Check: PASSED

All 8 key files verified on disk. Both task commits (6e9d52f8, b01fa85f) verified in jj log.

---
*Phase: 06-data-foundation*
*Completed: 2026-02-14*
