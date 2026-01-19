// web_frontend_next/src/components/module/ArticleSectionWrapper.tsx
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ArticleSection, ArticleExcerptSegment } from "@/types/module";
import { extractHeadings } from "@/utils/extractHeadings";
import ArticleTOC from "./ArticleTOC";
import { ArticleSectionProvider } from "./ArticleSectionContext";

type ArticleSectionWrapperProps = {
  section: ArticleSection;
  children: React.ReactNode;
};

/**
 * Wrapper for article sections that adds the TOC sidebar.
 * Tracks scroll position to highlight current heading in TOC.
 */
export default function ArticleSectionWrapper({
  section,
  children,
}: ArticleSectionWrapperProps) {
  const [passedHeadingIds, setPassedHeadingIds] = useState<Set<string>>(
    new Set(),
  );
  const headingElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);

  // Extract all headings from all article-excerpt segments
  const allHeadings = useMemo(() => {
    const excerpts = section.segments.filter(
      (s): s is ArticleExcerptSegment => s.type === "article-excerpt",
    );
    return excerpts.flatMap((excerpt) => extractHeadings(excerpt.content));
  }, [section.segments]);

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
      const scrollY = window.scrollY;
      const offset = 100; // Account for sticky header

      headingElementsRef.current.forEach((element, id) => {
        const rect = element.getBoundingClientRect();
        const elementTop = rect.top + scrollY;
        if (scrollY + offset >= elementTop) {
          passed.add(id);
        }
      });

      setPassedHeadingIds(passed);
    };

    // Throttle scroll handler
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
    const timeout = setTimeout(calculatePassedHeadings, 200);

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [allHeadings]);

  const handleHeadingClick = useCallback((id: string) => {
    const element = headingElementsRef.current.get(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const contextValue = useMemo(
    () => ({ onHeadingRender: handleHeadingRender }),
    [handleHeadingRender],
  );

  return (
    <ArticleSectionProvider value={contextValue}>
      <div className="relative">
        {/* Content area - full width, TOC overlaid */}
        <div ref={contentRef} className="w-full">
          {children}
        </div>

        {/* TOC Sidebar - sticky, positioned to left of content */}
        <div className="hidden lg:block absolute left-0 top-0 w-[280px] -translate-x-full pr-8">
          <div className="sticky top-20">
            <ArticleTOC
              title={section.meta.title}
              author={section.meta.author}
              headings={allHeadings}
              passedHeadingIds={passedHeadingIds}
              onHeadingClick={handleHeadingClick}
            />
          </div>
        </div>
      </div>
    </ArticleSectionProvider>
  );
}
