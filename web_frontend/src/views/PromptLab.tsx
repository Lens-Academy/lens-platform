import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import FixtureBrowser from "@/components/promptlab/FixtureBrowser";
import PromptEditor from "@/components/promptlab/PromptEditor";
import ConversationPanel from "@/components/promptlab/ConversationPanel";
import type { ConversationMessage } from "@/components/promptlab/ConversationPanel";
import {
  regenerateResponse,
  continueConversation,
  type Fixture,
  type FixtureMessage,
} from "@/api/promptlab";

/**
 * Assemble a full system prompt string from a fixture's parts.
 * Mirrors the _build_system_prompt() logic in core/modules/chat.py.
 */
function buildSystemPrompt(fixture: Fixture): string {
  let prompt = fixture.systemPrompt.base;
  if (fixture.systemPrompt.instructions) {
    prompt += "\n\nInstructions:\n" + fixture.systemPrompt.instructions;
  }
  if (fixture.previousContent) {
    prompt +=
      "\n\nThe user just engaged with this content:\n---\n" +
      fixture.previousContent +
      "\n---";
  }
  return prompt;
}

/**
 * Prompt Lab view -- facilitator tool for testing system prompt variations.
 *
 * Two-panel layout: prompt editor on left, conversation on right.
 * Flow: load fixture -> edit prompt -> select AI message -> regenerate -> compare.
 */
export default function PromptLab() {
  const { isAuthenticated, isLoading, login } = useAuth();

  // Fixture state
  const [fixture, setFixture] = useState<Fixture | null>(null);

  // Conversation state
  const [messages, setMessages] = useState<ConversationMessage[]>([]);

  // Prompt state
  const [systemPrompt, setSystemPrompt] = useState("");
  const [originalSystemPrompt, setOriginalSystemPrompt] = useState("");

  // Interaction state
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<
    number | null
  >(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [hasRegenerated, setHasRegenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref for aborting in-flight requests (not implemented in API client yet,
  // but useful for preventing stale updates on fixture change)
  const streamAbortRef = useRef(false);

  // --- Handlers ---

  const handleLoadFixture = useCallback((loaded: Fixture) => {
    setFixture(loaded);
    setMessages(
      loaded.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    );
    const assembled = buildSystemPrompt(loaded);
    setSystemPrompt(assembled);
    setOriginalSystemPrompt(assembled);
    setSelectedMessageIndex(null);
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingThinking("");
    setHasRegenerated(false);
    setError(null);
    streamAbortRef.current = true;
  }, []);

  const handleChangeFixture = useCallback(() => {
    streamAbortRef.current = true;
    setFixture(null);
    setMessages([]);
    setSystemPrompt("");
    setOriginalSystemPrompt("");
    setSelectedMessageIndex(null);
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingThinking("");
    setHasRegenerated(false);
    setError(null);
  }, []);

  const handleSelectMessage = useCallback(
    (index: number) => {
      // Only allow selecting assistant messages
      if (messages[index]?.role !== "assistant") return;
      setSelectedMessageIndex(index);
      setHasRegenerated(false);
      setError(null);
    },
    [messages],
  );

  const handleRegenerate = useCallback(async () => {
    if (selectedMessageIndex === null) return;

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingThinking("");
    setError(null);
    streamAbortRef.current = false;

    let accumulatedContent = "";
    let accumulatedThinking = "";
    const originalContent = messages[selectedMessageIndex].content;
    const messagesToSend: FixtureMessage[] = messages
      .slice(0, selectedMessageIndex)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      for await (const event of regenerateResponse(
        messagesToSend,
        systemPrompt,
        true,
      )) {
        if (streamAbortRef.current) break;

        if (event.type === "thinking" && event.content) {
          accumulatedThinking += event.content;
          setStreamingThinking(accumulatedThinking);
        } else if (event.type === "text" && event.content) {
          accumulatedContent += event.content;
          setStreamingContent(accumulatedContent);
        } else if (event.type === "error") {
          setError(event.message ?? "An error occurred during regeneration");
        } else if (event.type === "done") {
          // Finalize: replace from selectedMessageIndex onward with regenerated message
          if (accumulatedContent) {
            const regeneratedMessage: ConversationMessage = {
              role: "assistant",
              content: accumulatedContent,
              isRegenerated: true,
              originalContent,
              thinkingContent: accumulatedThinking || undefined,
            };
            setMessages((prev) => [
              ...prev.slice(0, selectedMessageIndex),
              regeneratedMessage,
            ]);
            setHasRegenerated(true);
          }
          setSelectedMessageIndex(null);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to regenerate response",
      );
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingThinking("");
    }
  }, [selectedMessageIndex, messages, systemPrompt]);

  const handleSendFollowUp = useCallback(
    async (message: string) => {
      // Append user message
      const userMessage: ConversationMessage = {
        role: "user",
        content: message,
      };
      setMessages((prev) => [...prev, userMessage]);

      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinking("");
      setError(null);
      streamAbortRef.current = false;

      let accumulatedContent = "";
      let accumulatedThinking = "";

      // Build full message list for the API (need current messages + new user message)
      const allMessages: FixtureMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: message },
      ];

      try {
        for await (const event of continueConversation(
          allMessages,
          systemPrompt,
          true,
        )) {
          if (streamAbortRef.current) break;

          if (event.type === "thinking" && event.content) {
            accumulatedThinking += event.content;
            setStreamingThinking(accumulatedThinking);
          } else if (event.type === "text" && event.content) {
            accumulatedContent += event.content;
            setStreamingContent(accumulatedContent);
          } else if (event.type === "error") {
            setError(
              event.message ?? "An error occurred during continuation",
            );
          } else if (event.type === "done") {
            if (accumulatedContent) {
              const assistantMessage: ConversationMessage = {
                role: "assistant",
                content: accumulatedContent,
                isRegenerated: true,
                thinkingContent: accumulatedThinking || undefined,
              };
              setMessages((prev) => [...prev, assistantMessage]);
            }
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to continue conversation",
        );
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
      }
    },
    [messages, systemPrompt],
  );

  const handleResetPrompt = useCallback(() => {
    setSystemPrompt(originalSystemPrompt);
  }, [originalSystemPrompt]);

  // --- Auth gates ---

  if (isLoading) {
    return (
      <div className="py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-stone-200 rounded" />
          <div className="h-4 w-64 bg-stone-200 rounded" />
          <div className="h-32 bg-stone-200 rounded" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8">
        <h1 className="text-2xl font-bold mb-4">Prompt Lab</h1>
        <p className="mb-4 text-slate-600">
          Please sign in to access the Prompt Lab.
        </p>
        <button
          onClick={login}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  // --- Fixture browser (no fixture selected) ---

  if (!fixture) {
    return (
      <div className="py-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-900">Prompt Lab</h1>
          <p className="text-sm text-slate-500 mt-1">
            Test system prompt variations against saved conversation fixtures.
          </p>
        </div>
        <FixtureBrowser onSelectFixture={handleLoadFixture} />
      </div>
    );
  }

  // --- Two-panel layout (fixture loaded) ---

  const isPromptModified = systemPrompt !== originalSystemPrompt;

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 7rem)" }}>
      {/* Header bar */}
      <div className="flex items-center gap-3 py-2 shrink-0">
        <button
          onClick={handleChangeFixture}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          &larr; Fixtures
        </button>
        <span className="text-sm text-slate-300">|</span>
        <h1 className="text-sm font-medium text-slate-700 truncate">
          {fixture.name}
        </h1>
        {error && (
          <span className="ml-auto text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
            {error}
          </span>
        )}
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-white">
        {/* Left panel: Prompt Editor */}
        <div className="w-1/2 border-r border-gray-200 flex flex-col">
          <PromptEditor
            systemPrompt={systemPrompt}
            onSystemPromptChange={setSystemPrompt}
            onReset={handleResetPrompt}
            isModified={isPromptModified}
          />
        </div>

        {/* Right panel: Conversation */}
        <div className="w-1/2 flex flex-col">
          <ConversationPanel
            messages={messages}
            selectedMessageIndex={selectedMessageIndex}
            streamingContent={streamingContent}
            streamingThinking={streamingThinking}
            isStreaming={isStreaming}
            onSelectMessage={handleSelectMessage}
            onRegenerate={handleRegenerate}
            onSendFollowUp={handleSendFollowUp}
            canRegenerate={selectedMessageIndex !== null}
            canSendFollowUp={hasRegenerated && !isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
