import { redirect } from "vike/abort";
import type { GuardAsync } from "vike/types";

export const guard: GuardAsync = () => {
  throw redirect("/?utm_source=theaidoc");
};
