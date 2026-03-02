import { usePageContext } from "vike-react/usePageContext";
import Module from "@/views/Module";

export default function StandaloneArticlePage() {
  const pageContext = usePageContext();
  const articleId = (pageContext.routeParams?.articleId ?? "").replace(/\.md$/, "");
  return <Module key={articleId} courseId="default" moduleId={`article/${articleId}`} />;
}
