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

    expect(module.slug).toBe("lens/article-lens");
    expect(module.title).toBe("Deep Dive Article");
    expect(module.sections.length).toBe(1);
  });

  it("lens section matches LensSection type", () => {
    const section = contract.sections[0] as ModuleSection;
    expect(section.type).toBe("lens");

    if (section.type === "lens") {
      expect(section.meta.title).toBe("Deep Dive Article");
      expect(section.optional).toBe(false);
    }
  });

  it("segments have correct types", () => {
    // Lens section segments
    const lensSection = contract.sections[0];
    expect(lensSection.segments[0].type).toBe("text");
    expect(lensSection.segments[1].type).toBe("article");

    // Article segment has metadata
    const articleSeg = lensSection.segments[1];
    if (articleSeg.type === "article") {
      expect(articleSeg.title).toBe("Deep Dive Article");
      expect(articleSeg.author).toBe("Jane Doe");
    }
  });
});
