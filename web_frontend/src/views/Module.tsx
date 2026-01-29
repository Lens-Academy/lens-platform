// web_frontend/src/views/Module.tsx

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  ChatMessage,
  PendingMessage,
  ArticleData,
  Stage,
} from "@/types/module";
import type { StageInfo } from "@/types/course";
import type { ViewMode } from "@/types/viewMode";
import type {
  Module as ModuleType,
  ModuleSection,
  ModuleSegment,
} from "@/types/module";
import type { CourseProgress } from "@/types/course";
import {
  sendMessage,
  getChatHistory,
  getNextModule,
  getModule,
  getCourseProgress,
} from "@/api/modules";
import type { ModuleCompletionResult } from "@/api/modules";

import { useAuth } from "@/hooks/useAuth";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import AuthoredText from "@/components/module/AuthoredText";
import ArticleEmbed from "@/components/module/ArticleEmbed";
import VideoEmbed from "@/components/module/VideoEmbed";
import NarrativeChatSection from "@/components/module/NarrativeChatSection";
import MarkCompleteButton from "@/components/module/MarkCompleteButton";
import SectionDivider from "@/components/module/SectionDivider";
import ArticleSectionWrapper from "@/components/module/ArticleSectionWrapper";
import ArticleExcerptGroup from "@/components/module/ArticleExcerptGroup";
import { ModuleHeader } from "@/components/ModuleHeader";
import ModuleDrawer from "@/components/module/ModuleDrawer";
import ModuleCompleteModal from "@/components/module/ModuleCompleteModal";
import AuthPromptModal from "@/components/module/AuthPromptModal";
import {
  trackModuleStarted,
  trackModuleCompleted,
  trackChatMessageSent,
} from "@/analytics";
import { Skeleton, SkeletonText } from "@/components/Skeleton";
interface ModuleProps {
  courseId: string;
  moduleId: string;
}

/**
 * Main view for Module format.
 *
 * Fetches module data based on courseId and moduleId props.
 * Renders a continuous vertical scroll with:
 * - Authored text (white bg)
 * - Article excerpts (gray card)
 * - Video excerpts (gray card, 80% width)
 * - Chat sections (75vh, all sharing same state)
 * - Progress sidebar on left
 */
export default function Module({ courseId, moduleId }: ModuleProps) {
  // Module data loading state
  const [module, setModule] = useState<ModuleType | null>(null);
  const [courseProgress, setCourseProgress] = useState<CourseProgress | null>(
    null,
  );
  const [loadingModule, setLoadingModule] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Extract all module slugs from course for navigation
  const courseModules = useMemo(() => {
    if (!courseProgress) return [];
    const modules: string[] = [];
    for (const unit of courseProgress.units) {
      for (const mod of unit.modules) {
        modules.push(mod.slug);
      }
    }
    return modules;
  }, [courseProgress]);

  // Build course context for navigation
  const courseContext = useMemo(() => {
    if (!courseProgress) return null;
    return {
      courseId,
      modules: courseModules,
    };
  }, [courseProgress, courseId, courseModules]);

  // Fetch module data on mount or when moduleId/courseId changes
  useEffect(() => {
    if (!moduleId) return;

    async function load() {
      setLoadingModule(true);
      setLoadError(null);
      try {
        // Fetch module and course progress in parallel
        const [moduleResult, courseResult] = await Promise.all([
          getModule(moduleId),
          courseId && courseId !== "default"
            ? getCourseProgress(courseId).catch(() => null)
            : Promise.resolve(null),
        ]);

        setModule(moduleResult);
        setCourseProgress(courseResult);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load module");
      } finally {
        setLoadingModule(false);
      }
    }

    load();
  }, [moduleId, courseId]);
  // Chat state (shared across all chat sections)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [streamingContent, setStreamingContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Fetch chat history when module loads
  useEffect(() => {
    if (!module) return;

    // Clear messages when switching modules
    setMessages([]);

    // Track if effect is still active (prevent race condition)
    let cancelled = false;

    async function loadHistory() {
      try {
        const history = await getChatHistory(module!.slug);
        if (cancelled) return; // Don't update if module changed

        if (history.messages.length > 0) {
          setMessages(
            history.messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          );
        }
        // Messages already cleared above if history is empty
      } catch (e) {
        if (!cancelled) {
          console.error("[Module] Failed to load chat history:", e);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [module]);

  // Progress tracking
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Section completion tracking (persisted to localStorage)
  const [completedSections, setCompletedSections] = useState<Set<number>>(
    () => {
      if (typeof window === "undefined") return new Set();
      const stored = localStorage.getItem(`module-completed-${moduleId}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    },
  );

  // Persist completion state to localStorage
  useEffect(() => {
    localStorage.setItem(
      `module-completed-${moduleId}`,
      JSON.stringify([...completedSections]),
    );
  }, [completedSections, moduleId]);

  const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } =
    useAuth();

  // For stage navigation (viewing non-current section)
  const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(
    null,
  );

  // Module completion modal state
  const [moduleCompletionResult, setModuleCompletionResult] =
    useState<ModuleCompletionResult>(null);
  const [completionModalDismissed, setCompletionModalDismissed] =
    useState(false);
  // Track if module was marked complete by API (all required lenses done)
  const [apiConfirmedComplete, setApiConfirmedComplete] = useState(false);

  // Auth prompt modal state
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [hasPromptedAuth, setHasPromptedAuth] = useState(false);

  // Analytics tracking ref
  const hasTrackedModuleStart = useRef(false);

  // View mode state (default to paginated)
  const [viewMode] = useState<ViewMode>("paginated");

  // Convert sections to Stage format for progress bar
  const stages: Stage[] = useMemo(() => {
    if (!module) return [];
    return module.sections.map((section, index): Stage => {
      // Map section types to stage types
      // v2 types: page, lens-video, lens-article
      // v1 types: text, article, video, chat
      let stageType: "article" | "video" | "chat";
      if (section.type === "video" || section.type === "lens-video") {
        stageType = "video";
      } else if (
        section.type === "article" ||
        section.type === "lens-article" ||
        section.type === "text" ||
        section.type === "page"
      ) {
        stageType = "article";
      } else {
        stageType = "chat";
      }

      const isOptional = "optional" in section && section.optional === true;
      const title =
        section.type === "text"
          ? `Section ${index + 1}`
          : section.type === "page"
            ? section.meta?.title || `Page ${index + 1}`
            : section.meta?.title ||
              `${section.type || "Section"} ${index + 1}`;

      if (stageType === "article") {
        return {
          type: "article",
          source: "",
          from: null,
          to: null,
          optional: isOptional,
          title,
        };
      } else if (stageType === "video") {
        // Get videoId from video or lens-video sections
        const videoId =
          section.type === "video"
            ? section.videoId
            : section.type === "lens-video"
              ? section.videoId
              : "";
        return {
          type: "video",
          videoId,
          from: 0,
          to: null,
          optional: isOptional,
          title,
        };
      } else {
        return {
          type: "chat",
          instructions: "",
          hidePreviousContentFromUser: false,
          hidePreviousContentFromTutor: false,
          title,
        };
      }
    });
  }, [module]);

  // Convert to StageInfo format for drawer
  const stagesForDrawer: StageInfo[] = useMemo(() => {
    if (!module) return [];
    return module.sections.map((section, index) => {
      // Map section types to drawer display types
      // v2 types get their own display, v1 types map as before
      let displayType: StageInfo["type"];
      if (section.type === "lens-video") {
        displayType = "lens-video";
      } else if (section.type === "lens-article") {
        displayType = "lens-article";
      } else if (section.type === "page") {
        displayType = "page";
      } else if (section.type === "text") {
        displayType = "article";
      } else {
        displayType = section.type;
      }

      return {
        type: displayType,
        title:
          section.type === "text"
            ? `Section ${index + 1}`
            : section.type === "page"
              ? section.meta?.title || `Page ${index + 1}`
              : section.meta?.title ||
                `${section.type || "Section"} ${index + 1}`,
        duration: null,
        optional: "optional" in section && section.optional === true,
      };
    });
  }, [module]);

  // Derived value for module completion
  // Complete if: API confirmed complete OR all sections marked locally
  const isModuleComplete = module
    ? apiConfirmedComplete || completedSections.size === module.sections.length
    : false;

  // Activity tracking for current section
  const currentSection = module?.sections[currentSectionIndex];
  const currentSectionType =
    currentSection?.type === "text" ? "article" : currentSection?.type;

  // Article/text activity tracking (3 min inactivity timeout)
  useActivityTracker({
    contentId: currentSection?.contentId ?? undefined,
    isAuthenticated,
    inactivityTimeout: 180_000,
    enabled:
      !!currentSection?.contentId &&
      (currentSectionType === "article" || currentSection?.type === "text"),
  });

  // Video activity tracking (3 min inactivity timeout)
  useActivityTracker({
    contentId: currentSection?.contentId ?? undefined,
    isAuthenticated,
    inactivityTimeout: 180_000,
    enabled: !!currentSection?.contentId && currentSectionType === "video",
  });

  // Chat activity tracking (5 min inactivity timeout)
  // Chat segments can appear within any section type, so we keep the tracker
  // ready and trigger it manually via triggerChatActivity() in handleSendMessage
  const { triggerActivity: triggerChatActivity } = useActivityTracker({
    contentId: currentSection?.contentId ?? undefined,
    isAuthenticated,
    inactivityTimeout: 300_000,
    enabled: !!currentSection?.contentId,
  });

  // Fetch next module info when module completes
  useEffect(() => {
    if (!isModuleComplete || !module) return;

    // If no course context, this is a standalone module - no next
    if (!courseContext) {
      setModuleCompletionResult(null);
      return;
    }

    // Fetch next module from course
    async function fetchNext() {
      try {
        const result = await getNextModule(
          courseContext!.courseId,
          module!.slug,
        );
        setModuleCompletionResult(result);
      } catch (e) {
        console.error("[Module] Failed to fetch next module:", e);
        setModuleCompletionResult(null);
      }
    }

    fetchNext();
  }, [isModuleComplete, courseContext, module]);

  // Track module completed
  useEffect(() => {
    if (isModuleComplete && module) {
      trackModuleCompleted(module.slug);
    }
  }, [isModuleComplete, module]);

  // Track module start
  useEffect(() => {
    if (!module) return;
    if (!hasTrackedModuleStart.current) {
      hasTrackedModuleStart.current = true;
      trackModuleStarted(module.slug, module.title);
    }
  }, [module]);

  // Track position for retry
  const [lastPosition, setLastPosition] = useState<{
    sectionIndex: number;
    segmentIndex: number;
  } | null>(null);

  // Send message handler (shared across all chat sections)
  const handleSendMessage = useCallback(
    async (content: string, sectionIndex: number, segmentIndex: number) => {
      // Track chat activity on message send
      triggerChatActivity();

      // Store position for potential retry
      setLastPosition({ sectionIndex, segmentIndex });

      if (content) {
        setPendingMessage({ content, status: "sending" });
        trackChatMessageSent(moduleId, content.length);
      }
      setIsLoading(true);
      setStreamingContent("");

      try {
        let assistantContent = "";

        // Use new position-based API
        for await (const chunk of sendMessage(
          moduleId, // slug
          sectionIndex,
          segmentIndex,
          content,
        )) {
          if (chunk.type === "text" && chunk.content) {
            assistantContent += chunk.content;
            setStreamingContent(assistantContent);
          }
        }

        // Update local display state
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
    [triggerChatActivity, moduleId],
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
  // Only active in continuous mode
  useEffect(() => {
    // Skip scroll tracking in paginated mode
    if (viewMode === "paginated") return;

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
  }, [module, viewMode]);

  // Reset scroll position when navigating to a new section (paginated mode)
  useEffect(() => {
    if (viewMode === "paginated") {
      window.scrollTo(0, 0);
    }
  }, [currentSectionIndex, viewMode]);

  const handleStageClick = useCallback(
    (index: number) => {
      if (viewMode === "continuous") {
        // Scroll to section
        const el = sectionRefs.current.get(index);
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
        }
      } else {
        // Paginated: just update the index (render handles the rest)
        setCurrentSectionIndex(index);
      }
      setViewingStageIndex(index === currentSectionIndex ? null : index);
    },
    [currentSectionIndex, viewMode],
  );

  const handlePrevious = useCallback(() => {
    const prevIndex = Math.max(0, currentSectionIndex - 1);
    if (viewMode === "continuous") {
      handleStageClick(prevIndex);
    } else {
      setCurrentSectionIndex(prevIndex);
      setViewingStageIndex(null);
    }
  }, [currentSectionIndex, viewMode, handleStageClick]);

  const handleNext = useCallback(() => {
    if (!module) return;
    const nextIndex = Math.min(
      module.sections.length - 1,
      currentSectionIndex + 1,
    );
    if (viewMode === "continuous") {
      handleStageClick(nextIndex);
    } else {
      setCurrentSectionIndex(nextIndex);
      setViewingStageIndex(null);
    }
  }, [currentSectionIndex, module, viewMode, handleStageClick]);

  const handleMarkComplete = useCallback(
    (sectionIndex: number, apiResponse?: { module_status?: string }) => {
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

      // Check if module is now complete based on API response
      // This handles the case where server says "completed" even if local state doesn't match
      if (apiResponse?.module_status === "completed") {
        // Module is complete - mark as confirmed by API to show modal
        setApiConfirmedComplete(true);
        // No need to navigate to next section
        return;
      }

      // Navigate to next section
      if (module && sectionIndex < module.sections.length - 1) {
        const nextIndex = sectionIndex + 1;
        if (viewMode === "continuous") {
          handleStageClick(nextIndex);
        } else {
          setCurrentSectionIndex(nextIndex);
          setViewingStageIndex(null);
        }
      }
    },
    [
      completedSections.size,
      isAuthenticated,
      hasPromptedAuth,
      module,
      viewMode,
      handleStageClick,
    ],
  );

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
        // Get meta from article or lens-article sections
        const articleMeta =
          section.type === "article" || section.type === "lens-article"
            ? section.meta
            : null;
        const excerptData: ArticleData = {
          content: segment.content,
          title: articleMeta?.title ?? null,
          author: articleMeta?.author ?? null,
          sourceUrl: articleMeta?.sourceUrl ?? null,
          isExcerpt: true,
          collapsed_before: segment.collapsed_before,
          collapsed_after: segment.collapsed_after,
        };

        // Count how many article-excerpt segments came before this one
        const excerptsBefore =
          section.type === "article" || section.type === "lens-article"
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
        // Video excerpts can be in video or lens-video sections
        if (section.type !== "video" && section.type !== "lens-video")
          return null;

        // Count video excerpts to number them (Part 1, Part 2, etc.)
        // All video-excerpts in a video/lens-video section share the same videoId.
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

  // Loading state - skeleton layout mirrors actual content structure
  if (loadingModule) {
    return (
      <div className="min-h-dvh bg-stone-50 p-4 sm:p-6">
        {/* Module header skeleton */}
        <div className="mb-6">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-32" />
        </div>
        {/* Content skeleton */}
        <div className="max-w-2xl">
          <SkeletonText lines={4} className="mb-6" />
          <Skeleton
            className="h-48 w-full rounded-lg mb-6"
            variant="rectangular"
          />
          <SkeletonText lines={3} />
        </div>
      </div>
    );
  }

  // Error states
  if (loadError || !module) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{loadError ?? "Module not found"}</p>
          <a href="/" className="text-emerald-600 hover:underline">
            Go home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white overflow-x-clip">
      <div className="sticky top-0 z-50 bg-white">
        <ModuleHeader
          moduleTitle={module.title}
          stages={stages}
          completedStages={completedSections}
          viewingIndex={viewingStageIndex ?? currentSectionIndex}
          canGoPrevious={currentSectionIndex > 0}
          canGoNext={currentSectionIndex < module.sections.length - 1}
          onStageClick={handleStageClick}
          onPrevious={handlePrevious}
          onNext={handleNext}
        />
      </div>

      {/* Main content - padding-top accounts for fixed header */}
      <main className="pt-[var(--module-header-height)]">
        {module.sections.map((section, sectionIndex) => {
          // In paginated mode, only render current section
          if (
            viewMode === "paginated" &&
            sectionIndex !== currentSectionIndex
          ) {
            return null;
          }

          return (
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
                  <SectionDivider
                    type="article"
                    title={`Section ${sectionIndex + 1}`}
                  />
                  <AuthoredText content={section.content} />
                </>
              ) : section.type === "page" ? (
                // v2 Page section: text/chat segments only, no embedded content
                <>
                  <SectionDivider
                    type="page"
                    title={section.meta?.title || `Page ${sectionIndex + 1}`}
                  />
                  {section.segments?.map((segment, segmentIndex) =>
                    renderSegment(segment, section, sectionIndex, segmentIndex),
                  )}
                </>
              ) : section.type === "chat" ? (
                <>
                  <SectionDivider type="chat" title={section.meta?.title} />
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
              ) : section.type === "lens-video" ? (
                // v2 Lens Video section: video content with optional text/chat segments
                <>
                  <SectionDivider
                    type="lens-video"
                    optional={section.optional}
                    title={section.meta?.title}
                  />
                  {/* Render the main video first (full video, not excerpt) */}
                  <VideoEmbed
                    videoId={section.videoId}
                    start={0}
                    end={null}
                    title={section.meta.title}
                    channel={section.meta.channel}
                  />
                  {/* Then render any segments (text, video-excerpt, chat) */}
                  {section.segments?.map((segment, segmentIndex) =>
                    renderSegment(segment, section, sectionIndex, segmentIndex),
                  )}
                </>
              ) : section.type === "lens-article" ? (
                // v2 Lens Article section: article content with optional text/chat segments
                <>
                  <SectionDivider
                    type="lens-article"
                    optional={section.optional}
                    title={section.meta?.title}
                  />
                  <ArticleSectionWrapper>
                    {(() => {
                      // Split segments into pre-excerpt, excerpt, post-excerpt groups
                      const segments = section.segments ?? [];
                      const firstExcerptIdx = segments.findIndex(
                        (s) => s.type === "article-excerpt",
                      );
                      const lastExcerptIdx = segments.reduceRight(
                        (found, s, i) =>
                          found === -1 && s.type === "article-excerpt"
                            ? i
                            : found,
                        -1,
                      );

                      // If no excerpts, render all segments normally
                      if (firstExcerptIdx === -1) {
                        return segments.map((segment, segmentIndex) =>
                          renderSegment(
                            segment,
                            section,
                            sectionIndex,
                            segmentIndex,
                          ),
                        );
                      }

                      const preExcerpt = segments.slice(0, firstExcerptIdx);
                      const excerpts = segments.slice(
                        firstExcerptIdx,
                        lastExcerptIdx + 1,
                      );
                      const postExcerpt = segments.slice(lastExcerptIdx + 1);

                      return (
                        <>
                          {/* Pre-excerpt content (intro, setup) */}
                          {preExcerpt.map((segment, i) =>
                            renderSegment(segment, section, sectionIndex, i),
                          )}

                          {/* Excerpt group with sticky TOC */}
                          <ArticleExcerptGroup section={section}>
                            {excerpts.map((segment, i) =>
                              renderSegment(
                                segment,
                                section,
                                sectionIndex,
                                firstExcerptIdx + i,
                              ),
                            )}
                          </ArticleExcerptGroup>

                          {/* Post-excerpt content (reflection, chat) */}
                          {postExcerpt.map((segment, i) =>
                            renderSegment(
                              segment,
                              section,
                              sectionIndex,
                              lastExcerptIdx + 1 + i,
                            ),
                          )}
                        </>
                      );
                    })()}
                  </ArticleSectionWrapper>
                </>
              ) : section.type === "article" ? (
                // v1 Article section
                <>
                  <SectionDivider
                    type="article"
                    optional={section.optional}
                    title={section.meta?.title}
                  />
                  <ArticleSectionWrapper>
                    {(() => {
                      // Split segments into pre-excerpt, excerpt, post-excerpt groups
                      const segments = section.segments ?? [];
                      const firstExcerptIdx = segments.findIndex(
                        (s) => s.type === "article-excerpt",
                      );
                      const lastExcerptIdx = segments.reduceRight(
                        (found, s, i) =>
                          found === -1 && s.type === "article-excerpt"
                            ? i
                            : found,
                        -1,
                      );

                      // If no excerpts, render all segments normally
                      if (firstExcerptIdx === -1) {
                        return segments.map((segment, segmentIndex) =>
                          renderSegment(
                            segment,
                            section,
                            sectionIndex,
                            segmentIndex,
                          ),
                        );
                      }

                      const preExcerpt = segments.slice(0, firstExcerptIdx);
                      const excerpts = segments.slice(
                        firstExcerptIdx,
                        lastExcerptIdx + 1,
                      );
                      const postExcerpt = segments.slice(lastExcerptIdx + 1);

                      return (
                        <>
                          {/* Pre-excerpt content (intro, setup) */}
                          {preExcerpt.map((segment, i) =>
                            renderSegment(segment, section, sectionIndex, i),
                          )}

                          {/* Excerpt group with sticky TOC */}
                          <ArticleExcerptGroup section={section}>
                            {excerpts.map((segment, i) =>
                              renderSegment(
                                segment,
                                section,
                                sectionIndex,
                                firstExcerptIdx + i,
                              ),
                            )}
                          </ArticleExcerptGroup>

                          {/* Post-excerpt content (reflection, chat) */}
                          {postExcerpt.map((segment, i) =>
                            renderSegment(
                              segment,
                              section,
                              sectionIndex,
                              lastExcerptIdx + 1 + i,
                            ),
                          )}
                        </>
                      );
                    })()}
                  </ArticleSectionWrapper>
                </>
              ) : (
                // v1 Video section and fallback
                <>
                  <SectionDivider
                    type={section.type}
                    optional={"optional" in section ? section.optional : false}
                    title={"meta" in section ? section.meta?.title : undefined}
                  />
                  {"segments" in section &&
                    section.segments?.map((segment, segmentIndex) =>
                      renderSegment(
                        segment,
                        section,
                        sectionIndex,
                        segmentIndex,
                      ),
                    )}
                </>
              )}
              <MarkCompleteButton
                isCompleted={completedSections.has(sectionIndex)}
                onComplete={(response) =>
                  handleMarkComplete(sectionIndex, response)
                }
                onNext={handleNext}
                hasNext={sectionIndex < module.sections.length - 1}
                contentId={section.contentId ?? undefined}
                contentType="lens"
                contentTitle={
                  section.type === "text"
                    ? `Section ${sectionIndex + 1}`
                    : section.type === "page"
                      ? section.meta?.title || `Page ${sectionIndex + 1}`
                      : "meta" in section
                        ? section.meta?.title ||
                          `${section.type || "Section"} ${sectionIndex + 1}`
                        : `${section.type || "Section"} ${sectionIndex + 1}`
                }
              />
            </div>
          );
        })}
      </main>

      <ModuleDrawer
        moduleTitle={module.title}
        stages={stagesForDrawer}
        completedStages={completedSections}
        viewingIndex={viewingStageIndex ?? currentSectionIndex}
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
        onLogin={login}
        onDismiss={() => setShowAuthPrompt(false)}
      />
    </div>
  );
}
