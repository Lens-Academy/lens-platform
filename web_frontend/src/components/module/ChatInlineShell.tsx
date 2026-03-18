/**
 * ChatInlineShell — inline chat shell for article sections.
 *
 * Keeps all layout/scroll logic (expand/collapse, scroll ratchet, min-height wrapper)
 * but delegates message rendering to `renderMessage` and input to `ChatInputArea`.
 */

import {
  useState,
  useReducer,
  useRef,
  useEffect,
  useLayoutEffect,
  Fragment,
} from "react";
import { useScrollContainer } from "@/hooks/useScrollContainer";
import { usePillVisibility } from "@/hooks/usePillVisibility";
import type { ChatMessage, PendingMessage } from "@/types/module";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";
import { renderMessage } from "@/components/module/ChatMessageList";
import { ChatInputArea } from "@/components/module/ChatInputArea";
import ChatMarkdown from "@/components/ChatMarkdown";
import { Bot, ChevronUp, ChevronDown } from "lucide-react";
import { chatViewReducer, initialChatViewState } from "./chatViewReducer";

type ChatInlineShellProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
  activated?: boolean;
  activatedWithHistory?: boolean;
  scrollToResponse?: boolean;
  hasActiveInput: boolean;
  shellRef?: (el: HTMLDivElement | null) => void;
  sendSource?: "sidebar" | "inline" | null;
  pillId?: string;
  sidebarAllowedRef?: React.RefObject<boolean>;
  sidebarAllowedListeners?: React.RefObject<Set<() => void>>;
  sidebarRef?: React.RefObject<ChatSidebarHandle | null>;
};

/** Owns the usePillVisibility hook — isolates re-renders to this subtree. */
function PillVisibilityWrapper({
  sidebarAllowedRef,
  sidebarAllowedListeners,
  sidebarRef,
  isActive,
  children,
}: {
  sidebarAllowedRef: React.RefObject<boolean>;
  sidebarAllowedListeners: React.RefObject<Set<() => void>>;
  sidebarRef: React.RefObject<ChatSidebarHandle | null>;
  isActive: boolean;
  children: (pillHidden: boolean, pillTransition: boolean) => React.ReactNode;
}) {
  const { pillVisible, pillTransition } = usePillVisibility({
    sidebarAllowedRef,
    sidebarAllowedListeners,
    sidebarRef,
    isActive,
  });
  return children(!pillVisible, pillTransition);
}

export function ChatInlineShell({
  messages,
  pendingMessage,
  streamingContent,
  isLoading,
  onSendMessage,
  onRetryMessage,
  activated,
  activatedWithHistory,
  scrollToResponse,
  hasActiveInput,
  shellRef,
  sendSource,
  pillId,
  sidebarAllowedRef,
  sidebarAllowedListeners,
  sidebarRef,
}: ChatInlineShellProps) {
  const pageScrollContainer = useScrollContainer();

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
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollContainerHeight, setScrollContainerHeight] = useState(0);

  // scrollToResponse only applies to the first (auto-sent) message, not follow-ups
  const activeScrollToResponse = scrollToResponse && !userSentFollowup;

  const minHeightWrapperRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const systemSkipAnchorRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const recentStartRef = useRef<HTMLDivElement>(null);
  const justExpandedRef = useRef(false);
  const scrollContainerHeightRef = useRef(0);
  scrollContainerHeightRef.current = scrollContainerHeight;

  // Scroll user's new message to top when they send
  // When activeScrollToResponse is true, scroll to the response (Thinking.../streaming) instead
  useLayoutEffect(() => {
    if (!pendingMessage || !scrollContainerRef.current) return;
    // Only scroll if this shell owns the active input (message was sent from here)
    if (!hasActiveInput || sendSource === "sidebar") return;
    // In expanded mode, wait for scrollContainerHeight so minHeight is applied.
    // In normal mode (page scroll), no fixed-height container — skip the check.
    if (isExpanded && scrollContainerHeightRef.current <= 0) return;

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
    // Use scrollAnchorRef to skip past any leading system messages in the wrapper
    const scrollTarget = scrollAnchorRef.current || minHeightWrapperRef.current;
    if (scrollTarget) {
      scrollAnimStartRef.current = Date.now();
      scrollTarget.scrollIntoView({
        block: "start",
        behavior: scrollBehavior,
      });
    }
  }, [
    pendingMessage,
    activeScrollToResponse,
    isLoading,
    isExpanded,
    hasActiveInput,
    sendSource,
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

  // Activate when parent explicitly signals this instance should show messages.
  // activatedWithHistory=true means show all existing messages (transfer from sidebar).
  useEffect(() => {
    if (!hasInteracted && activated) {
      dispatch({
        type: "ACTIVATE",
        messagesLength: activatedWithHistory ? 0 : messages.length,
      });
    }
  }, [activated, activatedWithHistory, hasInteracted, messages.length]);

  // Deactivate when another surface sends (collapse back to just the input bar).
  // When re-activated later, ACTIVATE with current messagesLength means only the
  // new exchange is shown (old messages behind the "earlier" button).
  useEffect(() => {
    if (sendSource && !hasActiveInput) {
      dispatch({ type: "DEACTIVATE" });
    }
  }, [sendSource, hasActiveInput]);

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
      ? Math.max(
          0,
          (pageScrollContainer?.clientHeight ?? window.innerHeight) - 160,
        )
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

  // Re-scroll after streaming finishes to compensate for DOM changes
  // (system messages inserted, or streaming→final message height delta).
  // scrollAnchorRef is now always at wrapper top (outside space-y-4).
  // systemSkipAnchorRef appears only when system messages prefix the wrapper.
  const wasLoadingRef = useRef(false);
  useLayoutEffect(() => {
    const justFinished = wasLoadingRef.current && !isLoading;
    wasLoadingRef.current = isLoading;
    if (!justFinished) return;
    if (!hasActiveInput || sendSource === "sidebar") return;

    // Use system-skip anchor when system messages exist, else main anchor
    const target = systemSkipAnchorRef.current || scrollAnchorRef.current;
    if (!target) return;

    const expectedTop = parseInt(scrollMargin || "0", 10);
    const actualTop = target.getBoundingClientRect().top;
    const drift = Math.abs(actualTop - expectedTop);
    // Only correct small drift (content reflow); skip if user scrolled away
    if (drift < 1 || drift > 60) return;

    scrollAnimStartRef.current = Date.now();
    target.scrollIntoView({ block: "start", behavior: "instant" });
  }, [isLoading, wrapperMessages, hasActiveInput, sendSource, scrollMargin]);

  // Ratchet: reduce wrapper minHeight as user scrolls up (non-expanded only).
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
      const viewportH = pageScrollContainer?.clientHeight ?? window.innerHeight;
      const overflow = Math.max(0, rect.top + wrapperMinHeight - viewportH);
      const newReduction = Math.max(minHeightReductionRef.current, overflow);

      if (newReduction !== minHeightReductionRef.current) {
        minHeightReductionRef.current = newReduction;
        const effective = Math.max(0, wrapperMinHeight - newReduction);
        wrapper.style.minHeight = effective > 0 ? `${effective}px` : "";
      }
    };

    const scrollTarget = pageScrollContainer ?? window;
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollTarget.removeEventListener("scroll", onScroll);
  }, [hasInteracted, isExpanded, wrapperMinHeight, pageScrollContainer]);

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
    <div
      ref={shellRef}
      className="py-4 px-4"
      style={{
        overflowAnchor: "none",
      }}
    >
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
        {/* Whitespace spacer when not yet interacted — inside the container
            so the sticky input can engage (sticky needs a tall containing block) */}
        {!hasInteracted && <div style={{ height: "35vh" }} />}

        {/* Collapse button — outside scroll area so it's always visible */}
        {isExpanded && (
          <div className="flex justify-center px-3 pt-2 pb-3 shrink-0">
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
          className={`flex-1 px-4 pb-7 text-base leading-relaxed ${
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
                  <div className="flex justify-center pb-3">
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
                  const msgEl = renderMessage(msg, i);
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
              {/* Scroll anchor — always rendered outside space-y-4 so it never
                  creates a gap when it appears/disappears between streaming and
                  finished states. 0-height flex child = no visual impact. */}
              <div
                ref={scrollAnchorRef}
                style={{ scrollMarginTop: scrollMargin }}
              />
              <div className="space-y-4 max-w-content mx-auto w-full">
                {/* Messages in current exchange (user + completed assistant) */}
                {(() => {
                  const firstNonSystem = wrapperMessages.findIndex(
                    (m) => m.role !== "system",
                  );
                  const hasSystemPrefix = firstNonSystem > 0;
                  return wrapperMessages.map((msg, i) => (
                    <Fragment key={`current-${i}`}>
                      {hasSystemPrefix && i === firstNonSystem && (
                        <div
                          ref={systemSkipAnchorRef}
                          style={{ scrollMarginTop: scrollMargin }}
                        />
                      )}
                      {renderMessage(msg, `current-${i}`)}
                    </Fragment>
                  ));
                })()}

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
                    <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                      <Bot size={13} />
                      Tutor
                    </div>
                    <ChatMarkdown>{streamingContent}</ChatMarkdown>
                  </div>
                )}

                {/* Thinking indicator */}
                {showThinking && (
                  <div
                    ref={activeScrollToResponse ? responseRef : undefined}
                    className="text-gray-800"
                  >
                    <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                      <Bot size={13} />
                      Tutor
                    </div>
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

        {/* Input area — always rendered to reserve layout space (prevents
            content jump when pill activates). Hidden pills use opacity-0. */}
        <div
          className={`${isExpanded ? "border-t border-gray-100 px-4 pt-4" : ""}`}
          style={
            !isExpanded
              ? { position: "sticky", bottom: 0, zIndex: 10 }
              : undefined
          }
        >
          <div className={`${!isExpanded ? "max-w-content mx-auto" : ""}`}>
            {sidebarAllowedRef ? (
              <PillVisibilityWrapper
                sidebarAllowedRef={sidebarAllowedRef}
                sidebarAllowedListeners={sidebarAllowedListeners!}
                sidebarRef={sidebarRef!}
                isActive={hasActiveInput}
              >
                {(pillHidden, pillTransition) => (
                  <div>
                    <ChatInputArea
                      pillId={
                        hasActiveInput
                          ? pillId
                          : pillId
                            ? `${pillId}-idle`
                            : undefined
                      }
                      pillHidden={pillHidden}
                      pillTransition={pillTransition || undefined}
                      onSend={(content) => {
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
                        onSendMessage(content);
                      }}
                      isLoading={isLoading}
                      placeholder="Message AI Tutor..."
                    />
                  </div>
                )}
              </PillVisibilityWrapper>
            ) : (
              <ChatInputArea
                pillId={pillId}
                onSend={(content) => {
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
                  onSendMessage(content);
                }}
                isLoading={isLoading}
                placeholder="Message AI Tutor..."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
