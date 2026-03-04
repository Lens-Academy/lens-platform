// web_frontend/src/utils/__tests__/extractHeadings.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateHeadingId,
  extractHeadings,
  extractAllHeadings,
  normalizeHeadingLevels,
} from "../extractHeadings";
import type { HeadingItem } from "../extractHeadings";

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

  it("extracts h1 headings", () => {
    const result = extractHeadings("# Title\n## Two\n### Three");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: "title", text: "Title", level: 1 });
    expect(result[1]).toEqual({ id: "two", text: "Two", level: 2 });
    expect(result[2]).toEqual({ id: "three", text: "Three", level: 3 });
  });

  it("ignores h4+ headings", () => {
    const result = extractHeadings("# Title\n## Two\n### Three\n#### Four");
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("Title");
    expect(result[1].text).toBe("Two");
    expect(result[2].text).toBe("Three");
  });

  it("strips inline markdown formatting from heading text", () => {
    const result = extractHeadings(
      '## Hang on, *will* AGI "by default" lack **Approval** Reward?',
    );
    expect(result).toEqual([
      {
        id: "hang-on-will-agi-by-default-lack-approval-reward",
        text: 'Hang on, will AGI "by default" lack Approval Reward?',
        level: 2,
      },
    ]);
  });

  it("extracts HTML h1 tags", () => {
    const result = extractHeadings("<h1>Main Title</h1>");
    expect(result).toEqual([
      { id: "main-title", text: "Main Title", level: 1 },
    ]);
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
    expect(result).toEqual([{ id: "overview", text: "Overview", level: 2 }]);
  });
});

describe("extractAllHeadings", () => {
  it("extracts from multiple documents with shared IDs and normalizes", () => {
    const result = extractAllHeadings(["## Intro", "## Intro\n### Methods"]);
    expect(result).toEqual([
      { id: "intro", text: "Intro", level: 2, displayLevel: 1 },
      { id: "intro-1", text: "Intro", level: 2, displayLevel: 1 },
      { id: "methods", text: "Methods", level: 3, displayLevel: 2 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(extractAllHeadings([])).toEqual([]);
  });
});

/** Helper: build minimal HeadingItem[] from raw levels */
function headingsFromLevels(levels: number[]): HeadingItem[] {
  return levels.map((level, i) => ({
    level,
    text: `Heading ${i}`,
    id: `heading-${i}`,
  }));
}

describe("normalizeHeadingLevels", () => {
  const fixtures = [
    {
      name: "already normalized (H1, H2, H3)",
      input: [1, 2, 3, 2, 1],
      expected: [1, 2, 3, 2, 1],
    },
    {
      name: "starts at H2 — promotes to level 1",
      input: [2, 3, 3, 2],
      expected: [1, 2, 2, 1],
    },
    {
      name: "single heading",
      input: [3],
      expected: [1],
    },
    {
      name: "all same level",
      input: [2, 2, 2],
      expected: [1, 1, 1],
    },
    {
      name: "gap in levels (H1 then H3) — child is still level 2",
      input: [1, 3, 3, 1],
      expected: [1, 2, 2, 1],
    },
    {
      name: "descending levels (H3, H2, H1)",
      input: [3, 2, 1],
      expected: [1, 1, 1],
    },
    {
      name: "deep nesting from high start",
      input: [2, 3, 3, 2],
      expected: [1, 2, 2, 1],
    },
    {
      name: "empty array",
      input: [],
      expected: [],
    },
  ];

  for (const { name, input, expected } of fixtures) {
    it(name, () => {
      const headings = headingsFromLevels(input);
      const result = normalizeHeadingLevels(headings);
      expect(result.map((h) => h.displayLevel)).toEqual(expected);
    });
  }
});
