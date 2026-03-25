// web_frontend_next/src/components/narrative-lesson/AuthoredText.tsx

import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { getSectionSlug } from "@/utils/sectionSlug";
import { generateHeadingId } from "@/utils/extractHeadings";
import LensCard from "./LensCard";

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
  allCompletedContentIds?: Set<string>;
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
  moduleSlug: _moduleSlug,
  moduleSections,
  completedContentIds,
  allCompletedContentIds,
}: AuthoredTextProps) {
  const resolveLensHref = useCallback(
    (contentId: string, moduleSlug?: string | null, title?: string | null): string => {
      // Same-module lookup
      if (moduleSections) {
        const index = moduleSections.findIndex(
          (s) => s.contentId === contentId,
        );
        if (index !== -1) {
          return `#${getSectionSlug(moduleSections[index], index)}`;
        }
      }
      // Cross-module — include section hash from title
      if (moduleSlug && courseId) {
        const hash = title ? `#${generateHeadingId(title)}` : "";
        return `/course/${courseId}/module/${moduleSlug}${hash}`;
      }
      // Standalone lens
      return `/lens/${contentId}`;
    },
    [moduleSections, courseId],
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
        const rest = href.slice("lens:".length);
        const atIndex = rest.indexOf("@");
        const contentId = atIndex !== -1 ? rest.slice(0, atIndex) : rest;
        const targetModuleSlug = atIndex !== -1 ? rest.slice(atIndex + 1) : null;

        // Extract display text for section hash generation
        const displayText = typeof children === "string" ? children : null;

        return (
          <a
            href={resolveLensHref(contentId, targetModuleSlug, displayText)}
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
            // Card divs
            div: ({ node, ...props }) => {
              const lensCardJson = (node?.properties as Record<string, unknown>)?.["dataLensCard"] as string | undefined;
              if (lensCardJson) {
                try {
                  const data = JSON.parse(lensCardJson);
                  const isCompleted =
                    (completedContentIds?.has(data.contentId) || allCompletedContentIds?.has(data.contentId)) ?? false;
                  let href: string | undefined;
                  if (data.targetType === "lens") {
                    href = resolveLensHref(data.contentId, data.moduleSlug, data.title);
                  } else if (data.targetType === "module") {
                    href = courseId
                      ? `/course/${courseId}/module/${data.slug}`
                      : `/module/${data.slug}`;
                  }
                  return <LensCard {...data} isCompleted={isCompleted} href={href} />;
                } catch {
                  return <div {...props} />;
                }
              }
              return <div {...props} />;
            },
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
