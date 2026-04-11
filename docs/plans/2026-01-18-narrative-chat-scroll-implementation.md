# Narrative Chat Scroll Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance NarrativeChatSection with user-message-at-top scroll behavior, scroll-to-bottom button, and system message rendering.

**Architecture:** Two-wrapper layout splits messages into "previous" and "current exchange" containers. The current exchange wrapper has min-h-full with a flex-grow spacer, enabling CSS-only dynamic spacing. Scroll position tracking shows/hides a floating scroll-to-bottom button.

**Tech Stack:** React, Tailwind CSS, TypeScript

---

## Task 1: Add New State Variables

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx:33-34`

**Step 1: Add state for exchange split and scroll button**

After the existing state declarations (line 34), add:

```tsx
const [currentExchangeStartIndex, setCurrentExchangeStartIndex] = useState(0);
const [showScrollButton, setShowScrollButton] = useState(false);
```

**Step 2: Add ref for current exchange wrapper**

After the existing refs (around line 39), add:

```tsx
const currentExchangeRef = useRef<HTMLDivElement>(null);
```

**Step 3: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: No TypeScript errors related to new state/refs

---

## Task 2: Update handleSubmit to Set Split Index

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx:328-335`

**Step 1: Update handleSubmit function**

Replace the current `handleSubmit` function:

```tsx
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (input.trim() && !isLoading) {
    // Set split point before sending - current messages become "previous"
    setCurrentExchangeStartIndex(messages.length);
    setShowScrollButton(false); // Reset scroll button when sending new message
    setHasInteracted(true);
    onSendMessage(input.trim());
    setInput("");
  }
};
```

**Step 2: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: Build succeeds

---

## Task 3: Replace Auto-Scroll Logic with Scroll-to-Top

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx:68-85`

**Step 1: Replace the existing useLayoutEffect for auto-scroll**

Remove the current auto-scroll logic (lines 68-85) and replace with:

```tsx
// Scroll user's new message to top when they send
useLayoutEffect(() => {
  if (pendingMessage && currentExchangeRef.current) {
    currentExchangeRef.current.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}, [pendingMessage]);
```

**Step 2: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: Build succeeds

---

## Task 4: Add Scroll Position Tracking

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx`

**Step 1: Add scroll handler function**

Add this function after the other handlers (around line 340):

```tsx
const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
  const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  const isAtBottom = distanceFromBottom < 50;
  setShowScrollButton(!isAtBottom);
};

const scrollToBottom = () => {
  scrollContainerRef.current?.scrollTo({
    top: scrollContainerRef.current.scrollHeight,
    behavior: "smooth",
  });
};
```

**Step 2: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: Build succeeds

---

## Task 5: Add StageIcon Import

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx:1-8`

**Step 1: Add import for StageIcon**

Add this import after the existing imports (around line 7):

```tsx
import { StageIcon } from "@/components/unified-lesson/StageProgressBar";
```

**Step 2: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: Build succeeds

---

## Task 6: Remove System Message Filter

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx:344-345`

**Step 1: Remove the visibleMessages filter**

Find and delete this line (around line 345):

```tsx
// DELETE THIS LINE:
const visibleMessages = messages.filter((m) => m.role !== "system");
```

We will use `messages` directly with the two-wrapper split in the next task.

**Step 2: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: May have errors due to `visibleMessages` reference - that's expected, we fix it in Task 7

---

## Task 7: Restructure JSX with Two Wrappers

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx:357-446`

**Step 1: Replace the messages area JSX**

Replace the entire messages area (the `<div ref={scrollContainerRef} ...>` section, approximately lines 358-446) with the new two-wrapper structure:

```tsx
{/* Messages area */}
<div
  ref={scrollContainerRef}
  className="flex-1 overflow-y-auto p-4"
  onScroll={handleScroll}
>
  {hasInteracted ? (
    <div className="max-w-[620px] mx-auto">
      {/* Previous messages - natural height */}
      {currentExchangeStartIndex > 0 && (
        <div className="space-y-3 pb-3">
          {messages.slice(0, currentExchangeStartIndex).map((msg, i) =>
            msg.role === "system" ? (
              <div key={i} className="flex justify-center my-3">
                <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                  {msg.icon && <StageIcon type={msg.icon} small />}
                  {msg.content}
                </span>
              </div>
            ) : (
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
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            )
          )}
        </div>
      )}

      {/* Current exchange - min height with spacer */}
      <div
        ref={currentExchangeRef}
        className="min-h-full flex flex-col"
        style={{ scrollMarginTop: "24px" }}
      >
        <div className="space-y-3">
          {/* Current exchange messages */}
          {messages.slice(currentExchangeStartIndex).map((msg, i) =>
            msg.role === "system" ? (
              <div key={`current-${i}`} className="flex justify-center my-3">
                <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                  {msg.icon && <StageIcon type={msg.icon} small />}
                  {msg.content}
                </span>
              </div>
            ) : (
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
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            )
          )}

          {/* Pending user message */}
          {pendingMessage && (
            <div
              className={`p-3 rounded-lg ml-8 ${
                pendingMessage.status === "failed"
                  ? "bg-red-50 border border-red-200"
                  : "bg-gray-100"
              }`}
            >
              <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
                <span>You</span>
                {pendingMessage.status === "sending" && (
                  <span className="text-gray-400">Sending...</span>
                )}
                {pendingMessage.status === "failed" && onRetryMessage && (
                  <button
                    onClick={onRetryMessage}
                    className="text-red-600 hover:text-red-700 text-xs focus:outline-none focus:underline"
                  >
                    Failed - Click to retry
                  </button>
                )}
              </div>
              <div className="whitespace-pre-wrap text-gray-800">
                {pendingMessage.content}
              </div>
            </div>
          )}

          {/* Streaming response */}
          {isLoading && streamingContent && (
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">Tutor</div>
              <div className="whitespace-pre-wrap">{streamingContent}</div>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingContent && (
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">Tutor</div>
              <div className="text-gray-800">Thinking...</div>
            </div>
          )}
        </div>

        {/* Spacer - fills remaining viewport space */}
        <div className="flex-grow" />
      </div>
    </div>
  ) : (
    // Empty state before first interaction
    <div className="h-full flex flex-col items-center justify-center text-gray-400">
      <svg
        className="w-12 h-12 mb-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <p className="text-sm">Send a message to start the discussion</p>
    </div>
  )}
</div>
```

**Step 2: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: Build succeeds

---

## Task 8: Add Scroll-to-Bottom Button

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx`

**Step 1: Add the scroll button after the scroll container**

Add this JSX right after the closing `</div>` of the scroll container (before the error message section):

```tsx
{/* Scroll to bottom button */}
{showScrollButton && hasInteracted && (
  <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
    <button
      onClick={scrollToBottom}
      className="bg-white border border-gray-300 rounded-full p-2 shadow-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      aria-label="Scroll to bottom"
    >
      <svg
        className="w-5 h-5 text-gray-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 14l-7 7m0 0l-7-7m7 7V3"
        />
      </svg>
    </button>
  </div>
)}
```

**Step 2: Add relative positioning to parent container**

Find the outer container div (around line 349) and add `relative` to its className:

```tsx
<div
  ref={containerRef}
  className="border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col scroll-mb-8 relative"
  // ... rest of props
>
```

**Step 3: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: Build succeeds

---

## Task 9: Remove Unused Ref

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx`

**Step 1: Remove messagesEndRef**

Find and delete:
```tsx
const messagesEndRef = useRef<HTMLDivElement>(null);
```

And delete any JSX that uses it:
```tsx
<div ref={messagesEndRef} />
```

**Step 2: Verify no syntax errors**

Run: `cd web_frontend_next && npm run build 2>&1 | head -30`
Expected: Build succeeds

---

## Task 10: Manual Testing

**Step 1: Start the dev server**

Run: `cd /home/penguin/code-in-WSL/ai-safety-course-platform && python main.py --dev`

**Step 2: Test scroll behavior**

1. Navigate to a narrative lesson
2. Send a message
3. Verify: User message appears near top (not bottom) with padding
4. Verify: AI response streams below the user message
5. Verify: No auto-scrolling during streaming

**Step 3: Test scroll-to-bottom button**

1. Send several messages to create scroll history
2. Scroll up manually
3. Verify: Scroll-to-bottom button appears
4. Click the button
5. Verify: Scrolls smoothly to bottom
6. Verify: Button disappears when at bottom

**Step 4: Test system messages**

1. If there are system messages in the conversation
2. Verify: They appear as centered badges with icons (if applicable)

---

## Task 11: Commit Changes

**Step 1: Stage and commit**

Run:
```bash
jj describe -m "feat: enhance NarrativeChatSection with scroll-to-top and scroll button

- User message scrolls to top when sent (not bottom)
- Two-wrapper layout enables CSS-only dynamic spacing
- Scroll-to-bottom button appears when scrolled up
- System messages rendered as centered badges with icons
- No auto-scroll during AI streaming"
```

**Step 2: Verify commit**

Run: `jj log -n 3`
Expected: Shows the new commit with the description
