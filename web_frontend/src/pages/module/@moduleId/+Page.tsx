import { usePageContext } from "vike-react/usePageContext";
import Module from "@/views/Module";

export default function StandaloneModulePage() {
  const pageContext = usePageContext();
  const moduleId = pageContext.routeParams?.moduleId ?? "";

  return <Module key={moduleId} courseId="default" moduleId={moduleId} />;
}
