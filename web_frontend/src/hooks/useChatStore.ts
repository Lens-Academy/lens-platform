/**
 * useChatStore — external store for chat message state.
 *
 * Wraps the existing chatReducer in a ref-based store with split subscriptions
 * so that "hot" state (messages, pendingMessage — changes every STREAM_TEXT)
 * only re-renders chat components, while "cold" state (isLoading, sendSource —
 * changes 2-4x per send) is what triggers Module.tsx re-renders.
 *
 * This avoids re-rendering the entire Module page (~2s for long articles) on
 * every streaming text update.
 */

import { useRef, useSyncExternalStore } from "react";
import type { ChatMessage, PendingMessage } from "@/types/module";
import {
  type ChatState,
  type ChatAction,
  chatReducer,
  initialChatState,
} from "./useTutorChat";

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

export type ChatHotState = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
};

export type ChatColdState = {
  isLoading: boolean;
  sendSource: "sidebar" | "inline" | null;
  streamingMessageIndex: number | null;
  lastPosition: { sectionIndex: number; segmentIndex: number } | null;
};

// ---------------------------------------------------------------------------
// ChatStore
// ---------------------------------------------------------------------------

export class ChatStore {
  private state: ChatState = initialChatState;
  private hot: ChatHotState = {
    messages: initialChatState.messages,
    pendingMessage: initialChatState.pendingMessage,
  };
  private cold: ChatColdState = {
    isLoading: initialChatState.isLoading,
    sendSource: initialChatState.sendSource,
    streamingMessageIndex: initialChatState.streamingMessageIndex,
    lastPosition: initialChatState.lastPosition,
  };
  private listeners = new Set<() => void>();

  dispatch = (action: ChatAction) => {
    const prev = this.state;
    const next = chatReducer(prev, action);
    this.state = next;

    // Only create new snapshot objects when the relevant slice changed,
    // so useSyncExternalStore skips re-renders when the slice is unchanged.
    if (
      next.messages !== prev.messages ||
      next.pendingMessage !== prev.pendingMessage
    ) {
      this.hot = {
        messages: next.messages,
        pendingMessage: next.pendingMessage,
      };
    }
    if (
      next.isLoading !== prev.isLoading ||
      next.sendSource !== prev.sendSource ||
      next.streamingMessageIndex !== prev.streamingMessageIndex ||
      next.lastPosition !== prev.lastPosition
    ) {
      this.cold = {
        isLoading: next.isLoading,
        sendSource: next.sendSource,
        streamingMessageIndex: next.streamingMessageIndex,
        lastPosition: next.lastPosition,
      };
    }

    for (const listener of this.listeners) listener();
  };

  /** Full state — for imperative reads (e.g. retryMessage). */
  getState = () => this.state;

  /** Hot snapshot — messages + pendingMessage. */
  getHot = () => this.hot;

  /** Cold snapshot — isLoading, sendSource, etc. */
  getCold = () => this.cold;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Create a stable ChatStore instance (call once in useTutorChat). */
export function useChatStoreRef() {
  const ref = useRef<ChatStore | null>(null);
  if (!ref.current) ref.current = new ChatStore();
  return ref.current;
}

/** Subscribe to hot state (messages, pendingMessage). For chat components. */
export function useChatMessages(store: ChatStore): ChatHotState {
  return useSyncExternalStore(store.subscribe, store.getHot);
}

/** Subscribe to cold state (isLoading, sendSource). For ChatSidebar's filtering. */
export function useChatCold(store: ChatStore): ChatColdState {
  return useSyncExternalStore(store.subscribe, store.getCold);
}
