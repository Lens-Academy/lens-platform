/**
 * Course overview page with two-panel layout.
 * Sidebar shows modules/lessons, main panel shows selected lesson details.
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { getCourseProgress } from "../api/lessons";
import type { CourseProgress, LessonInfo } from "../types/course";
import ModuleSidebar from "../components/course/ModuleSidebar";
import LessonOverview from "../components/course/LessonOverview";
import ContentPreviewModal from "../components/course/ContentPreviewModal";

export default function CourseOverview() {
  const { courseId = "default" } = useParams();
  const navigate = useNavigate();

  const [courseProgress, setCourseProgress] = useState<CourseProgress | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<LessonInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewStage, setPreviewStage] = useState<{ lessonId: string; stageIndex: number; sessionId: number | null } | null>(null);

  // Load course progress
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await getCourseProgress(courseId);
        setCourseProgress(data);

        // Auto-select current lesson (first in-progress, or first not-started)
        let currentLesson: LessonInfo | null = null;
        for (const module of data.modules) {
          for (const lesson of module.lessons) {
            if (lesson.status === "in_progress") {
              currentLesson = lesson;
              break;
            }
            if (!currentLesson && lesson.status === "not_started") {
              currentLesson = lesson;
            }
          }
          if (currentLesson?.status === "in_progress") break;
        }
        if (currentLesson) {
          setSelectedLesson(currentLesson);
        } else if (data.modules[0]?.lessons[0]) {
          setSelectedLesson(data.modules[0].lessons[0]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load course");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [courseId]);

  const handleStartLesson = () => {
    if (!selectedLesson) return;
    navigate(`/course/${courseId}/lesson/${selectedLesson.id}`);
  };

  const handleStageClick = (index: number) => {
    if (!selectedLesson) return;
    const stage = selectedLesson.stages[index];
    if (stage.type === "chat") return; // Can't preview chat
    setPreviewStage({
      lessonId: selectedLesson.id,
      stageIndex: index,
      sessionId: selectedLesson.sessionId,
    });
  };

  // Find module for breadcrumb
  const selectedModule = courseProgress?.modules.find((m) =>
    m.lessons.some((l) => l.id === selectedLesson?.id)
  );

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
      {/* Breadcrumb */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center gap-2 text-sm">
        <a href="/" className="text-slate-500 hover:text-slate-700">
          Home
        </a>
        <ChevronRight className="w-4 h-4 text-slate-400" />
        <span className="text-slate-700 font-medium">{courseProgress.course.title}</span>
        {selectedModule && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500">{selectedModule.title}</span>
          </>
        )}
        {selectedLesson && (
          <>
            <ChevronRight className="w-4 h-4 text-slate-400" />
            <span className="text-slate-900">{selectedLesson.title}</span>
          </>
        )}
      </div>

      {/* Two-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-72 flex-shrink-0">
          <ModuleSidebar
            courseTitle={courseProgress.course.title}
            modules={courseProgress.modules}
            selectedLessonId={selectedLesson?.id ?? null}
            onLessonSelect={setSelectedLesson}
          />
        </div>

        {/* Main panel */}
        <div className="flex-1 p-8 overflow-y-auto">
          {selectedLesson ? (
            <LessonOverview
              lessonTitle={selectedLesson.title}
              stages={selectedLesson.stages}
              status={selectedLesson.status}
              currentStageIndex={selectedLesson.currentStageIndex}
              onStageClick={handleStageClick}
              onStartLesson={handleStartLesson}
            />
          ) : (
            <div className="text-slate-500">Select a lesson to view details</div>
          )}
        </div>
      </div>

      {/* Content preview modal */}
      {previewStage && (
        <ContentPreviewModal
          lessonId={previewStage.lessonId}
          stageIndex={previewStage.stageIndex}
          sessionId={previewStage.sessionId}
          onClose={() => setPreviewStage(null)}
        />
      )}
    </div>
  );
}
