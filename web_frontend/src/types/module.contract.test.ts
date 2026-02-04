// src/types/module.contract.test.ts
import { describe, it, expect } from "vitest";
import type { Module, ModuleSection } from "./module";

// Import the TypeScript processor's expected output as the contract
// This is what TypeScript actually produces - the source of truth
import processResult from "../../../content_processor/fixtures/valid/uncategorized-multiple-lenses/expected.json";

// The expected.json has ProcessResult shape: { modules: [...], courses: [...], errors: [...] }
const contract = processResult.modules[0];

describe("Frontend types match TypeScript processor output", () => {
  it("module from expected.json is valid Module type", () => {
    // This is primarily a compile-time check.
    // If the fixture doesn't match the Module type, TypeScript errors.
    // No type assertion needed - the fixture should match the Module type directly.
    const module: Module = contract;

    expect(module.slug).toBe("test-uncategorized");
    expect(module.title).toBe("Test Uncategorized Lenses");
    expect(module.sections.length).toBe(2);
  });

  it("lens-video section matches LensVideoSection type", () => {
    const section = contract.sections[0] as ModuleSection;
    expect(section.type).toBe("lens-video");

    if (section.type === "lens-video") {
      expect(section.meta.title).toBe("AI Safety Introduction");
      expect(section.meta.channel).toBe("Safety Channel");
      expect(section.optional).toBe(false);
    }
  });

  it("lens-article section matches LensArticleSection type", () => {
    const section = contract.sections[1] as ModuleSection;
    expect(section.type).toBe("lens-article");

    if (section.type === "lens-article") {
      expect(section.meta.title).toBe("Deep Dive Article");
      expect(section.meta.author).toBe("Jane Doe");
      expect(section.optional).toBe(false);
    }
  });

  it("segments have correct types", () => {
    // Video section segments
    const videoSection = contract.sections[0];
    expect(videoSection.segments[0].type).toBe("text");
    expect(videoSection.segments[1].type).toBe("video-excerpt");

    // Article section segments
    const articleSection = contract.sections[1];
    expect(articleSection.segments[0].type).toBe("text");
    expect(articleSection.segments[1].type).toBe("article-excerpt");
  });
});
