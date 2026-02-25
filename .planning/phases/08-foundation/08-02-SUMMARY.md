---
phase: 08-foundation
plan: 02
subsystem: database, api
tags: [sqlalchemy, alembic, postgresql, chat-sessions, roleplay, partial-indexes]

# Dependency graph
requires:
  - phase: 08-foundation-01
    provides: roleplay segment type in content processor schema and parser
provides:
  - chat_sessions table with module_id (renamed from content_id), roleplay_id, segment_snapshot
  - Four partial unique indexes for tutor/roleplay session isolation
  - get_or_create_chat_session() with module_id and roleplay_id parameters
  - build_roleplay_prompt() function for AI character prompt assembly
  - RoleplaySegment dataclass in types.py
  - Roleplay segment handling in context.py
affects: [phase-10-conversations, roleplay-api-routes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate partial indexes for NULL/NOT NULL discrimination instead of COALESCE"
    - "Roleplay prompt assembly fully separate from tutor chat prompts"

key-files:
  created:
    - alembic/versions/b762f0644662_rename_content_id_add_roleplay_columns.py
    - core/modules/roleplay.py
  modified:
    - core/tables.py
    - core/modules/chat_sessions.py
    - core/modules/tests/test_chat_sessions.py
    - core/modules/types.py
    - core/modules/context.py
    - web_api/routes/module.py
    - web_api/routes/modules.py

key-decisions:
  - "Separate partial indexes for tutor/roleplay instead of COALESCE-based approach"
  - "Phase 10 TODO for roleplay-aware claim dedup (edge case acceptable for now)"
  - "roleplay.py has zero imports from chat.py -- completely independent prompt assembly"

patterns-established:
  - "Session isolation via separate partial unique indexes per identity type"
  - "Roleplay prompt construction separate from tutor chat prompts"

# Metrics
duration: 12min
completed: 2026-02-25
---

# Phase 8 Plan 2: Backend Schema and Service Changes Summary

**Renamed content_id to module_id, added roleplay_id/segment_snapshot columns with four partial unique indexes, updated all callers, and created roleplay prompt assembly module**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-25T09:03:40Z
- **Completed:** 2026-02-25T09:16:03Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- chat_sessions table cleanly separates tutor chat (roleplay_id IS NULL) from roleplay sessions (roleplay_id IS NOT NULL) via four separate partial unique indexes
- Column rename from content_id to module_id makes the schema self-documenting
- All callers updated -- both module.py (singular) and modules.py (plural) routes, plus all test files
- roleplay.py provides completely independent prompt assembly from tutor chat

## Task Commits

Each task was committed atomically:

1. **Task 1: Database schema changes** - `24fc138` (feat)
2. **Task 2: Update service, callers, types, and create roleplay.py** - `381ea5e` (feat)

## Files Created/Modified
- `core/tables.py` - chat_sessions with module_id, roleplay_id, segment_snapshot, four partial indexes
- `alembic/versions/b762f0644662_rename_content_id_add_roleplay_columns.py` - Migration with upgrade and downgrade
- `core/modules/chat_sessions.py` - get_or_create and claim functions using module_id/roleplay_id
- `core/modules/tests/test_chat_sessions.py` - All tests updated for new parameter names
- `core/modules/types.py` - RoleplaySegment dataclass added to NarrativeSegment union
- `core/modules/roleplay.py` - build_roleplay_prompt() with ROLEPLAY_BASE_PROMPT
- `core/modules/context.py` - Roleplay segment handling in gather_section_context
- `web_api/routes/module.py` - Both call sites updated to module_id
- `web_api/routes/modules.py` - Progress endpoint call site updated to module_id

## Decisions Made
- Used separate partial indexes for NULL/NOT NULL roleplay_id discrimination instead of COALESCE hack -- PostgreSQL NULL semantics handled cleanly by filtering IS NULL vs IS NOT NULL
- Left claim_chat_sessions with module_id-only dedup, added Phase 10 TODO for roleplay-aware dedup (edge case during anonymous-to-user migration)
- roleplay.py intentionally has zero imports from chat.py or prompts.py -- prompt framing is fundamentally different (character-in-scene vs tutor-helping-student)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Concurrent 08-01 executor agent was rebasing the commit tree while this plan was executing, causing jj working copy changes to be lost multiple times. Resolved by re-applying changes and committing promptly.

## User Setup Required

None - no external service configuration required. Migration must be run on the database (`alembic upgrade head`) before deploying.

## Next Phase Readiness
- Database schema ready for roleplay session creation
- Prompt assembly module ready for Phase 10 conversation integration
- All existing tests pass with the renamed columns

---
*Phase: 08-foundation*
*Completed: 2026-02-25*
