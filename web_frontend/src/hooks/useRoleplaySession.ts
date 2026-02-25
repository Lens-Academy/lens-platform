/**
 * useRoleplaySession - Manages the full roleplay session lifecycle.
 *
 * Provides isolated state for a single roleplay conversation: messages,
 * streaming content, pending message, completion, and retry. Separate
 * from Module.tsx's shared chat state to prevent cross-contamination
 * (Pitfall 2 in RESEARCH.md).
 *
 * Uses an AbortController to cancel in-flight SSE streams on unmount
 * or retry.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  sendRoleplayMessage,
  getRoleplayHistory,
  completeRoleplay,
  retryRoleplay,
} from "@/api/roleplay";

export interface UseRoleplaySessionReturn {
  messages: Array<{ role: string; content: string }>;
  pendingMessage: { content: string; status: "sending" | "failed" } | null;
  streamingContent: string;
  isLoading: boolean;
  isCompleted: boolean;
  sessionId: number | null;
  /** Full assistant response text from the most recent streaming response (for TTS) */
  lastAssistantResponse: string | null;
  sendMessage: (content: string) => void;
  complete: () => Promise<void>;
  retry: () => Promise<void>;
}

export function useRoleplaySession(
  moduleSlug: string,
  roleplayId: string,
  aiInstructions: string,
  scenarioContent: string | undefined,
  openingMessage: string | undefined,
): UseRoleplaySessionReturn {
  const [messages, setMessages] = useState<
    Array<{ role: string; content: string }>
  >([]);
  const [pendingMessage, setPendingMessage] = useState<{
    content: string;
    status: "sending" | "failed";
  } | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [lastAssistantResponse, setLastAssistantResponse] = useState<
    string | null
  >(null);

  // Track whether the component is mounted to avoid stale state updates
  const mountedRef = useRef(true);
  // Track active async generator for cleanup
  const activeStreamRef = useRef<AsyncGenerator | null>(null);
  // Track whether initial load has been triggered to prevent double-fire
  const initialLoadTriggeredRef = useRef(false);

  /**
   * Stream a roleplay message and accumulate the response.
   * Used by both sendMessage and the initial opening message load.
   */
  const streamMessage = useCallback(
    async (userMessage: string) => {
      if (!mountedRef.current) return;

      setIsLoading(true);
      setStreamingContent("");
      setLastAssistantResponse(null);

      let accumulated = "";

      try {
        const generator = sendRoleplayMessage({
          moduleSlug,
          roleplayId,
          message: userMessage,
          aiInstructions,
          scenarioContent,
          openingMessage,
        });
        activeStreamRef.current = generator;

        for await (const event of generator) {
          if (!mountedRef.current) break;

          if (event.type === "text" && event.content) {
            accumulated += event.content;
            setStreamingContent(accumulated);
          } else if (event.type === "done") {
            // Stream complete
            break;
          } else if (event.type === "error") {
            throw new Error(event.message || "Streaming error");
          }
        }

        activeStreamRef.current = null;

        if (!mountedRef.current) return;

        // Append the complete assistant message
        if (accumulated) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: accumulated },
          ]);
          setLastAssistantResponse(accumulated);
        }

        setStreamingContent("");
        setPendingMessage(null);
      } catch (error) {
        activeStreamRef.current = null;
        if (!mountedRef.current) return;

        console.error("[useRoleplaySession] Stream error:", error);
        setPendingMessage((prev) =>
          prev ? { ...prev, status: "failed" } : null,
        );
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [moduleSlug, roleplayId, aiInstructions, scenarioContent, openingMessage],
  );

  /**
   * Load existing session history on mount.
   * If the session is new and has an opening message, trigger initial load.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const history = await getRoleplayHistory(moduleSlug, roleplayId);

        if (cancelled || !mountedRef.current) return;

        setSessionId(history.sessionId || null);
        setMessages(history.messages);
        setIsCompleted(!!history.completedAt);

        // If session is new (no messages) and has an opening message,
        // trigger the initial load by sending an empty message
        if (
          history.messages.length === 0 &&
          openingMessage &&
          !initialLoadTriggeredRef.current
        ) {
          initialLoadTriggeredRef.current = true;
          // The backend handles inserting the opening message when
          // receiving an empty message for a new session
          await streamMessage("");
        }
      } catch (error) {
        if (cancelled) return;
        console.error("[useRoleplaySession] Failed to load history:", error);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [moduleSlug, roleplayId, openingMessage, streamMessage]);

  /**
   * Send a user message and stream the assistant response.
   */
  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim() || isLoading || isCompleted) return;

      // Add user message to the list immediately
      setMessages((prev) => [...prev, { role: "user", content }]);
      setPendingMessage({ content, status: "sending" });

      // Stream the response
      streamMessage(content);
    },
    [isLoading, isCompleted, streamMessage],
  );

  /**
   * Mark the session as complete.
   */
  const complete = useCallback(async () => {
    if (!sessionId || isCompleted) return;

    try {
      await completeRoleplay(sessionId);
      if (mountedRef.current) {
        setIsCompleted(true);
      }
    } catch (error) {
      console.error("[useRoleplaySession] Failed to complete:", error);
      throw error;
    }
  }, [sessionId, isCompleted]);

  /**
   * Archive the current session and start fresh.
   */
  const retry = useCallback(async () => {
    if (!sessionId) return;

    // Cancel any active stream
    if (activeStreamRef.current) {
      try {
        await activeStreamRef.current.return(undefined);
      } catch {
        // Ignore cleanup errors
      }
      activeStreamRef.current = null;
    }

    try {
      const result = await retryRoleplay(sessionId, openingMessage);

      if (!mountedRef.current) return;

      // Reset all state
      setMessages([]);
      setPendingMessage(null);
      setStreamingContent("");
      setIsLoading(false);
      setIsCompleted(false);
      setLastAssistantResponse(null);
      setSessionId(result.sessionId);

      // If opening message exists, trigger initial load for the new session
      if (openingMessage) {
        initialLoadTriggeredRef.current = true;
        await streamMessage("");
      }
    } catch (error) {
      console.error("[useRoleplaySession] Failed to retry:", error);
      throw error;
    }
  }, [sessionId, openingMessage, streamMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (activeStreamRef.current) {
        activeStreamRef.current.return(undefined).catch(() => {});
        activeStreamRef.current = null;
      }
    };
  }, []);

  return {
    messages,
    pendingMessage,
    streamingContent,
    isLoading,
    isCompleted,
    sessionId,
    lastAssistantResponse,
    sendMessage,
    complete,
    retry,
  };
}
