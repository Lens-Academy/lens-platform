# Design: Pill Visibility State Machine

## Status: Draft

## Problem

The inline chat input pill's visibility is controlled by three competing mechanisms:

1. **React conditional rendering** — `hasActiveInput` gates whether `ChatInputArea` mounts
2. **Imperative DOM** — `animateInputFlight.ts` sets `style.opacity` directly
3. **WAAPI animation keyframes** — `opacity: 1` in keyframes intended to override CSS during playback

Two independent observers feed into this: a scroll handler (20-80% viewport band) and an IntersectionObserver (`activeSurface`). These run on different timing. React batches state updates while animation code runs synchronously against the DOM.

Result: the system is impossible to reason about locally. A change to any one mechanism can break the others. The recent attempt to add React-driven visibility via a CSS class failed because:
- For non-article sections, the scroll handler takes an early return and never updates the new state
- The interaction between batched React updates and sync WAAPI is timing-dependent
- No tests exist to catch these edge cases

### Current data flow (broken)

```
ScrollHandler ──┬──▶ sidebarRef.setAllowed()
                ├──▶ animateInputFlight() ──▶ imperative style.opacity
                └──▶ setInlinePillVisible() ──▶ React class opacity-0

IntersectionObserver ──▶ setActiveSurface() ──▶ hasActiveInput ──▶ mount/unmount

Three sources of truth for one visual property.
```

## Proposed Solution

### Principle: One source of truth

A `useReducer`-based state machine owns all visibility decisions. Animation is a fire-and-forget side effect that handles **position/transform only** — it never reads or writes opacity. React owns visibility entirely.

### State machine

```typescript
type PillState =
  | "sidebar"           // Sidebar open, inline pill hidden
  | "to-inline"         // Animating from sidebar to inline position
  | "inline"            // Inline pill visible, sidebar closed
  | "to-sidebar";       // Animating from inline to sidebar position

type PillEvent =
  | { type: "SIDEBAR_ALLOWED" }       // Chat left viewport band
  | { type: "SIDEBAR_DISALLOWED" }    // Chat entered viewport band
  | { type: "ANIMATION_DONE" };       // WAAPI onfinish fired

function pillReducer(state: PillState, event: PillEvent): PillState {
  switch (state) {
    case "sidebar":
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";
      return state;

    case "to-inline":
      if (event.type === "ANIMATION_DONE") return "inline";
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";  // interrupted
      return state;

    case "inline":
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";
      return state;

    case "to-sidebar":
      if (event.type === "ANIMATION_DONE") return "sidebar";
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";  // interrupted
      return state;
  }
}
```

### Derived visibility (pure functions, no side effects)

```typescript
function inlinePillVisible(state: PillState): boolean {
  // Visible during inline, to-inline, AND to-sidebar.
  // During to-sidebar the clone is what the user sees flying away,
  // but the real pill must remain visible so the clone (created after
  // React re-renders) doesn't inherit opacity-0.
  return state !== "sidebar";
}

function sidebarOpen(state: PillState): boolean {
  return state === "sidebar" || state === "to-sidebar";
}
```

Note: `inlinePillVisible` returns `true` for `to-sidebar`. This is because the `useEffect` that triggers `animateToSidebar` runs *after* React re-renders. If the pill had `opacity-0` at render time, the clone (created via `cloneNode`) would inherit it and be invisible during flight. Keeping the pill visible during `to-sidebar` is safe — the clone overlays it at `position: fixed`, so the user only sees the clone. The pill becomes hidden when `ANIMATION_DONE` transitions to `sidebar`.

### The hook

```typescript
function usePillVisibility({
  isArticleSection,
  currentSection,
  chatSegmentEls,
  scrollEl,
}: PillVisibilityInput) {
  const [state, dispatch] = useReducer(pillReducer, "sidebar");

  // Scroll handler: computes whether sidebar is allowed.
  // For non-article chat/test sections: immediate SIDEBAR_DISALLOWED.
  // For article sections: 20-80% band check.
  // Segment index tracking stays in Module.tsx — this hook only
  // owns the sidebar-allowed computation.
  useEffect(() => {
    // ... scroll handler logic extracted from Module.tsx (lines 696-728)
    // Includes the sidebarAllowedLockUntil reflow guard (350ms)
  }, [isArticleSection, currentSection, scrollEl, chatSegmentEls]);

  // Animation trigger: side effect of state transitions.
  // Uses a generation counter to guard against stale onDone callbacks.
  const prevStateRef = useRef(state);
  const generationRef = useRef(0);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;

    if ((state === "to-inline" && prev !== "to-inline") ||
        (state === "to-sidebar" && prev !== "to-sidebar")) {
      const gen = ++generationRef.current;
      const direction = state === "to-inline" ? "to-inline" : "to-sidebar";
      animateInputFlight(direction, () => {
        if (gen === generationRef.current) {
          dispatch({ type: "ANIMATION_DONE" });
        }
      });
    }
  }, [state]);

  return {
    pillVisible: inlinePillVisible(state),
    sidebarAllowed: sidebarOpen(state),
    pillState: state,  // for debugging
  };
}
```

The generation counter (`generationRef`) eliminates reliance on `animateInputFlight` never calling `onDone` on cancel. Each animation trigger increments the generation; the `onDone` closure captures its generation and only dispatches if it still matches. This makes the hook resilient to bugs in the animation utility and eliminates the implicit contract. Cost: one ref, one integer comparison.

### Animation changes

`animateInputFlight` gets a callback parameter for `onfinish`:

```typescript
/**
 * Animate the chat input pill between sidebar and inline positions.
 *
 * Handles transform/position only — never reads or writes opacity.
 * Calls `onDone` on natural completion (onfinish). Does NOT call
 * `onDone` on cancel — the caller uses a generation counter to
 * discard stale callbacks regardless.
 */
function animateInputFlight(
  direction: "to-inline" | "to-sidebar",
  onDone: () => void,
)
```

It handles **transform/position only**. No `style.opacity` anywhere. The function:
- `to-inline`: FLIP transform on inline pill (no opacity in keyframes or inline styles)
- `to-sidebar`: Clone-based position animation, clone removed on finish
- Calls `onDone()` in the WAAPI `onfinish` handler
- On cancel (interrupted by new animation): does NOT call `onDone`
- **`prefers-reduced-motion`**: Calls `onDone()` synchronously before returning, so the state machine immediately transitions to the final state instead of getting stuck

### Component wiring

```tsx
// Module.tsx
const { pillVisible, sidebarAllowed } = usePillVisibility({
  isArticleSection,
  currentSection,
  chatSegmentEls: segmentElsRef.current,
  scrollEl,
});

// Pass to sidebar
sidebarRef.current?.setAllowed(sidebarAllowed);

// Pass to inline shells
<ChatInlineShell pillVisible={pillVisible} ... />
```

`ChatInlineShell` forwards to `ChatInputArea` which applies `opacity-0` when `!pillVisible`. No imperative DOM. No WAAPI opacity. Just a CSS class driven by React state driven by a pure reducer.

### What about `hasActiveInput`?

`hasActiveInput` (driven by `activeSurface` from the IntersectionObserver) controls whether the input area **mounts**. `pillVisible` controls whether the mounted pill is **visible**. These are orthogonal:

- `hasActiveInput=false`: no pill in DOM (nothing to show or hide)
- `hasActiveInput=true, pillVisible=false`: pill in DOM but invisible (sidebar is active)
- `hasActiveInput=true, pillVisible=true`: pill in DOM and visible (inline is active)

The IntersectionObserver and the scroll handler can remain independent — they answer different questions ("which surface owns the input?" vs "should the sidebar be open?").

### Sidebar pill opacity

The sidebar pill's opacity during animation is handled by `animateInputFlight` imperatively — this is fine because the sidebar pill is not React-managed in the same way (it's inside a fixed sidebar component). The state machine doesn't need to own sidebar pill opacity.

## Data flow (proposed)

```
ScrollHandler ──▶ dispatch(SIDEBAR_ALLOWED | SIDEBAR_DISALLOWED)
                          │
                          ▼
                    pillReducer (pure)
                          │
                    ┌─────┴─────┐
                    ▼           ▼
              pillVisible   sidebarAllowed
              (derived)     (derived)
                    │           │
                    ▼           ▼
              CSS class    sidebar.setAllowed()
              on pill div

State transition ──▶ animateInputFlight() [position only]
                          │
                          ▼ onfinish
                    dispatch(ANIMATION_DONE)
                    (guarded by generation counter)
```

One source of truth. Pure functions. Testable.

## Testing strategy

### 1. Reducer unit tests (pure logic, no DOM)

```typescript
describe("pillReducer", () => {
  it("sidebar → to-inline on SIDEBAR_DISALLOWED", () => {
    expect(pillReducer("sidebar", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("to-inline");
  });

  it("to-inline → inline on ANIMATION_DONE", () => {
    expect(pillReducer("to-inline", { type: "ANIMATION_DONE" }))
      .toBe("inline");
  });

  it("to-inline → to-sidebar on SIDEBAR_ALLOWED (interrupted)", () => {
    expect(pillReducer("to-inline", { type: "SIDEBAR_ALLOWED" }))
      .toBe("to-sidebar");
  });

  it("to-sidebar → to-inline on SIDEBAR_DISALLOWED (interrupted)", () => {
    expect(pillReducer("to-sidebar", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("to-inline");
  });

  it("ignores redundant events", () => {
    expect(pillReducer("sidebar", { type: "SIDEBAR_ALLOWED" }))
      .toBe("sidebar");
    expect(pillReducer("inline", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("inline");
  });

  it("handles ANIMATION_DONE in terminal states (idempotent)", () => {
    expect(pillReducer("sidebar", { type: "ANIMATION_DONE" }))
      .toBe("sidebar");
    expect(pillReducer("inline", { type: "ANIMATION_DONE" }))
      .toBe("inline");
  });

  // Rapid toggling: full cycle without ANIMATION_DONE between events
  it("rapid toggle: sidebar → to-inline → to-sidebar → to-inline", () => {
    let s: PillState = "sidebar";
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" }); // to-inline
    s = pillReducer(s, { type: "SIDEBAR_ALLOWED" });    // to-sidebar (interrupted)
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" }); // to-inline (interrupted)
    expect(s).toBe("to-inline");
  });
});
```

### 2. Derived value tests (pure functions)

```typescript
describe("inlinePillVisible", () => {
  it("visible during inline, to-inline, and to-sidebar", () => {
    expect(inlinePillVisible("inline")).toBe(true);
    expect(inlinePillVisible("to-inline")).toBe(true);
    expect(inlinePillVisible("to-sidebar")).toBe(true);
  });
  it("hidden only in sidebar state", () => {
    expect(inlinePillVisible("sidebar")).toBe(false);
  });
});

describe("sidebarOpen", () => {
  it("open during sidebar and to-sidebar", () => {
    expect(sidebarOpen("sidebar")).toBe(true);
    expect(sidebarOpen("to-sidebar")).toBe(true);
  });
  it("closed during inline and to-inline", () => {
    expect(sidebarOpen("inline")).toBe(false);
    expect(sidebarOpen("to-inline")).toBe(false);
  });
});
```

### 3. Hook integration tests (renderHook, mock animateInputFlight)

Test that the hook dispatches correct events in response to scroll position changes. Mock `getBoundingClientRect` for the chat segment elements and fire scroll events. Mock `animateInputFlight` (the slow/external boundary) — it's the one mock boundary. Verify the hook's output changes correctly.

Key scenarios:
- **Non-article chat section**: Hook immediately returns `pillVisible=true, sidebarAllowed=false`
- **Article section, chat scrolls into band**: `pillVisible` transitions to `true`
- **Article section, chat scrolls out of band**: `pillVisible` transitions back to `false`
- **Rapid toggle**: Multiple scroll events before animation completes — verify final state is correct
- **Reduced motion**: Animation completes synchronously — verify state reaches terminal state immediately

### 4. Component tests (prop → class)

```typescript
it("applies opacity-0 when pillHidden", () => {
  render(<ChatInputArea pillHidden={true} onSend={() => {}} isLoading={false} />);
  expect(screen.getByRole("form").querySelector("[data-chat-input-pill]"))
    .toHaveClass("opacity-0");
});
```

### 5. Chrome DevTools MCP (visual verification)

Manual check that animations look correct. Not automated but catches visual regressions the other tests can't.

## Files changed

| File | Change |
|------|--------|
| `src/hooks/usePillVisibility.ts` | **New.** State machine reducer, derived functions, hook with scroll handler + animation trigger |
| `src/hooks/usePillVisibility.test.ts` | **New.** Reducer, derived values, and hook tests |
| `src/views/Module.tsx` | Remove scroll handler sidebar-allowed logic, consume `usePillVisibility` hook |
| `src/utils/animateInputFlight.ts` | Add `onDone` callback, remove all opacity manipulation, call `onDone` synchronously for reduced motion |
| `src/components/module/ChatInputArea.tsx` | Keep `pillHidden` prop (already added) |
| `src/components/module/ChatInlineShell.tsx` | Keep `pillVisible` forwarding (already added) |

Note: Segment index tracking (for DebugOverlay) stays in Module.tsx. Only the sidebar-allowed computation moves into the hook.

## Migration

1. Write reducer + derived functions + tests (pure logic, no DOM)
2. Write the hook with scroll handler extracted from Module.tsx
3. Update `animateInputFlight` to accept `onDone` callback, remove opacity, handle reduced motion
4. Wire hook into Module.tsx, remove old scroll handler sidebar logic
5. Verify with Chrome DevTools MCP
6. Clean up any dead code

## Risks

- **Non-article sections**: The scroll handler effect must dispatch `SIDEBAR_DISALLOWED` immediately for chat/test sections (currently an early return that skips the visibility logic entirely — this is what broke the current implementation).
- **`sidebarAllowedLockUntil`**: The 350ms reflow guard is still needed. Lives inside the hook's scroll handler effect.
- **Future simplification**: If the flight animation is ever removed, this state machine simplifies to a single boolean (`sidebarAllowed` yes/no) since the transitional states only exist because of the animation.
