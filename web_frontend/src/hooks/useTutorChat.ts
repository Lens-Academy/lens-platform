/**
 * useTutorChat — centralises all chat state for the Module player.
 *
 * Uses `useReducer` for the chat lifecycle (atomic state transitions)
 * and `useState` / `useRef` for independent concerns (input text,
 * sidebar visibility, active surface).
 */

import {
  useReducer,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type {
  ChatMessage,
  PendingMessage,
  Module as ModuleType,
  ModuleSection,
} from "@/types/module";
import {
  sendMessage as sendMessageApi,
  getChatHistory,
} from "@/api/modules";
import { trackChatMessageSent } from "@/analytics";

// ---------------------------------------------------------------------------
// Chat lifecycle reducer
// ---------------------------------------------------------------------------

type ChatState = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  lastPosition: { sectionIndex: number; segmentIndex: number } | null;
};

type ChatAction =
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | {
      type: "SEND_START";
      content: string;
      sectionIndex: number;
      segmentIndex: number;
    }
  | { type: "STREAM_CHUNK"; accumulated: string }
  | {
      type: "SEND_SUCCESS";
      userContent: string;
      assistantContent: string;
    }
  | { type: "SEND_FAILURE" }
  | { type: "CLEAR_PENDING" }
  | { type: "INJECT_SYSTEM_MESSAGE"; content: string };

const initialChatState: ChatState = {
  messages: [],
  pendingMessage: null,
  streamingContent: "",
  isLoading: false,
  lastPosition: null,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "LOAD_HISTORY":
      return {
        ...state,
        messages: action.messages,
        pendingMessage: null,
        streamingContent: "",
        isLoading: false,
      };

    case "SEND_START":
      return {
        ...state,
        pendingMessage: action.content
          ? { content: action.content, status: "sending" }
          : null,
        streamingContent: "",
        isLoading: true,
        lastPosition: {
          sectionIndex: action.sectionIndex,
          segmentIndex: action.segmentIndex,
        },
      };

    case "STREAM_CHUNK":
      return {
        ...state,
        streamingContent: action.accumulated,
      };

    case "SEND_SUCCESS":
      return {
        ...state,
        messages: [
          ...state.messages,
          ...(action.userContent
            ? [{ role: "user" as const, content: action.userContent }]
            : []),
          { role: "assistant" as const, content: action.assistantContent },
        ],
        pendingMessage: null,
        streamingContent: "",
        isLoading: false,
      };

    case "SEND_FAILURE":
      return {
        ...state,
        pendingMessage: state.pendingMessage
          ? { content: state.pendingMessage.content, status: "failed" }
          : null,
        streamingContent: "",
        isLoading: false,
      };

    case "CLEAR_PENDING":
      return {
        ...state,
        pendingMessage: null,
      };

    case "INJECT_SYSTEM_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "course-content" as const, content: action.content },
        ],
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ActiveSurface =
  | { type: "sidebar" }
  | { type: "inline"; sectionIndex: number; segmentIndex: number };

export type UseTutorChatOptions = {
  /** module slug for API calls (the `moduleId` variable in Module.tsx is actually the slug) */
  moduleId: string;
  /** full module object — used for loading chat history */
  module: ModuleType | null;
  currentSectionIndex: number;
  currentSegmentIndex: number;
  currentSection: ModuleSection | undefined;
  isArticleSection: boolean;
  triggerChatActivity: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTutorChat({
  moduleId,
  module,
  currentSectionIndex,
  currentSegmentIndex,
  currentSection,
  isArticleSection,
  triggerChatActivity,
}: UseTutorChatOptions) {
  const [chat, dispatchChat] = useReducer(chatReducer, initialChatState);

  // --- Independent state ---------------------------------------------------

  const [inputText, setInputText] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>({
    type: "sidebar",
  });

  // --- Sidebar auto-open once on first article section visit ---------------

  const sidebarHasAutoOpened = useRef(false);
  useEffect(() => {
    if (!isArticleSection || sidebarHasAutoOpened.current) return;
    sidebarHasAutoOpened.current = true;
    setIsSidebarOpen(true);
  }, [isArticleSection]);

  // --- Close sidebar when leaving article sections -------------------------

  useEffect(() => {
    if (!isArticleSection) setIsSidebarOpen(false);
  }, [isArticleSection]);

  // --- Load chat history when module changes -------------------------------

  useEffect(() => {
    if (!module) return;

    // Clear messages when switching modules
    dispatchChat({ type: "LOAD_HISTORY", messages: [] });

    let cancelled = false;

    async function loadHistory() {
      try {
        const history = await getChatHistory(module!.slug);
        if (cancelled) return;

        if (history.messages.length > 0) {
          // Strip auto-sent assistant messages at the start of history (before the
          // first user message). These were AI-generated opening preambles that are
          // now replaced by the authored Lens bubble (prefixMessage).
          const firstUserIdx = history.messages.findIndex(
            (m) => m.role === "user",
          );
          const messagesToShow =
            firstUserIdx === -1
              ? [] // Only auto-sent messages exist — skip all
              : history.messages.slice(firstUserIdx);

          dispatchChat({
            type: "LOAD_HISTORY",
            messages: messagesToShow.map((m) => ({
              role: m.role as "user" | "assistant" | "course-content",
              content: m.content,
            })),
          });
        }
        // Messages already cleared above if history is empty
      } catch (e) {
        if (!cancelled) {
          console.error("[Module] Failed to load chat history:", e);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [module]);

  // --- Section-transition system messages -----------------------------------

  const prevSegmentRef = useRef<{
    sectionIndex: number;
    segmentIndex: number;
  } | null>(null);
  const hasUserMessage = chat.messages.some((m) => m.role === "user");

  useEffect(() => {
    // Only inject after the user has sent at least one message
    if (!hasUserMessage) return;

    const prev = prevSegmentRef.current;
    const current = {
      sectionIndex: currentSectionIndex,
      segmentIndex: currentSegmentIndex,
    };
    prevSegmentRef.current = current;

    // Skip on first render
    if (!prev) return;
    // Skip if no change
    if (
      prev.sectionIndex === current.sectionIndex &&
      prev.segmentIndex === current.segmentIndex
    )
      return;

    // Determine what changed and build message
    const sectionTitle = currentSection?.meta?.title;
    if (prev.sectionIndex !== current.sectionIndex && sectionTitle) {
      dispatchChat({
        type: "INJECT_SYSTEM_MESSAGE",
        content: `Now reading: ${sectionTitle}`,
      });
    }
    // Segment changed within same section — skip (no message needed)
  }, [currentSectionIndex, currentSegmentIndex, currentSection, hasUserMessage]);

  // --- Computed values -----------------------------------------------------

  /** Index of the first chat segment in the current section (for sidebar send) */
  const sidebarChatSegmentIndex = useMemo(() => {
    if (!currentSection || !isArticleSection) return -1;
    const segments =
      "segments" in currentSection ? currentSection.segments : [];
    return segments?.findIndex((s) => s.type === "chat") ?? -1;
  }, [currentSection, isArticleSection]);

  /** Whether the current section has a chat segment at all */
  const sectionHasChatSegment = useMemo(() => {
    if (!currentSection || !isArticleSection) return false;
    if (!("segments" in currentSection) || !currentSection.segments)
      return false;
    return currentSection.segments.some((s) => s.type === "chat");
  }, [currentSection, isArticleSection]);

  /**
   * Authored opening question for the current section's chat — shown as a
   * "Lens" message in both the sidebar and the NarrativeChatSection.
   *
   * Gathers text segments between the last article-excerpt and the first
   * chat segment that follows it.
   */
  const sectionPrefixMessage = useMemo<ChatMessage | undefined>(() => {
    if (!currentSection || !isArticleSection) return undefined;
    if (!("segments" in currentSection) || !currentSection.segments)
      return undefined;
    const segs = currentSection.segments;
    const lastExcerptIdx = segs.reduceRight(
      (found, s, i) =>
        found === -1 && s.type === "article-excerpt" ? i : found,
      -1,
    );
    if (lastExcerptIdx === -1) return undefined;
    const postExcerpt = segs.slice(lastExcerptIdx + 1);
    const firstChatInPostIdx = postExcerpt.findIndex(
      (s) => s.type === "chat",
    );
    if (firstChatInPostIdx <= 0) return undefined;
    const content = postExcerpt
      .slice(0, firstChatInPostIdx)
      .filter((s) => s.type === "text")
      .map((s) => ("content" in s ? s.content : ""))
      .join("\n\n");
    return content ? { role: "course-content", content } : undefined;
  }, [currentSection, isArticleSection]);

  // --- Inline surface tracking (IntersectionObserver) ----------------------

  const inlineRefs = useRef<Map<string, HTMLElement>>(new Map());
  const ratioMap = useRef<Map<string, number>>(new Map());
  const observerDirty = useRef(false);
  const [observerVersion, setObserverVersion] = useState(0);
  const activeSurfaceLockedUntil = useRef<number | null>(null);

  const registerInlineRef = useCallback(
    (sectionIndex: number, segmentIndex: number, el: HTMLElement | null) => {
      const key = `${sectionIndex}-${segmentIndex}`;
      if (el) {
        inlineRefs.current.set(key, el);
      } else {
        inlineRefs.current.delete(key);
        ratioMap.current.delete(key);
      }
      // Batch: multiple shells mount in the same commit cycle.
      // Schedule one state update instead of N.
      if (!observerDirty.current) {
        observerDirty.current = true;
        queueMicrotask(() => {
          observerDirty.current = false;
          setObserverVersion((v) => v + 1);
        });
      }
    },
    [],
  );

  // --- IntersectionObserver for activeSurface --------------------------------

  useEffect(() => {
    if (!isArticleSection || inlineRefs.current.size === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Skip updates while locked (user just sent a message)
        if (
          activeSurfaceLockedUntil.current &&
          Date.now() < activeSurfaceLockedUntil.current
        )
          return;
        activeSurfaceLockedUntil.current = null; // expired, resume normal behavior

        // Update persistent ratio map
        for (const entry of entries) {
          for (const [key, el] of inlineRefs.current) {
            if (entry.target === el) {
              ratioMap.current.set(key, entry.intersectionRatio);
            }
          }
        }

        // Find most visible from ALL tracked sections
        let best: { key: string; ratio: number } | null = null;
        for (const [key, ratio] of ratioMap.current) {
          if (ratio > 0.15 && (!best || ratio > best.ratio)) {
            best = { key, ratio };
          }
        }

        if (best) {
          const [si, segi] = best.key.split("-").map(Number);
          setActiveSurface((prev) =>
            prev.type === "inline" &&
            prev.sectionIndex === si &&
            prev.segmentIndex === segi
              ? prev // avoid unnecessary re-render
              : { type: "inline", sectionIndex: si, segmentIndex: segi },
          );
        } else {
          setActiveSurface((prev) =>
            prev.type === "sidebar" ? prev : { type: "sidebar" },
          );
        }
      },
      { threshold: [0, 0.15, 0.3, 0.5, 0.7] },
    );

    for (const [, el] of inlineRefs.current) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [isArticleSection, observerVersion]);

  // --- sendMessage ---------------------------------------------------------

  const sendMessage = useCallback(
    async (
      content: string,
      sectionIndex: number,
      segmentIndex: number,
    ) => {
      triggerChatActivity();

      dispatchChat({
        type: "SEND_START",
        content,
        sectionIndex,
        segmentIndex,
      });

      // Lock activeSurface to this inline section for ~2s so observer doesn't override
      setActiveSurface({ type: "inline", sectionIndex, segmentIndex });
      activeSurfaceLockedUntil.current = Date.now() + 2000;

      if (content) {
        trackChatMessageSent(moduleId, content.length);
      }

      try {
        let assistantContent = "";

        for await (const chunk of sendMessageApi(
          moduleId,
          sectionIndex,
          segmentIndex,
          content,
        )) {
          if (chunk.type === "text" && chunk.content) {
            assistantContent += chunk.content;
            dispatchChat({
              type: "STREAM_CHUNK",
              accumulated: assistantContent,
            });
            triggerChatActivity();
          } else if (chunk.type === "error") {
            throw new Error(
              (chunk as unknown as { message?: string }).message ||
                "Chat failed",
            );
          }
        }

        dispatchChat({
          type: "SEND_SUCCESS",
          userContent: content,
          assistantContent,
        });
      } catch {
        dispatchChat({ type: "SEND_FAILURE" });
      }
    },
    [triggerChatActivity, moduleId],
  );

  // --- retryMessage --------------------------------------------------------

  const retryMessage = useCallback(() => {
    if (!chat.pendingMessage || !chat.lastPosition) return;
    const content = chat.pendingMessage.content;
    dispatchChat({ type: "CLEAR_PENDING" });
    sendMessage(
      content,
      chat.lastPosition.sectionIndex,
      chat.lastPosition.segmentIndex,
    );
  }, [chat.pendingMessage, chat.lastPosition, sendMessage]);

  // --- Return --------------------------------------------------------------

  return {
    // Reducer-managed chat state
    messages: chat.messages,
    pendingMessage: chat.pendingMessage,
    streamingContent: chat.streamingContent,
    isLoading: chat.isLoading,

    // Actions
    sendMessage,
    retryMessage,

    // Independent state
    inputText,
    setInputText,
    isSidebarOpen,
    setSidebarOpen: setIsSidebarOpen,
    activeSurface,
    setActiveSurface,

    // Inline surface tracking
    registerInlineRef,

    // Computed
    sectionPrefixMessage,
    sidebarChatSegmentIndex,
    sectionHasChatSegment,
  };
}
