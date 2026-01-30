# Fix Scroll Position on Module Section Navigation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where scroll position is not reset to top when navigating between sections in a module (via "Complete section" or "Next section" buttons), especially when scrolled to 100% at the bottom.

**Architecture:** The current `window.scrollTo(0, 0)` in a `useEffect` races with browser layout/scroll anchoring. We fix this by:
1. Wrapping the section navigation scroll in `requestAnimationFrame` to ensure it runs after browser paint
2. Adding a mount-time scroll-to-top for module navigation (remount via `key={moduleId}`)

**Tech Stack:** React 19, Vike (SPA mode), Vitest for testing

---

## Background

**Root Cause Analysis:**

The existing scroll-to-top logic in `Module.tsx:598-603`:
```tsx
useEffect(() => {
  if (viewMode === "paginated") {
    window.scrollTo(0, 0);
  }
}, [currentSectionIndex, viewMode]);
```

This fails intermittently because:
1. The `useEffect` runs after React's commit phase
2. Browser scroll anchoring or layout recalculation happens **after** our effect
3. When at 100% scroll, removing old content triggers browser scroll position adjustment
4. The browser's adjustment can override our `scrollTo(0, 0)` call

**Fix Strategy:**
- Use `requestAnimationFrame` to defer scroll until after browser paint
- Add mount-time scroll for module-level navigation (component remounts via `key={moduleId}`)

---

## Task 1: Update Test Setup Mock

**Files:**
- Modify: `web_frontend/src/test/setup.ts:22-23`

**Step 1: Update scrollTo mock to track calls**

Replace the simple mock with one that tracks calls for testing:

```typescript
// Mock window.scrollTo - use vi.fn() so tests can verify calls
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
```

Add the vitest import at the top if not present:
```typescript
import { vi } from "vitest";
```

**Step 2: Verify mock works**

Run: `cd web_frontend && npm run test -- --run`
Expected: All existing tests pass (mock change is compatible)

**Step 3: Commit**

```bash
git add web_frontend/src/test/setup.ts
git commit -m "test: make window.scrollTo mock trackable with vi.fn()"
```

---

## Task 2: Write Failing Test for Scroll on Section Change

**Files:**
- Create: `web_frontend/src/views/__tests__/Module.scroll.test.tsx`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Module from "../Module";

// Mock the API modules
vi.mock("@/api/modules", () => ({
  getModule: vi.fn(),
  getModuleProgress: vi.fn(),
  getCourseProgress: vi.fn(),
  getChatHistory: vi.fn(),
  getNextModule: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/api/progress", () => ({
  markComplete: vi.fn(),
  updateTimeSpent: vi.fn(),
  claimSessionRecords: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
  }),
}));

vi.mock("@/hooks/useActivityTracker", () => ({
  useActivityTracker: () => ({ triggerActivity: vi.fn() }),
}));

vi.mock("@/hooks/useAnonymousToken", () => ({
  useAnonymousToken: () => "mock-anon-token",
}));

vi.mock("@/analytics", () => ({
  trackModuleStarted: vi.fn(),
  trackModuleCompleted: vi.fn(),
  trackChatMessageSent: vi.fn(),
}));

import {
  getModule,
  getModuleProgress,
  getCourseProgress,
  getChatHistory,
} from "@/api/modules";
import { markComplete } from "@/api/progress";

const mockModule = {
  slug: "test-module",
  title: "Test Module",
  content_id: "uuid-1",
  sections: [
    {
      type: "text",
      content: "Section 1 content",
      contentId: "lens-1",
    },
    {
      type: "text",
      content: "Section 2 content",
      contentId: "lens-2",
    },
  ],
};

describe("Module scroll behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup API mocks
    vi.mocked(getModule).mockResolvedValue(mockModule);
    vi.mocked(getModuleProgress).mockResolvedValue({ lenses: [] });
    vi.mocked(getCourseProgress).mockResolvedValue({
      course_id: "test-course",
      units: [],
    });
    vi.mocked(getChatHistory).mockResolvedValue({ messages: [] });
    vi.mocked(markComplete).mockResolvedValue({
      success: true,
      lenses: [{ content_id: "lens-1", completed: true }],
      module_status: "in_progress",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrolls to top after clicking Next section button", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<Module courseId="test-course" moduleId="test-module" />);

    // Wait for module to load
    await waitFor(() => {
      expect(screen.getByText("Section 1 content")).toBeInTheDocument();
    });

    // Clear any scroll calls from initial render
    vi.mocked(window.scrollTo).mockClear();

    // Mark section complete to show "Next section" button
    const completeButton = screen.getByText("Mark section complete");
    await user.click(completeButton);

    // Wait for API response and state update
    await waitFor(() => {
      expect(screen.getByText("Section completed")).toBeInTheDocument();
    });

    // Click "Next section"
    const nextButton = screen.getByText("Next section");
    await user.click(nextButton);

    // Advance timers to allow requestAnimationFrame to execute
    await act(async () => {
      vi.advanceTimersToNextTimer();
    });

    // Verify scroll was called
    await waitFor(() => {
      expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    });
  });

  it("scrolls to top on initial mount", async () => {
    render(<Module courseId="test-course" moduleId="test-module" />);

    // Wait for module to load
    await waitFor(() => {
      expect(screen.getByText("Section 1 content")).toBeInTheDocument();
    });

    // Verify scroll was called on mount
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web_frontend && npm run test -- src/views/__tests__/Module.scroll.test.tsx --run`
Expected: FAIL - the test expects `requestAnimationFrame` behavior but current code is synchronous

**Step 3: Commit failing test**

```bash
git add web_frontend/src/views/__tests__/Module.scroll.test.tsx
git commit -m "test: add failing tests for scroll-to-top on section navigation"
```

---

## Task 3: Implement the Fix

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:598-603`

**Step 1: Add scroll-to-top on mount**

Find the effects section (around line 270-280, after state declarations) and add:

```typescript
// Scroll to top on mount (handles module navigation via key={moduleId} remount)
useEffect(() => {
  window.scrollTo(0, 0);
}, []);
```

**Step 2: Update section navigation scroll with requestAnimationFrame**

Replace lines 598-603:

```typescript
// Reset scroll position when navigating to a new section (paginated mode)
useEffect(() => {
  if (viewMode === "paginated") {
    window.scrollTo(0, 0);
  }
}, [currentSectionIndex, viewMode]);
```

With:

```typescript
// Reset scroll position when navigating to a new section (paginated mode)
// Use requestAnimationFrame to ensure scroll happens after browser layout/paint
useEffect(() => {
  if (viewMode === "paginated") {
    const frameId = requestAnimationFrame(() => {
      window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frameId);
  }
}, [currentSectionIndex, viewMode]);
```

**Step 3: Run tests to verify they pass**

Run: `cd web_frontend && npm run test -- src/views/__tests__/Module.scroll.test.tsx --run`
Expected: PASS

**Step 4: Run all Module tests to check for regressions**

Run: `cd web_frontend && npm run test -- src/views/__tests__/ --run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add web_frontend/src/views/Module.tsx
git commit -m "fix: scroll to top on section navigation using requestAnimationFrame

Fixes race condition where browser scroll anchoring could override
window.scrollTo(0, 0) when navigating between sections.

- Added mount-time scroll for module-level navigation
- Wrapped section scroll in requestAnimationFrame for proper timing
- Added cleanup to cancel animation frame on unmount"
```

---

## Task 4: Verify Build and Lint

**Files:** None (verification only)

**Step 1: Run linter**

Run: `cd web_frontend && npm run lint`
Expected: No errors

**Step 2: Run build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds

**Step 3: Run all tests**

Run: `cd web_frontend && npm run test -- --run`
Expected: All tests pass

---

## Task 5: Manual Testing Verification

**Files:** None (manual testing)

**Step 1: Start development server**

Run: `python main.py --dev` (from repo root)
Run: `cd web_frontend && npm run dev` (in separate terminal)

**Step 2: Test scroll behavior**

1. Navigate to a module with multiple sections
2. Scroll to 100% bottom of page
3. Click "Mark section complete"
4. Click "Next section"
5. Verify: Page should scroll to top immediately

**Step 3: Test module navigation**

1. Complete a module (all sections)
2. Click "Next Module" in completion modal
3. Verify: New module page starts at top

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Update test setup mock | `test/setup.ts` |
| 2 | Write failing scroll tests | `__tests__/Module.scroll.test.tsx` |
| 3 | Implement requestAnimationFrame fix | `views/Module.tsx` |
| 4 | Verify build and lint | - |
| 5 | Manual testing | - |

**Total estimated changes:** ~50 lines across 3 files
