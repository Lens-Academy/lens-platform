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
  useLayoutEffect,
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
import { BotMessageSquare } from "lucide-react";
import { useSwipePanel } from "@/hooks/useSwipePanel";

export type ChatSidebarHandle = {
  setAllowed: (allowed: boolean) => void;
  setSystemOpenPref: (open: boolean) => void;
};

type ChatSidebarProps = {
  sectionTitle?: string;
  // Chat state (passed from Module.tsx / parent)
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
  /** When true, disables swipe-to-open and hides the FAB (e.g. module drawer is open). */
  drawerOpen?: boolean;
};

export const ChatSidebar = forwardRef<ChatSidebarHandle, ChatSidebarProps>(
  function ChatSidebar(
    {
      sectionTitle,
      messages,
      pendingMessage,
      isLoading,
      onSendMessage,
      onRetryMessage: _onRetryMessage,
      drawerOpen = false,
    },
    ref,
  ) {
    const isMobile = useMedia("(max-width: 700px)", false);
    const scrollContainer = useScrollContainer();
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const minHeightWrapperRef = useRef<HTMLDivElement>(null);

    // Wrapper state: null = no wrapper (scroll to bottom on open), number = split index (scroll to top on send)
    const [wrapperStartIdx, setWrapperStartIdx] = useState<number | null>(null);
    const [scrollContainerHeight, setScrollContainerHeight] = useState(0);

    // --- Three independent states → derived isOpen ---
    // isAllowed:      can the sidebar exist here? (section type + chat pill gating)
    // systemOpenPref: does the system recommend it be open? (false on section load,
    //                 true at excerpt scroll)
    // userOpenPref:   does the user want it open? (persisted in localStorage)
    const [isAllowed, setIsAllowed] = useState(true);
    const [systemOpenPref, setSystemOpenPref] = useState(false);
    const [userOpenPref, setUserOpenPref] = useState<string | null>(() =>
      typeof window !== "undefined"
        ? localStorage.getItem("chat-sidebar-pref")
        : null,
    );

    const isOpen = isMobile
      ? userOpenPref === "open"
      : isAllowed && systemOpenPref && userOpenPref !== "closed";

    // --- Imperative handle for parent ---
    useImperativeHandle(ref, () => ({
      setAllowed: (allowed: boolean) => setIsAllowed(allowed),
      setSystemOpenPref: (open: boolean) => setSystemOpenPref(open),
    }));

    // --- Preference-persisting open/close ---
    const handleClose = useCallback(() => {
      setUserOpenPref("closed");
      localStorage.setItem("chat-sidebar-pref", "closed");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    }, []);
    const handleOpen = useCallback(() => {
      setSystemOpenPref(true);
      setUserOpenPref("open");
      localStorage.setItem("chat-sidebar-pref", "open");
      window.dispatchEvent(new Event("chat-sidebar-pref-change"));
    }, []);

    const toggleHidden = !isAllowed;

    // --- Swipe gesture support (mobile only) ---
    const panelRef = useRef<HTMLDivElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    useSwipePanel({
      isOpen,
      onOpen: handleOpen,
      onClose: handleClose,
      enabled: isMobile && !drawerOpen,
      panelRef,
      backdropRef,
    });

    // --- Manage scroll container spacing via transparent border ---
    // DO NOT replace this with margin-right or padding-right!
    // We use a wide transparent border (yes, 320px+) intentionally. Chrome's
    // CSS Scroll Anchoring spec (css-scroll-anchoring-1) suppresses anchoring
    // when margin/padding/width/height change on any element in the path from
    // anchor node to scroll container (inclusive). Border is NOT in that list,
    // so Chrome's built-in overflow-anchor keeps the user's reading position
    // stable when the sidebar opens/closes and text reflows.
    // See: https://drafts.csswg.org/css-scroll-anchoring/#suppression-triggers
    useLayoutEffect(() => {
      if (!scrollContainer || isMobile) return;
      scrollContainer.style.borderRight = isOpen
        ? "var(--sidebar-width) solid transparent"
        : "";
      scrollContainer.style.setProperty(
        "--sidebar-open-width",
        isOpen ? "var(--sidebar-width)" : "0px",
      );
      return () => {
        scrollContainer.style.borderRight = "";
        scrollContainer.style.removeProperty("--sidebar-open-width");
      };
    }, [isOpen, scrollContainer, isMobile]);

    // Close on Escape key
    useEffect(() => {
      if (!isOpen) return;
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleClose();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen, handleClose]);

    // (Mobile ↔ desktop crossing handled by derived isOpen: isMobile gates it)

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

    // Track scroll container height for min-height wrapper
    useLayoutEffect(() => {
      if (!scrollContainerRef.current) return;
      const container = scrollContainerRef.current;
      setScrollContainerHeight(container.clientHeight);
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setScrollContainerHeight(entry.contentRect.height);
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    // On open: scroll to bottom (preserve wrapper so whitespace remains)
    useLayoutEffect(() => {
      if (!isOpen) return;
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop =
            scrollContainerRef.current.scrollHeight;
        }
      });
    }, [isOpen]);

    // On send: scroll user's message to top (triggered by isLoading going true)
    const wasLoadingSendRef = useRef(false);
    useLayoutEffect(() => {
      const justStarted = isLoading && !wasLoadingSendRef.current;
      wasLoadingSendRef.current = isLoading;
      if (!justStarted || !minHeightWrapperRef.current) return;
      if (scrollContainerHeight <= 0) return;
      minHeightWrapperRef.current.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    }, [isLoading, scrollContainerHeight]);


    const header = (
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0 bg-[var(--brand-bg)]"
        style={{ borderColor: "var(--brand-border)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 text-sm flex items-center gap-1.5">
              <span className="font-display">AI Tutor</span>
              <BotMessageSquare
                className="w-4 h-4 text-gray-900 shrink-0"
                strokeWidth={1.5}
              />
            </div>
            {sectionTitle ? (
              <div className="text-xs text-gray-500 line-clamp-3">
                Optional – ask questions about{" "}
                <span className="font-medium">{sectionTitle}</span>
              </div>
            ) : (
              <div className="text-xs text-gray-500">
                Optional – ask questions as you read
              </div>
            )}
          </div>
        </div>
        <button
          onMouseDown={handleClose}
          className="p-2 min-h-[44px] min-w-[44px] hover:bg-stone-200 rounded-lg transition-all active:scale-95 flex items-center justify-center shrink-0"
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
          isLoading={isLoading}
          containerRef={scrollContainerRef}
          wrapperStartIdx={wrapperStartIdx}
          wrapperMinHeight={
            wrapperStartIdx != null ? scrollContainerHeight : undefined
          }
          minHeightWrapperRef={minHeightWrapperRef}
        />
        <div
          className="shrink-0 border-t px-4 pt-4"
          style={{ borderColor: "var(--brand-border)" }}
        >
          <ChatInputArea
            pillId="sidebar"
            onSend={(content) => {
              setWrapperStartIdx(messages.length);
              onSendMessage(content);
            }}
            isLoading={isLoading}
            placeholder="Message AI Tutor..."
          />
        </div>
      </>
    );

    // ── Mobile: fullscreen fixed overlay ──────────────────────────────
    if (isMobile) {
      return (
        <>
          {/* Backdrop — always rendered so swipe hook can control opacity */}
          <div
            ref={backdropRef}
            className={`fixed inset-0 z-40 bg-black transition-opacity duration-300 ${
              isOpen ? "opacity-50" : "opacity-0 pointer-events-none"
            }`}
            onMouseDown={handleClose}
          />

          {/* Fullscreen panel — slides in from right */}
          <div
            ref={panelRef}
            className={`fixed inset-0 z-50 bg-white flex flex-col transition-[translate] duration-300 ease-in-out ${
              isOpen ? "translate-x-0" : "translate-x-full"
            }`}
            style={{
              paddingTop: "var(--safe-top)",
              paddingBottom: "var(--safe-bottom)",
            }}
          >
            {/* FAB — sticks out from panel's left edge, slides with it */}
            <button
              onMouseDown={handleOpen}
              className={`absolute -left-14 z-10 flex items-center justify-center w-12 h-12 bg-white border rounded-full shadow-lg hover:bg-stone-100 active:scale-95 transition-opacity duration-200 ${
                toggleHidden || drawerOpen
                  ? "opacity-0 pointer-events-none"
                  : ""
              }`}
              style={{
                bottom: "calc(1rem + var(--safe-bottom, 0px))",
                borderColor: "var(--brand-border)",
              }}
              title="Ask the AI Tutor"
              aria-label="Open chat sidebar"
            >
              <BotMessageSquare
                className="w-6 h-6 text-slate-600"
                strokeWidth={1.5}
              />
            </button>
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
          className={`fixed right-3 z-30 flex items-center justify-center w-10 h-10 rounded-lg shadow-sm hover:brightness-110 transition-all active:scale-95 ${
            isOpen || toggleHidden ? "opacity-0 pointer-events-none" : ""
          }`}
          style={{
            top: "calc(var(--module-header-height) + 8px)",
            backgroundColor: "var(--brand-accent)",
            color: "var(--brand-accent-text)",
          }}
          title="Ask the AI Tutor"
          aria-label="Open chat sidebar"
        >
          <BotMessageSquare
            className="w-[26px] h-[26px] text-white"
            strokeWidth={1.5}
          />
        </button>

        {/* Sidebar panel — animates width */}
        <div
          className={`fixed right-0 z-30 overflow-hidden transition-[width,border-color] duration-300 ease-in-out ${
            isOpen ? "w-80 xl:w-96 border-l" : "w-0 border-l border-transparent"
          }`}
          style={{
            top: "var(--module-header-height)",
            height: "calc(100dvh - var(--module-header-height))",
            ...(isOpen
              ? {
                  borderColor:
                    "color-mix(in srgb, var(--brand-border) 60%, transparent)",
                }
              : undefined),
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
