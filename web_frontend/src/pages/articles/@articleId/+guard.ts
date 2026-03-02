import { redirect } from "vike/abort";
import type { GuardAsync } from "vike/types";

export const guard: GuardAsync = (pageContext) => {
  const articleId = (pageContext.routeParams?.articleId ?? "").replace(/\.md$/, "");
  throw redirect(`/article/${articleId}`);
};
