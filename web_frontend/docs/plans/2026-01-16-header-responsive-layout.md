# Header Responsive Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the header dynamically detect when content doesn't fit and move the progress bar to a second row, with title truncation as a last resort.

**Architecture:** Use `useMeasure` from `react-use` to measure left, center, and right header sections. A custom `useHeaderLayout` hook computes whether we need two rows (progress bar moves down) or truncation (title gets ellipsis). The header renders a single layout that responds to these computed states rather than using CSS breakpoints.

**Tech Stack:** React, react-use (useMeasure), Tailwind CSS

---

## Task 1: Create the useHeaderLayout Hook

**Files:**
- Create: `src/hooks/useHeaderLayout.ts`

**Step 1: Create the hook file with type definitions**

```typescript
import { useMeasure } from 'react-use';
import { useLayoutEffect, useState } from 'react';

const MIN_GAP = 24; // Minimum gap between sections (in pixels)

interface HeaderLayoutState {
  needsTwoRows: boolean;
  needsTruncation: boolean;
}

interface HeaderLayoutRefs {
  containerRef: React.RefObject<HTMLElement | null>;
  leftRef: React.RefObject<HTMLElement | null>;
  centerRef: React.RefObject<HTMLElement | null>;
  rightRef: React.RefObject<HTMLElement | null>;
}

export function useHeaderLayout(): [HeaderLayoutState, HeaderLayoutRefs] {
  const [containerRef, containerBounds] = useMeasure<HTMLElement>();
  const [leftRef, leftBounds] = useMeasure<HTMLElement>();
  const [centerRef, centerBounds] = useMeasure<HTMLElement>();
  const [rightRef, rightBounds] = useMeasure<HTMLElement>();

  const [state, setState] = useState<HeaderLayoutState>({
    needsTwoRows: false,
    needsTruncation: false,
  });

  useLayoutEffect(() => {
    const containerWidth = containerBounds.width;
    const leftWidth = leftBounds.width;
    const centerWidth = centerBounds.width;
    const rightWidth = rightBounds.width;

    // Skip if not measured yet
    if (containerWidth === 0) return;

    // Total space needed for single row: left + center + right + gaps
    const totalNeeded = leftWidth + centerWidth + rightWidth + MIN_GAP * 2;
    const needsTwoRows = totalNeeded > containerWidth;

    // If two rows, check if first row (left + right) still fits
    const firstRowNeeded = leftWidth + rightWidth + MIN_GAP;
    const needsTruncation = needsTwoRows && firstRowNeeded > containerWidth;

    setState({ needsTwoRows, needsTruncation });
  }, [containerBounds.width, leftBounds.width, centerBounds.width, rightBounds.width]);

  return [
    state,
    {
      containerRef: containerRef as unknown as React.RefObject<HTMLElement | null>,
      leftRef: leftRef as unknown as React.RefObject<HTMLElement | null>,
      centerRef: centerRef as unknown as React.RefObject<HTMLElement | null>,
      rightRef: rightRef as unknown as React.RefObject<HTMLElement | null>,
    },
  ];
}
```

**Step 2: Verify the file compiles**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npx tsc --noEmit src/hooks/useHeaderLayout.ts 2>&1 | head -20`

Expected: No errors, or only errors about missing module context (which is fine for isolated check)

**Step 3: Commit**

```bash
jj new -m "feat: add useHeaderLayout hook for content-aware header responsiveness"
```

---

## Task 2: Create the LessonHeader Component

**Files:**
- Create: `src/components/LessonHeader.tsx`

**Step 1: Create a new header component that uses the hook**

Extract the header from UnifiedLesson.tsx into its own component that uses `useHeaderLayout`.

```typescript
import { useHeaderLayout } from '../hooks/useHeaderLayout';
import { StageProgressBar } from './StageProgressBar';
import { LessonDrawerToggle } from './LessonDrawer';
import { HeaderAuthStatus } from './HeaderAuthStatus';

interface LessonHeaderProps {
  lessonTitle: string;
  stages: Array<{ title: string }>;
  currentStageIndex: number;
  viewingStageIndex: number;
  isViewingOther: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onReturnToCurrent: () => void;
  onSkipSection: () => void;
  onDrawerOpen: () => void;
  onLoginClick: () => void;
}

export function LessonHeader({
  lessonTitle,
  stages,
  currentStageIndex,
  viewingStageIndex,
  isViewingOther,
  canGoPrevious,
  canGoNext,
  onStageClick,
  onPrevious,
  onNext,
  onReturnToCurrent,
  onSkipSection,
  onDrawerOpen,
  onLoginClick,
}: LessonHeaderProps) {
  const [{ needsTwoRows, needsTruncation }, refs] = useHeaderLayout();

  return (
    <header
      ref={refs.containerRef as React.RefObject<HTMLElement>}
      className="bg-white border-b border-gray-200 px-4 py-3 z-40"
    >
      <div className={`flex ${needsTwoRows ? 'flex-col gap-3' : 'items-center justify-between'}`}>
        {/* First row: Logo/title + (progress bar if single row) + controls */}
        <div className="flex items-center justify-between">
          {/* Left section: Logo and title */}
          <div
            ref={refs.leftRef as React.RefObject<HTMLDivElement>}
            className={`flex items-center gap-2 ${needsTruncation ? 'min-w-0' : ''} mr-4`}
          >
            <a href="/" className="flex items-center gap-1.5 shrink-0">
              <img src="/assets/Logo only.png" alt="Lens Academy" className="h-6" />
              <span className="text-lg font-semibold text-slate-800">Lens Academy</span>
            </a>
            <span className="text-slate-300 shrink-0">|</span>
            <h1
              className={`text-lg font-semibold text-gray-900 ${needsTruncation ? 'truncate' : ''}`}
            >
              {lessonTitle}
            </h1>
          </div>

          {/* Center section: Progress bar (inline if single row) */}
          {!needsTwoRows && (
            <div ref={refs.centerRef as React.RefObject<HTMLDivElement>} className="flex-shrink-0">
              <StageProgressBar
                stages={stages}
                currentStageIndex={currentStageIndex}
                viewingStageIndex={viewingStageIndex}
                onStageClick={onStageClick}
                onPrevious={onPrevious}
                onNext={onNext}
                canGoPrevious={canGoPrevious}
                canGoNext={canGoNext}
              />
            </div>
          )}

          {/* Right section: Controls */}
          <div
            ref={refs.rightRef as React.RefObject<HTMLDivElement>}
            className="flex items-center gap-4 shrink-0"
          >
            {isViewingOther ? (
              <button
                onClick={onReturnToCurrent}
                className="text-emerald-600 hover:text-emerald-700 text-sm font-medium whitespace-nowrap"
              >
                Return to current →
              </button>
            ) : (
              <button
                onClick={onSkipSection}
                className="text-gray-500 hover:text-gray-700 text-sm cursor-pointer whitespace-nowrap"
              >
                Skip section
              </button>
            )}
            <LessonDrawerToggle onClick={onDrawerOpen} />
            <HeaderAuthStatus onLoginClick={onLoginClick} />
          </div>
        </div>

        {/* Second row: Progress bar (only if two-row mode) */}
        {needsTwoRows && (
          <div className="flex justify-center">
            <StageProgressBar
              stages={stages}
              currentStageIndex={currentStageIndex}
              viewingStageIndex={viewingStageIndex}
              onStageClick={onStageClick}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
            />
          </div>
        )}
      </div>
    </header>
  );
}
```

**Step 2: Verify the component compiles**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npx tsc --noEmit`

Expected: No type errors

**Step 3: Commit**

```bash
jj new -m "feat: add LessonHeader component with dynamic layout"
```

---

## Task 3: Integrate LessonHeader into UnifiedLesson

**Files:**
- Modify: `src/pages/UnifiedLesson.tsx:672-772`

**Step 1: Import the new component**

At the top of the file, add:

```typescript
import { LessonHeader } from '../components/LessonHeader';
```

**Step 2: Replace the inline header with the component**

Replace lines 672-772 (the entire `<header>...</header>` block) with:

```typescript
<LessonHeader
  lessonTitle={session.lesson_title}
  stages={session.stages}
  currentStageIndex={session.current_stage_index}
  viewingStageIndex={viewingStageIndex}
  isViewingOther={isViewingOther}
  canGoPrevious={canGoBack}
  canGoNext={canGoForward}
  onStageClick={handleStageClick}
  onPrevious={handleGoBack}
  onNext={handleGoForward}
  onReturnToCurrent={handleReturnToCurrent}
  onSkipSection={handleAdvanceStage}
  onDrawerOpen={() => setDrawerOpen(true)}
  onLoginClick={handleLoginClick}
/>
```

**Step 3: Verify the page compiles and renders**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npx tsc --noEmit`

Expected: No type errors

**Step 4: Commit**

```bash
jj new -m "refactor: use LessonHeader component in UnifiedLesson"
```

---

## Task 4: Manual Testing and Refinement

**Step 1: Start the dev server**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2 && python main.py --dev --no-bot --no-db`

**Step 2: Test responsive behavior**

Open browser to localhost (port from output), navigate to a lesson page, and verify:

1. Wide window: All elements in single row, progress bar centered
2. Resize narrower: Progress bar moves to second row before any overlap occurs
3. Resize very narrow: Title truncates with ellipsis
4. Resize wider: Layout returns to single row

**Step 3: Adjust MIN_GAP if needed**

If collisions still occur, increase `MIN_GAP` in `useHeaderLayout.ts`. If layout switches too early, decrease it.

**Step 4: Commit any adjustments**

```bash
jj new -m "fix: tune header layout gap threshold"
```

---

## Task 5: Handle Measurement Edge Case

**Files:**
- Modify: `src/hooks/useHeaderLayout.ts`

**Problem:** On first render, measurements are 0, which may cause a flash of wrong layout.

**Step 1: Add initial state that defaults to two rows**

Modify the initial state to be conservative (two rows) until measured:

```typescript
const [state, setState] = useState<HeaderLayoutState>({
  needsTwoRows: true,  // Default to two rows until measured
  needsTruncation: false,
});

// Add a "measured" flag
const [hasMeasured, setHasMeasured] = useState(false);

useLayoutEffect(() => {
  const containerWidth = containerBounds.width;
  if (containerWidth === 0) return;

  setHasMeasured(true);
  // ... rest of logic
}, [...]);
```

**Step 2: Optionally hide header until measured**

If flash is noticeable, add opacity transition:

```typescript
// In LessonHeader
className={`... transition-opacity ${hasMeasured ? 'opacity-100' : 'opacity-0'}`}
```

**Step 3: Commit**

```bash
jj new -m "fix: prevent layout flash on initial header render"
```

---

## Notes

- **No unit tests for the hook**: The hook depends on DOM measurement which is hard to unit test. Manual testing is appropriate here.
- **useMeasure uses ResizeObserver**: Layout changes trigger re-measurement automatically.
- **useLayoutEffect**: Ensures state updates before browser paint, preventing visible layout shift.
