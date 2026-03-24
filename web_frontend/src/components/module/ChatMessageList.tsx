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

import type { ChatMessage, PendingMessage } from "@/types/module";
import { StageIcon } from "@/components/module/StageProgressBar";
import { ChatMarkdown } from "./ChatMarkdown";
import { Bot, BookOpen, Check, Search, ChevronDown } from "lucide-react";

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
        <ChevronDown size={14} className="ml-auto text-gray-400 shrink-0" />
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

type ChatMessageListProps = {
  messages: ChatMessage[];
  pendingMessage?: PendingMessage | null;
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

export function renderMessage(msg: ChatMessage, key: string | number, prevRole?: string) {
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

  // Thinking indicator: show when loading and last message is an empty assistant
  const lastMsg = visibleMessages[visibleMessages.length - 1];
  const showThinking =
    isLoading &&
    lastMsg?.role === "assistant" &&
    !lastMsg.content?.trim() &&
    !("tool_calls" in lastMsg && lastMsg.tool_calls);

  // Check if the Thinking indicator should show the "Tutor" label
  // (suppress if previous visible message is assistant or tool — continuation of same turn)
  let thinkingPrevRole: string | undefined;
  if (showThinking) {
    for (let j = messages.length - 2; j >= 0; j--) {
      const m = messages[j];
      if (m.role === "assistant" && m.tool_calls && !m.content?.trim()) continue;
      if (m.role === "assistant" && !m.content?.trim()) continue;
      thinkingPrevRole = m.role;
      break;
    }
  }
  const thinkingShowLabel = thinkingPrevRole !== "assistant" && thinkingPrevRole !== "tool";

  const thinkingEl = showThinking && (
    <div className="text-gray-800">
      {thinkingShowLabel && (
        <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
          <Bot size={13} />
          Tutor
        </div>
      )}
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
        .map((msg, i) => {
          // Find previous VISIBLE message's role (skip hidden ones like empty assistant+tool_calls)
          let prevVisibleRole: string | undefined;
          for (let j = startIndex + i - 1; j >= 0; j--) {
            const m = messages[j];
            if (m.role === "assistant" && m.tool_calls && !m.content?.trim()) continue;
            if (m.role === "assistant" && !m.content?.trim()) continue;
            prevVisibleRole = m.role;
            break;
          }
          return renderMessage(msg, startIndex + i, prevVisibleRole);
        })}

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
            .map((msg, i) => {
              const absIdx = startIndex + splitAt + i;
              let prevVisibleRole: string | undefined;
              for (let j = absIdx - 1; j >= 0; j--) {
                const m = messages[j];
                if (m.role === "assistant" && m.tool_calls && !m.content?.trim()) continue;
                if (m.role === "assistant" && !m.content?.trim()) continue;
                prevVisibleRole = m.role;
                break;
              }
              return renderMessage(msg, absIdx, prevVisibleRole);
            })}
          {pendingEl}
          {thinkingEl}
          <div className="flex-grow" />
        </div>
      ) : (
        <>
          {pendingEl}
          {thinkingEl}
        </>
      )}
    </div>
  );
}
