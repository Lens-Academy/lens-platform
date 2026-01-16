// web_frontend/src/components/lesson-prototypes/shared/usePrototypeLesson.ts

import { useState, useCallback } from "react";
import type { ChatState } from "./types";
import { sendMessage } from "../../../api/lessons";

type UsePrototypeLessonProps = {
  sessionId: number | null;
};

export function usePrototypeLesson({ sessionId }: UsePrototypeLessonProps) {
  // Track chat state per block ID
  const [chatStates, setChatStates] = useState<Record<string, ChatState>>({});
  // Track which blocks are completed (user can proceed)
  const [completedBlocks, setCompletedBlocks] = useState<Set<string>>(
    new Set()
  );
  // Current active block
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  const getChatState = useCallback(
    (blockId: string): ChatState => {
      return (
        chatStates[blockId] || {
          messages: [],
          isStreaming: false,
          streamingContent: "",
        }
      );
    },
    [chatStates]
  );

  const sendChatMessage = useCallback(
    async (blockId: string, content: string) => {
      if (!sessionId) return;

      const defaultState: ChatState = {
        messages: [],
        isStreaming: false,
        streamingContent: "",
      };

      // Add user message optimistically
      setChatStates((prev) => {
        const currentState = prev[blockId] || defaultState;
        return {
          ...prev,
          [blockId]: {
            ...currentState,
            messages: [...currentState.messages, { role: "user", content }],
            isStreaming: true,
            streamingContent: "",
          },
        };
      });

      try {
        let fullResponse = "";
        for await (const chunk of sendMessage(sessionId, content)) {
          if (chunk.type === "content" && chunk.content) {
            fullResponse += chunk.content;
            setChatStates((prev) => ({
              ...prev,
              [blockId]: {
                ...prev[blockId],
                streamingContent: fullResponse,
              },
            }));
          }
        }

        // Finalize message
        setChatStates((prev) => ({
          ...prev,
          [blockId]: {
            messages: [
              ...prev[blockId].messages,
              { role: "assistant", content: fullResponse },
            ],
            isStreaming: false,
            streamingContent: "",
          },
        }));
      } catch (error) {
        console.error("Chat error:", error);
        setChatStates((prev) => ({
          ...prev,
          [blockId]: {
            ...prev[blockId],
            isStreaming: false,
          },
        }));
      }
    },
    [sessionId]
  );

  const markBlockCompleted = useCallback((blockId: string) => {
    setCompletedBlocks((prev) => new Set([...prev, blockId]));
  }, []);

  return {
    chatStates,
    getChatState,
    sendChatMessage,
    completedBlocks,
    markBlockCompleted,
    activeBlockId,
    setActiveBlockId,
  };
}
