// web_frontend/src/utils/sectionSlug.test.ts
import { describe, it, expect } from "vitest";
import { getSectionSlug, findSectionBySlug } from "./sectionSlug";
import type { ModuleSection } from "@/types/module";

describe("getSectionSlug", () => {
  it("returns slug from lens section title", () => {
    const section: ModuleSection = {
      type: "lens",
      contentId: "abc",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: {
        title: "Worst-Case Thinking (Optional)",
      },
      segments: [],
      optional: true,
    };
    expect(getSectionSlug(section, 0)).toBe("worst-case-thinking-optional");
  });

  it("returns slug from lens section with video segments", () => {
    const section: ModuleSection = {
      type: "lens",
      contentId: "def",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "Introduction to AI Safety" },
      segments: [
        {
          type: "video",
          from: 0,
          to: 60,
          transcript: "...",
          title: "Introduction to AI Safety",
          channel: "AI Channel",
          videoId: "xyz",
        },
      ],
      optional: false,
    };
    expect(getSectionSlug(section, 1)).toBe("introduction-to-ai-safety");
  });

  it("returns slug from lens title", () => {
    const section: ModuleSection = {
      type: "lens",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "Learning Outcomes" },
      segments: [],
      optional: false,
    };
    expect(getSectionSlug(section, 2)).toBe("learning-outcomes");
  });

  it("returns fallback for lens with null title", () => {
    const section: ModuleSection = {
      type: "lens",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: null },
      segments: [],
      optional: false,
    };
    expect(getSectionSlug(section, 3)).toBe("section-4");
  });

  it("returns fallback for whitespace-only title", () => {
    const section: ModuleSection = {
      type: "lens",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "   " },
      segments: [],
      optional: false,
    };
    expect(getSectionSlug(section, 5)).toBe("section-6");
  });

  it("returns fallback when meta is undefined (runtime edge case)", () => {
    // Runtime data may not match TypeScript types
    const section = {
      type: "lens",
      segments: [],
    } as unknown as ModuleSection;
    expect(getSectionSlug(section, 7)).toBe("section-8");
  });

  it("truncates long titles to 50 chars", () => {
    const section: ModuleSection = {
      type: "lens",
      contentId: "abc",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: {
        title:
          "This Is A Very Long Title That Should Be Truncated To Fifty Characters Maximum",
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
      type: "lens",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "Learning Outcomes" },
      segments: [],
      optional: false,
    },
    {
      type: "lens",
      contentId: "abc",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: {
        title: "Worst-Case Thinking (Optional)",
      },
      segments: [],
      optional: true,
    },
    {
      type: "lens",
      contentId: "def",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "Introduction Video" },
      segments: [
        {
          type: "video",
          from: 0,
          to: 60,
          transcript: "...",
          title: "Introduction Video",
          channel: "AI Safety",
          videoId: "xyz123",
        },
      ],
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
