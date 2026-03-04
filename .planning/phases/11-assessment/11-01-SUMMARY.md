---
phase: 11-assessment
plan: 01
subsystem: api, database
tags: [sqlalchemy, alembic, litellm, asyncio, fastapi, pydantic, assessment]

# Dependency graph
requires:
  - phase: 10-core-conversation
    provides: "chat_sessions table, roleplay endpoints, complete_chat_session()"
  - phase: 08-roleplay-schema
    provides: "roleplay_id column on chat_sessions, segment_snapshot column"
provides:
  - "roleplay_assessments table for storing AI scoring results"
  - "core/roleplay_assessment.py scoring pipeline (enqueue_roleplay_scoring)"
  - "Background scoring triggered on roleplay completion"
  - "GET /api/chat/roleplay/{session_id}/assessment endpoint"
  - "segment_snapshot populated with assessment_instructions on session creation"
affects: [11-03-feedback-chat, 11-04-score-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget background scoring via asyncio.create_task (mirrors assessment.py)"
    - "Reuse SCORE_SCHEMA and SCORING_PROVIDER from core/assessment.py"
    - "segment_snapshot populated at session creation for rubric availability at scoring time"

key-files:
  created:
    - "core/roleplay_assessment.py"
    - "alembic/versions/2fd42752a98f_add_roleplay_assessments_table.py"
  modified:
    - "core/tables.py"
    - "web_api/routes/roleplay.py"

key-decisions:
  - "Reuse SCORE_SCHEMA from assessment.py rather than defining a separate roleplay schema"
  - "Reuse SCORING_PROVIDER from assessment.py to keep scoring model config in one place"
  - "segment_snapshot populated in SSE endpoint (not complete endpoint) so rubric is available before scoring"
  - "Assessment retrieval returns most recent assessment (ORDER BY created_at DESC LIMIT 1) supporting re-scoring"

patterns-established:
  - "Roleplay assessment mirrors question assessment: separate table, background task, structured JSON output"
  - "Both camelCase and kebab-case field lookup in segment_snapshot for content format flexibility"

# Metrics
duration: 10min
completed: 2026-03-02
---

# Phase 11 Plan 01: Backend Assessment Pipeline Summary

**Roleplay transcript scoring pipeline with roleplay_assessments table, background AI scoring via LiteLLM, and score retrieval endpoint**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-02T15:42:08Z
- **Completed:** 2026-03-02T15:51:47Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- roleplay_assessments table defined in SQLAlchemy with FK to chat_sessions, Alembic migration generated
- core/roleplay_assessment.py scoring module mirrors assessment.py with transcript formatting and background task
- complete_roleplay endpoint triggers background AI scoring when assessment instructions exist
- Score retrieval endpoint (GET /api/chat/roleplay/{session_id}/assessment) with ownership verification
- segment_snapshot populated in SSE endpoint with all roleplay fields including assessment_instructions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add roleplay_assessments table and Alembic migration** - `d625898` (feat)
2. **Task 2: Create scoring module, trigger in complete endpoint, add score retrieval + segment_snapshot** - `c7cc60f` (feat)

## Files Created/Modified
- `core/tables.py` - Added roleplay_assessments table definition (section 15)
- `alembic/versions/2fd42752a98f_add_roleplay_assessments_table.py` - Migration creating table + index
- `core/roleplay_assessment.py` - Complete scoring pipeline: format_transcript, enqueue_roleplay_scoring, background scoring task
- `web_api/routes/roleplay.py` - assessment_instructions in request model, segment_snapshot population, scoring trigger, assessment retrieval endpoint

## Decisions Made
- Reused SCORE_SCHEMA from core/assessment.py rather than defining a separate schema for roleplay assessment -- the existing schema (overall_score, reasoning, dimensions, key_observations) works equally well for roleplay transcripts
- Reused SCORING_PROVIDER from core/assessment.py to keep scoring model configuration in one place
- segment_snapshot is populated in the SSE endpoint (get_or_create_chat_session call) rather than in the complete endpoint, so the rubric is persisted at session creation time and available when scoring runs
- Assessment retrieval returns the most recent assessment via ORDER BY created_at DESC LIMIT 1, supporting the locked decision that multiple assessments per session are allowed (re-scoring)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Another agent session was concurrently modifying the same jj working copy (executing 11-02), causing file state interference. Resolved by using atomic Write operations and immediate commits.

## User Setup Required

**Database migration must be run before assessment scoring will work:**
```bash
.venv/bin/alembic upgrade head
```
This creates the `roleplay_assessments` table. The migration has NOT been run -- it is generated only.

## Next Phase Readiness
- Scoring pipeline is complete and ready for frontend integration (11-03 feedback chat, 11-04 score display)
- Assessment endpoint returns structured score_data that frontend can render
- No blockers for subsequent plans

## Self-Check: PASSED

All files exist, all commits verified, all imports work, all linting passes.

---
*Phase: 11-assessment*
*Completed: 2026-03-02*
