import { renderHook, act } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { usePillVisibility } from "../usePillVisibility";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";
import { animateInputFlight, cancelInputFlight } from "@/utils/animateInputFlight";

vi.mock("@/utils/animateInputFlight", () => ({
  animateInputFlight: vi.fn(),
  cancelInputFlight: vi.fn(),
}));

describe("usePillVisibility hook", () => {
  beforeEach(() => {
    vi.mocked(animateInputFlight).mockClear();
    vi.mocked(cancelInputFlight).mockClear();
  });

  afterEach(() => {
    localStorage.removeItem("chat-sidebar-pref");
  });

  function createStore(initial: boolean) {
    const ref = { current: initial };
    const listeners = { current: new Set<() => void>() };
    function set(value: boolean) {
      ref.current = value;
      listeners.current.forEach(fn => fn());
    }
    return { ref, listeners, set };
  }

  // --- Initial state ---

  test("scroll=false: pillVisible=true", () => {
    const store = createStore(false);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(true);
    expect(result.current.pillTransition).toBe(false);
  });

  test("scroll=true, pref=open: pillVisible=false", () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(false);
    expect(result.current.pillTransition).toBe(false);
  });

  test("scroll=true, pref=closed: pillVisible=true, pillTransition=true", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(true);
    expect(result.current.pillTransition).toBe(true);
  });

  // --- Scroll transitions (active, pref open) ---

  test("scroll false→true (active, pref open): pillVisible→false, animates to-sidebar", () => {
    const store = createStore(false);
    const mockSetAllowed = vi.fn();
    const sidebarRef = { current: { setAllowed: mockSetAllowed } as unknown as ChatSidebarHandle };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(true);

    act(() => { store.set(true); });
    expect(result.current.pillVisible).toBe(false);
    expect(animateInputFlight).toHaveBeenCalledWith("to-sidebar");
    expect(mockSetAllowed).toHaveBeenCalledWith(true);
  });

  test("scroll true→false (active, pref open): pillVisible→true, animates to-inline", () => {
    const store = createStore(true);
    const mockSetAllowed = vi.fn();
    const sidebarRef = { current: { setAllowed: mockSetAllowed } as unknown as ChatSidebarHandle };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(false);

    act(() => { store.set(false); });
    expect(result.current.pillVisible).toBe(true);
    expect(animateInputFlight).toHaveBeenCalledWith("to-inline");
    expect(mockSetAllowed).toHaveBeenCalledWith(false);
  });

  // --- Scroll transitions with pref closed (no animation) ---

  test("scroll changes, pref closed: no animation, pillVisible stays true", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(false);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(true);

    act(() => { store.set(true); });
    expect(result.current.pillVisible).toBe(true);
    expect(animateInputFlight).not.toHaveBeenCalled();
  });

  // --- Pref changes ---

  test("pref closed: cancelInputFlight called, pillVisible=true, pillTransition=true", () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(false);

    act(() => {
      localStorage.setItem("chat-sidebar-pref", "closed");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    });
    expect(result.current.pillVisible).toBe(true);
    expect(result.current.pillTransition).toBe(true);
    expect(cancelInputFlight).toHaveBeenCalled();
  });

  test("pref opened (scroll=true): cancelInputFlight called, pillVisible=false", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(true);

    act(() => {
      localStorage.setItem("chat-sidebar-pref", "open");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    });
    expect(result.current.pillVisible).toBe(false);
    expect(result.current.pillTransition).toBe(false);
    expect(cancelInputFlight).toHaveBeenCalled();
  });

  test("pref opened (scroll=false): pillVisible stays true", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(false);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(result.current.pillVisible).toBe(true);

    act(() => {
      localStorage.setItem("chat-sidebar-pref", "open");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    });
    // scroll=false, so showInSidebar=false, pillVisible=true
    expect(result.current.pillVisible).toBe(true);
  });

  // --- Inactive shell ---

  test("inactive shell: scroll changes don't trigger animation", () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: false,
      }),
    );

    expect(result.current.pillVisible).toBe(false);

    act(() => { store.set(false); });
    expect(result.current.pillVisible).toBe(true);
    expect(animateInputFlight).not.toHaveBeenCalled();
  });

  test("inactive→active: subsequent transitions use animation", () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    let isActive = false;
    const { result, rerender } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive,
      }),
    );

    // While inactive: no animation
    act(() => { store.set(false); });
    expect(result.current.pillVisible).toBe(true);
    expect(animateInputFlight).not.toHaveBeenCalled();

    // Become active
    isActive = true;
    rerender();

    // Now transition should animate
    act(() => { store.set(true); });
    expect(result.current.pillVisible).toBe(false);
    expect(animateInputFlight).toHaveBeenCalledWith("to-sidebar");
  });

  // --- pillTransition reflects sidebarPrefClosed ---

  test("pillTransition is true when sidebar pref is closed", () => {
    localStorage.setItem("chat-sidebar-pref", "closed");
    const store = createStore(false);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );
    expect(result.current.pillTransition).toBe(true);
  });

  test("pillTransition updates on pref change event", () => {
    const store = createStore(true);
    const sidebarRef = { current: null };
    const { result } = renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );
    expect(result.current.pillTransition).toBe(false);

    act(() => {
      localStorage.setItem("chat-sidebar-pref", "closed");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    });
    expect(result.current.pillTransition).toBe(true);
  });

  // --- Sidebar sync ---

  test("sidebar setAllowed called on scroll change", () => {
    const store = createStore(false);
    const mockSetAllowed = vi.fn();
    const sidebarRef = { current: { setAllowed: mockSetAllowed } as unknown as ChatSidebarHandle };
    renderHook(() =>
      usePillVisibility({
        sidebarAllowedRef: store.ref,
        sidebarAllowedListeners: store.listeners,
        sidebarRef,
        isActive: true,
      }),
    );

    expect(mockSetAllowed).toHaveBeenCalledWith(false);

    act(() => { store.set(true); });
    expect(mockSetAllowed).toHaveBeenCalledWith(true);
  });
});
