// web_frontend/src/components/module/ArticleSectionWrapper.tsx

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArticleSectionProvider } from "./ArticleSectionContext";
import { generateHeadingId } from "@/utils/extractHeadings";

type ArticleSectionWrapperProps = {
  children: React.ReactNode;
};

/**
 * Context provider for article sections.
 * Tracks scroll position to highlight headings in TOC.
 * The actual TOC is rendered by ArticleExcerptGroup.
 */
export default function ArticleSectionWrapper({
  children,
}: ArticleSectionWrapperProps) {
  const [passedHeadingIds, setPassedHeadingIds] = useState<Set<string>>(
    new Set(),
  );
  const headingElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  // Track passed headings in a ref to avoid stale closure issues in observer callback
  const passedHeadingIdsRef = useRef<Set<string>>(new Set());

  // Pre-computed heading IDs from extractAllHeadings, keyed by text
  // Maps text → array of IDs (for duplicate headings)
  const registeredIdsRef = useRef<Map<string, string[]>>(new Map());
  // Tracks which occurrence we're on for each heading text during render
  const renderCountsRef = useRef<Map<string, number>>(new Map());

  // Register pre-computed heading IDs from extractAllHeadings
  // Called by ArticleExcerptGroup before children render
  const registerHeadingIds = useCallback(
    (headings: Array<{ id: string; text: string }>) => {
      const newMap = new Map<string, string[]>();
      for (const { id, text } of headings) {
        const existing = newMap.get(text) || [];
        existing.push(id);
        newMap.set(text, existing);
      }
      registeredIdsRef.current = newMap;
      // Reset render counts for new render cycle
      renderCountsRef.current.clear();
    },
    [],
  );

  // Get unique heading ID - looks up from registered IDs
  // Falls back to generating if not registered (for standalone use)
  const getHeadingId = useCallback((text: string): string => {
    const registeredIds = registeredIdsRef.current.get(text);
    if (registeredIds && registeredIds.length > 0) {
      const count = renderCountsRef.current.get(text) || 0;
      const id = registeredIds[count] || registeredIds[registeredIds.length - 1];
      renderCountsRef.current.set(text, count + 1);
      return id;
    }
    // Fallback for when rendered outside ArticleExcerptGroup
    return generateHeadingId(text);
  }, []);

  // Track heading elements as they render and observe them
  const handleHeadingRender = useCallback(
    (id: string, element: HTMLElement) => {
      const existing = headingElementsRef.current.get(id);
      if (existing !== element) {
        headingElementsRef.current.set(id, element);
        // Observe with IntersectionObserver if available
        if (observerRef.current) {
          observerRef.current.observe(element);
        }
      }
    },
    [],
  );

  // IntersectionObserver for tracking which headings have been scrolled past
  // rootMargin "-35% 0px -65% 0px" creates an observation zone in top 35% of viewport
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        const currentPassed = passedHeadingIdsRef.current;

        for (const entry of entries) {
          const id = entry.target.id;
          if (!id) continue;

          // isIntersecting means the heading is in the top 35% zone
          // When scrolling down, headings enter this zone → they're "passed"
          // When scrolling up, headings leave this zone → they're no longer "passed"
          if (entry.isIntersecting) {
            if (!currentPassed.has(id)) {
              currentPassed.add(id);
              changed = true;
            }
          } else {
            // Check if element is above or below the observation zone
            // If boundingClientRect.top > 0, element is below the zone (not passed yet)
            // If boundingClientRect.top < 0, element is above the zone (still passed)
            if (entry.boundingClientRect.top > 0 && currentPassed.has(id)) {
              currentPassed.delete(id);
              changed = true;
            }
          }
        }

        if (changed) {
          setPassedHeadingIds(new Set(currentPassed));
        }
      },
      {
        // Top 35% of viewport is the observation zone
        rootMargin: "0px 0px -65% 0px",
        threshold: 0,
      }
    );

    observerRef.current = observer;

    // Observe any elements already registered
    headingElementsRef.current.forEach((element) => {
      observer.observe(element);
    });

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const handleHeadingClick = useCallback((id: string) => {
    const element = headingElementsRef.current.get(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      getHeadingId,
      registerHeadingIds,
      onHeadingRender: handleHeadingRender,
      passedHeadingIds,
      onHeadingClick: handleHeadingClick,
    }),
    [getHeadingId, registerHeadingIds, handleHeadingRender, passedHeadingIds, handleHeadingClick],
  );

  return (
    <ArticleSectionProvider value={contextValue}>
      {children}
    </ArticleSectionProvider>
  );
}
