/**
 * Course overview page with two-panel layout.
 * Sidebar shows units/modules, main panel shows selected module details.
 */

import { useState, useEffect, useMemo } from "react";
import { useMedia } from "react-use";
import { navigate } from "vike/client/router";
import { Menu, X } from "lucide-react";
import { getCourseProgress } from "../api/modules";
import type { CourseProgress, ModuleInfo } from "../types/course";
import CourseSidebar from "../components/course/CourseSidebar";
import ModuleOverview from "../components/course/ModuleOverview";
import { generateHeadingId } from "../utils/extractHeadings";
import { DiscordInviteButton, UserMenu } from "../components/nav";
import { Skeleton } from "../components/Skeleton";

interface CourseOverviewProps {
  courseId?: string;
}

export default function CourseOverview({
  courseId = "default",
}: CourseOverviewProps) {
  const [courseProgress, setCourseProgress] = useState<CourseProgress | null>(
    null,
  );
  const [selectedModule, setSelectedModule] = useState<ModuleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useMedia("(max-width: 767px)", false);

  // Load course progress
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await getCourseProgress(courseId);
        setCourseProgress(data);

        // Auto-select current module (first in-progress, or first not-started)
        let currentModule: ModuleInfo | null = null;
        for (const unit of data.units) {
          for (const mod of unit.modules) {
            if (mod.status === "in_progress") {
              currentModule = mod;
              break;
            }
            if (!currentModule && mod.status === "not_started") {
              currentModule = mod;
            }
          }
          if (currentModule?.status === "in_progress") break;
        }
        if (currentModule) {
          setSelectedModule(currentModule);
        } else if (data.units[0]?.modules[0]) {
          setSelectedModule(data.units[0].modules[0]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load course");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [courseId]);

  const handleStartModule = () => {
    if (!selectedModule) return;
    navigate(`/course/${courseId}/module/${selectedModule.slug}`);
  };

  const handleStageClick = (index: number) => {
    if (!selectedModule) return;
    const stage = selectedModule.stages[index];
    if (stage.type === "chat") return; // Can't preview chat
    // Generate section slug from title, fallback to section-N
    const slug = stage.title.trim()
      ? generateHeadingId(stage.title)
      : `section-${index + 1}`;
    navigate(`/course/${courseId}/module/${selectedModule.slug}#${slug}`);
  };

  // Compute completedStages and currentSectionIndex for ModuleOverview
  const { completedStages, currentSectionIndex } = useMemo(() => {
    if (!selectedModule) {
      return { completedStages: new Set<number>(), currentSectionIndex: 0 };
    }
    const completed = new Set<number>();

    // Use lens-level completion if available (new progress format)
    if (selectedModule.stages.some((s) => s.completed !== undefined)) {
      selectedModule.stages.forEach((stage, i) => {
        if (stage.completed) {
          completed.add(i);
        }
      });

      // Viewing index: first non-completed stage, or last stage if all complete
      let viewIdx = selectedModule.stages.findIndex((s) => !s.completed);
      if (viewIdx === -1) viewIdx = selectedModule.stages.length - 1;
      return { completedStages: completed, currentSectionIndex: viewIdx };
    }

    // Fallback to legacy logic (currentStageIndex-based)
    const currentIdx = selectedModule.currentStageIndex ?? 0;

    if (selectedModule.status === "completed") {
      // All stages completed
      selectedModule.stages.forEach((_, i) => completed.add(i));
    } else if (selectedModule.status === "in_progress") {
      // Stages before current are completed
      for (let i = 0; i < currentIdx; i++) {
        completed.add(i);
      }
    }
    // For "not_started", completed stays empty

    return { completedStages: completed, currentSectionIndex: currentIdx };
  }, [selectedModule]);

  // Handle module selection (closes sidebar on mobile)
  const handleModuleSelect = (module: ModuleInfo) => {
    setSelectedModule(module);
    if (isMobile) setSidebarOpen(false);
  };

  // Lock body scroll when sidebar drawer is open on mobile
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isMobile, sidebarOpen]);

  // Loading state - skeleton layout mirrors module cards
  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        {/* Course title skeleton */}
        <Skeleton className="h-8 w-64 mb-6" />
        {/* Module cards skeleton with stagger animation */}
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`p-4 border border-slate-200 rounded-lg stagger-item stagger-delay-${i}`}
            >
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-full mb-1" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !courseProgress) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <div className="text-red-500">{error || "Course not found"}</div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-white">
      {/* Nav Header */}
      <nav className="border-b border-slate-200/50 bg-stone-50">
        <div className="px-4 md:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            {/* Mobile menu button */}
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 -ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 rounded-lg transition-colors"
                aria-label="Open course menu"
              >
                <Menu className="w-5 h-5 text-slate-600" />
              </button>
            )}
            <a href="/" className="flex items-center gap-2">
              <img
                src="/assets/Logo only.png"
                alt="Lens Academy"
                className="h-7"
              />
              <span className="text-lg font-semibold text-slate-800">
                Lens Academy
              </span>
            </a>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/course"
              className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200 hidden md:block"
            >
              Course
            </a>
            <DiscordInviteButton />
            <UserMenu />
          </div>
        </div>
      </nav>

      {/* Two-panel layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop: inline sidebar */}
        {!isMobile && (
          <div className="w-72 flex-shrink-0">
            <CourseSidebar
              courseTitle={courseProgress.course.title}
              units={courseProgress.units}
              selectedModuleSlug={selectedModule?.slug ?? null}
              onModuleSelect={handleModuleSelect}
            />
          </div>
        )}

        {/* Mobile: drawer sidebar */}
        {isMobile && (
          <>
            {/* Backdrop */}
            {sidebarOpen && (
              <div
                className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-200"
                onClick={() => setSidebarOpen(false)}
              />
            )}
            {/* Drawer */}
            <div
              className={`fixed top-0 left-0 h-full w-[80%] max-w-sm z-50 bg-white transition-transform duration-300 ${
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
              }`}
              style={{
                paddingTop: "var(--safe-top)",
                paddingBottom: "var(--safe-bottom)",
              }}
            >
              {/* Drawer header with close button */}
              <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
                <span className="font-semibold text-slate-800">
                  Course Menu
                </span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-slate-100 rounded-lg transition-colors"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5 text-slate-600" />
                </button>
              </div>
              {/* Sidebar content */}
              <div className="h-[calc(100%-4rem)]">
                <CourseSidebar
                  courseTitle={courseProgress.course.title}
                  units={courseProgress.units}
                  selectedModuleSlug={selectedModule?.slug ?? null}
                  onModuleSelect={handleModuleSelect}
                />
              </div>
            </div>
          </>
        )}

        {/* Main panel */}
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          {selectedModule ? (
            <ModuleOverview
              moduleTitle={selectedModule.title}
              stages={selectedModule.stages}
              status={selectedModule.status}
              completedStages={completedStages}
              currentSectionIndex={currentSectionIndex}
              onStageClick={handleStageClick}
              onStartModule={handleStartModule}
              completedLenses={selectedModule.completedLenses}
              totalLenses={selectedModule.totalLenses}
            />
          ) : (
            <div className="text-slate-500">
              Select a module to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
