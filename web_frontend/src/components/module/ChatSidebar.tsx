/**
 * ChatSidebar — optional freeform chat panel alongside article content.
 *
 * Desktop/tablet (md+): inline sticky sidebar next to article content,
 * using available space. Narrow toggle strip when closed, full chat panel
 * when open. Same z-index as content — not an overlay.
 *
 * Mobile (<md): fullscreen fixed overlay with backdrop.
 */

import { useEffect, useCallback, useRef } from "react";
import { useMedia } from "react-use";
import type { ChatMessage, PendingMessage } from "@/types/module";
import { ChatMessageList } from "@/components/module/ChatMessageList";
import { ChatInputArea } from "@/components/module/ChatInputArea";

type ChatSidebarProps = {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  sectionTitle?: string;
  // Chat state (passed from Module.tsx / parent)
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
};

export function ChatSidebar({
  isOpen,
  onOpen,
  onClose,
  sectionTitle,
  messages,
  pendingMessage,
  streamingContent,
  isLoading,
  onSendMessage,
  onRetryMessage: _onRetryMessage,
}: ChatSidebarProps) {
  const isMobile = useMedia("(max-width: 767px)", false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => onClose(), [onClose]);
  const handleOpen = useCallback(() => onOpen(), [onOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleClose]);

  // Lock body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isMobile && isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isMobile, isOpen]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollContainerRef.current && isOpen) {
      const container = scrollContainerRef.current;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < 150) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages, streamingContent, isLoading, isOpen]);

  const chatIcon = (
    <svg
      className="w-[18px] h-[18px] text-slate-500"
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
  );

  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <svg
          className="w-4 h-4 text-blue-600 shrink-0"
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
        <div className="min-w-0">
          <div className="font-medium text-gray-900 text-sm">AI Tutor</div>
          {sectionTitle ? (
            <div className="text-xs text-gray-500 line-clamp-3">
              Optional — ask questions about{" "}
              <span className="font-medium">{sectionTitle}</span>
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              Optional — ask questions as you read
            </div>
          )}
        </div>
      </div>
      <button
        onMouseDown={handleClose}
        className="p-2 min-h-[44px] min-w-[44px] hover:bg-gray-100 rounded-lg transition-all active:scale-95 flex items-center justify-center shrink-0"
        aria-label="Close chat sidebar"
      >
        <svg
          className="w-5 h-5 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );

  const chatBody = (
    <>
      <ChatMessageList
        messages={messages}
        pendingMessage={pendingMessage}
        streamingContent={streamingContent}
        isLoading={isLoading}
        containerRef={scrollContainerRef}
      />
      <div className="shrink-0 border-t border-gray-200">
        <ChatInputArea
          onSend={onSendMessage}
          isLoading={isLoading}
          placeholder="Ask a question..."
        />
      </div>
    </>
  );

  // ── Mobile: fullscreen fixed overlay ──────────────────────────────
  if (isMobile) {
    return (
      <>
        {/* Floating toggle button on right edge */}
        <button
          onMouseDown={handleOpen}
          className={`fixed right-0 z-50 bg-white border border-r-0 border-gray-200 rounded-l-lg shadow-sm px-1.5 py-2.5 hover:bg-gray-50 transition-all active:scale-95 ${
            isOpen ? "opacity-0 pointer-events-none" : ""
          }`}
          style={{ top: "calc(4rem + var(--safe-top, 0px))" }}
          title="Ask the AI Tutor"
          aria-label="Open chat sidebar"
        >
          {chatIcon}
        </button>

        {/* Backdrop */}
        {isOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
            onMouseDown={handleClose}
          />
        )}

        {/* Fullscreen panel — slides in from right */}
        <div
          className={`fixed inset-0 z-50 bg-white flex flex-col transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${
            isOpen ? "translate-x-0" : "translate-x-full"
          }`}
          style={{
            paddingTop: "var(--safe-top)",
            paddingBottom: "var(--safe-bottom)",
          }}
        >
          {header}
          {chatBody}
        </div>
      </>
    );
  }

  // ── Desktop/Tablet: inline sticky sidebar ─────────────────────────
  // Below xl: fixed-px width with smooth transition (overflow-hidden reveal)
  // At xl+: fills 1/3 of the 9-col flex parent (= 3/12 of viewport), no transition
  return (
    <div
      className={`shrink-0 sticky overflow-hidden transition-[width,border-color] duration-300 [transition-timing-function:var(--ease-spring)] ${
        isOpen
          ? "w-80 lg:w-96 xl:w-1/3 border-l border-gray-200"
          : "w-10 border-l border-transparent"
      }`}
      style={{
        top: "var(--module-header-height)",
        height: "calc(100dvh - var(--module-header-height))",
      }}
    >
      {isOpen ? (
        <div className="w-80 lg:w-96 xl:w-full h-full flex flex-col bg-white">
          {header}
          {chatBody}
        </div>
      ) : (
        <button
          onMouseDown={handleOpen}
          className="flex items-center justify-center w-10 h-10 mt-2 hover:bg-gray-100 rounded-lg transition-all active:scale-95"
          title="Ask the AI Tutor"
          aria-label="Open chat sidebar"
        >
          {chatIcon}
        </button>
      )}
    </div>
  );
}
