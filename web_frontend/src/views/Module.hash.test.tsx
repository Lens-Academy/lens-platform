// web_frontend/src/views/Module.hash.test.tsx
import { describe, it, expect } from "vitest";
import { getSectionSlug, findSectionBySlug } from "@/utils/sectionSlug";
import type { ModuleSection } from "@/types/module";

// Test the slug utilities with real section data patterns
describe("URL Hash Navigation Integration", () => {
  const mockSections: ModuleSection[] = [
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
      segments: [
        {
          type: "article",
          content: "...",
          title: "Worst-Case Thinking",
          author: "Nick Bostrom",
        },
      ],
      optional: true,
    },
    {
      type: "lens",
      contentId: "def",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "AI Alignment Introduction" },
      segments: [
        {
          type: "video",
          from: 0,
          to: 60,
          transcript: "...",
          title: "AI Alignment Introduction",
          channel: "AI Safety",
          videoId: "xyz123",
        },
      ],
      optional: false,
    },
    {
      type: "test",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: {},
      segments: [],
      optional: false,
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
        "section-4", // test section with no title falls back to index
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
        type: "lens",
        contentId: "abc",
        learningOutcomeId: null,
        learningOutcomeName: null,
        meta: {
          title: "What's the Deal? (A Question!)",
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
