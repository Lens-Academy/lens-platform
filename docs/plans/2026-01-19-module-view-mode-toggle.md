# Module View Mode Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toggle in the Module player to switch between continuous scroll (all sections visible) and paginated view (one section at a time).

**Architecture:** Add `viewMode` state to Module.tsx. The toggle lives in ModuleHeader. In continuous mode, all sections render and sidebar clicks scroll. In paginated mode, only the current section renders and sidebar clicks swap sections instantly. Navigation handlers already track `currentSectionIndex` - we just change whether that triggers scroll or swap.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## Task 1: Add ViewMode Type

**Files:**
- Create: `web_frontend_next/src/types/viewMode.ts`

**Step 1: Create the type file**

```typescript
// web_frontend_next/src/types/viewMode.ts

export type ViewMode = "continuous" | "paginated";
```

**Step 2: Verify file exists**

Run: `ls web_frontend_next/src/types/viewMode.ts`
Expected: File listed

**Step 3: Commit**

```bash
git add web_frontend_next/src/types/viewMode.ts
git commit -m "feat: add ViewMode type for module display modes"
```

---

## Task 2: Add Toggle Button Component

**Files:**
- Create: `web_frontend_next/src/components/module/ViewModeToggle.tsx`

**Step 1: Create the toggle component**

```typescript
// web_frontend_next/src/components/module/ViewModeToggle.tsx

import type { ViewMode } from "@/types/viewMode";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onToggle: () => void;
}

/**
 * Toggle button for switching between continuous scroll and paginated view.
 * Shows current mode and switches on click.
 */
export default function ViewModeToggle({
  viewMode,
  onToggle,
}: ViewModeToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 px-2 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
      title={
        viewMode === "continuous"
          ? "Switch to paginated view"
          : "Switch to continuous scroll"
      }
    >
      {viewMode === "continuous" ? (
        <>
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          <span>Scroll</span>
        </>
      ) : (
        <>
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <span>Pages</span>
        </>
      )}
    </button>
  );
}
```

**Step 2: Verify file exists**

Run: `ls web_frontend_next/src/components/module/ViewModeToggle.tsx`
Expected: File listed

**Step 3: Commit**

```bash
git add web_frontend_next/src/components/module/ViewModeToggle.tsx
git commit -m "feat: add ViewModeToggle component"
```

---

## Task 3: Add Toggle to ModuleHeader

**Files:**
- Modify: `web_frontend_next/src/components/ModuleHeader.tsx`

**Step 1: Add viewMode props to interface**

In `ModuleHeader.tsx`, update the `ModuleHeaderProps` interface to add:

```typescript
import type { ViewMode } from "@/types/viewMode";

interface ModuleHeaderProps {
  moduleTitle: string;
  stages: Stage[];
  currentStageIndex: number;
  viewingStageIndex: number | null;
  isViewingOther: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  viewMode: ViewMode;           // ADD
  onViewModeToggle: () => void; // ADD
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onReturnToCurrent: () => void;
  onSkipSection: () => void;
  onDrawerOpen: () => void;
  onLoginClick: () => void;
}
```

**Step 2: Add props to function signature**

Update the function parameters to include the new props:

```typescript
export function ModuleHeader({
  moduleTitle,
  stages,
  currentStageIndex,
  viewingStageIndex,
  isViewingOther,
  canGoPrevious,
  canGoNext,
  viewMode,           // ADD
  onViewModeToggle,   // ADD
  onStageClick,
  onPrevious,
  onNext,
  onReturnToCurrent,
  onSkipSection,
  onDrawerOpen,
  onLoginClick,
}: ModuleHeaderProps) {
```

**Step 3: Import and add toggle to header**

Add import at top:

```typescript
import ViewModeToggle from "./module/ViewModeToggle";
```

In the right section (around line 107), add the toggle before the skip button:

```typescript
{/* Right section: Controls */}
<div ref={rightRef} className="flex items-center gap-4">
  <ViewModeToggle viewMode={viewMode} onToggle={onViewModeToggle} />
  {isViewingOther ? (
```

**Step 4: Verify TypeScript compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: Errors about Module.tsx missing props (expected - we'll fix in next task)

**Step 5: Commit**

```bash
git add web_frontend_next/src/components/ModuleHeader.tsx
git commit -m "feat: add viewMode toggle to ModuleHeader"
```

---

## Task 4: Add ViewMode State to Module.tsx

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Import ViewMode type**

Add import at top of file:

```typescript
import type { ViewMode } from "@/types/viewMode";
```

**Step 2: Add viewMode state**

After the `error` state (around line 122), add:

```typescript
// View mode state
const [viewMode, setViewMode] = useState<ViewMode>("continuous");

const handleViewModeToggle = useCallback(() => {
  setViewMode((prev) => (prev === "continuous" ? "paginated" : "continuous"));
}, []);
```

**Step 3: Pass props to ModuleHeader**

Update the ModuleHeader component call (around line 564-582) to include:

```typescript
<ModuleHeader
  moduleTitle={module.title}
  stages={stages}
  currentStageIndex={furthestCompletedIndex + 1}
  viewingStageIndex={viewingStageIndex ?? currentSectionIndex}
  isViewingOther={
    viewingStageIndex !== null &&
    viewingStageIndex !== currentSectionIndex
  }
  canGoPrevious={currentSectionIndex > 0}
  canGoNext={currentSectionIndex < module.sections.length - 1}
  viewMode={viewMode}
  onViewModeToggle={handleViewModeToggle}
  onStageClick={handleStageClick}
  onPrevious={handlePrevious}
  onNext={handleNext}
  onReturnToCurrent={() => setViewingStageIndex(null)}
  onSkipSection={handleSkipSection}
  onDrawerOpen={() => setDrawerOpen(true)}
  onLoginClick={handleLoginClick}
/>
```

**Step 4: Verify TypeScript compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add web_frontend_next/src/views/Module.tsx
git commit -m "feat: add viewMode state and toggle handler to Module"
```

---

## Task 5: Update Navigation for Paginated Mode

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Update handleStageClick**

Replace the existing `handleStageClick` callback (around line 427-437) with:

```typescript
const handleStageClick = useCallback(
  (index: number) => {
    if (viewMode === "continuous") {
      // Scroll to section
      const el = sectionRefs.current.get(index);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      // Paginated: just update the index (render handles the rest)
      setCurrentSectionIndex(index);
    }
    setViewingStageIndex(index === currentSectionIndex ? null : index);
  },
  [currentSectionIndex, viewMode],
);
```

**Step 2: Update handlePrevious**

Replace the existing `handlePrevious` callback (around line 439-442) with:

```typescript
const handlePrevious = useCallback(() => {
  const prevIndex = Math.max(0, currentSectionIndex - 1);
  if (viewMode === "continuous") {
    handleStageClick(prevIndex);
  } else {
    setCurrentSectionIndex(prevIndex);
    setViewingStageIndex(null);
  }
}, [currentSectionIndex, viewMode, handleStageClick]);
```

**Step 3: Update handleNext**

Replace the existing `handleNext` callback (around line 444-450) with:

```typescript
const handleNext = useCallback(() => {
  const nextIndex = Math.min(
    module.sections.length - 1,
    currentSectionIndex + 1,
  );
  if (viewMode === "continuous") {
    handleStageClick(nextIndex);
  } else {
    setCurrentSectionIndex(nextIndex);
    setViewingStageIndex(null);
  }
}, [currentSectionIndex, module.sections.length, viewMode, handleStageClick]);
```

**Step 4: Verify TypeScript compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add web_frontend_next/src/views/Module.tsx
git commit -m "feat: update navigation handlers for paginated mode"
```

---

## Task 6: Conditional Rendering for Paginated Mode

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Update main content rendering**

Replace the `<main>` section (around lines 586-629) with:

```typescript
{/* Main content */}
<main>
  {module.sections.map((section, sectionIndex) => {
    // In paginated mode, only render current section
    if (viewMode === "paginated" && sectionIndex !== currentSectionIndex) {
      return null;
    }

    return (
      <div
        key={sectionIndex}
        ref={(el) => {
          if (el) sectionRefs.current.set(sectionIndex, el);
        }}
        data-section-index={sectionIndex}
        className="py-8"
      >
        {section.type === "text" ? (
          <>
            <SectionDivider type="article" />
            <AuthoredText content={section.content} />
          </>
        ) : section.type === "chat" ? (
          <>
            <SectionDivider type="chat" />
            <NarrativeChatSection
              messages={messages}
              pendingMessage={pendingMessage}
              streamingContent={streamingContent}
              isLoading={isLoading}
              onSendMessage={(content) =>
                handleSendMessage(content, sectionIndex, 0)
              }
              onRetryMessage={handleRetryMessage}
            />
          </>
        ) : (
          <>
            <SectionDivider type={section.type} />
            {section.segments?.map((segment, segmentIndex) =>
              renderSegment(segment, section, sectionIndex, segmentIndex),
            )}
          </>
        )}
        <MarkCompleteButton
          isCompleted={completedSections.has(sectionIndex)}
          onComplete={() => handleMarkComplete(sectionIndex)}
        />
      </div>
    );
  })}
</main>
```

**Step 2: Disable scroll tracking in paginated mode**

Update the scroll tracking useEffect (around line 350-420). Wrap the scroll listener setup in a viewMode check:

Find this line (around line 412):
```typescript
window.addEventListener("scroll", handleScroll, { passive: true });
```

Replace the entire useEffect with:

```typescript
// Scroll tracking with hybrid rule: >50% viewport OR fully visible, topmost wins
// Only active in continuous mode
useEffect(() => {
  // Skip scroll tracking in paginated mode
  if (viewMode === "paginated") return;

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

    // Fallback: if no section qualified, find section closest to viewport top
    if (bestTopPosition === Infinity) {
      let closestDistance = Infinity;
      sectionRefs.current.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        const distance = Math.abs(rect.top);
        if (distance < closestDistance) {
          closestDistance = distance;
          bestIndex = index;
        }
      });
    }

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
}, [module.sections, viewMode]);
```

**Step 3: Verify TypeScript compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add web_frontend_next/src/views/Module.tsx
git commit -m "feat: implement conditional rendering for paginated mode"
```

---

## Task 7: Manual Testing

**Step 1: Start the dev server**

Run: `cd web_frontend_next && npm run dev`

**Step 2: Test continuous mode (default)**

1. Navigate to a module with multiple sections
2. Verify all sections are visible
3. Verify scroll tracking updates the progress bar
4. Verify sidebar clicks scroll to sections
5. Verify next/prev buttons scroll to adjacent sections

**Step 3: Test paginated mode**

1. Click the toggle button in the header
2. Verify only one section is now visible
3. Verify sidebar clicks switch sections instantly
4. Verify next/prev buttons switch sections instantly
5. Verify progress bar still shows correct position

**Step 4: Test mode switching**

1. In paginated mode, navigate to section 3
2. Toggle back to continuous mode
3. Verify all sections are visible and you're scrolled to section 3
4. Toggle to paginated mode again
5. Verify section 3 is still the current section

**Step 5: Commit if all tests pass**

```bash
git add -A
git commit -m "feat: complete module view mode toggle implementation"
```

---

## Task 8: Lint and Format Check

**Step 1: Run ESLint**

Run: `cd web_frontend_next && npm run lint`
Expected: No errors

**Step 2: Run Prettier check**

Run: `cd web_frontend_next && npx prettier --check src/`
Expected: All files formatted correctly (or fix with `npx prettier --write src/`)

**Step 3: Run TypeScript check**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 4: Run build**

Run: `cd web_frontend_next && npm run build`
Expected: Build succeeds

**Step 5: Final commit if any fixes were made**

```bash
git add -A
git commit -m "chore: fix lint and formatting issues"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create ViewMode type |
| 2 | Create ViewModeToggle component |
| 3 | Add toggle to ModuleHeader |
| 4 | Add viewMode state to Module.tsx |
| 5 | Update navigation handlers |
| 6 | Implement conditional rendering |
| 7 | Manual testing |
| 8 | Lint and format check |

**Key architectural decisions:**
- ViewMode state lives in Module.tsx (single source of truth)
- Toggle is passed down to ModuleHeader as props
- Navigation handlers check viewMode to decide scroll vs swap
- Scroll tracking disabled in paginated mode
- Sections still render via map, but filter out non-current in paginated mode
