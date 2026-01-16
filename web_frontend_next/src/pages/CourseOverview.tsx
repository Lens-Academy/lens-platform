"use client";

/**
 * Course overview page with two-panel layout.
 * Sidebar shows units/lessons, main panel shows selected lesson details.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getCourseProgress } from "../api/lessons";
import type { CourseProgress, LessonInfo } from "../types/course";
import CourseSidebar from "../components/course/CourseSidebar";
import LessonOverview from "../components/course/LessonOverview";
import ContentPreviewModal from "../components/course/ContentPreviewModal";
import HeaderAuthStatus from "../components/unified-lesson/HeaderAuthStatus";
import { useAuth } from "../hooks/useAuth";
import { DISCORD_INVITE_URL } from "../config";

interface CourseOverviewProps {
  courseId?: string;
}

export default function CourseOverview({ courseId = "default" }: CourseOverviewProps) {
  const router = useRouter();
  const { login } = useAuth();

  const [courseProgress, setCourseProgress] = useState<CourseProgress | null>(
    null
  );
  const [selectedLesson, setSelectedLesson] = useState<LessonInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewStage, setPreviewStage] = useState<{
    lessonSlug: string;
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

        // Auto-select current lesson (first in-progress, or first not-started)
        let currentLesson: LessonInfo | null = null;
        for (const unit of data.units) {
          for (const lesson of unit.lessons) {
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
        } else if (data.units[0]?.lessons[0]) {
          setSelectedLesson(data.units[0].lessons[0]);
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
    router.push(`/course/${courseId}/lesson/${selectedLesson.slug}`);
  };

  const handleStageClick = (index: number) => {
    if (!selectedLesson) return;
    const stage = selectedLesson.stages[index];
    if (stage.type === "chat") return; // Can't preview chat
    setPreviewStage({
      lessonSlug: selectedLesson.slug,
      stageIndex: index,
      sessionId: selectedLesson.sessionId,
    });
  };

  // Find unit for breadcrumb
  const selectedUnit = courseProgress?.units.find((u) =>
    u.lessons.some((l) => l.slug === selectedLesson?.slug)
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
            <span className="text-lg font-semibold text-slate-800">Lens Academy</span>
          </a>
          <div className="flex items-center gap-4">
            <Link
              href="/course"
              className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
            >
              Course
            </Link>
            <a
              href={DISCORD_INVITE_URL}
              className="px-5 py-2 rounded-full border-2 border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Join us on Discord
            </a>
            <HeaderAuthStatus onLoginClick={login} />
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
          <CourseSidebar
            courseTitle={courseProgress.course.title}
            units={courseProgress.units}
            selectedLessonSlug={selectedLesson?.slug ?? null}
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
            <div className="text-slate-500">
              Select a lesson to view details
            </div>
          )}
        </div>
      </div>

      {/* Content preview modal */}
      {previewStage && (
        <ContentPreviewModal
          lessonSlug={previewStage.lessonSlug}
          stageIndex={previewStage.stageIndex}
          sessionId={previewStage.sessionId}
          onClose={() => setPreviewStage(null)}
        />
      )}
    </div>
  );
}
