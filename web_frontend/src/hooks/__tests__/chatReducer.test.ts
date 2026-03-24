/**
 * Tests for the chatReducer — unified streaming architecture.
 *
 * The reducer builds the messages[] array incrementally during streaming.
 * No separate streaming state — messages are in the same format as DB history.
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
// SEND_START
// ---------------------------------------------------------------------------

describe("chatReducer — SEND_START", () => {
  it("appends user message and empty assistant message", () => {
    const state = sendStart(initialChatState, "Hello tutor");

    // Should have user msg + empty assistant msg
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual({ role: "user", content: "Hello tutor" });
    expect(state.messages[1]).toEqual(
      expect.objectContaining({ role: "assistant", content: "" }),
    );
  });

  it("sets isLoading, does not set pendingMessage (user msg is in messages[])", () => {
    const state = sendStart(initialChatState, "Hello");
    expect(state.isLoading).toBe(true);
    // pendingMessage is NOT set — the user message is already in messages[]
    // pendingMessage is only used for SEND_FAILURE "Failed to send" indicator
    expect(state.pendingMessage).toBeNull();
  });

  it("empty content creates no pending message but still appends messages", () => {
    const state = sendStart(initialChatState, "");
    expect(state.pendingMessage).toBeNull();
    expect(state.isLoading).toBe(true);
    // Still appends the assistant message (for the response)
    expect(state.messages).toHaveLength(1); // no user msg for empty content, just assistant
  });

  it("rejects if already loading", () => {
    const state = sendStart(initialChatState);
    const state2 = sendStart(state, "another");
    // Should be unchanged
    expect(state2).toBe(state);
  });

  it("sets streamingMessageIndex (internal)", () => {
    const state = sendStart(initialChatState, "Hello");
    // streamingMessageIndex should point to the assistant message
    expect(state.streamingMessageIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// STREAM_TEXT
// ---------------------------------------------------------------------------

describe("chatReducer — STREAM_TEXT", () => {
  it("appends text to the streaming assistant message", () => {
    let state = sendStart(initialChatState, "Hello");

    state = chatReducer(state, { type: "STREAM_TEXT", text: "Hi " });
    expect(state.messages[state.streamingMessageIndex!].content).toBe("Hi ");

    state = chatReducer(state, { type: "STREAM_TEXT", text: "there!" });
    expect(state.messages[state.streamingMessageIndex!].content).toBe("Hi there!");
  });

  it("does nothing if not streaming", () => {
    const state = chatReducer(initialChatState, { type: "STREAM_TEXT", text: "orphan" });
    expect(state).toBe(initialChatState);
  });
});

// ---------------------------------------------------------------------------
// TOOL_CALL_START
// ---------------------------------------------------------------------------

describe("chatReducer — TOOL_CALL_START", () => {
  it("freezes current assistant, appends tool placeholder + new assistant", () => {
    let state = sendStart(initialChatState, "Search for X");

    // Stream some pre-tool text
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Let me search." });

    // Tool call starts
    state = chatReducer(state, {
      type: "TOOL_CALL_START",
      name: "search_alignment_research",
    });

    // Messages: user, assistant("Let me search." + tool_calls), tool(placeholder), assistant("")
    expect(state.messages).toHaveLength(4);

    // First assistant is frozen with tool_calls
    expect(state.messages[1].content).toBe("Let me search.");
    expect(state.messages[1]).toHaveProperty("tool_calls");

    // Tool placeholder
    expect(state.messages[2].role).toBe("tool");
    if (state.messages[2].role === "tool") {
      expect(state.messages[2].name).toBe("search_alignment_research");
      expect(state.messages[2].content).toBe(""); // empty = "calling"
    }

    // New streaming assistant
    expect(state.messages[3]).toEqual(
      expect.objectContaining({ role: "assistant", content: "" }),
    );
    expect(state.streamingMessageIndex).toBe(3);
  });

  it("works with no pre-tool text", () => {
    let state = sendStart(initialChatState, "Search");

    state = chatReducer(state, {
      type: "TOOL_CALL_START",
      name: "search_alignment_research",
    });

    // First assistant has empty content + tool_calls
    expect(state.messages[1].content).toBe("");
    expect(state.messages[1]).toHaveProperty("tool_calls");
  });
});

// ---------------------------------------------------------------------------
// TOOL_CALL_DONE
// ---------------------------------------------------------------------------

describe("chatReducer — TOOL_CALL_DONE", () => {
  it("fills the tool placeholder with result content", () => {
    let state = sendStart(initialChatState, "Search");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Let me search." });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });

    state = chatReducer(state, {
      type: "TOOL_CALL_DONE",
      name: "search_alignment_research",
      result: "Deceptive alignment refers to...",
    });

    const toolMsg = state.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    if (toolMsg?.role === "tool") {
      expect(toolMsg.content).toBe("Deceptive alignment refers to...");
    }
  });
});

// ---------------------------------------------------------------------------
// SEND_SUCCESS
// ---------------------------------------------------------------------------

describe("chatReducer — SEND_SUCCESS", () => {
  it("clears loading state, keeps messages intact", () => {
    let state = sendStart(initialChatState, "Hello");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Hi there!" });
    state = chatReducer(state, { type: "SEND_SUCCESS" });

    expect(state.isLoading).toBe(false);
    expect(state.streamingMessageIndex).toBeNull();
    expect(state.pendingMessage).toBeNull();
    expect(state.sendSource).toBeNull();

    // Messages unchanged
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(state.messages[1]).toEqual(
      expect.objectContaining({ role: "assistant", content: "Hi there!" }),
    );
  });

  it("removes trailing empty assistant message", () => {
    let state = sendStart(initialChatState, "Search");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Let me search." });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "Results" });
    // At this point: user, assistant+tc, tool(result), assistant("")
    // The trailing empty assistant should be removed on SEND_SUCCESS

    state = chatReducer(state, { type: "SEND_SUCCESS" });

    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.role).toBe("tool"); // trailing empty assistant removed
  });

  it("keeps trailing assistant if it has content", () => {
    let state = sendStart(initialChatState, "Search");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Let me search." });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "Results" });
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Here's what I found." });

    state = chatReducer(state, { type: "SEND_SUCCESS" });

    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.content).toBe("Here's what I found.");
  });
});

// ---------------------------------------------------------------------------
// Full streaming lifecycle
// ---------------------------------------------------------------------------

describe("chatReducer — full streaming lifecycle", () => {
  it("text only: simple question and answer", () => {
    let state = sendStart(initialChatState, "What is AI safety?");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "AI safety is..." });
    state = chatReducer(state, { type: "SEND_SUCCESS" });

    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state.messages[1].content).toBe("AI safety is...");
    expect(state.isLoading).toBe(false);
  });

  it("text → tool → text: single tool call", () => {
    let state = sendStart(initialChatState, "Search deceptive alignment");

    state = chatReducer(state, { type: "STREAM_TEXT", text: "Let me search." });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "Result A" });
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Here's what I found." });
    state = chatReducer(state, { type: "SEND_SUCCESS" });

    const roles = state.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

    expect(state.messages[1].content).toBe("Let me search.");
    if (state.messages[2].role === "tool") {
      expect(state.messages[2].content).toBe("Result A");
    }
    expect(state.messages[3].content).toBe("Here's what I found.");
  });

  it("text → tool → text → tool → text: two rounds", () => {
    let state = sendStart(initialChatState, "Explain thoroughly");

    // Round 1
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Let me search." });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "Result A" });

    // Round 2
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Let me dig deeper." });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "Result B" });

    // Final text
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Combined findings." });
    state = chatReducer(state, { type: "SEND_SUCCESS" });

    const roles = state.messages.map((m) => m.role);
    expect(roles).toEqual([
      "user", "assistant", "tool", "assistant", "tool", "assistant",
    ]);

    // Verify interleaved content
    expect(state.messages[1].content).toBe("Let me search.");
    expect(state.messages[3].content).toBe("Let me dig deeper.");
    expect(state.messages[5].content).toBe("Combined findings.");
  });

  it("three parallel tool calls in one round", () => {
    let state = sendStart(initialChatState, "Search three topics");

    state = chatReducer(state, { type: "STREAM_TEXT", text: "Searching..." });
    // Three tool calls in sequence (same LLM round)
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "R1" });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "R2" });
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "R3" });

    state = chatReducer(state, { type: "STREAM_TEXT", text: "Here are all results." });
    state = chatReducer(state, { type: "SEND_SUCCESS" });

    const toolMsgs = state.messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(3);

    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.content).toBe("Here are all results.");
  });

  it("tool call with no final text: trailing empty assistant removed", () => {
    let state = sendStart(initialChatState, "Search");
    state = chatReducer(state, { type: "TOOL_CALL_START", name: "search_alignment_research" });
    state = chatReducer(state, { type: "TOOL_CALL_DONE", name: "search_alignment_research", result: "Done" });
    state = chatReducer(state, { type: "SEND_SUCCESS" });

    // user, assistant(empty+tc), tool → no trailing empty assistant
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.role).toBe("tool");
  });
});

// ---------------------------------------------------------------------------
// SEND_FAILURE
// ---------------------------------------------------------------------------

describe("chatReducer — SEND_FAILURE", () => {
  it("marks pending as failed, clears loading, keeps messages", () => {
    let state = sendStart(initialChatState, "Hello");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "partial" });
    state = chatReducer(state, { type: "SEND_FAILURE" });

    expect(state.isLoading).toBe(false);
    expect(state.pendingMessage).toEqual({ content: "Hello", status: "failed" });
    expect(state.streamingMessageIndex).toBeNull();
    // Messages are kept (not removed)
    expect(state.messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SYSTEM_MESSAGE
// ---------------------------------------------------------------------------

describe("chatReducer — SYSTEM_MESSAGE", () => {
  it("inserts system message before the streaming assistant", () => {
    let state = sendStart(initialChatState, "Hello");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Hi" });

    state = chatReducer(state, {
      type: "SYSTEM_MESSAGE",
      content: "Now viewing: Section 2",
    });

    // System msg inserted before the streaming assistant
    // Order: user, system, assistant
    expect(state.messages.map((m) => m.role)).toEqual(["user", "system", "assistant"]);
    expect(state.messages[1].content).toBe("Now viewing: Section 2");
    // streamingMessageIndex should have incremented
    expect(state.streamingMessageIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// LOAD_HISTORY
// ---------------------------------------------------------------------------

describe("chatReducer — LOAD_HISTORY", () => {
  it("replaces messages and clears all state", () => {
    let state = sendStart(initialChatState, "Hello");
    state = chatReducer(state, { type: "STREAM_TEXT", text: "Hi" });

    state = chatReducer(state, {
      type: "LOAD_HISTORY",
      messages: [{ role: "user" as const, content: "old msg" }],
    });

    expect(state.messages).toEqual([{ role: "user", content: "old msg" }]);
    expect(state.isLoading).toBe(false);
    expect(state.streamingMessageIndex).toBeNull();
    expect(state.pendingMessage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CLEAR_PENDING
// ---------------------------------------------------------------------------

describe("chatReducer — CLEAR_PENDING", () => {
  it("clears pending message and sendSource", () => {
    let state = sendStart(initialChatState, "retry me");
    state = chatReducer(state, { type: "CLEAR_PENDING" });
    expect(state.pendingMessage).toBeNull();
    expect(state.sendSource).toBeNull();
  });
});
