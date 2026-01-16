"use client";

import { useParams } from "next/navigation";
import CourseOverview from "@/pages/CourseOverview";

export default function CourseByIdPage() {
  const params = useParams();
  const courseId = params.courseId as string;

  return <CourseOverview courseId={courseId} />;
}
