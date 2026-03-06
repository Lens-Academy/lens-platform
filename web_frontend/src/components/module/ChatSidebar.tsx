/**
 * ChatSidebar — optional freeform chat panel alongside article content.
 *
 * Desktop (lg+): content-only component. Parent handles positioning via
 * absolute+sticky (mirroring the TOC approach). Narrow toggle strip when
 * closed, full chat panel when open. Same z-index as content — not an overlay.
 *
 * Mobile/tablet (<lg): fullscreen fixed overlay with backdrop.
 *
 * State lives in ChatSidebar (not Module) to avoid re-rendering Module on
 * every open/close toggle — same pattern as ModuleDrawer. Both `isOpen` and
 * `isAllowed` are owned here; the parent drives `isAllowed` via the
 * imperative handle (called from the scroll handler for instant response).
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useMedia } from "react-use";
import { useScrollContainer } from "@/hooks/useScrollContainer";
import type { ChatMessage, PendingMessage } from "@/types/module";
import { ChatMessageList } from "@/components/module/ChatMessageList";
import { ChatInputArea } from "@/components/module/ChatInputArea";

export type ChatSidebarHandle = {
  open: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  setAllowed: (allowed: boolean) => void;
};

type ChatSidebarProps = {
  sectionTitle?: string;
  // Chat state (passed from Module.tsx / parent)
  messages: ChatMessage[];
  prefixMessage?: ChatMessage;
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
};

export const ChatSidebar = forwardRef<ChatSidebarHandle, ChatSidebarProps>(
  function ChatSidebar(
    {
      sectionTitle,
      messages,
      prefixMessage,
      pendingMessage,
      streamingContent,
      isLoading,
      onSendMessage,
      onRetryMessage: _onRetryMessage,
    },
    ref,
  ) {
    const isMobile = useMedia("(max-width: 1023px)", false);
    const scrollContainer = useScrollContainer();
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // --- Own open/close + allowed state (like ModuleDrawer) ---
    const [isOpen, setIsOpen] = useState(() => {
      if (typeof window === "undefined") return false;
      const pref = localStorage.getItem("chat-sidebar-pref");
      return pref === null ? true : pref === "open";
    });
    const [isAllowed, setIsAllowed] = useState(true);

    // Track the previous allowed state so we can restore from pref on
    // allowed transitions (not-allowed → allowed).
    const prevAllowedRef = useRef(true);
    useEffect(() => {
      if (!prevAllowedRef.current && isAllowed) {
        // Transitioning to allowed — restore from pref
        const pref = localStorage.getItem("chat-sidebar-pref");
        setIsOpen(pref === null ? true : pref === "open");
      } else if (!isAllowed) {
        // Force close without updating pref
        setIsOpen(false);
      }
      prevAllowedRef.current = isAllowed;
    }, [isAllowed]);

    // --- Imperative handle for parent ---
    useImperativeHandle(ref, () => ({
      open: () => {
        setIsOpen(true);
        localStorage.setItem("chat-sidebar-pref", "open");
      },
      close: () => {
        setIsOpen(false);
        localStorage.setItem("chat-sidebar-pref", "closed");
      },
      setOpen: (open: boolean) => {
        setIsOpen(open);
      },
      setAllowed: (allowed: boolean) => {
        setIsAllowed(allowed);
      },
    }));

    // --- Preference-persisting open/close ---
    const handleClose = useCallback(() => {
      setIsOpen(false);
      localStorage.setItem("chat-sidebar-pref", "closed");
    }, []);
    const handleOpen = useCallback(() => {
      setIsOpen(true);
      localStorage.setItem("chat-sidebar-pref", "open");
    }, []);

    // --- Manage module-sidebar-open class on scroll container directly ---
    useEffect(() => {
      if (!scrollContainer || isMobile) return;
      if (isOpen && isAllowed) {
        scrollContainer.classList.add("module-sidebar-open");
      } else {
        scrollContainer.classList.remove("module-sidebar-open");
      }
      return () => scrollContainer.classList.remove("module-sidebar-open");
    }, [isOpen, isAllowed, scrollContainer, isMobile]);

    // Close on Escape key
    useEffect(() => {
      if (!isOpen) return;
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleClose();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen, handleClose]);

    // Lock scroll when sidebar is open on mobile
    useEffect(() => {
      if (isMobile && isOpen) {
        const target = scrollContainer ?? document.body;
        target.style.overflow = "hidden";
        return () => {
          target.style.overflow = "";
        };
      }
    }, [isMobile, isOpen, scrollContainer]);

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

    const toggleHidden = !isAllowed;

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
          prefixMessage={prefixMessage}
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
              isOpen || toggleHidden ? "opacity-0 pointer-events-none" : ""
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

    // ── Desktop/Tablet: always rendered, width transitions between 0 and full ──
    return (
      <>
        {/* Floating toggle — visible when sidebar is closed */}
        <button
          onMouseDown={handleOpen}
          className={`fixed right-3 z-30 flex items-center justify-center w-10 h-10 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-all active:scale-95 ${
            isOpen || toggleHidden ? "opacity-0 pointer-events-none" : ""
          }`}
          style={{ top: "calc(var(--module-header-height) + 8px)" }}
          title="Ask the AI Tutor"
          aria-label="Open chat sidebar"
        >
          {chatIcon}
        </button>

        {/* Sidebar panel — animates width */}
        <div
          className={`fixed right-0 z-30 overflow-hidden transition-[width,border-color] duration-500 [transition-timing-function:var(--ease-spring)] ${
            isOpen
              ? "w-80 xl:w-96 border-l border-gray-200"
              : "w-0 border-l border-transparent"
          }`}
          style={{
            top: "var(--module-header-height)",
            height: "calc(100dvh - var(--module-header-height))",
          }}
        >
          <div className="w-80 xl:w-96 h-full flex flex-col bg-white">
            {header}
            {chatBody}
          </div>
        </div>
      </>
    );
  },
);
