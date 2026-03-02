import { redirect } from "vike/abort";
import type { GuardAsync } from "vike/types";

export const guard: GuardAsync = (pageContext) => {
  const lensId = (pageContext.routeParams?.lensId ?? "").replace(/\.md$/, "");
  throw redirect(`/lens/${lensId}`);
};
