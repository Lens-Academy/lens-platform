"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Module from "@/views/Module";
import { getModule, getCourseProgress } from "@/api/modules";
import type { Module as ModuleType } from "@/types/module";
import type { CourseProgress } from "@/types/course";

/**
 * Course module page - for modules accessed through a course.
 * Validates module is in course, provides next/previous navigation.
 */
export default function CourseModulePage() {
  const params = useParams();
  const router = useRouter();
  const courseId = (params?.courseId as string) ?? "";
  const moduleId = (params?.moduleId as string) ?? "";

  const [moduleData, setModuleData] = useState<ModuleType | null>(null);
  const [courseProgress, setCourseProgress] = useState<CourseProgress | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notInCourse, setNotInCourse] = useState(false);

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

  useEffect(() => {
    if (!moduleId || !courseId) return;

    async function load() {
      try {
        // Fetch module and course progress in parallel
        const [moduleResult, courseResult] = await Promise.all([
          getModule(moduleId),
          getCourseProgress(courseId).catch(() => null), // Course might not exist
        ]);

        setModuleData(moduleResult);
        setCourseProgress(courseResult);

        // Check if module is actually in this course
        if (courseResult) {
          const moduleInCourse = courseResult.units.some((unit) =>
            unit.modules.some((m) => m.slug === moduleId)
          );
          if (!moduleInCourse) {
            setNotInCourse(true);
          }
        } else {
          // Course doesn't exist - redirect to standalone
          setNotInCourse(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load module");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [moduleId, courseId]);

  // Redirect to standalone page if module not in course
  useEffect(() => {
    if (notInCourse && moduleData) {
      router.replace(`/module/${moduleId}`);
    }
  }, [notInCourse, moduleData, moduleId, router]);

  if (!moduleId || !courseId || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading module...</p>
      </div>
    );
  }

  if (notInCourse) {
    // Show loading while redirecting
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Redirecting...</p>
      </div>
    );
  }

  if (error || !moduleData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error ?? "Module not found"}</p>
          <Link
            href={`/course/${courseId}`}
            className="text-blue-600 hover:underline"
          >
            Back to course
          </Link>
        </div>
      </div>
    );
  }

  // Build course context for navigation
  const courseContext = courseProgress
    ? {
        courseId,
        modules: courseModules,
      }
    : null;

  return <Module module={moduleData} courseContext={courseContext} />;
}
