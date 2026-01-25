# Progress Tracking Redesign

## Problem

The current progress tracking system has fundamental issues:

1. **LocalStorage not synced to database** - Section completion is tracked in `localStorage` but never persisted to the database. Users lose progress on device/browser changes.

2. **Index-based tracking is fragile** - `current_stage_index` breaks when sections are reordered or replaced. Progress becomes meaningless after content restructuring.

3. **No granular content identifiers** - Modules have slugs, but Learning Outcomes and Lenses have no stable identifiers. Can't track completion at these levels.

4. **Module completion never recorded** - The `completed_at` field in `module_sessions` is never set. Marking a module complete only fires analytics, doesn't update DB.

5. **Coupled concerns** - `module_sessions` conflates chat history, progress tracking, and activity logging into one table.

## Solution

Introduce stable UUIDs for all content, track completion independently at each level, and separate chat sessions from progress tracking.

### Design Principles

1. **UUIDs for identity** - Every piece of content (module, learning outcome, lens) gets a permanent UUID. Slugs and titles can change freely.

2. **Independent level tracking** - Module completion, LO completion, and lens completion are tracked separately. Restructuring content at one level doesn't invalidate progress at other levels.

3. **Derived progress** - "How far along in module X?" is computed by checking which lenses within X are complete, not stored as an index.

4. **Anonymous claiming via token** - Anonymous users get a session token stored in localStorage. On login, all records with that token are claimed.

## Content Identifiers

Each content file gets an `id` field in frontmatter:

```yaml
# Module (modules/introduction.md)
---
id: 550e8400-e29b-41d4-a716-446655440000
slug: introduction
title: Introduction
---

# Learning Outcome (Learning Outcomes/objections-l1.md)
---
id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
title: Realize objections and rebuttals exist
---

# Lens (Lenses/10-reasons.md)
---
id: f47ac10b-58cc-4372-a567-0e02b2c3d479
title: 10 Reasons to Ignore AI Safety
---
```

- **id** (UUID): Permanent, never changes. Used for database tracking.
- **slug** (modules only): Human-readable URL segment. Can be renamed.
- **title**: Display name. Can be changed freely.

### Content Types

| Type | Description |
|------|-------------|
| `module` | A learning module (collection of LOs/lenses) |
| `lo` | Learning Outcome - a specific skill/knowledge to acquire |
| `lens` | A lens/perspective teaching toward an LO (video, article, chat) |
| `test` | Knowledge assessment (future feature) |

**Note:** "Narrative" modules (sections embedded directly in markdown) are being phased out in favor of the LO/Lens structure. Only the LO/Lens format needs UUIDs.

## Database Schema

### Tables to DROP

```sql
DROP TABLE content_events;  -- Replaced by time tracking in user_content_progress
DROP TABLE module_sessions; -- Replaced by chat_sessions
```

### New Tables

```sql
-- Track completion and engagement time for all content types
CREATE TABLE user_content_progress (
    id SERIAL PRIMARY KEY,
    session_token UUID,                    -- For anonymous claiming
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    content_id UUID NOT NULL,              -- UUID from frontmatter
    content_type VARCHAR(20) NOT NULL,     -- 'module', 'lo', 'lens'
    content_title TEXT NOT NULL,           -- Snapshot at creation (for historical reference)
    started_at TIMESTAMPTZ DEFAULT NOW(),
    time_to_complete_s INTEGER DEFAULT 0,  -- Frozen at completion
    total_time_spent_s INTEGER DEFAULT 0,  -- Keeps accumulating on revisits
    completed_at TIMESTAMPTZ,              -- NULL until marked complete

    -- content_type required: always tracking specific content
    CONSTRAINT valid_content_type CHECK (content_type IN ('module', 'lo', 'lens', 'test'))
);

-- Unique constraint for authenticated users (partial)
CREATE UNIQUE INDEX idx_user_content_progress_user
    ON user_content_progress(user_id, content_id)
    WHERE user_id IS NOT NULL;

-- Unique constraint for anonymous users (partial)
CREATE UNIQUE INDEX idx_user_content_progress_anon
    ON user_content_progress(session_token, content_id)
    WHERE session_token IS NOT NULL;

-- Non-partial index on session_token for claiming UPDATE performance
CREATE INDEX idx_user_content_progress_token
    ON user_content_progress(session_token)
    WHERE session_token IS NOT NULL;

-- Chat message history, optionally linked to content
CREATE TABLE chat_sessions (
    session_id SERIAL PRIMARY KEY,
    session_token UUID,                    -- For anonymous claiming
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    content_id UUID,                       -- NULL for standalone chats
    content_type VARCHAR(20),              -- 'module', 'lo', 'lens', 'test', NULL
    messages JSONB DEFAULT '[]',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    archived_at TIMESTAMPTZ,               -- NULL = active, set = archived

    -- content_type nullable: allows standalone/general chats not linked to content
    CONSTRAINT valid_chat_content_type CHECK (
        content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test')
    )
);

CREATE INDEX idx_chat_sessions_user_content ON chat_sessions(user_id, content_id, archived_at);
CREATE INDEX idx_chat_sessions_token ON chat_sessions(session_token);
```

## Data Flow

### User Opens a Module

1. Parse module markdown to get list of lens UUIDs
2. Query `user_content_progress` for those UUIDs
3. Calculate progress: `completed_count / total_count`
4. Query `chat_sessions` for active chat (where `content_id = module_uuid AND archived_at IS NULL`)
5. If no chat exists, create one

```sql
-- Get completion status for lenses in a module
SELECT content_id, completed_at
FROM user_content_progress
WHERE user_id = $1 AND content_id = ANY($2);  -- $2 = array of lens UUIDs
```

### User Marks Lens Complete

1. Check if progress record exists
2. If not, create one with `started_at = NOW()`
3. Set `completed_at = NOW()`, freeze `time_to_complete_s`

**Note:** PostgreSQL `ON CONFLICT` cannot reference partial unique indexes directly. Use application-level upsert logic instead:

```python
# Authenticated user
async def mark_complete_authenticated(user_id: int, content_id: UUID, ...):
    existing = await conn.fetchrow(
        "SELECT id FROM user_content_progress WHERE user_id = $1 AND content_id = $2",
        user_id, content_id
    )
    if existing:
        await conn.execute(
            "UPDATE user_content_progress SET completed_at = NOW(), time_to_complete_s = $1 WHERE id = $2",
            time_spent, existing["id"]
        )
    else:
        await conn.execute(
            """INSERT INTO user_content_progress
               (user_id, content_id, content_type, content_title, started_at, completed_at, time_to_complete_s)
               VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)""",
            user_id, content_id, content_type, content_title, time_spent
        )

# Anonymous user (same pattern, but with session_token instead of user_id)
async def mark_complete_anonymous(session_token: UUID, content_id: UUID, ...):
    existing = await conn.fetchrow(
        "SELECT id FROM user_content_progress WHERE session_token = $1 AND content_id = $2",
        session_token, content_id
    )
    # ... same INSERT/UPDATE pattern with session_token instead of user_id
```

### Time Tracking

1. Client tracks active time (pauses on tab blur/inactivity)
2. Client sends accumulated time periodically (every 60s) and on page unload
3. Server updates `total_time_spent_s`
4. If `completed_at` is NULL, also update `time_to_complete_s`

```sql
-- For authenticated users
UPDATE user_content_progress
SET total_time_spent_s = total_time_spent_s + $1,
    time_to_complete_s = CASE WHEN completed_at IS NULL THEN time_to_complete_s + $1 ELSE time_to_complete_s END
WHERE user_id = $2 AND content_id = $3;

-- For anonymous users
UPDATE user_content_progress
SET total_time_spent_s = total_time_spent_s + $1,
    time_to_complete_s = CASE WHEN completed_at IS NULL THEN time_to_complete_s + $1 ELSE time_to_complete_s END
WHERE session_token = $2 AND content_id = $3;
```

**Multi-tab limitation:** If a user has the same content open in multiple tabs, time may be double-counted. This is an acceptable margin of error. Future improvement: client-side coordination via localStorage to designate one "active" tab.

### User Resets Chat

1. Set `archived_at = NOW()` on current chat session
2. Create new chat session for same content
3. Progress records are unaffected

```sql
UPDATE chat_sessions SET archived_at = NOW() WHERE session_id = $1;
INSERT INTO chat_sessions (user_id, content_id, content_type, ...) VALUES (...);
```

### Anonymous User Flow

1. Generate `session_token` (UUID), store in localStorage
2. All progress and chat records use this token, `user_id = NULL`
3. On login, claim all records:

```sql
UPDATE user_content_progress SET user_id = $1 WHERE session_token = $2;
UPDATE chat_sessions SET user_id = $1 WHERE session_token = $2;
```

## UI Behavior

### Module Status Calculation

A module's status is derived from its lenses' completion states:

| Status | Condition |
|--------|-----------|
| `not_started` | No lenses in the module have progress records |
| `in_progress` | At least one lens has a progress record, but not all required lenses are completed |
| `completed` | All required (non-optional) lenses have `completed_at` set |

```python
def get_module_status(user_id: int, module: Module) -> str:
    lens_ids = [lens.id for lens in module.lenses if not lens.optional]

    completions = query("""
        SELECT content_id, completed_at
        FROM user_content_progress
        WHERE user_id = $1 AND content_id = ANY($2)
    """, user_id, lens_ids)

    if not completions:
        return "not_started"

    completed_count = sum(1 for c in completions if c.completed_at)
    if completed_count >= len(lens_ids):
        return "completed"

    return "in_progress"
```

### Course Overview Page

Shows all modules in the course with their completion status.

**Data fetched:**
1. Course structure (modules, their lens UUIDs)
2. User's progress records for all lens UUIDs in the course

**Display per module:**
- Module title
- Status badge: "Not Started" / "In Progress" / "Completed"
- Progress fraction: "3/5 lenses" (optional lenses excluded from count)
- Visual indicator (icon, color, checkmark)

```
┌─────────────────────────────────────────────────────────────┐
│ Unit 1                                                       │
├─────────────────────────────────────────────────────────────┤
│ ○ Introduction                     Not Started    0/3       │
│ ◐ Core Concepts                    In Progress    2/4       │
│ ● Advanced Topics                  Completed      5/5   ✓   │
│ ○ Optional: Deep Dive              Not Started    0/2       │
└─────────────────────────────────────────────────────────────┘
```

**Clicking a module:** Opens the Module Overview panel showing lens-level progress.

### Module Overview Panel

Shows detailed progress within a single module (right panel on course overview, or drawer in module viewer).

**Data fetched:**
1. Module structure (lenses, their UUIDs, titles, types)
2. User's progress records for those lens UUIDs

**Display per lens:**
- Lens title
- Lens type icon (video/article/chat)
- Completion status (filled/empty circle)
- Optional badge if applicable

```
┌─────────────────────────────────────────────────┐
│ Introduction                                     │
│                                                  │
│ ● Video: AI Safety Overview           ✓         │
│ │                                               │
│ ● Article: Core Arguments             ✓         │
│ │                                               │
│ ○ Chat: Discussion                              │
│ │                                               │
│ ○ Article: Further Reading        [Optional]    │
│                                                  │
│ Progress: 2/3 required lenses                   │
│                                                  │
│ [Continue Module]                               │
└─────────────────────────────────────────────────┘
```

**Visual rules:**
- Completed lens: filled circle (●), checkmark, muted styling
- Current/next lens: highlighted, prominent
- Future lenses: empty circle (○), dimmed
- Optional lenses: badge, don't count toward progress fraction

### Module Viewer - Horizontal Progress Bar

Top of screen, shows lens-level progress within current module.

**Data needed:**
- List of lens UUIDs in order
- Which lenses are completed (from `user_content_progress`)
- Current lens index (which lens user is viewing)

**Display:**
```
[●]───[●]───[◐]───[○]───[○]
 1     2     3     4     5
       ↑
    current
```

- Filled circles: completed lenses
- Half-filled/highlighted: current lens
- Empty circles: not yet completed
- Clicking a circle: navigates to that lens

**Behavior:**
- On page load: fetch completions, highlight current lens
- On marking complete: fill in circle, optionally auto-advance
- Progress bar is interactive (clickable navigation)

### Module Viewer - Vertical Progress Bar (Drawer)

Side drawer showing same info as Module Overview panel, but within the module viewer.

**Same data and display as Module Overview Panel**, but:
- Collapsible drawer (hamburger menu on mobile)
- Current lens highlighted more prominently
- "Mark Complete" action available inline

### Marking a Lens Complete

**Trigger:** User clicks "Mark Complete" button at end of lens content.

**Actions:**
1. API call: create/update `user_content_progress` with `completed_at = NOW()`
2. Update UI immediately (optimistic update):
   - Fill in progress bar circle
   - Update progress fraction
   - Check if module is now complete
3. **Auto-advance** to the next lens (no confirmation needed)
4. If all required lenses complete:
   - Auto-create module-level completion record
   - Show completion modal (see below)

### Module Completion Modal

Shown when user completes the last required lens in a module.

```
┌─────────────────────────────────────────────────┐
│                                                  │
│            🎉 Module Completed!                 │
│                                                  │
│     You've finished "Introduction"              │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │ View Optional Content (2 lenses)        │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ Continue to Next Module →               │   │
│  └─────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────┐   │
│  │ Back to Course Overview                 │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Options:**
- **View Optional Content:** Only shown if module has incomplete optional lenses. Takes user to first optional lens.
- **Continue to Next Module:** Takes user to next module in course (first lens).
- **Back to Course Overview:** Returns to course overview page.

### "Continue Module" Navigation

When user clicks "Continue Module" from course overview or module overview panel:

**Destination:** First non-optional, non-completed lens.

Example: Module has lenses [1, 2, 3, 4*] where 4* is optional.
- User completed 1 and 3 → lands on lens 2
- User completed 1, 2, 3 → lands on lens 4 (optional) or shows completion modal
- User completed all → shows "Review Module" button instead, lands on lens 1

### Revisiting Completed Lenses

User can click any lens (completed or not) from progress bar or drawer.

**Behavior:** Show lens content normally. Progress bar shows it filled (blue) to indicate already completed. No special banner needed - the visual state is clear from the progress bar.

**API request:**
```json
POST /api/progress/complete
{
  "content_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "content_type": "lens",
  "time_spent_s": 342
}
```

**API response:**
```json
{
  "completed_at": "2026-01-27T15:30:00Z",
  "module_status": "in_progress",  // or "completed" if this was the last lens
  "module_progress": { "completed": 3, "total": 5 }
}
```

### Progress API Endpoints

**GET `/api/courses/{course_slug}/progress`**

Returns course structure with user's progress overlaid.

```json
{
  "course": { "slug": "default", "title": "AI Safety Course" },
  "units": [
    {
      "meetingNumber": 1,
      "modules": [
        {
          "id": "550e8400-...",
          "slug": "introduction",
          "title": "Introduction",
          "status": "in_progress",
          "progress": { "completed": 2, "total": 3 },
          "lenses": [
            {
              "id": "f47ac10b-...",
              "title": "10 Reasons",
              "type": "video",
              "optional": false,
              "completed": true,
              "completedAt": "2026-01-25T10:00:00Z"
            },
            // ...
          ]
        }
      ]
    }
  ]
}
```

**GET `/api/modules/{module_slug}/progress`**

Returns detailed progress for a single module (used by module viewer).

```json
{
  "module": {
    "id": "550e8400-...",
    "slug": "introduction",
    "title": "Introduction"
  },
  "status": "in_progress",
  "progress": { "completed": 2, "total": 3 },
  "lenses": [
    {
      "id": "f47ac10b-...",
      "title": "10 Reasons",
      "type": "video",
      "optional": false,
      "completed": true,
      "completedAt": "2026-01-25T10:00:00Z",
      "timeSpentS": 542
    },
    // ...
  ],
  "chatSession": {
    "sessionId": 123,
    "hasMessages": true
  }
}
```

**POST `/api/progress/complete`**

Mark content as complete.

**POST `/api/progress/time`**

Update time spent (periodic heartbeat).

```json
{
  "content_id": "f47ac10b-...",
  "time_delta_s": 60
}
```

### Anonymous User Handling

All progress APIs work for both authenticated and anonymous users:

**Authenticated:** Use `user_id` from JWT token.

**Anonymous:** Client sends `X-Session-Token` header with UUID from localStorage.

```typescript
// Frontend: include session token in requests
const headers = isAuthenticated
  ? { Authorization: `Bearer ${jwt}` }
  : { "X-Session-Token": getSessionToken() };

fetch("/api/progress/complete", { headers, ... });
```

**Backend:** Check for auth first, fall back to session token.

```python
async def get_user_or_token(request: Request) -> tuple[int | None, UUID | None]:
    user = await get_optional_user(request)
    if user:
        return user["user_id"], None

    token = request.headers.get("X-Session-Token")
    if token:
        return None, UUID(token)

    raise HTTPException(401, "Authentication required")
```

## Content Restructuring Scenarios

### Lens Removed from Module

- User's module completion preserved
- User's lens completion preserved (orphaned but valid)
- Module progress recalculates based on current lenses

### Lens Added to Module

- User's module completion preserved
- New lens shows as "not completed"
- UI can show "new content available" indicator

### Module Restructured Completely

- User's module completion preserved
- Individual lens completions preserved
- Progress derived from current structure + existing completions

### Content Updated Significantly

- Give it a new UUID (it's meaningfully different content)
- Old completion records remain valid for old UUID
- New content starts fresh

## Migration Plan

### Phase 1: Add UUIDs to Content (prerequisite)

1. Generate UUIDs for all existing modules, LOs, lenses
2. Add `id:` field to frontmatter in educational content repo
3. Deploy content changes

### Phase 2: Schema Migration

1. Create new tables (`user_content_progress`, `chat_sessions`)
2. Update markdown parser to extract UUIDs
3. Create temporary `module_uuid_lookup` table mapping slug → UUID:

```sql
CREATE TEMP TABLE module_uuid_lookup (slug TEXT PRIMARY KEY, uuid UUID, title TEXT);
-- Populated by parsing all module files
```

### Phase 3: Migrate Existing Data

```sql
-- Migrate module_sessions to chat_sessions
-- Note: Anonymous sessions (user_id IS NULL) get new random tokens that no client knows about.
-- These sessions become unclaimable. This is acceptable since they represent incomplete progress
-- and there's no way to link old sessions to client localStorage.
INSERT INTO chat_sessions (session_token, user_id, content_id, content_type, messages, started_at, last_active_at)
SELECT
    CASE WHEN user_id IS NULL THEN gen_random_uuid() ELSE NULL END,  -- Token only for anonymous
    user_id,
    m.uuid,
    'module',
    ms.messages,
    ms.started_at,
    ms.last_active_at
FROM module_sessions ms
JOIN module_uuid_lookup m ON m.slug = ms.module_slug;

-- Migrate completed modules to user_content_progress
INSERT INTO user_content_progress (user_id, content_id, content_type, content_title, started_at, completed_at)
SELECT
    ms.user_id,
    m.uuid,
    'module',
    m.title,
    ms.started_at,
    ms.completed_at
FROM module_sessions ms
JOIN module_uuid_lookup m ON m.slug = ms.module_slug
WHERE ms.completed_at IS NOT NULL;
```

### Phase 4: Update Backend

1. Update API routes to use new tables
2. Add time tracking endpoints
3. Update claiming logic:
   - Accept `session_token` instead of individual `session_id`
   - Claim all records in both tables with matching token
   - Existing `claim_session` function in `sessions.py` needs rewrite

### Phase 5: Update Frontend

1. Replace localStorage completion tracking with API calls
2. Implement client-side time accumulation + periodic sync
3. Fetch progress from API instead of localStorage
4. Generate and store session_token in localStorage for anonymous users
5. One-time cleanup: remove legacy `module-completed-*` keys from localStorage
6. Update `useAnonymousSession` hook to use `session_token` instead of `session_id`

### Phase 6: Retire Old Tables

**Do NOT drop old tables.** Keep them as historical record.

```sql
-- Rename to indicate they're archived
ALTER TABLE module_sessions RENAME TO module_sessions_archived;
ALTER TABLE content_events RENAME TO content_events_archived;

-- Optional: add comment
COMMENT ON TABLE module_sessions_archived IS 'Archived 2026-01-XX. Replaced by chat_sessions and user_content_progress.';
COMMENT ON TABLE content_events_archived IS 'Archived 2026-01-XX. Replaced by time tracking in user_content_progress.';
```

Old tables remain read-only. If migration had issues, original data is still available.

## Migration Safety

1. **Backup before migration**: `pg_dump` the database before running migration scripts
2. **Test on staging first**: Run full migration on staging with copy of production data
3. **Verify data**: Spot-check migrated records match originals
4. **Keep old tables**: Never drop - rename to `_archived` as historical record
5. **Rollback plan**: If new code has issues, old tables still have the data

## Decisions

### 1. UUID Generation Workflow

**Decision: Manual.** Authors generate UUIDs and add to frontmatter themselves.

### 2. Unique Constraint on Progress Records

**Decision: Yes, for now.** Unique constraint on `(user_id, content_id)`. Can remove later if we need "multiple attempts" tracking.

### 3. Content Types

**Decision:** Both `user_content_progress` and `chat_sessions` support content types: `'module'`, `'lo'`, `'lens'`, `'test'`.

### 4. Slug Storage

**Decision: UUID only.** No slug stored in `chat_sessions` or `user_content_progress`. Slug lookup happens at content load time.

### 5. Content Title Snapshot Timing

**Decision: On creation.** Captures what they saw when they started.

### 6. Pre-Migration Data

**localStorage:** Start fresh. Old section-index data doesn't map to new UUIDs. Acceptable loss.

**Database:** Migrate existing `module_sessions` data to new tables. See Migration Plan below.

## Success Criteria

1. Progress persists across devices for authenticated users
2. Content restructuring doesn't invalidate progress
3. Course overview correctly shows module/lens completion status
4. Anonymous users can claim their progress on login
5. Chat history loads correctly when returning to a module
6. Time spent is tracked accurately (within ~1 minute granularity)
