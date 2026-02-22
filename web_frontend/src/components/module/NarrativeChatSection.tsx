// web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import type { ChatMessage, PendingMessage } from "@/types/module";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import ChatMarkdown from "@/components/ChatMarkdown";
import { Tooltip } from "@/components/Tooltip";
import { StageIcon } from "@/components/module/StageProgressBar";
import { triggerHaptic } from "@/utils/haptics";

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
  // Local state - component stays mounted so no need for parent sync
  const [input, setInput] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [currentExchangeStartIndex, setCurrentExchangeStartIndex] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollContainerHeight, setScrollContainerHeight] = useState(0);
  const [userSentFollowup, setUserSentFollowup] = useState(false);

  // scrollToResponse only applies to the first (auto-sent) message, not follow-ups
  const activeScrollToResponse = scrollToResponse && !userSentFollowup;

  const currentExchangeRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    // Need scrollContainerHeight > 0 so minHeight is applied before scrolling
    if (
      pendingMessage &&
      scrollContainerRef.current &&
      scrollContainerHeight > 0
    ) {
      // scrollToResponse: scroll past the user message to show the tutor's response
      if (activeScrollToResponse && isLoading && responseRef.current) {
        responseRef.current.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
        return;
      }

      // Default: scroll to the user's message at the top
      if (currentExchangeRef.current) {
        currentExchangeRef.current.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
      }
    }
  }, [pendingMessage, scrollContainerHeight, activeScrollToResponse, isLoading]);

  // Activate when parent explicitly signals this instance should show messages
  useEffect(() => {
    if (!hasInteracted && activated) {
      setHasInteracted(true);
    }
  }, [activated, hasInteracted]);

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

  // When activeScrollToResponse, keep the completed assistant response in the wrapper
  // (not space-y-4) so heights stay identical to the streaming layout — no jump.
  const currentMessages = messages.slice(currentExchangeStartIndex);
  const lastCurrentMsg = currentMessages[currentMessages.length - 1];
  const renderLastInWrapper =
    activeScrollToResponse &&
    !isLoading &&
    lastCurrentMsg?.role === "assistant";
  const spaceY4Messages = renderLastInWrapper
    ? currentMessages.slice(0, -1)
    : currentMessages;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      triggerHaptic(10); // Subtle haptic feedback on send
      // Set split point before sending - current messages become "previous"
      setCurrentExchangeStartIndex(messages.length);
      setShowScrollButton(false); // Reset scroll button when sending new message
      setHasInteracted(true);
      if (scrollToResponse) setUserSentFollowup(true);
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
        className="max-w-content-padded mx-auto border border-gray-100 rounded-lg bg-white flex flex-col scroll-mb-8 relative"
        style={
          hasInteracted
            ? { height: "85dvh", overflowAnchor: "none" } // Fixed height when interacted to prevent jitter during streaming
            : { maxHeight: "85dvh", minHeight: "180px", overflowAnchor: "none" }
        }
      >
        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 py-4 text-base leading-relaxed"
          style={{ overflowAnchor: "none" }}
          onScroll={handleScroll}
        >
          {hasInteracted ? (
            <div>
              {/* Previous messages - natural height */}
              {currentExchangeStartIndex > 0 && (
                <div className="space-y-4 pb-4 max-w-content mx-auto">
                  {messages.slice(0, currentExchangeStartIndex).map((msg, i) =>
                    msg.role === "system" ? (
                      <div key={i} className="flex justify-center my-3">
                        <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                          {msg.icon && <StageIcon type={msg.icon} small />}
                          {msg.content}
                        </span>
                      </div>
                    ) : (
                      msg.role === "assistant" ? (
                        <div key={i} className="text-gray-800">
                          <div className="text-xs text-gray-500 mb-1">
                            Tutor
                          </div>
                          <ChatMarkdown>{msg.content}</ChatMarkdown>
                        </div>
                      ) : (
                        <div
                          key={i}
                          className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
                        >
                          <div className="whitespace-pre-wrap">
                            {msg.content}
                          </div>
                        </div>
                      )
                    ),
                  )}
                </div>
              )}

              {/* Current exchange - min height so user's message starts at top */}
              <div
                ref={currentExchangeRef}
                style={{
                  scrollMarginTop: "24px",
                  minHeight:
                    scrollContainerHeight > 0
                      ? `${scrollContainerHeight}px`
                      : undefined,
                }}
              >
                <div className="space-y-4 max-w-content mx-auto">
                  {/* Current exchange messages */}
                  {spaceY4Messages.map((msg, i) =>
                    msg.role === "system" ? (
                      <div
                        key={`current-${i}`}
                        className="flex justify-center my-3"
                      >
                        <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                          {msg.icon && <StageIcon type={msg.icon} small />}
                          {msg.content}
                        </span>
                      </div>
                    ) : (
                      msg.role === "assistant" ? (
                        <div key={`current-${i}`} className="text-gray-800">
                          <div className="text-xs text-gray-500 mb-1">
                            Tutor
                          </div>
                          <ChatMarkdown>{msg.content}</ChatMarkdown>
                        </div>
                      ) : (
                        <div
                          key={`current-${i}`}
                          className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
                        >
                          <div className="whitespace-pre-wrap">
                            {msg.content}
                          </div>
                        </div>
                      )
                    ),
                  )}

                  {/* Pending user message */}
                  {pendingMessage && (
                    <div
                      className={`ml-auto max-w-[80%] p-3 rounded-2xl ${
                        pendingMessage.status === "failed"
                          ? "bg-red-50 border border-red-200"
                          : "bg-gray-100"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        {pendingMessage.status === "sending" && (
                          <span className="text-xs text-gray-400 ml-auto">Sending...</span>
                        )}
                        {pendingMessage.status === "failed" &&
                          onRetryMessage && (
                            <button
                              onClick={onRetryMessage}
                              className="text-red-600 hover:text-red-700 text-xs focus:outline-none focus:underline ml-auto"
                            >
                              Failed - Click to retry
                            </button>
                          )}
                      </div>
                      <div className="whitespace-pre-wrap text-gray-800">
                        {pendingMessage.content}
                      </div>
                    </div>
                  )}

                </div>

                {/* Response + spacer wrapper. When activeScrollToResponse is true,
                   minHeight ensures the response can scroll to viewport top.
                   As the response grows, the flex-grow spacer shrinks. */}
                <div
                  className="flex flex-col flex-grow"
                  style={
                    activeScrollToResponse && scrollContainerHeight > 0
                      ? { minHeight: `${scrollContainerHeight}px` }
                      : undefined
                  }
                >
                  {/* Streaming response */}
                  {isLoading && streamingContent && (
                    <div
                      ref={activeScrollToResponse ? responseRef : undefined}
                      className="text-gray-800 mt-4"
                      style={
                        activeScrollToResponse
                          ? { scrollMarginTop: "24px" }
                          : undefined
                      }
                    >
                      <div className="text-xs text-gray-500 mb-1">Tutor</div>
                      <ChatMarkdown>{streamingContent}</ChatMarkdown>
                    </div>
                  )}

                  {/* Loading indicator */}
                  {isLoading && !streamingContent && (
                    <div
                      ref={activeScrollToResponse ? responseRef : undefined}
                      className="text-gray-800 mt-4"
                      style={
                        activeScrollToResponse
                          ? { scrollMarginTop: "24px" }
                          : undefined
                      }
                    >
                      <div className="text-xs text-gray-500 mb-1">Tutor</div>
                      <div>Thinking...</div>
                    </div>
                  )}

                  {/* Completed assistant response - kept in wrapper so
                     heights match the streaming layout (no jump) */}
                  {renderLastInWrapper && lastCurrentMsg && (
                    <div className="text-gray-800 mt-4">
                      <div className="text-xs text-gray-500 mb-1">Tutor</div>
                      <div>
                        <ChatMarkdown>{lastCurrentMsg.content}</ChatMarkdown>
                      </div>
                    </div>
                  )}

                  <div className="flex-grow" />
                </div>
              </div>
            </div>
          ) : (
            // Empty state before first interaction
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <svg
                className="w-12 h-12 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm">Send a message to start the discussion</p>
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && hasInteracted && (
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
          className="px-4 py-4 border-t border-gray-100"
        >
          <div className="flex gap-2 items-end max-w-content mx-auto">
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
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none leading-normal disabled:bg-gray-100"
          />

          {/* Buttons */}
          <div className="flex flex-col items-center gap-1">
            {recordingState === "recording" && (
              <div className="flex items-center gap-2">
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
            <div className="flex gap-2">
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
                  className="min-w-[44px] min-h-[44px] p-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-default bg-gray-100 text-gray-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[70px] min-h-[44px] flex items-center justify-center transition-all active:scale-95"
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
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-default min-w-[70px] min-h-[44px] transition-all active:scale-95"
                >
                  Send
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
