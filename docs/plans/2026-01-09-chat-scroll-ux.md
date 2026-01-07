# Chat Scroll UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve chat scroll behavior to match ChatGPT/Claude UX: scroll once when user sends message, no scrolling during AI streaming.

**Architecture:** Modify the scroll useEffect in ChatPanel to only trigger on user message send (pendingMessage), not on streaming content updates. This prevents disruptive auto-scrolling while the AI responds.

**Tech Stack:** React, TypeScript

---

## Current Behavior (Problem)

In `web_frontend/src/components/unified-lesson/ChatPanel.tsx`, lines 70-72:

```tsx
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [messages, streamingContent, pendingMessage]);
```

This scrolls on EVERY streaming chunk, which:
- Disrupts reading during AI response
- Causes visible jitter (especially with DevTools open)
- Doesn't match user expectations from ChatGPT/Claude

## Target Behavior

1. **User sends message:** Scroll so their message is visible
2. **AI streaming:** No scrolling - user reads at their own pace
3. **AI finishes:** No scrolling - user continues where they left off

---

### Task 1: Remove streaming from scroll dependencies

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ChatPanel.tsx:70-72`

**Step 1: Update the scroll useEffect**

Change from:
```tsx
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [messages, streamingContent, pendingMessage]);
```

To:
```tsx
// Scroll only when user sends a message (pendingMessage appears)
// Don't scroll during streaming - let user read at their own pace
useEffect(() => {
  if (pendingMessage) {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }
}, [pendingMessage]);
```

**Step 2: Verify the change compiles**

Run: `cd web_frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Manual test**

1. Open http://localhost:5173/lesson/intelligence-feedback-loop
2. Send a message
3. Verify: Chat scrolls to show your message
4. Verify: During AI streaming, no scrolling occurs
5. Verify: After AI finishes, no scrolling occurs

**Step 4: Commit**

```bash
jj describe -m "feat: improve chat scroll UX - scroll on send only, not during streaming"
```

---

## Summary

This is a single-task plan because the fix is minimal:
- One line change to useEffect dependencies
- One condition to only scroll when pendingMessage exists

The key insight: we only need to scroll when the USER takes action (sends a message). The AI response can grow freely without yanking the user's view around.
