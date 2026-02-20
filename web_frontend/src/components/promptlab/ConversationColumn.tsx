import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import ChatMarkdown from "@/components/ChatMarkdown";
import { useConversationSlot } from "@/hooks/useConversationSlot";
import type { ConversationMessage } from "@/hooks/useConversationSlot";

export interface ConversationColumnHandle {
  regenerate: () => Promise<void>;
  autoSelectLastAssistant: () => void;
}

interface ConversationColumnProps {
  initialMessages: ConversationMessage[];
  label: string;
  systemPrompt: string;
  enableThinking: boolean;
  effort: string;
}

const ConversationColumn = forwardRef<ConversationColumnHandle, ConversationColumnProps>(
  function ConversationColumn({ initialMessages, label, systemPrompt, enableThinking, effort }, ref) {
    const slot = useConversationSlot(initialMessages);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [userScrolledUp, setUserScrolledUp] = useState(false);
    const [followUpInput, setFollowUpInput] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Expose regenerate to parent for "Regenerate All"
    const systemPromptRef = useRef(systemPrompt);
    const enableThinkingRef = useRef(enableThinking);
    const effortRef = useRef(effort);
    systemPromptRef.current = systemPrompt;
    enableThinkingRef.current = enableThinking;
    effortRef.current = effort;

    useImperativeHandle(ref, () => ({
      regenerate: () =>
        slot.regenerate(systemPromptRef.current, enableThinkingRef.current, effortRef.current),
      autoSelectLastAssistant: () => {
        const lastIdx = slot.messages.findLastIndex((m) => m.role === "assistant");
        if (lastIdx >= 0) slot.selectMessage(lastIdx);
      },
    }));

    // Toggle tracking for originals and thinking
    const [expandedOriginals, setExpandedOriginals] = useState<Set<number>>(new Set());
    const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());

    function toggleOriginal(index: number) {
      setExpandedOriginals((prev) => {
        const next = new Set(prev);
        next.has(index) ? next.delete(index) : next.add(index);
        return next;
      });
    }

    function toggleThinking(index: number) {
      setExpandedThinking((prev) => {
        const next = new Set(prev);
        next.has(index) ? next.delete(index) : next.add(index);
        return next;
      });
    }

    // Smart scroll: only auto-scroll when user hasn't scrolled up
    const handleScroll = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      setUserScrolledUp(!atBottom);
    }, []);

    useEffect(() => {
      if (slot.isStreaming && !userScrolledUp && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [slot.isStreaming, slot.streamingContent, slot.streamingThinking, userScrolledUp]);

    // Auto-resize textarea
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        const maxHeight = 80;
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
      }
    }, [followUpInput]);

    function handleSendFollowUp(e: React.FormEvent) {
      e.preventDefault();
      const text = followUpInput.trim();
      if (text && slot.hasRegenerated && !slot.isStreaming) {
        slot.sendFollowUp(text, systemPrompt, enableThinking, effort);
        setFollowUpInput("");
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendFollowUp(e);
      }
    }

    const canRegenerate = slot.selectedMessageIndex !== null;
    const canSendFollowUp = slot.hasRegenerated && !slot.isStreaming;

    return (
      <div className="flex flex-col h-full w-[280px] min-w-[280px] border-r border-gray-200 last:border-r-0">
        {/* Column header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/50">
          <span className="text-xs font-medium text-slate-600 truncate">{label}</span>
          {canRegenerate && (
            <button
              onClick={() => slot.regenerate(systemPrompt, enableThinking, effort)}
              disabled={slot.isStreaming}
              className={`text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                slot.isStreaming
                  ? "bg-slate-100 text-slate-400 cursor-default"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              Regenerate
            </button>
          )}
        </div>

        {/* Error */}
        {slot.error && (
          <div className="px-3 py-1.5 bg-red-50 text-[10px] text-red-600 flex items-center gap-1">
            <span className="truncate">
              {slot.error.length > 80 ? "Request failed. Check console." : slot.error}
            </span>
            <button onClick={slot.dismissError} className="text-red-400 hover:text-red-600 ml-auto shrink-0">
              &times;
            </button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-2 space-y-2">
          {slot.messages.map((msg, index) => {
            const isSelected = slot.selectedMessageIndex === index;
            const isDimmed = slot.selectedMessageIndex !== null && index > slot.selectedMessageIndex;
            const isAssistant = msg.role === "assistant";

            return (
              <div key={index} className={`transition-opacity ${isDimmed ? "opacity-40" : ""}`}>
                {/* Original content toggle (above message for regenerated) */}
                {msg.isRegenerated && msg.originalContent && (
                  <div className="mb-1">
                    <button
                      onClick={() => toggleOriginal(index)}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <svg className={`w-2.5 h-2.5 transition-transform ${expandedOriginals.has(index) ? "rotate-90" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Original
                    </button>
                    {expandedOriginals.has(index) && (
                      <div className="bg-gray-50 border border-gray-200 rounded p-2 text-[11px] text-gray-500 mt-1">
                        <ChatMarkdown>{msg.originalContent}</ChatMarkdown>
                      </div>
                    )}
                  </div>
                )}

                {/* Reasoning ABOVE the message (for regenerated messages) */}
                {msg.isRegenerated && msg.thinkingContent && (
                  <div className="mb-1">
                    <button
                      onClick={() => toggleThinking(index)}
                      className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-700 transition-colors"
                    >
                      <svg className={`w-2.5 h-2.5 transition-transform ${expandedThinking.has(index) ? "rotate-90" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Reasoning
                    </button>
                    {expandedThinking.has(index) && (
                      <div className="mt-1 bg-amber-50 border border-amber-200 rounded p-2 font-mono text-[10px] text-amber-900 whitespace-pre-wrap leading-relaxed">
                        {msg.thinkingContent}
                      </div>
                    )}
                  </div>
                )}

                {/* Message bubble */}
                <div
                  onClick={() => { if (isAssistant && !slot.isStreaming) slot.selectMessage(index); }}
                  className={`p-2 rounded text-[12px] ${
                    isAssistant
                      ? `bg-blue-50 text-gray-800 ${!slot.isStreaming ? "cursor-pointer hover:bg-blue-100" : ""}`
                      : "bg-gray-100 text-gray-800 ml-4"
                  } ${isSelected ? "ring-2 ring-blue-400" : ""}`}
                >
                  <div className="text-[10px] text-gray-400 mb-0.5">
                    {isAssistant ? "Tutor" : "Student"}
                  </div>
                  <div className={isAssistant ? "prose-compact" : "whitespace-pre-wrap"}>
                    {isAssistant ? <ChatMarkdown>{msg.content}</ChatMarkdown> : msg.content}
                  </div>
                </div>

                {/* Separator for dimmed messages */}
                {isDimmed && index === (slot.selectedMessageIndex ?? 0) + 1 && (
                  <div className="text-[10px] text-slate-400 mt-1 text-center">
                    Will be replaced
                  </div>
                )}
              </div>
            );
          })}

          {/* Streaming indicator — reasoning ABOVE message */}
          {slot.isStreaming && (
            <div>
              {/* Streaming reasoning (above message) */}
              {slot.streamingThinking && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 mb-1">
                  <div className="text-[10px] text-amber-600 mb-0.5">Thinking...</div>
                  <div className="font-mono text-[10px] text-amber-900 whitespace-pre-wrap leading-relaxed">
                    {slot.streamingThinking}
                  </div>
                </div>
              )}

              {/* Streaming response */}
              {slot.streamingContent ? (
                <div className="bg-blue-50 p-2 rounded">
                  <div className="text-[10px] text-gray-400 mb-0.5">Tutor</div>
                  <div className="text-[12px]">
                    <ChatMarkdown>{slot.streamingContent}</ChatMarkdown>
                  </div>
                </div>
              ) : !slot.streamingThinking ? (
                <div className="bg-blue-50 p-2 rounded">
                  <div className="text-[10px] text-gray-400 mb-0.5">Tutor</div>
                  <div className="text-gray-400 text-[12px]">Generating...</div>
                </div>
              ) : null}
            </div>
          )}

          {/* Scroll-to-bottom button */}
          {userScrolledUp && slot.isStreaming && (
            <button
              onClick={() => {
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                setUserScrolledUp(false);
              }}
              className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] px-2 py-1 rounded-full shadow"
            >
              ↓ New content
            </button>
          )}
        </div>

        {/* Follow-up input */}
        <form onSubmit={handleSendFollowUp} className="flex gap-1 p-2 border-t border-gray-100 items-end">
          <textarea
            ref={textareaRef}
            value={followUpInput}
            onChange={(e) => setFollowUpInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Follow-up..."
            disabled={!canSendFollowUp || slot.isStreaming}
            rows={1}
            className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none leading-normal disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={!canSendFollowUp || slot.isStreaming || !followUpInput.trim()}
            className="bg-blue-600 text-white text-[10px] px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    );
  },
);

export default ConversationColumn;
