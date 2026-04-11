# Progress: Database as Single Source of Truth

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the database the single source of truth for module progress, removing localStorage dependency. Backend returns full state on mutations.

**Architecture:**
- Frontend fetches progress from `GET /api/modules/{slug}/progress` on load
- On completion, `POST /api/progress/complete` with `module_slug` returns full module state
- On login, claim anonymous records then re-fetch progress
- Chat session conflicts: keep authenticated over anonymous

**Tech Stack:** React (frontend), FastAPI (backend), PostgreSQL (database)

---

## Task 1: Modify Backend to Return Full Module State on Completion

**Files:**
- Modify: `web_api/routes/progress.py`
- Modify: `core/modules/progress.py` (if needed)

**Step 1: Update MarkCompleteRequest to accept module_slug**

In `web_api/routes/progress.py`, modify the request model:

```python
class MarkCompleteRequest(BaseModel):
    content_id: UUID
    content_type: str  # 'module', 'lo', 'lens', 'test'
    content_title: str
    time_spent_s: int = 0
    module_slug: str | None = None  # If provided, return full module progress in response
```

**Step 2: Update MarkCompleteResponse to include full module state**

```python
class LensProgressResponse(BaseModel):
    id: str | None
    title: str
    type: str
    optional: bool
    completed: bool
    completedAt: str | None
    timeSpentS: int


class MarkCompleteResponse(BaseModel):
    completed_at: str | None
    # Full module state (returned if module_slug provided in request)
    module_status: str | None = None  # "not_started" | "in_progress" | "completed"
    module_progress: dict | None = None  # { "completed": int, "total": int }
    lenses: list[LensProgressResponse] | None = None
```

**Step 3: Update complete_content endpoint to return full state**

In the `complete_content` function, after marking complete, if `module_slug` is provided:

```python
@router.post("/complete", response_model=MarkCompleteResponse)
async def complete_content(
    body: MarkCompleteRequest,
    auth: tuple = Depends(get_user_or_token),
):
    user_id, anonymous_token = auth

    if body.content_type not in ("module", "lo", "lens", "test"):
        raise HTTPException(400, "Invalid content_type")

    async with get_transaction() as conn:
        progress = await mark_content_complete(
            conn,
            user_id=user_id,
            anonymous_token=anonymous_token,
            content_id=body.content_id,
            content_type=body.content_type,
            content_title=body.content_title,
            time_spent_s=body.time_spent_s,
        )

        # If module_slug provided, return full module progress
        lenses = None
        module_status = None
        module_progress = None

        if body.module_slug:
            from core.content.github_fetcher import load_flattened_module, ModuleNotFoundError

            try:
                module = load_flattened_module(body.module_slug)
                content_ids = [
                    UUID(s["contentId"]) for s in module.sections if s.get("contentId")
                ]

                progress_map = await get_module_progress(
                    conn,
                    user_id=user_id,
                    anonymous_token=anonymous_token,
                    lens_ids=content_ids,
                )

                # Build lenses list
                lenses = []
                for section in module.sections:
                    content_id_str = section.get("contentId")
                    content_id = UUID(content_id_str) if content_id_str else None
                    title = (
                        section.get("meta", {}).get("title")
                        or section.get("title")
                        or "Untitled"
                    )
                    lens_data = LensProgressResponse(
                        id=content_id_str,
                        title=title,
                        type=section.get("type"),
                        optional=section.get("optional", False),
                        completed=False,
                        completedAt=None,
                        timeSpentS=0,
                    )
                    if content_id and content_id in progress_map:
                        prog = progress_map[content_id]
                        lens_data.completed = prog.get("completed_at") is not None
                        lens_data.completedAt = (
                            prog["completed_at"].isoformat()
                            if prog.get("completed_at")
                            else None
                        )
                        lens_data.timeSpentS = prog.get("total_time_spent_s", 0)
                    lenses.append(lens_data)

                # Calculate module status
                required_lenses = [l for l in lenses if not l.optional]
                completed_count = sum(1 for l in required_lenses if l.completed)
                total_count = len(required_lenses)

                if completed_count == 0:
                    module_status = "not_started"
                elif completed_count >= total_count:
                    module_status = "completed"
                else:
                    module_status = "in_progress"

                module_progress = {"completed": completed_count, "total": total_count}

            except ModuleNotFoundError:
                pass  # Module not found, skip returning full state

    return MarkCompleteResponse(
        completed_at=(
            progress["completed_at"].isoformat()
            if progress.get("completed_at")
            else None
        ),
        module_status=module_status,
        module_progress=module_progress,
        lenses=lenses,
    )
```

**Step 4: Run backend tests**

Run: `pytest web_api/tests/ -v`
Expected: All tests pass (or update tests for new response shape)

**Step 5: Commit**

```bash
git add web_api/routes/progress.py
git commit -m "feat(api): return full module state when module_slug provided in completion request"
```

---

## Task 2: Add `getModuleProgress` API Client Function

**Files:**
- Modify: `web_frontend/src/api/modules.ts`

**Step 1: Add TypeScript types for module progress response**

After existing imports, add:

```typescript
export interface LensProgress {
  id: string | null;
  title: string;
  type: string;
  optional: boolean;
  completed: boolean;
  completedAt: string | null;
  timeSpentS: number;
}

export interface ModuleProgressResponse {
  module: { id: string | null; slug: string; title: string };
  status: "not_started" | "in_progress" | "completed";
  progress: { completed: number; total: number };
  lenses: LensProgress[];
  chatSession: { sessionId: number; hasMessages: boolean };
}
```

**Step 2: Add the `getModuleProgress` function**

After `getCourseProgress` function:

```typescript
export async function getModuleProgress(
  moduleSlug: string,
): Promise<ModuleProgressResponse | null> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/modules/${moduleSlug}/progress`,
    {
      credentials: "include",
      headers: { "X-Anonymous-Token": getAnonymousToken() },
    },
  );
  if (!res.ok) {
    if (res.status === 401) {
      return null;
    }
    throw new Error("Failed to fetch module progress");
  }
  return res.json();
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd web_frontend && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add web_frontend/src/api/modules.ts
git commit -m "feat(api): add getModuleProgress client function"
```

---

## Task 3: Update `markComplete` to Accept module_slug and Return Full State

**Files:**
- Modify: `web_frontend/src/api/progress.ts`

**Step 1: Update types**

```typescript
import type { LensProgress } from "./modules";

export interface MarkCompleteRequest {
  content_id: string;
  content_type: "module" | "lo" | "lens" | "test";
  content_title: string;
  time_spent_s?: number;
  module_slug?: string;  // NEW: If provided, response includes full module state
}

export interface MarkCompleteResponse {
  completed_at: string;
  module_status?: "not_started" | "in_progress" | "completed";
  module_progress?: { completed: number; total: number };
  lenses?: LensProgress[];  // NEW: Full lens array if module_slug was provided
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web_frontend && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add web_frontend/src/api/progress.ts
git commit -m "feat(api): update markComplete types for full module state response"
```

---

## Task 4: Write Failing Test for Progress Loading on Module Mount

**Files:**
- Create: `web_frontend/src/views/__tests__/Module.progress.test.tsx`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Module from "../Module";

// Mock the API modules
vi.mock("@/api/modules", () => ({
  getModule: vi.fn(),
  getModuleProgress: vi.fn(),
  getCourseProgress: vi.fn(),
  getChatHistory: vi.fn(),
}));

vi.mock("@/api/progress", () => ({
  markComplete: vi.fn(),
  updateTimeSpent: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isInSignupsTable: false,
    isInActiveGroup: false,
    login: vi.fn(),
  }),
}));

vi.mock("@/hooks/useActivityTracker", () => ({
  useActivityTracker: () => ({ triggerActivity: vi.fn() }),
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
      type: "lens-article",
      contentId: "lens-1",
      meta: { title: "Section 1" },
      segments: [],
    },
    {
      type: "lens-video",
      contentId: "lens-2",
      videoId: "abc123",
      meta: { title: "Section 2", channel: "Test" },
      segments: [],
    },
  ],
};

const mockProgress = {
  module: { id: "uuid-1", slug: "test-module", title: "Test Module" },
  status: "in_progress" as const,
  progress: { completed: 1, total: 2 },
  lenses: [
    {
      id: "lens-1",
      title: "Section 1",
      type: "lens-article",
      optional: false,
      completed: true,
      completedAt: "2026-01-29T12:00:00Z",
      timeSpentS: 300,
    },
    {
      id: "lens-2",
      title: "Section 2",
      type: "lens-video",
      optional: false,
      completed: false,
      completedAt: null,
      timeSpentS: 0,
    },
  ],
  chatSession: { sessionId: 1, hasMessages: false },
};

describe("Module progress loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (getModule as ReturnType<typeof vi.fn>).mockResolvedValue(mockModule);
    (getCourseProgress as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  it("fetches and displays progress from API on mount", async () => {
    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(mockProgress);

    render(<Module courseId="test-course" moduleId="test-module" />);

    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalledWith("test-module");
    });

    // Section 1 should show as completed
    await waitFor(() => {
      expect(screen.getByText("Section completed")).toBeInTheDocument();
    });
  });

  it("does not read from localStorage for initial progress state", async () => {
    // Set localStorage with DIFFERENT data than API (section 1 complete, not section 0)
    localStorage.setItem("module-completed-test-module", JSON.stringify([1]));

    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(mockProgress);

    render(<Module courseId="test-course" moduleId="test-module" />);

    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalled();
    });

    // Should show section 0 as completed (from API), ignoring localStorage
    await waitFor(() => {
      expect(screen.getByText("Section completed")).toBeInTheDocument();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web_frontend && npm test -- src/views/__tests__/Module.progress.test.tsx`
Expected: FAIL - `getModuleProgress` is not called

**Step 3: Commit failing test**

```bash
git add web_frontend/src/views/__tests__/Module.progress.test.tsx
git commit -m "test: add failing test for progress loading from API"
```

---

## Task 5: Implement Progress Loading in Module.tsx

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add imports**

At the imports section, add:

```typescript
import {
  sendMessage,
  getChatHistory,
  getNextModule,
  getModule,
  getCourseProgress,
  getModuleProgress,  // ADD
} from "@/api/modules";
import type {
  ModuleCompletionResult,
  ModuleProgressResponse,  // ADD
  LensProgress,  // ADD
} from "@/api/modules";
```

**Step 2: Add state for module progress**

After `loadError` state (around line 70):

```typescript
const [moduleProgress, setModuleProgress] =
  useState<ModuleProgressResponse | null>(null);
```

**Step 3: Replace completedSections initialization**

Find and replace the localStorage-based initialization (lines ~170-177):

```typescript
// OLD - DELETE:
const [completedSections, setCompletedSections] = useState<Set<number>>(
  () => {
    if (typeof window === "undefined") return new Set();
    const stored = localStorage.getItem(`module-completed-${moduleId}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  },
);

// NEW - Database is source of truth:
const [completedSections, setCompletedSections] = useState<Set<number>>(
  new Set(),
);
```

**Step 4: Delete localStorage persistence effect**

Find and delete (lines ~179-185):

```typescript
// DELETE THIS ENTIRE EFFECT:
useEffect(() => {
  localStorage.setItem(
    `module-completed-${moduleId}`,
    JSON.stringify([...completedSections]),
  );
}, [completedSections, moduleId]);
```

**Step 5: Modify load effect to fetch progress**

Replace the load effect (lines ~94-119):

```typescript
// Fetch module data on mount or when moduleId/courseId changes
useEffect(() => {
  if (!moduleId) return;

  async function load() {
    setLoadingModule(true);
    setLoadError(null);
    try {
      // Fetch module, course progress, and module progress in parallel
      const [moduleResult, courseResult, progressResult] = await Promise.all([
        getModule(moduleId),
        courseId && courseId !== "default"
          ? getCourseProgress(courseId).catch(() => null)
          : Promise.resolve(null),
        getModuleProgress(moduleId).catch(() => null),
      ]);

      setModule(moduleResult);
      setCourseProgress(courseResult);
      setModuleProgress(progressResult);

      // Initialize completedSections from progress API response
      if (progressResult) {
        const completed = new Set<number>();
        progressResult.lenses.forEach((lens, index) => {
          if (lens.completed) {
            completed.add(index);
          }
        });
        setCompletedSections(completed);

        // If module already complete, set flag
        if (progressResult.status === "completed") {
          setApiConfirmedComplete(true);
        }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load module");
    } finally {
      setLoadingModule(false);
    }
  }

  load();
}, [moduleId, courseId]);
```

**Step 6: Run test to verify it passes**

Run: `cd web_frontend && npm test -- src/views/__tests__/Module.progress.test.tsx`
Expected: PASS

**Step 7: Commit**

```bash
git add web_frontend/src/views/Module.tsx
git commit -m "feat: fetch module progress from API on mount, remove localStorage"
```

---

## Task 6: Write Failing Test for State Update from Completion Response

**Files:**
- Modify: `web_frontend/src/views/__tests__/Module.progress.test.tsx`

**Step 1: Add test for updating state from completion response**

```typescript
describe("Module progress updates from completion response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (getModule as ReturnType<typeof vi.fn>).mockResolvedValue(mockModule);
    (getCourseProgress as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  it("updates completedSections from markComplete response lenses array", async () => {
    // Initial: no sections completed
    const initialProgress = {
      ...mockProgress,
      status: "not_started" as const,
      progress: { completed: 0, total: 2 },
      lenses: [
        { ...mockProgress.lenses[0], completed: false, completedAt: null },
        { ...mockProgress.lenses[1] },
      ],
    };

    // After completion: section 0 is completed
    const completionResponse = {
      completed_at: "2026-01-29T13:00:00Z",
      module_status: "in_progress",
      module_progress: { completed: 1, total: 2 },
      lenses: [
        {
          id: "lens-1",
          title: "Section 1",
          type: "lens-article",
          optional: false,
          completed: true,
          completedAt: "2026-01-29T13:00:00Z",
          timeSpentS: 0,
        },
        {
          id: "lens-2",
          title: "Section 2",
          type: "lens-video",
          optional: false,
          completed: false,
          completedAt: null,
          timeSpentS: 0,
        },
      ],
    };

    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(initialProgress);
    (markComplete as ReturnType<typeof vi.fn>).mockResolvedValue(completionResponse);

    render(<Module courseId="test-course" moduleId="test-module" />);

    // Wait for initial load - should show "Mark section complete" button
    await waitFor(() => {
      expect(screen.getByText("Mark section complete")).toBeInTheDocument();
    });

    // Click mark complete
    const completeButton = screen.getByText("Mark section complete");
    await userEvent.click(completeButton);

    // markComplete should be called with module_slug
    await waitFor(() => {
      expect(markComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          module_slug: "test-module",
        }),
        expect.any(Boolean),
      );
    });

    // State should update from response - now shows "Section completed"
    await waitFor(() => {
      expect(screen.getByText("Section completed")).toBeInTheDocument();
    });

    // Should NOT re-fetch progress (response already has full state)
    expect(getModuleProgress).toHaveBeenCalledTimes(1); // Only initial load
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web_frontend && npm test -- src/views/__tests__/Module.progress.test.tsx`
Expected: FAIL - markComplete not called with module_slug, or state not updated from response

**Step 3: Commit failing test**

```bash
git add web_frontend/src/views/__tests__/Module.progress.test.tsx
git commit -m "test: add failing test for updating state from completion response"
```

---

## Task 7: Update MarkCompleteButton to Pass module_slug

**Files:**
- Modify: `web_frontend/src/components/module/MarkCompleteButton.tsx`

**Step 1: Add moduleSlug prop**

```typescript
type MarkCompleteButtonProps = {
  isCompleted: boolean;
  onComplete: (response?: MarkCompleteResponse) => void;
  onNext?: () => void;
  hasNext?: boolean;
  contentId?: string;
  contentType?: "module" | "lo" | "lens" | "test";
  contentTitle?: string;
  moduleSlug?: string;  // NEW
};

export default function MarkCompleteButton({
  isCompleted,
  onComplete,
  onNext,
  hasNext,
  contentId,
  contentType = "lens",
  contentTitle,
  moduleSlug,  // NEW
}: MarkCompleteButtonProps) {
```

**Step 2: Pass moduleSlug to markComplete**

```typescript
const handleComplete = async () => {
  if (isSubmitting) return;

  if (contentId && contentTitle) {
    setIsSubmitting(true);
    try {
      const response = await markComplete(
        {
          content_id: contentId,
          content_type: contentType,
          content_title: contentTitle,
          module_slug: moduleSlug,  // NEW
        },
        isAuthenticated,
      );
      onComplete(response);
    } catch (error) {
      console.error("[MarkCompleteButton] Failed to mark complete:", error);
      onComplete();
    } finally {
      setIsSubmitting(false);
    }
  } else {
    onComplete();
  }
};
```

**Step 3: Commit**

```bash
git add web_frontend/src/components/module/MarkCompleteButton.tsx
git commit -m "feat: pass moduleSlug to markComplete for full state response"
```

---

## Task 8: Update Module.tsx to Pass moduleSlug and Handle Response

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add helper to update state from lenses array**

After the load effect, add:

```typescript
// Helper to update completedSections from lenses array
const updateCompletedFromLenses = useCallback((lenses: LensProgress[]) => {
  const completed = new Set<number>();
  lenses.forEach((lens, index) => {
    if (lens.completed) {
      completed.add(index);
    }
  });
  setCompletedSections(completed);
}, []);
```

**Step 2: Update handleMarkComplete to use response lenses**

Replace the handleMarkComplete callback:

```typescript
const handleMarkComplete = useCallback(
  (sectionIndex: number, apiResponse?: MarkCompleteResponse) => {
    // Check if this is the first completion (for auth prompt)
    const isFirstCompletion = completedSections.size === 0;

    // Update state from API response if lenses array provided
    if (apiResponse?.lenses) {
      updateCompletedFromLenses(apiResponse.lenses);
    } else {
      // Fallback: just add this section (shouldn't happen with module_slug)
      setCompletedSections((prev) => {
        const next = new Set(prev);
        next.add(sectionIndex);
        return next;
      });
    }

    // Prompt for auth after first section completion (if anonymous)
    if (isFirstCompletion && !isAuthenticated && !hasPromptedAuth) {
      setShowAuthPrompt(true);
      setHasPromptedAuth(true);
    }

    // Check if module is now complete based on API response
    if (apiResponse?.module_status === "completed") {
      setApiConfirmedComplete(true);
      return;
    }

    // Navigate to next section
    if (module && sectionIndex < module.sections.length - 1) {
      const nextIndex = sectionIndex + 1;
      if (viewMode === "continuous") {
        handleStageClick(nextIndex);
      } else {
        setCurrentSectionIndex(nextIndex);
        setViewingStageIndex(null);
      }
    }
  },
  [
    completedSections.size,
    isAuthenticated,
    hasPromptedAuth,
    module,
    viewMode,
    handleStageClick,
    updateCompletedFromLenses,
  ],
);
```

**Step 3: Pass moduleSlug to MarkCompleteButton**

Find the MarkCompleteButton usage in the render section and add moduleSlug:

```typescript
<MarkCompleteButton
  isCompleted={completedSections.has(sectionIndex)}
  onComplete={(response) =>
    handleMarkComplete(sectionIndex, response)
  }
  onNext={handleNext}
  hasNext={sectionIndex < module.sections.length - 1}
  contentId={section.contentId ?? undefined}
  contentType="lens"
  contentTitle={...}
  moduleSlug={moduleId}  // ADD THIS
/>
```

**Step 4: Add import for MarkCompleteResponse type**

```typescript
import type { MarkCompleteResponse } from "@/api/progress";
```

**Step 5: Run test to verify it passes**

Run: `cd web_frontend && npm test -- src/views/__tests__/Module.progress.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add web_frontend/src/views/Module.tsx
git commit -m "feat: update completedSections from completion response lenses array"
```

---

## Task 9: Write Failing Test for Login Flow (Claim + Re-fetch)

**Files:**
- Modify: `web_frontend/src/views/__tests__/Module.progress.test.tsx`

**Step 1: Add mock for claimSessionRecords**

```typescript
vi.mock("@/api/progress", () => ({
  markComplete: vi.fn(),
  updateTimeSpent: vi.fn(),
  claimSessionRecords: vi.fn(),
}));

import { markComplete, claimSessionRecords } from "@/api/progress";
```

**Step 2: Add test for login flow**

```typescript
describe("Module progress on login", () => {
  it("claims anonymous records and re-fetches progress when user logs in", async () => {
    // Start anonymous
    let authState = {
      isAuthenticated: false,
      isInSignupsTable: false,
      isInActiveGroup: false,
      login: vi.fn(),
    };

    vi.mocked(useAuth).mockImplementation(() => authState);

    const anonymousProgress = {
      ...mockProgress,
      progress: { completed: 1, total: 2 },
      lenses: [
        { ...mockProgress.lenses[0], completed: true },
        { ...mockProgress.lenses[1], completed: false },
      ],
    };

    const authenticatedProgress = {
      ...mockProgress,
      progress: { completed: 2, total: 2 },
      lenses: [
        { ...mockProgress.lenses[0], completed: true },
        { ...mockProgress.lenses[1], completed: true },
      ],
    };

    (getModuleProgress as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(anonymousProgress)
      .mockResolvedValueOnce(authenticatedProgress);

    (claimSessionRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      progress_records_claimed: 1,
      chat_sessions_claimed: 0,
    });

    const { rerender } = render(
      <Module courseId="test-course" moduleId="test-module" />,
    );

    // Wait for initial load
    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalledTimes(1);
    });

    // Simulate login
    authState = { ...authState, isAuthenticated: true };
    vi.mocked(useAuth).mockImplementation(() => authState);
    rerender(<Module courseId="test-course" moduleId="test-module" />);

    // Should claim records and re-fetch
    await waitFor(() => {
      expect(claimSessionRecords).toHaveBeenCalled();
      expect(getModuleProgress).toHaveBeenCalledTimes(2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web_frontend && npm test -- src/views/__tests__/Module.progress.test.tsx`
Expected: FAIL - claimSessionRecords not called on login

**Step 3: Commit failing test**

```bash
git add web_frontend/src/views/__tests__/Module.progress.test.tsx
git commit -m "test: add failing test for claim + re-fetch on login"
```

---

## Task 10: Implement Login Flow in Module.tsx

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add import for claimSessionRecords**

```typescript
import { claimSessionRecords } from "@/api/progress";
```

**Step 2: Add import for useAnonymousToken hook**

```typescript
import { useAnonymousToken } from "@/hooks/useAnonymousToken";
```

**Step 3: Get anonymous token in component**

After the useAuth hook:

```typescript
const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } =
  useAuth();
const { token: anonymousToken } = useAnonymousToken();
```

**Step 4: Add effect to handle login transition**

After the load effect, add:

```typescript
// Track previous auth state for detecting login
const wasAuthenticated = useRef(isAuthenticated);

// Handle login: claim anonymous records and re-fetch progress
useEffect(() => {
  // Only run when transitioning from anonymous to authenticated
  if (isAuthenticated && !wasAuthenticated.current && anonymousToken && moduleId) {
    async function handleLogin() {
      try {
        // Claim any anonymous progress/chat records
        await claimSessionRecords(anonymousToken);

        // Re-fetch progress (now includes claimed records)
        const progressResult = await getModuleProgress(moduleId);
        if (progressResult) {
          setModuleProgress(progressResult);
          updateCompletedFromLenses(progressResult.lenses);
          if (progressResult.status === "completed") {
            setApiConfirmedComplete(true);
          }
        }
      } catch (e) {
        console.error("[Module] Failed to handle login:", e);
      }
    }
    handleLogin();
  }
  wasAuthenticated.current = isAuthenticated;
}, [isAuthenticated, anonymousToken, moduleId, updateCompletedFromLenses]);
```

**Step 5: Run test to verify it passes**

Run: `cd web_frontend && npm test -- src/views/__tests__/Module.progress.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add web_frontend/src/views/Module.tsx
git commit -m "feat: claim anonymous records and re-fetch progress on login"
```

---

## Task 11: Run Full Test Suite and Linting

**Files:**
- None (verification only)

**Step 1: Run all frontend tests**

Run: `cd web_frontend && npm test`
Expected: All tests pass

**Step 2: Run ESLint**

Run: `cd web_frontend && npm run lint`
Expected: No errors

**Step 3: Run TypeScript build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds

**Step 4: Run backend tests**

Run: `pytest web_api/tests/ -v`
Expected: All tests pass

**Step 5: Run Python linting**

Run: `ruff check . && ruff format --check .`
Expected: No errors

**Step 6: Fix any issues and commit**

```bash
git add -A
git commit -m "fix: address linting and type errors"
```

---

## Task 12: Manual Integration Test on Staging

**Files:**
- None (manual testing)

**Step 1: Deploy to staging**

Push changes and deploy to staging environment.

**Step 2: Test progress loading**

1. Open a module with existing progress
2. Verify progress shows on load
3. Check Network tab: `GET /api/modules/{slug}/progress` called

**Step 3: Test progress updating**

1. Mark a section complete
2. Check Network tab: `POST /api/progress/complete` with `module_slug` in body
3. Verify response includes `lenses` array
4. Verify UI updates from response (no second GET request)

**Step 4: Test login flow**

1. Start as anonymous user
2. Complete a section
3. Log in
4. Verify progress persists (was claimed)
5. Check Network tab: `POST /api/progress/claim` then `GET /api/modules/{slug}/progress`

**Step 5: Test cross-browser persistence**

1. Complete sections in one browser
2. Open same module in different browser (same account)
3. Verify progress shows correctly

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: database as single source of truth for module progress"
```

---

## Summary

| Task | Description | Type |
|------|-------------|------|
| 1 | Backend: return full state when module_slug provided | Backend |
| 2 | Frontend: add getModuleProgress API client | API client |
| 3 | Frontend: update markComplete types | API client |
| 4 | Test: failing test for progress loading | RED |
| 5 | Frontend: implement progress loading, remove localStorage | GREEN |
| 6 | Test: failing test for state update from response | RED |
| 7 | Frontend: pass moduleSlug to MarkCompleteButton | Implementation |
| 8 | Frontend: update state from response lenses | GREEN |
| 9 | Test: failing test for login flow | RED |
| 10 | Frontend: claim + re-fetch on login | GREEN |
| 11 | Verification: tests, lint, build | Verification |
| 12 | Manual integration test | Integration |

**Key architectural decisions:**
- Database is single source of truth (no localStorage)
- POST completion returns full module state (Option C)
- Login triggers claim + re-fetch
- Chat session conflicts: keep authenticated over anonymous
