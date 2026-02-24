import { describe, test, expect } from "vitest";
import {
  chatViewReducer,
  initialChatViewState,
  type ChatViewState,
} from "../chatViewReducer";

describe("chatViewReducer", () => {
  test("initial state has all defaults", () => {
    expect(initialChatViewState).toEqual({
      hasInteracted: false,
      hasUserSent: false,
      recentMessagesStartIdx: 0,
      minHeightWrapperStartIdx: 0,
      isExpanded: false,
      userSentFollowup: false,
    });
  });

  test("ACTIVATE sets hasInteracted", () => {
    const state = chatViewReducer(initialChatViewState, {
      type: "ACTIVATE",
      messagesLength: 0,
    });
    expect(state).toEqual({
      hasInteracted: true,
      hasUserSent: false,
      recentMessagesStartIdx: 0,
      minHeightWrapperStartIdx: 0,
      isExpanded: false,
      userSentFollowup: false,
    });
  });

  test("ACTIVATE is idempotent", () => {
    const once = chatViewReducer(initialChatViewState, {
      type: "ACTIVATE",
      messagesLength: 0,
    });
    const twice = chatViewReducer(once, {
      type: "ACTIVATE",
      messagesLength: 5,
    });
    expect(twice).toBe(once); // same reference — no new object, messagesLength ignored
  });

  test("SEND_MESSAGE first send with no history hides nothing", () => {
    const state = chatViewReducer(initialChatViewState, {
      type: "SEND_MESSAGE",
      messagesLength: 0,
      hasScrollToResponse: false,
    });
    expect(state).toEqual({
      hasInteracted: true,
      hasUserSent: true,
      recentMessagesStartIdx: 0,
      minHeightWrapperStartIdx: 0,
      isExpanded: false,
      userSentFollowup: false,
    });
  });

  test("SEND_MESSAGE first send with history hides all old messages", () => {
    const state = chatViewReducer(initialChatViewState, {
      type: "SEND_MESSAGE",
      messagesLength: 10,
      hasScrollToResponse: false,
    });
    expect(state).toEqual({
      hasInteracted: true,
      hasUserSent: true,
      recentMessagesStartIdx: 10,
      minHeightWrapperStartIdx: 10,
      isExpanded: false,
      userSentFollowup: false,
    });
  });

  test("SEND_MESSAGE second send with few messages holds ratchet", () => {
    // First send sets idx=10
    const afterFirst = chatViewReducer(initialChatViewState, {
      type: "SEND_MESSAGE",
      messagesLength: 10,
      hasScrollToResponse: false,
    });
    // Second send: messagesLength=12, Math.max(0, 12-6)=6, but ratchet holds at 10
    const afterSecond = chatViewReducer(afterFirst, {
      type: "SEND_MESSAGE",
      messagesLength: 12,
      hasScrollToResponse: false,
    });
    expect(afterSecond).toEqual({
      hasInteracted: true,
      hasUserSent: true,
      recentMessagesStartIdx: 10,
      minHeightWrapperStartIdx: 12,
      isExpanded: false,
      userSentFollowup: false,
    });
  });

  test("SEND_MESSAGE second send with many messages advances idx", () => {
    // First send sets idx=10
    const afterFirst = chatViewReducer(initialChatViewState, {
      type: "SEND_MESSAGE",
      messagesLength: 10,
      hasScrollToResponse: false,
    });
    // Second send: messagesLength=20, Math.max(0, 20-6)=14 > 10, advances
    const afterSecond = chatViewReducer(afterFirst, {
      type: "SEND_MESSAGE",
      messagesLength: 20,
      hasScrollToResponse: false,
    });
    expect(afterSecond).toEqual({
      hasInteracted: true,
      hasUserSent: true,
      recentMessagesStartIdx: 14,
      minHeightWrapperStartIdx: 20,
      isExpanded: false,
      userSentFollowup: false,
    });
  });

  test("SEND_MESSAGE ratchet never goes backward", () => {
    let state: ChatViewState = initialChatViewState;

    // First send: idx = 10 (first send hides all)
    state = chatViewReducer(state, {
      type: "SEND_MESSAGE",
      messagesLength: 10,
      hasScrollToResponse: false,
    });
    expect(state.recentMessagesStartIdx).toBe(10);

    // Second send: Math.max(0, 20-6)=14 > 10 => advances to 14
    state = chatViewReducer(state, {
      type: "SEND_MESSAGE",
      messagesLength: 20,
      hasScrollToResponse: false,
    });
    expect(state.recentMessagesStartIdx).toBe(14);

    // Third send: Math.max(0, 18-6)=12 < 14 => ratchet holds at 14
    state = chatViewReducer(state, {
      type: "SEND_MESSAGE",
      messagesLength: 18,
      hasScrollToResponse: false,
    });
    expect(state.recentMessagesStartIdx).toBe(14);

    // Fourth send: Math.max(0, 25-6)=19 > 14 => advances to 19
    state = chatViewReducer(state, {
      type: "SEND_MESSAGE",
      messagesLength: 25,
      hasScrollToResponse: false,
    });
    expect(state.recentMessagesStartIdx).toBe(19);
  });

  test("SEND_MESSAGE with hasScrollToResponse sets userSentFollowup", () => {
    const state = chatViewReducer(initialChatViewState, {
      type: "SEND_MESSAGE",
      messagesLength: 5,
      hasScrollToResponse: true,
    });
    expect(state.userSentFollowup).toBe(true);

    // Once true, stays true even without hasScrollToResponse
    const next = chatViewReducer(state, {
      type: "SEND_MESSAGE",
      messagesLength: 8,
      hasScrollToResponse: false,
    });
    expect(next.userSentFollowup).toBe(true);
  });

  test("ACTIVATE with shared history hides old messages", () => {
    // Bug: new instance activated while shared messages[] has 10 messages from other instances.
    // After ACTIVATE, hasInteracted=true but recentMessagesStartIdx stayed 0,
    // causing messages.slice(0) to show all old messages.
    const state = chatViewReducer(initialChatViewState, {
      type: "ACTIVATE",
      messagesLength: 10,
    });
    expect(state).toEqual({
      hasInteracted: true,
      hasUserSent: false,
      recentMessagesStartIdx: 10,
      minHeightWrapperStartIdx: 10,
      isExpanded: false,
      userSentFollowup: false,
    });
  });

  test("ACTIVATE with shared history then SEND_MESSAGE preserves ratchet", () => {
    // Activate hides 10 shared messages
    const activated = chatViewReducer(initialChatViewState, {
      type: "ACTIVATE",
      messagesLength: 10,
    });
    expect(activated.recentMessagesStartIdx).toBe(10);

    // First send (messagesLength=10, same count) — ratchet holds at 10
    const afterSend = chatViewReducer(activated, {
      type: "SEND_MESSAGE",
      messagesLength: 10,
      hasScrollToResponse: false,
    });
    expect(afterSend.recentMessagesStartIdx).toBe(10);
  });

  test("EXPAND sets isExpanded true", () => {
    const state = chatViewReducer(initialChatViewState, { type: "EXPAND" });
    expect(state).toEqual({
      ...initialChatViewState,
      isExpanded: true,
    });
  });

  test("COLLAPSE sets isExpanded false", () => {
    const expanded = chatViewReducer(initialChatViewState, { type: "EXPAND" });
    const collapsed = chatViewReducer(expanded, { type: "COLLAPSE" });
    expect(collapsed).toEqual({
      ...initialChatViewState,
      isExpanded: false,
    });
  });
});
