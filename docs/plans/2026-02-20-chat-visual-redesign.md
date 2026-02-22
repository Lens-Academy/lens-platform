# Chat Visual Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restyle the chat component with a quieter container border and asymmetric message styling (user bubbles, bare AI text).

**Architecture:** Single-file CSS class changes in `NarrativeChatSection.tsx`. Messages are rendered in two places (previous messages and current exchange) with identical markup — both need the same updates. No structural or behavioral changes.

**Tech Stack:** Tailwind CSS v4 classes, React/TSX

---

### Task 1: Quiet the container border

**Files:**
- Modify: `web_frontend/src/components/module/NarrativeChatSection.tsx:473`

**Step 1: Update container classes**

Line 473 — change:
```tsx
className="max-w-content mx-auto border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col scroll-mb-8 relative"
```
to:
```tsx
className="max-w-content mx-auto border border-gray-100 rounded-lg bg-white flex flex-col scroll-mb-8 relative"
```

(Removed `shadow-sm`, changed `border-gray-200` → `border-gray-100`)

**Step 2: Lighten input bar border**

Line 706 — change:
```tsx
className="flex gap-2 p-4 border-t border-gray-200 items-end"
```
to:
```tsx
className="flex gap-2 p-4 border-t border-gray-100 items-end"
```

**Step 3: Verify visually**

Run: `npm run dev --prefix web_frontend -- --host`
Open: `http://dev.vps:3100/course/intro-to-ai-safety/module/what-is-ai`
Confirm: border is lighter, no shadow

**Step 4: Commit**

```
jj describe -m "style: quiet chat container border"
jj new
```

---

### Task 2: Restyle previous messages section

**Files:**
- Modify: `web_frontend/src/components/module/NarrativeChatSection.tsx:492-527`

This is the `messages.slice(0, currentExchangeStartIndex).map(...)` block.

**Step 1: Update assistant message styling**

Change assistant messages from a blue bubble to bare text. Lines 501-526 — replace the message `div` for non-system messages:

```tsx
// FROM (lines 501-526):
<div
  key={i}
  className={`p-3 rounded-lg ${
    msg.role === "assistant"
      ? "bg-blue-50 text-gray-800"
      : "bg-gray-100 text-gray-800 ml-8"
  }`}
>
  <div className="text-xs text-gray-500 mb-1">
    {msg.role === "assistant" ? "Tutor" : "You"}
  </div>
  <div
    className={
      msg.role === "assistant"
        ? ""
        : "whitespace-pre-wrap"
    }
  >
    {msg.role === "assistant" ? (
      <ChatMarkdown>{msg.content}</ChatMarkdown>
    ) : (
      msg.content
    )}
  </div>
</div>
```

```tsx
// TO:
msg.role === "assistant" ? (
  <div key={i} className="text-gray-800">
    <div className="text-xs text-gray-500 mb-1">
      Tutor
    </div>
    <ChatMarkdown>{msg.content}</ChatMarkdown>
  </div>
) : (
  <div
    key={i}
    className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
  >
    <div className="whitespace-pre-wrap">
      {msg.content}
    </div>
  </div>
)
```

Key changes:
- Assistant: removed `p-3 rounded-lg bg-blue-50`, now bare text on white
- User: added `ml-auto max-w-[80%]`, changed `rounded-lg` → `rounded-2xl`, removed "You" label

**Step 2: Verify visually**

Reload chat. Previous messages should show user messages as right-aligned bubbles, AI text as bare.

**Step 3: Commit**

```
jj describe -m "style: asymmetric message styling for previous messages"
jj new
```

---

### Task 3: Restyle current exchange messages

**Files:**
- Modify: `web_frontend/src/components/module/NarrativeChatSection.tsx:545-583`

Same changes as Task 2, applied to `messages.slice(currentExchangeStartIndex).map(...)`.

**Step 1: Update current exchange message rendering**

```tsx
// FROM (lines 556-582):
<div
  key={`current-${i}`}
  className={`p-3 rounded-lg ${
    msg.role === "assistant"
      ? "bg-blue-50 text-gray-800"
      : "bg-gray-100 text-gray-800 ml-8"
  }`}
>
  <div className="text-xs text-gray-500 mb-1">
    {msg.role === "assistant" ? "Tutor" : "You"}
  </div>
  <div
    className={
      msg.role === "assistant"
        ? ""
        : "whitespace-pre-wrap"
    }
  >
    {msg.role === "assistant" ? (
      <ChatMarkdown>{msg.content}</ChatMarkdown>
    ) : (
      msg.content
    )}
  </div>
</div>
```

```tsx
// TO:
msg.role === "assistant" ? (
  <div key={`current-${i}`} className="text-gray-800">
    <div className="text-xs text-gray-500 mb-1">
      Tutor
    </div>
    <ChatMarkdown>{msg.content}</ChatMarkdown>
  </div>
) : (
  <div
    key={`current-${i}`}
    className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
  >
    <div className="whitespace-pre-wrap">
      {msg.content}
    </div>
  </div>
)
```

**Step 2: Commit**

```
jj describe -m "style: asymmetric message styling for current exchange"
jj new
```

---

### Task 4: Restyle pending message, streaming, and loading states

**Files:**
- Modify: `web_frontend/src/components/module/NarrativeChatSection.tsx:586-631`

**Step 1: Update pending user message (lines 586-613)**

```tsx
// FROM:
<div
  className={`p-3 rounded-lg ml-8 ${
    pendingMessage.status === "failed"
      ? "bg-red-50 border border-red-200"
      : "bg-gray-100"
  }`}
>
  <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
    <span>You</span>
    ...
  </div>
  <div className="whitespace-pre-wrap text-gray-800">
    {pendingMessage.content}
  </div>
</div>
```

```tsx
// TO:
<div
  className={`ml-auto max-w-[80%] p-3 rounded-2xl ${
    pendingMessage.status === "failed"
      ? "bg-red-50 border border-red-200"
      : "bg-gray-100"
  }`}
>
  <div className="flex items-center justify-between mb-1">
    {pendingMessage.status === "sending" && (
      <span className="text-xs text-gray-400 ml-auto">Sending...</span>
    )}
    {pendingMessage.status === "failed" &&
      onRetryMessage && (
        <button
          onClick={onRetryMessage}
          className="text-red-600 hover:text-red-700 text-xs focus:outline-none focus:underline ml-auto"
        >
          Failed - Click to retry
        </button>
      )}
  </div>
  <div className="whitespace-pre-wrap text-gray-800">
    {pendingMessage.content}
  </div>
</div>
```

Key changes: `ml-8` → `ml-auto max-w-[80%]`, `rounded-lg` → `rounded-2xl`, removed "You" label, kept status indicators right-aligned.

**Step 2: Update streaming response (lines 616-623)**

```tsx
// FROM:
<div className="bg-blue-50 p-3 rounded-lg">
  <div className="text-xs text-gray-500 mb-1">Tutor</div>
  <div>
    <ChatMarkdown>{streamingContent}</ChatMarkdown>
  </div>
</div>
```

```tsx
// TO:
<div className="text-gray-800">
  <div className="text-xs text-gray-500 mb-1">Tutor</div>
  <ChatMarkdown>{streamingContent}</ChatMarkdown>
</div>
```

**Step 3: Update loading indicator (lines 626-631)**

```tsx
// FROM:
<div className="bg-blue-50 p-3 rounded-lg">
  <div className="text-xs text-gray-500 mb-1">Tutor</div>
  <div className="text-gray-800">Thinking...</div>
</div>
```

```tsx
// TO:
<div className="text-gray-800">
  <div className="text-xs text-gray-500 mb-1">Tutor</div>
  <div>Thinking...</div>
</div>
```

**Step 4: Verify visually**

Send a message. Confirm:
- User pending message appears as right-aligned bubble
- Streaming AI response has no background
- "Thinking..." has no background

**Step 5: Commit**

```
jj describe -m "style: restyle pending, streaming, and loading states"
jj new
```

---

### Task 5: Lint check and final verification

**Step 1: Run lint**

```bash
cd web_frontend && npm run lint
```

**Step 2: Run build**

```bash
npm run build
```

**Step 3: Squash into single commit (optional)**

If desired, squash all commits into one:
```
jj squash --from <first-change-id> --into <last-change-id>
jj describe -m "style: chat visual redesign - quieter border, asymmetric messages"
```
