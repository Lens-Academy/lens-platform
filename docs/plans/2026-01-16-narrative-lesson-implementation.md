# NarrativeLesson Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build NarrativeLesson - a single vertically-scrolling lesson where articles/videos flow with interleaved authored text and chat sections sharing one conversation.

**Architecture:** New view component `NarrativeLesson.tsx` renders a vertical scroll of segments. Chat state is lifted to the view level and passed to all `NarrativeChatSection` instances. A `ProgressSidebar` on the left shows article/video icons that highlight based on scroll position (Intersection Observer).

**Tech Stack:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS, existing `VideoPlayer`, `ArticlePanel` patterns, `react-markdown`

**Design Doc:** See `docs/plans/2026-01-16-narrative-lesson-design.md`

---

## Phase 1: Types and Data Structures

### Task 1: Create TypeScript types for narrative lesson format

**Files:**
- Create: `web_frontend_next/src/types/narrative-lesson.ts`

**Step 1: Create the types file**

```typescript
// web_frontend_next/src/types/narrative-lesson.ts

/**
 * Types for NarrativeLesson format.
 *
 * Key difference from unified-lesson: segments within a section allow
 * interleaving of text, content excerpts, and chat.
 */

import type { ChatMessage, ArticleData } from "./unified-lesson";

// Segment types within a section
export type TextSegment = {
  type: "text";
  content: string; // Markdown content (authored)
};

export type ArticleExcerptSegment = {
  type: "article-excerpt";
  from: string;
  to: string;
};

export type VideoExcerptSegment = {
  type: "video-excerpt";
  from: number; // seconds
  to: number;   // seconds
};

export type ChatSegment = {
  type: "chat";
};

export type NarrativeSegment =
  | TextSegment
  | ArticleExcerptSegment
  | VideoExcerptSegment
  | ChatSegment;

// Section types (one progress marker each)
export type NarrativeArticleSection = {
  type: "article";
  source: string;
  label: string; // Progress sidebar label
  segments: NarrativeSegment[];
};

export type NarrativeVideoSection = {
  type: "video";
  videoId: string;
  label: string; // Progress sidebar label
  segments: NarrativeSegment[];
};

export type NarrativeSection = NarrativeArticleSection | NarrativeVideoSection;

// Full lesson definition
export type NarrativeLesson = {
  format: "narrative";
  slug: string;
  title: string;
  sections: NarrativeSection[];
};

// Runtime state
export type NarrativeLessonState = {
  lesson: NarrativeLesson;
  messages: ChatMessage[];
  currentSectionIndex: number; // Derived from scroll position
  sessionId: number | null;
  // Article content keyed by source path
  articleContent: Record<string, ArticleData>;
};
```

**Step 2: Verify types compile**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add TypeScript types for narrative lesson format"
```

---

## Phase 2: Core Components

### Task 2: Create AuthoredText component

**Files:**
- Create: `web_frontend_next/src/components/narrative-lesson/AuthoredText.tsx`

**Step 1: Create the component**

```tsx
// web_frontend_next/src/components/narrative-lesson/AuthoredText.tsx
"use client";

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
    <div className="max-w-[700px] mx-auto py-6 px-4">
      <article className="prose prose-gray">
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
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add AuthoredText component for markdown"
```

---

### Task 3: Create ArticleEmbed component (gray card styling)

**Files:**
- Create: `web_frontend_next/src/components/narrative-lesson/ArticleEmbed.tsx`

**Step 1: Create the component**

```tsx
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
  showHeader = true
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
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add ArticleEmbed component with card styling"
```

---

### Task 4: Create VideoEmbed component (80% width wrapper)

**Files:**
- Create: `web_frontend_next/src/components/narrative-lesson/VideoEmbed.tsx`

**Step 1: Create the component**

```tsx
// web_frontend_next/src/components/narrative-lesson/VideoEmbed.tsx
"use client";

import VideoPlayer from "@/components/unified-lesson/VideoPlayer";

type VideoEmbedProps = {
  videoId: string;
  start: number;
  end: number;
  onEnded?: () => void;
};

/**
 * Wraps VideoPlayer at 80% width with gray card styling.
 * Reuses the existing VideoPlayer component entirely.
 */
export default function VideoEmbed({
  videoId,
  start,
  end,
  onEnded,
}: VideoEmbedProps) {
  return (
    <div className="w-[80%] max-w-[900px] mx-auto py-4">
      <div className="bg-stone-100 rounded-lg overflow-hidden shadow-sm">
        <VideoPlayer
          videoId={videoId}
          start={start}
          end={end}
          onEnded={onEnded ?? (() => {})}
        />
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add VideoEmbed wrapper component"
```

---

### Task 5: Create NarrativeChatSection component (75vh max, shared state)

**Files:**
- Create: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx`

**Step 1: Create the component**

This component receives chat state from parent (shared across all instances).

```tsx
// web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx
"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, PendingMessage } from "@/types/unified-lesson";

type NarrativeChatSectionProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
};

/**
 * Chat section for NarrativeLesson with 75vh max height.
 * All instances share the same state (passed via props).
 *
 * Simplified from ChatPanel - no recording, no transition buttons.
 * Just messages + input.
 */
export default function NarrativeChatSection({
  messages,
  pendingMessage,
  streamingContent,
  isLoading,
  onSendMessage,
  onRetryMessage,
}: NarrativeChatSectionProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Filter out system messages for display
  const visibleMessages = messages.filter((m) => m.role !== "system");

  return (
    <div className="max-w-[700px] mx-auto py-4 px-4">
      <div
        className="border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col"
        style={{ maxHeight: "75vh" }}
      >
        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {visibleMessages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Pending user message */}
          {pendingMessage && (
            <div className="flex justify-end">
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  pendingMessage.status === "failed"
                    ? "bg-red-100 text-red-800 border border-red-200"
                    : "bg-blue-600 text-white opacity-70"
                }`}
              >
                <p className="whitespace-pre-wrap">{pendingMessage.content}</p>
                {pendingMessage.status === "failed" && onRetryMessage && (
                  <button
                    onClick={onRetryMessage}
                    className="text-red-600 text-sm underline mt-1"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Streaming response */}
          {streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg px-4 py-2 bg-gray-100 text-gray-900">
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingContent}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingContent && (
            <div className="flex justify-start">
              <div className="rounded-lg px-4 py-2 bg-gray-100">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <form onSubmit={handleSubmit} className="border-t border-gray-200 p-4">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add NarrativeChatSection with 75vh max height"
```

---

### Task 6: Create ProgressSidebar component

**Files:**
- Create: `web_frontend_next/src/components/narrative-lesson/ProgressSidebar.tsx`

**Step 1: Create the component**

```tsx
// web_frontend_next/src/components/narrative-lesson/ProgressSidebar.tsx
"use client";

import { StageIcon } from "@/components/unified-lesson/StageProgressBar";
import type { NarrativeSection } from "@/types/narrative-lesson";

type ProgressSidebarProps = {
  sections: NarrativeSection[];
  currentSectionIndex: number;
  /** Progress through current section (0-1) */
  scrollProgress: number;
  onSectionClick: (index: number) => void;
};

/**
 * Vertical progress sidebar showing article/video icons.
 * Fixed to left edge, shows progress through lesson.
 */
export default function ProgressSidebar({
  sections,
  currentSectionIndex,
  scrollProgress,
  onSectionClick,
}: ProgressSidebarProps) {
  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center">
      {sections.map((section, index) => {
        const isCompleted = index < currentSectionIndex;
        const isCurrent = index === currentSectionIndex;
        const isFuture = index > currentSectionIndex;

        return (
          <div key={index} className="flex flex-col items-center">
            {/* Connector line (except before first) */}
            {index > 0 && (
              <div
                className="w-0.5 h-6"
                style={{
                  backgroundColor: isCompleted || isCurrent ? "#3b82f6" : "#d1d5db",
                  // Partial fill for current section
                  ...(isCurrent && index > 0
                    ? {
                        background: `linear-gradient(to bottom, #3b82f6 ${scrollProgress * 100}%, #d1d5db ${scrollProgress * 100}%)`,
                      }
                    : {}),
                }}
              />
            )}

            {/* Section icon */}
            <button
              onClick={() => onSectionClick(index)}
              className={`
                w-10 h-10 rounded-full flex items-center justify-center
                transition-all duration-150
                ${
                  isCompleted
                    ? "bg-blue-500 text-white"
                    : isCurrent
                      ? "bg-blue-500 text-white ring-2 ring-offset-2 ring-blue-500"
                      : "bg-gray-200 text-gray-500"
                }
                ${isFuture ? "opacity-50" : ""}
                hover:scale-110
              `}
              title={section.label}
            >
              <StageIcon type={section.type} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add ProgressSidebar component"
```

---

## Phase 3: Main View Component

### Task 7: Create NarrativeLesson view

**Files:**
- Create: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Create the main view**

```tsx
// web_frontend_next/src/views/NarrativeLesson.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessage, PendingMessage, ArticleData } from "@/types/unified-lesson";
import type { NarrativeLesson as NarrativeLessonType, NarrativeSection, NarrativeSegment, NarrativeArticleSection } from "@/types/narrative-lesson";
import { sendMessage, createSession, getSession } from "@/api/lessons";
import { useAnonymousSession } from "@/hooks/useAnonymousSession";
import AuthoredText from "@/components/narrative-lesson/AuthoredText";
import ArticleEmbed from "@/components/narrative-lesson/ArticleEmbed";
import VideoEmbed from "@/components/narrative-lesson/VideoEmbed";
import NarrativeChatSection from "@/components/narrative-lesson/NarrativeChatSection";
import ProgressSidebar from "@/components/narrative-lesson/ProgressSidebar";

type NarrativeLessonProps = {
  lesson: NarrativeLessonType;
};

/**
 * Extract content between two text markers.
 * Returns full content if markers not found.
 */
function extractExcerpt(content: string, from: string, to: string): string {
  const fromIndex = content.indexOf(from);
  const toIndex = content.indexOf(to);

  if (fromIndex === -1) {
    console.warn(`Excerpt marker not found: "${from.substring(0, 50)}..."`);
    return content;
  }

  if (toIndex === -1 || toIndex <= fromIndex) {
    // Return from 'from' to end
    return content.substring(fromIndex);
  }

  return content.substring(fromIndex, toIndex);
}

/**
 * Main view for NarrativeLesson format.
 *
 * Renders a continuous vertical scroll with:
 * - Authored text (white bg)
 * - Article excerpts (gray card)
 * - Video excerpts (gray card, 80% width)
 * - Chat sections (75vh, all sharing same state)
 * - Progress sidebar on left
 */
export default function NarrativeLesson({ lesson }: NarrativeLessonProps) {
  // Chat state (shared across all chat sections)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Session state
  const [sessionId, setSessionId] = useState<number | null>(null);
  const { getStoredSessionId, storeSessionId, clearSessionId } = useAnonymousSession(lesson.slug);

  // Progress tracking
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Article content cache
  const [articleContent, setArticleContent] = useState<Record<string, ArticleData>>({});

  // Loading state for articles
  const [articlesLoading, setArticlesLoading] = useState(true);

  // Initialize session
  useEffect(() => {
    async function init() {
      const storedId = getStoredSessionId();
      if (storedId) {
        try {
          const state = await getSession(storedId);
          setSessionId(storedId);
          setMessages(state.messages);
          return;
        } catch {
          clearSessionId();
        }
      }

      // Create new session
      const sid = await createSession(lesson.slug);
      storeSessionId(sid);
      setSessionId(sid);
    }

    init();
  }, [lesson.slug, getStoredSessionId, storeSessionId, clearSessionId]);

  // Fetch article content for all article sections
  useEffect(() => {
    async function fetchArticles() {
      setArticlesLoading(true);
      const articleSources = lesson.sections
        .filter((s): s is NarrativeArticleSection => s.type === "article")
        .map((s) => s.source);

      // Deduplicate sources
      const uniqueSources = [...new Set(articleSources)];

      try {
        // Fetch all articles in parallel
        // TODO: This needs a backend endpoint - for now, use placeholder
        const results = await Promise.all(
          uniqueSources.map(async (source) => {
            // Placeholder: In production, fetch from /api/articles/{source}
            // For now, return empty content to allow UI to render
            return {
              source,
              data: {
                content: `[Article content from ${source} will appear here]`,
                title: source.split("/").pop()?.replace(".md", "") ?? "Article",
                author: null,
                sourceUrl: null,
                isExcerpt: true,
              } as ArticleData,
            };
          })
        );

        const contentMap: Record<string, ArticleData> = {};
        results.forEach(({ source, data }) => {
          contentMap[source] = data;
        });
        setArticleContent(contentMap);
      } catch (error) {
        console.error("Failed to fetch articles:", error);
      } finally {
        setArticlesLoading(false);
      }
    }

    fetchArticles();
  }, [lesson.sections]);

  // Send message handler (shared across all chat sections)
  const handleSendMessage = useCallback(async (content: string) => {
    if (!sessionId) return;

    if (content) {
      setPendingMessage({ content, status: "sending" });
    }
    setIsLoading(true);
    setStreamingContent("");

    try {
      let assistantContent = "";

      for await (const chunk of sendMessage(sessionId, content)) {
        if (chunk.type === "text" && chunk.content) {
          assistantContent += chunk.content;
          setStreamingContent(assistantContent);
        }
      }

      // Update messages
      setMessages((prev) => [
        ...prev,
        ...(content ? [{ role: "user" as const, content }] : []),
        { role: "assistant" as const, content: assistantContent },
      ]);
      setPendingMessage(null);
      setStreamingContent("");
    } catch {
      if (content) {
        setPendingMessage({ content, status: "failed" });
      }
      setStreamingContent("");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const handleRetryMessage = useCallback(() => {
    if (!pendingMessage) return;
    const content = pendingMessage.content;
    setPendingMessage(null);
    handleSendMessage(content);
  }, [pendingMessage, handleSendMessage]);

  // Scroll tracking with Intersection Observer
  // Use setTimeout to ensure refs are populated after render
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-section-index"));
            if (!isNaN(index)) {
              setCurrentSectionIndex(index);
            }
          }
        });
      },
      { threshold: 0.3 }
    );

    // Delay observation to ensure refs are populated
    const timeout = setTimeout(() => {
      sectionRefs.current.forEach((el) => {
        observer.observe(el);
      });
    }, 0);

    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [lesson.sections]);

  // Track scroll progress within current section
  useEffect(() => {
    const handleScroll = () => {
      const currentEl = sectionRefs.current.get(currentSectionIndex);
      if (!currentEl) return;

      const rect = currentEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Calculate how much of the section has scrolled past the top
      const sectionTop = rect.top;
      const sectionHeight = rect.height;

      if (sectionTop >= viewportHeight) {
        setScrollProgress(0);
      } else if (sectionTop + sectionHeight <= 0) {
        setScrollProgress(1);
      } else {
        // Section is in view - calculate progress
        const scrolledAmount = Math.max(0, -sectionTop);
        const progress = Math.min(1, scrolledAmount / (sectionHeight - viewportHeight / 2));
        setScrollProgress(progress);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [currentSectionIndex]);

  // Scroll to section
  const handleSectionClick = useCallback((index: number) => {
    const el = sectionRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // Render a segment
  const renderSegment = (
    segment: NarrativeSegment,
    section: NarrativeSection,
    segmentIndex: number
  ) => {
    switch (segment.type) {
      case "text":
        return (
          <AuthoredText
            key={`text-${segmentIndex}`}
            content={segment.content}
          />
        );

      case "article-excerpt":
        const articleData = articleContent[section.type === "article" ? section.source : ""];
        if (!articleData) {
          // Loading skeleton
          return (
            <div key={`article-${segmentIndex}`} className="max-w-[700px] mx-auto py-4 px-4">
              <div className="bg-stone-100 rounded-lg p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-3/4 mb-4" />
                <div className="h-4 bg-gray-200 rounded w-full mb-2" />
                <div className="h-4 bg-gray-200 rounded w-5/6 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-4/5 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-full mb-2" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
              </div>
            </div>
          );
        }
        // Extract content between from/to markers
        const excerptContent = extractExcerpt(
          articleData.content,
          segment.from,
          segment.to
        );
        const excerptData: ArticleData = {
          ...articleData,
          content: excerptContent,
          isExcerpt: true,
        };
        return (
          <ArticleEmbed
            key={`article-${segmentIndex}`}
            article={excerptData}
            showHeader={segmentIndex === 0} // Only show header for first excerpt
          />
        );

      case "video-excerpt":
        if (section.type !== "video") return null;
        return (
          <VideoEmbed
            key={`video-${segmentIndex}`}
            videoId={section.videoId}
            start={segment.from}
            end={segment.to}
          />
        );

      case "chat":
        return (
          <NarrativeChatSection
            key={`chat-${segmentIndex}`}
            messages={messages}
            pendingMessage={pendingMessage}
            streamingContent={streamingContent}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onRetryMessage={handleRetryMessage}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-semibold text-gray-900">{lesson.title}</h1>
        <a
          href="/"
          className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Exit
        </a>
      </header>

      {/* Progress sidebar */}
      <ProgressSidebar
        sections={lesson.sections}
        currentSectionIndex={currentSectionIndex}
        scrollProgress={scrollProgress}
        onSectionClick={handleSectionClick}
      />

      {/* Main content */}
      <main className="pl-20"> {/* Left padding for sidebar */}
        {lesson.sections.map((section, sectionIndex) => (
          <div
            key={sectionIndex}
            ref={(el) => {
              if (el) sectionRefs.current.set(sectionIndex, el);
            }}
            data-section-index={sectionIndex}
            className="py-8"
          >
            {section.segments.map((segment, segmentIndex) =>
              renderSegment(segment, section, segmentIndex)
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add NarrativeLesson main view component"
```

---

## Phase 4: Next.js Page Route

### Task 8: Create App Router page for narrative lessons

**Files:**
- Create: `web_frontend_next/src/app/narrative/[lessonId]/page.tsx`

**Step 1: Create the page**

```tsx
// web_frontend_next/src/app/narrative/[lessonId]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import NarrativeLesson from "@/views/NarrativeLesson";
import type { NarrativeLesson as NarrativeLessonType } from "@/types/narrative-lesson";

// TODO: Replace with actual API call
async function fetchNarrativeLesson(slug: string): Promise<NarrativeLessonType | null> {
  // Placeholder - will need API endpoint
  console.log("Fetching narrative lesson:", slug);
  return null;
}

export default function NarrativeLessonPage() {
  const params = useParams();
  const lessonId = (params?.lessonId as string) ?? "";

  const [lesson, setLesson] = useState<NarrativeLessonType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lessonId) return;

    async function load() {
      try {
        const data = await fetchNarrativeLesson(lessonId);
        setLesson(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load lesson");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [lessonId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading lesson...</p>
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error ?? "Lesson not found"}</p>
          <a href="/" className="text-blue-600 hover:underline">Go home</a>
        </div>
      </div>
    );
  }

  return <NarrativeLesson lesson={lesson} />;
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add App Router page for narrative lessons"
```

---

## Phase 5: Sample Lesson Data (for testing)

### Task 9: Create a sample narrative lesson YAML

**Files:**
- Create: `educational_content/lessons/narrative-test.yaml`

**Step 1: Create the sample lesson**

```yaml
# educational_content/lessons/narrative-test.yaml
# Note: Segment types must match TypeScript definitions exactly
format: narrative
slug: narrative-test
title: "Test Narrative Lesson"

sections:
  - type: article
    source: articles/tim-urban-artificial-intelligence-revolution-1.md
    label: "The AI Revolution"
    segments:
      - type: text
        content: |
          Welcome to this lesson on the AI Revolution.

          We'll be reading Tim Urban's famous essay from Wait But Why.
          Pay attention to the concept of "Die Progress Units" - it's a
          memorable way to think about accelerating change.

      - type: article-excerpt
        from: "What does it feel like to stand here?"
        to: "## The Far Future—Coming Soon"

      - type: text
        content: |
          **Reflection question:**

          Urban describes bringing someone from 1750 to today. What do you
          think would shock them most - and what might they adapt to quickly?

      - type: chat

      - type: article-excerpt
        from: "## The Far Future—Coming Soon"
        to: "## What Is AI?"

      - type: text
        content: |
          Urban introduces the idea of **exponential thinking** vs **linear thinking**.

          This is one of the most common mistakes people make when predicting
          the future of AI. Let's make sure you understand it.

      - type: chat

  - type: video
    videoId: "pYXy-A4siMw"
    label: "AI Explained"
    segments:
      - type: text
        content: |
          Now let's watch a video that covers similar ground with some
          additional visual explanations.

      - type: video-excerpt
        from: 0
        to: 180

      - type: text
        content: |
          **Quick check:** What's the key difference between ANI and AGI?

      - type: chat

      - type: text
        content: |
          ## Summary

          Key takeaways from this lesson:
          - Progress is exponential, not linear
          - We're currently in the ANI era
          - The AGI → ASI transition could be rapid
```

**Step 2: Commit**

```bash
jj describe -m "feat(narrative): add sample narrative lesson YAML for testing"
```

---

## Phase 6: Integration & Polish

### Task 10: Add index export for narrative-lesson components

**Files:**
- Create: `web_frontend_next/src/components/narrative-lesson/index.ts`

**Step 1: Create the index file**

```typescript
// web_frontend_next/src/components/narrative-lesson/index.ts
export { default as AuthoredText } from "./AuthoredText";
export { default as ArticleEmbed } from "./ArticleEmbed";
export { default as VideoEmbed } from "./VideoEmbed";
export { default as NarrativeChatSection } from "./NarrativeChatSection";
export { default as ProgressSidebar } from "./ProgressSidebar";
```

**Step 2: Commit**

```bash
jj describe -m "feat(narrative): add index exports for narrative-lesson components"
```

---

## Summary

This plan creates the frontend foundation for NarrativeLesson:

| Phase | Tasks | What's Built |
|-------|-------|--------------|
| 1 | Task 1 | TypeScript types |
| 2 | Tasks 2-6 | Core components (AuthoredText, ArticleEmbed, VideoEmbed, NarrativeChatSection, ProgressSidebar) |
| 3 | Task 7 | Main view component |
| 4 | Task 8 | App Router page |
| 5 | Task 9 | Sample lesson data |
| 6 | Task 10 | Index exports |

**Not included (future work):**
- Backend API for fetching narrative lessons
- Backend API for fetching article excerpts by from/to markers
- Integration with existing session/auth system
- Activity tracking
- Lesson completion flow

**Testing approach:**
- Manual testing with sample lesson
- Type checking with `npx tsc --noEmit`
- Visual inspection in browser at `/narrative/narrative-test`
