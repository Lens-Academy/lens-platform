// web_frontend/src/components/module/ArticleTOC.tsx

import { useEffect, useRef } from "react";
import type { HeadingItem } from "@/utils/extractHeadings";

type ArticleTOCProps = {
  title: string;
  author: string | null;
  headings: HeadingItem[];
  /** Register ToC item for direct DOM updates */
  registerTocItem: (id: string, index: number, element: HTMLElement) => void;
  onHeadingClick: (id: string) => void;
};

/**
 * Table of contents sidebar for article sections.
 * Shows title, author, and nested headings with scroll progress.
 * Uses direct DOM manipulation for highlighting (bypasses React re-renders).
 */
export default function ArticleTOC({
  title,
  author,
  headings,
  registerTocItem,
  onHeadingClick,
}: ArticleTOCProps) {
  // Store refs to all button elements
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Register all items after render
  useEffect(() => {
    buttonRefs.current.forEach((element, id) => {
      const index = headings.findIndex((h) => h.id === id);
      if (index !== -1) {
        registerTocItem(id, index, element);
      }
    });
  }, [headings, registerTocItem]);

  return (
    <nav aria-label="Article table of contents">
      {/* Article title */}
      <h2 className="text-base font-semibold text-gray-900 leading-snug">
        {title}
      </h2>

      {/* Author */}
      {author && <p className="text-sm text-gray-500 mt-1">by {author}</p>}

      {/* Divider */}
      <hr className="my-4 border-gray-200" />

      {/* Headings list */}
      <ul className="space-y-2" role="list">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.level === 3 ? "pl-4" : ""}>
            <button
              ref={(el) => {
                if (el) {
                  buttonRefs.current.set(heading.id, el);
                } else {
                  buttonRefs.current.delete(heading.id);
                }
              }}
              onClick={() => onHeadingClick(heading.id)}
              className="toc-future text-left text-sm leading-snug transition-colors hover:text-gray-900 focus:outline-none"
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
