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
  currentSectionIndex: _currentSectionIndex,
  currentSegmentIndex: _currentSegmentIndex,
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

  // --- registerInlineRef stub (Task 7 implements real IntersectionObserver) -

  const inlineRefsMap = useRef<Map<string, HTMLElement>>(new Map());

  const registerInlineRef = useCallback(
    (sectionIndex: number, segmentIndex: number, el: HTMLElement | null) => {
      const key = `${sectionIndex}:${segmentIndex}`;
      if (el) {
        inlineRefsMap.current.set(key, el);
      } else {
        inlineRefsMap.current.delete(key);
      }
    },
    [],
  );

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

    // Stub for Task 7
    registerInlineRef,

    // Computed
    sectionPrefixMessage,
    sidebarChatSegmentIndex,
    sectionHasChatSegment,
  };
}
