// web_frontend_next/src/components/module/ArticleTOC.tsx

import type { HeadingItem } from "@/utils/extractHeadings";

type ArticleTOCProps = {
  title: string;
  author: string | null;
  headings: HeadingItem[];
  /** IDs of headings that have been scrolled past or are current */
  passedHeadingIds: Set<string>;
  onHeadingClick: (id: string) => void;
};

/**
 * Table of contents sidebar for article sections.
 * Shows title, author, and nested headings with scroll progress.
 */
export default function ArticleTOC({
  title,
  author,
  headings,
  passedHeadingIds,
  onHeadingClick,
}: ArticleTOCProps) {
  return (
    <nav aria-label="Article table of contents">
      {/* Article title */}
      <h2 className="text-base font-semibold text-gray-900 leading-snug">
        {title}
      </h2>

      {/* Author */}
      {author && (
        <p className="text-sm text-gray-500 mt-1">by {author}</p>
      )}

      {/* Divider */}
      <hr className="my-4 border-gray-200" />

      {/* Headings list */}
      <ul className="space-y-2" role="list">
        {headings.map((heading) => {
          const isPassed = passedHeadingIds.has(heading.id);
          return (
            <li
              key={heading.id}
              className={heading.level === 3 ? "pl-4" : ""}
            >
              <button
                onClick={() => onHeadingClick(heading.id)}
                className={`text-left text-sm leading-snug transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 rounded ${
                  isPassed ? "text-gray-700" : "text-gray-400"
                }`}
              >
                {heading.text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
