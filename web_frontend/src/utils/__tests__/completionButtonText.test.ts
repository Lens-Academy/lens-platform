// web_frontend/src/utils/__tests__/completionButtonText.test.ts
import { describe, it, expect } from "vitest";
import {
  getSectionTextLength,
  getCompletionButtonText,
} from "../completionButtonText";
import type { ModuleSection } from "@/types/module";

function lensSection(texts: string[]): ModuleSection {
  return {
    type: "lens",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: null },
    segments: texts.map((t) => ({ type: "text" as const, content: t })),
    optional: false,
  };
}

function videoLensSection(): ModuleSection {
  return {
    type: "lens",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: "Video" },
    segments: [
      {
        type: "video",
        from: 0,
        to: 60,
        transcript: "...",
        title: "Video",
        channel: "Channel",
        videoId: "abc",
      },
    ],
    optional: false,
  };
}

function articleLensSection(): ModuleSection {
  return {
    type: "lens",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: "Article" },
    segments: [
      {
        type: "article",
        content: "Some article content",
        title: "Article",
        author: "Author",
      },
    ],
    optional: false,
  };
}

describe("getSectionTextLength", () => {
  it("returns sum of text segment lengths for lens sections", () => {
    expect(getSectionTextLength(lensSection(["abc", "de"]))).toBe(5);
  });

  it("returns 0 for lens sections with no text segments", () => {
    const section: ModuleSection = {
      type: "lens",
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

  it("returns Infinity for video lens sections", () => {
    expect(getSectionTextLength(videoLensSection())).toBe(Infinity);
  });

  it("includes article content length for article lens sections", () => {
    const len = getSectionTextLength(articleLensSection());
    expect(len).toBe("Some article content".length);
  });
});

describe("getCompletionButtonText", () => {
  it("returns 'Get started' for short lens text at index 0", () => {
    expect(getCompletionButtonText(lensSection(["short"]), 0)).toBe(
      "Get started",
    );
  });

  it("returns 'Continue' for short lens text at index > 0", () => {
    expect(getCompletionButtonText(lensSection(["short"]), 1)).toBe(
      "Continue",
    );
  });

  it("returns 'Mark section complete' for long lens text", () => {
    expect(
      getCompletionButtonText(lensSection(["x".repeat(1750)]), 0),
    ).toBe("Mark section complete");
  });

  it("returns 'Mark section complete' for video lens sections", () => {
    expect(getCompletionButtonText(videoLensSection(), 0)).toBe(
      "Mark section complete",
    );
  });

  it("returns 'Mark section complete' for article lens sections", () => {
    expect(getCompletionButtonText(articleLensSection(), 0)).toBe(
      "Mark section complete",
    );
  });

  it("returns 'Continue' for short lens with chat segment at index 0", () => {
    const section: ModuleSection = {
      type: "lens",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: null },
      segments: [
        { type: "text" as const, content: "short intro" },
        {
          type: "chat",
          instructions: "",
          hidePreviousContentFromUser: false,
          hidePreviousContentFromTutor: false,
        },
      ],
      optional: false,
    };
    expect(getCompletionButtonText(section, 0)).toBe("Continue");
  });

  it("threshold is exclusive (1749 = short, 1750 = long)", () => {
    expect(
      getCompletionButtonText(lensSection(["x".repeat(1749)]), 0),
    ).toBe("Get started");
    expect(
      getCompletionButtonText(lensSection(["x".repeat(1750)]), 0),
    ).toBe("Mark section complete");
  });
});
