# NarrativeLesson Progress & Feature Parity Design

Bring NarrativeLesson's header, progress tracking, and supporting features in line with UnifiedLesson by reusing existing components.

## Overview

**Goal:** Add UnifiedLesson's progress tracking, modals, activity tracking, and analytics to NarrativeLesson while adapting for its scroll-based navigation model.

**Key difference from UnifiedLesson:** NarrativeLesson uses explicit "Mark completed" buttons instead of automatic stage advancement, with scroll position determining the "currently viewed" section.

## Header & Progress Bar

**Current NarrativeLesson header:**
- Simple: title on left, "Exit" link on right
- Sticky section title bar below
- Vertical ProgressSidebar on left

**New header (reuse UnifiedLesson pattern):**
- Logo + "Lens Academy" | Lesson title (left)
- Horizontal `StageProgressBar` (center) - icons for each section, clickable
- Skip section | Drawer toggle | Auth status (right)

**Removals:**
- Sticky section title bar (redundant with progress bar)
- `ProgressSidebar` component (vertical sidebar)
- `pl-20` padding on main content (was for sidebar)

**Progress bar behavior:**
- Shows section icons (article/video/chat) horizontally with connecting lines
- Completed sections: blue/filled
- Current section (by scroll): ring indicator
- Incomplete sections: gray
- Clicking a section scrolls to it smoothly
- Previous/Next arrows for navigation

## Section Completion & Scroll Tracking

**"Mark completed" button:**
- Appears at the bottom of each section
- Styled consistently (emerald/green CTA)
- Once clicked: section marked complete, button changes to "Completed ✓" (disabled)
- Completion state persisted to session

**Scroll-based "current section" (hybrid rule):**
- Section is "current" if it occupies >50% of viewport, OR is fully visible
- Tie-breaker for multiple fully-visible short sections: topmost wins

**Stage navigation from header:**
- "Skip section" marks current section complete and scrolls to next
- Previous/Next arrows scroll between sections (don't affect completion)

## Modals & Auth Flow

**LessonCompleteModal:**
- Triggers when all sections are marked complete
- Reuse existing component directly
- Shows lesson title, congratulations, next lesson link (if in course context)
- "Stay on lesson" option to dismiss

**AuthPromptModal:**
- Triggers after completing first section (for anonymous users)
- Reuse existing component
- "Sign in to save progress" / "Continue without signing in"
- Only prompts once per session (`hasPromptedAuth` flag)

**Session claiming:**
- When authenticated user has anonymous session, call `claimSession()` to link it
- Reuse existing logic from UnifiedLesson

## Activity Tracking & Analytics

**Activity tracking (reuse hooks):**
- `useActivityTracker` for article/text sections (3 min inactivity timeout)
- `useActivityTracker` for chat segments (5 min inactivity timeout)
- `useVideoActivityTracker` for video sections (tracks play/pause/progress)

**Analytics events (reuse functions):**
- `trackLessonStarted` - on session creation
- `trackLessonCompleted` - when all sections marked complete
- `trackChatOpened` - when chat segment comes into view
- `trackChatMessageSent` - on message send

**Error handling:**
- `RequestTimeoutError` handling with user-friendly messages
- Sentry integration for content loading failures
- Retry handlers for failed content loads

## Components to Reuse

Directly from `unified-lesson/`:
- `LessonHeader` (may need minor prop adjustments for sections vs stages)
- `StageProgressBar`
- `LessonDrawer` + `LessonDrawerToggle`
- `LessonCompleteModal`
- `AuthPromptModal`
- `HeaderAuthStatus`

Hooks:
- `useActivityTracker`
- `useVideoActivityTracker`
- `useAuth`
- `useAnonymousSession` (already used)
- `useHeaderLayout`

## New Code Needed

1. **MarkCompleteButton** - simple button component for section completion
2. **Hybrid scroll detection** - replace current IntersectionObserver with >50% OR fully-visible logic
3. **Section completion state** - track which sections are complete, persist to session
4. **API integration** - endpoint for persisting section completion (may need backend work)

## File Changes

**Modify:**
- `src/views/NarrativeLesson.tsx` - main refactor

**Remove:**
- `src/components/narrative-lesson/ProgressSidebar.tsx`

**Add:**
- `src/components/narrative-lesson/MarkCompleteButton.tsx` (or inline)
