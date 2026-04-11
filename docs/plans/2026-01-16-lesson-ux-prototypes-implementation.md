# Lesson UX Prototypes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 4 quick prototype UX variants for interactive lessons with interleaved content + AI chat checkpoints.

**Architecture:** Each prototype is a self-contained page component under `src/components/lesson-prototypes/`. Prototypes share infrastructure (hooks, simplified chat, markdown renderer) but have distinct layouts. All use existing backend API - no backend changes needed.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, existing youtube-video-element, existing lesson API

---

## Task 1: Create Shared Infrastructure

**Files:**
- Create: `web_frontend/src/components/lesson-prototypes/shared/types.ts`
- Create: `web_frontend/src/components/lesson-prototypes/shared/usePrototypeLesson.ts`
- Create: `web_frontend/src/components/lesson-prototypes/shared/SimpleChatBox.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/shared/MarkdownBlock.tsx`

### Step 1: Create types for prototype lessons

```typescript
// web_frontend/src/components/lesson-prototypes/shared/types.ts

export type ContentBlock =
  | { type: "markdown"; content: string; id: string }
  | { type: "video"; videoId: string; start: number; end: number; id: string }
  | { type: "chat"; id: string; prompt?: string };

export type PrototypeLesson = {
  title: string;
  blocks: ContentBlock[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
};
```

### Step 2: Create hook for managing prototype lesson state

```typescript
// web_frontend/src/components/lesson-prototypes/shared/usePrototypeLesson.ts

import { useState, useCallback } from "react";
import type { ChatMessage, ChatState } from "./types";
import { sendMessage } from "../../../api/lessons";

type UsePrototypeLessonProps = {
  sessionId: number | null;
};

export function usePrototypeLesson({ sessionId }: UsePrototypeLessonProps) {
  // Track chat state per block ID
  const [chatStates, setChatStates] = useState<Record<string, ChatState>>({});
  // Track which blocks are completed (user can proceed)
  const [completedBlocks, setCompletedBlocks] = useState<Set<string>>(new Set());
  // Current active block
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  const getChatState = useCallback(
    (blockId: string): ChatState => {
      return chatStates[blockId] || { messages: [], isStreaming: false, streamingContent: "" };
    },
    [chatStates]
  );

  const sendChatMessage = useCallback(
    async (blockId: string, content: string) => {
      if (!sessionId) return;

      // Add user message optimistically
      setChatStates((prev) => ({
        ...prev,
        [blockId]: {
          ...getChatState(blockId),
          messages: [...getChatState(blockId).messages, { role: "user", content }],
          isStreaming: true,
          streamingContent: "",
        },
      }));

      try {
        let fullResponse = "";
        for await (const chunk of sendMessage(sessionId, content)) {
          if (chunk.type === "content" && chunk.content) {
            fullResponse += chunk.content;
            setChatStates((prev) => ({
              ...prev,
              [blockId]: {
                ...prev[blockId],
                streamingContent: fullResponse,
              },
            }));
          }
        }

        // Finalize message
        setChatStates((prev) => ({
          ...prev,
          [blockId]: {
            messages: [...prev[blockId].messages, { role: "assistant", content: fullResponse }],
            isStreaming: false,
            streamingContent: "",
          },
        }));
      } catch (error) {
        console.error("Chat error:", error);
        setChatStates((prev) => ({
          ...prev,
          [blockId]: {
            ...prev[blockId],
            isStreaming: false,
          },
        }));
      }
    },
    [sessionId, getChatState]
  );

  const markBlockCompleted = useCallback((blockId: string) => {
    setCompletedBlocks((prev) => new Set([...prev, blockId]));
  }, []);

  return {
    chatStates,
    getChatState,
    sendChatMessage,
    completedBlocks,
    markBlockCompleted,
    activeBlockId,
    setActiveBlockId,
  };
}
```

### Step 3: Create SimpleChatBox component

```tsx
// web_frontend/src/components/lesson-prototypes/shared/SimpleChatBox.tsx

import { useState, useRef, useEffect } from "react";
import type { ChatState } from "./types";

type SimpleChatBoxProps = {
  chatState: ChatState;
  onSendMessage: (content: string) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
};

export function SimpleChatBox({
  chatState,
  onSendMessage,
  placeholder = "Type your response...",
  className = "",
  compact = false,
}: SimpleChatBoxProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatState.messages, chatState.streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || chatState.isStreaming) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const messageClass = compact ? "text-sm py-2 px-3" : "py-3 px-4";
  const inputClass = compact ? "text-sm p-2" : "p-3";

  return (
    <div className={`flex flex-col bg-gray-50 rounded-lg ${className}`}>
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto ${compact ? "max-h-48" : "max-h-80"} space-y-2 p-3`}>
        {chatState.messages.map((msg, i) => (
          <div
            key={i}
            className={`${messageClass} rounded-lg ${
              msg.role === "user"
                ? "bg-blue-100 text-blue-900 ml-8"
                : "bg-white text-gray-800 mr-8 border border-gray-200"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {chatState.isStreaming && chatState.streamingContent && (
          <div className={`${messageClass} rounded-lg bg-white text-gray-800 mr-8 border border-gray-200`}>
            {chatState.streamingContent}
            <span className="animate-pulse">▊</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disabled={chatState.isStreaming}
            className={`flex-1 border border-gray-300 rounded-lg ${inputClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          <button
            type="submit"
            disabled={!input.trim() || chatState.isStreaming}
            className={`bg-blue-600 text-white rounded-lg px-4 ${inputClass} disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700`}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
```

### Step 4: Create MarkdownBlock component

```tsx
// web_frontend/src/components/lesson-prototypes/shared/MarkdownBlock.tsx

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownBlockProps = {
  content: string;
  className?: string;
};

export function MarkdownBlock({ content, className = "" }: MarkdownBlockProps) {
  return (
    <article className={`prose prose-gray max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>,
          p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4">{children}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
```

### Step 5: Create barrel export

```typescript
// web_frontend/src/components/lesson-prototypes/shared/index.ts

export * from "./types";
export * from "./usePrototypeLesson";
export { SimpleChatBox } from "./SimpleChatBox";
export { MarkdownBlock } from "./MarkdownBlock";
```

### Step 6: Commit shared infrastructure

```bash
cd web_frontend && git add src/components/lesson-prototypes/shared/
git commit -m "feat(prototypes): add shared infrastructure for lesson UX prototypes

- types.ts: ContentBlock, PrototypeLesson, ChatState types
- usePrototypeLesson.ts: hook for managing chat state per block
- SimpleChatBox.tsx: reusable chat input/display component
- MarkdownBlock.tsx: styled markdown renderer

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create Test Lesson Data

**Files:**
- Create: `web_frontend/src/components/lesson-prototypes/testLessonData.ts`

### Step 1: Create test lesson with mixed content and checkpoints

```typescript
// web_frontend/src/components/lesson-prototypes/testLessonData.ts

import type { PrototypeLesson } from "./shared/types";

export const testLesson: PrototypeLesson = {
  title: "Introduction to AI Safety",
  blocks: [
    {
      type: "markdown",
      id: "intro",
      content: `# Why AI Safety Matters

Artificial intelligence is advancing rapidly. As AI systems become more capable, ensuring they remain safe and beneficial becomes increasingly important.

In this lesson, we'll explore the core concepts of AI safety and why researchers are working on these problems today.`,
    },
    {
      type: "chat",
      id: "chat-1",
      prompt: "Before we dive in, what do you already know about AI safety? Have you heard of any AI safety concerns?",
    },
    {
      type: "markdown",
      id: "alignment",
      content: `## The Alignment Problem

The **alignment problem** refers to the challenge of ensuring AI systems pursue goals that align with human values and intentions.

Consider a simple example: you might ask an AI to "make people happy." But how do you prevent it from achieving this by manipulating brain chemistry directly, rather than by genuinely improving people's lives?

This illustrates why getting AI goals right is surprisingly difficult.`,
    },
    {
      type: "video",
      id: "video-1",
      videoId: "pYXy-A4siMw",
      start: 0,
      end: 120,
    },
    {
      type: "chat",
      id: "chat-2",
      prompt: "What stood out to you from the video? How does this connect to what we read about the alignment problem?",
    },
    {
      type: "markdown",
      id: "conclusion",
      content: `## Key Takeaways

1. **AI safety** is about ensuring AI systems are beneficial and avoid causing harm
2. **The alignment problem** is the challenge of making AI pursue the right goals
3. These problems become more important as AI systems become more capable

In the next lesson, we'll explore specific approaches researchers are taking to address these challenges.`,
    },
    {
      type: "chat",
      id: "chat-3",
      prompt: "What questions do you still have about AI safety? What would you like to learn more about?",
    },
  ],
};
```

### Step 2: Commit test data

```bash
git add src/components/lesson-prototypes/testLessonData.ts
git commit -m "feat(prototypes): add test lesson data with mixed content blocks

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Build Prototype A - Unified Scroll

**Files:**
- Create: `web_frontend/src/components/lesson-prototypes/prototype-a/UnifiedScrollLesson.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/prototype-a/ScrollVideoPlayer.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/prototype-a/index.ts`

### Step 1: Create ScrollVideoPlayer with checkpoint pausing

```tsx
// web_frontend/src/components/lesson-prototypes/prototype-a/ScrollVideoPlayer.tsx

import { useEffect, useRef, useState } from "react";
import "youtube-video-element";

// Extend JSX for youtube-video element
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "youtube-video": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          controls?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

type ScrollVideoPlayerProps = {
  videoId: string;
  start: number;
  end: number;
  checkpoints?: number[]; // Timestamps to pause at
  onCheckpointReached?: (timestamp: number) => void;
  onEnded?: () => void;
  isPaused?: boolean; // External pause control
};

export function ScrollVideoPlayer({
  videoId,
  start,
  end,
  checkpoints = [],
  onCheckpointReached,
  onEnded,
  isPaused = false,
}: ScrollVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const passedCheckpoints = useRef<Set<number>>(new Set());

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${start}`;
  const duration = end - start;

  // Get video element and set up listeners
  useEffect(() => {
    if (!containerRef.current) return;

    const video = containerRef.current.querySelector("youtube-video") as HTMLVideoElement | null;
    if (!video) return;
    videoRef.current = video;

    const handleLoadedMetadata = () => {
      video.currentTime = start;
    };

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);

      // Check if we hit a checkpoint
      for (const checkpoint of checkpoints) {
        if (
          time >= checkpoint &&
          !passedCheckpoints.current.has(checkpoint) &&
          time < checkpoint + 1
        ) {
          passedCheckpoints.current.add(checkpoint);
          video.pause();
          onCheckpointReached?.(checkpoint);
          return;
        }
      }

      // Check if we hit the end
      if (time >= end - 0.5) {
        video.pause();
        onEnded?.();
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [start, end, checkpoints, onCheckpointReached, onEnded]);

  // Handle external pause control
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPaused && !video.paused) {
      video.pause();
    }
  }, [isPaused]);

  const progress = Math.min((currentTime - start) / duration, 1);

  return (
    <div ref={containerRef} className="w-full">
      <div className="aspect-video relative rounded-lg overflow-hidden">
        <youtube-video src={youtubeUrl} controls className="w-full h-full" />
      </div>
      {/* Progress bar */}
      <div className="h-1 bg-gray-200 rounded-full mt-2">
        <div
          className="h-full bg-blue-600 rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
```

### Step 2: Create UnifiedScrollLesson main component

```tsx
// web_frontend/src/components/lesson-prototypes/prototype-a/UnifiedScrollLesson.tsx

import { useState } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import { ScrollVideoPlayer } from "./ScrollVideoPlayer";

type UnifiedScrollLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function UnifiedScrollLesson({ lesson, sessionId }: UnifiedScrollLessonProps) {
  const {
    getChatState,
    sendChatMessage,
    completedBlocks,
    markBlockCompleted,
    activeBlockId,
    setActiveBlockId,
  } = usePrototypeLesson({ sessionId });

  const [videoPausedForChat, setVideoPausedForChat] = useState<string | null>(null);

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
    // If this chat was from a video pause, resume video
    if (videoPausedForChat === blockId) {
      setVideoPausedForChat(null);
    }
  };

  const renderBlock = (block: ContentBlock, index: number) => {
    const prevBlock = lesson.blocks[index - 1];
    const isAfterChat = prevBlock?.type === "chat";
    const isLocked = isAfterChat && !completedBlocks.has(prevBlock.id);

    switch (block.type) {
      case "markdown":
        return (
          <div
            key={block.id}
            className={`transition-opacity duration-300 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <MarkdownBlock content={block.content} className="max-w-[700px] mx-auto" />
          </div>
        );

      case "video":
        return (
          <div
            key={block.id}
            className={`max-w-[900px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <ScrollVideoPlayer
              videoId={block.videoId}
              start={block.start}
              end={block.end}
              isPaused={videoPausedForChat !== null}
              onEnded={() => markBlockCompleted(block.id)}
            />
          </div>
        );

      case "chat":
        return (
          <div
            key={block.id}
            className="max-w-[700px] mx-auto my-8 border-l-4 border-blue-500 pl-4"
          >
            {block.prompt && (
              <p className="text-gray-600 italic mb-3">{block.prompt}</p>
            )}
            <SimpleChatBox
              chatState={getChatState(block.id)}
              onSendMessage={(content) => sendChatMessage(block.id, content)}
              placeholder="Share your thoughts..."
            />
            {getChatState(block.id).messages.length > 0 && !completedBlocks.has(block.id) && (
              <button
                onClick={() => handleChatComplete(block.id)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Continue reading →
              </button>
            )}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="max-w-[900px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">Prototype A: Unified Scroll</p>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-8">
        <div className="space-y-8">
          {lesson.blocks.map((block, index) => renderBlock(block, index))}
        </div>

        {/* End marker */}
        <div className="max-w-[700px] mx-auto mt-16 pt-8 border-t border-gray-200 text-center">
          <p className="text-gray-500">End of lesson</p>
        </div>
      </main>
    </div>
  );
}
```

### Step 3: Create barrel export

```typescript
// web_frontend/src/components/lesson-prototypes/prototype-a/index.ts

export { UnifiedScrollLesson } from "./UnifiedScrollLesson";
export { ScrollVideoPlayer } from "./ScrollVideoPlayer";
```

### Step 4: Commit Prototype A

```bash
git add src/components/lesson-prototypes/prototype-a/
git commit -m "feat(prototypes): add Prototype A - Unified Scroll

Single scrollable page with:
- Inline markdown sections
- Inline chat checkpoints between content
- Video with chat appearing below when paused

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Build Prototype D - Side-by-Side Video Chat

**Files:**
- Create: `web_frontend/src/components/lesson-prototypes/prototype-d/SideBySideLesson.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/prototype-d/AdaptiveVideoContainer.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/prototype-d/index.ts`

### Step 1: Create AdaptiveVideoContainer that animates width

```tsx
// web_frontend/src/components/lesson-prototypes/prototype-d/AdaptiveVideoContainer.tsx

import { useEffect, useRef, useState } from "react";
import "youtube-video-element";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "youtube-video": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { src?: string; controls?: boolean },
        HTMLElement
      >;
    }
  }
}

type AdaptiveVideoContainerProps = {
  videoId: string;
  start: number;
  end: number;
  checkpoints: number[];
  onCheckpointReached: (timestamp: number) => void;
  onResume: () => void;
  onEnded: () => void;
  isPausedForChat: boolean;
};

export function AdaptiveVideoContainer({
  videoId,
  start,
  end,
  checkpoints,
  onCheckpointReached,
  onResume,
  onEnded,
  isPausedForChat,
}: AdaptiveVideoContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(start);
  const passedCheckpoints = useRef<Set<number>>(new Set());

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${start}`;
  const duration = end - start;
  const progress = Math.min(Math.max((currentTime - start) / duration, 0), 1);

  useEffect(() => {
    if (!containerRef.current) return;

    const video = containerRef.current.querySelector("youtube-video") as HTMLVideoElement | null;
    if (!video) return;
    videoRef.current = video;

    const handleLoadedMetadata = () => {
      video.currentTime = start;
    };

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);

      // Check checkpoints
      for (const cp of checkpoints) {
        if (time >= cp && !passedCheckpoints.current.has(cp) && time < cp + 1) {
          passedCheckpoints.current.add(cp);
          video.pause();
          onCheckpointReached(cp);
          return;
        }
      }

      // Check end
      if (time >= end - 0.5) {
        video.pause();
        onEnded();
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [start, end, checkpoints, onCheckpointReached, onEnded]);

  // Pause/resume based on chat state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPausedForChat && !video.paused) {
      video.pause();
    }
  }, [isPausedForChat]);

  const handleResumeClick = () => {
    const video = videoRef.current;
    if (video) {
      video.play();
      onResume();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`transition-all duration-500 ease-in-out ${
        isPausedForChat ? "w-[60%]" : "w-full"
      }`}
    >
      <div className="aspect-video relative rounded-lg overflow-hidden bg-black">
        <youtube-video src={youtubeUrl} controls className="w-full h-full" />

        {/* Paused overlay with resume button */}
        {isPausedForChat && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <button
              onClick={handleResumeClick}
              className="bg-white/90 hover:bg-white text-gray-800 px-4 py-2 rounded-lg font-medium shadow-lg"
            >
              Resume Video →
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-700 rounded-full mt-2">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
```

### Step 2: Create SideBySideLesson main component

```tsx
// web_frontend/src/components/lesson-prototypes/prototype-d/SideBySideLesson.tsx

import { useState } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import { AdaptiveVideoContainer } from "./AdaptiveVideoContainer";

type SideBySideLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function SideBySideLesson({ lesson, sessionId }: SideBySideLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  // Track which video is showing side-by-side chat
  const [activeVideoChat, setActiveVideoChat] = useState<{
    videoBlockId: string;
    chatBlockId: string;
  } | null>(null);

  const handleVideoCheckpoint = (videoBlockId: string, nextChatBlockId: string) => {
    setActiveVideoChat({ videoBlockId, chatBlockId: nextChatBlockId });
  };

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
    // If this was a video-attached chat, close the side panel
    if (activeVideoChat?.chatBlockId === blockId) {
      setActiveVideoChat(null);
    }
  };

  const renderBlock = (block: ContentBlock, index: number) => {
    const prevBlock = lesson.blocks[index - 1];
    const nextBlock = lesson.blocks[index + 1];
    const isAfterChat = prevBlock?.type === "chat";
    const isLocked = isAfterChat && !completedBlocks.has(prevBlock.id);

    switch (block.type) {
      case "markdown":
        return (
          <div
            key={block.id}
            className={`transition-opacity duration-300 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <MarkdownBlock content={block.content} className="max-w-[700px] mx-auto" />
          </div>
        );

      case "video": {
        const nextChatBlock = nextBlock?.type === "chat" ? nextBlock : null;
        const isShowingSideChat = activeVideoChat?.videoBlockId === block.id;

        return (
          <div
            key={block.id}
            className={`max-w-[1100px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <div className="flex gap-4">
              {/* Video (shrinks when chat is active) */}
              <AdaptiveVideoContainer
                videoId={block.videoId}
                start={block.start}
                end={block.end}
                checkpoints={nextChatBlock ? [block.end - 1] : []}
                onCheckpointReached={() => {
                  if (nextChatBlock) {
                    handleVideoCheckpoint(block.id, nextChatBlock.id);
                  }
                }}
                onResume={() => setActiveVideoChat(null)}
                onEnded={() => markBlockCompleted(block.id)}
                isPausedForChat={isShowingSideChat}
              />

              {/* Side chat panel (slides in) */}
              {isShowingSideChat && nextChatBlock && (
                <div className="w-[40%] animate-slide-in-right">
                  <div className="bg-gray-50 rounded-lg p-4 h-full flex flex-col">
                    {nextChatBlock.prompt && (
                      <p className="text-gray-600 italic mb-3 text-sm">{nextChatBlock.prompt}</p>
                    )}
                    <SimpleChatBox
                      chatState={getChatState(nextChatBlock.id)}
                      onSendMessage={(content) => sendChatMessage(nextChatBlock.id, content)}
                      placeholder="Share your thoughts..."
                      compact
                      className="flex-1"
                    />
                    {getChatState(nextChatBlock.id).messages.length > 0 && (
                      <button
                        onClick={() => handleChatComplete(nextChatBlock.id)}
                        className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        Done discussing →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      case "chat": {
        // Skip if this chat is being shown as side-by-side with video
        if (activeVideoChat?.chatBlockId === block.id) {
          return null;
        }

        // Skip if already completed via side-by-side
        if (completedBlocks.has(block.id)) {
          return null;
        }

        return (
          <div
            key={block.id}
            className="max-w-[700px] mx-auto my-8 border-l-4 border-blue-500 pl-4"
          >
            {block.prompt && <p className="text-gray-600 italic mb-3">{block.prompt}</p>}
            <SimpleChatBox
              chatState={getChatState(block.id)}
              onSendMessage={(content) => sendChatMessage(block.id, content)}
              placeholder="Share your thoughts..."
            />
            {getChatState(block.id).messages.length > 0 && !completedBlocks.has(block.id) && (
              <button
                onClick={() => handleChatComplete(block.id)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Continue reading →
              </button>
            )}
          </div>
        );
      }
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">Prototype D: Side-by-Side Video Chat</p>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-8">
        <div className="space-y-8">
          {lesson.blocks.map((block, index) => renderBlock(block, index))}
        </div>

        {/* End marker */}
        <div className="max-w-[700px] mx-auto mt-16 pt-8 border-t border-gray-200 text-center">
          <p className="text-gray-500">End of lesson</p>
        </div>
      </main>

      {/* Animation styles */}
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
```

### Step 3: Create barrel export

```typescript
// web_frontend/src/components/lesson-prototypes/prototype-d/index.ts

export { SideBySideLesson } from "./SideBySideLesson";
export { AdaptiveVideoContainer } from "./AdaptiveVideoContainer";
```

### Step 4: Commit Prototype D

```bash
git add src/components/lesson-prototypes/prototype-d/
git commit -m "feat(prototypes): add Prototype D - Side-by-Side Video Chat

Video pauses at checkpoint and shrinks to 60% width.
Chat panel slides in from right to fill remaining 40%.
Visual metaphor: 'pausing within the video' for discussion.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Build Prototype B - Sticky Video

**Files:**
- Create: `web_frontend/src/components/lesson-prototypes/prototype-b/StickyVideoLesson.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/prototype-b/index.ts`

### Step 1: Create StickyVideoLesson component

```tsx
// web_frontend/src/components/lesson-prototypes/prototype-b/StickyVideoLesson.tsx

import { useState, useRef, useEffect } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import "youtube-video-element";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "youtube-video": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { src?: string; controls?: boolean },
        HTMLElement
      >;
    }
  }
}

type StickyVideoLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function StickyVideoLesson({ lesson, sessionId }: StickyVideoLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  // Track active video for sticky behavior
  const [activeVideo, setActiveVideo] = useState<{
    videoId: string;
    start: number;
    end: number;
    blockId: string;
  } | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const youtubeUrl = activeVideo
    ? `https://www.youtube.com/watch?v=${activeVideo.videoId}&t=${activeVideo.start}`
    : "";

  // Get video element reference
  useEffect(() => {
    if (!videoContainerRef.current || !activeVideo) return;

    const video = videoContainerRef.current.querySelector("youtube-video") as HTMLVideoElement | null;
    videoRef.current = video;

    if (video) {
      const handleLoadedMetadata = () => {
        video.currentTime = activeVideo.start;
      };
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    }
  }, [activeVideo]);

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
    setActiveChatId(null);

    // Resume video if there was one
    if (videoRef.current) {
      videoRef.current.play();
    }
  };

  const renderBlock = (block: ContentBlock, index: number) => {
    const prevBlock = lesson.blocks[index - 1];
    const isAfterChat = prevBlock?.type === "chat";
    const isLocked = isAfterChat && !completedBlocks.has(prevBlock.id);

    switch (block.type) {
      case "markdown":
        return (
          <div
            key={block.id}
            className={`transition-opacity duration-300 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <MarkdownBlock content={block.content} className="max-w-[700px] mx-auto" />
          </div>
        );

      case "video":
        // When we hit a video block, activate sticky video
        if (!activeVideo || activeVideo.blockId !== block.id) {
          // Render a trigger that activates the video
          return (
            <div
              key={block.id}
              className={`max-w-[700px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
            >
              <button
                onClick={() =>
                  setActiveVideo({
                    videoId: block.videoId,
                    start: block.start,
                    end: block.end,
                    blockId: block.id,
                  })
                }
                className="w-full bg-gray-100 rounded-lg p-8 text-center hover:bg-gray-200 transition-colors"
              >
                <span className="text-4xl">▶️</span>
                <p className="mt-2 text-gray-600">Click to start video section</p>
              </button>
            </div>
          );
        }
        return null;

      case "chat":
        // Only show chat if video is active and this is the next chat
        if (!activeVideo) {
          return (
            <div
              key={block.id}
              className="max-w-[700px] mx-auto my-8 border-l-4 border-blue-500 pl-4"
            >
              {block.prompt && <p className="text-gray-600 italic mb-3">{block.prompt}</p>}
              <SimpleChatBox
                chatState={getChatState(block.id)}
                onSendMessage={(content) => sendChatMessage(block.id, content)}
              />
              {getChatState(block.id).messages.length > 0 && !completedBlocks.has(block.id) && (
                <button
                  onClick={() => handleChatComplete(block.id)}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  Continue →
                </button>
              )}
            </div>
          );
        }

        // Render as a chat point under sticky video
        const isActive = activeChatId === block.id;
        return (
          <div
            key={block.id}
            id={`chat-${block.id}`}
            className={`max-w-[700px] mx-auto my-4 p-4 rounded-lg transition-all ${
              isActive ? "bg-blue-50 border-2 border-blue-300" : "bg-gray-50"
            }`}
            onClick={() => {
              if (!isActive && !completedBlocks.has(block.id)) {
                setActiveChatId(block.id);
                videoRef.current?.pause();
              }
            }}
          >
            {block.prompt && (
              <p className={`italic mb-2 ${isActive ? "text-blue-800" : "text-gray-500"}`}>
                {block.prompt}
              </p>
            )}
            {isActive ? (
              <>
                <SimpleChatBox
                  chatState={getChatState(block.id)}
                  onSendMessage={(content) => sendChatMessage(block.id, content)}
                  compact
                />
                {getChatState(block.id).messages.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleChatComplete(block.id);
                    }}
                    className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
                  >
                    Done →
                  </button>
                )}
              </>
            ) : completedBlocks.has(block.id) ? (
              <p className="text-green-600 text-sm">✓ Completed</p>
            ) : (
              <p className="text-gray-400 text-sm">Click to discuss...</p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-20">
        <div className="max-w-[900px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">Prototype B: Sticky Video</p>
        </div>
      </header>

      {/* Sticky video (when active) */}
      {activeVideo && (
        <div className="sticky top-[65px] z-10 bg-black" ref={videoContainerRef}>
          <div className="max-w-[900px] mx-auto">
            <div className="aspect-video">
              <youtube-video src={youtubeUrl} controls className="w-full h-full" />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="px-6 py-8">
        <div className="space-y-8">
          {lesson.blocks.map((block, index) => renderBlock(block, index))}
        </div>

        {/* Close video button */}
        {activeVideo && (
          <div className="max-w-[700px] mx-auto mt-8">
            <button
              onClick={() => {
                setActiveVideo(null);
                markBlockCompleted(activeVideo.blockId);
              }}
              className="w-full py-3 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-700"
            >
              Finish video section
            </button>
          </div>
        )}

        {/* End marker */}
        <div className="max-w-[700px] mx-auto mt-16 pt-8 border-t border-gray-200 text-center">
          <p className="text-gray-500">End of lesson</p>
        </div>
      </main>
    </div>
  );
}
```

### Step 2: Create barrel export

```typescript
// web_frontend/src/components/lesson-prototypes/prototype-b/index.ts

export { StickyVideoLesson } from "./StickyVideoLesson";
```

### Step 3: Commit Prototype B

```bash
git add src/components/lesson-prototypes/prototype-b/
git commit -m "feat(prototypes): add Prototype B - Sticky Video

Video sticks to top of viewport.
Chat checkpoints scroll below as cards.
Click a card to pause video and discuss.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Build Prototype C - Modal Checkpoints

**Files:**
- Create: `web_frontend/src/components/lesson-prototypes/prototype-c/ModalCheckpointLesson.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/prototype-c/CheckpointModal.tsx`
- Create: `web_frontend/src/components/lesson-prototypes/prototype-c/index.ts`

### Step 1: Create CheckpointModal component

```tsx
// web_frontend/src/components/lesson-prototypes/prototype-c/CheckpointModal.tsx

import type { ChatState } from "../shared/types";
import { SimpleChatBox } from "../shared/SimpleChatBox";

type CheckpointModalProps = {
  isOpen: boolean;
  prompt?: string;
  chatState: ChatState;
  onSendMessage: (content: string) => void;
  onClose: () => void;
};

export function CheckpointModal({
  isOpen,
  prompt,
  chatState,
  onSendMessage,
  onClose,
}: CheckpointModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col animate-modal-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">Let's discuss</h3>
          {prompt && <p className="text-gray-600 text-sm mt-1">{prompt}</p>}
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-hidden">
          <SimpleChatBox
            chatState={chatState}
            onSendMessage={onSendMessage}
            placeholder="Share your thoughts..."
            className="h-full"
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            disabled={chatState.messages.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue watching →
          </button>
        </div>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .animate-modal-in {
          animation: modalIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
```

### Step 2: Create ModalCheckpointLesson component

```tsx
// web_frontend/src/components/lesson-prototypes/prototype-c/ModalCheckpointLesson.tsx

import { useState, useRef, useEffect } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import { CheckpointModal } from "./CheckpointModal";
import "youtube-video-element";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "youtube-video": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { src?: string; controls?: boolean },
        HTMLElement
      >;
    }
  }
}

type ModalCheckpointLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function ModalCheckpointLesson({ lesson, sessionId }: ModalCheckpointLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  const [modalChat, setModalChat] = useState<{
    blockId: string;
    prompt?: string;
  } | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const handleVideoCheckpoint = (chatBlockId: string, prompt?: string) => {
    setModalChat({ blockId: chatBlockId, prompt });
  };

  const handleModalClose = () => {
    if (modalChat) {
      markBlockCompleted(modalChat.blockId);
    }
    setModalChat(null);

    // Resume any paused videos
    videoRefs.current.forEach((video) => {
      if (video.paused) video.play();
    });
  };

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
  };

  const renderBlock = (block: ContentBlock, index: number) => {
    const prevBlock = lesson.blocks[index - 1];
    const nextBlock = lesson.blocks[index + 1];
    const isAfterChat = prevBlock?.type === "chat";
    const isLocked = isAfterChat && !completedBlocks.has(prevBlock.id);

    switch (block.type) {
      case "markdown":
        return (
          <div
            key={block.id}
            className={`transition-opacity duration-300 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <MarkdownBlock content={block.content} className="max-w-[700px] mx-auto" />
          </div>
        );

      case "video": {
        const nextChatBlock = nextBlock?.type === "chat" ? nextBlock : null;
        const youtubeUrl = `https://www.youtube.com/watch?v=${block.videoId}&t=${block.start}`;

        return (
          <div
            key={block.id}
            className={`max-w-[900px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <VideoWithCheckpoint
              blockId={block.id}
              youtubeUrl={youtubeUrl}
              start={block.start}
              end={block.end}
              onCheckpoint={() => {
                if (nextChatBlock) {
                  handleVideoCheckpoint(nextChatBlock.id, nextChatBlock.prompt);
                }
              }}
              onEnded={() => markBlockCompleted(block.id)}
              registerRef={(el) => {
                if (el) videoRefs.current.set(block.id, el);
              }}
            />
          </div>
        );
      }

      case "chat":
        // Skip if this chat is triggered by video (shown in modal)
        const prevIsVideo = prevBlock?.type === "video";
        if (prevIsVideo) {
          return null;
        }

        return (
          <div
            key={block.id}
            className="max-w-[700px] mx-auto my-8 border-l-4 border-blue-500 pl-4"
          >
            {block.prompt && <p className="text-gray-600 italic mb-3">{block.prompt}</p>}
            <SimpleChatBox
              chatState={getChatState(block.id)}
              onSendMessage={(content) => sendChatMessage(block.id, content)}
            />
            {getChatState(block.id).messages.length > 0 && !completedBlocks.has(block.id) && (
              <button
                onClick={() => handleChatComplete(block.id)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Continue →
              </button>
            )}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="max-w-[900px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">Prototype C: Modal Checkpoints</p>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-8">
        <div className="space-y-8">
          {lesson.blocks.map((block, index) => renderBlock(block, index))}
        </div>

        {/* End marker */}
        <div className="max-w-[700px] mx-auto mt-16 pt-8 border-t border-gray-200 text-center">
          <p className="text-gray-500">End of lesson</p>
        </div>
      </main>

      {/* Chat modal */}
      {modalChat && (
        <CheckpointModal
          isOpen={true}
          prompt={modalChat.prompt}
          chatState={getChatState(modalChat.blockId)}
          onSendMessage={(content) => sendChatMessage(modalChat.blockId, content)}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}

// Helper component for video with checkpoint detection
function VideoWithCheckpoint({
  blockId,
  youtubeUrl,
  start,
  end,
  onCheckpoint,
  onEnded,
  registerRef,
}: {
  blockId: string;
  youtubeUrl: string;
  start: number;
  end: number;
  onCheckpoint: () => void;
  onEnded: () => void;
  registerRef: (el: HTMLVideoElement | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const checkpointFired = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const video = containerRef.current.querySelector("youtube-video") as HTMLVideoElement | null;
    if (!video) return;

    registerRef(video);

    const handleLoadedMetadata = () => {
      video.currentTime = start;
    };

    const handleTimeUpdate = () => {
      const time = video.currentTime;

      // Fire checkpoint near end
      if (time >= end - 2 && !checkpointFired.current) {
        checkpointFired.current = true;
        video.pause();
        onCheckpoint();
      }

      // Fire ended
      if (time >= end - 0.5) {
        video.pause();
        onEnded();
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      registerRef(null);
    };
  }, [start, end, onCheckpoint, onEnded, registerRef]);

  return (
    <div ref={containerRef} className="aspect-video rounded-lg overflow-hidden">
      <youtube-video src={youtubeUrl} controls className="w-full h-full" />
    </div>
  );
}
```

### Step 3: Create barrel export

```typescript
// web_frontend/src/components/lesson-prototypes/prototype-c/index.ts

export { ModalCheckpointLesson } from "./ModalCheckpointLesson";
export { CheckpointModal } from "./CheckpointModal";
```

### Step 4: Commit Prototype C

```bash
git add src/components/lesson-prototypes/prototype-c/
git commit -m "feat(prototypes): add Prototype C - Modal Checkpoints

Video pauses near checkpoint and modal overlay appears.
Chat happens inside modal (EdPuzzle-style).
Dismiss modal to resume video.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Create Routes for Prototypes

**Files:**
- Create: `web_frontend/src/pages/PrototypeLessonPage.tsx`
- Modify: `web_frontend/src/App.tsx` (add routes)

### Step 1: Create PrototypeLessonPage

```tsx
// web_frontend/src/pages/PrototypeLessonPage.tsx

import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { UnifiedScrollLesson } from "../components/lesson-prototypes/prototype-a";
import { StickyVideoLesson } from "../components/lesson-prototypes/prototype-b";
import { ModalCheckpointLesson } from "../components/lesson-prototypes/prototype-c";
import { SideBySideLesson } from "../components/lesson-prototypes/prototype-d";
import { testLesson } from "../components/lesson-prototypes/testLessonData";
import { createSession } from "../api/lessons";

export default function PrototypeLessonPage() {
  const { prototype } = useParams<{ prototype: string }>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create a session for the test lesson
  useEffect(() => {
    createSession("introduction")
      .then(setSessionId)
      .catch((err) => {
        console.error("Failed to create session:", err);
        setError("Failed to create session. Chat features will be limited.");
      });
  }, []);

  const renderPrototype = () => {
    switch (prototype) {
      case "a":
        return <UnifiedScrollLesson lesson={testLesson} sessionId={sessionId} />;
      case "b":
        return <StickyVideoLesson lesson={testLesson} sessionId={sessionId} />;
      case "c":
        return <ModalCheckpointLesson lesson={testLesson} sessionId={sessionId} />;
      case "d":
        return <SideBySideLesson lesson={testLesson} sessionId={sessionId} />;
      default:
        return (
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-4">Unknown Prototype</h1>
              <p className="text-gray-600 mb-4">Choose a prototype:</p>
              <div className="space-y-2">
                <a href="/prototype/a" className="block text-blue-600 hover:underline">
                  Prototype A: Unified Scroll
                </a>
                <a href="/prototype/b" className="block text-blue-600 hover:underline">
                  Prototype B: Sticky Video
                </a>
                <a href="/prototype/c" className="block text-blue-600 hover:underline">
                  Prototype C: Modal Checkpoints
                </a>
                <a href="/prototype/d" className="block text-blue-600 hover:underline">
                  Prototype D: Side-by-Side
                </a>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      {error && (
        <div className="fixed top-0 left-0 right-0 bg-yellow-100 text-yellow-800 px-4 py-2 text-sm text-center z-50">
          {error}
        </div>
      )}
      {renderPrototype()}
    </>
  );
}
```

### Step 2: Add routes to App.tsx

Find the routes section in `web_frontend/src/App.tsx` and add:

```tsx
// Add this import at the top
import PrototypeLessonPage from "./pages/PrototypeLessonPage";

// Add this route alongside other routes (inside the Routes component)
<Route path="/prototype/:prototype?" element={<PrototypeLessonPage />} />
```

### Step 3: Commit routes

```bash
git add src/pages/PrototypeLessonPage.tsx src/App.tsx
git commit -m "feat(prototypes): add routes for lesson UX prototypes

Routes:
- /prototype/a - Unified Scroll
- /prototype/b - Sticky Video
- /prototype/c - Modal Checkpoints
- /prototype/d - Side-by-Side

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Manual Testing

### Step 1: Start dev server

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform
python main.py --dev
```

### Step 2: Test each prototype

Open in browser:
- http://localhost:5173/prototype/a
- http://localhost:5173/prototype/b
- http://localhost:5173/prototype/c
- http://localhost:5173/prototype/d

### Step 3: Verify each prototype works

For each prototype, verify:
1. Markdown content renders correctly
2. Videos load and play
3. Chat input works (if session created)
4. Checkpoints trigger at expected times
5. Layout matches the design intent

---

## Summary

| Task | Description | Est. Size |
|------|-------------|-----------|
| 1 | Shared infrastructure (types, hooks, components) | Medium |
| 2 | Test lesson data | Small |
| 3 | Prototype A - Unified Scroll | Medium |
| 4 | Prototype D - Side-by-Side | Medium |
| 5 | Prototype B - Sticky Video | Medium |
| 6 | Prototype C - Modal Checkpoints | Medium |
| 7 | Routes and page | Small |
| 8 | Manual testing | Small |

**Total: 8 tasks**

All prototypes share the same test lesson data and backend API. The key differences are in layout and how video checkpoints trigger chat interactions.
