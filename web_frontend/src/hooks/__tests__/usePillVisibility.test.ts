import { renderHook, act } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { pillReducer, inlinePillVisible, sidebarOpen, usePillVisibility, type PillState } from "../usePillVisibility";

// Mock animateInputFlight — the slow/external boundary
vi.mock("@/utils/animateInputFlight", () => ({
  animateInputFlight: vi.fn((_dir: string, onDone: () => void) => {
    setTimeout(onDone, 0);
  }),
}));

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
