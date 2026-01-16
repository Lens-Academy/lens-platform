// web_frontend/src/pages/UnifiedLesson.tsx
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import type {
  SessionState,
  PendingMessage,
  ArticleData,
  Stage,
} from "../types/unified-lesson";
import type { StageInfo } from "../types/course";
import {
  createSession,
  getSession,
  advanceStage,
  sendMessage,
  claimSession,
  getNextLesson,
  RequestTimeoutError,
} from "../api/lessons";
import type { LessonCompletionResult } from "../api/lessons";
import { useAuth } from "../hooks/useAuth";
import { useAnonymousSession } from "../hooks/useAnonymousSession";
import { useActivityTracker } from "../hooks/useActivityTracker";
import { useVideoActivityTracker } from "../hooks/useVideoActivityTracker";
import ChatPanel from "../components/unified-lesson/ChatPanel";
import ContentPanel from "../components/unified-lesson/ContentPanel";
import LessonCompleteModal from "../components/unified-lesson/LessonCompleteModal";
import { LessonHeader } from "../components/LessonHeader";
import AuthPromptModal from "../components/unified-lesson/AuthPromptModal";
import LessonDrawer from "../components/unified-lesson/LessonDrawer";
import {
  trackLessonStarted,
  trackLessonCompleted,
  trackChatOpened,
  trackChatMessageSent,
} from "../analytics";
import { Sentry } from "../errorTracking";

export default function UnifiedLesson() {
  const { lessonId, courseId } = useParams<{
    lessonId: string;
    courseId?: string;
  }>();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingTransition, setPendingTransition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInitiatedStage, setLastInitiatedStage] = useState<number | null>(
    null
  );
  const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(
    null
  );
  // Cache for viewed stage content - prevents overwriting current stage's article
  const [viewedContentCache, setViewedContentCache] = useState<
    Record<number, ArticleData>
  >({});
  // Error state for viewed stage content fetch
  const [viewedStageError, setViewedStageError] = useState<string | null>(null);

  // Analytics tracking refs
  const hasTrackedLessonStart = useRef(false);

  // Anonymous session flow
  const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } = useAuth();
  const { getStoredSessionId, storeSessionId, clearSessionId } =
    useAnonymousSession(lessonId!);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [hasPromptedAuth, setHasPromptedAuth] = useState(false);

  // Lesson drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Lesson completion result for completion modal
  const [lessonCompletionResult, setLessonCompletionResult] = useState<LessonCompletionResult>(null);

  // State for dismissing the completion modal (allows user to stay on lesson)
  const [completionModalDismissed, setCompletionModalDismissed] = useState(false);

  // Messages derived from session (server is source of truth)
  const messages = session?.messages ?? [];

  // Derive current stage info for activity tracking
  const currentStageType = session?.current_stage?.type;
  const stageIndexForTracking = session?.current_stage_index ?? 0;
  const isViewingCurrentStage = viewingStageIndex === null;

  // Activity tracking for article stages (3 min inactivity timeout)
  useActivityTracker({
    sessionId: sessionId ?? 0,
    stageIndex: stageIndexForTracking,
    stageType: "article",
    inactivityTimeout: 180_000, // 3 minutes
    enabled:
      !!sessionId &&
      !!lessonId &&
      currentStageType === "article" &&
      isViewingCurrentStage,
  });

  // Activity tracking for video stages
  const videoTracker = useVideoActivityTracker({
    sessionId: sessionId ?? 0,
    stageIndex: stageIndexForTracking,
    enabled:
      !!sessionId &&
      !!lessonId &&
      currentStageType === "video" &&
      isViewingCurrentStage,
  });

  // Activity tracking for chat stages (5 min inactivity timeout)
  const { triggerActivity: triggerChatActivity } = useActivityTracker({
    sessionId: sessionId ?? 0,
    stageIndex: stageIndexForTracking,
    stageType: "chat",
    inactivityTimeout: 300_000, // 5 minutes
    enabled:
      !!sessionId &&
      !!lessonId &&
      currentStageType === "chat" &&
      isViewingCurrentStage,
  });

  // Initialize session
  useEffect(() => {
    if (!lessonId) return;

    let completed = false;
    const timeoutId = setTimeout(() => {
      if (!completed) {
        console.warn(
          `[UnifiedLesson] Session init taking >3s for lesson ${lessonId}`
        );
      }
    }, 3000);

    async function init() {
      const startTime = Date.now();
      try {
        // Check for existing anonymous session
        const storedId = getStoredSessionId();
        if (storedId) {
          try {
            const state = await getSession(storedId);
            setSessionId(storedId);
            setSession(state);

            // If user is now authenticated, try to claim the session
            if (isAuthenticated && state.user_id === null) {
              await claimSession(storedId);
            }
            completed = true;
            clearTimeout(timeoutId);
            console.log(
              `[UnifiedLesson] Restored session ${storedId} in ${Date.now() - startTime}ms`
            );
            return;
          } catch {
            // Session expired or invalid, create new one
            clearSessionId();
          }
        }

        // Create new session
        const sid = await createSession(lessonId!);
        storeSessionId(sid);
        setSessionId(sid);
        const state = await getSession(sid);
        completed = true;
        clearTimeout(timeoutId);
        console.log(
          `[UnifiedLesson] Session initialized in ${Date.now() - startTime}ms`,
          {
            hasArticle: !!state.article,
            articleContentLength: state.article?.content?.length ?? 0,
            stageType: state.current_stage?.type,
            stageIndex: state.current_stage_index,
          }
        );
        setSession(state);

        // Track lesson start (only for new sessions)
        if (!hasTrackedLessonStart.current) {
          hasTrackedLessonStart.current = true;
          trackLessonStarted(lessonId!, state.lesson_title);
        }
      } catch (e) {
        completed = true;
        clearTimeout(timeoutId);
        console.error(
          `[UnifiedLesson] Session init failed after ${Date.now() - startTime}ms:`,
          e
        );
        // Provide user-friendly error messages
        if (e instanceof RequestTimeoutError) {
          setError(
            "Content is taking too long to load. Please check your connection and try refreshing the page."
          );
        } else {
          setError(e instanceof Error ? e.message : "Failed to start lesson");
        }
      }
    }

    init();

    return () => clearTimeout(timeoutId);
  }, [
    lessonId,
    isAuthenticated,
    getStoredSessionId,
    storeSessionId,
    clearSessionId,
  ]);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return;

      // Trigger activity tracking for chat stage
      triggerChatActivity();

      // For user messages (non-empty), set pending message for optimistic UI
      if (content) {
        setPendingMessage({ content, status: "sending" });
        // Track chat message sent
        if (lessonId) {
          trackChatMessageSent(lessonId, content.length);
        }
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
          } else if (
            chunk.type === "tool_use" &&
            chunk.name === "transition_to_next"
          ) {
            shouldTransition = true;
          }
        }

        // Success: streaming response confirms server received user message
        // Optimistically append both messages to local state (no refetch needed)
        setSession((prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  ...(content ? [{ role: "user" as const, content }] : []),
                  { role: "assistant" as const, content: assistantContent },
                ],
              }
            : prev
        );
        setPendingMessage(null);
        setStreamingContent("");

        if (shouldTransition) {
          setPendingTransition(true);
        }
      } catch {
        // Failure: mark pending message as failed (don't lose user's message)
        if (content) {
          setPendingMessage({ content, status: "failed" });
        }
        setStreamingContent("");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, triggerChatActivity, lessonId]
  );

  const handleRetryMessage = useCallback(() => {
    if (!pendingMessage) return;
    const content = pendingMessage.content;
    setPendingMessage(null);
    handleSendMessage(content);
  }, [pendingMessage, handleSendMessage]);

  // Helper to perform stage advancement (used by both handleAdvanceStage and handleAuthDismiss)
  const performAdvance = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await advanceStage(sessionId);
      setPendingTransition(false);

      if (result.completed) {
        setSession((prev) =>
          prev
            ? { ...prev, completed: true, current_stage: null, content: null }
            : null
        );
      } else {
        // Fetch fresh session - includes new system messages from server
        const state = await getSession(sessionId);
        setSession(state);
      }
    } catch (e) {
      console.error("Failed to advance:", e);
    }
  }, [sessionId]);

  const handleAdvanceStage = useCallback(async () => {
    if (!sessionId) return;

    // If anonymous and completing first non-chat stage, prompt for auth
    const currentStage = session?.stages?.[session.current_stage_index];
    if (!isAuthenticated && !hasPromptedAuth && currentStage?.type !== "chat") {
      setShowAuthPrompt(true);
      setHasPromptedAuth(true);
      return; // Don't advance yet, wait for auth decision
    }

    await performAdvance();
  }, [sessionId, isAuthenticated, hasPromptedAuth, session, performAdvance]);

  const handleContinueChatting = useCallback(() => {
    setPendingTransition(false);
  }, []);

  const handleLoginClick = useCallback(() => {
    // Store that we're mid-lesson so we can return
    sessionStorage.setItem("returnToLesson", lessonId!);
    login();
  }, [lessonId, login]);

  const handleAuthDismiss = useCallback(async () => {
    setShowAuthPrompt(false);
    // Continue with the advance they initiated
    await performAdvance();
  }, [performAdvance]);

  const isChatStage = session?.current_stage?.type === "chat";
  const currentStageIndex = session?.current_stage_index ?? null;

  // Derived values for viewing non-current stages
  const isReviewing =
    viewingStageIndex !== null &&
    currentStageIndex !== null &&
    viewingStageIndex < currentStageIndex;
  const isPreviewing =
    viewingStageIndex !== null &&
    currentStageIndex !== null &&
    viewingStageIndex > currentStageIndex;
  const isViewingOther = isReviewing || isPreviewing;

  // Get indices of reviewable stages (article/video only, before current)
  const getReviewableStages = useCallback(() => {
    if (!session?.stages) return [];
    return session.stages
      .map((stage, index) => ({ stage, index }))
      .filter(
        ({ stage, index }) =>
          stage.type !== "chat" && index < session.current_stage_index
      );
  }, [session?.stages, session?.current_stage_index]);

  const handleGoBack = useCallback(() => {
    const reviewable = getReviewableStages();
    const currentViewing =
      viewingStageIndex ?? session?.current_stage_index ?? 0;
    const earlier = reviewable.filter((s) => s.index < currentViewing);
    if (earlier.length) {
      setViewingStageIndex(earlier[earlier.length - 1].index);
    }
  }, [getReviewableStages, viewingStageIndex, session?.current_stage_index]);

  const handleGoForward = useCallback(() => {
    const reviewable = getReviewableStages();
    const currentViewing =
      viewingStageIndex ?? session?.current_stage_index ?? 0;
    const sessionStageIndex = session?.current_stage_index ?? 0;

    // Find next reviewable stage between here and current
    const later = reviewable.filter(
      (s) => s.index > currentViewing && s.index < sessionStageIndex
    );
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

  const handleStageClick = useCallback(
    (index: number) => {
      // If clicking current stage, exit review mode
      if (index === session?.current_stage_index) {
        setViewingStageIndex(null);
      } else {
        setViewingStageIndex(index);
      }
    },
    [session?.current_stage_index]
  );

  // Compute navigation states
  const reviewableStages = getReviewableStages();
  const currentViewing = viewingStageIndex ?? session?.current_stage_index ?? 0;
  const canGoBack = reviewableStages.some((s) => s.index < currentViewing);
  // Forward enabled if reviewing and not already at current stage
  const canGoForward =
    isReviewing && currentViewing < (session?.current_stage_index ?? 0);

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

  // Detect missing content: article stage loaded but article is null
  const [contentMissingError, setContentMissingError] = useState<string | null>(
    null
  );
  useEffect(() => {
    // Only check for current stage (not when reviewing)
    if (viewingStageIndex !== null) return;
    if (!session?.current_stage) return;

    const isArticleStage = session.current_stage.type === "article";
    const hasArticle = !!session.article?.content;

    if (isArticleStage && !hasArticle) {
      // Article stage but no content - set a timer to show error
      const timeoutId = setTimeout(() => {
        const errorContext = {
          lessonId,
          sessionId,
          stageIndex: session.current_stage_index,
          stageType: session.current_stage?.type,
          hasArticle: !!session.article,
        };
        console.error(
          "[UnifiedLesson] Article content missing after load",
          errorContext
        );
        // Capture in Sentry
        Sentry.captureMessage("Article content missing after session load", {
          level: "error",
          tags: {
            error_type: "content_missing",
            lesson_id: lessonId,
          },
          extra: errorContext,
        });
        setContentMissingError(
          "Article content failed to load. Please try refreshing the page."
        );
      }, 3000); // 3 second grace period

      return () => clearTimeout(timeoutId);
    } else {
      // Content loaded or not an article stage - clear any error
      setContentMissingError(null);
    }
  }, [session?.current_stage, session?.article, session?.current_stage_index, viewingStageIndex, lessonId, sessionId]);

  // Convert session stages to StageInfo format for the drawer
  const stagesForDrawer: StageInfo[] = useMemo(() => {
    if (!session?.stages) return [];
    return session.stages.map(
      (s: Stage & { title?: string; duration?: string }) => ({
        type: s.type,
        title:
          s.title ??
          (s.type === "chat"
            ? "Discussion"
            : s.type.charAt(0).toUpperCase() + s.type.slice(1)),
        duration: s.duration || null, // Backend provides calculated duration
        optional: ("optional" in s && s.optional) ?? false,
      })
    );
  }, [session?.stages]);

  // Auto-initiate AI when entering any chat stage (initial load or after advancing)
  useEffect(() => {
    if (!sessionId || !session) return;
    if (!isChatStage) return;
    if (isLoading) return;
    if (currentStageIndex === null) return;
    if (lastInitiatedStage === currentStageIndex) return; // Already initiated for this stage

    // Track chat opened
    if (lessonId) {
      trackChatOpened(lessonId);
    }

    // Mark this stage as initiated and trigger AI to speak first
    setLastInitiatedStage(currentStageIndex);
    handleSendMessage("");
  }, [
    sessionId,
    session,
    currentStageIndex,
    isChatStage,
    isLoading,
    lastInitiatedStage,
    handleSendMessage,
    lessonId,
  ]);

  // Fetch content for viewed stage when reviewing
  useEffect(() => {
    if (!sessionId || viewingStageIndex === null) return;

    // Check if we already have this content cached
    if (viewedContentCache[viewingStageIndex]) {
      return;
    }

    // Clear any previous error when starting a new fetch
    setViewedStageError(null);

    let isCurrent = true; // Track if this request is still relevant

    const timeoutId = setTimeout(() => {
      if (isCurrent) {
        console.warn(
          `[UnifiedLesson] Content fetch taking >3s for stage ${viewingStageIndex}`,
          {
            sessionId,
            viewingStageIndex,
          }
        );
      }
    }, 3000);

    async function fetchViewedContent() {
      const startTime = Date.now();
      try {
        const state = await getSession(sessionId!, viewingStageIndex!);
        clearTimeout(timeoutId);

        // Only update if this request is still relevant (user hasn't navigated away)
        if (isCurrent && state.article) {
          console.log(
            `[UnifiedLesson] Fetched stage ${viewingStageIndex} in ${Date.now() - startTime}ms`
          );
          // Store in cache instead of overwriting session.article
          setViewedContentCache((prev) => ({
            ...prev,
            [viewingStageIndex!]: state.article!,
          }));
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (isCurrent) {
          console.error(
            `[UnifiedLesson] Failed to fetch stage ${viewingStageIndex} after ${Date.now() - startTime}ms:`,
            e
          );
          // Show user-friendly error
          if (e instanceof RequestTimeoutError) {
            setViewedStageError(
              "Content is taking too long to load. Please try again."
            );
          } else {
            setViewedStageError("Failed to load content. Please try again.");
          }
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

  // Retry handler for viewed stage content
  const handleRetryContent = useCallback(() => {
    if (viewingStageIndex === null) return;
    // Clear error and cached content to trigger re-fetch
    setViewedStageError(null);
    setViewedContentCache((prev) => {
      const next = { ...prev };
      delete next[viewingStageIndex];
      return next;
    });
  }, [viewingStageIndex]);

  // Track lesson completion
  useEffect(() => {
    if (session?.completed && lessonId) {
      trackLessonCompleted(lessonId);
    }
  }, [session?.completed, lessonId]);

  // Fetch next lesson info when lesson completes (only in course context)
  useEffect(() => {
    if (!session?.completed || !courseId || !lessonId) return;

    async function fetchNextLesson() {
      try {
        const result = await getNextLesson(courseId!, lessonId!);
        setLessonCompletionResult(result);
      } catch (e) {
        console.error("Failed to fetch next lesson:", e);
        setLessonCompletionResult(null);
      }
    }

    fetchNextLesson();
  }, [session?.completed, courseId, lessonId]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/" className="text-emerald-600 hover:underline">
            Go home
          </a>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <p className="text-gray-500">Loading lesson...</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-stone-50">
      <LessonHeader
        lessonTitle={session.lesson_title}
        stages={session.stages}
        currentStageIndex={session.current_stage_index}
        viewingStageIndex={viewingStageIndex}
        isViewingOther={isViewingOther}
        canGoPrevious={canGoBack}
        canGoNext={canGoForward}
        onStageClick={handleStageClick}
        onPrevious={handleGoBack}
        onNext={handleGoForward}
        onReturnToCurrent={handleReturnToCurrent}
        onSkipSection={handleAdvanceStage}
        onDrawerOpen={() => setDrawerOpen(true)}
        onLoginClick={handleLoginClick}
      />

      {/* Main content - split panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Content panel - left */}
        <div
          className={`w-1/2 relative ${
            !isChatStage || isViewingOther ? "bg-white z-30" : "bg-gray-50"
          }`}
        >
          {/* Dimming overlay when not focused */}
          {isChatStage && !isViewingOther && (
            <div className="absolute inset-0 bg-gray-50/25 pointer-events-none z-10" />
          )}
          <ContentPanel
            stage={displayedStage}
            article={articleToDisplay}
            onVideoEnded={handleAdvanceStage}
            onNextClick={handleAdvanceStage}
            onSkipOptional={handleAdvanceStage}
            isReviewing={isReviewing}
            isPreviewing={isPreviewing}
            previousArticle={session.previous_article}
            previousStage={session.previous_stage}
            showUserPreviousContent={session.show_user_previous_content}
            onVideoPlay={videoTracker.onPlay}
            onVideoPause={videoTracker.onPause}
            onVideoTimeUpdate={videoTracker.onTimeUpdate}
            contentError={viewedStageError || contentMissingError}
            onRetryContent={
              viewedStageError ? handleRetryContent : () => window.location.reload()
            }
            introduction={
              displayedStage && "introduction" in displayedStage
                ? displayedStage.introduction
                : undefined
            }
          />
        </div>

        {/* Chat panel - right */}
        <div
          className={`w-1/2 relative ${
            isChatStage && !isViewingOther ? "bg-white z-30" : "bg-gray-50"
          }`}
        >
          {/* Dimming overlay when not focused */}
          {(!isChatStage || isViewingOther) && (
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
            onSkipChat={handleAdvanceStage}
            showDisclaimer={!isChatStage || isViewingOther}
            isReviewing={isReviewing}
            isPreviewing={isPreviewing}
          />
        </div>
      </div>

      {/* Derive props for modal from lessonCompletionResult */}
      {(() => {
        const nextLesson = lessonCompletionResult?.type === "next_lesson"
          ? { slug: lessonCompletionResult.slug, title: lessonCompletionResult.title }
          : null;
        const completedUnit = lessonCompletionResult?.type === "unit_complete"
          ? lessonCompletionResult.unitNumber
          : null;
        return (
          <LessonCompleteModal
            isOpen={(session.completed || !session.current_stage) && !completionModalDismissed}
            lessonTitle={session.lesson_title}
            courseId={courseId}
            isInSignupsTable={isInSignupsTable}
            isInActiveGroup={isInActiveGroup}
            nextLesson={nextLesson}
            completedUnit={completedUnit}
            onClose={() => setCompletionModalDismissed(true)}
          />
        );
      })()}

      <AuthPromptModal
        isOpen={showAuthPrompt}
        onLogin={handleLoginClick}
        onDismiss={handleAuthDismiss}
      />

      <LessonDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        lessonTitle={session.lesson_title}
        stages={stagesForDrawer}
        currentStageIndex={session.current_stage_index}
        viewedStageIndex={currentViewing}
        onStageClick={(index) => {
          handleStageClick(index);
        }}
      />
    </div>
  );
}
