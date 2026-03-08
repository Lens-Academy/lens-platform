/**
 * ChatMessageList — shared message rendering for all chat surfaces
 * (ChatInlineShell, ChatSidebar, ReflectionChatDialog).
 *
 * Handles all four message roles:
 *   - "user"           → gray bubble, right-aligned
 *   - "assistant"      → plain text, labeled "Tutor"
 *   - "system"         → centered pill (progress markers)
 *   - "course-content" → plain text, labeled "Lens" (authored opening questions)
 */

import type { ChatMessage, PendingMessage } from "@/types/module";
import { StageIcon } from "@/components/module/StageProgressBar";
import { ChatMarkdown } from "./ChatMarkdown";
import { Bot, BookOpen } from "lucide-react";

type ChatMessageListProps = {
  messages: ChatMessage[];
  pendingMessage?: PendingMessage | null;
  streamingContent?: string;
  isLoading?: boolean;
  /** Optional: only render messages from this index onward */
  startIndex?: number;
  /** Ref for the message list container */
  containerRef?: React.Ref<HTMLDivElement>;
  /** Called when the scroll container scrolls */
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  /** When set, splits messages at this index into a min-height wrapper */
  wrapperStartIdx?: number | null;
  /** Min-height for the wrapper div (px) */
  wrapperMinHeight?: number;
  /** Ref for the min-height wrapper (used for scrollIntoView) */
  minHeightWrapperRef?: React.Ref<HTMLDivElement>;
};

export function renderMessage(msg: ChatMessage, key: string | number) {
  if (msg.role === "system") {
    return (
      <div key={key} className="flex justify-center my-3">
        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
          {msg.icon && <StageIcon type={msg.icon} small />}
          {msg.content}
        </span>
      </div>
    );
  }

  if (msg.role === "course-content") {
    return (
      <div key={key} className="text-gray-800">
        <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
          <BookOpen size={13} />
          Lens
        </div>
        <ChatMarkdown>{msg.content}</ChatMarkdown>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div key={key} className="text-gray-800">
        <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
          <Bot size={13} />
          Tutor
        </div>
        <ChatMarkdown>{msg.content}</ChatMarkdown>
      </div>
    );
  }

  // user
  return (
    <div
      key={key}
      className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
    >
      <div className="whitespace-pre-wrap">{msg.content}</div>
    </div>
  );
}

export function ChatMessageList({
  messages,
  pendingMessage,
  streamingContent,
  isLoading,
  startIndex = 0,
  containerRef,
  onScroll,
  wrapperStartIdx,
  wrapperMinHeight,
  minHeightWrapperRef,
}: ChatMessageListProps) {
  const visibleMessages = messages.slice(startIndex);
  const useWrapper = wrapperStartIdx != null;
  const splitAt = useWrapper
    ? wrapperStartIdx - startIndex
    : visibleMessages.length;

  const pendingEl = pendingMessage && (
    <div
      className={`ml-auto max-w-[80%] p-3 rounded-2xl ${
        pendingMessage.status === "failed"
          ? "bg-red-50 border border-red-200"
          : "bg-gray-100"
      }`}
    >
      {pendingMessage.status === "failed" && (
        <div className="text-xs text-red-500 mb-1">Failed to send</div>
      )}
      <div className="whitespace-pre-wrap text-gray-800">
        {pendingMessage.content}
      </div>
    </div>
  );

  const streamingEl = isLoading && streamingContent && (
    <div className="text-gray-800">
      <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
        <Bot size={13} />
        Tutor
      </div>
      <ChatMarkdown>{streamingContent}</ChatMarkdown>
    </div>
  );

  const thinkingEl = isLoading && !streamingContent && (
    <div className="text-gray-800">
      <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
        <Bot size={13} />
        Tutor
      </div>
      <div>Thinking...</div>
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 text-[15px] leading-relaxed"
      style={{ overflowAnchor: "none" }}
      onScroll={onScroll}
    >
      {visibleMessages
        .slice(0, splitAt)
        .map((msg, i) => renderMessage(msg, startIndex + i))}

      {useWrapper ? (
        <div
          ref={minHeightWrapperRef}
          className="flex flex-col space-y-4"
          style={{
            minHeight: wrapperMinHeight ? `${wrapperMinHeight}px` : undefined,
          }}
        >
          {visibleMessages
            .slice(splitAt)
            .map((msg, i) => renderMessage(msg, startIndex + splitAt + i))}
          {pendingEl}
          {streamingEl}
          {thinkingEl}
          <div className="flex-grow" />
        </div>
      ) : (
        <>
          {pendingEl}
          {streamingEl}
          {thinkingEl}
        </>
      )}
    </div>
  );
}
