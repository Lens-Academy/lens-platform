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
  isLoading: boolean;
  /** Index into messages[] of the assistant message currently being streamed into. */
  streamingMessageIndex: number | null;
  lastPosition: { sectionIndex: number; segmentIndex: number } | null;
  sendSource: "sidebar" | "inline" | null;
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
  | { type: "STREAM_TEXT"; text: string }
  | { type: "TOOL_CALL_START"; name: string }
  | { type: "TOOL_CALL_DONE"; name: string; result?: string }
  | { type: "SYSTEM_MESSAGE"; content: string }
  | { type: "SEND_SUCCESS" }
  | { type: "SEND_FAILURE" }
  | { type: "CLEAR_PENDING" };

export const initialChatState: ChatState = {
  messages: [],
  pendingMessage: null,
  isLoading: false,
  streamingMessageIndex: null,
  lastPosition: null,
  sendSource: null,
};

/** Helper: shallow-copy messages array with an updated message at index. */
function updateMessageAt(
  messages: ChatMessage[],
  index: number,
  updater: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const copy = [...messages];
  copy[index] = updater(copy[index]);
  return copy;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "LOAD_HISTORY":
      return {
        ...state,
        messages: action.messages,
        pendingMessage: null,
        isLoading: false,
        streamingMessageIndex: null,
      };

    case "SEND_START": {
      if (state.isLoading) return state; // reject concurrent sends

      const newMessages = [...state.messages];
      if (action.content) {
        newMessages.push({ role: "user" as const, content: action.content });
      }
      newMessages.push({ role: "assistant" as const, content: "" });

      return {
        ...state,
        messages: newMessages,
        // Don't set pendingMessage here — the user message is already in messages[].
        // pendingMessage is only set on SEND_FAILURE for the "Failed to send" indicator.
        pendingMessage: null,
        isLoading: true,
        streamingMessageIndex: newMessages.length - 1,
        lastPosition: {
          sectionIndex: action.sectionIndex,
          segmentIndex: action.segmentIndex,
        },
        sendSource: action.source,
      };
    }

    case "STREAM_TEXT": {
      if (state.streamingMessageIndex == null) return state;
      const idx = state.streamingMessageIndex;
      return {
        ...state,
        messages: updateMessageAt(state.messages, idx, (msg) => ({
          ...msg,
          content: msg.content + action.text,
        })),
      };
    }

    case "TOOL_CALL_START": {
      if (state.streamingMessageIndex == null) return state;
      const idx = state.streamingMessageIndex;
      const currentMsg = state.messages[idx];

      // Freeze current assistant message with tool_calls metadata
      const frozenAssistant: ChatMessage = {
        ...currentMsg,
        tool_calls: [
          {
            id: "",
            type: "function",
            function: { name: action.name, arguments: "" },
          },
        ],
      };

      // Tool placeholder (empty content = "calling" state)
      const toolPlaceholder: ChatMessage = {
        role: "tool" as const,
        tool_call_id: "",
        name: action.name,
        content: "",
      };

      // New empty assistant for post-tool text
      const newAssistant: ChatMessage = {
        role: "assistant" as const,
        content: "",
      };

      const newMessages = [...state.messages];
      newMessages[idx] = frozenAssistant;
      newMessages.push(toolPlaceholder, newAssistant);

      return {
        ...state,
        messages: newMessages,
        streamingMessageIndex: newMessages.length - 1,
      };
    }

    case "TOOL_CALL_DONE": {
      // Find the last tool message with matching name and empty content
      const toolIdx = state.messages.findLastIndex(
        (m) => m.role === "tool" && "name" in m && m.name === action.name && !m.content,
      );
      if (toolIdx === -1) return state;

      return {
        ...state,
        messages: updateMessageAt(state.messages, toolIdx, (msg) => ({
          ...msg,
          content: action.result ?? "",
        })),
      };
    }

    case "SYSTEM_MESSAGE": {
      if (state.streamingMessageIndex == null) return state;
      const idx = state.streamingMessageIndex;
      const newMessages = [...state.messages];
      const systemMsg: ChatMessage = {
        role: "system" as const,
        content: action.content,
      };
      newMessages.splice(idx, 0, systemMsg);

      return {
        ...state,
        messages: newMessages,
        streamingMessageIndex: idx + 1,
      };
    }

    case "SEND_SUCCESS": {
      // Remove trailing empty assistant message if present
      const newMessages = [...state.messages];
      const lastMsg = newMessages[newMessages.length - 1];
      if (
        lastMsg?.role === "assistant" &&
        !lastMsg.content?.trim() &&
        !("tool_calls" in lastMsg && lastMsg.tool_calls)
      ) {
        newMessages.pop();
      }

      return {
        ...state,
        messages: newMessages,
        pendingMessage: null,
        isLoading: false,
        streamingMessageIndex: null,
        sendSource: null,
      };
    }

    case "SEND_FAILURE": {
      // Find the user message that was sent (last user message in the array)
      const lastUserMsg = [...state.messages].reverse().find((m) => m.role === "user");
      return {
        ...state,
        pendingMessage: lastUserMsg
          ? { content: lastUserMsg.content, status: "failed" as const }
          : null,
        isLoading: false,
        streamingMessageIndex: null,
        sendSource: null,
      };
    }

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
  /** course slug from URL — used for course overview in system prompt */
  courseSlug?: string;
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
  courseSlug,
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
            messages: messagesToShow.map((m) => {
              if (m.role === "tool") {
                return {
                  role: "tool" as const,
                  tool_call_id: m.tool_call_id ?? "",
                  name: m.name ?? "",
                  content: m.content ?? "",
                };
              }
              const msg: ChatMessage = {
                role: m.role as "user" | "assistant" | "system" | "course-content",
                content: m.content ?? "",
              };
              if (m.tool_calls) {
                (msg as { tool_calls?: unknown }).tool_calls = m.tool_calls;
              }
              return msg;
            }),
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
        for await (const chunk of sendMessageApi(
          moduleId,
          sectionIndex,
          segmentIndex,
          content,
          courseSlug,
        )) {
          if (chunk.type === "text" && chunk.content) {
            dispatchChat({ type: "STREAM_TEXT", text: chunk.content });
            triggerChatActivity();
          } else if (chunk.type === "system" && chunk.content) {
            dispatchChat({ type: "SYSTEM_MESSAGE", content: chunk.content });
          } else if (chunk.type === "tool_use" && chunk.name) {
            const toolState = (chunk.state as string) ?? "calling";
            if (toolState === "calling") {
              dispatchChat({ type: "TOOL_CALL_START", name: chunk.name as string });
            } else {
              dispatchChat({
                type: "TOOL_CALL_DONE",
                name: chunk.name as string,
                result: (chunk as Record<string, unknown>).result as string || "",
              });
            }
          } else if (chunk.type === "error") {
            throw new Error(
              (chunk as unknown as { message?: string }).message ||
                "Chat failed",
            );
          }
        }

        dispatchChat({ type: "SEND_SUCCESS" });
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
    isLoading: chat.isLoading,
    sendSource: chat.sendSource,

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
