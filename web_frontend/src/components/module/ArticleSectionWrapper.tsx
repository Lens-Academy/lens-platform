// web_frontend/src/components/module/ArticleSectionWrapper.tsx

import { useEffect, useCallback, useMemo, useRef } from "react";
import { ArticleSectionProvider } from "./ArticleSectionContext";
import { generateHeadingId } from "@/utils/extractHeadings";

type ArticleSectionWrapperProps = {
  children: React.ReactNode;
  /** Portal container for rendering the TOC in a grid column at the Module level */
  tocPortalContainer?: HTMLElement | null;
};

/**
 * Context provider for article sections.
 * Tracks scroll position to highlight headings in TOC.
 * The actual TOC is rendered by ArticleExcerptGroup.
 */
export default function ArticleSectionWrapper({
  children,
  tocPortalContainer,
}: ArticleSectionWrapperProps) {
  const headingElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
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
    });
  }, []);

  // Find the current heading (last one above the threshold)
  // This is called when IntersectionObserver fires
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

  // IntersectionObserver triggers recalculation when any heading crosses the threshold
  // This is more efficient than scroll events while being more reliable than
  // tracking individual intersection events (which can miss fast scrolling)
  useEffect(() => {
    const observer = new IntersectionObserver(
      () => {
        // Any intersection change triggers a recalculation
        recalculateCurrentHeading();
      },
      {
        // Observation zone is top 35% of viewport
        rootMargin: "0px 0px -65% 0px",
        threshold: 0,
      },
    );

    observerRef.current = observer;

    // Observe any elements already registered
    headingElementsRef.current.forEach((element) => {
      observer.observe(element);
    });

    // Initial calculation
    recalculateCurrentHeading();

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
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
      tocPortalContainer: tocPortalContainer ?? null,
    }),
    [
      getHeadingId,
      registerHeadingIds,
      handleHeadingRender,
      registerTocItem,
      handleHeadingClick,
      tocPortalContainer,
    ],
  );

  return (
    <ArticleSectionProvider value={contextValue}>
      {children}
    </ArticleSectionProvider>
  );
}
