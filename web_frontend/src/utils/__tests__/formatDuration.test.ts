// web_frontend_next/src/utils/__tests__/formatDuration.test.ts
import { describe, it, expect } from "vitest";
import { formatDuration } from "../formatDuration";

describe("formatDuration", () => {
  it("formats 0 seconds", () => {
    expect(formatDuration(0)).toBe("0 sec");
  });

  it("formats seconds under a minute", () => {
    expect(formatDuration(45)).toBe("45 sec");
  });

  it("formats 59 seconds (boundary)", () => {
    expect(formatDuration(59)).toBe("59 sec");
  });

  it("formats exactly 1 minute", () => {
    expect(formatDuration(60)).toBe("1 min");
  });

  it("formats minutes with seconds (under 5 min)", () => {
    expect(formatDuration(135)).toBe("2 min 15 sec");
  });

  it("formats 4 min 59 sec (boundary before rounding)", () => {
    expect(formatDuration(299)).toBe("4 min 59 sec");
  });

  it("formats exactly 5 minutes (starts rounding)", () => {
    expect(formatDuration(300)).toBe("5 min");
  });

  it("rounds to nearest minute above 5 min", () => {
    expect(formatDuration(423)).toBe("7 min");
  });

  it("rounds up at half-minute boundary (330s = 5.5 min → 6 min)", () => {
    expect(formatDuration(330)).toBe("6 min");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3665)).toBe("1 hr 1 min");
  });

  it("formats exact hours", () => {
    expect(formatDuration(3600)).toBe("1 hr");
  });

  it("returns '0 sec' for negative input", () => {
    expect(formatDuration(-5)).toBe("0 sec");
  });

  it("returns '0 sec' for NaN", () => {
    expect(formatDuration(NaN)).toBe("0 sec");
  });

  it("returns '0 sec' for Infinity", () => {
    expect(formatDuration(Infinity)).toBe("0 sec");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(45.9)).toBe("45 sec");
  });
});
