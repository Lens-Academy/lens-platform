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

  // Update ToC item highlight styles directly in the DOM (no React re-render)
  const updateTocHighlight = useCallback((currentIndex: number) => {
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

  // Cached heading positions — stable across scroll events, invalidated on resize
  const cachedPositionsRef = useRef<Array<{
    id: string;
    index: number;
    articleTop: number;
    tocOffset: number;
  }> | null>(null);
  const tocScrollContainerRef = useRef<Element | null>(null);

  // Find the ToC scroll container (cached)
  const getTocScrollContainer = useCallback((): Element | null => {
    if (tocScrollContainerRef.current) return tocScrollContainerRef.current;
    const firstItem = tocItemsRef.current.values().next();
    if (firstItem.done) return null;
    const container = firstItem.value.element.closest("[data-toc-scroll]");
    tocScrollContainerRef.current = container;
    return container;
  }, []);

  // Build sorted heading positions using offsetTop (layout-stable, no getBoundingClientRect on ToC)
  const computePositions = useCallback(() => {
    const entries: Array<{
      id: string;
      index: number;
      articleTop: number;
      tocOffset: number;
    }> = [];

    const scrollContainer = getTocScrollContainer();
    if (!scrollContainer) return entries;

    headingElementsRef.current.forEach((articleEl, id) => {
      const tocItem = tocItemsRef.current.get(id);
      if (!tocItem) return;

      // Article position: stable document-relative offset
      const articleTop = articleEl.getBoundingClientRect().top + window.scrollY;
      // ToC position: use offsetTop for stability (not affected by scrollTop changes)
      const tocOffset = tocItem.element.offsetTop;

      entries.push({ id, index: tocItem.index, articleTop, tocOffset });
    });

    entries.sort((a, b) => a.articleTop - b.articleTop);
    return entries;
  }, [getTocScrollContainer]);

  // Invalidate cached positions on resize or content changes
  const invalidatePositions = useCallback(() => {
    cachedPositionsRef.current = null;
    tocScrollContainerRef.current = null;
  }, []);

  // Scroll the ToC container so a target offset is centered
  const scrollTocToOffset = useCallback(
    (targetOffsetInToc: number) => {
      const scrollContainer = getTocScrollContainer();
      if (!scrollContainer) return;

      const containerHeight = scrollContainer.clientHeight;
      const targetScroll = targetOffsetInToc - containerHeight * 0.5;
      const maxScroll = scrollContainer.scrollHeight - containerHeight;
      scrollContainer.scrollTop = Math.max(
        0,
        Math.min(targetScroll, maxScroll),
      );
    },
    [getTocScrollContainer],
  );

  // Main scroll handler: highlight active heading + interpolate ToC scroll position
  const recalculateCurrentHeading = useCallback(() => {
    const threshold = window.innerHeight * 0.35;
    const scrollY = window.scrollY + threshold;

    // Use cached positions (only recompute on invalidation)
    if (!cachedPositionsRef.current) {
      cachedPositionsRef.current = computePositions();
    }
    const positions = cachedPositionsRef.current;
    if (positions.length === 0) return;

    // Find which segment we're in
    let currentIdx = -1;
    for (let i = positions.length - 1; i >= 0; i--) {
      if (scrollY >= positions[i].articleTop) {
        currentIdx = i;
        break;
      }
    }

    // Update heading highlight (only when changed)
    const currentId = currentIdx >= 0 ? positions[currentIdx].id : null;
    if (currentId !== currentHeadingIdRef.current) {
      currentHeadingIdRef.current = currentId;
      const highlightIndex = currentIdx >= 0 ? positions[currentIdx].index : -1;
      updateTocHighlight(highlightIndex);
    }

    // Interpolate ToC scroll position
    if (currentIdx < 0) {
      scrollTocToOffset(0);
    } else if (currentIdx >= positions.length - 1) {
      scrollTocToOffset(positions[positions.length - 1].tocOffset);
    } else {
      const curr = positions[currentIdx];
      const next = positions[currentIdx + 1];
      const segmentLength = next.articleTop - curr.articleTop;
      const t =
        segmentLength > 0 ? (scrollY - curr.articleTop) / segmentLength : 0;
      const lerpedOffset =
        curr.tocOffset + (next.tocOffset - curr.tocOffset) * t;
      scrollTocToOffset(lerpedOffset);
    }
  }, [computePositions, updateTocHighlight, scrollTocToOffset]);

  // Scroll listener with rAF throttling to prevent layout thrashing
  useEffect(() => {
    let rafId: number | null = null;

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        recalculateCurrentHeading();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", invalidatePositions);

    // Initial calculation (delayed to ensure ToC items are registered)
    requestAnimationFrame(() => recalculateCurrentHeading());

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", invalidatePositions);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [recalculateCurrentHeading, invalidatePositions]);

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
