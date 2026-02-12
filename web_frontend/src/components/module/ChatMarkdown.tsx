import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer for chat messages — compact styling for chat context. */
export function ChatMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-blue-600 underline hover:text-blue-800"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        h1: ({ children }) => (
          <h1 className="text-base font-bold mt-3 mb-1 first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-bold mt-3 mb-1 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-bold mt-2 mb-1 first:mt-0">{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-0.5">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-0.5">
            {children}
          </ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-3 border-gray-300 pl-3 my-2 text-gray-600">
            {children}
          </blockquote>
        ),
        pre: ({ children }) => (
          <pre className="bg-gray-100 rounded p-2 my-2 overflow-x-auto text-sm">
            {children}
          </pre>
        ),
        code: ({ children }) => (
          <code className="bg-gray-100 px-1 rounded text-sm">{children}</code>
        ),
        hr: () => <hr className="my-3 border-gray-200" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
