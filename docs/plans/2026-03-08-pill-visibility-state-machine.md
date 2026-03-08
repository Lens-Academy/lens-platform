# Pill Visibility State Machine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken three-source-of-truth pill visibility system with a single `useReducer`-based state machine that owns all visibility decisions, without adding re-renders to the 1600-line Module.tsx.

**Architecture:** A pure reducer (`pillReducer`) defines 4 states and 3 events. Module.tsx's scroll handler writes to a ref + notifies listeners (same pattern as `currentSegmentIndexRef`/`segmentIndexListeners` already used for DebugOverlay). ChatInlineShell subscribes via `useSyncExternalStore`, owns the state machine reducer via `usePillVisibility` hook. Only ChatInlineShell re-renders on pill state changes — Module.tsx never re-renders. `animateInputFlight` gets an `onDone` callback and stops touching opacity.

**Tech Stack:** React 19, TypeScript, Vitest (jsdom), Tailwind CSS v4, Web Animations API (WAAPI)

**Design doc:** `docs/designs/pill-visibility-state-machine.md`

**Prior broken attempt:** Four files currently have broken changes from a failed first attempt at React-driven pill visibility. This plan replaces all of them:
- `Module.tsx` — has `inlinePillVisible` useState + `setInlinePillVisible` in scroll handler (Task 4 removes)
- `ChatInlineShell.tsx` — has `pillVisible` prop + `pillHidden` forwarding logic (Task 6 replaces)
- `ChatInputArea.tsx` — has `pillHidden` prop + `opacity-0` class (kept as-is — correct in both old and new)
- `animateInputFlight.ts` — has `opacity: 1` in WAAPI keyframes (Task 3 replaces entire file)

---

## Performance model

```
Module.tsx scroll handler (rAF)
    │ writes boolean to ref, notifies listeners — NO setState, NO re-render
    ▼
sidebarAllowedRef + sidebarAllowedListeners  (ref-based store)
    │
    ▼ useSyncExternalStore — ONLY ChatInlineShell re-renders
ChatInlineShell
    │ owns useReducer via usePillVisibility hook
    │ 2 re-renders per transition (enter transitional state + settle)
    ▼
pillVisible → opacity-0 class on pill div
sidebarShouldBeOpen → sidebarRef.current?.setAllowed() (imperative, 0 re-renders)
```

Module.tsx: **0 re-renders** from pill visibility changes.
ChatInlineShell: **2 re-renders** per sidebar transition (infrequent — only when user scrolls across the 20-80% viewport boundary).

---

## Task 1: Write and test the pure reducer

**Files:**
- Create: `web_frontend/src/hooks/usePillVisibility.ts`
- Create: `web_frontend/src/hooks/__tests__/usePillVisibility.test.ts`

### Step 1: Write failing tests for `pillReducer`

Create `web_frontend/src/hooks/__tests__/usePillVisibility.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { pillReducer, type PillState, type PillEvent } from "../usePillVisibility";

describe("pillReducer", () => {
  // --- Forward transitions ---
  test("sidebar → to-inline on SIDEBAR_DISALLOWED", () => {
    expect(pillReducer("sidebar", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("to-inline");
  });

  test("to-inline → inline on ANIMATION_DONE", () => {
    expect(pillReducer("to-inline", { type: "ANIMATION_DONE" }))
      .toBe("inline");
  });

  test("inline → to-sidebar on SIDEBAR_ALLOWED", () => {
    expect(pillReducer("inline", { type: "SIDEBAR_ALLOWED" }))
      .toBe("to-sidebar");
  });

  test("to-sidebar → sidebar on ANIMATION_DONE", () => {
    expect(pillReducer("to-sidebar", { type: "ANIMATION_DONE" }))
      .toBe("sidebar");
  });

  // --- Interruptions ---
  test("to-inline → to-sidebar on SIDEBAR_ALLOWED (interrupted)", () => {
    expect(pillReducer("to-inline", { type: "SIDEBAR_ALLOWED" }))
      .toBe("to-sidebar");
  });

  test("to-sidebar → to-inline on SIDEBAR_DISALLOWED (interrupted)", () => {
    expect(pillReducer("to-sidebar", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("to-inline");
  });

  // --- No-ops (redundant events) ---
  test("sidebar ignores SIDEBAR_ALLOWED", () => {
    expect(pillReducer("sidebar", { type: "SIDEBAR_ALLOWED" }))
      .toBe("sidebar");
  });

  test("inline ignores SIDEBAR_DISALLOWED", () => {
    expect(pillReducer("inline", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("inline");
  });

  // --- ANIMATION_DONE in terminal states (idempotent) ---
  test("sidebar ignores ANIMATION_DONE", () => {
    expect(pillReducer("sidebar", { type: "ANIMATION_DONE" }))
      .toBe("sidebar");
  });

  test("inline ignores ANIMATION_DONE", () => {
    expect(pillReducer("inline", { type: "ANIMATION_DONE" }))
      .toBe("inline");
  });

  // --- Rapid toggling ---
  test("rapid toggle: sidebar → to-inline → to-sidebar → to-inline", () => {
    let s: PillState = "sidebar";
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" });
    s = pillReducer(s, { type: "SIDEBAR_ALLOWED" });
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" });
    expect(s).toBe("to-inline");
  });

  test("rapid toggle settles correctly with ANIMATION_DONE", () => {
    let s: PillState = "sidebar";
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" });
    s = pillReducer(s, { type: "SIDEBAR_ALLOWED" });
    s = pillReducer(s, { type: "ANIMATION_DONE" });
    expect(s).toBe("sidebar");
  });
});
```

### Step 2: Run tests — verify they fail

Run: `cd web_frontend && npx vitest run src/hooks/__tests__/usePillVisibility.test.ts`

Expected: FAIL — `pillReducer` does not exist yet.

### Step 3: Implement `pillReducer` — minimal code

Create `web_frontend/src/hooks/usePillVisibility.ts` with only the types and reducer:

```typescript
export type PillState =
  | "sidebar"
  | "to-inline"
  | "inline"
  | "to-sidebar";

export type PillEvent =
  | { type: "SIDEBAR_ALLOWED" }
  | { type: "SIDEBAR_DISALLOWED" }
  | { type: "ANIMATION_DONE" };

export function pillReducer(state: PillState, event: PillEvent): PillState {
  switch (state) {
    case "sidebar":
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";
      return state;

    case "to-inline":
      if (event.type === "ANIMATION_DONE") return "inline";
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";
      return state;

    case "inline":
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";
      return state;

    case "to-sidebar":
      if (event.type === "ANIMATION_DONE") return "sidebar";
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";
      return state;
  }
}
```

### Step 4: Run tests — verify they pass

Run: `cd web_frontend && npx vitest run src/hooks/__tests__/usePillVisibility.test.ts`

Expected: All 11 tests PASS.

### Step 5: Commit

```
jj describe -m "feat: add pillReducer state machine with tests"
jj new
```

---

## Task 2: Write and test derived functions

**Files:**
- Modify: `web_frontend/src/hooks/usePillVisibility.ts`
- Modify: `web_frontend/src/hooks/__tests__/usePillVisibility.test.ts`

### Step 1: Write failing tests for `inlinePillVisible` and `sidebarOpen`

Update the import in the test file and append new describe blocks:

```typescript
import { pillReducer, inlinePillVisible, sidebarOpen, type PillState, type PillEvent } from "../usePillVisibility";

// ... (existing pillReducer tests above) ...

describe("inlinePillVisible", () => {
  test("hidden only in sidebar state", () => {
    expect(inlinePillVisible("sidebar")).toBe(false);
  });

  test("visible during to-inline", () => {
    expect(inlinePillVisible("to-inline")).toBe(true);
  });

  test("visible during inline", () => {
    expect(inlinePillVisible("inline")).toBe(true);
  });

  test("visible during to-sidebar (clone needs visible source)", () => {
    expect(inlinePillVisible("to-sidebar")).toBe(true);
  });
});

describe("sidebarOpen", () => {
  test("open during sidebar", () => {
    expect(sidebarOpen("sidebar")).toBe(true);
  });

  test("open during to-sidebar", () => {
    expect(sidebarOpen("to-sidebar")).toBe(true);
  });

  test("closed during inline", () => {
    expect(sidebarOpen("inline")).toBe(false);
  });

  test("closed during to-inline", () => {
    expect(sidebarOpen("to-inline")).toBe(false);
  });
});
```

### Step 2: Run tests — verify new tests fail

Run: `cd web_frontend && npx vitest run src/hooks/__tests__/usePillVisibility.test.ts`

Expected: FAIL — `inlinePillVisible` and `sidebarOpen` not exported.

### Step 3: Implement derived functions

Add to `web_frontend/src/hooks/usePillVisibility.ts` after the reducer:

```typescript
export function inlinePillVisible(state: PillState): boolean {
  return state !== "sidebar";
}

export function sidebarOpen(state: PillState): boolean {
  return state === "sidebar" || state === "to-sidebar";
}
```

### Step 4: Run tests — verify all pass

Run: `cd web_frontend && npx vitest run src/hooks/__tests__/usePillVisibility.test.ts`

Expected: All tests PASS (11 reducer + 4 + 4 = 19 total).

### Step 5: Commit

```
jj describe -m "feat: add inlinePillVisible and sidebarOpen derived functions with tests"
jj new
```

---

## Task 3: Update `animateInputFlight` to accept `onDone` callback

**Files:**
- Modify: `web_frontend/src/utils/animateInputFlight.ts`

### Step 1: Note on testing

No existing tests for `animateInputFlight` — it's tightly coupled to DOM/WAAPI. The contract is verified via the hook integration tests in Task 5. `onDone` defaults to no-op so existing callers (Module.tsx) keep compiling until Task 6 wires the hook.

### Step 2: Replace `animateInputFlight.ts`

Key changes:
1. Add `onDone` parameter with default no-op: `onDone: () => void = () => {}`
2. Remove ALL `opacity` from WAAPI keyframes and inline styles on `inlinePill`
3. Keep `sidebarPill.style.opacity` (sidebar pill is not React-managed)
4. Call `onDone()` synchronously for `prefers-reduced-motion`
5. Call `onDone()` in `onfinish` handlers and when pills are missing
6. Do NOT call `onDone()` on cancel

```typescript
let activeAnimation: Animation | null = null;
let cleanupFn: (() => void) | null = null;

function cleanup() {
  const fn = cleanupFn;
  cleanupFn = null;
  activeAnimation = null;
  fn?.();
}

/**
 * Animate the chat input pill between sidebar and inline positions.
 *
 * Handles transform/position only — never reads or writes opacity on the
 * inline pill. Calls `onDone` on natural completion (onfinish). Does NOT
 * call `onDone` on cancel — the caller uses a generation counter to
 * discard stale callbacks regardless.
 */
export function animateInputFlight(
  direction: "to-inline" | "to-sidebar",
  onDone: () => void = () => {},
) {
  activeAnimation?.cancel();
  cleanup();

  // Respect reduced motion — call onDone synchronously so state machine
  // transitions to terminal state immediately
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onDone();
    return;
  }

  const sidebarPill = document.querySelector(
    '[data-chat-input-pill="sidebar"]',
  ) as HTMLElement | null;
  const inlinePill = document.querySelector(
    '[data-chat-input-pill="inline"]',
  ) as HTMLElement | null;
  if (!sidebarPill || !inlinePill) {
    onDone();
    return;
  }

  if (direction === "to-inline") {
    animateToInline(sidebarPill, inlinePill, onDone);
  } else {
    animateToSidebar(sidebarPill, inlinePill, onDone);
  }
}

function animateToInline(
  sidebarPill: HTMLElement,
  inlinePill: HTMLElement,
  onDone: () => void,
) {
  const fromRect = sidebarPill.getBoundingClientRect();
  const toRect = inlinePill.getBoundingClientRect();

  const deltaX = fromRect.left - toRect.left;
  const deltaY = fromRect.top - toRect.top;
  const scaleX = fromRect.width / toRect.width;
  const scaleY = fromRect.height / toRect.height;

  sidebarPill.style.opacity = "0";

  inlinePill.style.transformOrigin = "top left";
  inlinePill.style.transform =
    `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;

  cleanupFn = () => {
    sidebarPill.style.opacity = "";
    inlinePill.style.transform = "";
    inlinePill.style.transformOrigin = "";
  };

  activeAnimation = inlinePill.animate(
    [
      {
        transformOrigin: "top left",
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
      },
      {
        transformOrigin: "top left",
        transform: "none",
      },
    ],
    { duration: 900, easing: "ease-in-out" },
  );

  activeAnimation.onfinish = () => {
    sidebarPill.style.opacity = "";
    inlinePill.style.transform = "";
    inlinePill.style.transformOrigin = "";
    activeAnimation = null;
    cleanupFn = null;
    onDone();
  };

  activeAnimation.oncancel = () => {};
}

function animateToSidebar(
  sidebarPill: HTMLElement,
  inlinePill: HTMLElement,
  onDone: () => void,
) {
  const fromRect = inlinePill.getBoundingClientRect();
  const closedRect = sidebarPill.getBoundingClientRect();
  const sidebarWidth = window.innerWidth >= 1280 ? 384 : 320;
  const toRect = new DOMRect(
    closedRect.left - sidebarWidth,
    closedRect.top,
    closedRect.width,
    closedRect.height,
  );

  const el = inlinePill.cloneNode(true) as HTMLElement;
  el.className = inlinePill.className + " pointer-events-none";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "100",
    top: `${fromRect.top}px`,
    left: `${fromRect.left}px`,
    width: `${fromRect.width}px`,
    height: `${fromRect.height}px`,
    margin: "0",
  });
  document.body.appendChild(el);

  sidebarPill.style.opacity = "0";

  cleanupFn = () => {
    el.remove();
    sidebarPill.style.opacity = "";
  };

  activeAnimation = el.animate(
    [
      {
        top: `${fromRect.top}px`,
        left: `${fromRect.left}px`,
        width: `${fromRect.width}px`,
        height: `${fromRect.height}px`,
      },
      {
        top: `${toRect.top}px`,
        left: `${toRect.left}px`,
        width: `${toRect.width}px`,
        height: `${toRect.height}px`,
      },
    ],
    // fill: "forwards" keeps clone at final position until onfinish removes it
    { duration: 900, easing: "ease-in-out", fill: "forwards" },
  );

  activeAnimation.onfinish = () => {
    el.remove();
    sidebarPill.style.opacity = "";
    activeAnimation = null;
    cleanupFn = null;
    onDone();
  };

  activeAnimation.oncancel = () => {};
}
```

### Step 3: Verify build passes

Run: `cd web_frontend && npx tsc --noEmit`

Expected: PASS — `onDone` has a default no-op, so existing callers compile.

### Step 4: Commit

```
jj describe -m "refactor: animateInputFlight accepts onDone callback, removes opacity manipulation"
jj new
```

---

## Task 4: Add ref-based store for sidebarAllowed in Module.tsx

This follows the existing `currentSegmentIndexRef` + `segmentIndexListeners` pattern already used for DebugOverlay. The scroll handler writes to a ref and notifies listeners — no `useState`, no Module.tsx re-render.

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

### Step 1: Add the ref-based store

Near the existing `currentSegmentIndexRef` / `segmentIndexListeners` declarations (around line 599-600), add:

```typescript
// Ref-based store for scroll-refined sidebar allowed state.
// Same pattern as segmentIndex — write from scroll handler, subscribe
// from ChatInlineShell via useSyncExternalStore. Module never re-renders.
const sidebarAllowedRef = useRef(sidebarAllowed); // initial: section-level default
const sidebarAllowedListeners = useRef(new Set<() => void>());
```

### Step 2: Update the scroll handler

In the scroll handler body (around line 713-728), replace the transition block:

**Before (current broken code):**
```typescript
if (allowed !== lastSidebarAllowed.current) {
  lastSidebarAllowed.current = allowed;
  setInlinePillVisible(!allowed);
  if (!allowed) animateInputFlight("to-inline");
  else animateInputFlight("to-sidebar");
  sidebarRef.current?.setAllowed(allowed);
  if (!allowed) sidebarAllowedLockUntil.current = Date.now() + 350;
}
```

**After:**
```typescript
if (allowed !== lastSidebarAllowed.current) {
  lastSidebarAllowed.current = allowed;
  sidebarAllowedRef.current = allowed;
  sidebarAllowedListeners.current.forEach(fn => fn());
  if (!allowed) sidebarAllowedLockUntil.current = Date.now() + 350;
}
```

Three lines instead of six. No `setState`, no `animateInputFlight`, no `sidebarRef.setAllowed`. The subscribers (ChatInlineShell's hook) handle all of that.

### Step 3: Update the non-article early return

At line 662-665, replace:

```typescript
if (!isArticleSection) {
  sidebarRef.current?.setAllowed(sidebarAllowed);
  return;
}
```

With:

```typescript
if (!isArticleSection) {
  // sidebarAllowedRef starts at `sidebarAllowed` (false for non-article).
  // No need to write — the hook reads the initial value on mount.
  return;
}
```

### Step 4: Update the section-change reset

In the `useEffect` that resets on section change (line 658-660), add a ref reset:

```typescript
// Reset lock on section change
lastSidebarAllowed.current = true;
sidebarAllowedLockUntil.current = 0;
sidebarAllowedRef.current = sidebarAllowed;
sidebarAllowedListeners.current.forEach(fn => fn());
```

### Step 5: Remove old state and imports

- Remove: `const [inlinePillVisible, setInlinePillVisible] = useState(false);` (line 448)
- Remove: `import { animateInputFlight }` (if still imported — it's now only called from the hook)

### Step 6: Pass the store refs to ChatInlineShell

At both ChatInlineShell render sites (lines ~1048-1071 and ~1322-1340), add props:

```tsx
<ChatInlineShell
  // ... existing props ...
  pillId="inline"
  sidebarAllowedRef={sidebarAllowedRef}
  sidebarAllowedListeners={sidebarAllowedListeners}
  sidebarRef={sidebarRef}
  // Remove: pillVisible={inlinePillVisible}
/>
```

### Step 7: Verify build (will have type errors until Task 5 updates ChatInlineShell)

This is OK — we'll fix the types in Task 5. Run `npx vitest run` to ensure existing tests still pass (they don't depend on pill visibility).

### Step 8: Commit

```
jj describe -m "refactor: replace pill visibility setState with ref-based store in Module.tsx scroll handler"
jj new
```

---

## Task 5: Write the `usePillVisibility` hook with `useSyncExternalStore`

**Files:**
- Modify: `web_frontend/src/hooks/usePillVisibility.ts`
- Modify: `web_frontend/src/hooks/__tests__/usePillVisibility.test.ts`

### Step 1: Write failing tests for the hook

Add to the test file:

```typescript
import { renderHook, act } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
import { usePillVisibility } from "../usePillVisibility";

// Mock animateInputFlight — the slow/external boundary
vi.mock("@/utils/animateInputFlight", () => ({
  animateInputFlight: vi.fn((_dir: string, onDone: () => void) => {
    setTimeout(onDone, 0);
  }),
}));

describe("usePillVisibility hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: create a minimal ref-based store (same shape as Module.tsx)
  function createStore(initial: boolean) {
    const ref = { current: initial };
    const listeners = { current: new Set<() => void>() };
    function set(value: boolean) {
      ref.current = value;
      listeners.current.forEach(fn => fn());
    }
    return { ref, listeners, set };
  }

  test("non-article section (initial false): starts in inline state", () => {
    const store = createStore(false);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillVisible).toBe(true);
    expect(result.current.pillState).toBe("inline");
  });

  test("article section (initial true): starts in sidebar state", () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillVisible).toBe(false);
    expect(result.current.pillState).toBe("sidebar");
  });

  test("transitions when store changes from true to false", async () => {
    const store = createStore(true);
    const mockSetAllowed = vi.fn();
    const sidebarRef = { current: { setAllowed: mockSetAllowed } };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef: sidebarRef as any,
      }),
    );

    expect(result.current.pillState).toBe("sidebar");

    // Simulate scroll handler writing to store
    act(() => { store.set(false); });
    expect(result.current.pillState).toBe("to-inline");
    expect(result.current.pillVisible).toBe(true);

    // Animation completes
    await act(async () => { vi.runAllTimers(); });
    expect(result.current.pillState).toBe("inline");

    // Sidebar was updated imperatively
    expect(mockSetAllowed).toHaveBeenCalledWith(false);
  });

  test("transitions when store changes from false to true", async () => {
    const store = createStore(false);
    const mockSetAllowed = vi.fn();
    const sidebarRef = { current: { setAllowed: mockSetAllowed } };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef: sidebarRef as any,
      }),
    );

    expect(result.current.pillState).toBe("inline");

    act(() => { store.set(true); });
    expect(result.current.pillState).toBe("to-sidebar");

    await act(async () => { vi.runAllTimers(); });
    expect(result.current.pillState).toBe("sidebar");
    expect(mockSetAllowed).toHaveBeenCalledWith(true);
  });

  test("rapid toggle: stale onDone ignored via generation counter", async () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    // Toggle rapidly: true → false → true
    act(() => { store.set(false); });
    act(() => { store.set(true); });

    await act(async () => { vi.runAllTimers(); });
    expect(result.current.pillState).toBe("sidebar");
  });
});
```

### Step 2: Run tests — verify they fail

Run: `cd web_frontend && npx vitest run src/hooks/__tests__/usePillVisibility.test.ts`

Expected: FAIL — `usePillVisibility` not exported yet.

### Step 3: Implement `usePillVisibility` hook

Add to `web_frontend/src/hooks/usePillVisibility.ts`:

```typescript
import { useReducer, useEffect, useRef, useSyncExternalStore } from "react";
import { animateInputFlight } from "@/utils/animateInputFlight";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";

// ... (existing types, reducer, derived functions from Tasks 1-2) ...

type PillVisibilityInput = {
  /** Ref written by Module.tsx scroll handler */
  sidebarAllowedRef: React.RefObject<boolean>;
  /** Listener set notified by Module.tsx scroll handler */
  sidebarAllowedListeners: React.RefObject<Set<() => void>>;
  /** Sidebar imperative handle — for calling setAllowed */
  sidebarRef: React.RefObject<ChatSidebarHandle | null>;
};

export function usePillVisibility({
  sidebarAllowedRef,
  sidebarAllowedListeners,
  sidebarRef,
}: PillVisibilityInput) {
  // Subscribe to the ref-based store. Only this component re-renders
  // when the scroll handler writes a new value — Module.tsx does not.
  const scrollSidebarAllowed = useSyncExternalStore(
    (cb) => {
      sidebarAllowedListeners.current.add(cb);
      return () => sidebarAllowedListeners.current.delete(cb);
    },
    () => sidebarAllowedRef.current,
  );

  // Initialize with correct state — no spurious animation on mount.
  const [state, dispatch] = useReducer(
    pillReducer,
    scrollSidebarAllowed ? "sidebar" : "inline",
  );

  // Detect transitions in scrollSidebarAllowed
  const prevAllowedRef = useRef(scrollSidebarAllowed);
  useEffect(() => {
    if (scrollSidebarAllowed !== prevAllowedRef.current) {
      prevAllowedRef.current = scrollSidebarAllowed;
      dispatch({
        type: scrollSidebarAllowed ? "SIDEBAR_ALLOWED" : "SIDEBAR_DISALLOWED",
      });
    }
  }, [scrollSidebarAllowed]);

  // Animation trigger + generation counter
  const prevStateRef = useRef(state);
  const generationRef = useRef(0);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;

    if (
      (state === "to-inline" && prev !== "to-inline") ||
      (state === "to-sidebar" && prev !== "to-sidebar")
    ) {
      const gen = ++generationRef.current;
      const direction = state === "to-inline" ? "to-inline" : "to-sidebar";
      animateInputFlight(direction, () => {
        if (gen === generationRef.current) {
          dispatch({ type: "ANIMATION_DONE" });
        }
      });
    }
  }, [state]);

  // Sync sidebar imperatively (no re-render in Module.tsx)
  const shouldBeOpen = sidebarOpen(state);
  useEffect(() => {
    sidebarRef.current?.setAllowed(shouldBeOpen);
  }, [shouldBeOpen, sidebarRef]);

  return {
    pillVisible: inlinePillVisible(state),
    pillState: state,
  };
}
```

### Step 4: Run tests — verify they pass

Run: `cd web_frontend && npx vitest run src/hooks/__tests__/usePillVisibility.test.ts`

Expected: All tests PASS.

### Step 5: Commit

```
jj describe -m "feat: add usePillVisibility hook with useSyncExternalStore subscription"
jj new
```

---

## Task 6: Wire hook into ChatInlineShell

Hooks can't be called conditionally, and not all ChatInlineShell instances need pill visibility (feedback shells don't have `pillId`). Solution: a small `PillVisibilityWrapper` render-prop component that owns the hook. Only shells with store refs use it; feedback shells render ChatInputArea directly. This isolates re-renders to just the ChatInputArea subtree.

**Files:**
- Modify: `web_frontend/src/components/module/ChatInlineShell.tsx`

### Step 1: Add new props and the wrapper component

Add to `ChatInlineShellProps` (replacing the old `pillVisible` prop):

```typescript
// Remove: pillVisible?: boolean;
sidebarAllowedRef?: React.RefObject<boolean>;
sidebarAllowedListeners?: React.RefObject<Set<() => void>>;
sidebarRef?: React.RefObject<ChatSidebarHandle | null>;
```

Add `PillVisibilityWrapper` as a local component in the same file:

```tsx
import { usePillVisibility } from "@/hooks/usePillVisibility";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";

/** Owns the usePillVisibility hook — isolates re-renders to this subtree. */
function PillVisibilityWrapper({
  sidebarAllowedRef,
  sidebarAllowedListeners,
  sidebarRef,
  children,
}: {
  sidebarAllowedRef: React.RefObject<boolean>;
  sidebarAllowedListeners: React.RefObject<Set<() => void>>;
  sidebarRef: React.RefObject<ChatSidebarHandle | null>;
  children: (pillHidden: boolean) => React.ReactNode;
}) {
  const { pillVisible } = usePillVisibility({
    sidebarAllowedRef,
    sidebarAllowedListeners,
    sidebarRef,
  });
  return children(!pillVisible);
}
```

### Step 2: Update the JSX

Replace the ChatInputArea rendering (around line 467-486). Where it currently has:

```tsx
<ChatInputArea
  pillId={pillId}
  pillHidden={pillVisible === false && !!pillId}
  ...
/>
```

Replace with:

```tsx
{sidebarAllowedRef ? (
  <PillVisibilityWrapper
    sidebarAllowedRef={sidebarAllowedRef}
    sidebarAllowedListeners={sidebarAllowedListeners!}
    sidebarRef={sidebarRef!}
  >
    {(pillHidden) => (
      <ChatInputArea
        pillId={pillId}
        pillHidden={pillHidden}
        onSend={...}
        isLoading={isLoading}
        placeholder="Type a message..."
      />
    )}
  </PillVisibilityWrapper>
) : (
  <ChatInputArea
    pillId={pillId}
    onSend={...}
    isLoading={isLoading}
    placeholder="Type a message..."
  />
)}
```

### Step 3: Clean up old props

- Remove `pillVisible` from `ChatInlineShellProps` type
- Remove `pillVisible` from destructuring in the component function signature

### Step 4: Verify build and tests pass

Run: `cd web_frontend && npx vitest run && npx tsc --noEmit`

Expected: All tests PASS, no type errors.

### Step 5: Commit

```
jj describe -m "feat: wire usePillVisibility into ChatInlineShell via wrapper component"
jj new
```

---

## Task 7: Verify with lint + build

### Step 1: Run lint

Run: `cd web_frontend && npm run lint`

Expected: PASS (pre-existing `isCurrent` warnings are OK).

### Step 2: Run build

Run: `cd web_frontend && npm run build`

Expected: PASS.

### Step 3: Commit if needed

```
jj describe -m "fix: lint fixes for pill visibility state machine"
jj new
```

---

## Task 8: Visual verification with Chrome DevTools MCP

### Step 1: Start dev servers if not running

Run: `./scripts/list-servers`

### Step 2: Navigate and verify

Navigate to `http://dev.vps:3300/course/intro-to-ai-safety/module/what-is-ai-safety`.

Check:
1. **Initial load with article section**: Sidebar pill visible, inline pill hidden
2. **Scroll chat into 20-80% band**: Sidebar closes, pill animates to inline, stays visible
3. **Scroll away**: Pill animates to sidebar, inline pill hidden, sidebar opens
4. **Chat-only section**: Inline pill visible immediately, no animation
5. **Rapid scroll**: No stale elements, correct final state
6. **React DevTools**: Verify Module.tsx does NOT re-render on sidebar transitions — only ChatInlineShell/ChatInputArea re-render

---

## Key decisions and gotchas

1. **Ref-based store, not `useState`** — Module.tsx's scroll handler writes `sidebarAllowedRef.current` and notifies `sidebarAllowedListeners`. This is the same pattern as `currentSegmentIndexRef`/`segmentIndexListeners` (used for DebugOverlay). Module.tsx never re-renders from pill state changes.

2. **`useSyncExternalStore` in the hook** — ChatInlineShell subscribes to the ref store. Only it (and ChatInputArea below it) re-renders. 2 re-renders per transition vs 0 for Module.tsx.

3. **`PillVisibilityWrapper` component** — small render-prop wrapper that owns the hook. Isolates re-renders to just the ChatInputArea subtree. Feedback shells skip it entirely (no conditional hook call needed).

4. **`inlinePillVisible` returns `true` for `to-sidebar`** — the clone inherits CSS classes. If the pill has `opacity-0` when `cloneNode(true)` runs, the clone is invisible. Keeping it visible during `to-sidebar` is safe — the clone overlays it at `position: fixed`.

5. **Generation counter** — each animation trigger increments a counter. The `onDone` closure captures its generation and only dispatches `ANIMATION_DONE` if it matches. Prevents stale callbacks from cancelled animations.

6. **`prefers-reduced-motion`** — `animateInputFlight` calls `onDone()` synchronously. Without this, the state machine gets stuck in a transitional state forever.

7. **Non-article sections** — `sidebarAllowedRef` starts at `sidebarAllowed` (which is `false` for chat/test sections). The hook initializes to `"inline"` state — no animation, no dispatch, correct from the start.

8. **Sidebar updated imperatively** — the hook calls `sidebarRef.current?.setAllowed()` in a `useEffect`. This fires one frame after the state change, but the 900ms animation hides any lag.

9. **`onDone` default no-op** — `animateInputFlight`'s `onDone` defaults to `() => {}` so existing callers compile throughout the migration. No broken builds between commits.

10. **Animation duration unchanged** — stays at 900ms. Changing it is a separate UX decision.

11. **`hasActiveInput` is orthogonal** — controls pill mount/unmount (IntersectionObserver). `pillVisible` controls visibility of the mounted pill (scroll handler). They remain independent.
