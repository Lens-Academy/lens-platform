/**
 * ChatMessageList — shared message rendering for all chat surfaces
 * (ChatInlineShell, ChatSidebar, ReflectionChatDialog).
 *
 * Handles message roles:
 *   - "user"           → gray bubble, right-aligned
 *   - "assistant"      → plain text, labeled "Tutor"
 *   - "system"         → centered pill (progress markers)
 *   - "course-content" → plain text, labeled "Lens" (authored opening questions)
 *   - "tool"           → collapsible panel (or calling indicator if content empty)
 */

import { useState, useLayoutEffect, useRef, type ReactNode } from "react";
import type { ChatMessage, PendingMessage } from "@/types/module";
import { StageIcon } from "@/components/StageIcon";
import { ChatMarkdown } from "./ChatMarkdown";
import { Bot, BookOpen, Check, Search, ChevronRight } from "lucide-react";

const USER_MSG_MAX_HEIGHT = 200;

/** User message bubble that collapses when content exceeds max height. */
function UserMessageBubble({ content }: { content: string }) {
  const textRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    if (textRef.current) {
      setOverflows(textRef.current.scrollHeight > USER_MSG_MAX_HEIGHT);
    }
  }, [content]);

  const collapsed = overflows && !expanded;

  return (
    <div className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 rounded-2xl overflow-hidden">
      <div className="relative">
        <div
          ref={textRef}
          className="whitespace-pre-wrap p-3"
          style={collapsed ? { maxHeight: USER_MSG_MAX_HEIGHT, overflow: "hidden" } : undefined}
        >
          {content}
        </div>
        {collapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-gray-100 to-transparent pointer-events-none" />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          className="w-full text-xs text-gray-500 hover:text-gray-700 py-1.5 cursor-pointer"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

const TOOL_CALLING_LABELS: Record<string, string> = {
  search_alignment_research: "Searching alignment research\u2026",
};

const TOOL_DONE_LABELS: Record<string, string> = {
  search_alignment_research: "Searched alignment research",
};

/** Collapsible panel for a tool call result. */
function ToolResultPanel({
  msg,
}: {
  msg: { role: "tool"; name: string; content: string };
}) {
  const label = TOOL_DONE_LABELS[msg.name] ?? "Tool completed";
  return (
    <details className="my-3 rounded-lg border border-gray-200 bg-gray-50 text-sm">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <Check size={14} className="text-green-600 shrink-0" />
        <span className="text-gray-700">{label}</span>
        <ChevronRight
          size={14}
          className="ml-auto text-gray-400 shrink-0 transition-transform duration-200 [[open]>summary>&]:rotate-90"
        />
      </summary>
      <div className="px-3 pb-2 text-xs text-gray-600">
        <div className="font-medium text-gray-500 mb-0.5">Result</div>
        <pre className="bg-white rounded p-2 overflow-x-auto border border-gray-100 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {msg.content}
        </pre>
      </div>
    </details>
  );
}

/** Live indicator for an in-progress tool call. */
function ToolCallingIndicator({ name }: { name: string }) {
  const label = TOOL_CALLING_LABELS[name] ?? "Using tool\u2026";
  return (
    <div className="my-3 rounded-lg border border-gray-200 bg-gray-50 text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Search size={14} className="animate-pulse text-gray-500 shrink-0" />
        <span className="text-gray-500">{label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared rendering pipeline — used by both ChatMessageList and ChatInlineShell
// ---------------------------------------------------------------------------

/**
 * Backward-scan from `index` in `allMessages`, skipping hidden messages
 * (empty assistant+tool_calls, empty assistant). Returns the role of the
 * previous *visible* message, or undefined if none.
 */
function getPrevVisibleRole(
  allMessages: ChatMessage[],
  index: number,
): string | undefined {
  for (let j = index - 1; j >= 0; j--) {
    const m = allMessages[j];
    if (m.role === "assistant" && m.tool_calls && !m.content?.trim()) continue;
    if (m.role === "assistant" && !m.content?.trim()) continue;
    return m.role;
  }
  return undefined;
}

type RenderMessagesOpts = {
  isLoading?: boolean;
  pendingMessage?: PendingMessage | null;
  onRetryMessage?: () => void;
  keyPrefix?: string;
};

/**
 * Renders a slice of messages with correct prevVisibleRole tracking,
 * thinking indicator, and pending message. Returns a ReactNode[].
 *
 * @param messages   The slice of messages to render
 * @param allMessages The full messages array (for cross-split prevRole lookups)
 * @param startIndexInAll Offset of messages[0] within allMessages
 * @param opts       Optional rendering options
 */
export function renderMessages(
  messages: ChatMessage[],
  allMessages: ChatMessage[],
  startIndexInAll: number,
  opts?: RenderMessagesOpts,
): ReactNode[] {
  const { isLoading, pendingMessage, onRetryMessage, keyPrefix = "" } =
    opts ?? {};
  const nodes: ReactNode[] = [];

  for (let i = 0; i < messages.length; i++) {
    const absIdx = startIndexInAll + i;
    const prevRole = getPrevVisibleRole(allMessages, absIdx);
    const key = keyPrefix ? `${keyPrefix}-${absIdx}` : absIdx;
    nodes.push(renderMessage(messages[i], key, prevRole));
  }

  // Thinking indicator: last message is empty assistant while loading
  if (isLoading && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (
      lastMsg?.role === "assistant" &&
      !lastMsg.content?.trim() &&
      !("tool_calls" in lastMsg && lastMsg.tool_calls)
    ) {
      const lastAbsIdx = startIndexInAll + messages.length - 1;
      const thinkingPrevRole = getPrevVisibleRole(allMessages, lastAbsIdx);
      const showLabel =
        thinkingPrevRole !== "assistant" && thinkingPrevRole !== "tool";
      nodes.push(
        <div key={`${keyPrefix}-thinking`} className="text-gray-800">
          {showLabel && (
            <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
              <Bot size={13} />
              Tutor
            </div>
          )}
          <div>Thinking...</div>
        </div>,
      );
    }
  }

  // Pending message (failed send with retry)
  if (pendingMessage) {
    nodes.push(
      <div
        key={`${keyPrefix}-pending`}
        className={`ml-auto max-w-[80%] p-3 rounded-2xl ${
          pendingMessage.status === "failed"
            ? "bg-red-50 border border-red-200"
            : "bg-gray-100"
        }`}
      >
        {pendingMessage.status === "failed" && onRetryMessage && (
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={onRetryMessage}
              className="text-red-600 hover:text-red-700 text-xs focus:outline-none focus:underline ml-auto"
            >
              Failed - Click to retry
            </button>
          </div>
        )}
        <div className="whitespace-pre-wrap text-gray-800">
          {pendingMessage.content}
        </div>
      </div>,
    );
  }

  return nodes;
}

type ChatMessageListProps = {
  messages: ChatMessage[];
  pendingMessage?: PendingMessage | null;
  isLoading?: boolean;
  onRetryMessage?: () => void;
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

export function renderMessage(
  msg: ChatMessage,
  key: string | number,
  prevRole?: string,
) {
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

  if (msg.role === "tool") {
    // Empty content = tool call in progress ("calling" state)
    if (!msg.content) {
      return <ToolCallingIndicator key={key} name={msg.name} />;
    }
    return <ToolResultPanel key={key} msg={msg} />;
  }

  if (msg.role === "assistant") {
    // Skip assistant messages that only contain tool_calls with no text
    if (msg.tool_calls && !msg.content?.trim()) {
      return null;
    }
    // Skip empty assistant messages (streaming placeholder before text arrives)
    if (!msg.content?.trim()) {
      return null;
    }
    // Show "Tutor" label only on the first assistant message in a turn.
    // Continuation messages after tool calls (prev = "assistant" or "tool") skip the label.
    const showLabel = prevRole !== "assistant" && prevRole !== "tool";
    return (
      <div key={key} className="text-gray-800">
        {showLabel && (
          <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
            <Bot size={13} />
            Tutor
          </div>
        )}
        <ChatMarkdown>{msg.content}</ChatMarkdown>
      </div>
    );
  }

  // user
  return <UserMessageBubble key={key} content={msg.content} />;
}

export function ChatMessageList({
  messages,
  pendingMessage,
  isLoading,
  onRetryMessage,
  startIndex = 0,
  containerRef,
  onScroll,
  wrapperStartIdx,
  wrapperMinHeight,
  minHeightWrapperRef,
}: ChatMessageListProps) {
  const visibleMessages = messages.slice(startIndex);
  const useWrapper = wrapperStartIdx != null;
  let splitAt = useWrapper
    ? wrapperStartIdx - startIndex
    : visibleMessages.length;
  // Skip system messages at the split point so they stay above the wrapper
  if (useWrapper) {
    while (
      splitAt < visibleMessages.length &&
      visibleMessages[splitAt]?.role === "system"
    ) {
      splitAt++;
    }
  }

  const tailOpts: RenderMessagesOpts = {
    isLoading,
    pendingMessage,
    onRetryMessage,
    keyPrefix: "sb",
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 text-[15px] leading-relaxed"
      style={{ overflowAnchor: "none" }}
      onScroll={onScroll}
    >
      {useWrapper ? (
        <>
          {renderMessages(
            visibleMessages.slice(0, splitAt),
            messages,
            startIndex,
          )}
          <div
            ref={minHeightWrapperRef}
            className="flex flex-col space-y-4"
            style={{
              minHeight: wrapperMinHeight ? `${wrapperMinHeight}px` : undefined,
            }}
          >
            {renderMessages(
              visibleMessages.slice(splitAt),
              messages,
              startIndex + splitAt,
              tailOpts,
            )}
            <div className="flex-grow" />
          </div>
        </>
      ) : (
        renderMessages(visibleMessages, messages, startIndex, tailOpts)
      )}
    </div>
  );
}
