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
import type { StageInfo, ModuleInfo } from "@/types/course";
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
import ArticleEmbed, {
  collectFootnoteDefinitions,
  countFootnoteReferences,
} from "@/components/module/ArticleEmbed";
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
import { getUnitLabel } from "@/utils/unitLabel";

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
      case "article":
        return `from: ${(s.content ?? "").slice(0, 40)}…`;
      case "video":
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
      moduleCompleteDismissed.current = false;
      setModuleCompletionResult(undefined);
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
    sectionTitle = currentSection.meta?.title ?? null;

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

  // Theater mode: track how many videos are in theater mode (for scroll-snap)
  const [theaterCount, setTheaterCount] = useState(0);
  const handleTheaterChange = useCallback((active: boolean) => {
    setTheaterCount((prev) => prev + (active ? 1 : -1));
  }, []);

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
  // undefined = not yet fetched, null = end of course, object = next module or unit complete
  const [moduleCompletionResult, setModuleCompletionResult] = useState<
    ModuleCompletionResult | undefined
  >(undefined);
  // Track if module was marked complete by API (all required lenses done)
  const [apiConfirmedComplete, setApiConfirmedComplete] = useState(false);

  // Auth prompt modal state
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [hasPromptedAuth, setHasPromptedAuth] = useState(false);

  // Unified section choice modal state
  const [sectionChoiceOpen, setSectionChoiceOpen] = useState(false);
  const [sectionChoices, setSectionChoices] = useState<SectionChoice[]>([]);
  const [completedSectionTitle, setCompletedSectionTitle] = useState<string>();
  const [showModuleCompleteInModal, setShowModuleCompleteInModal] =
    useState(false);
  // Deferred choices when auth prompt takes priority
  const pendingSectionChoicesRef = useRef<{
    choices: SectionChoice[];
    title?: string;
    showModuleComplete?: boolean;
  } | null>(null);

  // Analytics tracking ref
  const hasTrackedModuleStart = useRef(false);

  // Track if module was already complete when page loaded (for suppressing modal on review)
  const wasCompleteOnLoad = useRef(false);
  // Track if user dismissed the module-complete modal (so the effect doesn't re-open it)
  const moduleCompleteDismissed = useRef(false);
  // Store fromIndex when Case 1 defers to useEffect, so it can call prependNextSection
  const deferredFromIndexRef = useRef<number | null>(null);

  // Test mode: dims lesson navigation during test
  const [testModeActive, setTestModeActive] = useState(false);

  // View mode state (default to paginated)
  const [viewMode] = useState<ViewMode>("paginated");

  // Drawer ref for imperative toggle (state lives in ModuleDrawer to avoid re-rendering Module)
  const drawerRef = useRef<ModuleDrawerHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Track chat sidebar open state (driven by localStorage events from ChatSidebar)
  const [chatOpen, setChatOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("chat-sidebar-pref") === "open",
  );
  useEffect(() => {
    const sync = () =>
      setChatOpen(localStorage.getItem("chat-sidebar-pref") === "open");
    window.addEventListener("chat-sidebar-pref-change", sync);
    return () => window.removeEventListener("chat-sidebar-pref-change", sync);
  }, []);

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
      const isOptional = section.optional === true;
      const title = section.meta?.title || `Section ${index + 1}`;
      const tldr = section.tldr;
      const duration = computeSectionDuration(section) || null;

      // Test sections use lens stage type
      if (section.type === "test") {
        return {
          type: "lens",
          source: "",
          from: null,
          to: null,
          title: section.meta?.title || "Test",
          tldr,
          duration,
        } as unknown as Stage;
      }

      // Use displayType for stage type derivation
      const dt = section.displayType;
      if (dt === "lens-video" || dt === "lens-mixed") {
        const firstVideo = section.segments?.find((s) => s.type === "video");
        const videoId =
          firstVideo && "videoId" in firstVideo
            ? ((firstVideo.videoId as string) ?? "")
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
      } else if (dt === "lens-article") {
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
      } else {
        return {
          type: "lens",
          source: "",
          from: null,
          to: null,
          optional: isOptional,
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
      const dur = computeSectionDuration(section);
      // Collect authors/channels from segments for attribution
      const seen = new Set<string>();
      const attributions: string[] = [];
      for (const seg of section.segments) {
        const name =
          seg.type === "article"
            ? seg.author
            : seg.type === "video"
              ? seg.channel
              : null;
        if (name && !seen.has(name)) {
          seen.add(name);
          attributions.push(name);
        }
      }
      return {
        type: section.type as StageInfo["type"],
        displayType: section.displayType,
        title: section.meta?.title || `Section ${index + 1}`,
        duration: dur || null,
        optional: section.optional === true,
        tldr: section.tldr,
        attribution:
          attributions.length > 0 ? attributions.join(" & ") : undefined,
      };
    });
  }, [module]);

  // Derived value for module completion
  // Complete if: API confirmed complete OR all sections marked locally
  const isModuleComplete = module
    ? apiConfirmedComplete || completedSections.size === module.sections.length
    : false;

  // Compute submodule context from courseProgress
  const submoduleContext = useMemo(():
    | {
        parentTitle: string | null;
        isLastInParentGroup: boolean;
        nextModuleSharesParent: boolean;
      }
    | undefined => {
    if (!courseProgress || !module) return undefined;
    let currentModuleInfo = null;
    let currentModuleIndex = -1;
    let unitModules: (typeof courseProgress.units)[0]["modules"] = [];
    for (const unit of courseProgress.units) {
      const idx = unit.modules.findIndex((m) => m.slug === module.slug);
      if (idx !== -1) {
        currentModuleInfo = unit.modules[idx];
        currentModuleIndex = idx;
        unitModules = unit.modules;
        break;
      }
    }
    if (!currentModuleInfo?.parentSlug) return undefined;

    const parentSlug = currentModuleInfo.parentSlug;
    const parentTitle = currentModuleInfo.parentTitle ?? null;
    const nextModule =
      currentModuleIndex < unitModules.length - 1
        ? unitModules[currentModuleIndex + 1]
        : null;
    const nextModuleSharesParent = nextModule?.parentSlug === parentSlug;
    // Is last if next module doesn't share parent
    const isLastInParentGroup = !nextModuleSharesParent;

    return { parentTitle, isLastInParentGroup, nextModuleSharesParent };
  }, [courseProgress, module]);

  // Compute unit context for breadcrumb navigation
  const unitContext = useMemo((): {
    unitName: string;
    unitModules: ModuleInfo[];
  } | null => {
    if (!courseProgress || !module) return null;
    for (let i = 0; i < courseProgress.units.length; i++) {
      const unit = courseProgress.units[i];
      if (unit.modules.some((m) => m.slug === module.slug)) {
        return {
          unitName: getUnitLabel(unit, i),
          unitModules: unit.modules,
        };
      }
    }
    return null;
  }, [courseProgress, module]);

  // Compute skipped optional sections (for module-complete modal)
  const skippedOptionalSections = useMemo((): SectionChoice[] => {
    if (!module) return [];
    return module.sections
      .map((section, index) => ({ section, index }))
      .filter(
        ({ section, index }) =>
          "optional" in section &&
          section.optional &&
          !completedSections.has(index),
      )
      .filter(({ section }) => {
        const sectionType = section.type as SectionChoice["type"];
        return ["lens", "test"].includes(sectionType);
      })
      .map(({ section, index }) => ({
        index,
        type: section.type as SectionChoice["type"],
        title:
          ("meta" in section ? section.meta?.title : undefined) ?? section.type,
        tldr:
          "tldr" in section ? (section.tldr as string | undefined) : undefined,
        optional: true,
        completed: false,
        duration: null,
      }));
  }, [module, completedSections]);

  // Compute navigation links for the section choice modal
  const isEnrolled = isInSignupsTable || isInActiveGroup;

  const nextModuleLink = useMemo((): { label: string; href: string } | null => {
    if (
      !courseId ||
      !moduleCompletionResult ||
      moduleCompletionResult.type !== "next_module"
    )
      return null;
    const nextModuleUrl = `/course/${courseId}/module/${moduleCompletionResult.slug}`;
    let label = `Next: ${moduleCompletionResult.title}`;
    if (
      submoduleContext?.nextModuleSharesParent &&
      submoduleContext.parentTitle
    ) {
      label = `Continue ${submoduleContext.parentTitle}: ${moduleCompletionResult.title}`;
    }
    return { label, href: nextModuleUrl };
  }, [courseId, moduleCompletionResult, submoduleContext]);

  const enrollLink = useMemo((): { label: string; href: string } | null => {
    if (isEnrolled) return null;
    return { label: "Join the Full Course", href: "/enroll" };
  }, [isEnrolled]);

  const courseLinkForModal = useMemo((): {
    label: string;
    href: string;
  } | null => {
    if (!courseId) return null;
    return { label: "Back to Course Overview", href: `/course/${courseId}` };
  }, [courseId]);

  const isSubmodule = !!submoduleContext?.parentTitle;
  const parentTitle = submoduleContext?.parentTitle ?? undefined;

  // Activity tracking for current section
  const currentSection = module?.sections[currentSectionIndex];
  const isArticleSection =
    currentSection?.type === "lens" &&
    currentSection.segments?.some((s) => s.type === "article");
  const sidebarAllowed =
    currentSection != null && currentSection.type === "lens";

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

    if (!sidebarAllowed) {
      sidebarRef.current?.setAllowed(false);
      return;
    }

    sidebarRef.current?.setAllowed(true);
    sidebarRef.current?.setSystemOpenPref(false); // starts closed, opens at excerpt

    const segments =
      currentSection && "segments" in currentSection
        ? currentSection.segments
        : undefined;
    const firstExcerptIdx =
      segments?.findIndex((s) => s.type === "article" || s.type === "video") ??
      -1;

    let rafId = 0;
    let isInitialCheck = true;
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

          // Auto-open sidebar when scrolling to first article excerpt (never on mobile).
          // Skip the initial synchronous check — if the excerpt is already in view on
          // load, we still want the sidebar to start closed and only open on real scroll.
          if (
            !isInitialCheck &&
            !hasReachedExcerptRef.current &&
            firstExcerptIdx >= 0 &&
            best.index >= firstExcerptIdx
          ) {
            hasReachedExcerptRef.current = true;
            sidebarRef.current?.setSystemOpenPref(true);
          }
          isInitialCheck = false;

          // Sidebar disallowed when any chat input pill overlaps the viewport band.
          // Hysteresis: use different thresholds depending on current state to
          // prevent oscillation when the sidebar open/close reflow shifts the
          // pill by a few pixels across the boundary.
          const hysteresis = 20; // px
          const bandTop = window.innerHeight * 0.35;
          const bandBottom = window.innerHeight * 0.95;
          const effectiveBandTop = lastSidebarAllowed.current
            ? bandTop + hysteresis
            : bandTop - hysteresis;
          const effectiveBandBottom = lastSidebarAllowed.current
            ? bandBottom - hysteresis
            : bandBottom + hysteresis;
          let chatInBand = false;
          segmentElsRef.current.forEach((el) => {
            const idx = Number(el.dataset.segmentIndex);
            if (isNaN(idx) || segments?.[idx]?.type !== "chat") return;
            const pill = el.querySelector("[data-chat-input-pill]");
            if (!pill) return;
            const rect = pill.getBoundingClientRect();
            if (
              rect.bottom > effectiveBandTop &&
              rect.top < effectiveBandBottom
            ) {
              chatInBand = true;
            }
          });
          const allowed = sidebarAllowed && !chatInBand;

          // Guard against reflow feedback loop: opening or closing the sidebar
          // changes layout → content reflows → scroll fires → pill shifts →
          // state flips back. Lock both directions for longer than the CSS
          // transition (300ms) to let the layout fully settle.
          if (Date.now() < sidebarAllowedLockUntil.current) return;
          if (allowed !== lastSidebarAllowed.current) {
            lastSidebarAllowed.current = allowed;
            sidebarAllowedRef.current = allowed;
            sidebarAllowedListeners.current.forEach((fn) => fn());
            sidebarAllowedLockUntil.current = Date.now() + 600;
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
  }, [currentSectionIndex, currentSection, sidebarAllowed, scrollEl]);

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

  // Open module-complete modal once moduleCompletionResult is fetched
  // (deferred from tryShowChoicesOrNavigate to avoid showing stale data)
  useEffect(() => {
    if (
      !isModuleComplete ||
      wasCompleteOnLoad.current ||
      moduleCompletionResult === undefined || // not yet fetched
      sectionChoiceOpen // already showing a modal
    )
      return;
    // Don't re-open if user dismissed
    if (moduleCompleteDismissed.current) return;
    setShowModuleCompleteInModal(true);
    // Include skipped optional sections as choices, with next section prepended
    const fromIndex = deferredFromIndexRef.current;
    const choices =
      fromIndex != null && module
        ? prependNextSection(
            skippedOptionalSections,
            module.sections,
            fromIndex,
          )
        : skippedOptionalSections;
    deferredFromIndexRef.current = null;
    setSectionChoices(choices);
    setSectionChoiceOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prependNextSection is a stable local helper
  }, [
    isModuleComplete,
    moduleCompletionResult,
    sectionChoiceOpen,
    skippedOptionalSections,
    module,
  ]);

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
    if (!module) return;
    // At first section: show choice modal
    if (currentSectionIndex === 0) {
      tryShowChoicesOrNavigate(0);
      return;
    }
    const prevIndex = currentSectionIndex - 1;
    if (viewMode === "continuous") {
      handleStageClick(prevIndex);
    } else {
      setCurrentSectionIndex(prevIndex);
    }
  }, [
    currentSectionIndex,
    viewMode,
    handleStageClick,
    testModeActive,
    module,
    completedSections,
  ]);

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
      if (!["lens", "test"].includes(sectionType)) continue;

      choices.push({
        index: i,
        type: sectionType,
        title: section.meta?.title ?? section.type,
        tldr:
          "tldr" in section ? (section.tldr as string | undefined) : undefined,
        optional: section.optional ?? false,
        completed: completedSections.has(i),
        duration: null,
      });

      // Stop after first required section (that's the "continue" target)
      if (!section.optional) break;
    }
    return choices;
  }

  // Build list of all incomplete sections (for "incomplete" mode)
  function buildIncompleteSections(
    sections: ModuleSection[],
    completed: Set<number>,
  ): SectionChoice[] {
    const choices: SectionChoice[] = [];
    for (let i = 0; i < sections.length; i++) {
      if (completed.has(i)) continue;
      const section = sections[i];
      if (!("optional" in section)) continue;
      const sectionType = section.type as SectionChoice["type"];
      if (!["lens", "test"].includes(sectionType)) continue;
      choices.push({
        index: i,
        type: sectionType,
        title: section.meta?.title ?? section.type,
        tldr:
          "tldr" in section ? (section.tldr as string | undefined) : undefined,
        optional: section.optional ?? false,
        completed: false,
        duration: null,
      });
    }
    return choices;
  }

  // Build a choice for the immediate next section (regardless of completion status)
  function buildNextSectionChoice(
    sections: ModuleSection[],
    afterIndex: number,
  ): SectionChoice | null {
    const i = afterIndex + 1;
    if (i >= sections.length) return null;
    const section = sections[i];
    if (!("optional" in section)) return null;
    const sectionType = section.type as SectionChoice["type"];
    if (!["lens", "test"].includes(sectionType)) return null;
    return {
      index: i,
      type: sectionType,
      title: section.meta?.title ?? section.type,
      tldr:
        "tldr" in section ? (section.tldr as string | undefined) : undefined,
      optional: section.optional ?? false,
      completed: completedSections.has(i),
      duration: null,
    };
  }

  // Ensure the immediate next section is always first in choices
  function prependNextSection(
    choices: SectionChoice[],
    sections: ModuleSection[],
    fromIndex: number,
  ): SectionChoice[] {
    const nextChoice = buildNextSectionChoice(sections, fromIndex);
    if (nextChoice && !choices.some((c) => c.index === nextChoice.index)) {
      return [nextChoice, ...choices];
    }
    return choices;
  }

  // Shared navigation logic: show modal or navigate directly
  // Called from handleMarkComplete (after completion) and handleNext (on already-completed sections)
  function tryShowChoicesOrNavigate(
    fromIndex: number,
    completedTitle?: string,
    opts?: { shouldPromptAuth?: boolean; isModuleJustCompleted?: boolean },
  ) {
    if (!module) return;

    // Always reset completed title — either to the passed value or undefined
    setCompletedSectionTitle(completedTitle);

    const shouldPromptAuth = opts?.shouldPromptAuth ?? false;

    // Case 1: Module just completed by API — defer to useEffect
    // The modal will open once moduleCompletionResult is fetched (see effect above)
    if (opts?.isModuleJustCompleted) {
      deferredFromIndexRef.current = fromIndex;
      if (shouldPromptAuth) {
        setShowAuthPrompt(true);
        setHasPromptedAuth(true);
      }
      // Don't open modal here — the useEffect watching moduleCompletionResult will do it
      return;
    }

    // Case 2: At or past last section and module NOT complete → show incomplete sections
    if (fromIndex >= module.sections.length - 1 && !isModuleComplete) {
      const incomplete = prependNextSection(
        buildIncompleteSections(module.sections, completedSections),
        module.sections,
        fromIndex,
      );
      if (incomplete.length > 0) {
        if (shouldPromptAuth) {
          pendingSectionChoicesRef.current = { choices: incomplete };
          setShowAuthPrompt(true);
          setHasPromptedAuth(true);
        } else {
          setShowModuleCompleteInModal(false);
          setSectionChoices(incomplete);
          setSectionChoiceOpen(true);
        }
        return;
      }
    }

    // Case 3: Module is complete (detected locally) → show module-complete with optional sections
    // nextModuleLink (passed to modal) is null while moduleCompletionResult is loading,
    // and updates dynamically when the fetch completes.
    if (isModuleComplete) {
      const choices = prependNextSection(
        skippedOptionalSections,
        module.sections,
        fromIndex,
      );
      if (shouldPromptAuth) {
        pendingSectionChoicesRef.current = {
          choices,
          showModuleComplete: true,
        };
        setShowAuthPrompt(true);
        setHasPromptedAuth(true);
      } else {
        setShowModuleCompleteInModal(true);
        setSectionChoices(choices);
        setSectionChoiceOpen(true);
      }
      return;
    }

    // Case 4: Show "What's Next?" modal with upcoming section choices
    // Special sub-case: if optional sections ahead but no required ones, and there ARE
    // incomplete required sections elsewhere → show all incomplete sections instead.
    if (fromIndex < module.sections.length - 1) {
      const choices = buildSectionChoices(module.sections, fromIndex);
      const hasOptionalAhead = choices.some((c) => c.optional);
      const hasRequiredAhead = choices.some((c) => !c.optional);

      if (hasOptionalAhead && !hasRequiredAhead) {
        // Only optional sections ahead — check if there are incomplete required sections
        // anywhere in the module (including earlier ones the user skipped).
        const hasIncompleteRequired = module.sections.some(
          (s, i) => !completedSections.has(i) && "optional" in s && !s.optional,
        );

        if (hasIncompleteRequired) {
          // Show incomplete mode with ALL incomplete sections (required + optional)
          const incomplete = prependNextSection(
            buildIncompleteSections(module.sections, completedSections),
            module.sections,
            fromIndex,
          );
          if (shouldPromptAuth) {
            pendingSectionChoicesRef.current = { choices: incomplete };
            setShowAuthPrompt(true);
            setHasPromptedAuth(true);
          } else {
            setShowModuleCompleteInModal(false);
            setSectionChoices(incomplete);
            setSectionChoiceOpen(true);
          }
          return;
        }
      }

      // Show "What's Next?" modal with the upcoming choices
      const withNext = prependNextSection(choices, module.sections, fromIndex);
      if (withNext.length > 0) {
        if (shouldPromptAuth) {
          pendingSectionChoicesRef.current = {
            choices: withNext,
            title: completedTitle,
          };
          setShowAuthPrompt(true);
          setHasPromptedAuth(true);
        } else {
          setShowModuleCompleteInModal(false);
          setSectionChoices(withNext);
          setSectionChoiceOpen(true);
        }
        return;
      }
    }

    // Case 5: No modal needed — just navigate or show fallback modal
    if (shouldPromptAuth) {
      setShowAuthPrompt(true);
      setHasPromptedAuth(true);
    }

    if (fromIndex < module.sections.length - 1) {
      const nextIndex = fromIndex + 1;
      if (viewMode === "continuous") {
        handleStageClick(nextIndex);
      } else {
        setCurrentSectionIndex(nextIndex);
      }
    } else {
      // Last section fallback: open modal with whatever we have
      // (e.g. module complete but moduleCompletionResult still loading)
      const choices = prependNextSection(
        skippedOptionalSections,
        module.sections,
        fromIndex,
      );
      setShowModuleCompleteInModal(isModuleComplete);
      setSectionChoices(choices);
      setSectionChoiceOpen(true);
    }
  }

  const handleNext = useCallback(() => {
    if (testModeActive) return; // Block during test mode
    if (!module) return;

    // At last section: show choice modal
    if (currentSectionIndex >= module.sections.length - 1) {
      tryShowChoicesOrNavigate(currentSectionIndex);
      return;
    }

    // Not at last section: just advance normally
    const nextIndex = currentSectionIndex + 1;
    if (viewMode === "continuous") {
      handleStageClick(nextIndex);
    } else {
      setCurrentSectionIndex(nextIndex);
    }
  }, [
    currentSectionIndex,
    module,
    viewMode,
    handleStageClick,
    testModeActive,
    completedSections,
    isModuleComplete,
  ]);

  const handleMarkComplete = useCallback(
    (sectionIndex: number, apiResponse?: MarkCompleteResponse) => {
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

      // Determine if auth prompt should show:
      // Skip if completing the first lens section as the very first completion
      // (the welcome/intro section shouldn't trigger auth prompt)
      const completionCount = completedSections.size; // before adding new one
      const currentSec = module?.sections[sectionIndex];
      const isFirstLens = sectionIndex === 0 && currentSec?.type === "lens";
      const shouldPromptAuth =
        (completionCount >= 1 || !isFirstLens) &&
        !isAuthenticated &&
        !hasPromptedAuth;

      // Check if module is now complete based on API response
      if (apiResponse?.module_status === "completed") {
        setApiConfirmedComplete(true);
      }

      const choiceTitle =
        currentSec && "meta" in currentSec
          ? (currentSec.meta?.title ?? undefined)
          : undefined;

      tryShowChoicesOrNavigate(sectionIndex, choiceTitle, {
        shouldPromptAuth,
        isModuleJustCompleted: apiResponse?.module_status === "completed",
      });
    },
    [
      completedSections.size,
      isAuthenticated,
      hasPromptedAuth,
      updateCompletedFromLenses,
      module,
      isModuleComplete,
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
          <AuthoredText
            key={`text-${keyPrefix}`}
            content={segment.content}
            courseId={courseId ?? undefined}
            moduleSlug={moduleId}
            moduleSections={module.sections.map((s) => ({
              contentId: s.contentId,
              meta: s.meta,
            }))}
          />,
        );

      case "article": {
        // Collect footnote defs from ALL article segments in this section
        // so cross-excerpt references (e.g. ref in excerpt 1, def in excerpt 2) resolve
        const sectionFootnoteDefs = new Map<string, string>();
        for (const seg of section.segments) {
          if (seg.type === "article") {
            for (const field of [
              seg.collapsed_before,
              seg.content,
              seg.collapsed_after,
            ]) {
              if (field) {
                for (const [id, text] of collectFootnoteDefinitions(field)) {
                  sectionFootnoteDefs.set(id, text);
                }
              }
            }
          }
        }

        // Content is now bundled directly in the segment
        // Metadata is on the segment itself
        const excerptData: ArticleData = {
          content: segment.content,
          title: segment.title ?? null,
          author: segment.author ?? null,
          sourceUrl: segment.sourceUrl ?? null,
          published: segment.published ?? null,
          isExcerpt: true,
          collapsed_before: segment.collapsed_before,
          collapsed_after: segment.collapsed_after,
        };

        // Count how many article segments came before this one
        const excerptsBefore = section.segments
          .slice(0, segmentIndex)
          .filter((s) => s.type === "article").length;
        const isFirstExcerpt = excerptsBefore === 0;

        // Check if previous segment is also an article (consecutive)
        const prevSegment = section.segments[segmentIndex - 1];
        const isPrevAlsoExcerpt = prevSegment?.type === "article";

        // Compute footnote counter offset from preceding excerpts
        let footnoteCounterStart = 0;
        if (sectionFootnoteDefs.size > 0) {
          for (const seg of section.segments.slice(0, segmentIndex)) {
            if (seg.type === "article") {
              for (const field of [
                seg.collapsed_before,
                seg.content,
                seg.collapsed_after,
              ]) {
                if (field) {
                  footnoteCounterStart += countFootnoteReferences(
                    field,
                    sectionFootnoteDefs,
                  );
                }
              }
            }
          }
        }

        return wrapWithSentinel(
          <ArticleEmbed
            key={`article-${keyPrefix}`}
            article={excerptData}
            isFirstExcerpt={isFirstExcerpt}
            isConsecutiveExcerpt={!isFirstExcerpt && isPrevAlsoExcerpt}
            externalFootnoteDefs={sectionFootnoteDefs}
            footnoteCounterStart={footnoteCounterStart}
          />,
        );
      }

      case "video": {
        // Count video segments to number them (Part 1, Part 2, etc.)
        const videoExcerptsBefore = section.segments
          .slice(0, segmentIndex)
          .filter((s) => s.type === "video").length;
        const excerptNumber = videoExcerptsBefore + 1; // 1-indexed

        return wrapWithSentinel(
          <VideoEmbed
            key={`video-${keyPrefix}`}
            videoId={segment.videoId ?? null}
            start={segment.from}
            end={segment.to}
            excerptNumber={excerptNumber}
            title={segment.title ?? null}
            channel={segment.channel ?? null}
            onTheaterChange={handleTheaterChange}
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
      <div className="min-h-dvh bg-[var(--brand-bg)] p-4 sm:p-6">
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
      <div className="min-h-dvh flex items-center justify-center bg-[var(--brand-bg)]">
        <div className="text-center">
          <p className="text-red-600 mb-4">{loadError ?? "Module not found"}</p>
          <a href="/" className="text-lens-gold-600 hover:underline">
            Go home
          </a>
        </div>
      </div>
    );
  }

  // Module loaded but has flattening error
  if (module.error) {
    return (
      <div className="min-h-dvh bg-[var(--brand-bg)]">
        <div className="sticky top-0 z-50 bg-white border-b border-[var(--brand-border)]">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <h1 className="text-xl font-semibold text-[var(--brand-text)]">
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
      className="h-dvh bg-white overflow-y-auto overflow-x-clip scrollbar-thin transition-[border-right-width] duration-300 ease-in-out box-border"
      style={theaterCount > 0 ? { scrollSnapType: "y proximity" } : undefined}
    >
      <ScrollContainerContext.Provider value={scrollEl}>
        <ModuleHeader
          moduleTitle={module.title}
          stages={stages}
          completedStages={completedSections}
          currentSectionIndex={currentSectionIndex}
          canGoPrevious={!testModeActive}
          canGoNext={!testModeActive}
          onStageClick={handleStageClick}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onMenuToggle={() => drawerRef.current?.toggle()}
          testModeActive={testModeActive}
          // Breadcrumb context
          unitName={unitContext?.unitName}
          unitModules={unitContext?.unitModules}
          currentModuleSlug={module.slug}
          sidebarOpen={sidebarOpen}
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
                    {section.type === "lens" ? (
                      // Lens section: may contain text, article, video, chat segments
                      <>
                        <SectionDivider
                          type="lens"
                          displayType={section.displayType}
                          optional={section.optional}
                          title={
                            section.meta?.title || `Section ${sectionIndex + 1}`
                          }
                          duration={sectionDur}
                        />
                        {(() => {
                          const segments = section.segments ?? [];
                          const hasArticle =
                            section.displayType === "lens-article" ||
                            section.displayType === "lens-mixed";

                          if (hasArticle) {
                            // Article lens: wrap article segments in ArticleExcerptGroup for TOC
                            const firstExcerptIdx = segments.findIndex(
                              (s) => s.type === "article",
                            );
                            const lastExcerptIdx = segments.reduceRight(
                              (found, s, i) =>
                                found === -1 && s.type === "article"
                                  ? i
                                  : found,
                              -1,
                            );

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
                              <ArticleSectionWrapper
                                tocPortalContainer={null}
                                hideToc={false}
                              >
                                <div>
                                  {preExcerpt.map((segment, i) =>
                                    renderSegment(
                                      segment,
                                      section,
                                      sectionIndex,
                                      i,
                                    ),
                                  )}
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
                                  {postExcerpt.map((segment, i) =>
                                    renderSegment(
                                      segment,
                                      section,
                                      sectionIndex,
                                      lastExcerptIdx + 1 + i,
                                    ),
                                  )}
                                </div>
                              </ArticleSectionWrapper>
                            );
                          }

                          // Non-article lens (video, text/chat only): render segments directly
                          return segments.map((segment, segmentIndex) =>
                            renderSegment(
                              segment,
                              section,
                              sectionIndex,
                              segmentIndex,
                            ),
                          );
                        })()}
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
                                      className="flex items-center gap-2 px-4 py-2 bg-lens-gold-500 text-white rounded-lg hover:bg-lens-gold-600 transition-all active:scale-95 font-medium"
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
                          section.meta?.title || `Section ${sectionIndex + 1}`
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
                  drawerOpen={sidebarOpen}
                />
              )}
            </div>
            {/* /relative article wrapper */}
          </main>
        </div>
        {/* /layout wrapper */}

        <ModuleDrawer
          ref={drawerRef}
          unitName={unitContext?.unitName ?? module.title}
          unitModules={unitContext?.unitModules ?? []}
          currentModuleSlug={module.slug}
          currentModuleSections={stagesForDrawer}
          completedSections={completedSections}
          currentSectionIndex={currentSectionIndex}
          onSectionClick={handleStageClick}
          courseId={courseId}
          onOpenChange={setSidebarOpen}
          chatOpen={chatOpen}
        />

        <SectionChoiceModal
          isOpen={sectionChoiceOpen}
          completedTitle={
            showModuleCompleteInModal ? undefined : completedSectionTitle
          }
          isModuleComplete={showModuleCompleteInModal}
          isSubmodule={isSubmodule}
          moduleTitle={module.title}
          parentTitle={parentTitle}
          choices={sectionChoices}
          onChoose={(index) => {
            setSectionChoiceOpen(false);
            setCurrentSectionIndex(index);
          }}
          nextModuleLink={showModuleCompleteInModal ? nextModuleLink : null}
          enrollLink={showModuleCompleteInModal ? enrollLink : null}
          courseLink={courseLinkForModal}
          onDismiss={() => {
            setSectionChoiceOpen(false);
            if (showModuleCompleteInModal) {
              moduleCompleteDismissed.current = true;
            }
            // Just close — user stays on current section
          }}
        />

        <AuthPromptModal
          isOpen={showAuthPrompt}
          onLogin={login}
          onDismiss={() => {
            setShowAuthPrompt(false);
            // Show deferred section choices after auth prompt is dismissed
            const pending = pendingSectionChoicesRef.current;
            if (pending) {
              pendingSectionChoicesRef.current = null;
              setShowModuleCompleteInModal(pending.showModuleComplete ?? false);
              setCompletedSectionTitle(pending.title);
              setSectionChoices(pending.choices);
              setSectionChoiceOpen(true);
            }
          }}
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
