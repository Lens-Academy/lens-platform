import { useState, useRef, useCallback, useEffect } from "react";
import {
  regenerateResponse,
  continueConversation,
  type FixtureMessage,
} from "@/api/promptlab";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  isRegenerated?: boolean;
  originalContent?: string;
  thinkingContent?: string;
}

export interface ConversationSlotState {
  messages: ConversationMessage[];
  selectedMessageIndex: number | null;
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  hasRegenerated: boolean;
  error: string | null;
}

export interface ConversationSlotActions {
  selectMessage: (index: number) => void;
  regenerate: (
    baseSystemPrompt: string,
    instructions: string,
    context: string,
    enableThinking: boolean,
    effort: string,
    messageIndex?: number,
  ) => Promise<void>;
  sendFollowUp: (
    message: string,
    baseSystemPrompt: string,
    instructions: string,
    context: string,
    enableThinking: boolean,
    effort: string,
  ) => Promise<void>;
  dismissError: () => void;
  reset: (newMessages: ConversationMessage[]) => void;
}

export function useConversationSlot(
  initialMessages: ConversationMessage[],
): ConversationSlotState & ConversationSlotActions {
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [hasRegenerated, setHasRegenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  // Refs to avoid stale closures in async callbacks
  const messagesRef = useRef(messages);
  const selectedMessageIndexRef = useRef(selectedMessageIndex);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { selectedMessageIndexRef.current = selectedMessageIndex; }, [selectedMessageIndex]);

  const selectMessage = useCallback(
    (index: number) => {
      if (messages[index]?.role !== "assistant") return;
      setSelectedMessageIndex(index);
      setHasRegenerated(false);
      setError(null);
    },
    [messages],
  );

  const regenerate = useCallback(
    async (baseSystemPrompt: string, instructions: string, context: string, enableThinking: boolean, effort: string, messageIndex?: number) => {
      // Use provided messageIndex (from Regenerate All) or fall back to current selection
      const idx = messageIndex ?? selectedMessageIndexRef.current;
      if (idx === null) return;

      const currentMessages = messagesRef.current;

      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinking("");
      setError(null);
      abortRef.current = false;

      let accContent = "";
      let accThinking = "";
      const originalContent = currentMessages[idx]?.content ?? "";
      const messagesToSend: FixtureMessage[] = currentMessages
        .slice(0, idx)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        for await (const event of regenerateResponse(
          messagesToSend,
          baseSystemPrompt,
          instructions,
          context,
          enableThinking,
          effort,
        )) {
          if (abortRef.current) break;

          if (event.type === "thinking" && event.content) {
            accThinking += event.content;
            setStreamingThinking(accThinking);
          } else if (event.type === "text" && event.content) {
            accContent += event.content;
            setStreamingContent(accContent);
          } else if (event.type === "error") {
            console.error("Regeneration error:", event.message);
            setError(event.message ?? "An error occurred during regeneration");
          } else if (event.type === "done") {
            if (accContent) {
              const regeneratedMessage: ConversationMessage = {
                role: "assistant",
                content: accContent,
                isRegenerated: true,
                originalContent,
                thinkingContent: accThinking || undefined,
              };
              setMessages((prev) => [
                ...prev.slice(0, idx),
                regeneratedMessage,
              ]);
              setHasRegenerated(true);
            }
            setSelectedMessageIndex(null);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to regenerate response");
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
      }
    },
    [],
  );

  const sendFollowUp = useCallback(
    async (message: string, baseSystemPrompt: string, instructions: string, context: string, enableThinking: boolean, effort: string) => {
      const userMessage: ConversationMessage = { role: "user", content: message };
      setMessages((prev) => [...prev, userMessage]);

      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinking("");
      setError(null);
      abortRef.current = false;

      let accContent = "";
      let accThinking = "";

      const allMessages: FixtureMessage[] = [
        ...messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: message },
      ];

      try {
        for await (const event of continueConversation(
          allMessages,
          baseSystemPrompt,
          instructions,
          context,
          enableThinking,
          effort,
        )) {
          if (abortRef.current) break;

          if (event.type === "thinking" && event.content) {
            accThinking += event.content;
            setStreamingThinking(accThinking);
          } else if (event.type === "text" && event.content) {
            accContent += event.content;
            setStreamingContent(accContent);
          } else if (event.type === "error") {
            console.error("Continuation error:", event.message);
            setError(event.message ?? "An error occurred");
          } else if (event.type === "done") {
            if (accContent) {
              const assistantMessage: ConversationMessage = {
                role: "assistant",
                content: accContent,
                thinkingContent: accThinking || undefined,
              };
              setMessages((prev) => [...prev, assistantMessage]);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to continue conversation");
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
      }
    },
    [],
  );

  const dismissError = useCallback(() => setError(null), []);

  const reset = useCallback((newMessages: ConversationMessage[]) => {
    abortRef.current = true;
    setMessages(newMessages);
    setSelectedMessageIndex(null);
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingThinking("");
    setHasRegenerated(false);
    setError(null);
  }, []);

  return {
    messages,
    selectedMessageIndex,
    isStreaming,
    streamingContent,
    streamingThinking,
    hasRegenerated,
    error,
    selectMessage,
    regenerate,
    sendFollowUp,
    dismissError,
    reset,
  };
}
