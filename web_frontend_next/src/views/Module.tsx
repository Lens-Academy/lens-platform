// web_frontend_next/src/views/Module.tsx
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import type {
  ChatMessage,
  PendingMessage,
  ArticleData,
  Stage,
} from "@/types/module";
import type { StageInfo } from "@/types/course";
import type {
  Module as ModuleType,
  ModuleSection,
  ModuleSegment,
} from "@/types/module";
import {
  sendMessage,
  createSession,
  getSession,
  claimSession,
  getNextModule,
} from "@/api/modules";
import type { ModuleCompletionResult } from "@/api/modules";
import { useAnonymousSession } from "@/hooks/useAnonymousSession";
import { useAuth } from "@/hooks/useAuth";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useVideoActivityTracker } from "@/hooks/useVideoActivityTracker";
import AuthoredText from "@/components/module/AuthoredText";
import ArticleEmbed from "@/components/module/ArticleEmbed";
import VideoEmbed from "@/components/module/VideoEmbed";
import NarrativeChatSection from "@/components/module/NarrativeChatSection";
import MarkCompleteButton from "@/components/module/MarkCompleteButton";
import SectionDivider from "@/components/module/SectionDivider";
import ArticleSectionWrapper from "@/components/module/ArticleSectionWrapper";
import { ModuleHeader } from "@/components/ModuleHeader";
import ModuleDrawer from "@/components/module/ModuleDrawer";
import ModuleCompleteModal from "@/components/module/ModuleCompleteModal";
import AuthPromptModal from "@/components/module/AuthPromptModal";
import {
  trackModuleStarted,
  trackModuleCompleted,
  trackChatMessageSent,
} from "@/analytics";
import { Sentry } from "@/errorTracking";
import { RequestTimeoutError } from "@/api/modules";

type CourseContext = {
  courseId: string;
  // Module slugs in order, for next/prev navigation
  modules: string[];
};

type ModuleProps = {
  module: ModuleType;
  courseContext: CourseContext | null;
};

/**
 * Main view for Module format.
 *
 * Renders a continuous vertical scroll with:
 * - Authored text (white bg)
 * - Article excerpts (gray card)
 * - Video excerpts (gray card, 80% width)
 * - Chat sections (75vh, all sharing same state)
 * - Progress sidebar on left
 */
export default function Module({ module, courseContext }: ModuleProps) {
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
    useAnonymousSession(module.slug);

  // Progress tracking
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Section completion tracking (persisted to localStorage)
  const [completedSections, setCompletedSections] = useState<Set<number>>(
    () => {
      if (typeof window === "undefined") return new Set();
      const stored = localStorage.getItem(`module-completed-${module.slug}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    },
  );

  // Persist completion state to localStorage
  useEffect(() => {
    localStorage.setItem(
      `module-completed-${module.slug}`,
      JSON.stringify([...completedSections]),
    );
  }, [completedSections, module.slug]);

  const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } =
    useAuth();

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);

  // For stage navigation (viewing non-current section)
  const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(
    null,
  );

  // Module completion modal state
  const [moduleCompletionResult, setModuleCompletionResult] =
    useState<ModuleCompletionResult>(null);
  const [completionModalDismissed, setCompletionModalDismissed] =
    useState(false);

  // Auth prompt modal state
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [hasPromptedAuth, setHasPromptedAuth] = useState(false);

  // Analytics tracking ref
  const hasTrackedModuleStart = useRef(false);

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
    return module.sections.map((section): Stage => {
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
  }, [module.sections]);

  // Convert to StageInfo format for drawer
  const stagesForDrawer: StageInfo[] = useMemo(() => {
    return module.sections.map((section, index) => ({
      type: section.type === "text" ? "article" : section.type,
      title:
        section.type === "text"
          ? `Section ${index + 1}`
          : section.meta?.title || `${section.type || "Section"} ${index + 1}`,
      duration: null,
      optional: false,
    }));
  }, [module.sections]);

  // Derived value for module completion
  const isModuleComplete = completedSections.size === module.sections.length;

  // Activity tracking for current section
  const currentSection = module.sections[currentSectionIndex];
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

  // Fetch next module info when module completes
  useEffect(() => {
    if (!isModuleComplete) return;

    // If no course context, this is a standalone module - no next
    if (!courseContext) {
      setModuleCompletionResult(null);
      return;
    }

    // Fetch next module from course
    async function fetchNext() {
      try {
        const result = await getNextModule(courseContext!.courseId, module.slug);
        setModuleCompletionResult(result);
      } catch (e) {
        console.error("[Module] Failed to fetch next module:", e);
        setModuleCompletionResult(null);
      }
    }

    fetchNext();
  }, [isModuleComplete, courseContext, module.slug]);

  // Track module completed
  useEffect(() => {
    if (isModuleComplete) {
      trackModuleCompleted(module.slug);
    }
  }, [isModuleComplete, module.slug]);

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
        const sid = await createSession(module.slug);
        storeSessionId(sid);
        setSessionId(sid);

        // Track module start (only for new sessions)
        if (!hasTrackedModuleStart.current) {
          hasTrackedModuleStart.current = true;
          trackModuleStarted(module.slug, module.title);
        }
      } catch (e) {
        console.error("[Module] Session init failed:", e);
        if (e instanceof RequestTimeoutError) {
          setError(
            "Content is taking too long to load. Please check your connection and try refreshing the page.",
          );
        } else {
          setError(e instanceof Error ? e.message : "Failed to start module");
        }

        Sentry.captureException(e, {
          tags: { error_type: "session_init_failed", module_slug: module.slug },
        });
      }
    }

    init();
  }, [
    module.slug,
    module.title,
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
        trackChatMessageSent(module.slug, content.length);
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
    [sessionId, triggerChatActivity, module.slug],
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
  }, [module.sections]);

  const handleLoginClick = useCallback(() => {
    sessionStorage.setItem("returnToModule", module.slug);
    login();
  }, [module.slug, login]);

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
      module.sections.length - 1,
      currentSectionIndex + 1,
    );
    handleStageClick(nextIndex);
  }, [currentSectionIndex, module.sections.length, handleStageClick]);

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
    segment: ModuleSegment,
    section: ModuleSection,
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

        // Count how many article-excerpt segments came before this one
        const excerptsBefore =
          section.type === "article"
            ? section.segments
                .slice(0, segmentIndex)
                .filter((s) => s.type === "article-excerpt").length
            : 0;
        const isFirstExcerpt = excerptsBefore === 0;

        return (
          <ArticleEmbed
            key={`article-${keyPrefix}`}
            article={excerptData}
            isFirstExcerpt={isFirstExcerpt}
          />
        );
      }

      case "video-excerpt": {
        if (section.type !== "video") return null;

        // Count video excerpts to number them (Part 1, Part 2, etc.)
        // All video-excerpts in a video section share the same videoId.
        const videoExcerptsBefore = section.segments
          .slice(0, segmentIndex)
          .filter((s) => s.type === "video-excerpt").length;
        const excerptNumber = videoExcerptsBefore + 1; // 1-indexed

        return (
          <VideoEmbed
            key={`video-${keyPrefix}`}
            videoId={section.videoId}
            start={segment.from}
            end={segment.to}
            excerptNumber={excerptNumber}
            title={section.meta.title}
            channel={section.meta.channel}
            onPlay={videoTracker.onPlay}
            onPause={videoTracker.onPause}
            onTimeUpdate={videoTracker.onTimeUpdate}
          />
        );
      }

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
      <div className="sticky top-0 z-50 bg-white">
        <ModuleHeader
        moduleTitle={module.title}
        stages={stages}
        currentStageIndex={furthestCompletedIndex + 1}
        viewingStageIndex={viewingStageIndex ?? currentSectionIndex}
        isViewingOther={
          viewingStageIndex !== null &&
          viewingStageIndex !== currentSectionIndex
        }
        canGoPrevious={currentSectionIndex > 0}
        canGoNext={currentSectionIndex < module.sections.length - 1}
        onStageClick={handleStageClick}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onReturnToCurrent={() => setViewingStageIndex(null)}
        onSkipSection={handleSkipSection}
        onDrawerOpen={() => setDrawerOpen(true)}
        onLoginClick={handleLoginClick}
      />
      </div>

      {/* Main content */}
      <main>
        {module.sections.map((section, sectionIndex) => (
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
            ) : section.type === "chat" ? (
              <>
                <SectionDivider type="chat" />
                <NarrativeChatSection
                  messages={messages}
                  pendingMessage={pendingMessage}
                  streamingContent={streamingContent}
                  isLoading={isLoading}
                  onSendMessage={(content) =>
                    handleSendMessage(content, sectionIndex, 0)
                  }
                  onRetryMessage={handleRetryMessage}
                />
              </>
            ) : section.type === "article" ? (
              <>
                <SectionDivider type="article" />
                <ArticleSectionWrapper section={section}>
                  {section.segments?.map((segment, segmentIndex) =>
                    renderSegment(segment, section, sectionIndex, segmentIndex),
                  )}
                </ArticleSectionWrapper>
              </>
            ) : (
              <>
                <SectionDivider type={section.type} />
                {section.segments?.map((segment, segmentIndex) =>
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

      <ModuleDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        moduleTitle={module.title}
        stages={stagesForDrawer}
        currentStageIndex={furthestCompletedIndex + 1}
        viewedStageIndex={viewingStageIndex ?? currentSectionIndex}
        onStageClick={handleStageClick}
      />

      <ModuleCompleteModal
        isOpen={isModuleComplete && !completionModalDismissed}
        moduleTitle={module.title}
        courseId={courseContext?.courseId}
        isInSignupsTable={isInSignupsTable}
        isInActiveGroup={isInActiveGroup}
        nextModule={
          moduleCompletionResult?.type === "next_module"
            ? {
                slug: moduleCompletionResult.slug,
                title: moduleCompletionResult.title,
              }
            : null
        }
        completedUnit={
          moduleCompletionResult?.type === "unit_complete"
            ? moduleCompletionResult.unitNumber
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
