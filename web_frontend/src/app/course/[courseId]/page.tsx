"use client";

import { useParams } from "next/navigation";
import CourseOverview from "@/views/CourseOverview";

export default function CourseByIdPage() {
  const params = useParams();
  const courseId = (params?.courseId as string) ?? "default";

  return <CourseOverview courseId={courseId} />;
}
