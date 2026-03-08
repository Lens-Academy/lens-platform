import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { cancelInputFlight } from "../animateInputFlight";

describe("cancelInputFlight", () => {
  let inlinePill: HTMLDivElement;

  beforeEach(() => {
    inlinePill = document.createElement("div");
    document.body.appendChild(inlinePill);
  });

  afterEach(() => {
    inlinePill.remove();
  });

  test("clears leftover inline opacity when pill has data-chat-input-pill attribute", () => {
    // Simulate post-animation state: opacity set by animateToSidebar's onfinish
    // which now intentionally leaves it to avoid a flash
    inlinePill.setAttribute("data-chat-input-pill", "inline");
    inlinePill.style.opacity = "0";

    cancelInputFlight();

    expect(inlinePill.style.opacity).toBe("");
  });

  test("clears leftover inline opacity when pill loses data attribute (inactive shell)", () => {
    // After the pillId fix, inactive shells set pillId={hasActiveInput ? pillId : undefined}.
    // When a shell becomes inactive, its pill loses data-chat-input-pill="inline"
    // but retains the inline style.opacity = "0" left by animateToSidebar's onfinish.
    //
    // Scenario:
    // 1. Shell A is active, animation to-sidebar runs → sets style.opacity = "0"
    // 2. onfinish fires, state → "sidebar" (pill hidden by opacity-0 class)
    // 3. User scrolls → Shell B becomes active, Shell A loses data-chat-input-pill
    // 4. User closes sidebar pref → cancelInputFlight() called
    // 5. querySelector can't find Shell A's pill → opacity stays "0"
    // 6. State goes "inline" → React removes opacity-0 class → but inline style still hides it
    inlinePill.style.opacity = "0";
    // No data-chat-input-pill attribute — simulates inactive shell

    cancelInputFlight();

    // BUG: cancelInputFlight relies on querySelector('[data-chat-input-pill="inline"]')
    // which can't find elements that lost their attribute
    expect(inlinePill.style.opacity).toBe("");
  });
});
