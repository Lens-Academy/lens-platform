/**
 * ChatMessageList — shared message rendering for all chat surfaces
 * (ChatInlineShell, ChatSidebar, ReflectionChatDialog).
 *
 * Handles message roles:
 *   - "user"           → gray bubble, right-aligned
 *   - "assistant"      → plain text, labeled "Tutor"
 *   - "system"         → centered pill (progress markers)
 *   - "course-content" → plain text, labeled "Lens" (authored opening questions)
 *   - "tool"           → collapsible panel showing tool input/output
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

/** Collapsible panel for a tool call result (from DB history). */
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

/** Live streaming indicator for an in-progress tool call. */
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
  streamingContent?: string;
  isLoading?: boolean;
  /** Live tool call indicator (only during streaming) */
  activeToolCall?: { name: string; state: string } | null;
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
  /** Character offset in streamingContent where tool call was inserted.
   *  When set, streaming content is split: [0..point] | toolIndicator | [point..] */
  toolCallInsertPoint?: number | null;
  /** Completed tool calls accumulated during streaming (rendered as panels).
   *  Each entry includes its position in streamingContent for correct placement. */
  completedToolCalls?: Array<{ name: string; insertPoint: number }>;
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

  if (msg.role === "tool") {
    return <ToolResultPanel key={key} msg={msg} />;
  }

  if (msg.role === "assistant") {
    // Skip assistant messages that only contain tool_calls with no text
    if (msg.tool_calls && !msg.content?.trim()) {
      return null;
    }
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
  activeToolCall,
  startIndex = 0,
  containerRef,
  onScroll,
  wrapperStartIdx,
  wrapperMinHeight,
  minHeightWrapperRef,
  toolCallInsertPoint,
  completedToolCalls,
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

  const isToolCalling = activeToolCall?.state === "calling";

  const toolIndicator = activeToolCall && (
    isToolCalling
      ? <ToolCallingIndicator name={activeToolCall.name} />
      : <ToolResultPanel msg={{ role: "tool" as const, name: activeToolCall.name, content: "" }} />
  );

  // Build interleaved segments: text → tool panel → text → tool panel → ...
  // Each tool call (completed + active) has an insert point in streamingContent.
  const streamingSegments = (() => {
    if (!streamingContent && !activeToolCall) return null;

    type ToolEntry = { name: string; insertPoint: number; isActive: boolean; isCalling: boolean };
    const allTools: ToolEntry[] = [
      ...(completedToolCalls ?? []).map((tc) => ({
        name: tc.name,
        insertPoint: tc.insertPoint,
        isActive: false,
        isCalling: false,
      })),
      ...(activeToolCall && toolCallInsertPoint != null
        ? [{
            name: activeToolCall.name,
            insertPoint: toolCallInsertPoint,
            isActive: true,
            isCalling: activeToolCall.state === "calling",
          }]
        : []),
    ];

    if (!allTools.length) {
      // No tool calls — render all content, then indicator if active
      return (
        <>
          {streamingContent && <ChatMarkdown>{streamingContent}</ChatMarkdown>}
          {toolIndicator}
        </>
      );
    }

    // Sort by insert point position
    allTools.sort((a, b) => a.insertPoint - b.insertPoint);

    const elements: React.ReactNode[] = [];
    let cursor = 0;

    for (let i = 0; i < allTools.length; i++) {
      const tool = allTools[i];
      // Text segment before this tool
      if (streamingContent && tool.insertPoint > cursor) {
        const segment = streamingContent.slice(cursor, tool.insertPoint);
        if (segment) elements.push(<ChatMarkdown key={`text-${i}`}>{segment}</ChatMarkdown>);
      }
      cursor = tool.insertPoint;
      // Tool panel
      if (tool.isCalling) {
        elements.push(<ToolCallingIndicator key={`tool-${i}`} name={tool.name} />);
      } else {
        elements.push(
          <ToolResultPanel key={`tool-${i}`} msg={{ role: "tool" as const, name: tool.name, content: "" }} />,
        );
      }
    }

    // Remaining text after all tools
    if (streamingContent && cursor < streamingContent.length) {
      const remaining = streamingContent.slice(cursor);
      if (remaining) elements.push(<ChatMarkdown key="text-final">{remaining}</ChatMarkdown>);
    }

    return <>{elements}</>;
  })();

  const streamingEl = isLoading && (streamingContent || activeToolCall) && (
    <div className="text-gray-800">
      <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
        <Bot size={13} />
        Tutor
      </div>
      {streamingSegments}
    </div>
  );

  const thinkingEl = isLoading && !streamingContent && !activeToolCall && (
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
