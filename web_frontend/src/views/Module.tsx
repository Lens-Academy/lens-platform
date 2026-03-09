// web_frontend/src/views/Module.tsx

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ArticleData, Stage } from "@/types/module";
import type { StageInfo } from "@/types/course";
import type { ViewMode } from "@/types/viewMode";
import type {
  Module as ModuleType,
  ModuleSection,
  ModuleSegment,
} from "@/types/module";
import type { CourseProgress } from "@/types/course";
import {
  getNextModule,
  getModule,
  getCourseProgress,
  getModuleProgress,
} from "@/api/modules";
import type { ModuleCompletionResult, LensProgress } from "@/api/modules";

import { useAuth } from "@/hooks/useAuth";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useTutorChat } from "@/hooks/useTutorChat";
import { markComplete } from "@/api/progress";
import type { MarkCompleteResponse } from "@/api/progress";
import AuthoredText from "@/components/module/AuthoredText";
import ArticleEmbed from "@/components/module/ArticleEmbed";
import VideoEmbed from "@/components/module/VideoEmbed";
import { ChatInlineShell } from "@/components/module/ChatInlineShell";
import AnswerBox from "@/components/module/AnswerBox";
import RoleplaySection from "@/components/module/RoleplaySection";
import TestSection from "@/components/module/TestSection";
import MarkCompleteButton from "@/components/module/MarkCompleteButton";
import SectionDivider from "@/components/module/SectionDivider";
import {
  computeSectionDuration,
  computeDurationBreakdown,
} from "@/utils/duration";
import ArticleSectionWrapper from "@/components/module/ArticleSectionWrapper";
import ArticleExcerptGroup from "@/components/module/ArticleExcerptGroup";
import { ModuleHeader } from "@/components/ModuleHeader";
import ModuleDrawer from "@/components/module/ModuleDrawer";
import type { ModuleDrawerHandle } from "@/components/module/ModuleDrawer";
import { ChatSidebar } from "@/components/module/ChatSidebar";
import type { ChatSidebarHandle } from "@/components/module/ChatSidebar";
import ModuleCompleteModal from "@/components/module/ModuleCompleteModal";
import SectionChoiceModal from "@/components/module/SectionChoiceModal";
import type { SectionChoice } from "@/components/module/SectionChoiceModal";
import AuthPromptModal from "@/components/module/AuthPromptModal";

import { ScrollContainerContext } from "@/hooks/useScrollContainer";
import { trackModuleStarted, trackModuleCompleted } from "@/analytics";
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

// ---------------------------------------------------------------------------
// DebugOverlay — subscribes to segment index ref via useSyncExternalStore
// so its re-renders never touch Module.
// ---------------------------------------------------------------------------

function DebugOverlay({
  currentSection,
  currentSectionIndex,
  sidebarChatSegmentIndex,
  segmentIndexRef,
  listeners,
}: {
  currentSection: ModuleSection;
  currentSectionIndex: number;
  sidebarChatSegmentIndex: number;
  segmentIndexRef: React.RefObject<number>;
  listeners: React.RefObject<Set<() => void>>;
}) {
  const currentSegmentIndex = useSyncExternalStore(
    (cb) => {
      listeners.current.add(cb);
      return () => listeners.current.delete(cb);
    },
    () => segmentIndexRef.current,
  );

  const segments =
    "segments" in currentSection ? (currentSection.segments ?? []) : [];
  const seg = segments[currentSegmentIndex] as ModuleSegment | undefined;
  const segLabel = (s: ModuleSegment) => {
    switch (s.type) {
      case "article-excerpt":
        return `from: ${(s.content ?? "").slice(0, 40)}…`;
      case "video-excerpt":
        return `${s.from}s–${s.to ?? "end"}s`;
      case "text":
        return (s.content ?? "").slice(0, 40) + "…";
      case "chat":
        return (s.instructions ?? "").slice(0, 40) + "…";
      case "question":
        return (s.content ?? "").slice(0, 40) + "…";
      case "roleplay":
        return "Roleplay: " + (s.content ?? "").slice(0, 40) + "…";
      default:
        return "";
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-xs rounded-lg bg-gray-900/85 px-3 py-2 text-xs text-gray-100 font-mono shadow-lg backdrop-blur-sm max-h-[50vh] overflow-y-auto">
      <div className="font-bold text-yellow-300 mb-1">Debug Overlay</div>
      <div>
        <span className="text-gray-400">Section:</span> §{currentSectionIndex}:{" "}
        {currentSection.meta?.title ?? "(untitled)"}
      </div>
      <div>
        <span className="text-gray-400">Segment:</span> [{currentSegmentIndex}]{" "}
        {seg ? seg.type : "—"} {seg ? segLabel(seg) : ""}
      </div>
      <div>
        <span className="text-gray-400">Sidebar target:</span>{" "}
        <span
          className={
            sidebarChatSegmentIndex === currentSegmentIndex
              ? "text-green-400"
              : "text-red-400"
          }
        >
          {sidebarChatSegmentIndex}
        </span>
      </div>
      <div className="mt-1 border-t border-gray-700 pt-1">
        <span className="text-gray-400">Segments ({segments.length}):</span>
        {segments.map((s, i) => (
          <div
            key={i}
            className={`pl-2 ${i === currentSegmentIndex ? "text-yellow-300 font-bold" : "text-gray-400"}`}
          >
            [{i}] {s.type}
            {i === sidebarChatSegmentIndex && " ← sidebar"}
          </div>
        ))}
      </div>
    </div>
  );
}

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
      initialCompletedRef.current = new Set();
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
          initialCompletedRef.current = completed;
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

  // Scroll container ref (setState as callback ref so re-render provides context)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  // Progress tracking
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Track if this is initial load vs user navigation (for pushState vs replaceState)
  const isInitialLoad = useRef(true);

  // Ref to hold initial completed sections for the hash effect (avoids dependency on completedSections)
  const initialCompletedRef = useRef<Set<number>>(new Set());

  // Parse URL hash on mount, module load, and browser navigation
  useEffect(() => {
    if (!module) return;

    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove leading #
      if (!hash) {
        // No hash - find first non-optional incomplete section
        const completed = initialCompletedRef.current;
        const firstIncomplete = module.sections.findIndex(
          (section, index) =>
            !completed.has(index) &&
            !("optional" in section && section.optional),
        );
        setCurrentSectionIndex(firstIncomplete !== -1 ? firstIncomplete : 0);
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

  // Section choice modal state (shown when optional content follows)
  const [sectionChoiceOpen, setSectionChoiceOpen] = useState(false);
  const [sectionChoices, setSectionChoices] = useState<SectionChoice[]>([]);
  const [completedSectionTitle, setCompletedSectionTitle] = useState<string>();

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

  // TOC portal container for 3-column grid layout (set by callback ref)

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
          type: "page",
          source: "",
          from: null,
          to: null,
          title,
          tldr: section.tldr,
          duration: computeSectionDuration(section) || null,
        } as unknown as Stage;
      }

      let stageType: "article" | "video" | "chat" | "page";
      if (section.type === "video" || section.type === "lens-video") {
        stageType = "video";
      } else if (section.type === "page") {
        stageType = "page";
      } else if (
        section.type === "article" ||
        section.type === "lens-article" ||
        section.type === "text"
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
      const tldr =
        "tldr" in section ? (section.tldr as string | undefined) : undefined;
      const duration = computeSectionDuration(section) || null;

      if (stageType === "page") {
        return {
          type: "page",
          source: "",
          from: null,
          to: null,
          optional: isOptional,
          title,
          tldr,
          duration,
        };
      } else if (stageType === "article") {
        return {
          type: "article",
          source: "",
          from: null,
          to: null,
          optional: isOptional,
          title,
          tldr,
          duration,
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
          tldr,
          duration,
        };
      } else {
        return {
          type: "chat",
          instructions: "",
          hidePreviousContentFromUser: false,
          hidePreviousContentFromTutor: false,
          title,
          tldr,
          duration,
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

      const dur = computeSectionDuration(section);
      return {
        type: displayType,
        title:
          section.type === "text"
            ? `Section ${index + 1}`
            : section.type === "page"
              ? section.meta?.title || `Page ${index + 1}`
              : section.meta?.title ||
                `${section.type || "Section"} ${index + 1}`,
        duration: dur || null,
        optional: "optional" in section && section.optional === true,
        tldr:
          "tldr" in section ? (section.tldr as string | undefined) : undefined,
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
  const sidebarAllowed =
    currentSection != null &&
    currentSection.type !== "chat" &&
    currentSection.type !== "test";

  // --- Debug overlay: track current visible segment ---
  const isDebugMode =
    typeof window !== "undefined" && window.location.search.includes("debug");
  const currentSegmentIndexRef = useRef(0);
  const segmentIndexListeners = useRef(new Set<() => void>());
  // Ref-based store for scroll-refined sidebar allowed state.
  // Same pattern as segmentIndex — write from scroll handler, subscribe
  // from ChatInlineShell via useSyncExternalStore. Module never re-renders.
  const sidebarAllowedRef = useRef(sidebarAllowed); // initial: section-level default
  const sidebarAllowedListeners = useRef(new Set<() => void>());
  const segmentElsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerSegmentEl = useCallback(
    (key: string, el: HTMLDivElement | null) => {
      if (el) {
        segmentElsRef.current.set(key, el);
      } else {
        segmentElsRef.current.delete(key);
      }
    },
    [],
  );

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

  // Chat state — centralised in useTutorChat hook
  const {
    messages,
    pendingMessage,
    streamingContent,
    isLoading,
    sendSource,
    sendMessage: handleSendMessage,
    retryMessage: handleRetryMessage,
    activeSurface,
    registerInlineRef,
    sidebarChatSegmentIndex,
    chatInteractedSections,
  } = useTutorChat({
    moduleId,
    module,
    currentSectionIndex,
    currentSection,
    isArticleSection,
    triggerChatActivity,
  });

  const sidebarRef = useRef<ChatSidebarHandle>(null);
  const lastSidebarAllowed = useRef(true);
  const sidebarAllowedLockUntil = useRef(0);
  const hasReachedExcerptRef = useRef(false);

  // Segment scroll tracker: determines which segment the 30% viewport line
  // falls inside. Always runs (drives sidebar allowed state). Writes to ref
  // (not state) so Module never re-renders from scroll. DebugOverlay subscribes
  // to the ref via useSyncExternalStore.
  useEffect(() => {
    // Reset lock on section change
    lastSidebarAllowed.current = true;
    sidebarAllowedLockUntil.current = 0;
    sidebarAllowedRef.current = sidebarAllowed;
    sidebarAllowedListeners.current.forEach((fn) => fn());

    hasReachedExcerptRef.current = false;

    if (!isArticleSection) {
      // sidebarAllowedRef starts at `sidebarAllowed` (false for non-article).
      // No need to write — the hook reads the initial value on mount.
      return;
    }

    // Start sidebar closed on article sections — auto-opens at first excerpt
    sidebarRef.current?.setOpen(false);

    const segments =
      currentSection && "segments" in currentSection
        ? currentSection.segments
        : undefined;
    const firstExcerptIdx =
      segments?.findIndex((s) => s.type === "article-excerpt") ?? -1;

    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const targetY = window.innerHeight * 0.3;
        let best: { index: number; dist: number } | null = null;
        // Find the segment that contains the target line (direction-independent)
        segmentElsRef.current.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const idx = Number(el.dataset.segmentIndex);
          if (isNaN(idx)) return;
          if (rect.top <= targetY && rect.bottom > targetY) {
            best = { index: idx, dist: 0 };
          } else if (!best || best.dist > 0) {
            const dist = Math.min(
              Math.abs(rect.top - targetY),
              Math.abs(rect.bottom - targetY),
            );
            if (!best || dist < best.dist) best = { index: idx, dist };
          }
        });
        if (best) {
          // Write to ref (free) + notify subscribers (DebugOverlay only)
          currentSegmentIndexRef.current = best.index;
          segmentIndexListeners.current.forEach((fn) => fn());

          // Auto-open sidebar when scrolling to first article excerpt (never on mobile)
          if (
            !hasReachedExcerptRef.current &&
            firstExcerptIdx >= 0 &&
            best.index >= firstExcerptIdx
          ) {
            hasReachedExcerptRef.current = true;
            if (!window.matchMedia("(max-width: 700px)").matches) {
              const pref = localStorage.getItem("chat-sidebar-pref");
              if (pref === null || pref === "open") {
                sidebarRef.current?.setOpen(true);
              }
            }
          }

          // Sidebar disallowed when any chat input pill overlaps the 20%-80% viewport band
          const bandTop = window.innerHeight * 0.35;
          const bandBottom = window.innerHeight * 0.95;
          let chatInBand = false;
          segmentElsRef.current.forEach((el) => {
            const idx = Number(el.dataset.segmentIndex);
            if (isNaN(idx) || segments?.[idx]?.type !== "chat") return;
            const pill = el.querySelector("[data-chat-input-pill]");
            if (!pill) return;
            const rect = pill.getBoundingClientRect();
            if (rect.bottom > bandTop && rect.top < bandBottom) {
              chatInBand = true;
            }
          });
          const allowed = sidebarAllowed && !chatInBand;

          // Guard against reflow feedback loop: closing the sidebar changes margin →
          // content reflows → scroll fires → segment shifts → setAllowed(true) reopens.
          // Lock for the transition duration after closing to prevent this.
          if (Date.now() < sidebarAllowedLockUntil.current) return;
          if (allowed !== lastSidebarAllowed.current) {
            lastSidebarAllowed.current = allowed;
            sidebarAllowedRef.current = allowed;
            sidebarAllowedListeners.current.forEach((fn) => fn());
            if (!allowed) sidebarAllowedLockUntil.current = Date.now() + 350;
          }
        }
      });
    };
    const target = scrollEl ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // initial check
    return () => {
      target.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [
    isArticleSection,
    currentSectionIndex,
    currentSection,
    sidebarAllowed,
    scrollEl,
  ]);

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

    const scrollTarget = scrollEl ?? window;
    scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", calculateCurrentSection);

    return () => {
      clearTimeout(timeout);
      scrollTarget.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", calculateCurrentSection);
    };
  }, [module, viewMode, scrollEl]);

  // Reset scroll position when navigating to a new section (paginated mode)
  useEffect(() => {
    if (viewMode === "paginated") {
      if (scrollEl) scrollEl.scrollTop = 0;
      else window.scrollTo(0, 0);
    }
  }, [currentSectionIndex, viewMode, scrollEl]);

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

  // Build choices for the section navigation modal
  // Collects upcoming sections (optional + first required) after a completed section
  function buildSectionChoices(
    sections: ModuleSection[],
    completedIndex: number,
  ): SectionChoice[] {
    const choices: SectionChoice[] = [];
    for (let i = completedIndex + 1; i < sections.length; i++) {
      const section = sections[i];
      // Only v2 section types have optional field directly
      if (!("optional" in section)) continue;
      const sectionType = section.type as SectionChoice["type"];
      if (!["lens-video", "lens-article", "page", "test"].includes(sectionType))
        continue;

      choices.push({
        index: i,
        type: sectionType,
        title: section.meta?.title ?? section.type,
        tldr:
          "tldr" in section ? (section.tldr as string | undefined) : undefined,
        optional: section.optional ?? false,
        duration: null,
      });

      // Stop after first required section (that's the "continue" target)
      if (!section.optional) break;
    }
    return choices;
  }

  const handleMarkComplete = useCallback(
    (sectionIndex: number, apiResponse?: MarkCompleteResponse) => {
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

      // Check if next sections include optional content worth choosing from
      if (module && sectionIndex < module.sections.length - 1) {
        const choices = buildSectionChoices(module.sections, sectionIndex);
        const hasOptionalAhead = choices.some((c) => c.optional);

        if (hasOptionalAhead && choices.length > 1) {
          // Show choice modal instead of auto-advancing
          const currentSec = module.sections[sectionIndex];
          setCompletedSectionTitle(
            "meta" in currentSec
              ? (currentSec.meta?.title ?? undefined)
              : undefined,
          );
          setSectionChoices(choices);
          setSectionChoiceOpen(true);
          return; // Don't auto-advance
        }

        // Normal auto-advance (no optional content ahead)
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
      updateCompletedFromLenses,
    ],
  );

  // Render a segment (sectionIndex included for unique keys)
  const renderSegment = (
    segment: ModuleSegment,
    section: ModuleSection,
    sectionIndex: number,
    segmentIndex: number,
    options?: { activateChat?: boolean },
  ) => {
    const keyPrefix = `${sectionIndex}-${segmentIndex}`;
    const segKey = `seg-${keyPrefix}`;
    const wrapWithSentinel = (node: React.ReactNode) => (
      <div
        key={`sentinel-${keyPrefix}`}
        data-segment-index={segmentIndex}
        ref={(el) => registerSegmentEl(segKey, el)}
      >
        {node}
      </div>
    );

    switch (segment.type) {
      case "text":
        return wrapWithSentinel(
          <AuthoredText key={`text-${keyPrefix}`} content={segment.content} />,
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
          published: articleMeta?.published ?? null,
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

        // Check if previous segment is also an article-excerpt (consecutive)
        const prevSegment = section.segments[segmentIndex - 1];
        const isPrevAlsoExcerpt = prevSegment?.type === "article-excerpt";

        return wrapWithSentinel(
          <ArticleEmbed
            key={`article-${keyPrefix}`}
            article={excerptData}
            isFirstExcerpt={isFirstExcerpt}
            isConsecutiveExcerpt={!isFirstExcerpt && isPrevAlsoExcerpt}
          />,
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

        return wrapWithSentinel(
          <VideoEmbed
            key={`video-${keyPrefix}`}
            videoId={section.videoId}
            start={segment.from}
            end={segment.to}
            excerptNumber={excerptNumber}
            title={section.meta.title}
            channel={section.meta.channel}
          />,
        );
      }

      case "chat":
        // Chat components stay mounted (no lazy loading) to preserve local state
        return wrapWithSentinel(
          <ChatInlineShell
            key={`chat-${keyPrefix}`}
            messages={messages}
            pendingMessage={pendingMessage}
            streamingContent={streamingContent}
            isLoading={isLoading}
            sendSource={sendSource}
            onSendMessage={(content) =>
              handleSendMessage(content, sectionIndex, segmentIndex)
            }
            onRetryMessage={handleRetryMessage}
            activated={options?.activateChat}
            activatedWithHistory={options?.activateChat}
            pillId="inline"
            sidebarAllowedRef={sidebarAllowedRef}
            sidebarAllowedListeners={sidebarAllowedListeners}
            sidebarRef={sidebarRef}
            hasActiveInput={
              activeSurface.type === "inline" &&
              activeSurface.sectionIndex === sectionIndex &&
              activeSurface.segmentIndex === segmentIndex
            }
            shellRef={(el) => registerInlineRef(sectionIndex, segmentIndex, el)}
          />,
        );

      case "question": {
        const feedbackKey = `${sectionIndex}-${segmentIndex}`;
        return wrapWithSentinel(
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
              <ChatInlineShell
                messages={messages}
                pendingMessage={pendingMessage}
                streamingContent={streamingContent}
                isLoading={isLoading}
                sendSource={sendSource}
                onSendMessage={(content) =>
                  handleSendMessage(content, sectionIndex, segmentIndex)
                }
                onRetryMessage={handleRetryMessage}
                scrollToResponse
                activated
                hasActiveInput={true}
              />
            )}
          </div>,
        );
      }

      case "roleplay": {
        const feedbackKey = `roleplay-${sectionIndex}-${segmentIndex}`;
        return wrapWithSentinel(
          <div key={`roleplay-${keyPrefix}`}>
            <RoleplaySection
              segment={segment}
              moduleSlug={module.slug}
              onFeedbackTrigger={
                segment.feedback
                  ? (seedMessage) => {
                      setActiveFeedbackKey(feedbackKey);
                      handleSendMessage(
                        seedMessage,
                        sectionIndex,
                        segmentIndex,
                      );
                    }
                  : undefined
              }
            />
            {activeFeedbackKey === feedbackKey && (
              <ChatInlineShell
                messages={messages}
                pendingMessage={pendingMessage}
                streamingContent={streamingContent}
                isLoading={isLoading}
                sendSource={sendSource}
                onSendMessage={(content) =>
                  handleSendMessage(content, sectionIndex, segmentIndex)
                }
                onRetryMessage={handleRetryMessage}
                scrollToResponse
                activated
                hasActiveInput={true}
              />
            )}
          </div>,
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
    <div
      ref={setScrollEl}
      className="h-dvh bg-white overflow-y-auto overflow-x-clip scrollbar-thin transition-[margin-right] duration-300 ease-in-out"
    >
      <ScrollContainerContext.Provider value={scrollEl}>
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

        {/* Layout: content + optional chat sidebar (TOC uses absolute positioning via ArticleExcerptGroup) */}
        <div className="pt-[var(--module-header-height)]">
          <main className="w-full min-w-0">
            <div
              className={`relative ${isArticleSection ? "max-w-content-padded article-toc-margin" : ""}`}
            >
              {module.sections.map((section, sectionIndex) => {
                // In paginated mode, only render current section
                if (
                  viewMode === "paginated" &&
                  sectionIndex !== currentSectionIndex
                ) {
                  return null;
                }

                const breakdown = computeDurationBreakdown(section);
                const sectionDur = breakdown.total > 0 ? breakdown : undefined;

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
                          duration={sectionDur}
                        />
                        <AuthoredText content={section.content} />
                      </>
                    ) : section.type === "page" ? (
                      // v2 Page section: text/chat segments only, no embedded content
                      <>
                        <SectionDivider
                          type="page"
                          title={
                            section.meta?.title || `Page ${sectionIndex + 1}`
                          }
                          duration={sectionDur}
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
                        <SectionDivider
                          type="chat"
                          title={section.meta?.title}
                          duration={sectionDur}
                        />
                        <ChatInlineShell
                          messages={messages}
                          pendingMessage={pendingMessage}
                          streamingContent={streamingContent}
                          isLoading={isLoading}
                          sendSource={sendSource}
                          onSendMessage={(content) =>
                            handleSendMessage(content, sectionIndex, 0)
                          }
                          onRetryMessage={handleRetryMessage}
                          pillId="inline"
                          sidebarAllowedRef={sidebarAllowedRef}
                          sidebarAllowedListeners={sidebarAllowedListeners}
                          sidebarRef={sidebarRef}
                          hasActiveInput={
                            activeSurface.type === "inline" &&
                            activeSurface.sectionIndex === sectionIndex &&
                            activeSurface.segmentIndex === 0
                          }
                          shellRef={(el) =>
                            registerInlineRef(sectionIndex, 0, el)
                          }
                        />
                      </>
                    ) : section.type === "lens-video" ? (
                      // v2 Lens Video section: video content with optional text/chat segments
                      <>
                        <SectionDivider
                          type="lens-video"
                          optional={section.optional}
                          title={section.meta?.title}
                          duration={sectionDur}
                        />
                        {/* Render segments (text, video-excerpt, chat) */}
                        {section.segments?.map((segment, segmentIndex) =>
                          renderSegment(
                            segment,
                            section,
                            sectionIndex,
                            segmentIndex,
                          ),
                        )}
                      </>
                    ) : section.type === "lens-article" ? (
                      // v2 Lens Article section: article content with optional text/chat segments
                      <>
                        <SectionDivider
                          type="lens-article"
                          optional={section.optional}
                          title={section.meta?.title}
                          duration={sectionDur}
                        />
                        <ArticleSectionWrapper
                          tocPortalContainer={null}
                          hideToc={false}
                        >
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
                                </>
                              );
                            }

                            const preExcerpt = segments.slice(
                              0,
                              firstExcerptIdx,
                            );
                            const excerpts = segments.slice(
                              firstExcerptIdx,
                              lastExcerptIdx + 1,
                            );
                            const postExcerpt = segments.slice(
                              lastExcerptIdx + 1,
                            );
                            return (
                              <div>
                                {/* Pre-excerpt content (intro, setup) */}
                                {preExcerpt.map((segment, i) =>
                                  renderSegment(
                                    segment,
                                    section,
                                    sectionIndex,
                                    i,
                                  ),
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
                              </div>
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
                          duration={sectionDur}
                        />
                        <ArticleSectionWrapper
                          tocPortalContainer={null}
                          hideToc={false}
                        >
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
                                </>
                              );
                            }

                            const preExcerpt = segments.slice(
                              0,
                              firstExcerptIdx,
                            );
                            const excerpts = segments.slice(
                              firstExcerptIdx,
                              lastExcerptIdx + 1,
                            );
                            const postExcerpt = segments.slice(
                              lastExcerptIdx + 1,
                            );
                            return (
                              <div>
                                {/* Pre-excerpt content (intro, setup) */}
                                {preExcerpt.map((segment, i) =>
                                  renderSegment(
                                    segment,
                                    section,
                                    sectionIndex,
                                    i,
                                  ),
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
                              </div>
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
                              onTestTakingComplete={() =>
                                setTestModeActive(false)
                              }
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
                                  <ChatInlineShell
                                    messages={messages}
                                    pendingMessage={pendingMessage}
                                    streamingContent={streamingContent}
                                    isLoading={isLoading}
                                    sendSource={sendSource}
                                    onSendMessage={(content) =>
                                      handleSendMessage(
                                        content,
                                        sectionIndex,
                                        0,
                                      )
                                    }
                                    onRetryMessage={handleRetryMessage}
                                    scrollToResponse
                                    activated
                                    hasActiveInput={true}
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
                          optional={
                            "optional" in section ? section.optional : false
                          }
                          title={
                            "meta" in section ? section.meta?.title : undefined
                          }
                          duration={sectionDur}
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
                              ? section.meta?.title ||
                                `Page ${sectionIndex + 1}`
                              : "meta" in section
                                ? section.meta?.title ||
                                  `${section.type || "Section"} ${sectionIndex + 1}`
                                : `${section.type || "Section"} ${sectionIndex + 1}`
                        }
                        moduleSlug={moduleId}
                        buttonText={getCompletionButtonText(
                          section,
                          sectionIndex,
                        )}
                        isShort={getSectionTextLength(section) < 1750}
                        chatGated={
                          ("segments" in section &&
                            section.segments?.some((s) => s.type === "chat") &&
                            !chatInteractedSections.has(sectionIndex)) ||
                          false
                        }
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

              {/* Chat sidebar: fixed-positioned on desktop, handles its own layout */}
              {currentSection != null && (
                <ChatSidebar
                  ref={sidebarRef}
                  sectionTitle={currentSection?.meta?.title}
                  messages={messages}
                  pendingMessage={
                    sendSource !== "inline" ? pendingMessage : null
                  }
                  streamingContent={
                    sendSource !== "inline" ? streamingContent : ""
                  }
                  isLoading={sendSource !== "inline" ? isLoading : false}
                  onSendMessage={(content) =>
                    handleSendMessage(
                      content,
                      currentSectionIndex,
                      currentSegmentIndexRef.current,
                      "sidebar",
                    )
                  }
                  onRetryMessage={handleRetryMessage}
                />
              )}
            </div>
            {/* /relative article wrapper */}
          </main>
        </div>
        {/* /layout wrapper */}

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

        <SectionChoiceModal
          isOpen={sectionChoiceOpen}
          completedTitle={completedSectionTitle}
          choices={sectionChoices}
          onChoose={(index) => {
            setSectionChoiceOpen(false);
            setCurrentSectionIndex(index);
          }}
          onDismiss={() => {
            setSectionChoiceOpen(false);
            // Skip to next required section, or advance by 1
            const nextRequired = sectionChoices.find((c) => !c.optional);
            setCurrentSectionIndex(
              nextRequired ? nextRequired.index : currentSectionIndex + 1,
            );
          }}
        />

        <AuthPromptModal
          isOpen={showAuthPrompt}
          onLogin={login}
          onDismiss={() => setShowAuthPrompt(false)}
        />

        {/* Debug overlay — ?debug query param. Separate component so its
          re-renders (driven by scroll) don't touch Module. */}
        {isDebugMode && currentSection && (
          <DebugOverlay
            currentSection={currentSection}
            currentSectionIndex={currentSectionIndex}
            sidebarChatSegmentIndex={sidebarChatSegmentIndex}
            segmentIndexRef={currentSegmentIndexRef}
            listeners={segmentIndexListeners}
          />
        )}
      </ScrollContainerContext.Provider>
    </div>
  );
}
