import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { animateInputFlight, cancelInputFlight } from "@/utils/animateInputFlight";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";

type PillVisibilityInput = {
  /** Ref written by Module.tsx scroll handler */
  sidebarAllowedRef: React.RefObject<boolean>;
  /** Listener set notified by Module.tsx scroll handler */
  sidebarAllowedListeners: React.RefObject<Set<() => void>>;
  /** Sidebar imperative handle — for calling setAllowed */
  sidebarRef: React.RefObject<ChatSidebarHandle | null>;
  /** Whether this shell currently owns the active input */
  isActive: boolean;
};

export function usePillVisibility({
  sidebarAllowedRef,
  sidebarAllowedListeners,
  sidebarRef,
  isActive,
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

  // Track sidebar preference reactively.
  const [sidebarPrefClosed, setSidebarPrefClosed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("chat-sidebar-pref") === "closed",
  );

  useEffect(() => {
    const onPrefChange = () => {
      const pref = localStorage.getItem("chat-sidebar-pref");
      setSidebarPrefClosed(pref === "closed");
      cancelInputFlight();
    };
    window.addEventListener("chat-sidebar-pref-change", onPrefChange);
    return () => window.removeEventListener("chat-sidebar-pref-change", onPrefChange);
  }, []);

  // Derived state — the whole point of this refactor.
  const showInSidebar = scrollSidebarAllowed && !sidebarPrefClosed;

  // Animate on scrollSidebarAllowed transitions (when pref is open and shell is active).
  // useLayoutEffect so the first frame already has the transform applied —
  // prevents a flash of the pill at its final position before the animation.
  const prevAllowedRef = useRef(scrollSidebarAllowed);
  useLayoutEffect(() => {
    if (scrollSidebarAllowed !== prevAllowedRef.current) {
      prevAllowedRef.current = scrollSidebarAllowed;

      // Only animate when pref is open and shell is active
      if (sidebarPrefClosed || !isActive) return;

      const direction = scrollSidebarAllowed ? "to-sidebar" : "to-inline";
      animateInputFlight(direction);
    }
  }, [scrollSidebarAllowed, sidebarPrefClosed, isActive]);

  // Sync sidebar imperatively — drive from scroll state directly.
  useEffect(() => {
    sidebarRef.current?.setAllowed(scrollSidebarAllowed);
  }, [scrollSidebarAllowed, sidebarRef]);

  return {
    pillVisible: !showInSidebar,
    pillTransition: sidebarPrefClosed,
  };
}
