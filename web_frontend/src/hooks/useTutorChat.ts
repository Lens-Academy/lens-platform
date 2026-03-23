/**
 * useTutorChat — centralises all chat state for the Module player.
 *
 * Uses `useReducer` for the chat lifecycle (atomic state transitions)
 * and `useState` / `useRef` for independent concerns (active surface).
 *
 * Sidebar open/close state lives in ChatSidebar (not here) to avoid
 * re-rendering Module on every toggle.
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
import { sendMessage as sendMessageApi, getChatHistory } from "@/api/modules";
import { trackChatMessageSent } from "@/analytics";

// ---------------------------------------------------------------------------
// Chat lifecycle reducer
// ---------------------------------------------------------------------------

export type ChatState = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  lastPosition: { sectionIndex: number; segmentIndex: number } | null;
  sendSource: "sidebar" | "inline" | null;
  /** Live tool call indicator — only used during streaming, cleared on completion */
  activeToolCall: { name: string; state: "calling" | "result" | "error" } | null;
};

export type ChatAction =
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | {
      type: "SEND_START";
      content: string;
      sectionIndex: number;
      segmentIndex: number;
      source: "sidebar" | "inline";
    }
  | { type: "STREAM_CHUNK"; accumulated: string }
  | {
      type: "SEND_SUCCESS";
      userContent: string;
      assistantContent: string;
      systemMessages?: ChatMessage[];
    }
  | { type: "SEND_FAILURE" }
  | { type: "CLEAR_PENDING" }
  | { type: "TOOL_CALL"; name: string; state: "calling" | "result" | "error" };

export const initialChatState: ChatState = {
  messages: [],
  pendingMessage: null,
  streamingContent: "",
  isLoading: false,
  lastPosition: null,
  sendSource: null,
  activeToolCall: null,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
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
        sendSource: action.source,
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
          ...(action.systemMessages || []),
          ...(action.userContent
            ? [{ role: "user" as const, content: action.userContent }]
            : []),
          { role: "assistant" as const, content: action.assistantContent },
        ],
        pendingMessage: null,
        streamingContent: "",
        isLoading: false,
        sendSource: null,
        activeToolCall: null,
      };

    case "SEND_FAILURE":
      return {
        ...state,
        pendingMessage: state.pendingMessage
          ? { content: state.pendingMessage.content, status: "failed" }
          : null,
        streamingContent: "",
        isLoading: false,
        sendSource: null,
        activeToolCall: null,
      };

    case "TOOL_CALL":
      return {
        ...state,
        activeToolCall: { name: action.name, state: action.state },
      };

    case "CLEAR_PENDING":
      return {
        ...state,
        pendingMessage: null,
        sendSource: null,
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
  currentSection: ModuleSection | undefined;
  /** kept for prefix message, chat segment index computations */
  isArticleSection: boolean;
  triggerChatActivity: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTutorChat({
  moduleId,
  module,
  currentSection,
  isArticleSection,
  triggerChatActivity,
}: UseTutorChatOptions) {
  const [chat, dispatchChat] = useReducer(chatReducer, initialChatState);

  // --- Independent state ---------------------------------------------------

  const [activeSurface, setActiveSurface] = useState<ActiveSurface>({
    type: "sidebar",
  });

  /** Section indices where the user has sent at least one chat message */
  const [chatInteractedSections, setChatInteractedSections] = useState<
    Set<number>
  >(() => new Set());

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

          // Extract section indices where the user has sent messages
          const interacted = new Set<number>();
          for (const m of history.messages) {
            if (m.role === "user" && m.sectionIndex != null) {
              interacted.add(m.sectionIndex);
            }
          }
          if (interacted.size > 0) {
            setChatInteractedSections(interacted);
          }

          dispatchChat({
            type: "LOAD_HISTORY",
            messages: messagesToShow.map((m) => ({
              role: m.role as
                | "user"
                | "assistant"
                | "system"
                | "course-content",
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

  // --- Inline surface tracking (IntersectionObserver) ----------------------

  const inlineRefs = useRef<Map<string, HTMLElement>>(new Map());
  const ratioMap = useRef<Map<string, number>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const activeSurfaceLockedUntil = useRef<number | null>(null);

  // --- IntersectionObserver for activeSurface --------------------------------
  // Created once when sidebarAllowed becomes true; elements are observed/
  // unobserved directly in registerInlineRef (no state-driven re-creation).

  useEffect(() => {
    if (!isArticleSection) {
      observerRef.current = null;
      return;
    }

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
          if (ratio > 0 && (!best || ratio > best.ratio)) {
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
      { threshold: [0, 0.3, 0.5, 0.7] },
    );

    observerRef.current = observer;

    // Observe any elements already registered before observer was created
    for (const [, el] of inlineRefs.current) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [isArticleSection]);

  const registerInlineRef = useCallback(
    (sectionIndex: number, segmentIndex: number, el: HTMLElement | null) => {
      const key = `${sectionIndex}-${segmentIndex}`;
      if (el) {
        const prev = inlineRefs.current.get(key);
        if (prev === el) return; // same element, nothing to do
        if (prev) observerRef.current?.unobserve(prev);
        inlineRefs.current.set(key, el);
        observerRef.current?.observe(el);
      } else {
        const prev = inlineRefs.current.get(key);
        if (prev) observerRef.current?.unobserve(prev);
        inlineRefs.current.delete(key);
        ratioMap.current.delete(key);
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
      source?: "sidebar" | "inline",
    ) => {
      triggerChatActivity();

      // Track that the user interacted with this section's chat
      setChatInteractedSections((prev) => {
        if (prev.has(sectionIndex)) return prev;
        const next = new Set(prev);
        next.add(sectionIndex);
        return next;
      });

      dispatchChat({
        type: "SEND_START",
        content,
        sectionIndex,
        segmentIndex,
        source: source ?? "inline",
      });

      // Lock activeSurface so observer doesn't override during streaming
      if (source !== "sidebar") {
        setActiveSurface({ type: "inline", sectionIndex, segmentIndex });
        activeSurfaceLockedUntil.current = Date.now() + 2000;
      }

      if (content) {
        trackChatMessageSent(moduleId, content.length);
      }

      try {
        let assistantContent = "";
        const systemMessages: ChatMessage[] = [];

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
          } else if (chunk.type === "system" && chunk.content) {
            systemMessages.push({
              role: "system" as const,
              content: chunk.content,
            });
          } else if (chunk.type === "tool_use" && chunk.name) {
            dispatchChat({
              type: "TOOL_CALL",
              name: chunk.name as string,
              state: (chunk.state as "calling" | "result" | "error") ?? "calling",
            });
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
          systemMessages,
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
    sendSource: chat.sendSource,
    activeToolCall: chat.activeToolCall,

    // Actions
    sendMessage,
    retryMessage,

    // Independent state
    activeSurface,
    setActiveSurface,

    // Inline surface tracking
    registerInlineRef,

    // Computed
    sidebarChatSegmentIndex,
    sectionHasChatSegment,

    // Chat gate
    chatInteractedSections,
  };
}
