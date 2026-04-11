# Lesson to Module Rebrand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebrand "lesson" to "module" throughout the codebase, making narrative format the only module view.

**Architecture:** Rename `core/lessons/` → `core/modules/`, update all types/functions, rename API endpoints, update frontend routes and components, delete unified lesson code.

**Tech Stack:** Python/FastAPI, Next.js/React, PostgreSQL, Alembic

---

## Phase 1: Backend Core Package

### Task 1.1: Rename core/lessons directory to core/modules

**Files:**
- Rename: `core/lessons/` → `core/modules/`

**Step 1: Rename the directory**

```bash
mv core/lessons core/modules
```

**Step 2: Verify the rename**

```bash
ls core/modules/
```

Expected: All files present (types.py, loader.py, sessions.py, etc.)

**Step 3: Commit**

```bash
jj describe -m "refactor: rename core/lessons to core/modules"
```

---

### Task 1.2: Update core/modules/types.py - rename Lesson types to Module

**Files:**
- Modify: `core/modules/types.py`

**Step 1: Update the file**

Replace all Lesson terminology with Module:
- `Lesson` → `Module` (the dataclass at line ~134)
- `NarrativeLesson` → `NarrativeModule` (line ~125)
- `LessonRef` → `ModuleRef` (line ~143)
- `NextLesson` → `NextModule` (line ~170)
- Delete the deprecated `Module` class (lines 177-187) - it conflicts with our new naming
- Update docstrings: "lesson" → "module"
- Update `NextModule.lesson_slug` → `module_slug`, `lesson_title` → `module_title`

**Step 2: Run type check**

```bash
cd web_frontend_next && npm run build 2>&1 | head -20
```

(Backend has no type checker, but this validates the imports aren't broken)

**Step 3: Commit**

```bash
jj describe -m "refactor: rename Lesson types to Module in core/modules/types.py"
```

---

### Task 1.3: Update core/modules/loader.py - rename functions

**Files:**
- Modify: `core/modules/loader.py`

**Step 1: Update the file**

- `load_lesson()` → `load_module()`
- `load_narrative_lesson()` → `load_narrative_module()`
- `get_available_lessons()` → `get_available_modules()`
- `LessonNotFoundError` → `ModuleNotFoundError`
- Update return type hints: `Lesson` → `Module`, `NarrativeLesson` → `NarrativeModule`
- Update docstrings

**Step 2: Commit**

```bash
jj describe -m "refactor: rename lesson functions to module in loader.py"
```

---

### Task 1.4: Update core/modules/sessions.py - rename functions and queries

**Files:**
- Modify: `core/modules/sessions.py`

**Step 1: Update the file**

- `get_user_lesson_progress()` → `get_user_module_progress()`
- Update all SQL references: `lesson_sessions` → `module_sessions`, `lesson_slug` → `module_slug`
- Update parameter names: `lesson_slug` → `module_slug`
- Update docstrings

**Step 2: Commit**

```bash
jj describe -m "refactor: rename lesson to module in sessions.py"
```

---

### Task 1.5: Update core/modules/course_loader.py - rename functions

**Files:**
- Modify: `core/modules/course_loader.py`

**Step 1: Update the file**

- `get_next_lesson()` → `get_next_module()`
- `get_all_lesson_slugs()` → `get_all_module_slugs()`
- `get_lessons()` → `get_modules()`
- `get_required_lessons()` → `get_required_modules()`
- Update type hints: `LessonRef` → `ModuleRef`, `NextLesson` → `NextModule`
- Update docstrings

**Step 2: Commit**

```bash
jj describe -m "refactor: rename lesson functions to module in course_loader.py"
```

---

### Task 1.6: Update core/modules/chat.py - rename function

**Files:**
- Modify: `core/modules/chat.py`

**Step 1: Update the file**

- Function alias or rename to `send_module_message`
- Update docstrings

**Step 2: Commit**

```bash
jj describe -m "refactor: rename send_lesson_message to send_module_message"
```

---

### Task 1.7: Update core/modules/content.py - update references

**Files:**
- Modify: `core/modules/content.py`

**Step 1: Update the file**

- `bundle_narrative_lesson()` → `bundle_narrative_module()`
- Update type hints: `NarrativeLesson` → `NarrativeModule`
- Update docstrings

**Step 2: Commit**

```bash
jj describe -m "refactor: rename lesson to module in content.py"
```

---

### Task 1.8: Update core/modules/__init__.py - update all exports

**Files:**
- Modify: `core/modules/__init__.py`

**Step 1: Update the file**

Update docstring, all imports and __all__ exports:
- `Lesson` → `Module`
- `NarrativeLesson` → `NarrativeModule`
- `LessonRef` → `ModuleRef`
- `load_lesson` → `load_module`
- `load_narrative_lesson` → `load_narrative_module`
- `get_available_lessons` → `get_available_modules`
- `LessonNotFoundError` → `ModuleNotFoundError`
- `get_user_lesson_progress` → `get_user_module_progress`
- `send_lesson_message` → `send_module_message`
- `get_next_lesson` → `get_next_module`
- `get_all_lesson_slugs` → `get_all_module_slugs`
- `get_lessons` → `get_modules`
- `get_required_lessons` → `get_required_modules`
- `bundle_narrative_lesson` → `bundle_narrative_module`

**Step 2: Commit**

```bash
jj describe -m "refactor: update core/modules/__init__.py exports"
```

---

### Task 1.9: Update core/modules/markdown_parser.py - rename types and functions

**Files:**
- Modify: `core/modules/markdown_parser.py`

**Step 1: Update types**

- `ParsedLesson` → `ParsedModule`
- `LessonRef` → `ModuleRef`
- Update docstrings: "lesson" → "module"

**Step 2: Update functions**

- `parse_lesson()` → `parse_module()`
- `parse_lesson_file()` → `parse_module_file()`

**Step 3: Update course parsing**

In `parse_course()`, the pattern `# Lesson:` in markdown needs to stay as-is (it's the content format), but:
- Variable names: `lesson_pattern` → `module_pattern` (optional, for consistency)
- The `LessonRef` class is now `ModuleRef`

**Step 4: Commit**

```bash
jj describe -m "refactor: rename ParsedLesson to ParsedModule in markdown_parser.py"
```

---

### Task 1.10: Update all imports from core.lessons to core.modules

**Files:**
- Modify: All files importing from `core.lessons` or `core/lessons`

**Step 1: Find all files with old imports**

```bash
grep -r "from core.lessons" --include="*.py" .
grep -r "from core import.*lesson" --include="*.py" .
grep -r "core/lessons" --include="*.py" .
```

**Step 2: Update each file**

Replace `core.lessons` → `core.modules` and update function/type names.

Common files:
- `web_api/routes/lessons.py`
- `web_api/routes/lesson.py`
- `web_api/routes/courses.py`
- `core/notifications/actions.py`
- `core/notifications/urls.py`
- `core/content/cache.py`
- `core/content/github_fetcher.py`

**Step 3: Commit**

```bash
jj describe -m "refactor: update all imports from core.lessons to core.modules"
```

---

## Phase 1b: Core Content Package

### Task 1b.1: Update core/content/cache.py

**Files:**
- Modify: `core/content/cache.py`

**Step 1: Update imports**

```python
# Before
from core.lessons.markdown_parser import ParsedLesson, ParsedCourse

# After
from core.modules.markdown_parser import ParsedModule, ParsedCourse
```

**Step 2: Update type references**

- `lessons: dict[str, ParsedLesson]` → `modules: dict[str, ParsedModule]`
- Update any docstrings

**Step 3: Commit**

```bash
jj describe -m "refactor: update core/content/cache.py for module rename"
```

---

### Task 1b.2: Update core/content/github_fetcher.py

**Files:**
- Modify: `core/content/github_fetcher.py`

**Step 1: Update imports**

```python
# Before
from core.lessons.markdown_parser import (
    parse_lesson,
    ParsedLesson,
    ...
)

# After
from core.modules.markdown_parser import (
    parse_module,
    ParsedModule,
    ...
)
```

**Step 2: Update directory path (content repo now uses modules/)**

```python
# Before
lesson_files = await _list_directory_with_client(client, "lessons")

# After
module_files = await _list_directory_with_client(client, "modules")
```

**Step 3: Update variable names and function calls**

- `lesson_files` → `module_files`
- `lessons: dict[str, ParsedLesson]` → `modules: dict[str, ParsedModule]`
- `parse_lesson(content)` → `parse_module(content)`
- `lessons[parsed.slug] = parsed` → `modules[parsed.slug] = parsed`
- Return value: `lessons=lessons` → `modules=modules`
- Print statement: `f"Loaded {len(cache.lessons)} lessons"` → `f"Loaded {len(cache.modules)} modules"`

**Step 4: Commit**

```bash
jj describe -m "refactor: update github_fetcher.py for module rename, fetch from modules/"
```

---

## Phase 2: Database Migration

### Task 2.1: Update core/tables.py - rename table and columns

**Files:**
- Modify: `core/tables.py`

**Step 1: Update the table definition**

```python
# Before
lesson_sessions = Table(
    "lesson_sessions",
    ...
    Column("lesson_slug", Text, nullable=False),
    ...
)

# After
module_sessions = Table(
    "module_sessions",
    ...
    Column("module_slug", Text, nullable=False),
    ...
)
```

Also update:
- Index names: `idx_lesson_sessions_*` → `idx_module_sessions_*`
- Foreign key in `content_events`: `lesson_sessions.session_id` → `module_sessions.session_id`
- Column in `content_events`: `lesson_slug` → `module_slug`
- Index: `idx_content_events_lesson_slug` → `idx_content_events_module_slug`

**Step 2: Commit**

```bash
jj describe -m "refactor: rename lesson_sessions to module_sessions in tables.py"
```

---

### Task 2.2: Generate and review Alembic migration

**Files:**
- Create: `alembic/versions/XXX_rename_lesson_to_module.py`

**Step 1: Generate migration**

```bash
alembic revision --autogenerate -m "rename lesson to module"
```

**Step 2: Review the generated migration**

Open the generated file and verify it uses:
- `op.rename_table('lesson_sessions', 'module_sessions')` (NOT drop+create)
- `op.alter_column(..., new_column_name=...)` (NOT drop+add)

If Alembic generated drop+create, manually edit to use rename operations.

**Step 3: Commit**

```bash
jj describe -m "db: add migration to rename lesson_sessions to module_sessions"
```

---

## Phase 3: Backend API Routes

### Task 3.1: Rename web_api/routes/lessons.py to modules.py

**Files:**
- Rename: `web_api/routes/lessons.py` → `web_api/routes/modules.py`

**Step 1: Rename file**

```bash
mv web_api/routes/lessons.py web_api/routes/modules.py
```

**Step 2: Update endpoint paths and function names in the file**

- `/api/lessons` → `/api/modules`
- `/api/lessons/{slug}` → `/api/modules/{slug}`
- `/api/lesson-sessions` → `/api/module-sessions`
- `/api/lesson-sessions/{session_id}` → `/api/module-sessions/{session_id}`
- Update all imports: `from core.lessons` → `from core.modules`
- Update function/type names

**Step 3: Commit**

```bash
jj describe -m "refactor: rename lessons.py to modules.py, update endpoints"
```

---

### Task 3.2: Rename web_api/routes/lesson.py to module.py

**Files:**
- Rename: `web_api/routes/lesson.py` → `web_api/routes/module.py`

**Step 1: Rename file**

```bash
mv web_api/routes/lesson.py web_api/routes/module.py
```

**Step 2: Update the file**

- Endpoint: `/api/chat/lesson` → `/api/chat/module`
- Class: `LessonChatRequest` → `ModuleChatRequest`
- Update imports

**Step 3: Commit**

```bash
jj describe -m "refactor: rename lesson.py to module.py"
```

---

### Task 3.3: Update web_api/routes/courses.py - rename endpoint

**Files:**
- Modify: `web_api/routes/courses.py`

**Step 1: Update the file**

- Endpoint: `/{course_slug}/next-lesson` → `/{course_slug}/next-module`
- Response fields: `nextLessonSlug` → `nextModuleSlug`, `nextLessonTitle` → `nextModuleTitle`
- Update imports: `get_next_lesson` → `get_next_module`

**Step 2: Commit**

```bash
jj describe -m "refactor: rename next-lesson endpoint to next-module"
```

---

### Task 3.4: Update main.py - router imports

**Files:**
- Modify: `main.py`

**Step 1: Update imports**

```python
# Before
from web_api.routes.lesson import router as lesson_router
from web_api.routes.lessons import router as lessons_router

# After
from web_api.routes.module import router as module_router
from web_api.routes.modules import router as modules_router
```

**Step 2: Update include_router calls**

```python
# Before
app.include_router(lesson_router)
app.include_router(lessons_router)

# After
app.include_router(module_router)
app.include_router(modules_router)
```

**Step 3: Commit**

```bash
jj describe -m "refactor: update main.py router imports for module rename"
```

---

## Phase 4: Backend Notifications

### Task 4.1: Update core/notifications/urls.py

**Files:**
- Modify: `core/notifications/urls.py`

**Step 1: Update the file**

- `build_lesson_url()` → `build_module_url()`
- URL path: `/lesson/` → `/module/`
- Parameter: `lesson_slug` → `module_slug`

**Step 2: Commit**

```bash
jj describe -m "refactor: rename build_lesson_url to build_module_url"
```

---

### Task 4.2: Update core/notifications/actions.py

**Files:**
- Modify: `core/notifications/actions.py`

**Step 1: Update the file**

- Import: `build_lesson_url` → `build_module_url`
- Variables: `lesson_url` → `module_url`
- Job IDs: `lesson_nudge` → `module_nudge`
- Message types: `lesson_nudge` → `module_nudge`
- Condition types: `lesson_progress` → `module_progress`

**Step 2: Commit**

```bash
jj describe -m "refactor: rename lesson to module in notifications/actions.py"
```

---

### Task 4.3: Update core/notifications/messages.yaml

**Files:**
- Modify: `core/notifications/messages.yaml`

**Step 1: Update the file**

- Message key: `lesson_nudge:` → `module_nudge:`
- Variables: `{lesson_url}` → `{module_url}`
- Variables: `{lesson_list}` → `{module_list}`
- Variables: `{lessons_remaining}` → `{modules_remaining}`
- Copy: "lessons" → "modules" in user-facing text

**Step 2: Commit**

```bash
jj describe -m "refactor: rename lesson to module in messages.yaml"
```

---

## Phase 5: Frontend Types

### Task 5.1: Delete unified-lesson.ts

**Files:**
- Delete: `web_frontend_next/src/types/unified-lesson.ts`

**Step 1: Delete the file**

```bash
rm web_frontend_next/src/types/unified-lesson.ts
```

**Step 2: Commit**

```bash
jj describe -m "refactor: delete unified-lesson.ts"
```

---

### Task 5.2: Rename narrative-lesson.ts to module.ts

**Files:**
- Rename: `web_frontend_next/src/types/narrative-lesson.ts` → `web_frontend_next/src/types/module.ts`

**Step 1: Rename file**

```bash
mv web_frontend_next/src/types/narrative-lesson.ts web_frontend_next/src/types/module.ts
```

**Step 2: Update type names in the file**

- `NarrativeLesson` → `Module`
- `NarrativeSection` → `ModuleSection`
- `NarrativeSegment` → `ModuleSegment`
- `NarrativeTextSection` → `TextSection`
- `NarrativeArticleSection` → `ArticleSection`
- `NarrativeVideoSection` → `VideoSection`

**Step 3: Commit**

```bash
jj describe -m "refactor: rename narrative-lesson.ts to module.ts, update types"
```

---

### Task 5.3: Update types/course.ts

**Files:**
- Modify: `web_frontend_next/src/types/course.ts`

**Step 1: Update the file**

- `LessonInfo` → `ModuleInfo`
- `LessonStatus` → `ModuleStatus`
- Field: `lessons: LessonInfo[]` → `modules: ModuleInfo[]`

**Step 2: Commit**

```bash
jj describe -m "refactor: rename Lesson types to Module in course.ts"
```

---

## Phase 6: Frontend API Client

### Task 6.1: Rename api/lessons.ts to api/modules.ts

**Files:**
- Rename: `web_frontend_next/src/api/lessons.ts` → `web_frontend_next/src/api/modules.ts`

**Step 1: Rename file**

```bash
mv web_frontend_next/src/api/lessons.ts web_frontend_next/src/api/modules.ts
```

**Step 2: Update the file**

Functions:
- `listLessons()` → `listModules()`
- `getLesson()` → `getModule()`
- `getNextLesson()` → `getNextModule()`

Endpoints:
- `/api/lessons` → `/api/modules`
- `/api/lesson-sessions` → `/api/module-sessions`
- `/next-lesson` → `/next-module`

Parameters and types:
- `lessonSlug` → `moduleSlug`
- Import types from `types/module` instead of `types/narrative-lesson`

**Step 3: Commit**

```bash
jj describe -m "refactor: rename lessons.ts to modules.ts, update endpoints"
```

---

## Phase 7: Frontend Routes

### Task 7.1: Delete legacy /lesson/[lessonId] route

**Files:**
- Delete: `web_frontend_next/src/app/lesson/` (entire directory)

**Step 1: Delete the directory**

```bash
rm -rf web_frontend_next/src/app/lesson
```

**Step 2: Commit**

```bash
jj describe -m "refactor: delete legacy /lesson route"
```

---

### Task 7.2: Delete /narrative/[lessonId] route

**Files:**
- Delete: `web_frontend_next/src/app/narrative/` (entire directory)

**Step 1: Delete the directory**

```bash
rm -rf web_frontend_next/src/app/narrative
```

**Step 2: Commit**

```bash
jj describe -m "refactor: delete /narrative route"
```

---

### Task 7.3: Rename /course/[courseId]/lesson to /course/[courseId]/module

**Files:**
- Rename: `web_frontend_next/src/app/course/[courseId]/lesson/` → `web_frontend_next/src/app/course/[courseId]/module/`
- Rename: `[lessonId]` → `[moduleId]`

**Step 1: Rename directories**

```bash
mv web_frontend_next/src/app/course/\[courseId\]/lesson web_frontend_next/src/app/course/\[courseId\]/module
mv web_frontend_next/src/app/course/\[courseId\]/module/\[lessonId\] web_frontend_next/src/app/course/\[courseId\]/module/\[moduleId\]
```

**Step 2: Update page.tsx**

- Remove type detection logic
- Import `Module` from `@/views/Module`
- Render `<Module module={moduleData} />` directly
- Update param name: `lessonId` → `moduleId`
- Update API call: `getModule(moduleId)` instead of type detection

**Step 3: Commit**

```bash
jj describe -m "refactor: rename /lesson route to /module, simplify to render Module only"
```

---

### Task 7.4: Update homepage link

**Files:**
- Modify: `web_frontend_next/src/app/page.tsx`

**Step 1: Update the link**

```tsx
// Before
<Link href="/course/default/lesson/introduction">

// After
<Link href="/course/default/module/introduction">
```

**Step 2: Commit**

```bash
jj describe -m "refactor: update homepage link to /module"
```

---

## Phase 8: Frontend Views

### Task 8.1: Delete UnifiedLesson.tsx

**Files:**
- Delete: `web_frontend_next/src/views/UnifiedLesson.tsx`

**Step 1: Delete the file**

```bash
rm web_frontend_next/src/views/UnifiedLesson.tsx
```

**Step 2: Commit**

```bash
jj describe -m "refactor: delete UnifiedLesson.tsx"
```

---

### Task 8.2: Rename NarrativeLesson.tsx to Module.tsx

**Files:**
- Rename: `web_frontend_next/src/views/NarrativeLesson.tsx` → `web_frontend_next/src/views/Module.tsx`

**Step 1: Rename file**

```bash
mv web_frontend_next/src/views/NarrativeLesson.tsx web_frontend_next/src/views/Module.tsx
```

**Step 2: Update the file**

- Component: `NarrativeLesson` → `Module`
- Props type: `NarrativeLessonProps` → `ModuleProps`
- Props: `lesson` → `module`
- Type imports from `@/types/module`
- Update internal variable names

**Step 3: Commit**

```bash
jj describe -m "refactor: rename NarrativeLesson.tsx to Module.tsx"
```

---

### Task 8.3: Update CourseOverview.tsx

**Files:**
- Modify: `web_frontend_next/src/views/CourseOverview.tsx`

**Step 1: Update navigation path**

```tsx
// Before
router.push(`/course/${courseId}/lesson/${selectedLesson.slug}`)

// After
router.push(`/course/${courseId}/module/${selectedModule.slug}`)
```

**Step 2: Update variable names and imports**

- `selectedLesson` → `selectedModule`
- `LessonOverview` → `ModuleOverview`
- Type: `LessonInfo` → `ModuleInfo`

**Step 3: Commit**

```bash
jj describe -m "refactor: update CourseOverview.tsx for module rename"
```

---

## Phase 9: Frontend Components

### Task 9.1: Delete unified-lesson components folder

**Files:**
- Delete: `web_frontend_next/src/components/unified-lesson/` (entire directory)

**Step 1: Delete the directory**

```bash
rm -rf web_frontend_next/src/components/unified-lesson
```

**Step 2: Commit**

```bash
jj describe -m "refactor: delete unified-lesson components folder"
```

---

### Task 9.2: Rename narrative-lesson folder to module

**Files:**
- Rename: `web_frontend_next/src/components/narrative-lesson/` → `web_frontend_next/src/components/module/`

**Step 1: Rename directory**

```bash
mv web_frontend_next/src/components/narrative-lesson web_frontend_next/src/components/module
```

**Step 2: Update imports in Module.tsx view**

Update import paths from `@/components/narrative-lesson/` to `@/components/module/`

**Step 3: Commit**

```bash
jj describe -m "refactor: rename narrative-lesson components folder to module"
```

---

### Task 9.3: Rename LessonHeader.tsx to ModuleHeader.tsx

**Files:**
- Rename: `web_frontend_next/src/components/LessonHeader.tsx` → `web_frontend_next/src/components/ModuleHeader.tsx`

**Step 1: Rename file**

```bash
mv web_frontend_next/src/components/LessonHeader.tsx web_frontend_next/src/components/ModuleHeader.tsx
```

**Step 2: Update component name and props**

- `LessonHeader` → `ModuleHeader`
- `LessonHeaderProps` → `ModuleHeaderProps`

**Step 3: Update imports in files that use it**

**Step 4: Commit**

```bash
jj describe -m "refactor: rename LessonHeader to ModuleHeader"
```

---

### Task 9.4: Rename LessonOverview.tsx to ModuleOverview.tsx

**Files:**
- Rename: `web_frontend_next/src/components/course/LessonOverview.tsx` → `web_frontend_next/src/components/course/ModuleOverview.tsx`

**Step 1: Rename file**

```bash
mv web_frontend_next/src/components/course/LessonOverview.tsx web_frontend_next/src/components/course/ModuleOverview.tsx
```

**Step 2: Update component name, props, and UI text**

- `LessonOverview` → `ModuleOverview`
- `LessonOverviewProps` → `ModuleOverviewProps`
- Props: `lesson` → `module`
- UI text: "Start Lesson" → "Start Module", "Continue Lesson" → "Continue Module", "Review Lesson" → "Review Module"

**Step 3: Update imports in CourseOverview.tsx

**Step 4: Commit**

```bash
jj describe -m "refactor: rename LessonOverview to ModuleOverview"
```

---

### Task 9.5: Update CourseSidebar.tsx

**Files:**
- Modify: `web_frontend_next/src/components/course/CourseSidebar.tsx`

**Step 1: Update props and types**

- `selectedLessonSlug` → `selectedModuleSlug`
- `onLessonSelect` → `onModuleSelect`
- `LessonInfo` → `ModuleInfo`
- `LessonStatusIcon` → `ModuleStatusIcon`
- `lesson` → `module` (variable names)

**Step 2: Commit**

```bash
jj describe -m "refactor: update CourseSidebar for module rename"
```

---

## Phase 10: Frontend Hooks

### Task 10.1: Update useAnonymousSession.ts

**Files:**
- Modify: `web_frontend_next/src/hooks/useAnonymousSession.ts`

**Step 1: Update the file**

- Storage key prefix: `lesson_session_` → `module_session_`
- Parameter: `lessonId` → `moduleId`

**Step 2: Commit**

```bash
jj describe -m "refactor: update useAnonymousSession for module rename"
```

---

### Task 10.2: Update useActivityTracker.ts

**Files:**
- Modify: `web_frontend_next/src/hooks/useActivityTracker.ts`

**Step 1: Update endpoint path**

`/api/lesson-sessions/` → `/api/module-sessions/`

**Step 2: Commit**

```bash
jj describe -m "refactor: update useActivityTracker endpoint for module rename"
```

---

### Task 10.3: Update useVideoActivityTracker.ts

**Files:**
- Modify: `web_frontend_next/src/hooks/useVideoActivityTracker.ts`

**Step 1: Update endpoint path**

`/api/lesson-sessions/` → `/api/module-sessions/`

**Step 2: Commit**

```bash
jj describe -m "refactor: update useVideoActivityTracker endpoint for module rename"
```

---

## Phase 11: Frontend Analytics

### Task 11.1: Update analytics.ts

**Files:**
- Modify: `web_frontend_next/src/analytics.ts`

**Step 1: Update function names and signatures (all 10 functions)**

| Before | After |
|--------|-------|
| `trackLessonStarted(lessonId, lessonTitle)` | `trackModuleStarted(moduleId, moduleTitle)` |
| `trackVideoStarted(lessonId)` | `trackVideoStarted(moduleId)` |
| `trackVideoCompleted(lessonId, watchDuration)` | `trackVideoCompleted(moduleId, watchDuration)` |
| `trackArticleScrolled(lessonId, percent)` | `trackArticleScrolled(moduleId, percent)` |
| `trackArticleCompleted(lessonId)` | `trackArticleCompleted(moduleId)` |
| `trackChatOpened(lessonId)` | `trackChatOpened(moduleId)` |
| `trackChatMessageSent(lessonId, messageLength)` | `trackChatMessageSent(moduleId, messageLength)` |
| `trackChatSessionEnded(lessonId, messageCount, durationSeconds)` | `trackChatSessionEnded(moduleId, messageCount, durationSeconds)` |
| `trackLessonCompleted(lessonId)` | `trackModuleCompleted(moduleId)` |

**Step 2: Update event names**

| Before | After |
|--------|-------|
| `lesson_started` | `module_started` |
| `lesson_completed` | `module_completed` |

**Step 3: Update event payload fields**

In all 10 functions, update:
- `lesson_id: lessonId` → `module_id: moduleId`
- `lesson_title: lessonTitle` → `module_title: moduleTitle`

**Step 4: Update comment**

```typescript
// Before
// Lesson events

// After
// Module events
```

**Step 5: Commit**

```bash
jj describe -m "refactor: rename lesson tracking to module in analytics.ts"
```

---

### Task 11.2: Update analytics calls in Module.tsx

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Update function calls**

- `trackLessonStarted()` → `trackModuleStarted()`
- `trackLessonCompleted()` → `trackModuleCompleted()`

**Step 2: Commit**

```bash
jj describe -m "refactor: update analytics calls in Module.tsx"
```

---

## Phase 12: Backend Tests

### Task 12.1: Rename web_api/tests/test_lessons_api.py

**Files:**
- Rename: `web_api/tests/test_lessons_api.py` → `web_api/tests/test_modules_api.py`

**Step 1: Rename file**

```bash
mv web_api/tests/test_lessons_api.py web_api/tests/test_modules_api.py
```

**Step 2: Update endpoints and assertions in the file**

**Step 3: Run tests**

```bash
pytest web_api/tests/test_modules_api.py -v
```

**Step 4: Commit**

```bash
jj describe -m "test: rename test_lessons_api.py to test_modules_api.py"
```

---

### Task 12.2: Update notification tests

**Files:**
- Modify: `core/notifications/tests/test_urls.py`
- Modify: `core/notifications/tests/test_actions.py` (if exists)

**Step 1: Update test function names and assertions**

- `test_builds_lesson_url` → `test_builds_module_url`
- Update expected URL paths

**Step 2: Run tests**

```bash
pytest core/notifications/tests/ -v
```

**Step 3: Commit**

```bash
jj describe -m "test: update notification tests for module rename"
```

---

### Task 12.3: Update core/content/tests

**Files:**
- Modify: `core/content/tests/test_cache.py`
- Modify: `core/content/tests/test_github_fetcher.py`

**Step 1: Update test_cache.py**

- Import: `from core.lessons.markdown_parser import ParsedLesson` → `from core.modules.markdown_parser import ParsedModule`
- Variable: `test_lesson = ParsedLesson(...)` → `test_module = ParsedModule(...)`
- Dict key: `lessons={"test-lesson": test_lesson}` → `modules={"test-module": test_module}`
- Assertions: `cache.lessons` → `cache.modules`
- Test names: `test_cache_stores_lessons` → `test_cache_stores_modules`

**Step 2: Update test_github_fetcher.py**

- Update path references: `"lessons/test.md"` → `"modules/test.md"`
- Update variable names: `lesson_md` → `module_md`
- Update assertions: `cache.lessons` → `cache.modules`
- Update list_directory calls: `"lessons"` → `"modules"`

**Step 3: Run tests**

```bash
pytest core/content/tests/ -v
```

**Step 4: Commit**

```bash
jj describe -m "test: update core/content tests for module rename"
```

---

### Task 12.4: Update web_api/tests/test_courses_api.py and conftest.py

**Files:**
- Modify: `web_api/tests/test_courses_api.py`
- Modify: `web_api/tests/conftest.py`

**Step 1: Update test_courses_api.py**

- Endpoint: `/next-lesson` → `/next-module`
- Response fields: `nextLessonSlug` → `nextModuleSlug`, `nextLessonTitle` → `nextModuleTitle`
- Update imports if any reference `core.lessons`

**Step 2: Update conftest.py**

- Update any fixtures that create `ParsedLesson` → `ParsedModule`
- Update any fixtures that reference `LessonRef` → `ModuleRef`
- Update any mock data with `lesson` terminology

**Step 3: Run tests**

```bash
pytest web_api/tests/ -v
```

**Step 4: Commit**

```bash
jj describe -m "test: update web_api tests for module rename"
```

---

### Task 12.5: Update all core/modules/tests files

**Files:**
- `core/modules/tests/test_types.py`
- `core/modules/tests/test_sessions.py`
- `core/modules/tests/test_loader.py`
- `core/modules/tests/test_courses.py`
- `core/modules/tests/test_content.py`
- `core/modules/tests/test_llm.py`
- `core/modules/tests/test_markdown_parser.py`
- `core/modules/tests/conftest.py`

**Step 1: Update each file**

For each test file:
- Update imports: `from core.lessons` → `from core.modules`
- Update type names: `Lesson` → `Module`, `NarrativeLesson` → `NarrativeModule`, etc.
- Update function names in tests: `test_load_lesson` → `test_load_module`, etc.
- Update variable names: `lesson` → `module`
- Update fixture data

**Step 2: Run tests**

```bash
pytest core/modules/tests/ -v
```

**Step 3: Commit**

```bash
jj describe -m "test: update all core/modules tests for rename"
```

---

## Phase 13: Final Cleanup

### Task 13.1: Find and fix any remaining "lesson" references

**Step 1: Search for remaining references**

```bash
grep -r "lesson" --include="*.py" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v ".next" | grep -v __pycache__ | grep -v ".pyc"
```

**Step 2: Fix any remaining references**

(Some may be intentional - e.g., in comments or documentation about the rename)

**Step 3: Commit**

```bash
jj describe -m "refactor: fix remaining lesson references"
```

---

### Task 13.2: Run linter and type checks

**Step 1: Run frontend checks**

```bash
cd web_frontend_next
npm run lint
npm run build
npx prettier --check src/
```

**Step 2: Run backend checks**

```bash
ruff check .
ruff format --check .
```

**Step 3: Fix any issues**

**Step 4: Commit fixes**

```bash
jj describe -m "fix: linter and type errors from module rename"
```

---

### Task 13.3: Run all tests

**Step 1: Run backend tests**

```bash
pytest
```

**Step 2: Run frontend build**

```bash
cd web_frontend_next && npm run build
```

**Step 3: Fix any failures**

**Step 4: Final commit**

```bash
jj describe -m "test: all tests passing after module rename"
```

---

## Deployment Notes

1. **Deploy together**: Backend + DB migration + frontend must ship together
2. **Migration order**: Alembic migration runs before app starts (or manually first)
3. **Verify**: After deploy, test `/course/default/module/introduction` loads correctly
