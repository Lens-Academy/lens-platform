import { useReducer, useEffect, useRef, useSyncExternalStore } from "react";
import { animateInputFlight } from "@/utils/animateInputFlight";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";

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

export function inlinePillVisible(state: PillState): boolean {
  return state !== "sidebar";
}

export function sidebarOpen(state: PillState): boolean {
  return state === "sidebar" || state === "to-sidebar";
}

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
