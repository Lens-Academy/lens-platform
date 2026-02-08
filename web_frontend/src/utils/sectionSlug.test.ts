// web_frontend/src/utils/sectionSlug.test.ts
import { describe, it, expect } from "vitest";
import { getSectionSlug, findSectionBySlug } from "./sectionSlug";
import type { ModuleSection } from "@/types/module";

describe("getSectionSlug", () => {
  it("returns slug from lens-article title", () => {
    const section: ModuleSection = {
      type: "lens-article",
      contentId: "abc",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: {
        title: "Worst-Case Thinking (Optional)",
        author: null,
        sourceUrl: null,
      },
      segments: [],
      optional: true,
    };
    expect(getSectionSlug(section, 0)).toBe("worst-case-thinking-optional");
  });

  it("returns slug from lens-video title", () => {
    const section: ModuleSection = {
      type: "lens-video",
      contentId: "def",
      learningOutcomeId: null,
      learningOutcomeName: null,
      videoId: "xyz",
      meta: { title: "Introduction to AI Safety", channel: null },
      segments: [],
      optional: false,
    };
    expect(getSectionSlug(section, 1)).toBe("introduction-to-ai-safety");
  });

  it("returns slug from page title", () => {
    const section: ModuleSection = {
      type: "page",
      meta: { title: "Learning Outcomes" },
      segments: [],
    };
    expect(getSectionSlug(section, 2)).toBe("learning-outcomes");
  });

  it("returns fallback for page with null title", () => {
    const section: ModuleSection = {
      type: "page",
      meta: { title: null },
      segments: [],
    };
    expect(getSectionSlug(section, 3)).toBe("section-4");
  });

  it("returns fallback for text section", () => {
    const section: ModuleSection = {
      type: "text",
      content: "Some content here",
    };
    expect(getSectionSlug(section, 0)).toBe("section-1");
  });

  it("returns fallback for whitespace-only title", () => {
    const section: ModuleSection = {
      type: "page",
      meta: { title: "   " },
      segments: [],
    };
    expect(getSectionSlug(section, 5)).toBe("section-6");
  });

  it("returns fallback when meta is undefined (runtime edge case)", () => {
    // Runtime data may not match TypeScript types
    const section = {
      type: "page",
      segments: [],
    } as unknown as ModuleSection;
    expect(getSectionSlug(section, 7)).toBe("section-8");
  });

  it("truncates long titles to 50 chars", () => {
    const section: ModuleSection = {
      type: "lens-article",
      contentId: "abc",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: {
        title:
          "This Is A Very Long Title That Should Be Truncated To Fifty Characters Maximum",
        author: null,
        sourceUrl: null,
      },
      segments: [],
      optional: false,
    };
    const slug = getSectionSlug(section, 0);
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});

describe("findSectionBySlug", () => {
  const sections: ModuleSection[] = [
    {
      type: "page",
      meta: { title: "Learning Outcomes" },
      segments: [],
    },
    {
      type: "lens-article",
      contentId: "abc",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: {
        title: "Worst-Case Thinking (Optional)",
        author: null,
        sourceUrl: null,
      },
      segments: [],
      optional: true,
    },
    {
      type: "lens-video",
      contentId: "def",
      learningOutcomeId: null,
      learningOutcomeName: null,
      videoId: "xyz",
      meta: { title: "Introduction Video", channel: null },
      segments: [],
      optional: false,
    },
  ];

  it("finds section by slug", () => {
    expect(findSectionBySlug(sections, "worst-case-thinking-optional")).toBe(1);
  });

  it("finds first section", () => {
    expect(findSectionBySlug(sections, "learning-outcomes")).toBe(0);
  });

  it("returns -1 for non-existent slug", () => {
    expect(findSectionBySlug(sections, "does-not-exist")).toBe(-1);
  });

  it("returns -1 for empty slug", () => {
    expect(findSectionBySlug(sections, "")).toBe(-1);
  });
});
