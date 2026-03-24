/**
 * Tests for ChatMessageList component — specifically tool call rendering.
 *
 * Tests both:
 *   1. renderMessage() — individual message rendering by role
 *   2. ChatMessageList — composite rendering with streaming + tool indicators
 *
 * We mock ChatMarkdown to avoid heavy markdown parsing deps and focus on
 * DOM structure/order rather than markdown rendering.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChatMessage } from "@/types/module";

// Mock ChatMarkdown — we're testing rendering structure, not markdown parsing.
// This is an acceptable mock: we don't test its behavior, we test what's around it.
vi.mock("../ChatMarkdown", () => ({
  ChatMarkdown: ({ children }: { children: string }) => (
    <div data-testid="chat-markdown">{children}</div>
  ),
}));

// Mock StageProgressBar (only used for system message icons)
vi.mock("../StageProgressBar", () => ({
  StageIcon: () => <span data-testid="stage-icon" />,
}));

import { renderMessage, ChatMessageList } from "../ChatMessageList";

// ---------------------------------------------------------------------------
// renderMessage — individual role rendering
// ---------------------------------------------------------------------------

describe("renderMessage", () => {
  it("renders user message as right-aligned bubble", () => {
    const msg: ChatMessage = { role: "user", content: "Hello tutor" };
    const { container } = render(renderMessage(msg, "test-key") as React.ReactElement);

    expect(screen.getByText("Hello tutor")).toBeInTheDocument();
    // User messages have ml-auto for right alignment
    expect(container.firstElementChild).toHaveClass("ml-auto");
  });

  it("renders assistant message with Tutor label", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Here is my response",
    };
    render(renderMessage(msg, "test-key") as React.ReactElement);

    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(screen.getByText("Here is my response")).toBeInTheDocument();
  });

  it("renders system message as centered pill", () => {
    const msg: ChatMessage = { role: "system", content: "Now viewing: Section 1" };
    const { container } = render(renderMessage(msg, "test-key") as React.ReactElement);

    expect(screen.getByText("Now viewing: Section 1")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("flex", "justify-center");
  });

  it("renders course-content message with Lens label", () => {
    const msg: ChatMessage = {
      role: "course-content",
      content: "What do you think about this?",
    };
    render(renderMessage(msg, "test-key") as React.ReactElement);

    expect(screen.getByText("Lens")).toBeInTheDocument();
    expect(
      screen.getByText("What do you think about this?"),
    ).toBeInTheDocument();
  });

  it("renders tool message as collapsible details panel", () => {
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_abc",
      name: "search_alignment_research",
      content: "Result text from search",
    };
    const { container } = render(renderMessage(msg, "test-key") as React.ReactElement);

    // Should render a <details> element
    const details = container.querySelector("details");
    expect(details).toBeInTheDocument();

    // Should show "Searched alignment research" label
    expect(
      screen.getByText("Searched alignment research"),
    ).toBeInTheDocument();

    // Result text should be inside
    expect(screen.getByText("Result text from search")).toBeInTheDocument();
  });

  it("renders tool message with unknown name using fallback label", () => {
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_xyz",
      name: "unknown_tool",
      content: "Some result",
    };
    render(renderMessage(msg, "test-key") as React.ReactElement);

    expect(screen.getByText("Tool completed")).toBeInTheDocument();
  });

  it("skips assistant message that only has tool_calls and no text", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: {
            name: "search_alignment_research",
            arguments: '{"query":"test"}',
          },
        },
      ],
    };
    const result = renderMessage(msg, "test-key");
    expect(result).toBeNull();
  });

  it("renders assistant message with tool_calls AND text content", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Let me search for that.",
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: {
            name: "search_alignment_research",
            arguments: '{"query":"test"}',
          },
        },
      ],
    };
    render(renderMessage(msg, "test-key") as React.ReactElement);

    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(screen.getByText("Let me search for that.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — tool messages from DB history
// ---------------------------------------------------------------------------

describe("ChatMessageList — tool messages in history", () => {
  it("renders tool messages inline within the conversation", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Search for deceptive alignment" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "search_alignment_research",
              arguments: '{"query":"deceptive alignment"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "search_alignment_research",
        content: "Deceptive alignment refers to...",
      },
      {
        role: "assistant",
        content: "Here's what I found about deceptive alignment.",
      },
    ];

    render(<ChatMessageList messages={messages} />);

    // User message visible
    expect(
      screen.getByText("Search for deceptive alignment"),
    ).toBeInTheDocument();

    // Tool result panel visible
    expect(
      screen.getByText("Searched alignment research"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Deceptive alignment refers to..."),
    ).toBeInTheDocument();

    // Final assistant message visible
    expect(
      screen.getByText("Here's what I found about deceptive alignment."),
    ).toBeInTheDocument();

    // Assistant message with only tool_calls (no text) should be hidden
    // There should be exactly one "Tutor" label (for the final response)
    const tutorLabels = screen.getAllByText("Tutor");
    expect(tutorLabels).toHaveLength(1);
  });

  it("renders tool panel and messages in correct DOM order", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "USER_MSG" },
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "search_alignment_research",
        content: "TOOL_RESULT",
      },
      { role: "assistant", content: "ASSISTANT_MSG" },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // Get the scroll container (first child of render)
    const scrollContainer = container.firstElementChild!;
    const children = Array.from(scrollContainer.children);

    // Find indices of key elements
    const userIdx = children.findIndex((el) =>
      el.textContent?.includes("USER_MSG"),
    );
    const toolIdx = children.findIndex((el) =>
      el.textContent?.includes("TOOL_RESULT"),
    );
    const assistantIdx = children.findIndex((el) =>
      el.textContent?.includes("ASSISTANT_MSG"),
    );

    // Order should be: user < tool < assistant
    expect(userIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(assistantIdx);
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — live streaming with tool call indicator
// ---------------------------------------------------------------------------

describe("ChatMessageList — streaming tool call indicator", () => {
  it("shows 'Searching...' indicator when tool is calling", () => {
    render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent=""
        activeToolCall={{
          name: "search_alignment_research",
          state: "calling",
        }}
      />,
    );

    expect(
      screen.getByText("Searching alignment research\u2026"),
    ).toBeInTheDocument();
  });

  it("shows completed indicator when tool state is 'result'", () => {
    render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent=""
        activeToolCall={{
          name: "search_alignment_research",
          state: "result",
        }}
      />,
    );

    // Should show the completed panel, not the searching indicator
    expect(
      screen.getByText("Searched alignment research"),
    ).toBeInTheDocument();
  });

  it("shows Thinking... when loading with no content and no tool call", () => {
    render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent=""
        activeToolCall={null}
      />,
    );

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("shows streaming text with Tutor label when content arrives", () => {
    render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent="Let me look into that for you."
        activeToolCall={null}
      />,
    );

    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(
      screen.getByText("Let me look into that for you."),
    ).toBeInTheDocument();
  });

  it("shows both streaming text and tool indicator during active tool call", () => {
    render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent="Let me search for that."
        activeToolCall={{
          name: "search_alignment_research",
          state: "calling",
        }}
      />,
    );

    // Both should be visible
    expect(
      screen.getByText("Let me search for that."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Searching alignment research\u2026"),
    ).toBeInTheDocument();
  });

  it("does NOT show streaming UI when not loading", () => {
    render(
      <ChatMessageList
        messages={[]}
        isLoading={false}
        streamingContent="stale content"
        activeToolCall={null}
      />,
    );

    // Should not render the streaming content when not loading
    expect(screen.queryByText("stale content")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — streaming content split around tool call (Bug #1 & #2)
// ---------------------------------------------------------------------------

describe("ChatMessageList — tool call content positioning (Bug #1 & #2)", () => {
  it("pre-tool text should appear BEFORE the tool indicator in the DOM", () => {
    // When streamingContent = "Pre-tool text.\n\nPost-tool text." and tool call is active,
    // the tool indicator should be between pre-tool and post-tool text, not after all text.
    //
    // This test documents the desired behavior. Currently the tool indicator
    // renders after ALL of streamingContent.
    const { container } = render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent="Pre-tool text."
        activeToolCall={{
          name: "search_alignment_research",
          state: "calling",
        }}
      />,
    );

    // Pre-tool text should exist
    expect(screen.getByText("Pre-tool text.")).toBeInTheDocument();
    // Tool indicator should exist
    expect(
      screen.getByText("Searching alignment research\u2026"),
    ).toBeInTheDocument();

    // The tool indicator should come AFTER the pre-tool text in DOM order
    const streamingEl = container.querySelector(".text-gray-800");
    if (streamingEl) {
      const allText = streamingEl.textContent || "";
      const preToolPos = allText.indexOf("Pre-tool text.");
      const indicatorPos = allText.indexOf("Searching alignment research");
      expect(preToolPos).toBeLessThan(indicatorPos);
    }
  });

  it("post-tool text should appear AFTER the tool indicator in the DOM", () => {
    // With a split point, the rendering should be:
    //   <ChatMarkdown>{preToolContent}</ChatMarkdown>
    //   <ToolIndicator />
    //   <ChatMarkdown>{postToolContent}</ChatMarkdown>
    const { container } = render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent="Pre-tool.\n\nPost-tool."
        activeToolCall={{
          name: "search_alignment_research",
          state: "result",
        }}
        toolCallInsertPoint={"Pre-tool.".length}
      />,
    );

    const scrollContainer = container.firstElementChild!;
    const fullText = scrollContainer.textContent || "";

    // The desired order in the DOM text content:
    // "Pre-tool." should come before the tool label
    // "Post-tool." should come after the tool label
    const prePos = fullText.indexOf("Pre-tool.");
    const toolPos = fullText.indexOf("Searched alignment research");
    const postPos = fullText.indexOf("Post-tool.");

    // All three should be present
    expect(prePos).toBeGreaterThanOrEqual(0);
    expect(toolPos).toBeGreaterThanOrEqual(0);
    expect(postPos).toBeGreaterThanOrEqual(0);

    // Order: pre-tool < tool indicator < post-tool
    expect(prePos).toBeLessThan(toolPos);
    expect(toolPos).toBeLessThan(postPos);
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — pending message rendering
// ---------------------------------------------------------------------------

describe("ChatMessageList — pending messages", () => {
  it("renders pending message bubble", () => {
    render(
      <ChatMessageList
        messages={[]}
        pendingMessage={{ content: "Sending this...", status: "sending" }}
      />,
    );

    expect(screen.getByText("Sending this...")).toBeInTheDocument();
  });

  it("renders failed pending message with error indicator", () => {
    render(
      <ChatMessageList
        messages={[]}
        pendingMessage={{ content: "Failed msg", status: "failed" }}
      />,
    );

    expect(screen.getByText("Failed msg")).toBeInTheDocument();
    expect(screen.getByText("Failed to send")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional gaps from code review
// ---------------------------------------------------------------------------

describe("ChatMessageList — tool call edge cases (from review)", () => {
  it("renders unknown tool with fallback calling label", () => {
    render(
      <ChatMessageList
        messages={[]}
        isLoading={true}
        streamingContent=""
        activeToolCall={{ name: "unknown_tool", state: "calling" }}
      />,
    );

    expect(screen.getByText("Using tool\u2026")).toBeInTheDocument();
  });

  it("tool result from DB history has actual content, not empty", () => {
    const messages: ChatMessage[] = [
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "search_alignment_research",
        content: "Deceptive alignment is a hypothesized scenario...",
      },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);

    // The <details> should contain the actual result content
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre?.textContent).toContain(
      "Deceptive alignment is a hypothesized scenario",
    );
  });

  it("tool messages render correctly with startIndex that skips earlier messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "OLD_MSG_1" },
      { role: "assistant", content: "OLD_MSG_2" },
      { role: "user", content: "NEW_MSG" },
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "search_alignment_research",
        content: "Tool result",
      },
      { role: "assistant", content: "RESPONSE" },
    ];

    render(<ChatMessageList messages={messages} startIndex={2} />);

    // Old messages should be hidden
    expect(screen.queryByText("OLD_MSG_1")).not.toBeInTheDocument();
    expect(screen.queryByText("OLD_MSG_2")).not.toBeInTheDocument();

    // New messages including tool result should be visible
    expect(screen.getByText("NEW_MSG")).toBeInTheDocument();
    expect(screen.getByText("Tool result")).toBeInTheDocument();
    expect(screen.getByText("RESPONSE")).toBeInTheDocument();
  });

  it("message ordering test verifies content at each position, not just roles", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "USER_CONTENT" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "search_alignment_research",
              arguments: '{"query":"test"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "search_alignment_research",
        content: "TOOL_CONTENT",
      },
      { role: "assistant", content: "FINAL_CONTENT" },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    const scrollContainer = container.firstElementChild!;
    const fullText = scrollContainer.textContent || "";

    // Verify content appears in correct order
    const userPos = fullText.indexOf("USER_CONTENT");
    const toolPos = fullText.indexOf("TOOL_CONTENT");
    const finalPos = fullText.indexOf("FINAL_CONTENT");

    expect(userPos).toBeGreaterThanOrEqual(0);
    expect(toolPos).toBeGreaterThanOrEqual(0);
    expect(finalPos).toBeGreaterThanOrEqual(0);

    expect(userPos).toBeLessThan(toolPos);
    expect(toolPos).toBeLessThan(finalPos);

    // The empty assistant message (with only tool_calls) should NOT produce a "Tutor" label
    // Only the final assistant message should show "Tutor"
    const tutorLabels = screen.getAllByText("Tutor");
    expect(tutorLabels).toHaveLength(1);
  });
});
