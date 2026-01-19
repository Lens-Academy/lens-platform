"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import UnifiedLesson from "@/views/UnifiedLesson";
import NarrativeLesson from "@/views/NarrativeLesson";
import type { NarrativeLesson as NarrativeLessonType } from "@/types/narrative-lesson";

type LessonData = {
  type: "narrative" | "staged";
  narrativeLesson?: NarrativeLessonType;
};

async function fetchLesson(slug: string): Promise<LessonData | null> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${apiBase}/api/lessons/${slug}`);

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  // Check if this is a narrative lesson (has sections) or staged (has stages)
  if (data.sections) {
    return {
      type: "narrative",
      narrativeLesson: data as NarrativeLessonType,
    };
  }

  return { type: "staged" };
}

export default function LessonPage() {
  const params = useParams();
  const courseId = (params?.courseId as string) ?? "default";
  const lessonId = (params?.lessonId as string) ?? "";

  const [lessonData, setLessonData] = useState<LessonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lessonId) return;

    async function load() {
      try {
        const data = await fetchLesson(lessonId);
        setLessonData(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load lesson");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [lessonId]);

  if (!lessonId || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading lesson...</p>
      </div>
    );
  }

  if (error || !lessonData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error ?? "Lesson not found"}</p>
          <Link href="/course" className="text-blue-600 hover:underline">
            Back to course
          </Link>
        </div>
      </div>
    );
  }

  // Render the appropriate view based on lesson type
  if (lessonData.type === "narrative" && lessonData.narrativeLesson) {
    return <NarrativeLesson lesson={lessonData.narrativeLesson} />;
  }

  return <UnifiedLesson courseId={courseId} lessonSlug={lessonId} />;
}
