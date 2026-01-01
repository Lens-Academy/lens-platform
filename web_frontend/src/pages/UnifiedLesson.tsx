// web_frontend/src/pages/UnifiedLesson.tsx
import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import type { SessionState, PendingMessage } from "../types/unified-lesson";
import { createSession, getSession, advanceStage, sendMessage } from "../api/lessons";
import ChatPanel from "../components/unified-lesson/ChatPanel";
import ContentPanel from "../components/unified-lesson/ContentPanel";

export default function UnifiedLesson() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingTransition, setPendingTransition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInitiatedStage, setLastInitiatedStage] = useState<number | null>(null);

  // Messages derived from session (server is source of truth)
  const messages = session?.messages ?? [];

  // Initialize session
  useEffect(() => {
    if (!lessonId) return;

    async function init() {
      try {
        const sid = await createSession(lessonId);
        setSessionId(sid);
        const state = await getSession(sid);
        setSession(state);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start lesson");
      }
    }

    init();
  }, [lessonId]);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!sessionId) return;

    // For user messages (non-empty), set pending message for optimistic UI
    if (content) {
      setPendingMessage({ content, status: "sending" });
    }
    setIsLoading(true);
    setStreamingContent("");
    setPendingTransition(false);

    try {
      let assistantContent = "";
      let shouldTransition = false;

      for await (const chunk of sendMessage(sessionId, content)) {
        if (chunk.type === "text" && chunk.content) {
          assistantContent += chunk.content;
          setStreamingContent(assistantContent);
        } else if (chunk.type === "tool_use" && chunk.name === "transition_to_next") {
          shouldTransition = true;
        }
      }

      // Success: clear pending message and fetch fresh session from server
      setPendingMessage(null);
      setStreamingContent("");

      const freshSession = await getSession(sessionId);
      setSession(freshSession);

      if (shouldTransition) {
        setPendingTransition(true);
      }
    } catch (e) {
      // Failure: mark pending message as failed (don't lose user's message)
      if (content) {
        setPendingMessage({ content, status: "failed" });
      }
      setStreamingContent("");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const handleRetryMessage = useCallback(() => {
    if (!pendingMessage) return;
    const content = pendingMessage.content;
    setPendingMessage(null);
    handleSendMessage(content);
  }, [pendingMessage, handleSendMessage]);

  const handleAdvanceStage = useCallback(async () => {
    if (!sessionId) return;

    try {
      const result = await advanceStage(sessionId);
      setPendingTransition(false);

      if (result.completed) {
        setSession(prev => prev ? { ...prev, completed: true, current_stage: null, content: null } : null);
      } else {
        // Fetch fresh session - includes new system messages from server
        const state = await getSession(sessionId);
        setSession(state);
      }
    } catch (e) {
      console.error("Failed to advance:", e);
    }
  }, [sessionId]);

  const handleContinueChatting = useCallback(() => {
    setPendingTransition(false);
  }, []);

  const isChatStage = session?.current_stage?.type === "chat";
  const currentStageIndex = session?.current_stage_index ?? null;

  // Auto-initiate AI when entering any chat stage (initial load or after advancing)
  useEffect(() => {
    if (!sessionId || !session) return;
    if (!isChatStage) return;
    if (isLoading) return;
    if (currentStageIndex === null) return;
    if (lastInitiatedStage === currentStageIndex) return; // Already initiated for this stage

    // Mark this stage as initiated and trigger AI to speak first
    setLastInitiatedStage(currentStageIndex);
    handleSendMessage("");
  }, [sessionId, session, currentStageIndex, isChatStage, isLoading, lastInitiatedStage, handleSendMessage]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/" className="text-blue-600 hover:underline">Go home</a>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading lesson...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{session.lesson_title}</h1>
          <p className="text-sm text-gray-500">
            Stage {session.current_stage_index + 1} of {session.total_stages}
          </p>
        </div>
        {!isChatStage && (
          <button
            onClick={handleAdvanceStage}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            Skip →
          </button>
        )}
      </header>

      {/* Main content - split panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat panel - left */}
        <div className="w-1/2 border-r border-gray-200 bg-white">
          <ChatPanel
            messages={messages}
            pendingMessage={pendingMessage}
            onSendMessage={handleSendMessage}
            onRetryMessage={handleRetryMessage}
            isLoading={isLoading}
            streamingContent={streamingContent}
            currentStage={session.current_stage}
            pendingTransition={pendingTransition}
            onConfirmTransition={handleAdvanceStage}
            onContinueChatting={handleContinueChatting}
            disabled={!isChatStage}
          />
        </div>

        {/* Content panel - right */}
        <div className="w-1/2 bg-white">
          <ContentPanel
            stage={session.current_stage}
            articleContent={session.content || undefined}
            onVideoEnded={handleAdvanceStage}
            onNextClick={handleAdvanceStage}
          />
        </div>
      </div>
    </div>
  );
}
