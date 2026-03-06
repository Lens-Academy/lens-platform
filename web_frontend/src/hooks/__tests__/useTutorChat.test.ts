import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { LensArticleSection, Module } from "@/types/module";

// Mock API layer
vi.mock("@/api/modules", () => ({
  sendMessage: vi.fn(),
  getChatHistory: vi.fn(),
}));

// Mock analytics
vi.mock("@/analytics", () => ({
  trackChatMessageSent: vi.fn(),
}));

import { useTutorChat } from "../useTutorChat";
import { getChatHistory } from "@/api/modules";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const testArticleSection: LensArticleSection = {
  type: "lens-article",
  contentId: null,
  learningOutcomeId: null,
  learningOutcomeName: null,
  meta: { title: "Test Article", author: null, sourceUrl: null },
  segments: [
    {
      type: "article-excerpt",
      content: "excerpt",
      collapsed_before: null,
      collapsed_after: null,
    },
    { type: "text", content: "Opening question text" },
    {
      type: "chat",
      instructions: "",
      hidePreviousContentFromUser: false,
      hidePreviousContentFromTutor: false,
    },
  ],
  optional: false,
};

const baseOptions = {
  moduleId: "test-module",
  module: null as Module | null,
  currentSectionIndex: 0,
  currentSegmentIndex: 0,
  currentSection: undefined as LensArticleSection | undefined,
  isArticleSection: false,
  triggerChatActivity: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTutorChat", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getChatHistory).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with empty state", () => {
    const { result } = renderHook(() => useTutorChat(baseOptions));

    expect(result.current.messages).toEqual([]);
    expect(result.current.pendingMessage).toBeNull();
    expect(result.current.streamingContent).toBe("");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeSurface).toEqual({ type: "sidebar" });
  });

  it("computes sectionPrefixMessage from article segments", () => {
    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,

        isArticleSection: true,
        currentSection: testArticleSection,
      }),
    );

    // The section has: article-excerpt -> text("Opening question text") -> chat
    // sectionPrefixMessage should be the text between article-excerpt and chat
    expect(result.current.sectionPrefixMessage).toEqual({
      role: "course-content",
      content: "Opening question text",
    });
  });

  it("returns undefined sectionPrefixMessage when no article-excerpt exists", () => {
    const sectionWithoutExcerpt: LensArticleSection = {
      ...testArticleSection,
      segments: [
        { type: "text", content: "Just text" },
        {
          type: "chat",
          instructions: "",
          hidePreviousContentFromUser: false,
          hidePreviousContentFromTutor: false,
        },
      ],
    };

    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,

        isArticleSection: true,
        currentSection: sectionWithoutExcerpt,
      }),
    );

    expect(result.current.sectionPrefixMessage).toBeUndefined();
  });

  it("returns undefined sectionPrefixMessage when no text segments between excerpt and chat", () => {
    const sectionNoText: LensArticleSection = {
      ...testArticleSection,
      segments: [
        {
          type: "article-excerpt",
          content: "excerpt",
          collapsed_before: null,
          collapsed_after: null,
        },
        // chat immediately follows excerpt - no text in between
        {
          type: "chat",
          instructions: "",
          hidePreviousContentFromUser: false,
          hidePreviousContentFromTutor: false,
        },
      ],
    };

    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,

        isArticleSection: true,
        currentSection: sectionNoText,
      }),
    );

    // firstChatInPostIdx is 0 (chat is at index 0 of postExcerpt),
    // which is <= 0, so returns undefined
    expect(result.current.sectionPrefixMessage).toBeUndefined();
  });

  it("computes sidebarChatSegmentIndex", () => {
    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,

        isArticleSection: true,
        currentSection: testArticleSection,
      }),
    );

    // The chat segment is at index 2 in the test section
    expect(result.current.sidebarChatSegmentIndex).toBe(2);
  });

  it("returns -1 for sidebarChatSegmentIndex when not article section", () => {
    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,

        isArticleSection: false,
        currentSection: undefined,
      }),
    );

    expect(result.current.sidebarChatSegmentIndex).toBe(-1);
  });

  it("reports sectionHasChatSegment correctly", () => {
    const { result: withChat } = renderHook(() =>
      useTutorChat({
        ...baseOptions,

        isArticleSection: true,
        currentSection: testArticleSection,
      }),
    );

    expect(withChat.current.sectionHasChatSegment).toBe(true);

    const sectionWithoutChat: LensArticleSection = {
      ...testArticleSection,
      segments: [{ type: "text", content: "Just text" }],
    };

    const { result: withoutChat } = renderHook(() =>
      useTutorChat({
        ...baseOptions,

        isArticleSection: true,
        currentSection: sectionWithoutChat,
      }),
    );

    expect(withoutChat.current.sectionHasChatSegment).toBe(false);
  });

  it("loads chat history when module is provided", async () => {
    const mockModule: Module = {
      slug: "test-module",
      title: "Test Module",
      sections: [],
    };

    vi.mocked(getChatHistory).mockResolvedValue({
      sessionId: 1,
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ],
    });

    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,
        module: mockModule,
      }),
    );

    // Wait for the async loadHistory to resolve
    await act(async () => {});

    expect(getChatHistory).toHaveBeenCalledWith("test-module");
    expect(result.current.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);
  });

  it("strips leading assistant messages from history", async () => {
    const mockModule: Module = {
      slug: "test-module",
      title: "Test Module",
      sections: [],
    };

    vi.mocked(getChatHistory).mockResolvedValue({
      sessionId: 1,
      messages: [
        { role: "assistant", content: "Auto-preamble" },
        { role: "assistant", content: "Another auto" },
        { role: "user", content: "First real message" },
        { role: "assistant", content: "Reply" },
      ],
    });

    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,
        module: mockModule,
      }),
    );

    await act(async () => {});

    // Should skip the leading assistant messages
    expect(result.current.messages).toEqual([
      { role: "user", content: "First real message" },
      { role: "assistant", content: "Reply" },
    ]);
  });
});
