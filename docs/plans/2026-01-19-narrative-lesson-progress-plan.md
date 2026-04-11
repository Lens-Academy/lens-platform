# NarrativeLesson Progress & Feature Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add progress tracking, modals, activity tracking, and analytics to NarrativeLesson, matching UnifiedLesson's feature set while adapting for scroll-based navigation.

**Architecture:** Reuse existing unified-lesson components (LessonHeader, StageProgressBar, modals) with minimal adaptation. Add explicit "Mark completed" buttons at section ends. Replace IntersectionObserver with hybrid scroll detection (>50% viewport OR fully visible).

**Tech Stack:** React 18, Next.js, TypeScript, Tailwind CSS

---

### Task 1: Add Section Completion State with localStorage Persistence

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Add completion state with localStorage persistence**

Add these state variables after the existing state declarations (around line 60):

```typescript
// Section completion tracking (persisted to localStorage)
const [completedSections, setCompletedSections] = useState<Set<number>>(() => {
  if (typeof window === "undefined") return new Set();
  const stored = localStorage.getItem(`narrative-completed-${lesson.slug}`);
  return stored ? new Set(JSON.parse(stored)) : new Set();
});

// Persist completion state to localStorage
useEffect(() => {
  localStorage.setItem(
    `narrative-completed-${lesson.slug}`,
    JSON.stringify([...completedSections])
  );
}, [completedSections, lesson.slug]);
```

**Step 2: Run dev server to verify no errors**

Run: `cd web_frontend_next && npm run dev`
Expected: Compiles without errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add section completion state with localStorage persistence"
```

---

### Task 2: Create MarkCompleteButton Component

**Files:**
- Create: `web_frontend_next/src/components/narrative-lesson/MarkCompleteButton.tsx`

**Step 1: Create the component**

```typescript
// web_frontend_next/src/components/narrative-lesson/MarkCompleteButton.tsx
"use client";

type MarkCompleteButtonProps = {
  isCompleted: boolean;
  onComplete: () => void;
};

export default function MarkCompleteButton({
  isCompleted,
  onComplete,
}: MarkCompleteButtonProps) {
  if (isCompleted) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-2 text-emerald-600">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium">Section completed</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-6">
      <button
        onClick={onComplete}
        className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Mark section complete
      </button>
    </div>
  );
}
```

**Step 2: Run type check**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add MarkCompleteButton component"
```

---

### Task 3: Add MarkCompleteButton to NarrativeLesson Sections

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Import the component**

Add import at top of file:

```typescript
import MarkCompleteButton from "@/components/narrative-lesson/MarkCompleteButton";
```

**Step 2: Add completion handler**

Add after the `handleSectionClick` callback (around line 224):

```typescript
const handleMarkComplete = useCallback((sectionIndex: number) => {
  setCompletedSections((prev) => {
    const next = new Set(prev);
    next.add(sectionIndex);
    return next;
  });
}, []);
```

**Step 3: Add MarkCompleteButton to each section**

In the section render (around line 343-358), add the button after section content:

Replace this block:
```typescript
{section.type === "text" ? (
  <>
    <SectionDivider type="article" />
    <AuthoredText content={section.content} />
  </>
) : (
  <>
    <SectionDivider type={section.type} />
    {section.segments.map((segment, segmentIndex) =>
      renderSegment(segment, section, sectionIndex, segmentIndex),
    )}
  </>
)}
```

With:
```typescript
{section.type === "text" ? (
  <>
    <SectionDivider type="article" />
    <AuthoredText content={section.content} />
  </>
) : (
  <>
    <SectionDivider type={section.type} />
    {section.segments.map((segment, segmentIndex) =>
      renderSegment(segment, section, sectionIndex, segmentIndex),
    )}
  </>
)}
<MarkCompleteButton
  isCompleted={completedSections.has(sectionIndex)}
  onComplete={() => handleMarkComplete(sectionIndex)}
/>
```

**Step 4: Run dev server and verify visually**

Run: `cd web_frontend_next && npm run dev`
Expected: Button appears at end of each section, clicking marks it complete

**Step 5: Commit**

```bash
jj describe -m "feat(narrative): integrate MarkCompleteButton into sections"
```

---

### Task 4: Update Scroll Detection to Hybrid Rule

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Replace IntersectionObserver with hybrid detection**

Replace the existing scroll tracking useEffect (lines 154-184) with:

```typescript
// Scroll tracking with hybrid rule: >50% viewport OR fully visible, topmost wins
useEffect(() => {
  const calculateCurrentSection = () => {
    const viewportHeight = window.innerHeight;
    let bestIndex = 0;
    let bestTopPosition = Infinity;

    sectionRefs.current.forEach((el, index) => {
      const rect = el.getBoundingClientRect();

      // Calculate visible portion of section
      const visibleTop = Math.max(0, rect.top);
      const visibleBottom = Math.min(viewportHeight, rect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      // Check if section is fully visible
      const isFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;

      // Check if section takes >50% of viewport
      const viewportCoverage = visibleHeight / viewportHeight;
      const takesHalfViewport = viewportCoverage > 0.5;

      // Section qualifies if fully visible OR takes >50% of viewport
      // For ties, prefer topmost (smallest rect.top)
      if (isFullyVisible || takesHalfViewport) {
        if (rect.top < bestTopPosition) {
          bestIndex = index;
          bestTopPosition = rect.top;
        }
      }
    });

    setCurrentSectionIndex(bestIndex);
  };

  // Throttle scroll handler with requestAnimationFrame
  let ticking = false;
  const handleScroll = () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        calculateCurrentSection();
        ticking = false;
      });
      ticking = true;
    }
  };

  // Initial calculation (after refs are populated)
  const timeout = setTimeout(calculateCurrentSection, 0);

  window.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", calculateCurrentSection);

  return () => {
    clearTimeout(timeout);
    window.removeEventListener("scroll", handleScroll);
    window.removeEventListener("resize", calculateCurrentSection);
  };
}, [lesson.sections]);
```

**Step 2: Remove the old scrollProgress tracking useEffect**

Delete lines 187-216 (the scrollProgress tracking effect) - it's no longer needed.

Also remove the `scrollProgress` state variable if present.

**Step 3: Run dev server and test scroll behavior**

Run: `cd web_frontend_next && npm run dev`
Expected: Current section updates as you scroll, handles short sections correctly

**Step 4: Commit**

```bash
jj describe -m "feat(narrative): implement hybrid scroll detection for current section"
```

---

### Task 5: Add LessonHeader with StageProgressBar

**Note:** Add header BEFORE removing sidebar so there's always a progress indicator.

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Add necessary imports**

Add these imports at the top:

```typescript
import { LessonHeader } from "@/components/LessonHeader";
import LessonDrawer from "@/components/unified-lesson/LessonDrawer";
import type { Stage } from "@/types/unified-lesson";
import type { StageInfo } from "@/types/course";
import { useAuth } from "@/hooks/useAuth";
```

**Step 2: Add auth hook and drawer state**

After existing state declarations, add:

```typescript
const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } = useAuth();

// Drawer state
const [drawerOpen, setDrawerOpen] = useState(false);

// For stage navigation (viewing non-current section)
const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(null);
```

**Step 3: Add section-to-stage conversion and completion index**

Add this useMemo after the state declarations:

```typescript
// Derive furthest completed index for progress bar display
// Progress bar shows stages as "reached" based on this, not scroll position
const furthestCompletedIndex = useMemo(() => {
  let max = -1;
  completedSections.forEach((idx) => {
    if (idx > max) max = idx;
  });
  return max;
}, [completedSections]);

// Convert sections to Stage format for progress bar
// StageProgressBar only uses the `type` field for icon display
const stages: Stage[] = useMemo(() => {
  return lesson.sections.map((section): Stage => {
    const stageType = section.type === "text" ? "article" : section.type;
    if (stageType === "article") {
      return { type: "article", source: "", from: null, to: null };
    } else if (stageType === "video" && section.type === "video") {
      return { type: "video", videoId: section.videoId, from: 0, to: null };
    } else {
      return {
        type: "chat",
        instructions: "",
        showUserPreviousContent: false,
        showTutorPreviousContent: false,
      };
    }
  });
}, [lesson.sections]);

// Convert to StageInfo format for drawer
const stagesForDrawer: StageInfo[] = useMemo(() => {
  return lesson.sections.map((section, index) => ({
    type: section.type === "text" ? "article" : section.type,
    title:
      section.type === "text"
        ? `Section ${index + 1}`
        : section.meta.title || `${section.type} ${index + 1}`,
    duration: null,
    optional: false,
  }));
}, [lesson.sections]);
```

**Step 4: Add navigation handlers**

Add these callbacks in this exact order (handleStageClick first, then handlers that depend on it):

```typescript
const handleLoginClick = useCallback(() => {
  sessionStorage.setItem("returnToLesson", lesson.slug);
  login();
}, [lesson.slug, login]);

const handleStageClick = useCallback(
  (index: number) => {
    // Scroll to section
    const el = sectionRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
    setViewingStageIndex(index === currentSectionIndex ? null : index);
  },
  [currentSectionIndex]
);

const handlePrevious = useCallback(() => {
  const prevIndex = Math.max(0, currentSectionIndex - 1);
  handleStageClick(prevIndex);
}, [currentSectionIndex, handleStageClick]);

const handleNext = useCallback(() => {
  const nextIndex = Math.min(lesson.sections.length - 1, currentSectionIndex + 1);
  handleStageClick(nextIndex);
}, [currentSectionIndex, lesson.sections.length, handleStageClick]);

const handleSkipSection = useCallback(() => {
  // Mark current as complete and go to next
  handleMarkComplete(currentSectionIndex);
  handleNext();
}, [currentSectionIndex, handleMarkComplete, handleNext]);
```

**Step 5: Replace existing header**

Replace the existing header (lines 295-316) and sticky section title (lines 318-324) with:

```typescript
<LessonHeader
  lessonTitle={lesson.title}
  stages={stages}
  currentStageIndex={furthestCompletedIndex + 1}
  viewingStageIndex={viewingStageIndex}
  isViewingOther={viewingStageIndex !== null && viewingStageIndex !== currentSectionIndex}
  canGoPrevious={currentSectionIndex > 0}
  canGoNext={currentSectionIndex < lesson.sections.length - 1}
  onStageClick={handleStageClick}
  onPrevious={handlePrevious}
  onNext={handleNext}
  onReturnToCurrent={() => setViewingStageIndex(null)}
  onSkipSection={handleSkipSection}
  onDrawerOpen={() => setDrawerOpen(true)}
  onLoginClick={handleLoginClick}
/>
```

**Step 6: Add LessonDrawer at end of component**

Before the closing `</div>` of the main container, add:

```typescript
<LessonDrawer
  isOpen={drawerOpen}
  onClose={() => setDrawerOpen(false)}
  lessonTitle={lesson.title}
  stages={stagesForDrawer}
  currentStageIndex={furthestCompletedIndex + 1}
  viewedStageIndex={viewingStageIndex ?? currentSectionIndex}
  onStageClick={(index) => {
    handleStageClick(index);
    setDrawerOpen(false);
  }}
/>
```

**Step 7: Run dev server and verify header appears**

Run: `cd web_frontend_next && npm run dev`
Expected: New header with progress bar appears, drawer opens on click

**Step 8: Commit**

```bash
jj describe -m "feat(narrative): add LessonHeader with StageProgressBar and LessonDrawer"
```

---

### Task 6: Remove ProgressSidebar and Update Layout

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`
- Delete: `web_frontend_next/src/components/narrative-lesson/ProgressSidebar.tsx`

**Step 1: Remove ProgressSidebar import and usage**

Remove this import:
```typescript
import ProgressSidebar from "@/components/narrative-lesson/ProgressSidebar";
```

Remove ProgressSidebar component usage (around line 327-331):
```typescript
{/* Progress sidebar */}
<ProgressSidebar
  sections={lesson.sections}
  sectionRefs={sectionRefs}
  onSectionClick={handleSectionClick}
/>
```

**Step 2: Remove pl-20 padding from main content**

Change:
```typescript
<main className="pl-20">
```

To:
```typescript
<main>
```

**Step 3: Delete ProgressSidebar file**

Run: `rm web_frontend_next/src/components/narrative-lesson/ProgressSidebar.tsx`

**Step 4: Run type check to ensure no broken imports**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
jj describe -m "refactor(narrative): remove ProgressSidebar, update layout"
```

---

### Task 7: Add LessonCompleteModal

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Add imports and state**

Add import:
```typescript
import LessonCompleteModal from "@/components/unified-lesson/LessonCompleteModal";
import { getNextLesson } from "@/api/lessons";
import type { LessonCompletionResult } from "@/api/lessons";
```

Add state:
```typescript
const [lessonCompletionResult, setLessonCompletionResult] = useState<LessonCompletionResult>(null);
const [completionModalDismissed, setCompletionModalDismissed] = useState(false);
```

**Step 2: Add completion detection**

Add a derived value:
```typescript
const isLessonComplete = completedSections.size === lesson.sections.length;
```

**Step 3: Add effect to fetch next lesson on completion**

```typescript
// Fetch next lesson info when lesson completes
useEffect(() => {
  if (!isLessonComplete) return;

  // For now, we don't have courseId in NarrativeLesson props
  // This can be added later when course context is available
  setLessonCompletionResult(null);
}, [isLessonComplete]);
```

**Step 4: Add modal component**

Before the closing `</div>`, add:

```typescript
<LessonCompleteModal
  isOpen={isLessonComplete && !completionModalDismissed}
  lessonTitle={lesson.title}
  courseId={undefined}
  isInSignupsTable={isInSignupsTable}
  isInActiveGroup={isInActiveGroup}
  nextLesson={
    lessonCompletionResult?.type === "next_lesson"
      ? { slug: lessonCompletionResult.slug, title: lessonCompletionResult.title }
      : null
  }
  completedUnit={
    lessonCompletionResult?.type === "unit_complete"
      ? lessonCompletionResult.unitNumber
      : null
  }
  onClose={() => setCompletionModalDismissed(true)}
/>
```

**Step 5: Run dev server and test completion**

Run: `cd web_frontend_next && npm run dev`
Expected: Modal appears when all sections are marked complete

**Step 6: Commit**

```bash
jj describe -m "feat(narrative): add LessonCompleteModal"
```

---

### Task 8: Add AuthPromptModal

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Add import**

```typescript
import AuthPromptModal from "@/components/unified-lesson/AuthPromptModal";
```

**Step 2: Add state**

```typescript
const [showAuthPrompt, setShowAuthPrompt] = useState(false);
const [hasPromptedAuth, setHasPromptedAuth] = useState(false);
```

**Step 3: Update handleMarkComplete to trigger auth prompt**

Replace handleMarkComplete with (note: side effects moved OUTSIDE setState callback):

```typescript
const handleMarkComplete = useCallback(
  (sectionIndex: number) => {
    // Check if this is the first completion (for auth prompt)
    // Must check BEFORE updating state
    const isFirstCompletion = completedSections.size === 0;

    setCompletedSections((prev) => {
      const next = new Set(prev);
      next.add(sectionIndex);
      return next;
    });

    // Prompt for auth after first section completion (if anonymous)
    if (isFirstCompletion && !isAuthenticated && !hasPromptedAuth) {
      setShowAuthPrompt(true);
      setHasPromptedAuth(true);
    }
  },
  [completedSections.size, isAuthenticated, hasPromptedAuth]
);
```

**Step 4: Add modal component**

```typescript
<AuthPromptModal
  isOpen={showAuthPrompt}
  onLogin={handleLoginClick}
  onDismiss={() => setShowAuthPrompt(false)}
/>
```

**Step 5: Run dev server and test auth prompt**

Run: `cd web_frontend_next && npm run dev`
Expected: Auth prompt appears after completing first section (when not logged in)

**Step 6: Commit**

```bash
jj describe -m "feat(narrative): add AuthPromptModal for anonymous users"
```

---

### Task 9: Add Session Claiming

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Add import**

```typescript
import { claimSession } from "@/api/lessons";
```

**Step 2: Update session initialization to claim on auth**

Replace the existing session init useEffect (lines 66-87) with:

```typescript
// Initialize session
useEffect(() => {
  async function init() {
    const storedId = getStoredSessionId();
    if (storedId) {
      try {
        const state = await getSession(storedId);
        setSessionId(storedId);
        setMessages(state.messages);

        // If user is now authenticated, try to claim the session
        if (isAuthenticated) {
          try {
            await claimSession(storedId);
          } catch {
            // Session already claimed or other error - ignore
          }
        }
        return;
      } catch {
        clearSessionId();
      }
    }

    // Create new session
    const sid = await createSession(lesson.slug);
    storeSessionId(sid);
    setSessionId(sid);
  }

  init();
}, [lesson.slug, getStoredSessionId, storeSessionId, clearSessionId, isAuthenticated]);
```

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add session claiming for authenticated users"
```

---

### Task 10: Add Activity Tracking Hooks

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`
- Modify: `web_frontend_next/src/components/narrative-lesson/VideoEmbed.tsx`

**Step 1: Add imports**

```typescript
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useVideoActivityTracker } from "@/hooks/useVideoActivityTracker";
```

**Step 2: Add activity trackers**

```typescript
// Activity tracking for current section
const currentSection = lesson.sections[currentSectionIndex];
const currentSectionType =
  currentSection?.type === "text" ? "article" : currentSection?.type;

// Article/text activity tracking (3 min inactivity timeout)
useActivityTracker({
  sessionId: sessionId ?? 0,
  stageIndex: currentSectionIndex,
  stageType: "article",
  inactivityTimeout: 180_000,
  enabled:
    !!sessionId &&
    (currentSectionType === "article" || currentSection?.type === "text"),
});

// Video activity tracking
const videoTracker = useVideoActivityTracker({
  sessionId: sessionId ?? 0,
  stageIndex: currentSectionIndex,
  enabled: !!sessionId && currentSectionType === "video",
});

// Chat activity tracking (5 min inactivity timeout)
const { triggerActivity: triggerChatActivity } = useActivityTracker({
  sessionId: sessionId ?? 0,
  stageIndex: currentSectionIndex,
  stageType: "chat",
  inactivityTimeout: 300_000,
  enabled: !!sessionId && currentSectionType === "chat",
});
```

**Step 3: Update VideoEmbed to accept optional callbacks**

Check if VideoEmbed already accepts these props. If not, add them:

```typescript
// In web_frontend_next/src/components/narrative-lesson/VideoEmbed.tsx
type VideoEmbedProps = {
  videoId: string;
  start: number;
  end: number;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
};
```

**Step 4: Pass video tracker to VideoEmbed**

In the `renderSegment` function, update the video-excerpt case to pass tracker callbacks:

```typescript
case "video-excerpt":
  if (section.type !== "video") return null;
  return (
    <VideoEmbed
      key={`video-${keyPrefix}`}
      videoId={section.videoId}
      start={segment.from}
      end={segment.to}
      onPlay={videoTracker.onPlay}
      onPause={videoTracker.onPause}
      onTimeUpdate={videoTracker.onTimeUpdate}
    />
  );
```

**Step 5: Trigger chat activity on message send**

In handleSendMessage, add at the start of the function:

```typescript
triggerChatActivity();
```

**Step 6: Commit**

```bash
jj describe -m "feat(narrative): add activity tracking hooks"
```

---

### Task 11: Add Analytics Events

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Add imports**

```typescript
import {
  trackLessonStarted,
  trackLessonCompleted,
  trackChatOpened,
  trackChatMessageSent,
} from "@/analytics";
```

**Step 2: Add tracking ref**

```typescript
const hasTrackedLessonStart = useRef(false);
```

**Step 3: Track lesson started on session creation**

In the session init useEffect, after creating new session (after `setSessionId(sid);`):

```typescript
// Track lesson start (only for new sessions)
if (!hasTrackedLessonStart.current) {
  hasTrackedLessonStart.current = true;
  trackLessonStarted(lesson.slug, lesson.title);
}
```

**Step 4: Track lesson completed**

Add effect:

```typescript
useEffect(() => {
  if (isLessonComplete) {
    trackLessonCompleted(lesson.slug);
  }
}, [isLessonComplete, lesson.slug]);
```

**Step 5: Track chat messages in handleSendMessage**

Update handleSendMessage to track (add after `if (content) {` on line ~108):

```typescript
if (content) {
  setPendingMessage({ content, status: "sending" });
  trackChatMessageSent(lesson.slug, content.length);
}
```

**Step 6: Commit**

```bash
jj describe -m "feat(narrative): add analytics tracking"
```

---

### Task 12: Add Error Handling with Sentry

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Add imports**

```typescript
import { Sentry } from "@/errorTracking";
import { RequestTimeoutError } from "@/api/lessons";
```

**Step 2: Add error state**

```typescript
const [error, setError] = useState<string | null>(null);
```

**Step 3: Wrap session init with error handling**

Update the session init useEffect to handle errors by wrapping the `init()` call:

```typescript
async function init() {
  try {
    // ... existing init logic ...
  } catch (e) {
    console.error("[NarrativeLesson] Session init failed:", e);
    if (e instanceof RequestTimeoutError) {
      setError(
        "Content is taking too long to load. Please check your connection and try refreshing the page."
      );
    } else {
      setError(e instanceof Error ? e.message : "Failed to start lesson");
    }

    Sentry.captureException(e, {
      tags: { error_type: "session_init_failed", lesson_slug: lesson.slug },
    });
  }
}

init();
```

**Step 4: Add error display**

At the start of the return statement, add early return for errors:

```typescript
if (error) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <a href="/" className="text-emerald-600 hover:underline">
          Go home
        </a>
      </div>
    </div>
  );
}
```

**Step 5: Commit**

```bash
jj describe -m "feat(narrative): add error handling with Sentry integration"
```

---

### Task 13: Final Cleanup and Verification

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Remove unused imports**

Check for and remove any unused imports (e.g., `Link` if not used after header replacement).

**Step 2: Run Prettier format check**

Run: `cd web_frontend_next && npx prettier --check src/views/NarrativeLesson.tsx`
If formatting issues: `npx prettier --write src/views/NarrativeLesson.tsx`

**Step 3: Run full type check**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No type errors

**Step 4: Run lint**

Run: `cd web_frontend_next && npm run lint`
Expected: No lint errors (or only warnings)

**Step 5: Run build**

Run: `cd web_frontend_next && npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
jj describe -m "chore(narrative): cleanup and final verification"
```

---

### Task 14: Manual Testing Checklist

**No code changes - verification only**

Test the following scenarios:

1. **Progress bar:**
   - [ ] Section icons appear in header
   - [ ] Completed sections show as filled/blue
   - [ ] Current scroll position shown with ring indicator
   - [ ] Clicking icon scrolls to section
   - [ ] Previous/Next arrows work

2. **Mark complete:**
   - [ ] Button appears at end of each section
   - [ ] Clicking marks section complete (visual change)
   - [ ] Progress persists after page refresh (localStorage)

3. **Scroll detection:**
   - [ ] Current section updates while scrolling
   - [ ] Short sections (< half viewport) detected correctly
   - [ ] Topmost wins when multiple sections visible

4. **Drawer:**
   - [ ] Opens when clicking drawer icon
   - [ ] Shows all sections with completion status
   - [ ] Clicking section scrolls to it

5. **Modals:**
   - [ ] LessonCompleteModal appears when all sections complete
   - [ ] AuthPromptModal appears after first section (anonymous)
   - [ ] Can dismiss both modals

6. **Auth flow:**
   - [ ] Login redirects to Discord OAuth
   - [ ] Session claimed on return

**Step 1: Commit final verification**

```bash
jj describe -m "test(narrative): verify all features working"
```
