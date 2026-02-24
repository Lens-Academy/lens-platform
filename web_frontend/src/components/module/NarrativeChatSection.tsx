// web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx

import {
  useState,
  useReducer,
  useRef,
  useEffect,
  useLayoutEffect,
  Fragment,
} from "react";
import type { ChatMessage, PendingMessage } from "@/types/module";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import ChatMarkdown from "@/components/ChatMarkdown";
import { Tooltip } from "@/components/Tooltip";
import { StageIcon } from "@/components/module/StageProgressBar";
import { triggerHaptic } from "@/utils/haptics";
import { ChevronUp, ChevronDown } from "lucide-react";
import { chatViewReducer, initialChatViewState } from "./chatViewReducer";

type NarrativeChatSectionProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
  scrollToResponse?: boolean;
  activated?: boolean;
};

/**
 * Chat section for NarrativeLesson.
 * Copied from ChatPanel with stage-specific features removed.
 */
export default function NarrativeChatSection({
  messages,
  pendingMessage,
  streamingContent,
  isLoading,
  onSendMessage,
  onRetryMessage,
  scrollToResponse,
  activated,
}: NarrativeChatSectionProps) {
  // View state reducer — centralized state transitions for chat view
  const [viewState, dispatch] = useReducer(
    chatViewReducer,
    initialChatViewState,
  );
  const {
    hasInteracted,
    recentMessagesStartIdx,
    minHeightWrapperStartIdx,
    isExpanded,
    userSentFollowup,
  } = viewState;

  // Independent UI state
  const [input, setInput] = useState("");
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollContainerHeight, setScrollContainerHeight] = useState(0);

  // scrollToResponse only applies to the first (auto-sent) message, not follow-ups
  const activeScrollToResponse = scrollToResponse && !userSentFollowup;

  const minHeightWrapperRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recentStartRef = useRef<HTMLDivElement>(null);
  const justExpandedRef = useRef(false);

  // Voice recording (extracted to shared hook)
  const {
    recordingState,
    recordingTime,
    volumeBars,
    errorMessage,
    showRecordingWarning,
    handleMicClick,
    formatTime,
  } = useVoiceRecording({
    onTranscription: (text) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    },
  });

  // Scroll user's new message to top when they send
  // When activeScrollToResponse is true, scroll to the response (Thinking.../streaming) instead
  useLayoutEffect(() => {
    if (!pendingMessage || !scrollContainerRef.current) return;
    // In expanded mode, wait for scrollContainerHeight so minHeight is applied.
    // In normal mode (page scroll), no fixed-height container — skip the check.
    if (isExpanded && scrollContainerHeight <= 0) return;

    const scrollBehavior = isExpanded ? "instant" : "smooth";

    // scrollToResponse: scroll past the user message to show the tutor's response
    if (activeScrollToResponse && isLoading && responseRef.current) {
      scrollAnimStartRef.current = Date.now();
      responseRef.current.scrollIntoView({
        block: "start",
        behavior: scrollBehavior,
      });
      return;
    }

    // Default: scroll to the user's message at the top
    if (minHeightWrapperRef.current) {
      scrollAnimStartRef.current = Date.now();
      minHeightWrapperRef.current.scrollIntoView({
        block: "start",
        behavior: scrollBehavior,
      });
    }
  }, [
    pendingMessage,
    scrollContainerHeight,
    activeScrollToResponse,
    isLoading,
    isExpanded,
  ]);

  // Scroll to recent-messages boundary after expanding conversation history
  useLayoutEffect(() => {
    if (justExpandedRef.current && isExpanded && scrollContainerRef.current) {
      justExpandedRef.current = false;

      // Instantly position internal scroll to recent messages
      if (recentStartRef.current) {
        const container = scrollContainerRef.current;
        const containerRect = container.getBoundingClientRect();
        const markerRect = recentStartRef.current.getBoundingClientRect();
        container.scrollTop += markerRect.top - containerRect.top;
      }

      // Smoothly scroll page to center the expanded container
      containerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [isExpanded]);

  // Activate when parent explicitly signals this instance should show messages
  useEffect(() => {
    if (!hasInteracted && activated) {
      dispatch({ type: "ACTIVATE", messagesLength: messages.length });
    }
  }, [activated, hasInteracted, messages.length]);

  // Scroll chat container into view when user first interacts
  useEffect(() => {
    if (hasInteracted && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [hasInteracted]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 200;
      const needsScroll = textarea.scrollHeight > maxHeight;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY = needsScroll ? "auto" : "hidden";
    }
  }, [input]);

  // Track scroll container height for min-height calculation
  useLayoutEffect(() => {
    if (!scrollContainerRef.current || !hasInteracted) return;

    const container = scrollContainerRef.current;

    // Set initial height immediately (fixes first-message scroll issue)
    setScrollContainerHeight(container.clientHeight);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setScrollContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [hasInteracted]);

  // Ratchet refs — declared here (hooks can't be conditional), effect is below wrapperMinHeight
  const SCROLL_SETTLE_MS = 600;
  const minHeightReductionRef = useRef(0);
  const scrollAnimStartRef = useRef(0);

  // Spacer height: in expanded mode use the scroll container, in normal mode use viewport
  // Subtract header (~80px, matches scrollMarginTop) and input bar (~80px) so wrapper
  // doesn't overshoot the viewport
  const spacerHeight = isExpanded
    ? scrollContainerHeight
    : hasInteracted
      ? Math.max(0, window.innerHeight - 160)
      : 0;

  // Messages to display based on mode (normal vs expanded)
  // When !hasInteracted, show nothing — prevents shared parent messages leaking into inactive instances
  const displayMessages = !hasInteracted
    ? []
    : isExpanded
      ? messages
      : messages.slice(recentMessagesStartIdx);

  // --- Derived view state ---
  const adjustedWrapperStart = isExpanded
    ? minHeightWrapperStartIdx
    : Math.max(0, minHeightWrapperStartIdx - recentMessagesStartIdx);
  const previousMessages = displayMessages.slice(0, adjustedWrapperStart);
  const wrapperMessages = displayMessages.slice(adjustedWrapperStart);

  const showPending = hasInteracted && !!pendingMessage;
  const showStreaming = hasInteracted && isLoading && !!streamingContent;
  const showThinking = hasInteracted && isLoading && !streamingContent;
  const wrapperMinHeight = hasInteracted && spacerHeight > 0 ? spacerHeight : 0;
  const scrollMargin = hasInteracted
    ? isExpanded
      ? "24px"
      : "80px"
    : undefined;

  // Ratchet: reduce wrapper minHeight as user scrolls up (non-expanded only).
  // As the wrapper moves down in the viewport, its original bottom extends below
  // the viewport. We reduce minHeight by that overflow. Ratchet: only increases.
  useEffect(() => {
    if (!hasInteracted || isExpanded || wrapperMinHeight <= 0) return;

    minHeightReductionRef.current = 0;

    const onScroll = () => {
      // Ignore scroll events during the scrollIntoView animation
      if (Date.now() - scrollAnimStartRef.current < SCROLL_SETTLE_MS) return;

      const wrapper = minHeightWrapperRef.current;
      if (!wrapper) return;

      const rect = wrapper.getBoundingClientRect();
      // How far the wrapper's original bottom extends below the viewport
      const overflow = Math.max(
        0,
        rect.top + wrapperMinHeight - window.innerHeight,
      );
      const newReduction = Math.max(minHeightReductionRef.current, overflow);

      if (newReduction !== minHeightReductionRef.current) {
        minHeightReductionRef.current = newReduction;
        const effective = Math.max(0, wrapperMinHeight - newReduction);
        wrapper.style.minHeight = effective > 0 ? `${effective}px` : "";
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasInteracted, isExpanded, wrapperMinHeight]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      triggerHaptic(10); // Subtle haptic feedback on send
      dispatch({
        type: "SEND_MESSAGE",
        messagesLength: messages.length,
        hasScrollToResponse: !!scrollToResponse,
      });
      minHeightReductionRef.current = 0;
      if (minHeightWrapperRef.current) {
        minHeightWrapperRef.current.style.minHeight =
          wrapperMinHeight > 0 ? `${wrapperMinHeight}px` : "";
      }
      setShowScrollButton(false);
      onSendMessage(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom < 50;
    setShowScrollButton(!isAtBottom);
  };

  const scrollToBottom = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  };

  return (
    <div className="py-4 px-4" style={{ overflowAnchor: "none" }}>
      <div
        ref={containerRef}
        className={`max-w-content-padded mx-auto flex flex-col scroll-mb-8 relative ${
          isExpanded
            ? "border border-gray-200 rounded-lg bg-white shadow-sm"
            : ""
        }`}
        style={
          hasInteracted && isExpanded
            ? { height: "85dvh", overflowAnchor: "none" }
            : { overflowAnchor: "none" }
        }
      >
        {/* Collapse button — outside scroll area so it's always visible */}
        {isExpanded && (
          <div className="flex justify-center px-3 pt-2 pb-0 shrink-0">
            <button
              onClick={() => dispatch({ type: "COLLAPSE" })}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-full transition-colors"
            >
              <ChevronDown size={14} />
              Collapse
            </button>
          </div>
        )}

        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          className={`flex-1 px-4 py-4 text-base leading-relaxed ${
            hasInteracted && !isExpanded ? "" : "overflow-y-auto"
          }`}
          style={{ overflowAnchor: "none" }}
          onScroll={isExpanded ? handleScroll : undefined}
        >
          <div>
            {/* Expand button (collapsed mode only) */}
            {!isExpanded &&
              recentMessagesStartIdx > 0 &&
              (() => {
                const earlierExchanges = messages
                  .slice(0, recentMessagesStartIdx)
                  .filter((m) => m.role === "user").length;
                return earlierExchanges > 0 ? (
                  <div className="flex justify-center pt-2 pb-4">
                    <button
                      onClick={() => {
                        justExpandedRef.current = true;
                        dispatch({ type: "EXPAND" });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-full transition-colors"
                    >
                      <ChevronUp size={14} />
                      {earlierExchanges} earlier
                    </button>
                  </div>
                ) : null;
              })()}

            {/* Previous messages - natural height */}
            {previousMessages.length > 0 && (
              <div className="space-y-4 pb-4 max-w-content mx-auto">
                {previousMessages.map((msg, i) => {
                  const isRecentBoundary =
                    isExpanded && i === recentMessagesStartIdx;
                  const msgEl =
                    msg.role === "system" ? (
                      <div key={i} className="flex justify-center my-3">
                        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                          {msg.icon && <StageIcon type={msg.icon} small />}
                          {msg.content}
                        </span>
                      </div>
                    ) : msg.role === "assistant" ? (
                      <div key={i} className="text-gray-800">
                        <div className="text-sm text-gray-500 mb-1">Tutor</div>
                        <ChatMarkdown>{msg.content}</ChatMarkdown>
                      </div>
                    ) : (
                      <div
                        key={i}
                        className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
                      >
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    );
                  return isRecentBoundary ? (
                    <Fragment key={i}>
                      <div ref={recentStartRef} />
                      {msgEl}
                    </Fragment>
                  ) : (
                    msgEl
                  );
                })}
              </div>
            )}

            {/* Min-height wrapper — current exchange stays here until user sends again */}
            <div
              ref={minHeightWrapperRef}
              className="flex flex-col"
              style={{
                scrollMarginTop: scrollMargin,
                minHeight:
                  wrapperMinHeight > 0 ? `${wrapperMinHeight}px` : undefined,
              }}
            >
              <div className="space-y-4 max-w-content mx-auto w-full">
                {/* Messages in current exchange (user + completed assistant) */}
                {wrapperMessages.map((msg, i) =>
                  msg.role === "system" ? (
                    <div
                      key={`current-${i}`}
                      className="flex justify-center my-3"
                    >
                      <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                        {msg.icon && <StageIcon type={msg.icon} small />}
                        {msg.content}
                      </span>
                    </div>
                  ) : msg.role === "assistant" ? (
                    <div key={`current-${i}`} className="text-gray-800">
                      <div className="text-sm text-gray-500 mb-1">Tutor</div>
                      <ChatMarkdown>{msg.content}</ChatMarkdown>
                    </div>
                  ) : (
                    <div
                      key={`current-${i}`}
                      className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  ),
                )}

                {/* Pending user message */}
                {showPending && (
                  <div
                    className={`ml-auto max-w-[80%] p-3 rounded-2xl ${
                      pendingMessage!.status === "failed"
                        ? "bg-red-50 border border-red-200"
                        : "bg-gray-100"
                    }`}
                  >
                    {pendingMessage!.status === "failed" && onRetryMessage && (
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
                      {pendingMessage!.content}
                    </div>
                  </div>
                )}

                {/* Streaming response */}
                {showStreaming && (
                  <div
                    ref={activeScrollToResponse ? responseRef : undefined}
                    className="text-gray-800"
                  >
                    <div className="text-sm text-gray-500 mb-1">Tutor</div>
                    <ChatMarkdown>{streamingContent}</ChatMarkdown>
                  </div>
                )}

                {/* Thinking indicator */}
                {showThinking && (
                  <div
                    ref={activeScrollToResponse ? responseRef : undefined}
                    className="text-gray-800"
                  >
                    <div className="text-sm text-gray-500 mb-1">Tutor</div>
                    <div>Thinking...</div>
                  </div>
                )}
              </div>

              {/* Spacer pushes sticky input to bottom */}
              <div className="flex-grow" />
            </div>
          </div>
        </div>

        {/* Scroll to bottom button (expanded mode only) */}
        {showScrollButton && isExpanded && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={scrollToBottom}
              className="bg-white border border-gray-300 rounded-full p-2 shadow-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Scroll to bottom"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div
            role="alert"
            className="px-4 py-2 bg-red-50 border-t border-red-100"
          >
            <div className="text-sm text-red-600">{errorMessage}</div>
          </div>
        )}

        {/* Recording warning */}
        {showRecordingWarning && (
          <div className="px-4 py-2 bg-amber-50 border-t border-amber-100">
            <div className="text-sm text-amber-700">
              Recording will stop after 2 minutes.
            </div>
          </div>
        )}

        {/* Input form */}
        <form
          onSubmit={handleSubmit}
          className={`px-4 pb-4 pt-2 ${isExpanded ? "border-t border-gray-100" : ""}`}
          style={
            !isExpanded
              ? { position: "sticky", bottom: 0, zIndex: 10 }
              : undefined
          }
        >
          <div
            className={`max-w-content mx-auto ${!isExpanded ? "border border-gray-200 rounded-2xl bg-white shadow-md" : ""}`}
          >
            {/* Recording indicator */}
            {recordingState === "recording" && (
              <div className="flex items-center gap-2 justify-center pt-3 px-4">
                <div className="flex items-end gap-1 h-6">
                  {volumeBars.map((vol, i) => (
                    <div
                      key={i}
                      className="w-1.5 bg-gray-500 rounded-sm transition-[height] duration-100"
                      style={{
                        height: `${Math.max(6, Math.min(1, vol * 2) * 24)}px`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm text-gray-500 tabular-nums">
                  {formatTime(recordingTime)}
                </span>
              </div>
            )}

            <div className="flex gap-2 items-end p-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  // Delay to let iOS keyboard animation start
                  setTimeout(() => {
                    textareaRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "nearest",
                    });
                  }, 100);
                }}
                placeholder={
                  recordingState === "transcribing"
                    ? "Transcribing..."
                    : "Type a message..."
                }
                disabled={recordingState === "transcribing"}
                rows={1}
                className="flex-1 px-1 py-1 focus:outline-none resize-none leading-normal disabled:bg-gray-100 bg-transparent"
              />

              {/* Buttons */}
              <div className="flex gap-1.5 shrink-0">
                <Tooltip
                  content={
                    recordingState === "recording"
                      ? "Stop recording"
                      : "Start recording"
                  }
                >
                  <button
                    type="button"
                    onClick={handleMicClick}
                    disabled={recordingState === "transcribing"}
                    aria-label={
                      recordingState === "recording"
                        ? "Stop recording"
                        : "Start voice recording"
                    }
                    className="min-w-[36px] min-h-[36px] p-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-default text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {recordingState === "transcribing" ? (
                      <svg
                        className="w-5 h-5 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        style={
                          recordingState === "recording"
                            ? { animation: "mic-pulse 1s ease-in-out infinite" }
                            : undefined
                        }
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                        />
                      </svg>
                    )}
                  </button>
                </Tooltip>
                {recordingState === "recording" ? (
                  <Tooltip content="Stop recording">
                    <button
                      type="button"
                      onClick={handleMicClick}
                      aria-label="Stop recording"
                      className="bg-gray-600 text-white p-2 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[36px] min-h-[36px] flex items-center justify-center transition-all active:scale-95"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                    </button>
                  </Tooltip>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      isLoading || !input.trim() || recordingState !== "idle"
                    }
                    className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-default min-w-[36px] min-h-[36px] transition-all active:scale-95"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
