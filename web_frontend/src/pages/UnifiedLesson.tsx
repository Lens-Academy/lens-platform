// web_frontend/src/pages/UnifiedLesson.tsx
import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import type { SessionState, PendingMessage, ArticleData } from "../types/unified-lesson";
import { createSession, getSession, advanceStage, sendMessage } from "../api/lessons";
import ChatPanel from "../components/unified-lesson/ChatPanel";
import ContentPanel from "../components/unified-lesson/ContentPanel";
import StageProgressBar from "../components/unified-lesson/StageProgressBar";
import LessonCompleteModal from "../components/unified-lesson/LessonCompleteModal";

export default function UnifiedLesson() {
  const { courseId, lessonId } = useParams<{ courseId?: string; lessonId: string }>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingTransition, setPendingTransition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInitiatedStage, setLastInitiatedStage] = useState<number | null>(null);
  const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(null);
  // Cache for viewed stage content - prevents overwriting current stage's article
  const [viewedContentCache, setViewedContentCache] = useState<Record<number, ArticleData>>({});

  // Messages derived from session (server is source of truth)
  const messages = session?.messages ?? [];

  // Initialize session
  useEffect(() => {
    if (!lessonId) return;

    let completed = false;
    const timeoutId = setTimeout(() => {
      if (!completed) {
        console.warn(`[UnifiedLesson] Session init taking >3s for lesson ${lessonId}`);
      }
    }, 3000);

    async function init() {
      const startTime = Date.now();
      try {
        const sid = await createSession(lessonId!);
        setSessionId(sid);
        const state = await getSession(sid);
        completed = true;
        clearTimeout(timeoutId);
        console.log(`[UnifiedLesson] Session initialized in ${Date.now() - startTime}ms`);
        setSession(state);
      } catch (e) {
        completed = true;
        clearTimeout(timeoutId);
        console.error(`[UnifiedLesson] Session init failed after ${Date.now() - startTime}ms:`, e);
        setError(e instanceof Error ? e.message : "Failed to start lesson");
      }
    }

    init();

    return () => clearTimeout(timeoutId);
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

      // Success: streaming response confirms server received user message
      // Optimistically append both messages to local state (no refetch needed)
      setSession(prev => prev ? {
        ...prev,
        messages: [
          ...prev.messages,
          ...(content ? [{ role: "user" as const, content }] : []),
          { role: "assistant" as const, content: assistantContent }
        ]
      } : prev);
      setPendingMessage(null);
      setStreamingContent("");

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

  // Derived values for reviewing previous stages
  const isReviewing = viewingStageIndex !== null;

  // Get indices of reviewable stages (article/video only, before current)
  const getReviewableStages = useCallback(() => {
    if (!session?.stages) return [];
    return session.stages
      .map((stage, index) => ({ stage, index }))
      .filter(({ stage, index }) =>
        stage.type !== 'chat' && index < session.current_stage_index
      );
  }, [session?.stages, session?.current_stage_index]);

  const handleGoBack = useCallback(() => {
    const reviewable = getReviewableStages();
    const currentViewing = viewingStageIndex ?? session?.current_stage_index ?? 0;
    const earlier = reviewable.filter(s => s.index < currentViewing);
    if (earlier.length) {
      setViewingStageIndex(earlier[earlier.length - 1].index);
    }
  }, [getReviewableStages, viewingStageIndex, session?.current_stage_index]);

  const handleGoForward = useCallback(() => {
    const reviewable = getReviewableStages();
    const currentViewing = viewingStageIndex ?? session?.current_stage_index ?? 0;
    const currentStageIndex = session?.current_stage_index ?? 0;

    // Find next reviewable stage between here and current
    const later = reviewable.filter(s => s.index > currentViewing && s.index < currentStageIndex);
    if (later.length) {
      setViewingStageIndex(later[0].index);
    } else {
      // No more reviewable stages ahead - go to current (even if it's a chat)
      setViewingStageIndex(null);
    }
  }, [getReviewableStages, viewingStageIndex, session?.current_stage_index]);

  const handleReturnToCurrent = useCallback(() => {
    setViewingStageIndex(null);
  }, []);

  const handleStageClick = useCallback((index: number) => {
    // If clicking current stage, exit review mode
    if (index === session?.current_stage_index) {
      setViewingStageIndex(null);
    } else {
      setViewingStageIndex(index);
    }
  }, [session?.current_stage_index]);

  // Compute navigation states
  const reviewableStages = getReviewableStages();
  const currentViewing = viewingStageIndex ?? (session?.current_stage_index ?? 0);
  const canGoBack = reviewableStages.some(s => s.index < currentViewing);
  // Forward enabled if reviewing and not already at current stage
  const canGoForward = isReviewing && currentViewing < (session?.current_stage_index ?? 0);

  // Get the stage to display (reviewed or current)
  const displayedStage = useMemo(() => {
    if (!session?.stages) return session?.current_stage ?? null;
    if (viewingStageIndex !== null) {
      return session.stages[viewingStageIndex] ?? null;
    }
    return session.current_stage;
  }, [session?.stages, session?.current_stage, viewingStageIndex]);

  // Get the article to display - from cache when reviewing, from session otherwise
  const articleToDisplay = useMemo(() => {
    if (viewingStageIndex !== null) {
      return viewedContentCache[viewingStageIndex] ?? null;
    }
    return session?.article ?? null;
  }, [viewingStageIndex, viewedContentCache, session?.article]);

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

  // Fetch content for viewed stage when reviewing
  useEffect(() => {
    if (!sessionId || viewingStageIndex === null) return;

    // Check if we already have this content cached
    if (viewedContentCache[viewingStageIndex]) {
      return;
    }

    let isCurrent = true; // Track if this request is still relevant

    const timeoutId = setTimeout(() => {
      if (isCurrent) {
        console.warn(`[UnifiedLesson] Content fetch taking >3s for stage ${viewingStageIndex}`, {
          sessionId,
          viewingStageIndex,
        });
      }
    }, 3000);

    async function fetchViewedContent() {
      const startTime = Date.now();
      try {
        const state = await getSession(sessionId!, viewingStageIndex!);
        clearTimeout(timeoutId);

        // Only update if this request is still relevant (user hasn't navigated away)
        if (isCurrent && state.article) {
          console.log(`[UnifiedLesson] Fetched stage ${viewingStageIndex} in ${Date.now() - startTime}ms`);
          // Store in cache instead of overwriting session.article
          setViewedContentCache(prev => ({
            ...prev,
            [viewingStageIndex!]: state.article!
          }));
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (isCurrent) {
          console.error(`[UnifiedLesson] Failed to fetch stage ${viewingStageIndex} after ${Date.now() - startTime}ms:`, e);
        }
      }
    }

    fetchViewedContent();

    return () => {
      isCurrent = false; // Mark as stale on cleanup
      clearTimeout(timeoutId);
    };
  }, [sessionId, viewingStageIndex, viewedContentCache]);

  // Reset viewingStageIndex when advancing to new stage
  useEffect(() => {
    setViewingStageIndex(null);
  }, [session?.current_stage_index]);

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
      <header className="bg-white border-b border-gray-200 px-4 py-4 relative">
        {/* Title - left aligned */}
        <h1 className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-gray-900">
          {session.lesson_title}
        </h1>
        {/* Progress bar - centered */}
        <div className="flex items-center justify-center">
          <StageProgressBar
            stages={session.stages}
            currentStageIndex={session.current_stage_index}
            viewingStageIndex={viewingStageIndex}
            onStageClick={handleStageClick}
            onPrevious={handleGoBack}
            onNext={handleGoForward}
            canGoPrevious={canGoBack}
            canGoNext={canGoForward}
          />
        </div>
        {/* Skip/return button - absolute right */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          {isReviewing ? (
            <button
              onClick={handleReturnToCurrent}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              Return to current section →
            </button>
          ) : (
            <button
              onClick={handleAdvanceStage}
              className="text-gray-500 hover:text-gray-700 text-sm cursor-pointer"
            >
              Skip section →
            </button>
          )}
        </div>
      </header>

      {/* Main content - split panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat panel - left */}
        <div className={`w-1/2 relative ${
          isChatStage && !isReviewing
            ? "bg-white z-30"
            : "bg-gray-50"
        }`}>
          {/* Dimming overlay when not focused */}
          {(!isChatStage || isReviewing) && (
            <div className="absolute inset-0 bg-gray-50/25 pointer-events-none z-10" />
          )}
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
            showDisclaimer={!isChatStage || isReviewing}
            isReviewing={isReviewing}
          />
        </div>

        {/* Content panel - right */}
        <div className={`w-1/2 relative ${
          !isChatStage || isReviewing
            ? "bg-white z-30"
            : "bg-gray-50"
        }`}>
          {/* Dimming overlay when not focused */}
          {(isChatStage && !isReviewing) && (
            <div className="absolute inset-0 bg-gray-50/25 pointer-events-none z-10" />
          )}
          <ContentPanel
            stage={displayedStage}
            article={articleToDisplay}
            onVideoEnded={handleAdvanceStage}
            onNextClick={handleAdvanceStage}
            isReviewing={isReviewing}
            previousArticle={session.previous_article}
            previousStage={session.previous_stage}
            showUserPreviousContent={session.show_user_previous_content}
          />
        </div>
      </div>

      <LessonCompleteModal
        courseId={courseId}
        lessonId={lessonId!}
        isOpen={session.completed || !session.current_stage}
      />
    </div>
  );
}
