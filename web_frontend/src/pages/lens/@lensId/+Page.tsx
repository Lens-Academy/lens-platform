import { usePageContext } from "vike-react/usePageContext";
import Module from "@/views/Module";

export default function StandaloneLensPage() {
  const pageContext = usePageContext();
  const lensId = pageContext.routeParams?.lensId ?? "";

  return <Module key={lensId} courseId="default" moduleId={`lens/${lensId}`} />;
}
