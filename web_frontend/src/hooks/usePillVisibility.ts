export type PillState =
  | "sidebar"
  | "to-inline"
  | "inline"
  | "to-sidebar";

export type PillEvent =
  | { type: "SIDEBAR_ALLOWED" }
  | { type: "SIDEBAR_DISALLOWED" }
  | { type: "ANIMATION_DONE" };

export function pillReducer(state: PillState, event: PillEvent): PillState {
  switch (state) {
    case "sidebar":
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";
      return state;

    case "to-inline":
      if (event.type === "ANIMATION_DONE") return "inline";
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";
      return state;

    case "inline":
      if (event.type === "SIDEBAR_ALLOWED") return "to-sidebar";
      return state;

    case "to-sidebar":
      if (event.type === "ANIMATION_DONE") return "sidebar";
      if (event.type === "SIDEBAR_DISALLOWED") return "to-inline";
      return state;
  }
}
