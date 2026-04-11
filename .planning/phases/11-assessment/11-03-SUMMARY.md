---
phase: 11-assessment
plan: 03
subsystem: ui
tags: [react, typescript, assessment, feedback-chat, polling, score-display]

# Dependency graph
requires:
  - phase: 11-assessment
    provides: "roleplay_assessments table, GET /api/chat/roleplay/{session_id}/assessment endpoint (Plan 01)"
  - phase: 10-core-conversation
    provides: "RoleplaySection component, NarrativeChatSection, activeFeedbackKey pattern in Module.tsx"
provides:
  - "getRoleplayAssessment() API client for polling assessment results"
  - "Assessment score card in RoleplaySection (loading/ready/unavailable states)"
  - "Feedback chat wired for roleplay assessment in Module.tsx"
  - "onFeedbackTrigger prop on RoleplaySection for discussion initiation"
affects: [11-04-score-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Poll-based assessment retrieval (2s interval, 15 attempts, 30s timeout)"
    - "Assessment summary string builder for seeding feedback chat context"

key-files:
  created: []
  modified:
    - "web_frontend/src/api/roleplay.ts"
    - "web_frontend/src/components/module/RoleplaySection.tsx"
    - "web_frontend/src/views/Module.tsx"

key-decisions:
  - "Poll every 2s for 30s max (15 attempts) for assessment results -- balances responsiveness with server load"
  - "Assessment summary formatted as natural language for feedback chat seeding (not raw JSON)"
  - "Roleplay feedback uses same activeFeedbackKey pattern as question feedback -- consistent UX"
  - "feedbackKey uses roleplay- prefix to avoid collision with question feedbackKey format"

patterns-established:
  - "Roleplay assessment flow: complete -> poll for score -> display card -> discuss with tutor"
  - "buildAssessmentSummary() constructs human-readable context for AI tutor seeding"

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 11 Plan 03: Assessment Result Display and Feedback Chat Summary

**Poll-based assessment score card in RoleplaySection with dimension scores and tutor feedback chat wired via activeFeedbackKey pattern**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T15:54:37Z
- **Completed:** 2026-03-02T15:57:31Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- getRoleplayAssessment() API client polls backend for scoring results after roleplay completion
- Assessment score card shows overall score (X/5), reasoning, dimension scores, and key observations
- Loading state with spinner while AI scoring is in progress (up to 30s timeout)
- "Discuss your performance" button triggers NarrativeChatSection with assessment context seeding
- Feedback chat follows same activeFeedbackKey pattern as question feedback in Module.tsx

## Task Commits

Each task was committed atomically:

1. **Task 1: Add assessment API client and score card in RoleplaySection** - `4447174` (feat)
2. **Task 2: Wire feedback chat in Module.tsx** - `b21d8c6` (feat)

## Files Created/Modified
- `web_frontend/src/api/roleplay.ts` - Added getRoleplayAssessment() function for polling assessment endpoint
- `web_frontend/src/components/module/RoleplaySection.tsx` - Assessment polling state, score card UI (loading/ready/unavailable), onFeedbackTrigger prop, buildAssessmentSummary helper
- `web_frontend/src/views/Module.tsx` - Roleplay case in renderSegment wired with feedbackKey, onFeedbackTrigger, NarrativeChatSection rendering

## Decisions Made
- Poll every 2 seconds for up to 30 seconds (15 attempts) -- provides responsive UX without hammering the server. If scoring takes longer, shows "Conversation complete" gracefully.
- Assessment summary formatted as natural language (not JSON) when seeding feedback chat -- the AI tutor receives human-readable context like "Score: 4/5, Reasoning: ..."
- Used `roleplay-${sectionIndex}-${segmentIndex}` feedbackKey format with "roleplay-" prefix to avoid collision with question feedback keys which use `${sectionIndex}-${segmentIndex}`
- Roleplays without assessmentInstructions skip polling entirely and show plain "Conversation complete" (assessmentState stays "idle")

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The assessment endpoint from Plan 01 must be available (database migration must have been run).

## Next Phase Readiness
- Assessment display and feedback chat are complete
- Ready for Plan 04 if additional score display or refinement is needed
- Full assessment flow works end-to-end: roleplay completion -> background scoring -> poll for results -> display score card -> discuss with tutor

## Self-Check: PASSED

All files verified, all commits confirmed, lint and build pass.

---
*Phase: 11-assessment*
*Completed: 2026-03-02*
