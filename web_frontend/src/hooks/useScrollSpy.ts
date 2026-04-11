// web_frontend/src/hooks/useScrollSpy.ts

import { useState, useCallback, useRef, useMemo, useEffect } from "react";

export type HeadingData = {
  id: string;
  text: string;
  level: 2 | 3;
  element: HTMLElement;
};

export type ScrollSpyResult = {
  headings: HeadingData[];
  activeHeadingId: string | null;
  passedHeadingIds: Set<string>;
  registerHeading: (
    id: string,
    element: HTMLElement,
    text: string,
    level: 2 | 3,
  ) => void;
  unregisterHeading: (id: string) => void;
  scrollToHeading: (id: string) => void;
};

export function useScrollSpy(): ScrollSpyResult {
  // Store heading data in a Map for O(1) lookup
  const headingsMapRef = useRef<Map<string, HeadingData>>(new Map());
  // Track ALL currently visible headings (not just from last callback)
  const visibleIdsRef = useRef<Set<string>>(new Set());
  // Version counter to trigger re-renders when headings change
  const [headingsVersion, setHeadingsVersion] = useState(0);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  // Lazy observer initialization - avoids race condition where headings
  // register before useEffect runs
  const observerRef = useRef<IntersectionObserver | null>(null);

  const getObserver = useCallback(() => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          // Update the full set of visible headings
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              visibleIdsRef.current.add(entry.target.id);
            } else {
              visibleIdsRef.current.delete(entry.target.id);
            }
          });

          // Find topmost visible from ALL visible headings (not just this callback)
          const headingsArray = Array.from(headingsMapRef.current.values());
          const sortedVisible = headingsArray
            .filter((h) => visibleIdsRef.current.has(h.id))
            .sort((a, b) => {
              const position = a.element.compareDocumentPosition(b.element);
              if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
              if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
              return 0;
            });

          if (sortedVisible.length > 0) {
            setActiveHeadingId(sortedVisible[0].id);
          }
          // When nothing visible, keep current active (don't reset)
        },
        {
          // Trigger when heading enters top 30% of viewport
          // -80px accounts for sticky header
          rootMargin: "-80px 0px -70% 0px",
        },
      );
    }
    return observerRef.current;
  }, []);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // Derive headings array in document order
  const headings = useMemo(() => {
    // Force re-computation when version changes
    void headingsVersion;

    const entries = Array.from(headingsMapRef.current.values());
    // Sort by document position
    return entries.sort((a, b) => {
      const position = a.element.compareDocumentPosition(b.element);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }, [headingsVersion]);

  // Derive passed headings from active heading position in document order
  const passedHeadingIds = useMemo(() => {
    const passed = new Set<string>();
    for (const heading of headings) {
      passed.add(heading.id);
      if (heading.id === activeHeadingId) break;
    }
    return passed;
  }, [headings, activeHeadingId]);

  const registerHeading = useCallback(
    (id: string, element: HTMLElement, text: string, level: 2 | 3) => {
      // Idempotency check: skip if already registered with same element
      // This prevents unnecessary re-renders when ref callbacks fire on component re-render
      const existing = headingsMapRef.current.get(id);
      if (existing?.element === element) {
        return;
      }

      headingsMapRef.current.set(id, { id, element, text, level });
      getObserver().observe(element); // Lazy init - always works
      setHeadingsVersion((v) => v + 1);
    },
    [getObserver],
  );

  const unregisterHeading = useCallback((id: string) => {
    const heading = headingsMapRef.current.get(id);
    if (heading) {
      observerRef.current?.unobserve(heading.element);
      headingsMapRef.current.delete(id);
      visibleIdsRef.current.delete(id);
      setHeadingsVersion((v) => v + 1);
    }
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    const heading = headingsMapRef.current.get(id);
    if (heading) {
      heading.element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  return {
    headings,
    activeHeadingId,
    passedHeadingIds,
    registerHeading,
    unregisterHeading,
    scrollToHeading,
  };
}
