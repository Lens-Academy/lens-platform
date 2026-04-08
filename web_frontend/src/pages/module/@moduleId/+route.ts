import type { PageContext } from "vike/types";

export function route(pageContext: PageContext) {
  const match = pageContext.urlPathname.match(/^\/module\/(.+)$/);
  if (!match) return false;
  return {
    routeParams: {
      moduleId: match[1],
    },
  };
}
