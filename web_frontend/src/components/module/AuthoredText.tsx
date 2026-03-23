// web_frontend_next/src/components/narrative-lesson/AuthoredText.tsx

import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { getSectionSlug } from "@/utils/sectionSlug";

type ModuleSection = {
  contentId: string | null;
  meta: { title?: string | null };
};

type AuthoredTextProps = {
  content: string;
  courseId?: string;
  moduleSlug?: string;
  moduleSections?: ModuleSection[];
  completedContentIds?: Set<string>;
};

/**
 * Renders authored markdown content with white background.
 * This is "our voice" - introductions, questions, summaries.
 *
 * Reuses the same ReactMarkdown setup from ArticlePanel but with
 * simpler styling (no article header, no blur support).
 */
export default function AuthoredText({
  content,
  courseId,
  moduleSlug,
  moduleSections,
}: AuthoredTextProps) {
  const resolveLensHref = useCallback(
    (contentId: string): string => {
      if (moduleSections) {
        const index = moduleSections.findIndex(
          (s) => s.contentId === contentId,
        );
        if (index !== -1) {
          return `#${getSectionSlug(moduleSections[index], index)}`;
        }
      }
      // Fallback for cross-module or unknown content
      return `#lens-${contentId}`;
    },
    [moduleSections],
  );

  const renderLink = useCallback(
    ({
      children,
      href,
    }: {
      children?: React.ReactNode;
      href?: string;
    }) => {
      if (href?.startsWith("lens:")) {
        const contentId = href.slice("lens:".length);
        return (
          <a
            href={resolveLensHref(contentId)}
            className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
          >
            {children}
          </a>
        );
      }

      if (href?.startsWith("module:")) {
        const slug = href.slice("module:".length);
        return (
          <a
            href={courseId ? `/course/${courseId}/module/${slug}` : `#${slug}`}
            className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
          >
            {children}
          </a>
        );
      }

      // External / regular link
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
        >
          {children}
        </a>
      );
    },
    [courseId, resolveLensHref],
  );

  return (
    <div className="py-6 px-4">
      <article className="prose prose-gray max-w-content mx-auto text-gray-800 [&>:last-child]:mb-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          urlTransform={(url) => {
            // Allow custom schemes for internal links
            if (url.startsWith("lens:") || url.startsWith("module:")) {
              return url;
            }
            // Default: pass through (react-markdown v10 default sanitizes)
            return url;
          }}
          components={{
            // Links
            a: renderLink,
            // Headings
            h2: ({ children }) => (
              <h2 className="text-xl font-bold mt-6 mb-3 font-display">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-lg font-bold mt-5 mb-2 font-display">
                {children}
              </h3>
            ),
            // Paragraphs
            p: ({ children }) => (
              <p className="mb-4 leading-relaxed">{children}</p>
            ),
            // Lists
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
            // Emphasis
            strong: ({ children }) => (
              <strong className="font-semibold">{children}</strong>
            ),
            em: ({ children }) => <em className="italic">{children}</em>,
            // Blockquotes
            blockquote: ({ children }) => (
              <blockquote
                className="not-prose border-l-3 pl-4 my-4 text-gray-800 [&>p]:mb-0"
                style={{ borderColor: "var(--brand-border)" }}
              >
                {children}
              </blockquote>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
