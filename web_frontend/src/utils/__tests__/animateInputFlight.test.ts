import { describe, test, expect } from "vitest";
import { cancelInputFlight } from "../animateInputFlight";

describe("cancelInputFlight", () => {
  test("no-op when no animation is active", () => {
    expect(() => cancelInputFlight()).not.toThrow();
  });
});
