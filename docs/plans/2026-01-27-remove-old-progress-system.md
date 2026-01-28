# Remove Old Progress Tracking System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Completely remove the old `module_sessions`/`content_events` progress tracking system and update all code to use only the new `user_content_progress`/`chat_sessions` system.

**Architecture:** Remove old tables, core modules, API endpoints, and frontend code. Update Module.tsx to use content-based tracking instead of session-based. No backwards compatibility - clean removal.

**Tech Stack:** Python/FastAPI, SQLAlchemy, React/TypeScript, PostgreSQL, Alembic migrations

---

## Phase 1: Frontend - Update Module.tsx to Use New System

### Task 1.1: Update useActivityTracker to Remove Legacy Support

**Files:**
- Modify: `web_frontend/src/hooks/useActivityTracker.ts`

**Step 1: Read the current file**

Read `web_frontend/src/hooks/useActivityTracker.ts` to understand the current structure.

**Step 2: Remove legacy options from interface**

Replace the `ActivityTrackerOptions` interface to remove legacy fields:

```typescript
interface ActivityTrackerOptions {
  // New progress API options
  contentId?: string;
  isAuthenticated?: boolean;

  inactivityTimeout?: number; // ms, default 180000 (3 min)
  heartbeatInterval?: number; // ms, default 60000 (60 sec)
  enabled?: boolean;
}
```

**Step 3: Remove sendLegacyHeartbeat function**

Delete the entire `sendLegacyHeartbeat` callback (approximately lines 40-58).

**Step 4: Simplify sendHeartbeat to only use new API**

Replace the combined heartbeat logic. The `sendHeartbeat` should just call `sendProgressHeartbeat`:

```typescript
const sendHeartbeat = useCallback(async () => {
  if (!enabled || !contentId) return;
  await sendProgressHeartbeat();
}, [enabled, contentId, sendProgressHeartbeat]);
```

**Step 5: Remove unused imports and variables**

Remove `API_URL` import if no longer needed, and remove `stageIndex`, `stageType`, `sessionId` from destructuring.

**Step 6: Run frontend lint**

Run: `cd web_frontend && npm run lint`
Expected: No errors related to useActivityTracker

**Step 7: Commit**

```bash
jj describe -m "refactor: remove legacy session support from useActivityTracker"
jj new
```

---

### Task 1.2: Remove useVideoActivityTracker Hook

**Files:**
- Delete: `web_frontend/src/hooks/useVideoActivityTracker.ts`
- Modify: `web_frontend/src/views/Module.tsx` (remove import)

**Step 1: Check if useVideoActivityTracker is used elsewhere**

Run: `grep -r "useVideoActivityTracker" web_frontend/src/`

Expected: Only Module.tsx uses it.

**Step 2: Delete the file**

```bash
rm web_frontend/src/hooks/useVideoActivityTracker.ts
```

**Step 3: Remove import from Module.tsx**

Remove the line:
```typescript
import { useVideoActivityTracker } from "@/hooks/useVideoActivityTracker";
```

**Step 4: Run frontend lint**

Run: `cd web_frontend && npm run lint`
Expected: Error about missing videoTracker usage - we'll fix in next task

**Step 5: Commit**

```bash
jj describe -m "refactor: remove useVideoActivityTracker hook"
jj new
```

---

### Task 1.3: Update Module.tsx Activity Tracking

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Read Module.tsx to understand current activity tracking**

Read the file focusing on lines 260-290 where activity trackers are used.

**Step 2: Replace session-based tracking with content-based tracking**

Find and replace the activity tracker calls. Change from:

```typescript
useActivityTracker({
  sessionId: sessionId ?? 0,
  stageIndex: currentSectionIndex,
  stageType: "article",
  inactivityTimeout: 180_000,
  enabled: !!sessionId && (currentSectionType === "article" || currentSection?.type === "text"),
});
```

To:

```typescript
useActivityTracker({
  contentId: currentSection?.contentId ?? undefined,
  isAuthenticated: !!user,
  inactivityTimeout: 180_000,
  enabled: !!currentSection?.contentId && (currentSectionType === "article" || currentSection?.type === "text"),
});
```

**Step 3: Remove videoTracker usage**

Delete the videoTracker variable and its usage:
```typescript
// DELETE these lines:
const videoTracker = useVideoActivityTracker({...});
// And any videoTracker.triggerActivity() calls
```

Replace video tracking with the same useActivityTracker:
```typescript
useActivityTracker({
  contentId: currentSection?.contentId ?? undefined,
  isAuthenticated: !!user,
  inactivityTimeout: 180_000,
  enabled: !!currentSection?.contentId && currentSectionType === "video",
});
```

**Step 4: Update chat activity tracker**

```typescript
const { triggerActivity: triggerChatActivity } = useActivityTracker({
  contentId: currentSection?.contentId ?? undefined,
  isAuthenticated: !!user,
  inactivityTimeout: 300_000,
  enabled: !!currentSection?.contentId,
});
```

**Step 5: Run frontend build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds (may have other errors we'll fix in later tasks)

**Step 6: Commit**

```bash
jj describe -m "refactor: update Module.tsx to use content-based activity tracking"
jj new
```

---

### Task 1.4: Remove Old Session Management from Module.tsx

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Remove old API imports**

Remove these imports:
```typescript
import { createSession, getSession, claimSession } from "@/api/modules";
import { useAnonymousSession } from "@/hooks/useAnonymousSession";
```

**Step 2: Remove sessionId state and related hooks**

Find and remove:
- `const [sessionId, setSessionId] = useState<number | null>(null);`
- `const { getStoredSessionId, storeSessionId, clearSessionId } = useAnonymousSession(moduleSlug);`
- Any `sessionId` references in state

**Step 3: Remove session initialization logic**

Find the `init()` function (approximately lines 324-389) that creates/restores sessions. This entire function should be removed or replaced with new progress initialization.

**Step 4: Update handleSendMessage to use new chat system**

The chat functionality needs to use `chat_sessions` instead of `module_sessions`. This requires using the new chat API. Update to use the new progress/chat endpoints.

**Step 5: Run frontend lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: May have errors - note them for next tasks

**Step 6: Commit**

```bash
jj describe -m "refactor: remove old session management from Module.tsx"
jj new
```

---

### Task 1.5: Remove Old API Client Functions

**Files:**
- Modify: `web_frontend/src/api/modules.ts`

**Step 1: Remove session-related functions**

Delete these functions:
- `createSession()`
- `getSession()`
- `advanceStage()`
- `claimSession()`

**Step 2: Update sendMessage to use new chat API**

The `sendMessage` function needs to be updated to use the new chat system or moved to a new file. For now, if chat functionality uses a different endpoint, update accordingly.

**Step 3: Remove SessionState interface if unused**

If `SessionState` is no longer used, remove it.

**Step 4: Run frontend lint**

Run: `cd web_frontend && npm run lint`
Expected: No errors

**Step 5: Commit**

```bash
jj describe -m "refactor: remove old session API functions from modules.ts"
jj new
```

---

### Task 1.6: Remove useAnonymousSession Hook

**Files:**
- Delete: `web_frontend/src/hooks/useAnonymousSession.ts` (if it exists)

**Step 1: Check if file exists and is used**

Run: `ls web_frontend/src/hooks/useAnonymousSession.ts 2>/dev/null && grep -r "useAnonymousSession" web_frontend/src/`

**Step 2: If exists and unused, delete**

```bash
rm web_frontend/src/hooks/useAnonymousSession.ts
```

**Step 3: Run frontend build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
jj describe -m "refactor: remove useAnonymousSession hook"
jj new
```

---

### Task 1.7: Remove progressMigration.ts

**Files:**
- Delete: `web_frontend/src/lib/progressMigration.ts`
- Modify: Any file that imports it

**Step 1: Find usages**

Run: `grep -r "progressMigration\|cleanupLegacyProgress" web_frontend/src/`

**Step 2: Remove imports and calls**

In any file that imports from progressMigration.ts, remove the import and any calls to `cleanupLegacyProgress()`.

**Step 3: Delete the file**

```bash
rm web_frontend/src/lib/progressMigration.ts
```

**Step 4: Run frontend build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
jj describe -m "refactor: remove legacy progress migration utility"
jj new
```

---

## Phase 2: Backend - Remove Old API Endpoints

### Task 2.1: Remove Module Session Endpoints from modules.py

**Files:**
- Modify: `web_api/routes/modules.py`

**Step 1: Read the file to identify sections to remove**

Identify all `/api/module-sessions/*` endpoints.

**Step 2: Remove imports for old session functions**

Remove from imports:
```python
from core.modules import (
    create_session,
    get_session,
    add_message,
    advance_stage,
    complete_session,
    claim_session,
    SessionNotFoundError,
    SessionAlreadyClaimedError,
)
```

Also remove:
```python
from core.tables import content_events
from core.enums import ContentEventType
```

**Step 3: Remove helper functions**

Delete these functions:
- `get_started_message()`
- `get_finished_message()`
- `check_session_access()`
- `get_user_id_for_module()`

**Step 4: Remove request models**

Delete:
- `CreateSessionRequest` class
- `HeartbeatRequest` class

**Step 5: Remove all /api/module-sessions endpoints**

Delete these endpoint functions:
- `start_session()` - POST /api/module-sessions
- `get_session_state()` - GET /api/module-sessions/{session_id}
- `send_message_endpoint()` - POST /api/module-sessions/{session_id}/message
- `advance_session()` - POST /api/module-sessions/{session_id}/advance
- `claim_session_endpoint()` - POST /api/module-sessions/{session_id}/claim
- `record_heartbeat()` - POST /api/module-sessions/{session_id}/heartbeat

**Step 6: Run Python lint**

Run: `ruff check web_api/routes/modules.py`
Expected: No errors (may have unused import warnings - clean those up)

**Step 7: Commit**

```bash
jj describe -m "refactor: remove /api/module-sessions endpoints"
jj new
```

---

## Phase 3: Backend - Remove Core Session Module

### Task 3.1: Remove core/modules/sessions.py

**Files:**
- Delete: `core/modules/sessions.py`
- Modify: `core/modules/__init__.py`

**Step 1: Delete the sessions.py file**

```bash
rm core/modules/sessions.py
```

**Step 2: Update core/modules/__init__.py**

Remove the session imports:
```python
# DELETE these lines:
from .sessions import (
    create_session,
    get_session,
    get_user_sessions,
    add_message,
    advance_stage,
    complete_session,
    claim_session,
    get_user_module_progress,
    SessionNotFoundError,
    SessionAlreadyClaimedError,
)
```

Remove from `__all__`:
```python
    "create_session",
    "get_session",
    "get_user_sessions",
    "add_message",
    "advance_stage",
    "complete_session",
    "claim_session",
    "get_user_module_progress",
    "SessionNotFoundError",
    "SessionAlreadyClaimedError",
```

**Step 3: Run Python lint**

Run: `ruff check core/modules/`
Expected: No errors

**Step 4: Commit**

```bash
jj describe -m "refactor: remove core/modules/sessions.py"
jj new
```

---

### Task 3.2: Remove core/queries/progress.py

**Files:**
- Delete: `core/queries/progress.py`
- Modify: Any files that import from it

**Step 1: Find usages**

Run: `grep -r "from core.queries.progress import\|from core.queries import.*progress" .`

**Step 2: Check what functions are used and if they have replacements**

The functions in this file are used by the facilitator panel. They need to be rewritten to use new tables, OR the facilitator panel needs updating. For now, we'll remove the file and note that facilitator panel needs updating.

**Step 3: Delete the file**

```bash
rm core/queries/progress.py
```

**Step 4: Update any imports that referenced it**

If files import from this module, update them to remove the import (they will need new implementations).

**Step 5: Run Python lint**

Run: `ruff check .`
Expected: May have errors about missing imports - note them

**Step 6: Commit**

```bash
jj describe -m "refactor: remove core/queries/progress.py (old progress queries)"
jj new
```

---

## Phase 4: Backend - Remove Old Table Definitions

### Task 4.1: Remove Table Definitions from core/tables.py

**Files:**
- Modify: `core/tables.py`

**Step 1: Remove module_sessions table definition**

Delete the entire `module_sessions = Table(...)` block (approximately lines 331-350).

**Step 2: Remove content_events table definition**

Delete the entire `content_events = Table(...)` block (approximately lines 355-390).

**Step 3: Run Python lint**

Run: `ruff check core/tables.py`
Expected: May have warnings about unused imports

**Step 4: Commit**

```bash
jj describe -m "refactor: remove module_sessions and content_events table definitions"
jj new
```

---

### Task 4.2: Remove Old Enums from core/enums.py

**Files:**
- Modify: `core/enums.py`

**Step 1: Check if StageType and ContentEventType are used elsewhere**

Run: `grep -r "StageType\|ContentEventType" core/ web_api/ --include="*.py" | grep -v "enums.py"`

**Step 2: If not used, remove the enums**

Delete:
```python
class StageType(str, enum.Enum):
    article = "article"
    video = "video"
    chat = "chat"

class ContentEventType(str, enum.Enum):
    heartbeat = "heartbeat"
    start = "start"
    complete = "complete"
```

**Step 3: Run Python lint**

Run: `ruff check core/enums.py`
Expected: No errors

**Step 4: Commit**

```bash
jj describe -m "refactor: remove StageType and ContentEventType enums"
jj new
```

---

## Phase 5: Remove Old Tests

### Task 5.1: Remove core/modules/tests/test_sessions.py

**Files:**
- Delete: `core/modules/tests/test_sessions.py`

**Step 1: Delete the file**

```bash
rm core/modules/tests/test_sessions.py
```

**Step 2: Run remaining tests to ensure nothing breaks**

Run: `pytest core/modules/tests/ -v`
Expected: All remaining tests pass

**Step 3: Commit**

```bash
jj describe -m "test: remove old session tests"
jj new
```

---

### Task 5.2: Remove or Update web_api/tests/test_modules_api.py

**Files:**
- Modify or Delete: `web_api/tests/test_modules_api.py`

**Step 1: Check what tests exist**

Read the file to see if any tests are still valid for remaining endpoints.

**Step 2: Remove tests for deleted endpoints**

Remove tests for:
- Session creation
- Session claiming
- Anonymous session access
- Any `/api/module-sessions/*` endpoints

**Step 3: Keep tests for remaining endpoints**

If there are tests for `/api/modules` or `/api/modules/{slug}` (module listing/fetching), keep those.

**Step 4: Run tests**

Run: `pytest web_api/tests/test_modules_api.py -v`
Expected: All remaining tests pass

**Step 5: Commit**

```bash
jj describe -m "test: remove old module-sessions API tests"
jj new
```

---

## Phase 6: Database Migration

### Task 6.1: Create Migration to Drop Old Tables

**Files:**
- Create: `alembic/versions/005_drop_old_progress_tables.py`

**Step 1: Generate migration file**

```bash
alembic revision -m "Drop old progress tables"
```

**Step 2: Edit the migration**

```python
"""Drop old progress tables.

Revision ID: 005
Revises: 004
Create Date: 2026-01-27
"""

from alembic import op

# revision identifiers
revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop content_events first (has FK to module_sessions)
    op.drop_table("content_events")

    # Drop module_sessions
    op.drop_table("module_sessions")

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS stage_type_enum")
    op.execute("DROP TYPE IF EXISTS content_event_type_enum")


def downgrade() -> None:
    # We don't support downgrade - old system is gone
    raise NotImplementedError("Cannot restore old progress tables")
```

**Step 3: Verify migration syntax**

Run: `python -c "from alembic.versions import *; print('OK')"`
Expected: No syntax errors

**Step 4: Commit**

```bash
jj describe -m "migration: add migration to drop old progress tables"
jj new
```

---

## Phase 7: Final Verification

### Task 7.1: Run Full Test Suite

**Step 1: Run Python tests**

Run: `pytest --tb=short`
Expected: All tests pass

**Step 2: Run frontend lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No errors

**Step 3: Run Python lint**

Run: `ruff check . && ruff format --check .`
Expected: No errors

---

### Task 7.2: Verify No Old System References Remain

**Step 1: Search for old table references**

Run: `grep -r "module_sessions\|content_events" --include="*.py" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v ".pyc" | grep -v alembic/versions | grep -v docs/plans`

Expected: No results (only migration files and docs should reference them)

**Step 2: Search for old endpoint references**

Run: `grep -r "module-sessions" --include="*.py" --include="*.ts" --include="*.tsx" . | grep -v node_modules`

Expected: No results

**Step 3: Search for old function references**

Run: `grep -r "create_session\|get_session\|claim_session\|SessionNotFoundError" --include="*.py" --include="*.ts" . | grep -v node_modules | grep -v ".pyc"`

Expected: No results (except possibly chat_sessions which is the new system)

---

### Task 7.3: Final Commit

```bash
jj describe -m "refactor: complete removal of old progress tracking system"
jj new
```

---

## Notes for Implementer

1. **Facilitator Panel:** The removal of `core/queries/progress.py` will break the facilitator panel. This needs separate work to update it to use new tables.

2. **Chat Functionality:** Module.tsx chat features need to be rewired to use `chat_sessions` API. This may require creating new endpoints or updating existing ones.

3. **Order Matters:** Follow the phases in order. Frontend first (to stop using old endpoints), then backend (to remove endpoints), then database (to clean up).

4. **Testing:** After each phase, run the relevant tests to catch issues early.

5. **No Backwards Compatibility:** This plan assumes we're fully committed to the new system. There's no rollback path for the database migration.
