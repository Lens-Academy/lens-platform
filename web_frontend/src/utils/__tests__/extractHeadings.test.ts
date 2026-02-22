// web_frontend/src/utils/__tests__/extractHeadings.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateHeadingId,
  extractHeadings,
  extractAllHeadings,
} from "../extractHeadings";

// Suppress debug console.logs in extractHeadings
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateHeadingId", () => {
  it("lowercases and converts spaces to hyphens", () => {
    expect(generateHeadingId("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(generateHeadingId("What's New?")).toBe("whats-new");
  });

  it("collapses multiple hyphens", () => {
    expect(generateHeadingId("a - b - c")).toBe("a-b-c");
  });

  it("truncates to 50 characters", () => {
    expect(generateHeadingId("a".repeat(60))).toHaveLength(50);
  });

  it("handles empty string", () => {
    expect(generateHeadingId("")).toBe("");
  });

  it("handles special-characters-only input", () => {
    expect(generateHeadingId("!@#$%")).toBe("");
  });
});

describe("extractHeadings", () => {
  it("extracts markdown h2 headings", () => {
    const result = extractHeadings("## Introduction\nText\n## Methods");
    expect(result).toEqual([
      { id: "introduction", text: "Introduction", level: 2 },
      { id: "methods", text: "Methods", level: 2 },
    ]);
  });

  it("extracts markdown h3 headings", () => {
    const result = extractHeadings("### Sub-section");
    expect(result).toEqual([
      { id: "sub-section", text: "Sub-section", level: 3 },
    ]);
  });

  it("ignores h1 and h4+ headings", () => {
    const result = extractHeadings("# Title\n## Two\n### Three\n#### Four");
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Two");
    expect(result[1].text).toBe("Three");
  });

  it("extracts HTML h2/h3 tags", () => {
    const result = extractHeadings("<h2>Overview</h2>\n<h3>Details</h3>");
    expect(result).toEqual([
      { id: "overview", text: "Overview", level: 2 },
      { id: "details", text: "Details", level: 3 },
    ]);
  });

  it("deduplicates IDs within a single document", () => {
    const result = extractHeadings("## Setup\n## Setup\n## Setup");
    expect(result.map((h) => h.id)).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("returns empty array for empty input", () => {
    expect(extractHeadings("")).toEqual([]);
  });

  it("returns empty array for input with no headings", () => {
    expect(extractHeadings("Just text\nno headings")).toEqual([]);
  });

  it("shares seenIds counter across calls", () => {
    const seenIds = new Map<string, number>();
    extractHeadings("## Title", seenIds);
    const result = extractHeadings("## Title", seenIds);
    expect(result[0].id).toBe("title-1");
  });

  it("trims whitespace from markdown heading text", () => {
    const result = extractHeadings("## Hello World  ");
    expect(result).toEqual([
      { id: "hello-world", text: "Hello World", level: 2 },
    ]);
  });

  it("trims whitespace from HTML heading text", () => {
    const result = extractHeadings("<h2> Overview </h2>");
    expect(result).toEqual([
      { id: "overview", text: "Overview", level: 2 },
    ]);
  });
});

describe("extractAllHeadings", () => {
  it("extracts from multiple documents with shared IDs", () => {
    const result = extractAllHeadings(["## Intro", "## Intro\n## Methods"]);
    expect(result).toEqual([
      { id: "intro", text: "Intro", level: 2 },
      { id: "intro-1", text: "Intro", level: 2 },
      { id: "methods", text: "Methods", level: 2 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(extractAllHeadings([])).toEqual([]);
  });
});
