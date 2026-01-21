// web_frontend/src/components/module/ArticleEmbed.tsx

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
  const { content, title, author, sourceUrl } = article;
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

  return (
    <div>
      {/* Article content with warm background - header inside */}
      <div className="max-w-content-padded mx-auto">
        <div className="bg-amber-50/50 px-10 py-6 rounded-lg">
          {/* Excerpt marker inside yellow background */}
          {isFirst ? (
            // First excerpt: full attribution with divider
            <div className="mb-6 max-w-content mx-auto">
              {title && (
                <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
              )}
              <div className="flex items-center gap-3 mt-1">
                {author && <p className="text-sm text-gray-500">by {author}</p>}
                {author && sourceUrl && (
                  <span className="text-gray-400">|</span>
                )}
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
              <hr className="mt-4 border-gray-300" />
            </div>
          ) : (
            // Subsequent excerpt: muted right-aligned marker with divider
            <div className="mb-6 max-w-content mx-auto">
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
          <article className="prose prose-gray max-w-content mx-auto">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ children, href }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
                  >
                    {children}
                  </a>
                ),
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold mt-8 mb-4">{children}</h1>
                ),
                h2: ({ children }) => {
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
                h3: ({ children }) => {
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
                h4: ({ children }) => (
                  <h4 className="text-base font-bold mt-4 mb-2">{children}</h4>
                ),
                p: ({ children }) => (
                  <p className="mb-4 leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-4 space-y-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-4 space-y-1">
                    {children}
                  </ol>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold">{children}</strong>
                ),
                em: ({ children }) => <em className="italic">{children}</em>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-8 border-gray-300" />,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-gray-300">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-gray-200">{children}</thead>
                ),
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => (
                  <tr className="border-b border-gray-300">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-2 text-left font-semibold border border-gray-300">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-2 border border-gray-300">
                    {children}
                  </td>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        </div>
      </div>
    </div>
  );
}
