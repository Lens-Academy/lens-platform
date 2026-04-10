import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { LensSection, Module } from "@/types/module";

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
import { sendMessage as sendMessageApi, getChatHistory } from "@/api/modules";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const testArticleSection: LensSection = {
  type: "lens",
  contentId: null,
  learningOutcomeId: null,
  learningOutcomeName: null,
  meta: { title: "Test Article" },
  segments: [
    {
      type: "article",
      content: "excerpt",
      title: "Test Article",
      author: "Author",
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
  currentSection: undefined as LensSection | undefined,
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

    expect(result.current.chatStore.getHot().messages).toEqual([]);
    expect(result.current.chatStore.getHot().pendingMessage).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeSurface).toEqual({ type: "sidebar" });
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

    const sectionWithoutChat: LensSection = {
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
    expect(result.current.chatStore.getHot().messages).toEqual([
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
    expect(result.current.chatStore.getHot().messages).toEqual([
      { role: "user", content: "First real message" },
      { role: "assistant", content: "Reply" },
    ]);
  });

  it("after two-round tool call, messages are interleaved (not tools-first)", async () => {
    // Simulates the SSE stream for: text → tool → text → tool → text
    // The sendMessage API mock yields events in order.
    const mockModule: Module = {
      slug: "test-module",
      title: "Test Module",
      sections: [testArticleSection],
    };

    vi.mocked(getChatHistory).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });

    // Mock sendMessage to yield a two-round tool call sequence
    async function* twoRoundToolStream() {
      yield { type: "text", content: "Let me search." };
      yield {
        type: "tool_use",
        name: "search_alignment_research",
        state: "calling",
      };
      yield {
        type: "tool_use",
        name: "search_alignment_research",
        state: "result",
        result: "Result A",
      };
      yield { type: "text", content: "\n\nLet me dig deeper." };
      yield {
        type: "tool_use",
        name: "search_alignment_research",
        state: "calling",
      };
      yield {
        type: "tool_use",
        name: "search_alignment_research",
        state: "result",
        result: "Result B",
      };
      yield { type: "text", content: "\n\nHere are the findings." };
    }
    vi.mocked(sendMessageApi).mockReturnValue(twoRoundToolStream());

    const { result } = renderHook(() =>
      useTutorChat({
        ...baseOptions,
        module: mockModule,
        currentSection: testArticleSection,
        isArticleSection: true,
      }),
    );

    await act(async () => {});

    // Send a message
    await act(async () => {
      await result.current.sendMessage("Search two topics", 0, 2, "inline");
    });

    // After streaming finishes, messages should have tool results interleaved with text
    const roles = result.current.chatStore.getHot().messages.map((m) => m.role);

    // DESIRED: user → assistant+tc → tool → assistant+tc → tool → assistant
    // or at minimum the tools should not ALL appear before the text.
    //
    // Currently the hook only sends role:"tool" in toolMessages, so we get:
    // user → tool → tool → assistant (all text concatenated) — BAD
    //
    // This test asserts the DESIRED behavior:
    expect(roles).toEqual([
      "user",
      "assistant", // "Let me search." with tool_calls
      "tool", // Result A
      "assistant", // "Let me dig deeper." with tool_calls
      "tool", // Result B
      "assistant", // "Here are the findings."
    ]);
  });
});
