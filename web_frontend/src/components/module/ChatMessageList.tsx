/**
 * ChatMessageList — shared message rendering for all chat surfaces
 * (NarrativeChatSection, ChatSidebar, ReflectionChatDialog).
 *
 * Handles all four message roles:
 *   - "user"           → gray bubble, right-indented
 *   - "assistant"      → blue bubble, labeled "Tutor"
 *   - "system"         → centered pill (progress markers)
 *   - "course-content" → amber bubble, labeled "Lens" (authored opening questions)
 */

import type { ChatMessage, PendingMessage } from "@/types/module";
import { StageIcon } from "@/components/module/StageProgressBar";
import { ChatMarkdown } from "./ChatMarkdown";

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
};

function renderMessage(msg: ChatMessage, key: string | number) {
  if (msg.role === "system") {
    return (
      <div key={key} className="flex justify-center my-3">
        <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
          {msg.icon && <StageIcon type={msg.icon} small />}
          {msg.content}
        </span>
      </div>
    );
  }

  if (msg.role === "course-content") {
    return (
      <div key={key} className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-gray-800">
        <div className="text-xs font-medium text-amber-700 mb-1 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Lens
        </div>
        <div>
          <ChatMarkdown>{msg.content}</ChatMarkdown>
        </div>
      </div>
    );
  }

  // user or assistant
  return (
    <div
      key={key}
      className={`p-3 rounded-lg ${
        msg.role === "assistant"
          ? "bg-blue-50 text-gray-800"
          : "bg-gray-100 text-gray-800 ml-8"
      }`}
    >
      <div className="text-xs text-gray-500 mb-1">
        {msg.role === "assistant" ? "Tutor" : "You"}
      </div>
      <div className={msg.role === "assistant" ? "" : "whitespace-pre-wrap"}>
        {msg.role === "assistant" ? (
          <ChatMarkdown>{msg.content}</ChatMarkdown>
        ) : (
          msg.content
        )}
      </div>
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
}: ChatMessageListProps) {
  const visibleMessages = messages.slice(startIndex);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4"
      style={{ overflowAnchor: "none" }}
      onScroll={onScroll}
    >
      {visibleMessages.map((msg, i) => renderMessage(msg, startIndex + i))}

      {/* Pending user message */}
      {pendingMessage && (
        <div
          className={`p-3 rounded-lg ml-8 ${
            pendingMessage.status === "failed"
              ? "bg-red-50 border border-red-200"
              : "bg-gray-100"
          }`}
        >
          <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
            <span>You</span>
            {pendingMessage.status === "sending" && (
              <span className="text-gray-400">Sending...</span>
            )}
          </div>
          <div className="whitespace-pre-wrap text-gray-800">
            {pendingMessage.content}
          </div>
        </div>
      )}

      {/* Streaming assistant response */}
      {isLoading && streamingContent && (
        <div className="bg-blue-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Tutor</div>
          <div>
            <ChatMarkdown>{streamingContent}</ChatMarkdown>
          </div>
        </div>
      )}

      {/* Loading indicator (before first streaming token) */}
      {isLoading && !streamingContent && (
        <div className="bg-blue-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Tutor</div>
          <div className="text-gray-800">Thinking...</div>
        </div>
      )}
    </div>
  );
}
