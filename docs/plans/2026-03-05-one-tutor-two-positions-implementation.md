# One Tutor, Two Positions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dual chat implementation (ChatSidebar + 733-line NarrativeChatSection) with a single `useTutorChat()` hook and two thin render shells that share `ChatMessageList`/`ChatInputArea`. Add `activeSurface` tracking and segment-transition system messages.

**Architecture:** One `useTutorChat()` hook owns all chat state via a `useReducer` for chat lifecycle (messages, streaming, pending, loading) and `useState` for independent concerns (inputText, sidebar, activeSurface). Two shell components — ChatSidebar and `ChatInlineShell` (replaces NarrativeChatSection) — consume the hook and render using shared `ChatMessageList`/`ChatInputArea`. An `activeSurface` state tracks whether the sidebar or a specific inline section has the input bar, driven by IntersectionObserver.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vite/Vitest

**Design doc:** `docs/plans/2026-03-05-one-tutor-two-positions-design.md`

**Testing approach:** No TDD — this is an extraction refactor. Test-after for the hook's pure computations, migrate existing NarrativeChatSection tests, browser-verify IntersectionObserver behavior.

---

## Task 1: Export `renderMessage` from ChatMessageList

**Files:**
- Modify: `web_frontend/src/components/module/ChatMessageList.tsx:31`

**Step 1:** Add `export` keyword to `renderMessage` function (line 31).

**Step 2:** Verify build: `cd web_frontend && npm run build`

**Step 3:** Commit.

---

## Task 2: Add controlled mode to ChatInputArea

Both sidebar and inline shell need to share `inputText` from the hook. ChatInputArea currently manages its own `input` state — add optional `value`/`onValueChange` props for controlled mode.

**Files:**
- Modify: `web_frontend/src/components/module/ChatInputArea.tsx`

**Step 1:** Add props to the type:

```tsx
value?: string;
onValueChange?: (value: string) => void;
```

**Step 2:** Replace internal state with controlled/uncontrolled pattern. Use a ref to track the latest value (avoids stale closure in async callbacks like voice transcription):

```tsx
const [internalInput, setInternalInput] = useState("");
const input = value ?? internalInput;
const inputRef = useRef(input);
inputRef.current = input;  // always up-to-date

const handleInputChange = (newValue: string) => {
  if (onValueChange) onValueChange(newValue);
  else setInternalInput(newValue);
};
```

Replace all `setInput(...)` calls with `handleInputChange(...)`. **Critical:** the voice transcription callback (line 253) currently does `setInput((prev) => (prev ? \`${prev} ${text}\` : text))` — this functional updater won't work with `onValueChange` since it expects a string. Use the ref to read the latest value (the transcription fires asynchronously after recording, so a closure over `input` would be stale):

```tsx
// ChatInputArea.tsx line 252-253: replace setInput functional updater
const current = inputRef.current;
handleInputChange(current ? `${current} ${text}` : text);
```

Similarly, `handleSubmit` clears input with `setInput("")` → change to `handleInputChange("")`.

**Step 3:** Verify build + existing tests pass: `cd web_frontend && npm run build && npx vitest run`

**Step 4:** Commit.

---

## Task 3: Create `useTutorChat` hook

Extract all chat state from Module.tsx. Uses `useReducer` for the chat lifecycle (atomic state transitions), `useState` for independent concerns.

**Files:**
- Create: `web_frontend/src/hooks/useTutorChat.ts`

### Chat lifecycle reducer

```typescript
type ChatState = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  lastPosition: { sectionIndex: number; segmentIndex: number } | null;
};

type ChatAction =
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | { type: "SEND_START"; content: string; sectionIndex: number; segmentIndex: number }
  | { type: "STREAM_CHUNK"; accumulated: string }
  | { type: "SEND_SUCCESS"; userContent: string; assistantContent: string }
  | { type: "SEND_FAILURE" }
  | { type: "CLEAR_PENDING" }
  | { type: "INJECT_SYSTEM_MESSAGE"; content: string };
```

Benefits over 5 separate `useState` calls:
- `SEND_START` atomically sets pending + loading + clears streaming + saves position
- `SEND_SUCCESS` atomically updates messages + clears pending + streaming + loading
- `SEND_FAILURE` atomically sets failed status + clears streaming + loading
- No risk of partial state updates

### API calls — match existing Module.tsx exactly

**`getChatHistory`** (Module.tsx lines 191-209): Takes `module.slug` (not `.id`), returns `{ sessionId, messages }`. Access `.messages` from the result.

**`sendMessage`** (Module.tsx lines 832-848): Is an `async generator` with signature `sendMessage(slug, sectionIndex, segmentIndex, message)` that yields `{ type: string; content?: string }` objects. Must check `chunk.type === "text"` and handle `chunk.type === "error"`. Copy the streaming loop from Module.tsx exactly.

**`trackChatMessageSent`**: The existing `handleSendMessage` calls analytics tracking. Include this in the hook.

### `handleSendMessage` dependency array

The existing Module.tsx has `[triggerChatActivity, moduleId]` as deps — NOT `messages`. The API uses server-side history, not client-side. Match this.

### `retryMessage` implementation

Reads from reducer state (`pendingMessage`, `lastPosition`), clears the pending message, and re-sends. Must match Module.tsx lines 871-880:

```typescript
const retryMessage = useCallback(() => {
  if (!chat.pendingMessage || !chat.lastPosition) return;
  const content = chat.pendingMessage.content;
  dispatchChat({ type: "CLEAR_PENDING" });
  sendMessage(content, chat.lastPosition.sectionIndex, chat.lastPosition.segmentIndex);
}, [chat.pendingMessage, chat.lastPosition, sendMessage]);
```

### Hook signature

```typescript
export function useTutorChat({
  moduleId,    // module slug for API calls
  module,      // for loading chat history
  currentSectionIndex,
  currentSegmentIndex,
  currentSection,
  isArticleSection,
  triggerChatActivity,
}: UseTutorChatOptions) {
  // useReducer for chat lifecycle
  const [chat, dispatchChat] = useReducer(chatReducer, initialChatState);

  // Independent state
  const [inputText, setInputText] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeSurface, setActiveSurface] = useState<ActiveSurface>({ type: "sidebar" });

  // Auto-open sidebar once on first article section visit
  const sidebarHasAutoOpened = useRef(false);
  useEffect(() => {
    if (!isArticleSection || sidebarHasAutoOpened.current) return;
    sidebarHasAutoOpened.current = true;
    setIsSidebarOpen(true);
  }, [isArticleSection]);

  // ... effects, computed values, sendMessage, retryMessage ...

  return {
    // From reducer
    messages: chat.messages,
    pendingMessage: chat.pendingMessage,
    streamingContent: chat.streamingContent,
    isLoading: chat.isLoading,

    // Actions
    sendMessage,
    retryMessage,

    // Shared input
    inputText, setInputText,

    // Sidebar
    isSidebarOpen, setSidebarOpen: setIsSidebarOpen,

    // Active surface
    activeSurface,
    registerInlineRef,

    // Computed
    sectionPrefixMessage,
    sidebarChatSegmentIndex,
    sectionHasChatSegment,
  };
}
```

**Step 1:** Create the hook file with reducer, all state, effects, and computed values. Copy the `sendMessage` streaming logic from Module.tsx lines 832-848 exactly — it's an async generator yielding `{type, content}` objects.

**Step 2:** Verify it compiles: `cd web_frontend && npm run build`

**Step 3:** Commit.

---

## Task 4: Wire Module.tsx to `useTutorChat`

Drop-in replacement — delete inline chat state, use hook return values. No behavior change.

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1:** Import the hook. Delete all chat-related state from Module.tsx:
- `messages`, `pendingMessage`, `streamingContent`, `isLoading` (lines 174-179)
- `isSidebarOpen`, `isSidebarOpenRef`, sync effect (lines 433-438)
- `sidebarAutoClosedRef`, `activateNarrativeChat` (lines 440, 444)
- `lastPosition` (lines 811-814)
- Chat history loading effect (lines 182-228)
- `sidebarChatSegmentIndex`, `sectionHasChatSegment` memos (lines 588-601)
- `sectionPrefixMessage` memo (lines 672-694)
- Sidebar auto-close/reopen effects (lines 697-745)
- `handleSendMessage`, `handleRetryMessage` callbacks (lines 817-880)

Replace with single hook call:

```tsx
const {
  messages, pendingMessage, streamingContent, isLoading,
  sendMessage: handleSendMessage, retryMessage: handleRetryMessage,
  inputText, setInputText,
  isSidebarOpen, setSidebarOpen: setIsSidebarOpen,
  activeSurface, registerInlineRef,
  sectionPrefixMessage, sidebarChatSegmentIndex, sectionHasChatSegment,
} = useTutorChat({
  moduleId: moduleContentId,
  module,
  currentSectionIndex,
  currentSegmentIndex,
  currentSection,
  isArticleSection,
  triggerChatActivity,
});
```

**Step 2:** Update ChatSidebar props to use shared input + activeSurface:

```tsx
<ChatSidebar
  isOpen={activeSurface.type === "sidebar" && isSidebarOpen}
  onOpen={() => setIsSidebarOpen(true)}
  onClose={() => setIsSidebarOpen(false)}
  // ... rest same, PLUS:
  inputText={inputText}
  onInputTextChange={setInputText}
/>
```

**Step 3:** Update `ChatSidebar.tsx` to accept and forward controlled input props:

Add to `ChatSidebarProps` type (line 17):
```tsx
inputText?: string;
onInputTextChange?: (text: string) => void;
```

Add to destructured props (line 32-ish):
```tsx
inputText,
onInputTextChange,
```

Update ChatInputArea usage (line 162-166) to pass controlled props:
```tsx
<ChatInputArea
  onSend={onSendMessage}
  isLoading={isLoading}
  placeholder="Ask a question..."
  value={inputText}
  onValueChange={onInputTextChange}
/>
```

**Step 4:** Verify build + tests + browser: `cd web_frontend && npm run build && npx vitest run`

**Step 5:** Commit.

---

## Task 5: Create `ChatInlineShell`

Thin shell replacing NarrativeChatSection. Uses `renderMessage` for messages, `ChatInputArea` for input, `chatViewReducer` for expand/collapse.

**Files:**
- Create: `web_frontend/src/components/module/ChatInlineShell.tsx`

**Key differences from NarrativeChatSection:**
- Uses exported `renderMessage()` instead of inline JSX for each message type (~300 lines removed)
- Uses `ChatInputArea` instead of inline textarea + voice recording (~150 lines removed)
- Accepts `inputText`/`onInputTextChange` for controlled shared input
- Accepts `hasActiveInput` — only renders input bar when this shell is active
- Accepts `shellRef` for IntersectionObserver registration
- Keeps `chatViewReducer` for expand/collapse, min-height wrapper, scroll ratchet

**Props:**

```tsx
type ChatInlineShellProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
  activated?: boolean;
  activatedWithHistory?: boolean;
  prefixMessage?: ChatMessage;
  scrollToResponse?: boolean;
  inputText: string;
  onInputTextChange: (text: string) => void;
  hasActiveInput: boolean;
  shellRef?: (el: HTMLDivElement | null) => void;
};
```

The component structure mirrors NarrativeChatSection's layout:
- Collapse button (expanded mode)
- Messages area (uses `renderMessage` for each message)
- Expand button (collapsed mode, shows "N earlier")
- Previous messages section
- Min-height wrapper with current exchange + pending/streaming/thinking
- Sticky input bar (only when `hasActiveInput`)

**Step 1:** Write the component. Port scroll logic from NarrativeChatSection (lines 97-267) — the min-height wrapper, scroll ratchet, expand/collapse are complex but already working. Use `renderMessage` for individual messages, `ChatInputArea` (controlled) for input.

**Step 2:** Verify build: `cd web_frontend && npm run build`

**Step 3:** Commit.

---

## Task 6: Replace NarrativeChatSection with ChatInlineShell

**Files:**
- Modify: `web_frontend/src/views/Module.tsx` (all 6 NarrativeChatSection render sites)
- Rename: `__tests__/NarrativeChatSection.test.tsx` → `__tests__/ChatInlineShell.test.tsx`
- Delete: `web_frontend/src/components/module/NarrativeChatSection.tsx`

### All 6 NarrativeChatSection render sites in Module.tsx

1. **Line 1153** — `renderSegment()` → `case "chat"` (standalone chat segment in article section). Has `activated`, `activatedWithHistory`, `prefixMessage`.
2. **Line 1190** — `renderSegment()` → `case "question"` → feedback chat. Conditionally rendered when `activeFeedbackKey === feedbackKey`. Has `scrollToResponse`, `activated` (always true). No `prefixMessage`, no `activatedWithHistory`.
3. **Line 1228** — `renderSegment()` → `case "roleplay"` → feedback chat. Same pattern as question feedback.
4. **Line 1426** — standalone `chat` section type (section-level, not segment-level). No `activated`, no `prefixMessage`.
5. **Line 1768** — `test` section → feedback chat. Same conditional pattern.
6. **Line 1938** — ChatSidebar (not NarrativeChatSection, but also uses the same message props — already wired in Task 4).

### Feedback chats vs standalone chats

Feedback chats (sites 2, 3, 5) are conditionally mounted (`activeFeedbackKey === key`). They should:
- **NOT register with `registerInlineRef`** — they appear inside question/roleplay/test UI, not as standalone scroll targets. The IntersectionObserver should not track them.
- **Always have `hasActiveInput={true}`** — when mounted, they're the active interaction point (the user just triggered feedback).
- **NOT receive `shellRef`** — no observer registration.

Use a composite key `${sectionIndex}-${segmentIndex}` for `registerInlineRef` to avoid collisions when multiple inline shells exist in the same section.

**Step 1:** Replace import and all render sites. Standalone chat sites get full observer wiring:

```tsx
// Standalone chat (sites 1, 4):
<ChatInlineShell
  // ... same props as before, PLUS:
  inputText={inputText}
  onInputTextChange={setInputText}
  hasActiveInput={
    activeSurface.type === "inline" &&
    activeSurface.sectionIndex === sectionIndex &&
    activeSurface.segmentIndex === segmentIndex
  }
  shellRef={(el) => registerInlineRef(sectionIndex, segmentIndex, el)}
/>

// Feedback chat (sites 2, 3, 5):
<ChatInlineShell
  // ... same message/loading props
  inputText={inputText}
  onInputTextChange={setInputText}
  hasActiveInput={true}  // always active when mounted
  // NO shellRef — not tracked by IntersectionObserver
/>
```

**Step 2:** Migrate tests — update imports, add required props. Remove mocks for `useVoiceRecording` (NarrativeChatSection imported it directly; ChatInlineShell delegates to ChatInputArea instead).

**Step 3:** Delete NarrativeChatSection.tsx.

**Step 4:** Run tests + build: `cd web_frontend && npx vitest run && npm run build`

**Step 5:** Verify in browser. Inline chat should look and behave identically.

**Step 6:** Commit.

---

## Task 7: Implement `activeSurface` IntersectionObserver

The activeSurface detection is in `useTutorChat` but needs the IntersectionObserver wired up properly.

**Files:**
- Modify: `web_frontend/src/hooks/useTutorChat.ts`

### IntersectionObserver design

**Maintain a persistent ratio map** — don't compare only within the current callback batch.

**Composite key** — use `"sectionIndex-segmentIndex"` string keys so multiple inline shells in the same section don't collide:

```typescript
type InlineKey = string;  // "sectionIndex-segmentIndex"

const inlineRefs = useRef<Map<InlineKey, HTMLElement>>(new Map());
const ratioMap = useRef<Map<InlineKey, number>>(new Map());
const observerDirty = useRef(false);
const [observerVersion, setObserverVersion] = useState(0);

const registerInlineRef = useCallback((
  sectionIndex: number,
  segmentIndex: number,
  el: HTMLElement | null,
) => {
  const key: InlineKey = `${sectionIndex}-${segmentIndex}`;
  if (el) {
    inlineRefs.current.set(key, el);
  } else {
    inlineRefs.current.delete(key);
    ratioMap.current.delete(key);
  }
  // Batch: multiple shells mount in the same commit cycle.
  // Schedule one state update instead of N.
  if (!observerDirty.current) {
    observerDirty.current = true;
    queueMicrotask(() => {
      observerDirty.current = false;
      setObserverVersion(v => v + 1);
    });
  }
}, []);

useEffect(() => {
  if (!isArticleSection || inlineRefs.current.size === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      // Update persistent ratio map
      for (const entry of entries) {
        for (const [key, el] of inlineRefs.current) {
          if (entry.target === el) {
            ratioMap.current.set(key, entry.intersectionRatio);
          }
        }
      }

      // Find most visible from ALL tracked sections
      let best: { key: InlineKey; ratio: number } | null = null;
      for (const [key, ratio] of ratioMap.current) {
        if (ratio > 0.15 && (!best || ratio > best.ratio)) {
          best = { key, ratio };
        }
      }

      if (best) {
        const [si, segi] = best.key.split("-").map(Number);
        setActiveSurface(prev =>
          prev.type === "inline" && prev.sectionIndex === si && prev.segmentIndex === segi
            ? prev  // avoid unnecessary re-render
            : { type: "inline", sectionIndex: si, segmentIndex: segi }
        );
      } else {
        setActiveSurface(prev =>
          prev.type === "sidebar" ? prev : { type: "sidebar" }
        );
      }
    },
    { threshold: [0, 0.15, 0.3, 0.5, 0.7] },
  );

  for (const [, el] of inlineRefs.current) {
    observer.observe(el);
  }

  return () => observer.disconnect();
}, [isArticleSection, observerVersion]);
```

**Key fixes from review:**
- **Composite key** `"sectionIndex-segmentIndex"` prevents collisions when multiple inline shells exist in one section
- **`queueMicrotask` batching** — N shells mounting in the same commit cycle produce one `observerVersion` bump, not N extra renders
- Persistent `ratioMap` prevents stale comparisons across callback batches
- State setter uses functional form to avoid unnecessary re-renders
- Threshold `0.15` prevents activation when barely peeking into view

### Lock to inline on send

When the user sends a message in an inline section, lock `activeSurface` to that section so the observer doesn't immediately switch away on scroll:

```typescript
// In sendMessage callback:
const sendMessage = useCallback((content: string, sectionIndex: number, segmentIndex: number) => {
  // ... dispatch SEND_START, start streaming ...

  // Lock activeSurface to this inline section
  setActiveSurface({ type: "inline", sectionIndex, segmentIndex });
  // Set a "locked" flag to prevent observer from overriding for ~2s
  activeSurfaceLockedUntil.current = Date.now() + 2000;
}, [...]);
```

In the observer callback, skip updates while locked:
```typescript
if (activeSurfaceLockedUntil.current && Date.now() < activeSurfaceLockedUntil.current) return;
activeSurfaceLockedUntil.current = null;  // expired, resume normal behavior
```

### `activeSurface` type update

Add `segmentIndex` to inline surface:

```typescript
type ActiveSurface =
  | { type: "sidebar" }
  | { type: "inline"; sectionIndex: number; segmentIndex: number };
```

### Remove old auto-close/reopen heuristics

Delete from Module.tsx (now handled by activeSurface):
- `doneReadingBtnRef` (if only used for scroll-reopen)
- `activateNarrativeChat` state and effects
- `sidebarAutoClosedRef`
- Scroll listener that reopened sidebar

### Mobile consideration

On mobile (`< lg`), `activeSurface` still tracks which surface is active, but the sidebar is an overlay — it should NOT auto-collapse when scrolling past an inline section. The sidebar's `isOpen` prop can factor in viewport:

```tsx
isOpen={isMobile ? isSidebarOpen : (activeSurface.type === "sidebar" && isSidebarOpen)}
```

Or simpler: skip the `activeSurface` check on mobile since sidebar is an overlay that doesn't compete with inline sections.

**Step 1:** Implement the IntersectionObserver with persistent ratio map.

**Step 2:** Remove old heuristics from Module.tsx.

**Step 3:** Verify in browser — full test matrix:

| Scenario | Expected |
|----------|----------|
| Scroll to inline chat section | Sidebar collapses, inline shows input |
| Scroll away from inline | Sidebar reopens (if user had it open) |
| Multiple inline sections | Only most visible one gets input |
| Type draft in sidebar → scroll to inline | Draft appears in inline input |
| Toggle sidebar closed → scroll to inline → scroll back | Sidebar stays closed |
| Send message in inline → scroll slightly | Stays locked to that inline for ~2s |
| Feedback chat opens (question/roleplay) | Input active, no observer registration |
| Mobile: scroll to inline | Sidebar overlay unaffected |

**Step 4:** Commit.

---

## Task 8: Add segment-transition system messages

When the user moves between segments, inject system messages into the chat history. These serve dual purpose: visual trail for the user + context for the AI.

**Files:**
- Modify: `web_frontend/src/hooks/useTutorChat.ts`

**Step 1:** Add an effect that watches segment changes and injects system messages:

```typescript
const prevSegmentRef = useRef<{ sectionIndex: number; segmentIndex: number } | null>(null);
const hasUserMessage = chat.messages.some(m => m.role === "user");  // derived boolean

useEffect(() => {
  // Only inject after user has sent at least one message
  if (!hasUserMessage) return;

  const prev = prevSegmentRef.current;
  const current = { sectionIndex: currentSectionIndex, segmentIndex: currentSegmentIndex };
  prevSegmentRef.current = current;

  // Skip on first render
  if (!prev) return;
  // Skip if no change
  if (prev.sectionIndex === current.sectionIndex && prev.segmentIndex === current.segmentIndex) return;

  // Determine what changed and build message
  const sectionTitle = currentSection?.meta?.title;
  let content: string;
  if (prev.sectionIndex !== current.sectionIndex && sectionTitle) {
    content = `Now reading: ${sectionTitle}`;
  } else {
    // Segment changed within same section — optional, could skip
    return;
  }

  dispatchChat({ type: "INJECT_SYSTEM_MESSAGE", content });
}, [currentSectionIndex, currentSegmentIndex, currentSection, hasUserMessage]);
```

Note: `hasUserMessage` is a derived boolean (not `chat.messages` array) in the dependency array. This avoids re-running the effect on every message send/receive — the effect only needs to know *whether* the user has chatted, not react to individual messages.

The `INJECT_SYSTEM_MESSAGE` action in the reducer:

```typescript
case "INJECT_SYSTEM_MESSAGE":
  return {
    ...state,
    messages: [...state.messages, { role: "system", content: action.content }],
  };
```

**Step 2:** Verify in browser — navigate between sections after sending a message. System message pills should appear in the chat timeline (both sidebar and inline, since they share messages).

**Step 3:** Commit.

---

## Task 9: Test-after + polish

**Files:**
- Create/modify: `web_frontend/src/hooks/__tests__/useTutorChat.test.ts`
- Modify: `web_frontend/src/components/module/__tests__/ChatInlineShell.test.tsx`

**Step 1: Hook tests** — test pure computations:

```typescript
describe("useTutorChat", () => {
  it("starts with empty state");
  it("auto-opens sidebar on first article section");
  it("does not re-auto-open after user closes sidebar");
  it("shares inputText across renders");
  it("computes sectionPrefixMessage from article segments");
  it("computes sidebarChatSegmentIndex");
});
```

Mock only the API layer (`sendMessage`, `getChatHistory`). Make sure mock return values match the real API shape (`getChatHistory` returns `{ sessionId, messages }`, not a flat array).

**Step 2: Migrate ChatInlineShell tests** — update `NarrativeChatSection.test.tsx`:
- Rename file
- Update imports (`ChatInlineShell` instead of `NarrativeChatSection`)
- Add required props (`inputText`, `onInputTextChange`, `hasActiveInput`)
- Remove mocks for dependencies no longer directly imported by the component

**Step 3: Run full suite:** `cd web_frontend && npx vitest run && npm run lint && npm run build`

**Step 4: Full browser verification at `http://dev.vps:3300/module/demo?debug#the-most-important-century-blog-post-series`:**

| Scenario | Expected |
|----------|----------|
| Article section, first visit | Sidebar auto-opens |
| Close sidebar, navigate away, come back | Sidebar stays closed |
| Scroll to inline chat section | Sidebar collapses to icon, inline shows input |
| Scroll away from inline section | Sidebar reopens (if it was open) |
| Send message in sidebar | Message appears, streaming works |
| Send message in inline | Message appears, streaming works |
| Send in sidebar → scroll to inline | Same messages visible in inline |
| Type draft in sidebar → scroll to inline | Draft text appears in inline input |
| Navigate sections after chatting | System message "Now reading: X" appears |
| Mobile (<1024px) | Floating button, overlay chat |
| Multiple inline sections on page | Only the visible one gets input |
| Voice recording in inline chat | Transcription appends to shared input |

**Step 5:** Commit.

---

## Notes

- **FLIP animation (aspirational):** Not in this plan. Once shared input architecture is in place, animating the input bar between surfaces is a polish pass.

- **DoneReadingButton:** Decoupled from sidebar behavior. It still marks sections as complete for progress tracking, but no longer triggers sidebar auto-close. The activeSurface IntersectionObserver handles sidebar ↔ inline transitions based on scroll position. The current done-reading flow (Module.tsx lines 704-715) auto-closes the sidebar and sets `activateNarrativeChat` — this entire flow is replaced by the observer-driven `activeSurface` system. Verify in browser that completing a section still works correctly (progress saved, UI updates) even though sidebar no longer auto-closes on completion.

- **Design doc deviation: naming.** The design doc calls the sidebar "ChatSidebarShell" but this plan keeps the existing `ChatSidebar` name. Only inline gets the new name `ChatInlineShell` (replacing `NarrativeChatSection`). This avoids a noisy rename with no functional benefit.

- **chatViewReducer stays unchanged** in `ChatInlineShell`. It's already tested (12 tests) and handles expand/collapse + message slicing correctly.

- **System messages are lightweight:** They're `{ role: "system", content: "Now reading: X" }` — the existing `renderMessage` already renders system messages as centered pills with optional icons. No new rendering needed.
