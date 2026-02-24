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
  getModuleProgress,
} from "@/api/modules";
import type { ModuleCompletionResult, LensProgress } from "@/api/modules";

import { useAuth } from "@/hooks/useAuth";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { markComplete } from "@/api/progress";
import type { MarkCompleteResponse } from "@/api/progress";
import AuthoredText from "@/components/module/AuthoredText";
import ArticleEmbed from "@/components/module/ArticleEmbed";
import VideoEmbed from "@/components/module/VideoEmbed";
import NarrativeChatSection from "@/components/module/NarrativeChatSection";
import AnswerBox from "@/components/module/AnswerBox";
import TestSection from "@/components/module/TestSection";
import MarkCompleteButton from "@/components/module/MarkCompleteButton";
import { DoneReadingButton } from "@/components/module/DoneReadingButton";
import SectionDivider from "@/components/module/SectionDivider";
import ArticleSectionWrapper from "@/components/module/ArticleSectionWrapper";
import ArticleExcerptGroup from "@/components/module/ArticleExcerptGroup";
import { ModuleHeader } from "@/components/ModuleHeader";
import ModuleDrawer from "@/components/module/ModuleDrawer";
import type { ModuleDrawerHandle } from "@/components/module/ModuleDrawer";
import { ChatSidebar } from "@/components/module/ChatSidebar";
import ModuleCompleteModal from "@/components/module/ModuleCompleteModal";
import AuthPromptModal from "@/components/module/AuthPromptModal";
import {
  trackModuleStarted,
  trackModuleCompleted,
  trackChatMessageSent,
} from "@/analytics";
import { Skeleton, SkeletonText } from "@/components/Skeleton";
import { getSectionSlug, findSectionBySlug } from "@/utils/sectionSlug";
import {
  getCompletionButtonText,
  getSectionTextLength,
} from "@/utils/completionButtonText";

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
  // Module content UUID for multi-level time tracking (from progress API)
  const [moduleContentId, setModuleContentId] = useState<string | null>(null);

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
      wasCompleteOnLoad.current = false; // Reset when loading new module
      try {
        // Fetch module, course progress, and module progress in parallel
        const [moduleResult, courseResult, progressResult] = await Promise.all([
          getModule(moduleId),
          courseId
            ? getCourseProgress(courseId).catch(() => null)
            : Promise.resolve(null),
          getModuleProgress(moduleId).catch(() => null),
        ]);

        setModule(moduleResult);
        setCourseProgress(courseResult);

        // Initialize completedSections from progress API response
        if (progressResult) {
          const completed = new Set<number>();
          progressResult.lenses.forEach((lens, index) => {
            if (lens.completed) {
              completed.add(index);
            }
          });
          setCompletedSections(completed);

          // Store module content UUID for multi-level time tracking
          if (progressResult.module?.id) {
            setModuleContentId(progressResult.module.id);
          }

          // If module already complete, set flag and mark as complete on load
          if (progressResult.status === "completed") {
            setApiConfirmedComplete(true);
            wasCompleteOnLoad.current = true;
          }
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load module");
      } finally {
        setLoadingModule(false);
      }
    }

    load();
  }, [moduleId, courseId]);

  // Helper to update completedSections from lenses array
  const updateCompletedFromLenses = useCallback((lenses: LensProgress[]) => {
    const completed = new Set<number>();
    lenses.forEach((lens, index) => {
      if (lens.completed) {
        completed.add(index);
      }
    });
    setCompletedSections(completed);
  }, []);

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
          // Strip auto-sent assistant messages at the start of history (before the
          // first user message). These were AI-generated opening preambles that are
          // now replaced by the authored Lens bubble (prefixMessage).
          const firstUserIdx = history.messages.findIndex(
            (m) => m.role === "user",
          );
          const messagesToShow =
            firstUserIdx === -1
              ? [] // Only auto-sent messages exist — skip all
              : history.messages.slice(firstUserIdx);

          setMessages(
            messagesToShow.map((m) => ({
              role: m.role as "user" | "assistant" | "course-content",
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

  // Track if this is initial load vs user navigation (for pushState vs replaceState)
  const isInitialLoad = useRef(true);

  // Parse URL hash on mount, module load, and browser navigation
  useEffect(() => {
    if (!module) return;

    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove leading #
      if (!hash) {
        // No hash - go to first section
        setCurrentSectionIndex(0);
        return;
      }

      const sectionIndex = findSectionBySlug(module.sections, hash);
      if (sectionIndex !== -1) {
        setCurrentSectionIndex(sectionIndex);
      } else {
        // Invalid hash - strip it and go to first section
        window.history.replaceState(null, "", window.location.pathname);
        setCurrentSectionIndex(0);
      }
    };

    // Handle initial load
    handleHashChange();

    // Handle browser back/forward
    window.addEventListener("popstate", handleHashChange);

    return () => {
      window.removeEventListener("popstate", handleHashChange);
    };
  }, [module]);

  // Update URL hash when section changes
  useEffect(() => {
    if (!module) return;

    const currentSection = module.sections[currentSectionIndex];
    if (!currentSection) return;

    const slug = getSectionSlug(currentSection, currentSectionIndex);
    const newHash = `#${slug}`;
    const currentHash = window.location.hash;

    // On initial load, check if URL hash points to a different section
    // If so, wait for hash parsing effect to update state before touching URL
    if (isInitialLoad.current) {
      const hashSectionIndex = currentHash
        ? findSectionBySlug(module.sections, currentHash.slice(1))
        : -1;
      if (hashSectionIndex !== -1 && hashSectionIndex !== currentSectionIndex) {
        // URL hash resolves to a different section - state hasn't caught up yet
        return;
      }
      // Hash matches current state (or no hash) - use replaceState, not pushState
      if (currentHash !== newHash) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${newHash}`,
        );
      }
      isInitialLoad.current = false;
      return;
    }

    // Normal user navigation - use pushState for back button support
    if (currentHash !== newHash) {
      window.history.pushState(
        null,
        "",
        `${window.location.pathname}${newHash}`,
      );
    }
  }, [module, currentSectionIndex]);

  // Update document title to show current section
  useEffect(() => {
    if (!module) return;

    const currentSection = module.sections[currentSectionIndex];
    if (!currentSection) return;

    // Get section title
    let sectionTitle: string | null = null;
    switch (currentSection.type) {
      case "lens-article":
      case "lens-video":
        sectionTitle = currentSection.meta?.title ?? null;
        break;
      case "page":
      case "test":
        sectionTitle = currentSection.meta?.title ?? null;
        break;
      case "article":
      case "video":
      case "chat":
        sectionTitle = currentSection.meta?.title ?? null;
        break;
    }

    if (sectionTitle) {
      document.title = `${sectionTitle} | ${module.title}`;
    } else {
      document.title = module.title;
    }

    // Cleanup: restore module title when unmounting
    return () => {
      if (module) {
        document.title = module.title;
      }
    };
  }, [module, currentSectionIndex]);

  // Section completion tracking (database is source of truth)
  const [completedSections, setCompletedSections] = useState<Set<number>>(
    new Set(),
  );

  // Local "done reading" state for checkmark button (text/page/article sections)
  const [doneReadingSections, setDoneReadingSections] = useState<Set<number>>(
    () => new Set(),
  );

  const handleDoneReadingChange = (sectionIndex: number, checked: boolean) => {
    setDoneReadingSections((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sectionIndex);
      else next.delete(sectionIndex);
      return next;
    });
  };

  const { isAuthenticated, isInSignupsTable, isInActiveGroup, login } =
    useAuth();

  // Track previous auth state for detecting login
  const wasAuthenticated = useRef(isAuthenticated);

  // Handle login: re-fetch progress (claiming is now handled server-side during OAuth)
  useEffect(() => {
    // Only run when transitioning from anonymous to authenticated
    if (isAuthenticated && !wasAuthenticated.current && moduleId) {
      async function handleLogin() {
        try {
          // Re-fetch progress (now includes claimed records from OAuth callback)
          const progressResult = await getModuleProgress(moduleId);
          if (progressResult) {
            updateCompletedFromLenses(progressResult.lenses);
            if (progressResult.status === "completed") {
              setApiConfirmedComplete(true);
            }
          }
        } catch (e) {
          console.error("[Module] Failed to handle login:", e);
        }
      }
      handleLogin();
    }
    wasAuthenticated.current = isAuthenticated;
  }, [isAuthenticated, moduleId, updateCompletedFromLenses]);

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

  // Track if module was already complete when page loaded (for suppressing modal on review)
  const wasCompleteOnLoad = useRef(false);

  // Test mode: dims lesson navigation during test
  const [testModeActive, setTestModeActive] = useState(false);

  // View mode state (default to paginated)
  const [viewMode] = useState<ViewMode>("paginated");

  // Drawer ref for imperative toggle (state lives in ModuleDrawer to avoid re-rendering Module)
  const drawerRef = useRef<ModuleDrawerHandle>(null);

  // Track which question's feedback chat is currently visible (only one at a time)
  const [activeFeedbackKey, setActiveFeedbackKey] = useState<string | null>(
    null,
  );

  // Chat sidebar state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Ref to keep isSidebarOpen accessible inside scroll listener without stale closure
  const isSidebarOpenRef = useRef(false);
  useEffect(() => {
    isSidebarOpenRef.current = isSidebarOpen;
  }, [isSidebarOpen]);
  // True when sidebar was auto-closed by done-reading (scroll-up can reopen it)
  const sidebarAutoClosedRef = useRef(false);
  // Ref to the DoneReadingButton wrapper for scroll-position detection
  const doneReadingBtnRef = useRef<HTMLDivElement>(null);
  // Whether NarrativeChatSection should activate with full history after transfer
  const [activateNarrativeChat, setActivateNarrativeChat] = useState(false);

  // TOC portal container for 3-column grid layout (set by callback ref)
  const [tocContainer, setTocContainer] = useState<HTMLElement | null>(null);

  // Convert sections to Stage format for progress bar
  const stages: Stage[] = useMemo(() => {
    if (!module) return [];
    return module.sections.map((section, index): Stage => {
      // Map section types to stage types
      // v2 types: page, lens-video, lens-article, test
      // v1 types: text, article, video, chat

      // Test sections get their own stage type (StageIcon handles "test")
      if (section.type === "test") {
        const title = section.meta?.title || "Test";
        return {
          type: "test",
          source: "",
          from: null,
          to: null,
          title,
        } as unknown as Stage;
      }

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
      } else if (section.type === "test") {
        displayType = "test";
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
  const isArticleSection =
    currentSection?.type === "lens-article" ||
    currentSection?.type === "article";

  // Find chat segment in current article section for sidebar send handler
  const sidebarChatSegmentIndex = useMemo(() => {
    if (!currentSection || !isArticleSection) return -1;
    const segments =
      "segments" in currentSection ? currentSection.segments : [];
    return segments?.findIndex((s) => s.type === "chat") ?? -1;
  }, [currentSection, isArticleSection]);

  // Whether the current section has a post-article chat segment to transfer to
  const sectionHasChatSegment = useMemo(() => {
    if (!currentSection || !isArticleSection) return false;
    if (!("segments" in currentSection) || !currentSection.segments)
      return false;
    return currentSection.segments.some((s) => s.type === "chat");
  }, [currentSection, isArticleSection]);

  // Authored opening question for the current section's chat — shown as "Lens" message
  // in both the sidebar and the NarrativeChatSection.
  const sectionPrefixMessage = useMemo<ChatMessage | undefined>(() => {
    if (!currentSection || !isArticleSection) return undefined;
    if (!("segments" in currentSection) || !currentSection.segments)
      return undefined;
    const segs = currentSection.segments;
    const lastExcerptIdx = segs.reduceRight(
      (found, s, i) =>
        found === -1 && s.type === "article-excerpt" ? i : found,
      -1,
    );
    if (lastExcerptIdx === -1) return undefined;
    const postExcerpt = segs.slice(lastExcerptIdx + 1);
    const firstChatInPostIdx = postExcerpt.findIndex(
      (s) => s.type === "chat",
    );
    if (firstChatInPostIdx <= 0) return undefined;
    const content = postExcerpt
      .slice(0, firstChatInPostIdx)
      .filter((s) => s.type === "text")
      .map((s) => ("content" in s ? s.content : ""))
      .join("\n\n");
    return content ? { role: "course-content", content } : undefined;
  }, [currentSection, isArticleSection]);

  // Close chat sidebar when leaving article sections
  useEffect(() => {
    if (!isArticleSection) setIsSidebarOpen(false);
  }, [isArticleSection]);

  // Auto-close sidebar when done reading; activate NarrativeChatSection with history.
  // Uses isSidebarOpenRef (not state) to avoid re-running when sidebar reopens via scroll,
  // which would create a close-reopen loop.
  useEffect(() => {
    if (!isArticleSection) return;
    if (!doneReadingSections.has(currentSectionIndex)) return;
    // Only auto-close once (first time done reading fires)
    if (isSidebarOpenRef.current && !sidebarAutoClosedRef.current) {
      setIsSidebarOpen(false);
      sidebarAutoClosedRef.current = true;
    }
    if (sectionHasChatSegment) {
      setActivateNarrativeChat(true);
    }
  }, [doneReadingSections, currentSectionIndex, isArticleSection, sectionHasChatSegment]);

  // Reset per-section transfer state on section navigation
  useEffect(() => {
    sidebarAutoClosedRef.current = false;
    setActivateNarrativeChat(false);
  }, [currentSectionIndex]);

  // Scroll listener: reopen sidebar when user scrolls back up to reading area
  useEffect(() => {
    if (!isArticleSection) return;
    let prevScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - prevScrollY;
      prevScrollY = currentScrollY;
      // Only act on meaningful upward scroll
      if (scrollDelta >= -2) return;
      if (!sidebarAutoClosedRef.current || isSidebarOpenRef.current) return;
      const el = doneReadingBtnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Reopen when DoneReadingButton is well back in viewport (user scrolled up past it)
      if (rect.top > window.innerHeight * 0.5) {
        setIsSidebarOpen(true);
        sidebarAutoClosedRef.current = false;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isArticleSection]);

  // Unified activity tracking for current section (5 min inactivity timeout)
  // Covers article, video, and chat — triggerActivity() keeps it alive during chat
  const { triggerActivity: triggerChatActivity } = useActivityTracker({
    contentId: currentSection?.contentId ?? undefined,
    loId:
      currentSection && "learningOutcomeId" in currentSection
        ? currentSection.learningOutcomeId
        : undefined,
    moduleId: moduleContentId,
    isAuthenticated,
    contentTitle: currentSection?.meta?.title ?? undefined,
    moduleTitle: module?.title,
    loTitle:
      currentSection && "learningOutcomeName" in currentSection
        ? (currentSection.learningOutcomeName ?? undefined)
        : undefined,
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
            triggerChatActivity(); // Keep user active while AI response streams
          } else if (chunk.type === "error") {
            throw new Error(chunk.message || "Chat failed");
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
      // Block non-test navigation during test mode
      if (testModeActive && module) {
        const targetSection = module.sections[index];
        if (targetSection?.type !== "test") return;
      }
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
    },
    [viewMode, testModeActive, module],
  );

  const handlePrevious = useCallback(() => {
    if (testModeActive) return; // Block during test mode
    const prevIndex = Math.max(0, currentSectionIndex - 1);
    if (viewMode === "continuous") {
      handleStageClick(prevIndex);
    } else {
      setCurrentSectionIndex(prevIndex);
    }
  }, [currentSectionIndex, viewMode, handleStageClick, testModeActive]);

  const handleNext = useCallback(() => {
    if (testModeActive) return; // Block during test mode
    if (!module) return;
    const nextIndex = Math.min(
      module.sections.length - 1,
      currentSectionIndex + 1,
    );
    if (viewMode === "continuous") {
      handleStageClick(nextIndex);
    } else {
      setCurrentSectionIndex(nextIndex);
    }
  }, [currentSectionIndex, module, viewMode, handleStageClick, testModeActive]);

  const handleMarkComplete = useCallback(
    (sectionIndex: number, apiResponse?: MarkCompleteResponse) => {
      // Also mark as done reading (for reading sections with DoneReadingButton)
      setDoneReadingSections((prev) => {
        const next = new Set(prev);
        next.add(sectionIndex);
        return next;
      });

      // Check if this is the first completion (for auth prompt)
      // Must check BEFORE updating state
      const isFirstCompletion = completedSections.size === 0;

      // Update state from API response if lenses array provided
      if (apiResponse?.lenses) {
        updateCompletedFromLenses(apiResponse.lenses);
      } else {
        // Fallback: just add this section (shouldn't happen with module_slug)
        setCompletedSections((prev) => {
          const next = new Set(prev);
          next.add(sectionIndex);
          return next;
        });
      }

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
      updateCompletedFromLenses,
    ],
  );

  // Render a segment (sectionIndex included for unique keys)
  const renderSegment = (
    segment: ModuleSegment,
    section: ModuleSection,
    sectionIndex: number,
    segmentIndex: number,
    options?: { activateChat?: boolean; prefixMessage?: ChatMessage },
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
            activated={options?.activateChat}
            activatedWithHistory={options?.activateChat}
            prefixMessage={options?.prefixMessage}
          />
        );

      case "question": {
        const feedbackKey = `${sectionIndex}-${segmentIndex}`;
        return (
          <div key={`question-${keyPrefix}`}>
            <AnswerBox
              segment={segment}
              moduleSlug={module.slug}
              sectionIndex={sectionIndex}
              segmentIndex={segmentIndex}
              isAuthenticated={isAuthenticated}
              onFeedbackTrigger={(answerText) => {
                setActiveFeedbackKey(feedbackKey);
                const questionText = segment.content;
                handleSendMessage(
                  `I just answered this question: "${questionText}"\n\nMy answer: "${answerText}"\n\nCan you give me feedback?`,
                  sectionIndex,
                  segmentIndex,
                );
              }}
            />
            {segment.feedback && activeFeedbackKey === feedbackKey && (
              <NarrativeChatSection
                messages={messages}
                pendingMessage={pendingMessage}
                streamingContent={streamingContent}
                isLoading={isLoading}
                onSendMessage={(content) =>
                  handleSendMessage(content, sectionIndex, segmentIndex)
                }
                onRetryMessage={handleRetryMessage}
                scrollToResponse
                activated
              />
            )}
          </div>
        );
      }

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

  // Module loaded but has flattening error
  if (module.error) {
    return (
      <div className="min-h-dvh bg-stone-50">
        <div className="sticky top-0 z-50 bg-white border-b border-stone-200">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <h1 className="text-xl font-semibold text-stone-900">
              {module.title}
            </h1>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800 mb-2">
              Module Error
            </h2>
            <p className="text-red-700 mb-4">
              This module failed to load due to a content error:
            </p>
            <pre className="bg-red-100 p-4 rounded text-sm text-red-900 overflow-x-auto whitespace-pre-wrap">
              {module.error}
            </pre>
            <p className="text-red-600 text-sm mt-4">
              Please contact the course administrators to resolve this issue.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white overflow-x-clip">
      <ModuleHeader
        moduleTitle={module.title}
        stages={stages}
        completedStages={completedSections}
        currentSectionIndex={currentSectionIndex}
        canGoPrevious={!testModeActive && currentSectionIndex > 0}
        canGoNext={
          !testModeActive && currentSectionIndex < module.sections.length - 1
        }
        onStageClick={handleStageClick}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onMenuToggle={() => drawerRef.current?.toggle()}
        testModeActive={testModeActive}
      />

      {/* Layout: optional TOC column (xl+) + content + optional chat sidebar */}
      <div
        className={`pt-[var(--module-header-height)] ${
          isArticleSection ? "xl:grid xl:grid-cols-12" : ""
        }`}
      >
      {/* TOC column — article sections, xl+ only */}
      {isArticleSection && (
        <aside className="hidden xl:block xl:col-span-3">
          <div
            ref={setTocContainer}
            className="sticky top-[calc(var(--module-header-height)+12px)] ml-auto w-[250px] pr-6 pt-4 max-h-[calc(100dvh-var(--module-header-height)-24px)] overflow-y-auto scrollbar-hide"
          />
        </aside>
      )}

      {/* Content + sidebar wrapper */}
      <div className={`flex ${isArticleSection ? "xl:col-span-9" : ""}`}>
      <main className="flex-1 min-w-0">
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
                  <DoneReadingButton
                    isChecked={doneReadingSections.has(sectionIndex)}
                    onChange={(checked) =>
                      handleDoneReadingChange(sectionIndex, checked)
                    }
                  />
                </>
              ) : section.type === "page" ? (
                // v2 Page section: text/chat segments only, no embedded content
                <>
                  <SectionDivider
                    type="page"
                    title={section.meta?.title || `Page ${sectionIndex + 1}`}
                  />
                  {(() => {
                    const segs = section.segments ?? [];
                    const firstChatIdx = segs.findIndex(
                      (s) => s.type === "chat",
                    );
                    if (firstChatIdx === -1) {
                      return (
                        <>
                          {segs.map((seg, i) =>
                            renderSegment(seg, section, sectionIndex, i),
                          )}
                          <DoneReadingButton
                            isChecked={doneReadingSections.has(sectionIndex)}
                            onChange={(checked) =>
                              handleDoneReadingChange(sectionIndex, checked)
                            }
                          />
                        </>
                      );
                    }
                    const beforeChat = segs.slice(0, firstChatIdx);
                    const fromChat = segs.slice(firstChatIdx);
                    return (
                      <>
                        {beforeChat.map((seg, i) =>
                          renderSegment(seg, section, sectionIndex, i),
                        )}
                        <DoneReadingButton
                          isChecked={doneReadingSections.has(sectionIndex)}
                          onChange={(checked) =>
                            handleDoneReadingChange(sectionIndex, checked)
                          }
                        />
                        {fromChat.map((seg, i) =>
                          renderSegment(
                            seg,
                            section,
                            sectionIndex,
                            firstChatIdx + i,
                          ),
                        )}
                      </>
                    );
                  })()}
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
                  {/* Render segments (text, video-excerpt, chat) */}
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
                  <ArticleSectionWrapper tocPortalContainer={tocContainer}>
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

                      // If no excerpts, render all segments then button
                      if (firstExcerptIdx === -1) {
                        return (
                          <>
                            {segments.map((segment, segmentIndex) =>
                              renderSegment(
                                segment,
                                section,
                                sectionIndex,
                                segmentIndex,
                              ),
                            )}
                            <div
                              ref={
                                sectionIndex === currentSectionIndex
                                  ? doneReadingBtnRef
                                  : null
                              }
                            >
                              <DoneReadingButton
                                isChecked={doneReadingSections.has(
                                  sectionIndex,
                                )}
                                onChange={(checked) =>
                                  handleDoneReadingChange(sectionIndex, checked)
                                }
                              />
                            </div>
                          </>
                        );
                      }

                      const preExcerpt = segments.slice(0, firstExcerptIdx);
                      const excerpts = segments.slice(
                        firstExcerptIdx,
                        lastExcerptIdx + 1,
                      );
                      const postExcerpt = segments.slice(lastExcerptIdx + 1);
                      const isCurrent = sectionIndex === currentSectionIndex;

                      // Extract text segments before the first chat in postExcerpt
                      // as a "Lens" prefix message — suppress their inline rendering
                      const firstChatInPostIdx = postExcerpt.findIndex(
                        (s) => s.type === "chat",
                      );
                      const prefixTextContent =
                        firstChatInPostIdx > 0
                          ? postExcerpt
                              .slice(0, firstChatInPostIdx)
                              .filter((s) => s.type === "text")
                              .map((s) => ("content" in s ? s.content : ""))
                              .join("\n\n")
                          : null;
                      const postExcerptPrefixMessage: ChatMessage | undefined =
                        prefixTextContent
                          ? { role: "course-content", content: prefixTextContent }
                          : undefined;

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

                          {/* Done reading button — after article text, before chat/reflection */}
                          <div
                            ref={isCurrent ? doneReadingBtnRef : null}
                          >
                            <DoneReadingButton
                              isChecked={doneReadingSections.has(sectionIndex)}
                              onChange={(checked) =>
                                handleDoneReadingChange(sectionIndex, checked)
                              }
                            />
                          </div>

                          {/* Post-excerpt content (reflection, chat) — skip text segments
                              before first chat (they're passed as prefixMessage instead) */}
                          {postExcerpt.map((segment, i) => {
                            if (
                              firstChatInPostIdx > -1 &&
                              i < firstChatInPostIdx &&
                              segment.type === "text"
                            ) {
                              return null;
                            }
                            return renderSegment(
                              segment,
                              section,
                              sectionIndex,
                              lastExcerptIdx + 1 + i,
                              {
                                activateChat:
                                  isCurrent && activateNarrativeChat,
                                prefixMessage:
                                  i === firstChatInPostIdx
                                    ? postExcerptPrefixMessage
                                    : undefined,
                              },
                            );
                          })}
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
                  <ArticleSectionWrapper tocPortalContainer={tocContainer}>
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

                      // If no excerpts, render all segments then button
                      if (firstExcerptIdx === -1) {
                        return (
                          <>
                            {segments.map((segment, segmentIndex) =>
                              renderSegment(
                                segment,
                                section,
                                sectionIndex,
                                segmentIndex,
                              ),
                            )}
                            <div
                              ref={
                                sectionIndex === currentSectionIndex
                                  ? doneReadingBtnRef
                                  : null
                              }
                            >
                              <DoneReadingButton
                                isChecked={doneReadingSections.has(
                                  sectionIndex,
                                )}
                                onChange={(checked) =>
                                  handleDoneReadingChange(sectionIndex, checked)
                                }
                              />
                            </div>
                          </>
                        );
                      }

                      const preExcerpt = segments.slice(0, firstExcerptIdx);
                      const excerpts = segments.slice(
                        firstExcerptIdx,
                        lastExcerptIdx + 1,
                      );
                      const postExcerpt = segments.slice(lastExcerptIdx + 1);
                      const isCurrent = sectionIndex === currentSectionIndex;

                      // Extract text segments before the first chat in postExcerpt
                      // as a "Lens" prefix message — suppress their inline rendering
                      const firstChatInPostIdx = postExcerpt.findIndex(
                        (s) => s.type === "chat",
                      );
                      const prefixTextContent =
                        firstChatInPostIdx > 0
                          ? postExcerpt
                              .slice(0, firstChatInPostIdx)
                              .filter((s) => s.type === "text")
                              .map((s) => ("content" in s ? s.content : ""))
                              .join("\n\n")
                          : null;
                      const postExcerptPrefixMessage: ChatMessage | undefined =
                        prefixTextContent
                          ? { role: "course-content", content: prefixTextContent }
                          : undefined;

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

                          {/* Done reading button — after article text, before chat/reflection */}
                          <div ref={isCurrent ? doneReadingBtnRef : null}>
                            <DoneReadingButton
                              isChecked={doneReadingSections.has(sectionIndex)}
                              onChange={(checked) =>
                                handleDoneReadingChange(sectionIndex, checked)
                              }
                            />
                          </div>

                          {/* Post-excerpt content (reflection, chat) — skip text segments
                              before first chat (they're passed as prefixMessage instead) */}
                          {postExcerpt.map((segment, i) => {
                            if (
                              firstChatInPostIdx > -1 &&
                              i < firstChatInPostIdx &&
                              segment.type === "text"
                            ) {
                              return null;
                            }
                            return renderSegment(
                              segment,
                              section,
                              sectionIndex,
                              lastExcerptIdx + 1 + i,
                              {
                                activateChat:
                                  isCurrent && activateNarrativeChat,
                                prefixMessage:
                                  i === firstChatInPostIdx
                                    ? postExcerptPrefixMessage
                                    : undefined,
                              },
                            );
                          })}
                        </>
                      );
                    })()}
                  </ArticleSectionWrapper>
                </>
              ) : section.type === "test" ? (
                // v2 Test section: grouped assessment questions
                (() => {
                  const feedbackKey = `test-${sectionIndex}`;
                  return (
                    <>
                      <TestSection
                        section={section}
                        moduleSlug={moduleId}
                        sectionIndex={sectionIndex}
                        isAuthenticated={isAuthenticated}
                        onTestStart={() => setTestModeActive(true)}
                        onTestTakingComplete={() => setTestModeActive(false)}
                        onMarkComplete={(response) =>
                          handleMarkComplete(sectionIndex, response)
                        }
                        onFeedbackTrigger={
                          section.feedback
                            ? (questionsAndAnswers) => {
                                setActiveFeedbackKey(feedbackKey);
                                const lines = questionsAndAnswers.map(
                                  (qa, i) =>
                                    `Question ${i + 1}: "${qa.question}"\nMy answer: "${qa.answer}"`,
                                );
                                handleSendMessage(
                                  `I just completed a test. Here are the questions and my answers:\n\n${lines.join("\n\n")}\n\nCan you give me feedback on my answers?`,
                                  sectionIndex,
                                  0,
                                );
                              }
                            : undefined
                        }
                      />
                      {section.feedback &&
                        activeFeedbackKey === feedbackKey && (
                          <>
                            <NarrativeChatSection
                              messages={messages}
                              pendingMessage={pendingMessage}
                              streamingContent={streamingContent}
                              isLoading={isLoading}
                              onSendMessage={(content) =>
                                handleSendMessage(content, sectionIndex, 0)
                              }
                              onRetryMessage={handleRetryMessage}
                              scrollToResponse
                              activated
                            />
                            <div className="flex items-center justify-center py-6">
                              <button
                                onClick={() => {
                                  const contentId = `test:${moduleId}:${sectionIndex}`;
                                  markComplete(
                                    {
                                      content_id: contentId,
                                      content_type: "test",
                                      content_title:
                                        section.meta?.title || "Test",
                                      module_slug: moduleId,
                                    },
                                    isAuthenticated,
                                  )
                                    .then((response) =>
                                      handleMarkComplete(
                                        sectionIndex,
                                        response,
                                      ),
                                    )
                                    .catch(() =>
                                      handleMarkComplete(sectionIndex),
                                    );
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all active:scale-95 font-medium"
                              >
                                Continue
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </button>
                            </div>
                          </>
                        )}
                    </>
                  );
                })()
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
              {section.type !== "test" && (
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
                  moduleSlug={moduleId}
                  buttonText={getCompletionButtonText(section, sectionIndex)}
                  isShort={getSectionTextLength(section) < 1750}
                />
              )}
              {/* Last section completed: show course navigation */}
              {sectionIndex === module.sections.length - 1 &&
                completedSections.has(sectionIndex) &&
                courseId && (
                  <div className="flex justify-center pb-12">
                    <a
                      href={`/course/${courseId}`}
                      className="flex items-center gap-2 px-5 py-2.5 text-stone-600 hover:text-stone-900 border border-stone-300 hover:border-stone-400 rounded-lg transition-colors font-medium"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                      Back to Course Overview
                    </a>
                  </div>
                )}
            </div>
          );
        })}
      </main>

      {isArticleSection && (
        <ChatSidebar
          isOpen={isSidebarOpen}
          onOpen={() => {
            setIsSidebarOpen(true);
            sidebarAutoClosedRef.current = false;
          }}
          onClose={() => setIsSidebarOpen(false)}
          sectionTitle={currentSection?.meta?.title}
          messages={messages}
          prefixMessage={
            doneReadingSections.has(currentSectionIndex)
              ? sectionPrefixMessage
              : undefined
          }
          pendingMessage={pendingMessage}
          streamingContent={streamingContent}
          isLoading={isLoading}
          onSendMessage={(content) =>
            handleSendMessage(
              content,
              currentSectionIndex,
              sidebarChatSegmentIndex !== -1 ? sidebarChatSegmentIndex : 0,
            )
          }
          onRetryMessage={handleRetryMessage}
        />
      )}
      </div>{/* /flex content+sidebar */}
      </div>{/* /grid wrapper */}

      <ModuleDrawer
        ref={drawerRef}
        moduleTitle={module.title}
        stages={stagesForDrawer}
        completedStages={completedSections}
        currentSectionIndex={currentSectionIndex}
        onStageClick={handleStageClick}
        courseId={courseId}
        courseTitle={courseProgress?.course.title}
        testModeActive={testModeActive}
      />

      <ModuleCompleteModal
        isOpen={
          isModuleComplete &&
          !completionModalDismissed &&
          !wasCompleteOnLoad.current
        }
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
