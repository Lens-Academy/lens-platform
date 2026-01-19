// web_frontend_next/src/views/NarrativeLesson.tsx
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import type {
  ChatMessage,
  PendingMessage,
  ArticleData,
  Stage,
} from "@/types/unified-lesson";
import type { StageInfo } from "@/types/course";
import type {
  NarrativeLesson as NarrativeLessonType,
  NarrativeSection,
  NarrativeSegment,
} from "@/types/narrative-lesson";
import {
  sendMessage,
  createSession,
  getSession,
  claimSession,
} from "@/api/lessons";
import type { LessonCompletionResult } from "@/api/lessons";
// Note: getNextLesson can be imported when courseId is available in props
import { useAnonymousSession } from "@/hooks/useAnonymousSession";
import { useAuth } from "@/hooks/useAuth";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useVideoActivityTracker } from "@/hooks/useVideoActivityTracker";
import AuthoredText from "@/components/narrative-lesson/AuthoredText";
import ArticleEmbed from "@/components/narrative-lesson/ArticleEmbed";
import VideoEmbed from "@/components/narrative-lesson/VideoEmbed";
import NarrativeChatSection from "@/components/narrative-lesson/NarrativeChatSection";
import MarkCompleteButton from "@/components/narrative-lesson/MarkCompleteButton";
import SectionDivider from "@/components/unified-lesson/SectionDivider";
import { LessonHeader } from "@/components/LessonHeader";
import LessonDrawer from "@/components/unified-lesson/LessonDrawer";
import LessonCompleteModal from "@/components/unified-lesson/LessonCompleteModal";
import AuthPromptModal from "@/components/unified-lesson/AuthPromptModal";
import {
  trackLessonStarted,
  trackLessonCompleted,
  trackChatMessageSent,
} from "@/analytics";
import { Sentry } from "@/errorTracking";
import { RequestTimeoutError } from "@/api/lessons";

type NarrativeLessonProps = {
  lesson: NarrativeLessonType;
};

/**
 * Main view for NarrativeLesson format.
 *
 * Renders a continuous vertical scroll with:
 * - Authored text (white bg)
 * - Article excerpts (gray card)
 * - Video excerpts (gray card, 80% width)
 * - Chat sections (75vh, all sharing same state)
 * - Progress sidebar on left
 */
export default function NarrativeLesson({ lesson }: NarrativeLessonProps) {
  // Chat state (shared across all chat sections)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [streamingContent, setStreamingContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Session state
  const [sessionId, setSessionId] = useState<number | null>(null);
  const { getStoredSessionId, storeSessionId, clearSessionId } =
    useAnonymousSession(lesson.slug);

  // Progress tracking
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Section completion tracking (persisted to localStorage)
  const [completedSections, setCompletedSections] = useState<Set<number>>(
    () => {
      if (typeof window === "undefined") return new Set();
      const stored = localStorage.getItem(`narrative-completed-${lesson.slug}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    },
  );

  // Persist completion state to localStorage
  useEffect(() => {
    localStorage.setItem(
      `narrative-completed-${lesson.slug}`,
      JSON.stringify([...completedSections]),
    );
  }, [completedSections, lesson.slug]);

  const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } =
    useAuth();

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);

  // For stage navigation (viewing non-current section)
  const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(
    null,
  );

  // Lesson completion modal state
  const [lessonCompletionResult, setLessonCompletionResult] =
    useState<LessonCompletionResult>(null);
  const [completionModalDismissed, setCompletionModalDismissed] =
    useState(false);

  // Auth prompt modal state
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [hasPromptedAuth, setHasPromptedAuth] = useState(false);

  // Analytics tracking ref
  const hasTrackedLessonStart = useRef(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Derive furthest completed index for progress bar display
  // Progress bar shows stages as "reached" based on this, not scroll position
  const furthestCompletedIndex = useMemo(() => {
    let max = -1;
    completedSections.forEach((idx) => {
      if (idx > max) max = idx;
    });
    return max;
  }, [completedSections]);

  // Convert sections to Stage format for progress bar
  // StageProgressBar only uses the `type` field for icon display
  const stages: Stage[] = useMemo(() => {
    return lesson.sections.map((section): Stage => {
      const stageType = section.type === "text" ? "article" : section.type;
      if (stageType === "article") {
        return { type: "article", source: "", from: null, to: null };
      } else if (stageType === "video" && section.type === "video") {
        return { type: "video", videoId: section.videoId, from: 0, to: null };
      } else {
        return {
          type: "chat",
          instructions: "",
          showUserPreviousContent: false,
          showTutorPreviousContent: false,
        };
      }
    });
  }, [lesson.sections]);

  // Convert to StageInfo format for drawer
  const stagesForDrawer: StageInfo[] = useMemo(() => {
    return lesson.sections.map((section, index) => ({
      type: section.type === "text" ? "article" : section.type,
      title:
        section.type === "text"
          ? `Section ${index + 1}`
          : section.meta.title || `${section.type} ${index + 1}`,
      duration: null,
      optional: false,
    }));
  }, [lesson.sections]);

  // Derived value for lesson completion
  const isLessonComplete = completedSections.size === lesson.sections.length;

  // Activity tracking for current section
  const currentSection = lesson.sections[currentSectionIndex];
  const currentSectionType =
    currentSection?.type === "text" ? "article" : currentSection?.type;

  // Article/text activity tracking (3 min inactivity timeout)
  useActivityTracker({
    sessionId: sessionId ?? 0,
    stageIndex: currentSectionIndex,
    stageType: "article",
    inactivityTimeout: 180_000,
    enabled:
      !!sessionId &&
      (currentSectionType === "article" || currentSection?.type === "text"),
  });

  // Video activity tracking
  const videoTracker = useVideoActivityTracker({
    sessionId: sessionId ?? 0,
    stageIndex: currentSectionIndex,
    enabled: !!sessionId && currentSectionType === "video",
  });

  // Chat activity tracking (5 min inactivity timeout)
  // Chat segments can appear within any section type, so we keep the tracker
  // ready and trigger it manually via triggerChatActivity() in handleSendMessage
  const { triggerActivity: triggerChatActivity } = useActivityTracker({
    sessionId: sessionId ?? 0,
    stageIndex: currentSectionIndex,
    stageType: "chat",
    inactivityTimeout: 300_000,
    enabled: !!sessionId,
  });

  // Fetch next lesson info when lesson completes
  useEffect(() => {
    if (!isLessonComplete) return;

    // For now, we don't have courseId in NarrativeLesson props
    // This can be added later when course context is available
    setLessonCompletionResult(null);
  }, [isLessonComplete]);

  // Track lesson completed
  useEffect(() => {
    if (isLessonComplete) {
      trackLessonCompleted(lesson.slug);
    }
  }, [isLessonComplete, lesson.slug]);

  // Initialize session
  useEffect(() => {
    async function init() {
      try {
        const storedId = getStoredSessionId();
        if (storedId) {
          try {
            const state = await getSession(storedId);
            setSessionId(storedId);
            setMessages(state.messages);

            // If user is now authenticated, try to claim the session
            if (isAuthenticated) {
              try {
                await claimSession(storedId);
              } catch {
                // Session already claimed or other error - ignore
              }
            }
            return;
          } catch {
            clearSessionId();
          }
        }

        // Create new session
        const sid = await createSession(lesson.slug);
        storeSessionId(sid);
        setSessionId(sid);

        // Track lesson start (only for new sessions)
        if (!hasTrackedLessonStart.current) {
          hasTrackedLessonStart.current = true;
          trackLessonStarted(lesson.slug, lesson.title);
        }
      } catch (e) {
        console.error("[NarrativeLesson] Session init failed:", e);
        if (e instanceof RequestTimeoutError) {
          setError(
            "Content is taking too long to load. Please check your connection and try refreshing the page.",
          );
        } else {
          setError(e instanceof Error ? e.message : "Failed to start lesson");
        }

        Sentry.captureException(e, {
          tags: { error_type: "session_init_failed", lesson_slug: lesson.slug },
        });
      }
    }

    init();
  }, [
    lesson.slug,
    lesson.title,
    getStoredSessionId,
    storeSessionId,
    clearSessionId,
    isAuthenticated,
  ]);

  // Track position for retry
  const [lastPosition, setLastPosition] = useState<{
    sectionIndex: number;
    segmentIndex: number;
  } | null>(null);

  // Send message handler (shared across all chat sections)
  const handleSendMessage = useCallback(
    async (content: string, sectionIndex: number, segmentIndex: number) => {
      if (!sessionId) return;

      // Track chat activity on message send
      triggerChatActivity();

      // Store position for potential retry
      setLastPosition({ sectionIndex, segmentIndex });

      if (content) {
        setPendingMessage({ content, status: "sending" });
        trackChatMessageSent(lesson.slug, content.length);
      }
      setIsLoading(true);
      setStreamingContent("");

      try {
        let assistantContent = "";

        for await (const chunk of sendMessage(sessionId, content, {
          sectionIndex,
          segmentIndex,
        })) {
          if (chunk.type === "text" && chunk.content) {
            assistantContent += chunk.content;
            setStreamingContent(assistantContent);
          }
        }

        // Update messages
        setMessages((prev) => [
          ...prev,
          ...(content ? [{ role: "user" as const, content }] : []),
          { role: "assistant" as const, content: assistantContent },
        ]);
        setPendingMessage(null);
        setStreamingContent("");
      } catch {
        if (content) {
          setPendingMessage({ content, status: "failed" });
        }
        setStreamingContent("");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, triggerChatActivity, lesson.slug],
  );

  const handleRetryMessage = useCallback(() => {
    if (!pendingMessage || !lastPosition) return;
    const content = pendingMessage.content;
    setPendingMessage(null);
    handleSendMessage(
      content,
      lastPosition.sectionIndex,
      lastPosition.segmentIndex,
    );
  }, [pendingMessage, lastPosition, handleSendMessage]);

  // Scroll tracking with hybrid rule: >50% viewport OR fully visible, topmost wins
  useEffect(() => {
    const calculateCurrentSection = () => {
      const viewportHeight = window.innerHeight;
      let bestIndex = 0;
      let bestTopPosition = Infinity;

      sectionRefs.current.forEach((el, index) => {
        const rect = el.getBoundingClientRect();

        // Calculate visible portion of section
        const visibleTop = Math.max(0, rect.top);
        const visibleBottom = Math.min(viewportHeight, rect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);

        // Check if section is fully visible
        const isFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;

        // Check if section takes >50% of viewport
        const viewportCoverage = visibleHeight / viewportHeight;
        const takesHalfViewport = viewportCoverage > 0.5;

        // Section qualifies if fully visible OR takes >50% of viewport
        // For ties, prefer topmost (smallest rect.top)
        if (isFullyVisible || takesHalfViewport) {
          if (rect.top < bestTopPosition) {
            bestIndex = index;
            bestTopPosition = rect.top;
          }
        }
      });

      // Fallback: if no section qualified, find section closest to viewport top
      if (bestTopPosition === Infinity) {
        let closestDistance = Infinity;
        sectionRefs.current.forEach((el, index) => {
          const rect = el.getBoundingClientRect();
          const distance = Math.abs(rect.top);
          if (distance < closestDistance) {
            closestDistance = distance;
            bestIndex = index;
          }
        });
      }

      setCurrentSectionIndex(bestIndex);
    };

    // Throttle scroll handler with requestAnimationFrame
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          calculateCurrentSection();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Initial calculation (after refs are populated)
    const timeout = setTimeout(calculateCurrentSection, 0);

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", calculateCurrentSection);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", calculateCurrentSection);
    };
  }, [lesson.sections]);

  const handleLoginClick = useCallback(() => {
    sessionStorage.setItem("returnToLesson", lesson.slug);
    login();
  }, [lesson.slug, login]);

  const handleStageClick = useCallback(
    (index: number) => {
      // Scroll to section
      const el = sectionRefs.current.get(index);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
      setViewingStageIndex(index === currentSectionIndex ? null : index);
    },
    [currentSectionIndex],
  );

  const handlePrevious = useCallback(() => {
    const prevIndex = Math.max(0, currentSectionIndex - 1);
    handleStageClick(prevIndex);
  }, [currentSectionIndex, handleStageClick]);

  const handleNext = useCallback(() => {
    const nextIndex = Math.min(
      lesson.sections.length - 1,
      currentSectionIndex + 1,
    );
    handleStageClick(nextIndex);
  }, [currentSectionIndex, lesson.sections.length, handleStageClick]);

  const handleMarkComplete = useCallback(
    (sectionIndex: number) => {
      // Check if this is the first completion (for auth prompt)
      // Must check BEFORE updating state
      const isFirstCompletion = completedSections.size === 0;

      setCompletedSections((prev) => {
        const next = new Set(prev);
        next.add(sectionIndex);
        return next;
      });

      // Prompt for auth after first section completion (if anonymous)
      if (isFirstCompletion && !isAuthenticated && !hasPromptedAuth) {
        setShowAuthPrompt(true);
        setHasPromptedAuth(true);
      }
    },
    [completedSections.size, isAuthenticated, hasPromptedAuth],
  );

  const handleSkipSection = useCallback(() => {
    // Mark current as complete and go to next
    handleMarkComplete(currentSectionIndex);
    handleNext();
  }, [currentSectionIndex, handleMarkComplete, handleNext]);

  // Render a segment (sectionIndex included for unique keys)
  const renderSegment = (
    segment: NarrativeSegment,
    section: NarrativeSection,
    sectionIndex: number,
    segmentIndex: number,
  ) => {
    const keyPrefix = `${sectionIndex}-${segmentIndex}`;

    switch (segment.type) {
      case "text":
        return (
          <AuthoredText key={`text-${keyPrefix}`} content={segment.content} />
        );

      case "article-excerpt": {
        // Content is now bundled directly in the segment
        const articleMeta = section.type === "article" ? section.meta : null;
        const excerptData: ArticleData = {
          content: segment.content,
          title: articleMeta?.title ?? null,
          author: articleMeta?.author ?? null,
          sourceUrl: articleMeta?.sourceUrl ?? null,
          isExcerpt: true,
        };
        return (
          <ArticleEmbed
            key={`article-${keyPrefix}`}
            article={excerptData}
            showHeader
          />
        );
      }

      case "video-excerpt":
        if (section.type !== "video") return null;
        return (
          <VideoEmbed
            key={`video-${keyPrefix}`}
            videoId={section.videoId}
            start={segment.from}
            end={segment.to}
            onPlay={videoTracker.onPlay}
            onPause={videoTracker.onPause}
            onTimeUpdate={videoTracker.onTimeUpdate}
          />
        );

      case "chat":
        // Chat components stay mounted (no lazy loading) to preserve local state
        return (
          <NarrativeChatSection
            key={`chat-${keyPrefix}`}
            messages={messages}
            pendingMessage={pendingMessage}
            streamingContent={streamingContent}
            isLoading={isLoading}
            onSendMessage={(content) =>
              handleSendMessage(content, sectionIndex, segmentIndex)
            }
            onRetryMessage={handleRetryMessage}
          />
        );

      default:
        return null;
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Link href="/" className="text-emerald-600 hover:underline">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <LessonHeader
        lessonTitle={lesson.title}
        stages={stages}
        currentStageIndex={furthestCompletedIndex + 1}
        viewingStageIndex={viewingStageIndex}
        isViewingOther={
          viewingStageIndex !== null &&
          viewingStageIndex !== currentSectionIndex
        }
        canGoPrevious={currentSectionIndex > 0}
        canGoNext={currentSectionIndex < lesson.sections.length - 1}
        onStageClick={handleStageClick}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onReturnToCurrent={() => setViewingStageIndex(null)}
        onSkipSection={handleSkipSection}
        onDrawerOpen={() => setDrawerOpen(true)}
        onLoginClick={handleLoginClick}
      />

      {/* Main content */}
      <main>
        {lesson.sections.map((section, sectionIndex) => (
          <div
            key={sectionIndex}
            ref={(el) => {
              if (el) sectionRefs.current.set(sectionIndex, el);
            }}
            data-section-index={sectionIndex}
            className="py-8"
          >
            {section.type === "text" ? (
              <>
                <SectionDivider type="article" />
                <AuthoredText content={section.content} />
              </>
            ) : (
              <>
                <SectionDivider type={section.type} />
                {section.segments.map((segment, segmentIndex) =>
                  renderSegment(segment, section, sectionIndex, segmentIndex),
                )}
              </>
            )}
            <MarkCompleteButton
              isCompleted={completedSections.has(sectionIndex)}
              onComplete={() => handleMarkComplete(sectionIndex)}
            />
          </div>
        ))}
      </main>

      <LessonDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        lessonTitle={lesson.title}
        stages={stagesForDrawer}
        currentStageIndex={furthestCompletedIndex + 1}
        viewedStageIndex={viewingStageIndex ?? currentSectionIndex}
        onStageClick={(index) => {
          handleStageClick(index);
          setDrawerOpen(false);
        }}
      />

      <LessonCompleteModal
        isOpen={isLessonComplete && !completionModalDismissed}
        lessonTitle={lesson.title}
        courseId={undefined}
        isInSignupsTable={isInSignupsTable}
        isInActiveGroup={isInActiveGroup}
        nextLesson={
          lessonCompletionResult?.type === "next_lesson"
            ? {
                slug: lessonCompletionResult.slug,
                title: lessonCompletionResult.title,
              }
            : null
        }
        completedUnit={
          lessonCompletionResult?.type === "unit_complete"
            ? lessonCompletionResult.unitNumber
            : null
        }
        onClose={() => setCompletionModalDismissed(true)}
      />

      <AuthPromptModal
        isOpen={showAuthPrompt}
        onLogin={handleLoginClick}
        onDismiss={() => setShowAuthPrompt(false)}
      />
    </div>
  );
}
