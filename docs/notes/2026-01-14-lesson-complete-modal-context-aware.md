# Context-Aware Lesson Completion Modal

**Date:** 2026-01-14
**Status:** Planning complete, ready for implementation

## Goal

Make the lesson completion popup CTAs context-aware based on:
1. Whether the user is enrolled in a cohort (signups table) or in an active group (groups_users table)
2. The current route context (standalone lesson vs course lesson)

## Current State

**`LessonCompleteModal.tsx`** shows static buttons:
- "Join the Full Course" → `/signup`
- "Return to Home" → `/`

The lesson title is already dynamic (passed via `lessonTitle` prop).

## What Already Exists

| Component | Location | Notes |
|-----------|----------|-------|
| Next lesson API | `GET /api/courses/:slug/next-lesson?current=:lessonSlug` | Returns `{nextLessonSlug, nextLessonTitle}` or 204 if last |
| Enrollment check | `GET /api/cohorts/available` | Returns `{enrolled: [...], available: [...]}` for auth'd users |
| Route distinction | `App.tsx` | `/lesson/:id` (standalone) vs `/course/:courseId/lesson/:lessonId` |
| Auth hook | `useAuth.ts` | Provides `isAuthenticated`, `user` |

## What's Needed

### Backend (small)

Add enrollment status to `/auth/me` response or new endpoint:
```json
{
  "isEnrolled": true,    // EXISTS in signups table
  "inActiveGroup": true  // EXISTS in groups_users with active status
}
```

Query logic: check `signups` table for any row with user_id, check `groups_users` for active membership.

### Frontend

**Update `LessonCompleteModal` props:**
```typescript
interface Props {
  isOpen: boolean;
  lessonTitle?: string;
  courseId?: string;      // NEW - from route params
  lessonId?: string;      // NEW - current lesson slug
  isEnrolled?: boolean;   // NEW - from enrollment check
  nextLesson?: { slug: string; title: string } | null;  // NEW
}
```

**CTA Logic:**

| Route | Enrolled? | Has Next? | Primary CTA | Secondary CTA |
|-------|-----------|-----------|-------------|---------------|
| `/lesson/:id` | No | - | Join Full Course → `/signup` | View Course → `/course/default` |
| `/lesson/:id` | Yes | - | View Course → `/course/default` | - |
| `/course/:id/lesson/:lid` | No | - | Join Full Course → `/signup` | Return to Course |
| `/course/:id/lesson/:lid` | Yes | Yes | Next Lesson → next lesson URL | Return to Course |
| `/course/:id/lesson/:lid` | Yes | No | Return to Course → `/course/:id` | - |

### Implementation in `UnifiedLesson.tsx`

1. Extract `courseId` from `useParams()` (already available)
2. When `session.completed` becomes true:
   - If authenticated: fetch enrollment status
   - If in course context: call `getNextLesson(courseId, lessonId)`
3. Pass computed values to `LessonCompleteModal`

## Estimated Effort

- Backend: ~30 min (add fields to existing query)
- Frontend: ~2 hours (modal updates, data fetching, testing routes)

## Files to Modify

- `web_api/routes/auth.py` or `web_api/routes/users.py` - add enrollment status
- `web_frontend/src/components/unified-lesson/LessonCompleteModal.tsx` - new props & logic
- `web_frontend/src/pages/UnifiedLesson.tsx` - fetch enrollment & next lesson on completion
