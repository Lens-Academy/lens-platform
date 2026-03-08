import { useReducer, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { animateInputFlight, cancelInputFlight } from "@/utils/animateInputFlight";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";

export type PillState =
  | "sidebar"
  | "to-inline"
  | "inline"
  | "to-sidebar";

export type PillEvent =
  | { type: "SIDEBAR_ALLOWED" }
  | { type: "SIDEBAR_DISALLOWED" }
  | { type: "ANIMATION_DONE" }
  | { type: "PREF_OPEN" }
  | { type: "PREF_CLOSED" };

export function pillReducer(state: PillState, event: PillEvent): PillState {
  switch (state) {
    case "sidebar":
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";
      if (event.type === "PREF_CLOSED") return "inline";
      return state;

    case "to-inline":
      if (event.type === "ANIMATION_DONE") return "inline";
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";
      if (event.type === "PREF_OPEN") return "sidebar";
      if (event.type === "PREF_CLOSED") return "inline";
      return state;

    case "inline":
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";
      if (event.type === "PREF_OPEN") return "sidebar";
      return state;

    case "to-sidebar":
      if (event.type === "ANIMATION_DONE") return "sidebar";
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";
      if (event.type === "PREF_OPEN") return "sidebar";
      if (event.type === "PREF_CLOSED") return "inline";
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
  // When user prefers sidebar closed, always start inline.
  const [state, dispatch] = useReducer(
    pillReducer,
    scrollSidebarAllowed && localStorage.getItem("chat-sidebar-pref") !== "closed"
      ? "sidebar"
      : "inline",
  );

  // Detect transitions in scrollSidebarAllowed
  const prevAllowedRef = useRef(scrollSidebarAllowed);
  useEffect(() => {
    if (scrollSidebarAllowed !== prevAllowedRef.current) {
      prevAllowedRef.current = scrollSidebarAllowed;

      // When the user prefers the sidebar closed, skip animation —
      // the inline pill stays visible and the sidebar won't open anyway.
      if (scrollSidebarAllowed && localStorage.getItem("chat-sidebar-pref") === "closed") {
        return;
      }

      dispatch({
        type: scrollSidebarAllowed ? "SIDEBAR_ALLOWED" : "SIDEBAR_DISALLOWED",
      });
    }
  }, [scrollSidebarAllowed]);

  // Listen for user manually opening/closing the sidebar (toggle button).
  // Reads scrollSidebarAllowed via ref to avoid re-subscribing on every change.
  const scrollAllowedRef = useRef(scrollSidebarAllowed);
  scrollAllowedRef.current = scrollSidebarAllowed;
  useEffect(() => {
    const onPrefChange = () => {
      const pref = localStorage.getItem("chat-sidebar-pref");
      if (pref === "open" && scrollAllowedRef.current) {
        cancelInputFlight();
        dispatch({ type: "PREF_OPEN" });
      } else if (pref === "closed") {
        cancelInputFlight();
        dispatch({ type: "PREF_CLOSED" });
      }
    };
    window.addEventListener("chat-sidebar-pref-change", onPrefChange);
    return () => window.removeEventListener("chat-sidebar-pref-change", onPrefChange);
  }, []);

  // Animation trigger + generation counter.
  // useLayoutEffect so the first frame already has the transform applied —
  // prevents a flash of the pill at its final position before the animation.
  const prevStateRef = useRef(state);
  const generationRef = useRef(0);
  useLayoutEffect(() => {
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

  // Sync sidebar imperatively — drive from scroll state directly rather than
  // the pill state machine, so the toggle button shows even when animation
  // is skipped (e.g. user prefers sidebar closed).
  useEffect(() => {
    sidebarRef.current?.setAllowed(scrollSidebarAllowed);
  }, [scrollSidebarAllowed, sidebarRef]);

  return {
    pillVisible: inlinePillVisible(state),
    pillState: state,
  };
}
