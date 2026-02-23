// web_frontend/src/components/module/ArticleEmbed.tsx

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ArticleData } from "@/types/module";
import { generateHeadingId } from "@/utils/extractHeadings";
import { useArticleSectionContext } from "./ArticleSectionContext";

type ArticleEmbedProps = {
  article: ArticleData;
  /** Whether this is the first excerpt in the section (shows full attribution) */
  isFirstExcerpt?: boolean;
  /** @deprecated Use isFirstExcerpt instead. Kept for backward compatibility. */
  showHeader?: boolean;
};

/**
 * Renders article content with warm background.
 * First excerpt shows full attribution; subsequent show muted marker.
 */
export default function ArticleEmbed({
  article,
  isFirstExcerpt,
  showHeader,
}: ArticleEmbedProps) {
  // Support both isFirstExcerpt and deprecated showHeader prop
  const isFirst = isFirstExcerpt ?? showHeader ?? true;
  const {
    content,
    title,
    author,
    sourceUrl,
    collapsed_before,
    collapsed_after,
  } = article;
  const sectionContext = useArticleSectionContext();

  // Get heading ID - uses shared counter from context if available,
  // falls back to local generation for standalone use
  const getHeadingId = (text: string): string => {
    if (sectionContext?.getHeadingId) {
      return sectionContext.getHeadingId(text);
    }
    // Fallback for when rendered outside ArticleSectionWrapper
    return generateHeadingId(text);
  };

  // Shared markdown components for both main content and collapsed sections
  const markdownComponents = {
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
      >
        {children}
      </a>
    ),
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-2xl font-bold mt-8 mb-4">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => {
      const text = String(children);
      const id = getHeadingId(text);
      return (
        <h2
          id={id}
          ref={(el) => {
            if (el) sectionContext?.onHeadingRender(id, el);
          }}
          className="text-xl font-bold mt-6 mb-3 scroll-mt-24"
        >
          {children}
        </h2>
      );
    },
    h3: ({ children }: { children?: React.ReactNode }) => {
      const text = String(children);
      const id = getHeadingId(text);
      return (
        <h3
          id={id}
          ref={(el) => {
            if (el) sectionContext?.onHeadingRender(id, el);
          }}
          className="text-lg font-bold mt-5 mb-2 scroll-mt-24"
        >
          {children}
        </h3>
      );
    },
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="text-base font-bold mt-4 mb-2">{children}</h4>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-4 leading-relaxed">{children}</p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic">{children}</em>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="not-prose border-l-3 border-gray-300 pl-4 my-4 text-gray-800 [&>p]:mb-0">
        {children}
      </blockquote>
    ),
    code: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">
            {children}
          </code>
        );
      }
      return <code className="text-sm font-mono">{children}</code>;
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto my-4">
        {children}
      </pre>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <img
        src={src}
        alt={alt || ""}
        className="w-full max-w-full my-4 rounded-lg"
      />
    ),
    hr: () => <hr className="my-8 border-gray-300" />,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-gray-300">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-gray-200">{children}</thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <tbody>{children}</tbody>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <tr className="border-b border-gray-300">{children}</tr>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-4 py-2 text-left font-semibold border border-gray-300">
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-4 py-2 border border-gray-300">{children}</td>
    ),
  };

  // Collapsed section component with animation
  const CollapsedSection = ({
    content,
    position: _position,
  }: {
    content: string;
    position: "before" | "after";
  }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <div className="max-w-content mx-auto mb-4">
        <div className="flex items-center gap-1 py-1">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="cursor-pointer text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1"
          >
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span>[...]</span>
          </button>
          {isOpen && (
            <span className="text-sm text-gray-400 ml-1">
              This part of the article was omitted for brevity
            </span>
          )}
        </div>
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <article className="prose prose-gray max-w-content mx-auto text-gray-600 pt-1 pl-5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            </article>
            <div className="text-sm text-gray-400 mt-2 pl-5">
              — End of omitted text —
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-content-padded mx-auto bg-amber-50/50 px-4 py-4 sm:py-6 rounded-lg">
      {/* Excerpt marker inside yellow background */}
      {isFirst ? (
        // First excerpt: full attribution with divider
        <div className="mb-3 max-w-content mx-auto">
          {title && (
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          )}
          <div className="flex items-center gap-3 mt-1">
            {author && <p className="text-sm text-gray-500">by {author}</p>}
            {author && sourceUrl && <span className="text-gray-400">|</span>}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
              >
                Read original
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            )}
          </div>
          <hr className="mt-3 border-gray-300" />
        </div>
      ) : (
        // Subsequent excerpt: muted right-aligned marker with divider
        <div className="mb-3 max-w-content mx-auto">
          <div className="flex justify-end">
            <span className="text-sm text-gray-400 flex items-center gap-1.5">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              from &ldquo;{title}&rdquo;
            </span>
          </div>
          <hr className="mt-2 border-gray-300" />
        </div>
      )}

      {/* Collapsed content before this excerpt (after header) */}
      {collapsed_before && (
        <CollapsedSection content={collapsed_before} position="before" />
      )}

      <article className="prose prose-gray max-w-content mx-auto overflow-x-hidden">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </article>

      {/* Collapsed content after this excerpt */}
      {collapsed_after && (
        <CollapsedSection content={collapsed_after} position="after" />
      )}
    </div>
  );
}
