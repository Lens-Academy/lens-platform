import type { PageContext } from "vike/types";

export function route(pageContext: PageContext) {
  const match = pageContext.urlPathname.match(
    /^\/course\/([^/]+)\/module\/(.+)$/,
  );
  if (!match) return false;
  return {
    routeParams: {
      courseId: match[1],
      moduleId: match[2],
    },
  };
}
