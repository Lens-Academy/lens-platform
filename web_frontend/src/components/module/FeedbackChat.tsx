/**
 * FeedbackChat - Post-answer AI feedback chat component.
 *
 * Renders below a completed answer when segment.feedback is true.
 * Streams AI feedback via SSE, supports multi-turn conversation,
 * and restores history on return visits.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  sendFeedbackMessage,
  getFeedbackHistory,
} from "@/api/assessments";

// Compact markdown renderer for chat messages
function ChatMarkdown({ children }: { children: string }) {
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
          <h3 className="text-sm font-bold mt-2 mb-1 first:mt-0">
            {children}
          </h3>
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
          <blockquote className="border-l-3 border-stone-300 pl-3 my-2 text-stone-600">
            {children}
          </blockquote>
        ),
        pre: ({ children }) => (
          <pre className="bg-stone-100 rounded p-2 my-2 overflow-x-auto text-sm">
            {children}
          </pre>
        ),
        code: ({ children }) => (
          <code className="bg-stone-100 px-1 rounded text-sm">{children}</code>
        ),
        hr: () => <hr className="my-3 border-stone-200" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

interface FeedbackChatProps {
  questionId: string;
  moduleSlug: string;
  answerText: string;
  isAuthenticated: boolean;
  autoTrigger: boolean;
}

export default function FeedbackChat({
  questionId,
  moduleSlug,
  answerText,
  isAuthenticated,
  autoTrigger,
}: FeedbackChatProps) {
  const [messages, setMessages] = useState<
    Array<{ role: string; content: string }>
  >([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasTriggeredRef = useRef(false);

  // Stream a feedback message and collect the response
  const streamMessage = useCallback(
    async (message: string) => {
      setIsStreaming(true);
      setStreamingContent("");

      let fullContent = "";
      try {
        for await (const chunk of sendFeedbackMessage(
          questionId,
          moduleSlug,
          answerText,
          message,
          isAuthenticated,
        )) {
          if (chunk.type === "text" && chunk.content) {
            fullContent += chunk.content;
            setStreamingContent(fullContent);
          } else if (chunk.type === "done") {
            break;
          } else if (chunk.type === "error") {
            break;
          }
        }
      } catch {
        // Streaming failed -- show what we have
      }

      if (fullContent) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: fullContent },
        ]);
      }
      setStreamingContent("");
      setIsStreaming(false);
    },
    [questionId, moduleSlug, answerText, isAuthenticated],
  );

  // Load history on mount, auto-trigger if needed
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const history = await getFeedbackHistory(questionId, isAuthenticated);

        if (cancelled) return;

        if (history.messages.length > 0) {
          // Return visit -- restore conversation, do NOT auto-trigger
          setMessages(history.messages);
          setIsLoading(false);
          return;
        }
      } catch {
        // Failed to load history -- continue with empty state
      }

      if (cancelled) return;
      setIsLoading(false);

      // Auto-trigger initial feedback on first completion
      if (autoTrigger && !hasTriggeredRef.current) {
        hasTriggeredRef.current = true;
        // Small delay so the component renders before streaming starts
        setTimeout(() => {
          if (!cancelled) {
            streamMessage("");
          }
        }, 100);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [questionId, isAuthenticated, autoTrigger, streamMessage]);

  // Scroll into view when streaming starts
  useEffect(() => {
    if (isStreaming && containerRef.current) {
      setTimeout(() => {
        containerRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    }
  }, [isStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 120;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }, [input]);

  // Handle user reply
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    streamMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Don't render anything while loading (no flash)
  if (isLoading && !autoTrigger) return null;

  return (
    <div
      ref={containerRef}
      className="mt-4 border-t border-stone-200 pt-3"
    >
      {/* Header label */}
      <div className="text-xs text-stone-400 mb-3">AI Feedback</div>

      {/* Messages */}
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={
              msg.role === "assistant"
                ? "bg-stone-50 rounded-lg p-3 text-stone-800 text-[0.95rem] leading-relaxed"
                : "bg-blue-50 rounded-lg p-3 text-stone-800 text-[0.95rem] leading-relaxed ml-8"
            }
          >
            {msg.role === "assistant" ? (
              <ChatMarkdown>{msg.content}</ChatMarkdown>
            ) : (
              <div className="whitespace-pre-wrap">{msg.content}</div>
            )}
          </div>
        ))}

        {/* Streaming content */}
        {streamingContent && (
          <div className="bg-stone-50 rounded-lg p-3 text-stone-800 text-[0.95rem] leading-relaxed">
            <ChatMarkdown>{streamingContent}</ChatMarkdown>
            <span className="inline-block w-2 h-4 bg-stone-400 animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
          </div>
        )}

        {/* Loading indicator (streaming with no content yet) */}
        {isStreaming && !streamingContent && (
          <div className="bg-stone-50 rounded-lg p-3 text-stone-500 text-sm">
            Thinking...
          </div>
        )}
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 mt-3 items-end"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up question..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none leading-normal disabled:bg-stone-50 disabled:text-stone-400 bg-white"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className={`text-sm px-3 py-2 rounded-lg transition-colors ${
            !isStreaming && input.trim()
              ? "bg-stone-100 text-stone-600 hover:bg-stone-200"
              : "bg-stone-50 text-stone-300 cursor-default"
          }`}
        >
          Send
        </button>
      </form>
    </div>
  );
}
