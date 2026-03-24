/**
 * Tests for ChatMessageList component — message rendering by role,
 * tool call panels, and streaming states.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChatMessage } from "@/types/module";

// Mock ChatMarkdown — we're testing rendering structure, not markdown parsing.
vi.mock("../ChatMarkdown", () => ({
  ChatMarkdown: ({ children }: { children: string }) => (
    <div data-testid="chat-markdown">{children}</div>
  ),
}));

// Mock StageProgressBar
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
    const { container } = render(renderMessage(msg, "k") as React.ReactElement);
    expect(screen.getByText("Hello tutor")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("ml-auto");
  });

  it("renders assistant message with Tutor label", () => {
    const msg: ChatMessage = { role: "assistant", content: "Here is my response" };
    render(renderMessage(msg, "k") as React.ReactElement);
    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(screen.getByText("Here is my response")).toBeInTheDocument();
  });

  it("renders system message as centered pill", () => {
    const msg: ChatMessage = { role: "system", content: "Now viewing: Section 1" };
    const { container } = render(renderMessage(msg, "k") as React.ReactElement);
    expect(screen.getByText("Now viewing: Section 1")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("flex", "justify-center");
  });

  it("renders course-content message with Lens label", () => {
    const msg: ChatMessage = { role: "course-content", content: "What do you think?" };
    render(renderMessage(msg, "k") as React.ReactElement);
    expect(screen.getByText("Lens")).toBeInTheDocument();
  });

  it("renders tool message with content as collapsible panel", () => {
    const msg: ChatMessage = {
      role: "tool", tool_call_id: "c1", name: "search_alignment_research", content: "Result text",
    };
    const { container } = render(renderMessage(msg, "k") as React.ReactElement);
    expect(container.querySelector("details")).toBeInTheDocument();
    expect(screen.getByText("Searched alignment research")).toBeInTheDocument();
    expect(screen.getByText("Result text")).toBeInTheDocument();
  });

  it("renders tool message with empty content as calling indicator", () => {
    const msg: ChatMessage = {
      role: "tool", tool_call_id: "", name: "search_alignment_research", content: "",
    };
    render(renderMessage(msg, "k") as React.ReactElement);
    expect(screen.getByText("Searching alignment research\u2026")).toBeInTheDocument();
  });

  it("renders unknown tool with fallback labels", () => {
    const msg: ChatMessage = {
      role: "tool", tool_call_id: "", name: "unknown_tool", content: "result",
    };
    render(renderMessage(msg, "k") as React.ReactElement);
    expect(screen.getByText("Tool completed")).toBeInTheDocument();
  });

  it("skips assistant with tool_calls and no text", () => {
    const msg: ChatMessage = {
      role: "assistant", content: "",
      tool_calls: [{ id: "c1", type: "function", function: { name: "search", arguments: "{}" } }],
    };
    expect(renderMessage(msg, "k")).toBeNull();
  });

  it("skips empty assistant messages", () => {
    const msg: ChatMessage = { role: "assistant", content: "" };
    expect(renderMessage(msg, "k")).toBeNull();
  });

  it("renders assistant with tool_calls AND text content", () => {
    const msg: ChatMessage = {
      role: "assistant", content: "Let me search.",
      tool_calls: [{ id: "c1", type: "function", function: { name: "search", arguments: "{}" } }],
    };
    render(renderMessage(msg, "k") as React.ReactElement);
    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(screen.getByText("Let me search.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — tool messages from DB history
// ---------------------------------------------------------------------------

describe("ChatMessageList — tool messages in history", () => {
  it("renders interleaved tool call history correctly", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Search for deceptive alignment" },
      { role: "assistant", content: "", tool_calls: [
        { id: "c1", type: "function", function: { name: "search_alignment_research", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "c1", name: "search_alignment_research", content: "Deceptive alignment refers to..." },
      { role: "assistant", content: "Here's what I found." },
    ];

    render(<ChatMessageList messages={messages} />);

    expect(screen.getByText("Search for deceptive alignment")).toBeInTheDocument();
    expect(screen.getByText("Searched alignment research")).toBeInTheDocument();
    expect(screen.getByText("Here's what I found.")).toBeInTheDocument();

    // No "Tutor" labels — the first assistant is hidden (empty+tool_calls),
    // and the second is a continuation after tool call (label suppressed)
    expect(screen.queryByText("Tutor")).not.toBeInTheDocument();
  });

  it("renders three tool panels from history", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Search three topics" },
      { role: "assistant", content: "", tool_calls: [
        { id: "c1", type: "function", function: { name: "search_alignment_research", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "c1", name: "search_alignment_research", content: "R1" },
      { role: "tool", tool_call_id: "c2", name: "search_alignment_research", content: "R2" },
      { role: "tool", tool_call_id: "c3", name: "search_alignment_research", content: "R3" },
      { role: "assistant", content: "Combined results." },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    expect(container.querySelectorAll("details")).toHaveLength(3);
    expect(screen.getAllByText("Searched alignment research")).toHaveLength(3);
  });

  it("renders DOM elements in correct order", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "USER_MSG" },
      { role: "tool", tool_call_id: "c1", name: "search_alignment_research", content: "TOOL_RESULT" },
      { role: "assistant", content: "ASSISTANT_MSG" },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    const fullText = container.firstElementChild!.textContent || "";

    const userPos = fullText.indexOf("USER_MSG");
    const toolPos = fullText.indexOf("TOOL_RESULT");
    const asstPos = fullText.indexOf("ASSISTANT_MSG");

    expect(userPos).toBeLessThan(toolPos);
    expect(toolPos).toBeLessThan(asstPos);
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — streaming states (messages built incrementally)
// ---------------------------------------------------------------------------

describe("ChatMessageList — streaming via messages array", () => {
  it("shows Thinking... when last message is empty assistant during loading", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
    ];
    render(<ChatMessageList messages={messages} isLoading={true} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("does not show Thinking... when assistant has content", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    render(<ChatMessageList messages={messages} isLoading={true} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("shows tool calling indicator during streaming", () => {
    // During streaming: assistant text frozen, tool placeholder with empty content
    const messages: ChatMessage[] = [
      { role: "user", content: "Search" },
      { role: "assistant", content: "Let me search.", tool_calls: [
        { id: "", type: "function", function: { name: "search_alignment_research", arguments: "" } },
      ] },
      { role: "tool", tool_call_id: "", name: "search_alignment_research", content: "" },
      { role: "assistant", content: "" },
    ];
    render(<ChatMessageList messages={messages} isLoading={true} />);

    expect(screen.getByText("Let me search.")).toBeInTheDocument();
    expect(screen.getByText("Searching alignment research\u2026")).toBeInTheDocument();
  });

  it("shows completed tool panel after tool result arrives", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Search" },
      { role: "assistant", content: "Let me search.", tool_calls: [
        { id: "", type: "function", function: { name: "search_alignment_research", arguments: "" } },
      ] },
      { role: "tool", tool_call_id: "", name: "search_alignment_research", content: "Results here" },
      { role: "assistant", content: "Here's what I found." },
    ];
    render(<ChatMessageList messages={messages} isLoading={true} />);

    expect(screen.getByText("Searched alignment research")).toBeInTheDocument();
    expect(screen.getByText("Results here")).toBeInTheDocument();
    expect(screen.getByText("Here's what I found.")).toBeInTheDocument();
  });

  it("two-round streaming: tool panels at correct positions", () => {
    // Simulates the messages array during a two-round tool call stream
    const messages: ChatMessage[] = [
      { role: "user", content: "Explain thoroughly" },
      { role: "assistant", content: "Let me search.", tool_calls: [
        { id: "", type: "function", function: { name: "search_alignment_research", arguments: "" } },
      ] },
      { role: "tool", tool_call_id: "", name: "search_alignment_research", content: "Result A" },
      { role: "assistant", content: "Let me dig deeper.", tool_calls: [
        { id: "", type: "function", function: { name: "search_alignment_research", arguments: "" } },
      ] },
      { role: "tool", tool_call_id: "", name: "search_alignment_research", content: "Result B" },
      { role: "assistant", content: "Combined findings." },
    ];

    const { container } = render(<ChatMessageList messages={messages} />);
    const fullText = container.firstElementChild!.textContent || "";

    // Verify interleaved order
    const search1 = fullText.indexOf("Let me search.");
    const result1 = fullText.indexOf("Result A");
    const deeper = fullText.indexOf("Let me dig deeper.");
    const result2 = fullText.indexOf("Result B");
    const combined = fullText.indexOf("Combined findings.");

    expect(search1).toBeLessThan(result1);
    expect(result1).toBeLessThan(deeper);
    expect(deeper).toBeLessThan(result2);
    expect(result2).toBeLessThan(combined);
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — Tutor label deduplication
// ---------------------------------------------------------------------------

describe("ChatMessageList — Tutor label deduplication", () => {
  it("shows only one Tutor label for a two-round tool call sequence", () => {
    // user → assistant(text+tc) → tool → assistant(text+tc) → tool → assistant(text)
    // Only the first assistant after the user should show "Tutor"
    const messages: ChatMessage[] = [
      { role: "user", content: "Explain thoroughly" },
      { role: "assistant", content: "Let me search.", tool_calls: [
        { id: "", type: "function", function: { name: "search_alignment_research", arguments: "" } },
      ] },
      { role: "tool", tool_call_id: "", name: "search_alignment_research", content: "Result A" },
      { role: "assistant", content: "Let me dig deeper.", tool_calls: [
        { id: "", type: "function", function: { name: "search_alignment_research", arguments: "" } },
      ] },
      { role: "tool", tool_call_id: "", name: "search_alignment_research", content: "Result B" },
      { role: "assistant", content: "Combined findings." },
    ];

    render(<ChatMessageList messages={messages} />);

    // All text should be visible
    expect(screen.getByText("Let me search.")).toBeInTheDocument();
    expect(screen.getByText("Let me dig deeper.")).toBeInTheDocument();
    expect(screen.getByText("Combined findings.")).toBeInTheDocument();

    // Only ONE "Tutor" label — the first assistant message shows it,
    // continuation messages after tool calls do not
    expect(screen.getAllByText("Tutor")).toHaveLength(1);
  });

  it("shows Tutor label again after a new user message", () => {
    // Two separate exchanges — each gets its own Tutor label
    const messages: ChatMessage[] = [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer." },
      { role: "user", content: "Second question" },
      { role: "assistant", content: "Second answer." },
    ];

    render(<ChatMessageList messages={messages} />);
    expect(screen.getAllByText("Tutor")).toHaveLength(2);
  });

  it("shows Tutor label after system message break", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer." },
      { role: "system", content: "Now viewing: Section 2" },
      { role: "assistant", content: "New context response." },
    ];

    render(<ChatMessageList messages={messages} />);
    expect(screen.getAllByText("Tutor")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ChatMessageList — pending messages
// ---------------------------------------------------------------------------

describe("ChatMessageList — pending messages", () => {
  it("renders pending message bubble", () => {
    render(
      <ChatMessageList
        messages={[]}
        pendingMessage={{ content: "Sending...", status: "sending" }}
      />,
    );
    expect(screen.getByText("Sending...")).toBeInTheDocument();
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
