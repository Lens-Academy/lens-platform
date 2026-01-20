// web_frontend/src/components/module/ArticleExcerptGroup.tsx

import { useMemo, useRef } from "react";
import type { ArticleSection, ArticleExcerptSegment } from "@/types/module";
import { extractAllHeadings } from "@/utils/extractHeadings";
import ArticleTOC from "./ArticleTOC";
import { useArticleSectionContext } from "./ArticleSectionContext";

type ArticleExcerptGroupProps = {
  section: ArticleSection;
  children: React.ReactNode;
};

/**
 * Wrapper for article excerpt segments that renders the TOC sidebar.
 * The TOC is sticky within this container, so it:
 * - Starts aligned with the first excerpt
 * - Sticks when reaching the header
 * - Scrolls away when the last excerpt ends
 */
export default function ArticleExcerptGroup({
  section,
  children,
}: ArticleExcerptGroupProps) {
  const context = useArticleSectionContext();
  const lastRegisteredRef = useRef<string | null>(null);

  // Extract headings from all article-excerpt segments with shared counter
  const allHeadings = useMemo(() => {
    const excerptContents = section.segments
      .filter((s): s is ArticleExcerptSegment => s.type === "article-excerpt")
      .map((s) => s.content);
    return extractAllHeadings(excerptContents);
  }, [section.segments]);

  // Register heading IDs with context before children render
  // Uses a ref to avoid duplicate registrations for same headings
  const headingsKey = allHeadings.map((h) => h.id).join(",");
  if (context?.registerHeadingIds && lastRegisteredRef.current !== headingsKey) {
    context.registerHeadingIds(allHeadings);
    lastRegisteredRef.current = headingsKey;
  }

  return (
    <div>
      {/* Centered content with relative positioning for TOC */}
      <div className="max-w-[750px] mx-auto relative">
        {/* Content */}
        <div className="w-full">{children}</div>

        {/* TOC Sidebar - positioned to the left of centered content */}
        <div className="hidden xl:block absolute top-0 bottom-0 right-full w-[250px] mr-6">
          <div className="sticky top-20 will-change-transform">
            <ArticleTOC
              title={section.meta.title}
              author={section.meta.author}
              headings={allHeadings}
              passedHeadingIds={context?.passedHeadingIds ?? new Set()}
              onHeadingClick={context?.onHeadingClick ?? (() => {})}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
