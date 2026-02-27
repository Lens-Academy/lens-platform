// web_frontend/src/components/module/ArticleSectionWrapper.tsx

import { useEffect, useCallback, useMemo, useRef } from "react";
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
  const headingElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  // ToC items for direct DOM manipulation (bypasses React re-renders)
  const tocItemsRef = useRef<
    Map<string, { index: number; element: HTMLElement }>
  >(new Map());
  const currentHeadingIdRef = useRef<string | null>(null);

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
      const id =
        registeredIds[count] || registeredIds[registeredIds.length - 1];
      renderCountsRef.current.set(text, count + 1);
      return id;
    }
    // Fallback for when rendered outside ArticleExcerptGroup
    return generateHeadingId(text);
  }, []);

  // Track heading elements as they render
  const handleHeadingRender = useCallback(
    (id: string, element: HTMLElement) => {
      const existing = headingElementsRef.current.get(id);
      if (existing !== element) {
        headingElementsRef.current.set(id, element);
      }
    },
    [],
  );

  // Register a ToC item for direct DOM updates
  const registerTocItem = useCallback(
    (id: string, index: number, element: HTMLElement) => {
      tocItemsRef.current.set(id, { index, element });
    },
    [],
  );

  // Update ToC item styles directly in the DOM (no React re-render)
  const updateTocStyles = useCallback((currentIndex: number) => {
    tocItemsRef.current.forEach(({ index, element }) => {
      const isCurrent = index === currentIndex;
      const isPassed = index < currentIndex;

      element.classList.toggle("toc-current", isCurrent);
      element.classList.toggle("toc-passed", isPassed && !isCurrent);
      element.classList.toggle("toc-future", !isPassed && !isCurrent);

      // Toggle left border accent on parent <li>
      const li = element.parentElement;
      if (li) {
        li.classList.toggle("border-transparent", !isCurrent);
        li.classList.toggle("border-gray-900", isCurrent);
      }
    });
  }, []);

  // Find the current heading (last one above the threshold)
  const recalculateCurrentHeading = useCallback(() => {
    const threshold = window.innerHeight * 0.35;
    let currentId: string | null = null;
    let currentTop = -Infinity;

    // Find the heading closest to (but above) the threshold
    headingElementsRef.current.forEach((element, id) => {
      const top = element.getBoundingClientRect().top;
      if (top < threshold && top > currentTop) {
        currentTop = top;
        currentId = id;
      }
    });

    // Only update if changed
    if (currentId !== currentHeadingIdRef.current) {
      currentHeadingIdRef.current = currentId;

      // Find index of current heading and update DOM directly
      const currentItem = currentId ? tocItemsRef.current.get(currentId) : null;
      const currentIndex = currentItem ? currentItem.index : -1;
      updateTocStyles(currentIndex);
    }
  }, [updateTocStyles]);

  // Scroll listener — recalculate on every scroll event.
  // Scanning ~10-20 heading positions via getBoundingClientRect is trivially fast.
  useEffect(() => {
    const onScroll = () => recalculateCurrentHeading();

    window.addEventListener("scroll", onScroll, { passive: true });

    // Initial calculation
    recalculateCurrentHeading();

    return () => window.removeEventListener("scroll", onScroll);
  }, [recalculateCurrentHeading]);

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
      registerTocItem,
      onHeadingClick: handleHeadingClick,
    }),
    [
      getHeadingId,
      registerHeadingIds,
      handleHeadingRender,
      registerTocItem,
      handleHeadingClick,
    ],
  );

  return (
    <ArticleSectionProvider value={contextValue}>
      {children}
    </ArticleSectionProvider>
  );
}
