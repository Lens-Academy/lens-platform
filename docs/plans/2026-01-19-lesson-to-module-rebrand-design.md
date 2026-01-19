# Lesson to Module Rebrand Design

## Overview

Rebrand "lesson" to "module" throughout the codebase and make the narrative format the only way to view modules. Delete the old unified lesson system.

## Key Decisions

- **Clean break** - No backwards compatibility, no redirects
- **Delete unified lesson** - Code removed entirely (git history is backup)
- **Rename in place** - Database table/columns renamed via Alembic migration
- **Rename analytics events** - Accept discontinuity with historical data
- **Direct text substitution** - "lesson" → "module" in UI copy
- **Keep "Start Learning"** - Homepage button text stays inviting

## What Stays the Same

- Module slugs (e.g., `introduction`, `goal-misgeneralization`)
- Overall app architecture (FastAPI + Next.js)
- Session management pattern
- "Start Learning" button text on homepage

## Changes by Layer

### Database

Update `core/tables.py`:
- Class: `LessonSession` → `ModuleSession`
- Table: `lesson_sessions` → `module_sessions`
- Column: `lesson_slug` → `module_slug`

Generate Alembic migration and **review carefully** - ensure it detects renames (not drop+create).

### Backend (`core/`)

Rename package: `core/lessons/` → `core/modules/`

| File | Key Changes |
|------|-------------|
| `types.py` | `Lesson` → `Module`, `NarrativeLesson` → `NarrativeModule`, `LessonRef` → `ModuleRef`, `LessonNotFoundError` → `ModuleNotFoundError` |
| `loader.py` | `load_lesson()` → `load_module()`, `load_narrative_lesson()` → `load_narrative_module()`, `get_available_lessons()` → `get_available_modules()` |
| `sessions.py` | `get_user_lesson_progress()` → `get_user_module_progress()`, update SQL queries |
| `course_loader.py` | `get_next_lesson()` → `get_next_module()`, `get_all_lesson_slugs()` → `get_all_module_slugs()` |
| `chat.py` | `send_lesson_message()` → `send_module_message()` |
| `__init__.py` | Update all exports |

### API Routes (`web_api/routes/`)

- `lessons.py` → `modules.py`
- `lesson.py` → `module.py`

Endpoint changes:
| From | To |
|------|-----|
| `GET /api/lessons` | `GET /api/modules` |
| `GET /api/lessons/{slug}` | `GET /api/modules/{slug}` |
| `POST /api/lesson-sessions` | `POST /api/module-sessions` |
| `GET /api/lesson-sessions/{id}` | `GET /api/module-sessions/{id}` |
| `POST /api/lesson-sessions/{id}/message` | `POST /api/module-sessions/{id}/message` |
| `GET /{course}/next-lesson` | `GET /{course}/next-module` |

Update `main.py` router registrations.

### Frontend Routes

**Delete**:
- `src/app/lesson/[lessonId]/` (legacy)
- `src/app/narrative/[lessonId]/` (redundant)

**Rename**:
- `src/app/course/[courseId]/lesson/[lessonId]/` → `src/app/course/[courseId]/module/[moduleId]/`

**Simplify** route logic - remove type detection, just render `Module` directly.

**Update** homepage link: `/course/default/lesson/introduction` → `/course/default/module/introduction`

### Frontend Views

**Delete**: `src/views/UnifiedLesson.tsx`

**Rename**: `src/views/NarrativeLesson.tsx` → `src/views/Module.tsx`

**Update**: `src/views/CourseOverview.tsx` - navigation paths

### Frontend Components

**Delete**: `src/components/unified-lesson/` (entire folder)

**Rename**:
| From | To |
|------|-----|
| `components/LessonHeader.tsx` | `ModuleHeader.tsx` |
| `components/course/LessonOverview.tsx` | `ModuleOverview.tsx` |
| `components/narrative-lesson/` | `components/module/` |

**Update**: `CourseSidebar.tsx` props and types

### Frontend Types

**Delete**: `src/types/unified-lesson.ts`

**Rename**: `src/types/narrative-lesson.ts` → `src/types/module.ts`
- `NarrativeLesson` → `Module`
- `NarrativeSection` → `ModuleSection`
- `NarrativeSegment` → `ModuleSegment`

**Update** `src/types/course.ts`:
- `LessonInfo` → `ModuleInfo`
- `LessonStatus` → `ModuleStatus`
- Field `lessons` → `modules`

### Frontend API Client

Rename `src/api/lessons.ts` → `src/api/modules.ts`

| Function | Rename To |
|----------|-----------|
| `listLessons()` | `listModules()` |
| `getLesson()` | `getModule()` |
| `getNextLesson()` | `getNextModule()` |

Update all endpoint paths.

### Frontend Hooks

| File | Changes |
|------|---------|
| `useAnonymousSession.ts` | Storage key `lesson_session_` → `module_session_`, param `lessonId` → `moduleId` |
| `useActivityTracker.ts` | Endpoint paths |
| `useVideoActivityTracker.ts` | Endpoint paths |

### Analytics (`src/analytics.ts`)

| Function | Rename To | Event Name |
|----------|-----------|------------|
| `trackLessonStarted()` | `trackModuleStarted()` | `module_started` |
| `trackLessonCompleted()` | `trackModuleCompleted()` | `module_completed` |

All functions: `lessonId` param → `moduleId`, field `lesson_id` → `module_id`

### Notifications (`core/notifications/`)

| File | Changes |
|------|---------|
| `urls.py` | `build_lesson_url()` → `build_module_url()`, path `/lesson/` → `/module/` |
| `actions.py` | Job IDs `lesson_nudge` → `module_nudge` |
| `messages.yaml` | Variables `{lesson_url}` → `{module_url}`, `{lessons_remaining}` → `{modules_remaining}` |

### Tests

- Rename `core/lessons/tests/` → `core/modules/tests/`
- Rename `web_api/tests/test_lessons_api.py` → `test_modules_api.py`
- Update all imports, function names, assertions
- Update `conftest.py` fixture types

## Execution Order

1. Backend - `core/lessons/` → `core/modules/`, types, loaders
2. Database - Update `tables.py`, generate + review Alembic migration
3. API routes - Rename endpoints, update `main.py`
4. Frontend types - `types/module.ts`, `types/course.ts`
5. Frontend API client - `api/modules.ts`
6. Frontend routes - Rename, delete legacy routes
7. Frontend views - Delete `UnifiedLesson`, rename `NarrativeLesson` → `Module`
8. Frontend components - Delete `unified-lesson/`, rename remaining
9. Hooks & analytics - Update all references
10. Notifications - URLs, messages
11. Tests - Update all test files
12. Final cleanup - Remove orphaned imports, run linter

## Deployment

**Coordinated deploy required** - Backend + DB migration + frontend must ship together:
1. Deploy backend + migration together
2. Migration runs on startup
3. Frontend deploy immediately after

## Risks

- **Coordinated deploy** - All layers must ship together
- **Analytics discontinuity** - New event names won't match historical queries (accepted)
- **Broken external links** - Any links to `/lesson/` will 404 (accepted, clean break)

## Rollback

Revert git commits + run Alembic downgrade.
