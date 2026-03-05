import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { ChatMessage } from "@/types/module";

// Mock dependencies
vi.mock("@/components/ChatMarkdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("@/components/module/StageProgressBar", () => ({
  StageIcon: () => null,
}));
vi.mock("@/components/module/ChatMessageList", () => ({
  renderMessage: (msg: ChatMessage, key: string | number) => (
    <div key={key} data-testid={`msg-${key}`}>
      {msg.content}
    </div>
  ),
}));
vi.mock("../ChatInputArea", () => ({
  ChatInputArea: ({
    onSend,
    placeholder,
  }: {
    onSend: (content: string) => void;
    placeholder?: string;
  }) => {
    const [input, setInput] = React.useState("");
    const submit = () => {
      if (input.trim()) {
        onSend(input.trim());
        setInput("");
      }
    };
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          placeholder={placeholder || "Type a message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit">Send</button>
      </form>
    );
  },
}));

// Stub scrollIntoView (jsdom doesn't implement it)
Element.prototype.scrollIntoView = vi.fn();

import { ChatInlineShell } from "../ChatInlineShell";

// Viewport height drives the minHeight calculation (window.innerHeight - 160)
const VIEWPORT_HEIGHT = 800;
const EXPECTED_MIN_HEIGHT = VIEWPORT_HEIGHT - 160; // 640

/** Find the min-height wrapper by its flex layout class on the ref'd div */
function getMinHeightWrapper(container: HTMLElement): HTMLElement {
  // The wrapper is a div with class "flex flex-col" and a style.minHeight
  const candidates =
    container.querySelectorAll<HTMLElement>("div.flex.flex-col");
  for (const el of candidates) {
    if (el.style.minHeight) return el;
  }
  throw new Error("Could not find min-height wrapper");
}

describe("ChatInlineShell minHeight on second message", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: VIEWPORT_HEIGHT,
    });
  });

  it("sets minHeight on first message send", async () => {
    const user = userEvent.setup();
    const messages: ChatMessage[] = [];
    const onSendMessage = vi.fn();

    const { container } = render(
      <ChatInlineShell
        messages={messages}
        pendingMessage={null}
        isLoading={false}
        streamingContent=""
        onSendMessage={onSendMessage}
        inputText=""
        onInputTextChange={vi.fn()}
        hasActiveInput={true}
      />,
    );

    // Type and send first message
    const textarea = screen.getByPlaceholderText("Type a message...");
    await user.type(textarea, "Hello");
    await user.keyboard("{Enter}");

    expect(onSendMessage).toHaveBeenCalledWith("Hello");

    const wrapper = getMinHeightWrapper(container);
    expect(wrapper.style.minHeight).toBe(`${EXPECTED_MIN_HEIGHT}px`);
  });

  it("preserves minHeight on second message send", async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();

    // Start with first exchange already complete (user sent, assistant replied)
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const { container, rerender } = render(
      <ChatInlineShell
        messages={messages}
        pendingMessage={null}
        isLoading={false}
        streamingContent=""
        onSendMessage={onSendMessage}
        activated
        inputText=""
        onInputTextChange={vi.fn()}
        hasActiveInput={true}
      />,
    );

    // Type and send second message
    const textarea = screen.getByPlaceholderText("Type a message...");
    await user.type(textarea, "Follow-up");
    await user.keyboard("{Enter}");

    expect(onSendMessage).toHaveBeenCalledWith("Follow-up");

    // Simulate parent adding the new message and setting pending
    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: "Follow-up" },
    ];

    rerender(
      <ChatInlineShell
        messages={updatedMessages}
        pendingMessage={{ content: "Follow-up", status: "sending" }}
        isLoading={true}
        streamingContent=""
        onSendMessage={onSendMessage}
        activated
        inputText=""
        onInputTextChange={vi.fn()}
        hasActiveInput={true}
      />,
    );

    // The wrapper must still have the correct minHeight — not collapsed
    const wrapper = getMinHeightWrapper(container);
    expect(wrapper.style.minHeight).toBe(`${EXPECTED_MIN_HEIGHT}px`);
  });
});
