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

  // Track heading elements as they render
  const handleHeadingRender = useCallback(
    (id: string, element: HTMLElement) => {
      headingElementsRef.current.set(id, element);
    },
    [],
  );

  // Scroll tracking for headings
  useEffect(() => {
    const calculatePassedHeadings = () => {
      const passed = new Set<string>();
      // Trigger when heading reaches upper-third of viewport
      // This better reflects where people are actually reading
      const offset = window.innerHeight * 0.35;

      headingElementsRef.current.forEach((element, id) => {
        const top = element.getBoundingClientRect().top;
        if (top < offset) {
          passed.add(id);
        }
      });

      setPassedHeadingIds(passed);
    };

    // Throttle scroll handler with requestAnimationFrame
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          calculatePassedHeadings();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Initial calculation after a delay to let headings register
    const timeout = setTimeout(calculatePassedHeadings, 100);

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", handleScroll);
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
