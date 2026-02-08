// web_frontend/src/views/Module.hash.test.tsx
import { describe, it, expect } from "vitest";
import { getSectionSlug, findSectionBySlug } from "@/utils/sectionSlug";
import type { ModuleSection } from "@/types/module";

// Test the slug utilities with real section data patterns
describe("URL Hash Navigation Integration", () => {
  const mockSections: ModuleSection[] = [
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
        author: "Nick Bostrom",
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
      videoId: "xyz123",
      meta: { title: "AI Alignment Introduction", channel: "AI Safety" },
      segments: [],
      optional: false,
    },
    {
      type: "text",
      content: "Some standalone text content",
    },
  ];

  describe("slug generation consistency", () => {
    it("generates consistent slugs for all section types", () => {
      const slugs = mockSections.map((section, index) =>
        getSectionSlug(section, index),
      );

      expect(slugs).toEqual([
        "learning-outcomes",
        "worst-case-thinking-optional",
        "ai-alignment-introduction",
        "section-4", // text section falls back to index
      ]);
    });

    it("round-trips: find by generated slug returns correct index", () => {
      mockSections.forEach((section, index) => {
        const slug = getSectionSlug(section, index);
        const foundIndex = findSectionBySlug(mockSections, slug);
        expect(foundIndex).toBe(index);
      });
    });
  });

  describe("hash format", () => {
    it("generates URL-safe slugs with no special characters", () => {
      const section: ModuleSection = {
        type: "lens-article",
        contentId: "abc",
        learningOutcomeId: null,
        learningOutcomeName: null,
        meta: {
          title: "What's the Deal? (A Question!)",
          author: null,
          sourceUrl: null,
        },
        segments: [],
        optional: false,
      };

      const slug = getSectionSlug(section, 0);
      expect(slug).toBe("whats-the-deal-a-question");
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    });
  });
});
