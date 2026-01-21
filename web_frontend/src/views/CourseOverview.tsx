/**
 * Course overview page with two-panel layout.
 * Sidebar shows units/modules, main panel shows selected module details.
 */

import { useState, useEffect } from "react";
import { navigate } from "vike/client/router";
import { ChevronRight } from "lucide-react";
import { getCourseProgress } from "../api/modules";
import type { CourseProgress, ModuleInfo } from "../types/course";
import CourseSidebar from "../components/course/CourseSidebar";
import ModuleOverview from "../components/course/ModuleOverview";
import ContentPreviewModal from "../components/course/ContentPreviewModal";
import { DiscordInviteButton, UserMenu } from "../components/nav";

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
  const [previewStage, setPreviewStage] = useState<{
    moduleSlug: string;
    stageIndex: number;
    sessionId: number | null;
  } | null>(null);

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
    setPreviewStage({
      moduleSlug: selectedModule.slug,
      stageIndex: index,
      sessionId: selectedModule.sessionId,
    });
  };

  // Find unit for breadcrumb
  const selectedUnit = courseProgress?.units.find((u) =>
    u.modules.some((m) => m.slug === selectedModule?.slug),
  );
  const selectedUnitLabel = selectedUnit
    ? selectedUnit.meetingNumber !== null
      ? `Unit ${selectedUnit.meetingNumber}`
      : "Additional Content"
    : null;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-slate-500">Loading course...</div>
      </div>
    );
  }

  if (error || !courseProgress) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-red-500">{error || "Course not found"}</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Nav Header */}
      <nav className="border-b border-slate-200/50 bg-stone-50">
        <div className="px-6 flex items-center justify-between h-14">
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
          <div className="flex items-center gap-4">
            <a
              href="/course"
              className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
            >
              Course
            </a>
            <DiscordInviteButton />
            <UserMenu />
          </div>
        </div>
      </nav>

      {/* Breadcrumb */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center gap-2 text-sm">
        <a href="/" className="text-slate-500 hover:text-slate-700">
          Home
        </a>
        <ChevronRight className="w-4 h-4 text-slate-400" />
        <span className="text-slate-700 font-medium">
          {courseProgress.course.title}
        </span>
        {selectedUnitLabel && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">{selectedUnitLabel}</span>
          </>
        )}
        {selectedModule && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-400" />
            <span className="text-slate-900">{selectedModule.title}</span>
          </>
        )}
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 flex-shrink-0">
          <CourseSidebar
            courseTitle={courseProgress.course.title}
            units={courseProgress.units}
            selectedModuleSlug={selectedModule?.slug ?? null}
            onModuleSelect={setSelectedModule}
          />
        </div>

        {/* Main panel */}
        <div className="flex-1 p-8 overflow-y-auto">
          {selectedModule ? (
            <ModuleOverview
              moduleTitle={selectedModule.title}
              stages={selectedModule.stages}
              status={selectedModule.status}
              currentStageIndex={selectedModule.currentStageIndex}
              onStageClick={handleStageClick}
              onStartModule={handleStartModule}
            />
          ) : (
            <div className="text-slate-500">
              Select a module to view details
            </div>
          )}
        </div>
      </div>

      {/* Content preview modal */}
      {previewStage && (
        <ContentPreviewModal
          moduleSlug={previewStage.moduleSlug}
          stageIndex={previewStage.stageIndex}
          sessionId={previewStage.sessionId}
          onClose={() => setPreviewStage(null)}
        />
      )}
    </div>
  );
}
