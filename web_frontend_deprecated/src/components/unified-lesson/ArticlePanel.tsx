import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ArticleData } from "../../types/unified-lesson";
import IntroductionBlock from "./IntroductionBlock";

type ArticlePanelProps = {
  article: ArticleData;
  blurred?: boolean; // For active recall - blur the content
  onScrolledToBottom?: () => void;
  afterContent?: React.ReactNode; // Content to render after article (e.g., button)
  onContentFitsChange?: (fits: boolean) => void; // Called when content fit status changes
  introduction?: string; // Lens Academy intro note
};

export default function ArticlePanel({
  article,
  blurred = false,
  onScrolledToBottom,
  afterContent,
  onContentFitsChange,
  introduction,
}: ArticlePanelProps) {
  const { content, title, author, sourceUrl, isExcerpt } = article;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onScrolledToBottom) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "bottom" when within 20px of the end
      if (scrollTop + clientHeight >= scrollHeight - 20) {
        onScrolledToBottom();
      }
    };

    // Check immediately in case content is shorter than container
    handleScroll();

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [onScrolledToBottom, content]);

  // Detect if content fits without scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onContentFitsChange) return;

    const checkFit = () => {
      const fits = container.scrollHeight <= container.clientHeight;
      onContentFitsChange(fits);
    };

    // Check after render
    checkFit();

    // Re-check on resize
    const resizeObserver = new ResizeObserver(checkFit);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [onContentFitsChange, content]);

  // Reset scroll position when content changes
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = 0;
    }
  }, [content]);

  return (
    <div className="h-full relative">
      <div ref={containerRef} className="h-full overflow-y-auto">
        <article
          className={`prose prose-gray max-w-[620px] mx-auto p-6 ${blurred ? "blur-sm select-none" : ""}`}
        >
          {/* Introduction comes first, before the article header */}
          {introduction && (
            <IntroductionBlock text={introduction} />
          )}
          {title && <h1 className="text-2xl font-bold mb-2">{title}</h1>}
          {isExcerpt && (
            <div className="text-sm text-gray-500 mb-1">
              You're reading an excerpt from this article
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              // Style links
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
              // Style headings
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
              // Style paragraphs
              p: ({ children }) => (
                <p className="mb-4 leading-relaxed">{children}</p>
              ),
              // Style lists
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
              // Style emphasis
              strong: ({ children }) => (
                <strong className="font-semibold">{children}</strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              // Style blockquotes
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4">
                  {children}
                </blockquote>
              ),
              // Style horizontal rules
              hr: () => <hr className="my-8 border-gray-300" />,
              // Style tables (GFM)
              table: ({ children }) => (
                <div className="overflow-x-auto my-4">
                  <table className="min-w-full border-collapse border border-gray-300">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-gray-100">{children}</thead>
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
        {afterContent}
      </div>

      {blurred && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="bg-white rounded-lg px-6 py-4 shadow-lg text-center">
            <svg
              className="w-8 h-8 mx-auto mb-2 text-gray-600"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-gray-600 text-sm">
              Please chat with the AI tutor
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
