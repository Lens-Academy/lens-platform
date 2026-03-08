import { describe, test, expect } from "vitest";
import { pillReducer, inlinePillVisible, sidebarOpen, type PillState } from "../usePillVisibility";

describe("pillReducer", () => {
  // --- Forward transitions ---
  test("sidebar → to-inline on SIDEBAR_DISALLOWED", () => {
    expect(pillReducer("sidebar", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("to-inline");
  });

  test("to-inline → inline on ANIMATION_DONE", () => {
    expect(pillReducer("to-inline", { type: "ANIMATION_DONE" }))
      .toBe("inline");
  });

  test("inline → to-sidebar on SIDEBAR_ALLOWED", () => {
    expect(pillReducer("inline", { type: "SIDEBAR_ALLOWED" }))
      .toBe("to-sidebar");
  });

  test("to-sidebar → sidebar on ANIMATION_DONE", () => {
    expect(pillReducer("to-sidebar", { type: "ANIMATION_DONE" }))
      .toBe("sidebar");
  });

  // --- Interruptions ---
  test("to-inline → to-sidebar on SIDEBAR_ALLOWED (interrupted)", () => {
    expect(pillReducer("to-inline", { type: "SIDEBAR_ALLOWED" }))
      .toBe("to-sidebar");
  });

  test("to-sidebar → to-inline on SIDEBAR_DISALLOWED (interrupted)", () => {
    expect(pillReducer("to-sidebar", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("to-inline");
  });

  // --- No-ops (redundant events) ---
  test("sidebar ignores SIDEBAR_ALLOWED", () => {
    expect(pillReducer("sidebar", { type: "SIDEBAR_ALLOWED" }))
      .toBe("sidebar");
  });

  test("inline ignores SIDEBAR_DISALLOWED", () => {
    expect(pillReducer("inline", { type: "SIDEBAR_DISALLOWED" }))
      .toBe("inline");
  });

  // --- ANIMATION_DONE in terminal states (idempotent) ---
  test("sidebar ignores ANIMATION_DONE", () => {
    expect(pillReducer("sidebar", { type: "ANIMATION_DONE" }))
      .toBe("sidebar");
  });

  test("inline ignores ANIMATION_DONE", () => {
    expect(pillReducer("inline", { type: "ANIMATION_DONE" }))
      .toBe("inline");
  });

  // --- Rapid toggling ---
  test("rapid toggle: sidebar → to-inline → to-sidebar → to-inline", () => {
    let s: PillState = "sidebar";
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" });
    s = pillReducer(s, { type: "SIDEBAR_ALLOWED" });
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" });
    expect(s).toBe("to-inline");
  });

  test("rapid toggle settles correctly with ANIMATION_DONE", () => {
    let s: PillState = "sidebar";
    s = pillReducer(s, { type: "SIDEBAR_DISALLOWED" });
    s = pillReducer(s, { type: "SIDEBAR_ALLOWED" });
    s = pillReducer(s, { type: "ANIMATION_DONE" });
    expect(s).toBe("sidebar");
  });
});

describe("inlinePillVisible", () => {
  test("hidden only in sidebar state", () => {
    expect(inlinePillVisible("sidebar")).toBe(false);
  });

  test("visible during to-inline", () => {
    expect(inlinePillVisible("to-inline")).toBe(true);
  });

  test("visible during inline", () => {
    expect(inlinePillVisible("inline")).toBe(true);
  });

  test("visible during to-sidebar (clone needs visible source)", () => {
    expect(inlinePillVisible("to-sidebar")).toBe(true);
  });
});

describe("sidebarOpen", () => {
  test("open during sidebar", () => {
    expect(sidebarOpen("sidebar")).toBe(true);
  });

  test("open during to-sidebar", () => {
    expect(sidebarOpen("to-sidebar")).toBe(true);
  });

  test("closed during inline", () => {
    expect(sidebarOpen("inline")).toBe(false);
  });

  test("closed during to-inline", () => {
    expect(sidebarOpen("to-inline")).toBe(false);
  });
});
