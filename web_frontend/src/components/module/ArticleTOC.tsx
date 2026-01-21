// web_frontend_next/src/components/module/ArticleTOC.tsx

import type { HeadingItem } from "@/utils/extractHeadings";

type ArticleTOCProps = {
  title: string;
  author: string | null;
  headings: HeadingItem[];
  /** ID of the current heading (last one scrolled past threshold), or null */
  currentHeadingId: string | null;
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
  currentHeadingId,
  onHeadingClick,
}: ArticleTOCProps) {
  // Find the index of the current heading to derive passed/current status
  const currentIndex = currentHeadingId
    ? headings.findIndex((h) => h.id === currentHeadingId)
    : -1;

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
        {headings.map((heading, index) => {
          const isCurrent = index === currentIndex;
          const isPassed = index < currentIndex;

          return (
            <li
              key={heading.id}
              className={heading.level === 3 ? "pl-4" : ""}
            >
              <button
                onClick={() => onHeadingClick(heading.id)}
                className={`text-left text-sm leading-snug transition-colors hover:text-gray-900 focus:outline-none ${
                  isCurrent
                    ? "text-gray-900 font-semibold"
                    : isPassed
                      ? "text-gray-700"
                      : "text-gray-400"
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
