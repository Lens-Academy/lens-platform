import { usePageContext } from "vike-react/usePageContext";
import Module from "@/views/Module";

export default function CourseModulePage() {
  const pageContext = usePageContext();
  const courseId = pageContext.routeParams?.courseId ?? "default";
  const moduleId = pageContext.routeParams?.moduleId ?? "";

  return <Module key={moduleId} courseId={courseId} moduleId={moduleId} />;
}
