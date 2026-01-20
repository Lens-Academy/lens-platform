// web_frontend_next/src/components/module/ArticleExcerptGroup.tsx

import { useMemo } from "react";
import type { ArticleSection, ArticleExcerptSegment } from "@/types/module";
import { extractHeadings } from "@/utils/extractHeadings";
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

  // Extract headings from all article-excerpt segments
  const allHeadings = useMemo(() => {
    const excerpts = section.segments.filter(
      (s): s is ArticleExcerptSegment => s.type === "article-excerpt",
    );
    return excerpts.flatMap((excerpt) => extractHeadings(excerpt.content));
  }, [section.segments]);

  return (
    <div className="relative">
      {/* Content column - full width */}
      <div className="w-full">{children}</div>

      {/* TOC Sidebar - spans full height of this container */}
      <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-[280px] -translate-x-full pr-8">
        <div className="sticky top-20">
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
  );
}
