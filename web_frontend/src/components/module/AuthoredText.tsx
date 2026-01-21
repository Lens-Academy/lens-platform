// web_frontend_next/src/components/narrative-lesson/AuthoredText.tsx

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

type AuthoredTextProps = {
  content: string;
};

/**
 * Renders authored markdown content with white background.
 * This is "our voice" - introductions, questions, summaries.
 *
 * Reuses the same ReactMarkdown setup from ArticlePanel but with
 * simpler styling (no article header, no blur support).
 */
export default function AuthoredText({ content }: AuthoredTextProps) {
  return (
    <div className="py-6 px-4">
      <article className="prose prose-gray max-w-content mx-auto">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            // Links
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
            // Headings
            h2: ({ children }) => (
              <h2 className="text-xl font-bold mt-6 mb-3">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-lg font-bold mt-5 mb-2">{children}</h3>
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
              <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4">
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
