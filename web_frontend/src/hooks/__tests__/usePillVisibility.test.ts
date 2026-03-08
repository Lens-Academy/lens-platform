import { renderHook, act } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { pillReducer, inlinePillVisible, sidebarOpen, usePillVisibility, type PillState } from "../usePillVisibility";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";

// Mock animateInputFlight — the slow/external boundary
vi.mock("@/utils/animateInputFlight", () => ({
  animateInputFlight: vi.fn((_dir: string, onDone: () => void) => {
    setTimeout(onDone, 0);
  }),
  cancelInputFlight: vi.fn(),
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

  // --- PREF_OPEN / PREF_CLOSED (user toggle) ---
  test("inline → sidebar on PREF_OPEN", () => {
    expect(pillReducer("inline", { type: "PREF_OPEN" }))
      .toBe("sidebar");
  });

  test("sidebar → inline on PREF_CLOSED", () => {
    expect(pillReducer("sidebar", { type: "PREF_CLOSED" }))
      .toBe("inline");
  });

  test("to-inline → sidebar on PREF_OPEN (cancels animation)", () => {
    expect(pillReducer("to-inline", { type: "PREF_OPEN" }))
      .toBe("sidebar");
  });

  test("to-sidebar → inline on PREF_CLOSED (cancels animation)", () => {
    expect(pillReducer("to-sidebar", { type: "PREF_CLOSED" }))
      .toBe("inline");
  });

  test("to-inline → inline on PREF_CLOSED", () => {
    expect(pillReducer("to-inline", { type: "PREF_CLOSED" }))
      .toBe("inline");
  });

  test("to-sidebar → sidebar on PREF_OPEN", () => {
    expect(pillReducer("to-sidebar", { type: "PREF_OPEN" }))
      .toBe("sidebar");
  });

  test("sidebar ignores PREF_OPEN (already there)", () => {
    expect(pillReducer("sidebar", { type: "PREF_OPEN" }))
      .toBe("sidebar");
  });

  test("inline ignores PREF_CLOSED (already there)", () => {
    expect(pillReducer("inline", { type: "PREF_CLOSED" }))
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
    localStorage.removeItem("chat-sidebar-pref");
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
    const sidebarRef = { current: { setAllowed: mockSetAllowed } as unknown as ChatSidebarHandle };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
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
    const sidebarRef = { current: { setAllowed: mockSetAllowed } as unknown as ChatSidebarHandle };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillState).toBe("inline");

    act(() => { store.set(true); });
    expect(result.current.pillState).toBe("to-sidebar");

    await act(async () => { vi.runAllTimers(); });
    expect(result.current.pillState).toBe("sidebar");
    expect(mockSetAllowed).toHaveBeenCalledWith(true);
  });

  test("sidebar pref 'closed': stays inline when scrollSidebarAllowed goes true", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(false);
    const mockSetAllowed = vi.fn();
    const sidebarRef = { current: { setAllowed: mockSetAllowed } as unknown as ChatSidebarHandle };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillState).toBe("inline");

    act(() => { store.set(true); });
    // Should stay inline — no animation, pill stays visible
    expect(result.current.pillState).toBe("inline");
    expect(result.current.pillVisible).toBe(true);
    // setAllowed still called so toggle button shows
    expect(mockSetAllowed).toHaveBeenCalledWith(true);
  });

  test("sidebar pref 'closed': initial scrollSidebarAllowed true starts inline", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillState).toBe("inline");
    expect(result.current.pillVisible).toBe(true);
  });

  test("PREF_OPEN: inline → sidebar when user opens sidebar", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(true);
    const mockSetAllowed = vi.fn();
    const sidebarRef = { current: { setAllowed: mockSetAllowed } as unknown as ChatSidebarHandle };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillState).toBe("inline");

    // User opens sidebar via toggle button
    act(() => {
      localStorage.setItem("chat-sidebar-pref", "open");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    });
    expect(result.current.pillState).toBe("sidebar");
    expect(result.current.pillVisible).toBe(false);
  });

  test("PREF_CLOSED: sidebar → inline when user closes sidebar", () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillState).toBe("sidebar");

    // User closes sidebar via toggle button
    act(() => {
      localStorage.setItem("chat-sidebar-pref", "closed");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    });
    expect(result.current.pillState).toBe("inline");
    expect(result.current.pillVisible).toBe(true);
  });

  test("PREF_OPEN ignored when scroll doesn't allow sidebar", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(false);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
      }),
    );

    expect(result.current.pillState).toBe("inline");

    // User opens sidebar but scroll doesn't allow it
    act(() => {
      localStorage.setItem("chat-sidebar-pref", "open");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    });
    // Should stay inline
    expect(result.current.pillState).toBe("inline");
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
