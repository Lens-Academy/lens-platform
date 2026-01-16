// web_frontend_next/src/components/narrative-lesson/ArticleEmbed.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ArticleData } from "@/types/unified-lesson";

type ArticleEmbedProps = {
  article: ArticleData;
  /** Show article header (title, author, source link) */
  showHeader?: boolean;
};

/**
 * Renders article content in an embedded card with gray background.
 * This gives external content a "quoted/embedded" feel.
 *
 * Reuses ReactMarkdown setup from ArticlePanel with card styling added.
 */
export default function ArticleEmbed({
  article,
  showHeader = true,
}: ArticleEmbedProps) {
  const { content, title, author, sourceUrl, isExcerpt } = article;

  return (
    <div className="max-w-[700px] mx-auto py-4 px-4">
      <div className="bg-stone-100 rounded-lg p-6 shadow-sm">
        <article className="prose prose-gray max-w-none">
          {showHeader && (
            <>
              {title && <h1 className="text-2xl font-bold mb-2">{title}</h1>}
              {isExcerpt && (
                <div className="text-sm text-gray-500 mb-1">
                  You&apos;re reading an excerpt from this article
                </div>
              )}
              {(author || sourceUrl) && (
                <div className="text-sm text-gray-500 mb-6">
                  {author && <span>By {author}</span>}
                  {author && sourceUrl && <span> · </span>}
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600 inline-flex items-center gap-1"
                    >
                      Read original
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
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
              )}
            </>
          )}
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
              h2: ({ children }) => (
                <h2 className="text-xl font-bold mt-6 mb-3">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-lg font-bold mt-5 mb-2">{children}</h3>
              ),
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
                <td className="px-4 py-2 border border-gray-300">{children}</td>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
