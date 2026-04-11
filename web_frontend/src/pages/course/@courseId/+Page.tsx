import { usePageContext } from "vike-react/usePageContext";
import CourseOverview from "@/views/CourseOverview";

export default function CourseByIdPage() {
  const pageContext = usePageContext();
  const courseId = pageContext.routeParams?.courseId ?? "default";

  return <CourseOverview courseId={courseId} />;
}
