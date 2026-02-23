// web_frontend/src/utils/__tests__/completionButtonText.test.ts
import { describe, it, expect } from "vitest";
import {
  getSectionTextLength,
  getCompletionButtonText,
} from "../completionButtonText";
import type { ModuleSection } from "@/types/module";

function textSection(content: string): ModuleSection {
  return { type: "text", content };
}

function pageSection(texts: string[]): ModuleSection {
  return {
    type: "page",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: null },
    segments: texts.map((t) => ({ type: "text" as const, content: t })),
    optional: false,
  };
}

function videoSection(): ModuleSection {
  return {
    type: "lens-video",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    videoId: null,
    meta: { title: "Video", channel: null },
    segments: [],
    optional: false,
  };
}

function articleSection(): ModuleSection {
  return {
    type: "lens-article",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: "Article", author: null, sourceUrl: null },
    segments: [],
    optional: false,
  };
}

describe("getSectionTextLength", () => {
  it("returns content length for text sections", () => {
    expect(getSectionTextLength(textSection("hello"))).toBe(5);
  });

  it("returns sum of text segment lengths for page sections", () => {
    expect(getSectionTextLength(pageSection(["abc", "de"]))).toBe(5);
  });

  it("returns 0 for page sections with no text segments", () => {
    const section: ModuleSection = {
      type: "page",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: null },
      segments: [
        {
          type: "chat",
          instructions: "",
          hidePreviousContentFromUser: false,
          hidePreviousContentFromTutor: false,
        },
      ],
      optional: false,
    };
    expect(getSectionTextLength(section)).toBe(0);
  });

  it("returns Infinity for video sections", () => {
    expect(getSectionTextLength(videoSection())).toBe(Infinity);
  });

  it("returns Infinity for article sections", () => {
    expect(getSectionTextLength(articleSection())).toBe(Infinity);
  });
});

describe("getCompletionButtonText", () => {
  it("returns 'Get started' for short text at index 0", () => {
    expect(getCompletionButtonText(textSection("short"), 0)).toBe(
      "Get started",
    );
  });

  it("returns 'Continue' for short text at index > 0", () => {
    expect(getCompletionButtonText(textSection("short"), 1)).toBe("Continue");
  });

  it("returns 'Mark section complete' for long text", () => {
    expect(getCompletionButtonText(textSection("x".repeat(1750)), 0)).toBe(
      "Mark section complete",
    );
  });

  it("returns 'Mark section complete' for video sections", () => {
    expect(getCompletionButtonText(videoSection(), 0)).toBe(
      "Mark section complete",
    );
  });

  it("returns 'Mark section complete' for article sections", () => {
    expect(getCompletionButtonText(articleSection(), 0)).toBe(
      "Mark section complete",
    );
  });

  it("threshold is exclusive (1749 = short, 1750 = long)", () => {
    expect(getCompletionButtonText(textSection("x".repeat(1749)), 0)).toBe(
      "Get started",
    );
    expect(getCompletionButtonText(textSection("x".repeat(1750)), 0)).toBe(
      "Mark section complete",
    );
  });
});
