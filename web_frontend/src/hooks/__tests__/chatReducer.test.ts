/**
 * Tests for the chatReducer in useTutorChat.
 *
 * Focuses on tool call state transitions — the streaming lifecycle where
 * the LLM sends pre-tool text, invokes a tool, then sends post-tool text.
 * These tests document the DESIRED behavior for three known bugs:
 *
 *   1. Tool panel should render between pre-tool and post-tool text
 *      (requires tracking where in streamingContent the tool call occurred)
 *   2. Post-tool text should appear after the tool panel, not above it
 *      (same root cause as #1)
 *   3. Tool messages should persist in the messages array after SEND_SUCCESS
 *      (currently only user + assistant messages are added)
 */

import { describe, it, expect } from "vitest";
import {
  chatReducer,
  initialChatState,
  type ChatState,
} from "../useTutorChat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate SEND_START for a user message */
function sendStart(state: ChatState, content = "test message"): ChatState {
  return chatReducer(state, {
    type: "SEND_START",
    content,
    sectionIndex: 0,
    segmentIndex: 2,
    source: "inline",
  });
}

// ---------------------------------------------------------------------------
// Basic TOOL_CALL action
// ---------------------------------------------------------------------------

describe("chatReducer — TOOL_CALL", () => {
  it("sets activeToolCall on TOOL_CALL with state 'calling'", () => {
    const state = sendStart(initialChatState);
    const next = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });

    expect(next.activeToolCall).toEqual({
      name: "search_alignment_research",
      state: "calling",
    });
  });

  it("updates activeToolCall when state transitions to 'result'", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "result",
    });

    expect(state.activeToolCall).toEqual({
      name: "search_alignment_research",
      state: "result",
    });
  });

  it("clears activeToolCall on SEND_SUCCESS", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });

    state = chatReducer(state, {
      type: "SEND_SUCCESS",
      userContent: "test",
      assistantContent: "response",
    });

    expect(state.activeToolCall).toBeNull();
  });

  it("clears activeToolCall on SEND_FAILURE", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });

    state = chatReducer(state, { type: "SEND_FAILURE" });

    expect(state.activeToolCall).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full tool call streaming lifecycle
// ---------------------------------------------------------------------------

describe("chatReducer — full tool call streaming lifecycle", () => {
  it("simulates complete tool call flow: pre-text → tool → post-text → success", () => {
    let state = sendStart(initialChatState, "Search for deceptive alignment");

    // 1. Pre-tool text streams in
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "Let me search for that.",
    });
    expect(state.streamingContent).toBe("Let me search for that.");

    // 2. Tool call starts
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });
    expect(state.activeToolCall?.state).toBe("calling");

    // 3. Tool call completes
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "result",
    });
    expect(state.activeToolCall?.state).toBe("result");

    // 4. Post-tool text streams in (accumulated includes ALL text)
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated:
        "Let me search for that.\n\nHere's what the research says about deceptive alignment...",
    });
    expect(state.streamingContent).toContain("Here's what the research says");

    // 5. Stream completes
    state = chatReducer(state, {
      type: "SEND_SUCCESS",
      userContent: "Search for deceptive alignment",
      assistantContent:
        "Let me search for that.\n\nHere's what the research says about deceptive alignment...",
    });

    expect(state.isLoading).toBe(false);
    expect(state.activeToolCall).toBeNull();
    expect(state.streamingContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Bug #3: Tool messages should persist after SEND_SUCCESS
// ---------------------------------------------------------------------------

describe("chatReducer — tool message persistence (Bug #3)", () => {
  it("SEND_SUCCESS should include tool messages in the messages array", () => {
    let state = sendStart(initialChatState, "Search for deceptive alignment");

    // Simulate streaming with tool call
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "Let me search.",
    });
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "result",
    });
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "Let me search.\n\nHere are the results.",
    });

    // SEND_SUCCESS with tool messages
    state = chatReducer(state, {
      type: "SEND_SUCCESS",
      userContent: "Search for deceptive alignment",
      assistantContent: "Here are the results.",
      toolMessages: [
        {
          role: "assistant" as const,
          content: "Let me search.",
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: {
                name: "search_alignment_research",
                arguments: '{"query":"deceptive alignment"}',
              },
            },
          ],
        },
        {
          role: "tool" as const,
          tool_call_id: "call_abc",
          name: "search_alignment_research",
          content: "Deceptive alignment refers to...",
        },
      ],
    });

    // Messages should contain: user, assistant-with-tool-calls, tool-result, assistant-response
    const roles = state.messages.map((m) => m.role);
    expect(roles).toContain("tool");

    // The tool result message should be in the array
    const toolMsg = state.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    if (toolMsg && toolMsg.role === "tool") {
      expect(toolMsg.name).toBe("search_alignment_research");
      expect(toolMsg.content).toBe("Deceptive alignment refers to...");
    }
  });

  it("SEND_SUCCESS without tool messages still works normally", () => {
    let state = sendStart(initialChatState, "Hello");
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "Hi there!",
    });
    state = chatReducer(state, {
      type: "SEND_SUCCESS",
      userContent: "Hello",
      assistantContent: "Hi there!",
    });

    expect(state.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ]);
  });

  it("messages array preserves correct order: user → assistant+tool_calls → tool → assistant", () => {
    let state = sendStart(initialChatState, "Search deceptive alignment");

    state = chatReducer(state, {
      type: "SEND_SUCCESS",
      userContent: "Search deceptive alignment",
      assistantContent: "Here are the results.",
      toolMessages: [
        {
          role: "assistant" as const,
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
          role: "tool" as const,
          tool_call_id: "call_1",
          name: "search_alignment_research",
          content: "Results...",
        },
      ],
    });

    const roles = state.messages.map((m) => m.role);
    // Expected order: user, assistant (with tool_calls), tool, assistant (final response)
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

    // Also verify CONTENT at each position (not just roles)
    expect(state.messages[0]).toEqual(
      expect.objectContaining({ role: "user", content: "Search deceptive alignment" }),
    );
    // Assistant with tool_calls has empty content
    expect(state.messages[1]).toEqual(
      expect.objectContaining({ role: "assistant", content: "" }),
    );
    if (state.messages[1].role !== "tool") {
      expect((state.messages[1] as { tool_calls?: unknown[] }).tool_calls).toBeDefined();
    }
    // Tool result
    expect(state.messages[2]).toEqual(
      expect.objectContaining({ role: "tool", content: "Results..." }),
    );
    // Final assistant response
    expect(state.messages[3]).toEqual(
      expect.objectContaining({ role: "assistant", content: "Here are the results." }),
    );
  });
});

// ---------------------------------------------------------------------------
// Bug #1 & #2: Streaming content split point for tool call positioning
// ---------------------------------------------------------------------------

describe("chatReducer — streaming content split point (Bug #1 & #2)", () => {
  it("TOOL_CALL should record the current streamingContent length as split point", () => {
    let state = sendStart(initialChatState);

    // Stream pre-tool text
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "Let me search for that.",
    });

    // Tool call starts — should snapshot the current content length
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });

    // The reducer should track where the tool call was inserted
    // so the UI can split: streamingContent[0..splitPoint] | toolIndicator | streamingContent[splitPoint..]
    expect(state.toolCallInsertPoint).toBe("Let me search for that.".length);
  });

  it("split point allows separating pre-tool and post-tool content", () => {
    let state = sendStart(initialChatState);

    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "Pre-tool text.",
    });
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });

    const splitPoint = state.toolCallInsertPoint;
    expect(splitPoint).toBeDefined();

    // Post-tool text arrives
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "Pre-tool text.\n\nPost-tool text.",
    });

    // The split point should still work to divide the content
    const preToolText = state.streamingContent.slice(0, splitPoint!);
    const postToolText = state.streamingContent.slice(splitPoint!);
    expect(preToolText).toBe("Pre-tool text.");
    expect(postToolText).toBe("\n\nPost-tool text.");
  });

  it("split point is cleared on SEND_SUCCESS", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "text",
    });
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });
    state = chatReducer(state, {
      type: "SEND_SUCCESS",
      userContent: "q",
      assistantContent: "text",
    });

    expect(state.toolCallInsertPoint).toBeNull();
  });

  it("split point is cleared on SEND_FAILURE", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "text",
    });
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });
    state = chatReducer(state, { type: "SEND_FAILURE" });

    expect(state.toolCallInsertPoint).toBeNull();
  });

  it("SEND_START resets split point", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });

    // New message send should reset
    state = sendStart(state, "new message");
    expect(state.toolCallInsertPoint).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("chatReducer — edge cases", () => {
  it("LOAD_HISTORY resets all streaming state", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "STREAM_CHUNK",
      accumulated: "partial",
    });
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "calling",
    });

    state = chatReducer(state, {
      type: "LOAD_HISTORY",
      messages: [{ role: "user" as const, content: "old message" }],
    });

    expect(state.streamingContent).toBe("");
    expect(state.isLoading).toBe(false);
    // LOAD_HISTORY doesn't currently clear activeToolCall — this is a bug.
    // Once fixed, activeToolCall should be null after loading history.
    expect(state.activeToolCall).toBeNull();
  });

  it("empty content SEND_START creates no pending message", () => {
    const state = chatReducer(initialChatState, {
      type: "SEND_START",
      content: "",
      sectionIndex: 0,
      segmentIndex: 0,
      source: "inline",
    });

    expect(state.pendingMessage).toBeNull();
    expect(state.isLoading).toBe(true);
  });

  it("SEND_SUCCESS with empty userContent omits user message", () => {
    let state = sendStart(initialChatState, "");
    state = chatReducer(state, {
      type: "SEND_SUCCESS",
      userContent: "",
      assistantContent: "Auto-response",
    });

    // Should only have assistant message, no empty user message
    expect(state.messages).toEqual([
      { role: "assistant", content: "Auto-response" },
    ]);
  });

  it("CLEAR_PENDING clears pending message and sendSource", () => {
    let state = sendStart(initialChatState, "retry me");
    expect(state.pendingMessage).not.toBeNull();
    expect(state.sendSource).toBe("inline");

    state = chatReducer(state, { type: "CLEAR_PENDING" });
    expect(state.pendingMessage).toBeNull();
    expect(state.sendSource).toBeNull();
    // isLoading should NOT be cleared by CLEAR_PENDING (retry will re-send)
    expect(state.isLoading).toBe(true);
  });

  it("SEND_FAILURE clears sendSource", () => {
    let state = sendStart(initialChatState, "will fail");
    expect(state.sendSource).toBe("inline");

    state = chatReducer(state, { type: "SEND_FAILURE" });
    expect(state.sendSource).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple sequential tool calls
// ---------------------------------------------------------------------------

describe("chatReducer — multiple sequential tool calls", () => {
  it("second TOOL_CALL overwrites the first (current behavior)", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "tool_a",
      state: "calling",
    });
    expect(state.activeToolCall?.name).toBe("tool_a");

    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "tool_b",
      state: "calling",
    });
    // Second tool call replaces the first
    expect(state.activeToolCall?.name).toBe("tool_b");
  });

  it("TOOL_CALL error state is tracked", () => {
    let state = sendStart(initialChatState);
    state = chatReducer(state, {
      type: "TOOL_CALL",
      name: "search_alignment_research",
      state: "error",
    });

    expect(state.activeToolCall).toEqual({
      name: "search_alignment_research",
      state: "error",
    });
  });
});
