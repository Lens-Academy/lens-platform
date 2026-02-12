// web_frontend/src/components/module/ArticleExcerptGroup.tsx

import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  ArticleSection,
  LensArticleSection,
  ArticleExcerptSegment,
} from "@/types/module";
import { extractAllHeadings } from "@/utils/extractHeadings";
import ArticleTOC from "./ArticleTOC";
import { useArticleSectionContext } from "./ArticleSectionContext";

type ArticleExcerptGroupProps = {
  section: ArticleSection | LensArticleSection;
  children: React.ReactNode;
};

/**
 * Wrapper for article excerpt segments that renders the TOC sidebar.
 *
 * When a portal container is provided via context (from the Module-level grid
 * layout), the TOC is portaled into that container. Otherwise, it falls back
 * to absolute positioning to the left of the content.
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
  if (
    context?.registerHeadingIds &&
    lastRegisteredRef.current !== headingsKey
  ) {
    context.registerHeadingIds(allHeadings);
    lastRegisteredRef.current = headingsKey;
  }

  const tocElement = (
    <ArticleTOC
      title={section.meta.title}
      author={section.meta.author}
      headings={allHeadings}
      registerTocItem={context?.registerTocItem ?? (() => {})}
      onHeadingClick={context?.onHeadingClick ?? (() => {})}
    />
  );

  const tocPortalContainer = context?.tocPortalContainer;

  return (
    <div className="relative">
      <div className="w-full">{children}</div>

      {/* TOC: portal to grid column if available, else absolute-position fallback */}
      {tocPortalContainer
        ? createPortal(tocElement, tocPortalContainer)
        : (
          <div className="absolute top-30 bottom-0 right-full w-[250px] mr-6 pl-4 opacity-0 invisible -translate-x-2 min-[1100px]:opacity-100 min-[1100px]:visible min-[1100px]:translate-x-0 transition-[opacity,visibility,transform] duration-300 ease-out">
            <div
              data-toc-scroll
              className="sticky top-[calc(var(--header-offset)+12px)] max-h-[calc(100vh-var(--header-offset)-24px)] overflow-y-auto scrollbar-hide transition-[top,max-height] duration-300"
            >
              {tocElement}
            </div>
          </div>
        )}
    </div>
  );
}
