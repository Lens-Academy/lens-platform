# Prompt Lab Multi-Conversation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Prompt Lab so facilitators can test a system prompt across many conversations simultaneously, with proper decomposition of the prompt into base/instructions/context.

**Architecture:** Horizontally scrollable grid of conversation columns grouped by stage (fixture). Each group shares editable instructions + context. A global system prompt editor sits above. Each conversation column is an independent component using a `useConversationSlot` hook for its state and streaming. `assemblePrompt()` on the client mirrors production `_build_system_prompt()`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vite/Vike, Vitest, FastAPI (Python backend)

**Design doc:** `docs/plans/2026-02-20-promptlab-multi-conversation-design.md`

---

### Task 1: Migrate fixture JSON files to new format

**Files:**
- Modify: `core/promptlab/fixtures/cognitive-superpowers-chat-1.json`
- Modify: `core/promptlab/fixtures/cognitive-superpowers-chat-2.json`

**Step 1: Rewrite fixture 1**

Transform from old format (`systemPrompt.base`, `systemPrompt.instructions`, `previousContent`, `messages`) to new format (`instructions`, `context`, `conversations[]`). Remove `systemPrompt.base` (becomes a frontend constant). Move `systemPrompt.instructions` to top-level `instructions`. Rename `previousContent` to `context`. Wrap `messages` in a `conversations` array with a descriptive label.

For fixture 1 (`cognitive-superpowers-chat-1.json`):
```json
{
  "name": "Cognitive Superpowers - Deceptive Alignment Discussion",
  "module": "cognitive-superpowers",
  "description": "Student discusses deceptive alignment after reading about mesa-optimization and inner alignment failures. Two exchanges exploring how an AI system might learn to behave well during training while pursuing different objectives once deployed.",
  "instructions": "Guide the student through a discussion of deceptive alignment. Help them understand the distinction between an AI that is genuinely aligned versus one that has learned to appear aligned during training. Encourage them to think about what conditions might lead to deceptive alignment and why it is particularly concerning for AI safety.",
  "context": "Mesa-optimization occurs when a learned model is itself an optimizer...[keep full text from previousContent]",
  "conversations": [
    {
      "label": "Confused about the distinction",
      "messages": [... keep existing messages array unchanged ...]
    }
  ]
}
```

**Step 2: Rewrite fixture 2**

Same transformation for `cognitive-superpowers-chat-2.json`. The label should be "General understanding of convergent goals".

**Step 3: Commit**

```
jj desc -m "refactor: migrate promptlab fixtures to multi-conversation format"
```

---

### Task 2: Update backend fixture types and loader

**Files:**
- Modify: `core/promptlab/fixtures.py`

**Step 1: Write failing test**

Create `core/promptlab/tests/test_fixtures.py`:

```python
from core.promptlab.fixtures import list_fixtures, load_fixture


def test_list_fixtures_returns_summaries():
    fixtures = list_fixtures()
    assert len(fixtures) >= 2
    for f in fixtures:
        assert "name" in f
        assert "module" in f
        assert "description" in f


def test_load_fixture_returns_new_format():
    fixture = load_fixture("Cognitive Superpowers - Deceptive Alignment Discussion")
    assert fixture is not None
    assert "instructions" in fixture
    assert "context" in fixture
    assert "conversations" in fixture
    assert len(fixture["conversations"]) >= 1
    conv = fixture["conversations"][0]
    assert "label" in conv
    assert "messages" in conv
    assert len(conv["messages"]) >= 2


def test_load_fixture_not_found():
    fixture = load_fixture("Nonexistent Fixture")
    assert fixture is None
```

**Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest core/promptlab/tests/test_fixtures.py -v`
Expected: FAIL (fixture format doesn't match yet)

**Step 3: Update types and loader in `fixtures.py`**

Replace `FixtureSystemPrompt` with `FixtureConversation`. Update `Fixture` type to have `instructions`, `context`, `conversations` instead of `systemPrompt`, `previousContent`, `messages`. Update `load_fixture()` to parse the new JSON structure.

```python
class FixtureConversation(TypedDict):
    label: str
    messages: list[FixtureMessage]


class Fixture(TypedDict):
    name: str
    module: str
    description: str
    instructions: str
    context: str
    conversations: list[FixtureConversation]
```

Update `load_fixture()`:
```python
return Fixture(
    name=data["name"],
    module=data["module"],
    description=data["description"],
    instructions=data["instructions"],
    context=data["context"],
    conversations=[
        FixtureConversation(label=c["label"], messages=[
            FixtureMessage(role=m["role"], content=m["content"])
            for m in c["messages"]
        ])
        for c in data["conversations"]
    ],
)
```

Remove the `FixtureSystemPrompt` class.

**Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest core/promptlab/tests/test_fixtures.py -v`
Expected: PASS

**Step 5: Run full backend tests + lint**

Run: `.venv/bin/pytest && ruff check .`
Expected: PASS

**Step 6: Commit**

```
jj desc -m "refactor: update promptlab fixture types and loader for multi-conversation format"
jj new
```

---

### Task 3: Update frontend API types

**Files:**
- Modify: `web_frontend/src/api/promptlab.ts`

**Step 1: Update types**

Replace existing `Fixture` and related types:

```ts
export interface FixtureConversation {
  label: string;
  messages: FixtureMessage[];
}

export interface Fixture {
  name: string;
  module: string;
  description: string;
  instructions: string;
  context: string;
  conversations: FixtureConversation[];
}
```

Remove `FixtureSystemPrompt` interface. Keep `FixtureSummary`, `FixtureMessage`, `StreamEvent` unchanged. Keep `listFixtures`, `loadFixture`, `regenerateResponse`, `continueConversation` functions unchanged.

**Step 2: Run build to check types compile**

Run: `cd web_frontend && npm run build`
Expected: Type errors in `PromptLab.tsx` and `FixtureBrowser.tsx` (they reference old `Fixture` shape). That's expected — we'll fix them in later tasks.

Note: The build may fail at this point due to downstream type errors. That's fine. We'll fix them in Task 7 (PromptLab rewrite). To verify just this file compiles, run: `npx tsc --noEmit src/api/promptlab.ts` or check the specific error output from `npm run build` to confirm the errors are only in PromptLab.tsx / FixtureBrowser.tsx, not in promptlab.ts itself.

**Step 3: Commit**

```
jj desc -m "refactor: update promptlab frontend API types for multi-conversation format"
jj new
```

---

### Task 4: Create `assemblePrompt` utility

**Files:**
- Create: `web_frontend/src/utils/assemblePrompt.ts`
- Create: `web_frontend/src/utils/assemblePrompt.test.ts`

**Step 1: Write failing test**

```ts
// web_frontend/src/utils/assemblePrompt.test.ts
import { describe, it, expect } from "vitest";
import { assemblePrompt, DEFAULT_SYSTEM_PROMPT } from "./assemblePrompt";

describe("assemblePrompt", () => {
  it("returns just system prompt when no instructions or context", () => {
    expect(assemblePrompt("Base prompt", "", "")).toBe("Base prompt");
  });

  it("appends instructions", () => {
    const result = assemblePrompt("Base", "Do this thing", "");
    expect(result).toBe("Base\n\nInstructions:\nDo this thing");
  });

  it("appends context", () => {
    const result = assemblePrompt("Base", "", "Some content");
    expect(result).toBe(
      "Base\n\nThe user just engaged with this content:\n---\nSome content\n---"
    );
  });

  it("appends both instructions and context", () => {
    const result = assemblePrompt("Base", "Do this", "Content here");
    expect(result).toContain("Instructions:\nDo this");
    expect(result).toContain("---\nContent here\n---");
    // Instructions come before context
    expect(result.indexOf("Instructions")).toBeLessThan(
      result.indexOf("Content here")
    );
  });

  it("exports a DEFAULT_SYSTEM_PROMPT constant", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("tutor");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("AI safety");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web_frontend && npx vitest run src/utils/assemblePrompt.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement**

```ts
// web_frontend/src/utils/assemblePrompt.ts

/**
 * Default base system prompt — matches the hardcoded prompt in core/modules/chat.py.
 */
export const DEFAULT_SYSTEM_PROMPT =
  "You are a tutor helping someone learn about AI safety. Each piece of content (article, video) has different topics and learning objectives.";

/**
 * Assemble a full system prompt from its three parts.
 * Mirrors _build_system_prompt() in core/modules/chat.py.
 */
export function assemblePrompt(
  systemPrompt: string,
  instructions: string,
  context: string,
): string {
  let prompt = systemPrompt;
  if (instructions) {
    prompt += "\n\nInstructions:\n" + instructions;
  }
  if (context) {
    prompt +=
      "\n\nThe user just engaged with this content:\n---\n" + context + "\n---";
  }
  return prompt;
}
```

**Step 4: Run test to verify it passes**

Run: `cd web_frontend && npx vitest run src/utils/assemblePrompt.test.ts`
Expected: PASS

**Step 5: Commit**

```
jj desc -m "feat: add assemblePrompt utility mirroring _build_system_prompt"
jj new
```

---

### Task 5: Create `useConversationSlot` hook

**Files:**
- Create: `web_frontend/src/hooks/useConversationSlot.ts`

This hook extracts the per-conversation state and streaming logic currently in `PromptLab.tsx`. Each `ConversationColumn` component will call this hook internally.

**Step 1: Create the hook**

```ts
// web_frontend/src/hooks/useConversationSlot.ts
import { useState, useRef, useCallback } from "react";
import {
  regenerateResponse,
  continueConversation,
  type FixtureMessage,
} from "@/api/promptlab";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  isRegenerated?: boolean;
  originalContent?: string;
  thinkingContent?: string;
}

export interface ConversationSlotState {
  messages: ConversationMessage[];
  selectedMessageIndex: number | null;
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  hasRegenerated: boolean;
  error: string | null;
}

export interface ConversationSlotActions {
  selectMessage: (index: number) => void;
  regenerate: (
    fullSystemPrompt: string,
    enableThinking: boolean,
    effort: string,
  ) => Promise<void>;
  sendFollowUp: (
    message: string,
    fullSystemPrompt: string,
    enableThinking: boolean,
    effort: string,
  ) => Promise<void>;
  dismissError: () => void;
  reset: (newMessages: ConversationMessage[]) => void;
}

export function useConversationSlot(
  initialMessages: ConversationMessage[],
): ConversationSlotState & ConversationSlotActions {
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [hasRegenerated, setHasRegenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const selectMessage = useCallback(
    (index: number) => {
      if (messages[index]?.role !== "assistant") return;
      setSelectedMessageIndex(index);
      setHasRegenerated(false);
      setError(null);
    },
    [messages],
  );

  const regenerate = useCallback(
    async (fullSystemPrompt: string, enableThinking: boolean, effort: string) => {
      if (selectedMessageIndex === null) return;

      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinking("");
      setError(null);
      abortRef.current = false;

      let accContent = "";
      let accThinking = "";
      const originalContent = messages[selectedMessageIndex].content;
      const messagesToSend: FixtureMessage[] = messages
        .slice(0, selectedMessageIndex)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        for await (const event of regenerateResponse(
          messagesToSend,
          fullSystemPrompt,
          enableThinking,
          effort,
        )) {
          if (abortRef.current) break;

          if (event.type === "thinking" && event.content) {
            accThinking += event.content;
            setStreamingThinking(accThinking);
          } else if (event.type === "text" && event.content) {
            accContent += event.content;
            setStreamingContent(accContent);
          } else if (event.type === "error") {
            console.error("Regeneration error:", event.message);
            setError(event.message ?? "An error occurred during regeneration");
          } else if (event.type === "done") {
            if (accContent) {
              const regeneratedMessage: ConversationMessage = {
                role: "assistant",
                content: accContent,
                isRegenerated: true,
                originalContent,
                thinkingContent: accThinking || undefined,
              };
              setMessages((prev) => [
                ...prev.slice(0, selectedMessageIndex),
                regeneratedMessage,
              ]);
              setHasRegenerated(true);
            }
            setSelectedMessageIndex(null);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to regenerate response");
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
      }
    },
    [selectedMessageIndex, messages],
  );

  const sendFollowUp = useCallback(
    async (message: string, fullSystemPrompt: string, enableThinking: boolean, effort: string) => {
      const userMessage: ConversationMessage = { role: "user", content: message };
      setMessages((prev) => [...prev, userMessage]);

      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinking("");
      setError(null);
      abortRef.current = false;

      let accContent = "";
      let accThinking = "";

      const allMessages: FixtureMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: message },
      ];

      try {
        for await (const event of continueConversation(
          allMessages,
          fullSystemPrompt,
          enableThinking,
          effort,
        )) {
          if (abortRef.current) break;

          if (event.type === "thinking" && event.content) {
            accThinking += event.content;
            setStreamingThinking(accThinking);
          } else if (event.type === "text" && event.content) {
            accContent += event.content;
            setStreamingContent(accContent);
          } else if (event.type === "error") {
            console.error("Continuation error:", event.message);
            setError(event.message ?? "An error occurred");
          } else if (event.type === "done") {
            if (accContent) {
              const assistantMessage: ConversationMessage = {
                role: "assistant",
                content: accContent,
                isRegenerated: true,
                thinkingContent: accThinking || undefined,
              };
              setMessages((prev) => [...prev, assistantMessage]);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to continue conversation");
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
      }
    },
    [messages],
  );

  const dismissError = useCallback(() => setError(null), []);

  const reset = useCallback((newMessages: ConversationMessage[]) => {
    abortRef.current = true;
    setMessages(newMessages);
    setSelectedMessageIndex(null);
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingThinking("");
    setHasRegenerated(false);
    setError(null);
  }, []);

  return {
    messages,
    selectedMessageIndex,
    isStreaming,
    streamingContent,
    streamingThinking,
    hasRegenerated,
    error,
    selectMessage,
    regenerate,
    sendFollowUp,
    dismissError,
    reset,
  };
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend && npx tsc --noEmit src/hooks/useConversationSlot.ts`
Expected: PASS (no type errors)

**Step 3: Commit**

```
jj desc -m "feat: extract useConversationSlot hook from PromptLab"
jj new
```

---

### Task 6: Create `ConversationColumn` component

**Files:**
- Create: `web_frontend/src/components/promptlab/ConversationColumn.tsx`

This replaces `ConversationPanel.tsx`. Key changes from the original:
1. Uses `useConversationSlot` hook internally
2. Reasoning always renders ABOVE the message bubble (both streaming and final)
3. Smart scroll: tracks user scroll position, doesn't force-scroll when user scrolled up
4. Exposes `regenerate()` via `useImperativeHandle` for "Regenerate All"

**Step 1: Create the component**

The component receives: `initialMessages`, `label`, `fullSystemPrompt` (assembled by parent), `enableThinking`, `effort`. It manages its own state via the hook.

```tsx
// web_frontend/src/components/promptlab/ConversationColumn.tsx
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import ChatMarkdown from "@/components/ChatMarkdown";
import { useConversationSlot } from "@/hooks/useConversationSlot";
import type { ConversationMessage } from "@/hooks/useConversationSlot";

export interface ConversationColumnHandle {
  regenerate: () => Promise<void>;
  autoSelectLastAssistant: () => void;
}

interface ConversationColumnProps {
  initialMessages: ConversationMessage[];
  label: string;
  systemPrompt: string;   // pre-assembled full prompt from parent
  enableThinking: boolean;
  effort: string;
}

const ConversationColumn = forwardRef<ConversationColumnHandle, ConversationColumnProps>(
  function ConversationColumn({ initialMessages, label, systemPrompt, enableThinking, effort }, ref) {
    const slot = useConversationSlot(initialMessages);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [userScrolledUp, setUserScrolledUp] = useState(false);
    const [followUpInput, setFollowUpInput] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Expose regenerate to parent for "Regenerate All"
    // Use refs to always read latest props without stale closures
    const systemPromptRef = useRef(systemPrompt);
    const enableThinkingRef = useRef(enableThinking);
    const effortRef = useRef(effort);
    systemPromptRef.current = systemPrompt;
    enableThinkingRef.current = enableThinking;
    effortRef.current = effort;

    useImperativeHandle(ref, () => ({
      regenerate: () =>
        slot.regenerate(systemPromptRef.current, enableThinkingRef.current, effortRef.current),
      autoSelectLastAssistant: () => {
        const lastIdx = slot.messages.findLastIndex((m) => m.role === "assistant");
        if (lastIdx >= 0) slot.selectMessage(lastIdx);
      },
    }));

    // Toggle tracking for originals and thinking
    const [expandedOriginals, setExpandedOriginals] = useState<Set<number>>(new Set());
    const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());

    function toggleOriginal(index: number) {
      setExpandedOriginals((prev) => {
        const next = new Set(prev);
        next.has(index) ? next.delete(index) : next.add(index);
        return next;
      });
    }

    function toggleThinking(index: number) {
      setExpandedThinking((prev) => {
        const next = new Set(prev);
        next.has(index) ? next.delete(index) : next.add(index);
        return next;
      });
    }

    // Smart scroll: only auto-scroll when user hasn't scrolled up
    const handleScroll = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      setUserScrolledUp(!atBottom);
    }, []);

    useEffect(() => {
      if (slot.isStreaming && !userScrolledUp && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [slot.isStreaming, slot.streamingContent, slot.streamingThinking, userScrolledUp]);

    // Auto-resize textarea
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        const maxHeight = 80;
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
      }
    }, [followUpInput]);

    function handleSendFollowUp(e: React.FormEvent) {
      e.preventDefault();
      const text = followUpInput.trim();
      if (text && slot.hasRegenerated && !slot.isStreaming) {
        slot.sendFollowUp(text, systemPrompt, enableThinking, effort);
        setFollowUpInput("");
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendFollowUp(e);
      }
    }

    const canRegenerate = slot.selectedMessageIndex !== null;
    const canSendFollowUp = slot.hasRegenerated && !slot.isStreaming;

    return (
      <div className="flex flex-col h-full w-[280px] min-w-[280px] border-r border-gray-200 last:border-r-0">
        {/* Column header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/50">
          <span className="text-xs font-medium text-slate-600 truncate">{label}</span>
          {canRegenerate && (
            <button
              onClick={() => slot.regenerate(systemPrompt, enableThinking, effort)}
              disabled={slot.isStreaming}
              className={`text-[10px] font-medium px-2 py-1 rounded transition-colors ${
                slot.isStreaming
                  ? "bg-slate-100 text-slate-400 cursor-default"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              Regenerate
            </button>
          )}
        </div>

        {/* Error */}
        {slot.error && (
          <div className="px-3 py-1.5 bg-red-50 text-[10px] text-red-600 flex items-center gap-1">
            <span className="truncate">
              {slot.error.length > 80 ? "Request failed. Check console." : slot.error}
            </span>
            <button onClick={slot.dismissError} className="text-red-400 hover:text-red-600 ml-auto shrink-0">
              &times;
            </button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-2 space-y-2">
          {slot.messages.map((msg, index) => {
            const isSelected = slot.selectedMessageIndex === index;
            const isDimmed = slot.selectedMessageIndex !== null && index > slot.selectedMessageIndex;
            const isAssistant = msg.role === "assistant";

            return (
              <div key={index} className={`transition-opacity ${isDimmed ? "opacity-40" : ""}`}>
                {/* Original content toggle (above message for regenerated) */}
                {msg.isRegenerated && msg.originalContent && (
                  <div className="mb-1">
                    <button
                      onClick={() => toggleOriginal(index)}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <svg className={`w-2.5 h-2.5 transition-transform ${expandedOriginals.has(index) ? "rotate-90" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Original
                    </button>
                    {expandedOriginals.has(index) && (
                      <div className="bg-gray-50 border border-gray-200 rounded p-2 text-[11px] text-gray-500 mt-1">
                        <ChatMarkdown>{msg.originalContent}</ChatMarkdown>
                      </div>
                    )}
                  </div>
                )}

                {/* Reasoning ABOVE the message (for regenerated messages) */}
                {msg.isRegenerated && msg.thinkingContent && (
                  <div className="mb-1">
                    <button
                      onClick={() => toggleThinking(index)}
                      className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-700 transition-colors"
                    >
                      <svg className={`w-2.5 h-2.5 transition-transform ${expandedThinking.has(index) ? "rotate-90" : ""}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Reasoning
                    </button>
                    {expandedThinking.has(index) && (
                      <div className="mt-1 bg-amber-50 border border-amber-200 rounded p-2 font-mono text-[10px] text-amber-900 whitespace-pre-wrap leading-relaxed">
                        {msg.thinkingContent}
                      </div>
                    )}
                  </div>
                )}

                {/* Message bubble */}
                <div
                  onClick={() => { if (isAssistant && !slot.isStreaming) slot.selectMessage(index); }}
                  className={`p-2 rounded text-[12px] ${
                    isAssistant
                      ? `bg-blue-50 text-gray-800 ${!slot.isStreaming ? "cursor-pointer hover:bg-blue-100" : ""}`
                      : "bg-gray-100 text-gray-800 ml-4"
                  } ${isSelected ? "ring-2 ring-blue-400" : ""}`}
                >
                  <div className="text-[10px] text-gray-400 mb-0.5">
                    {isAssistant ? "Tutor" : "Student"}
                  </div>
                  <div className={isAssistant ? "prose-compact" : "whitespace-pre-wrap"}>
                    {isAssistant ? <ChatMarkdown>{msg.content}</ChatMarkdown> : msg.content}
                  </div>
                </div>

                {/* Separator for dimmed messages */}
                {isDimmed && index === (slot.selectedMessageIndex ?? 0) + 1 && (
                  <div className="text-[10px] text-slate-400 mt-1 text-center">
                    Will be replaced
                  </div>
                )}
              </div>
            );
          })}

          {/* Streaming indicator — reasoning ABOVE message */}
          {slot.isStreaming && (
            <div>
              {/* Streaming reasoning (above message) */}
              {slot.streamingThinking && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 mb-1">
                  <div className="text-[10px] text-amber-600 mb-0.5">Thinking...</div>
                  <div className="font-mono text-[10px] text-amber-900 whitespace-pre-wrap leading-relaxed">
                    {slot.streamingThinking}
                  </div>
                </div>
              )}

              {/* Streaming response */}
              {slot.streamingContent ? (
                <div className="bg-blue-50 p-2 rounded">
                  <div className="text-[10px] text-gray-400 mb-0.5">Tutor</div>
                  <div className="text-[12px]">
                    <ChatMarkdown>{slot.streamingContent}</ChatMarkdown>
                  </div>
                </div>
              ) : !slot.streamingThinking ? (
                <div className="bg-blue-50 p-2 rounded">
                  <div className="text-[10px] text-gray-400 mb-0.5">Tutor</div>
                  <div className="text-gray-400 text-[12px]">Generating...</div>
                </div>
              ) : null}
            </div>
          )}

          {/* Scroll-to-bottom button */}
          {userScrolledUp && slot.isStreaming && (
            <button
              onClick={() => {
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                setUserScrolledUp(false);
              }}
              className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] px-2 py-1 rounded-full shadow"
            >
              ↓ New content
            </button>
          )}
        </div>

        {/* Follow-up input */}
        <form onSubmit={handleSendFollowUp} className="flex gap-1 p-2 border-t border-gray-100 items-end">
          <textarea
            ref={textareaRef}
            value={followUpInput}
            onChange={(e) => setFollowUpInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Follow-up..."
            disabled={!canSendFollowUp || slot.isStreaming}
            rows={1}
            className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none leading-normal disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={!canSendFollowUp || slot.isStreaming || !followUpInput.trim()}
            className="bg-blue-600 text-white text-[10px] px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    );
  },
);

export default ConversationColumn;
```

**Step 2: Verify it compiles**

Run: `cd web_frontend && npx tsc --noEmit src/components/promptlab/ConversationColumn.tsx`
Expected: PASS

**Step 3: Commit**

```
jj desc -m "feat: create ConversationColumn component with streaming fixes"
jj new
```

---

### Task 7: Create `StageGroup` component

**Files:**
- Create: `web_frontend/src/components/promptlab/StageGroup.tsx`

Groups multiple conversation columns for one fixture. Shows editable instructions + collapsible context once, then columns side by side.

**Step 1: Create the component**

```tsx
// web_frontend/src/components/promptlab/StageGroup.tsx
import { useState, useRef, useMemo, useCallback } from "react";
import ConversationColumn from "./ConversationColumn";
import type { ConversationColumnHandle } from "./ConversationColumn";
import type { Fixture } from "@/api/promptlab";
import type { ConversationMessage } from "@/hooks/useConversationSlot";
import { assemblePrompt } from "@/utils/assemblePrompt";

interface StageGroupProps {
  fixture: Fixture;
  systemPrompt: string;      // shared base from parent
  enableThinking: boolean;
  effort: string;
  onRemove: () => void;
  columnRefs: React.MutableRefObject<Map<string, ConversationColumnHandle>>;
}

export default function StageGroup({
  fixture,
  systemPrompt,
  enableThinking,
  effort,
  onRemove,
  columnRefs,
}: StageGroupProps) {
  const [instructions, setInstructions] = useState(fixture.instructions);
  const [context, setContext] = useState(fixture.context);
  const [contextExpanded, setContextExpanded] = useState(false);

  const fullPrompt = useMemo(
    () => assemblePrompt(systemPrompt, instructions, context),
    [systemPrompt, instructions, context],
  );

  const initialConversations = useMemo(
    () =>
      fixture.conversations.map((c) => ({
        label: c.label,
        messages: c.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      })),
    [fixture],
  );

  // Register column refs with globally-unique keys
  const setColumnRef = useCallback(
    (convLabel: string) => (handle: ConversationColumnHandle | null) => {
      const key = `${fixture.name}::${convLabel}`;
      if (handle) {
        columnRefs.current.set(key, handle);
      } else {
        columnRefs.current.delete(key);
      }
    },
    [fixture.name, columnRefs],
  );

  return (
    <div className="border-2 border-slate-300 rounded-lg overflow-hidden bg-white flex flex-col shrink-0">
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <h3 className="text-xs font-semibold text-slate-700 truncate">{fixture.name}</h3>
        <span className="text-[10px] text-slate-400">{fixture.conversations.length} chats</span>
        <button
          onClick={onRemove}
          className="ml-auto text-slate-400 hover:text-slate-600 text-sm"
          aria-label="Remove stage group"
        >
          &times;
        </button>
      </div>

      {/* Instructions editor */}
      <div className="px-3 py-2 border-b border-gray-100">
        <label className="text-[10px] font-medium text-slate-500 mb-1 block">Instructions</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full border border-gray-200 rounded p-2 text-[11px] font-mono text-slate-700 resize-y min-h-[3rem] max-h-[8rem] focus:outline-none focus:ring-1 focus:ring-blue-500"
          spellCheck={false}
        />
      </div>

      {/* Context (collapsible) */}
      <div className="px-3 py-1.5 border-b border-gray-100">
        <button
          onClick={() => setContextExpanded(!contextExpanded)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
        >
          <svg
            className={`w-2.5 h-2.5 transition-transform ${contextExpanded ? "rotate-90" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Context
          {!contextExpanded && context && (
            <span className="text-slate-400 truncate max-w-[200px]">
              — {context.slice(0, 60)}...
            </span>
          )}
        </button>
        {contextExpanded && (
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="w-full mt-1 border border-gray-200 rounded p-2 text-[11px] font-mono text-slate-700 resize-y min-h-[3rem] max-h-[12rem] focus:outline-none focus:ring-1 focus:ring-blue-500"
            spellCheck={false}
          />
        )}
      </div>

      {/* Conversation columns */}
      <div className="flex flex-1 min-h-0">
        {initialConversations.map((conv) => (
          <ConversationColumn
            key={conv.label}
            ref={setColumnRef(conv.label)}
            initialMessages={conv.messages}
            label={conv.label}
            systemPrompt={fullPrompt}
            enableThinking={enableThinking}
            effort={effort}
          />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend && npx tsc --noEmit src/components/promptlab/StageGroup.tsx`
Expected: PASS

**Step 3: Commit**

```
jj desc -m "feat: create StageGroup component for grouped conversation columns"
jj new
```

---

### Task 8: Create `SystemPromptEditor` component

**Files:**
- Create: `web_frontend/src/components/promptlab/SystemPromptEditor.tsx`

Simplified version of the old `PromptEditor.tsx`. Just the shared base system prompt — no instructions or context.

**Step 1: Create the component**

```tsx
// web_frontend/src/components/promptlab/SystemPromptEditor.tsx

interface SystemPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  isModified: boolean;
}

export default function SystemPromptEditor({
  value,
  onChange,
  onReset,
  isModified,
}: SystemPromptEditorProps) {
  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-slate-700">System Prompt</h2>
          {isModified && (
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Modified" />
          )}
        </div>
        <button
          onClick={onReset}
          disabled={!isModified}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            isModified
              ? "text-slate-600 bg-slate-100 hover:bg-slate-200"
              : "text-slate-300 bg-slate-50 cursor-default"
          }`}
        >
          Reset
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y p-3 font-mono text-xs text-slate-800 leading-relaxed border-none outline-none focus:ring-0 bg-white min-h-[4rem] max-h-[10rem]"
        spellCheck={false}
      />
    </div>
  );
}
```

**Step 2: Commit**

```
jj desc -m "feat: create SystemPromptEditor component"
jj new
```

---

### Task 9: Create `FixturePicker` component

**Files:**
- Create: `web_frontend/src/components/promptlab/FixturePicker.tsx`

Small overlay/dropdown for adding more fixtures after initial selection. Lists available fixtures, excludes already-loaded ones.

**Step 1: Create the component**

```tsx
// web_frontend/src/components/promptlab/FixturePicker.tsx
import { useState, useEffect } from "react";
import { listFixtures, loadFixture, type Fixture, type FixtureSummary } from "@/api/promptlab";

interface FixturePickerProps {
  loadedFixtureNames: string[];
  onSelect: (fixture: Fixture) => void;
  onClose: () => void;
}

export default function FixturePicker({
  loadedFixtureNames,
  onSelect,
  onClose,
}: FixturePickerProps) {
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingName, setLoadingName] = useState<string | null>(null);

  useEffect(() => {
    listFixtures()
      .then(setFixtures)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const available = fixtures.filter((f) => !loadedFixtureNames.includes(f.name));

  async function handleSelect(name: string) {
    setLoadingName(name);
    try {
      const fixture = await loadFixture(name);
      onSelect(fixture);
    } catch {
      // ignore
    } finally {
      setLoadingName(null);
    }
  }

  return (
    <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-xs font-medium text-slate-700">Add fixture</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">&times;</button>
      </div>
      {loading ? (
        <div className="p-3 text-xs text-slate-400">Loading...</div>
      ) : available.length === 0 ? (
        <div className="p-3 text-xs text-slate-400">All fixtures loaded</div>
      ) : (
        available.map((f) => (
          <button
            key={f.name}
            onClick={() => handleSelect(f.name)}
            disabled={loadingName === f.name}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-gray-50 last:border-b-0"
          >
            <div className="text-xs font-medium text-slate-800">{f.name}</div>
            <div className="text-[10px] text-slate-400">{f.module}</div>
          </button>
        ))
      )}
    </div>
  );
}
```

**Step 2: Commit**

```
jj desc -m "feat: create FixturePicker overlay for adding fixtures"
jj new
```

---

### Task 10: Rewrite `PromptLab.tsx`

**Files:**
- Modify: `web_frontend/src/views/PromptLab.tsx`

This is the biggest task. Replace the single-fixture view with the multi-conversation grid.

**Step 1: Rewrite the component**

Key changes:
- State: `stages` array of loaded `Fixture` objects instead of single `fixture`
- Shared: `systemPrompt`, `enableThinking`, `effort`
- Layout: `SystemPromptEditor` at top, then horizontal scroll of `StageGroup`s
- "Regenerate All" button in toolbar
- `FixturePicker` overlay for adding more fixtures
- Keep auth gates and initial `FixtureBrowser` as-is
- `FixtureBrowser.onSelectFixture` now adds to `stages` array

```tsx
// web_frontend/src/views/PromptLab.tsx
import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import FixtureBrowser from "@/components/promptlab/FixtureBrowser";
import SystemPromptEditor from "@/components/promptlab/SystemPromptEditor";
import StageGroup from "@/components/promptlab/StageGroup";
import FixturePicker from "@/components/promptlab/FixturePicker";
import type { ConversationColumnHandle } from "@/components/promptlab/ConversationColumn";
import { DEFAULT_SYSTEM_PROMPT } from "@/utils/assemblePrompt";
import type { Fixture } from "@/api/promptlab";

const MAX_CONCURRENT_REGENERATIONS = 10;

export default function PromptLab() {
  const { isAuthenticated, isLoading, login } = useAuth();

  // Shared state
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [enableThinking, setEnableThinking] = useState(true);
  const [effort, setEffort] = useState<"low" | "medium" | "high">("low");

  // Multi-fixture state
  const [stages, setStages] = useState<Fixture[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  // Refs to all conversation columns for "Regenerate All"
  const columnRefsMap = useRef<Map<string, ConversationColumnHandle>>(new Map());

  const handleAddFixture = useCallback((fixture: Fixture) => {
    setStages((prev) => {
      if (prev.some((s) => s.name === fixture.name)) return prev;
      return [...prev, fixture];
    });
    setShowPicker(false);
  }, []);

  const handleRemoveStage = useCallback((name: string) => {
    setStages((prev) => prev.filter((s) => s.name !== name));
  }, []);

  const handleBack = useCallback(() => {
    setStages([]);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setShowPicker(false);
  }, []);

  // Regenerate All summary state
  const [regenSummary, setRegenSummary] = useState<string | null>(null);

  const handleRegenerateAll = useCallback(async () => {
    const columns = Array.from(columnRefsMap.current.values());
    if (columns.length === 0) return;

    setRegenSummary(null);

    // Auto-select last assistant message in each column
    for (const col of columns) {
      col.autoSelectLastAssistant();
    }

    // Small delay so selection state updates
    await new Promise((r) => setTimeout(r, 50));

    // Fire regenerations with concurrency cap, track results
    let succeeded = 0;
    let failed = 0;
    const total = columns.length;
    const queue = [...columns];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (active.length < MAX_CONCURRENT_REGENERATIONS && queue.length > 0) {
        const col = queue.shift()!;
        const p = col.regenerate()
          .then(() => { succeeded++; })
          .catch(() => { failed++; })
          .finally(() => { active.splice(active.indexOf(p), 1); });
        active.push(p);
      }
      if (active.length > 0) {
        await Promise.race(active);
      }
    }

    // Show summary
    if (failed > 0) {
      setRegenSummary(`Regenerated ${succeeded}/${total} (${failed} failed)`);
    } else {
      setRegenSummary(`Regenerated ${succeeded}/${total}`);
    }
    // Auto-dismiss after 5 seconds
    setTimeout(() => setRegenSummary(null), 5000);
  }, []);

  // --- Auth gates ---

  if (isLoading) {
    return (
      <div className="py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-stone-200 rounded" />
          <div className="h-4 w-64 bg-stone-200 rounded" />
          <div className="h-32 bg-stone-200 rounded" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8">
        <h1 className="text-2xl font-bold mb-4">Prompt Lab</h1>
        <p className="mb-4 text-slate-600">
          Please sign in to access the Prompt Lab.
        </p>
        <button
          onClick={login}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  // --- Fixture browser (no stages loaded) ---

  if (stages.length === 0) {
    return (
      <div className="py-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-900">Prompt Lab</h1>
          <p className="text-sm text-slate-500 mt-1">
            Test system prompt variations against saved conversation fixtures.
          </p>
        </div>
        <FixtureBrowser onSelectFixture={handleAddFixture} />
      </div>
    );
  }

  // --- Multi-conversation grid ---

  const isPromptModified = systemPrompt !== DEFAULT_SYSTEM_PROMPT;

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 7rem)" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 py-2 shrink-0">
        <button
          onClick={handleBack}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          &larr; Back
        </button>
        <span className="text-sm text-slate-300">|</span>

        {/* LLM config */}
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={enableThinking}
            onChange={(e) => setEnableThinking(e.target.checked)}
            className="rounded border-slate-300"
          />
          Reasoning
        </label>
        {enableThinking && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Effort
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as "low" | "medium" | "high")}
              className="border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-2 relative">
          {regenSummary && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
              {regenSummary}
            </span>
          )}
          <button
            onClick={handleRegenerateAll}
            className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
          >
            Regenerate All
          </button>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1.5 rounded hover:bg-slate-200 transition-colors"
          >
            + Add
          </button>
          {showPicker && (
            <FixturePicker
              loadedFixtureNames={stages.map((s) => s.name)}
              onSelect={handleAddFixture}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
      </div>

      {/* System prompt editor */}
      <div className="shrink-0 mb-3">
        <SystemPromptEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          onReset={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
          isModified={isPromptModified}
        />
      </div>

      {/* Horizontal scroll grid of stage groups */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 h-full">
          {stages.map((fixture) => (
            <StageGroup
              key={fixture.name}
              fixture={fixture}
              systemPrompt={systemPrompt}
              enableThinking={enableThinking}
              effort={effort}
              onRemove={() => handleRemoveStage(fixture.name)}
              columnRefs={columnRefsMap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update `FixtureBrowser.tsx`**

The `FixtureBrowser` component needs no structural changes — its `onSelectFixture` callback already accepts a `Fixture` and the parent handles what to do with it. The browser only uses `FixtureSummary` (name, module, description) for display, and passes the full loaded `Fixture` to the parent. Since `FixtureSummary` didn't change, this should just work.

Note: The design's File Changes table lists `FixtureBrowser.tsx` as modified with "Support 'add more' flow", but the "add more" flow is handled entirely by the new `FixturePicker` component — `FixtureBrowser` is only used for the initial fixture selection. No changes needed to `FixtureBrowser.tsx`.

**Step 3: Build and fix type errors**

Run: `cd web_frontend && npm run build`

Fix any remaining type errors. The most likely issues:
- Import paths for moved/renamed components
- `ConversationMessage` type now exported from `useConversationSlot` instead of `ConversationPanel`

**Step 4: Commit**

```
jj desc -m "feat: rewrite PromptLab with multi-conversation grid layout"
jj new
```

---

### Task 11: Clean up old files

**Files:**
- Delete: `web_frontend/src/components/promptlab/ConversationPanel.tsx`
- Delete: `web_frontend/src/components/promptlab/PromptEditor.tsx`

**Step 1: Verify no imports reference old files**

Search for any remaining imports of `ConversationPanel` or `PromptEditor` in the codebase. There should be none after the PromptLab.tsx rewrite.

**Step 2: Delete old files**

```bash
rm web_frontend/src/components/promptlab/ConversationPanel.tsx
rm web_frontend/src/components/promptlab/PromptEditor.tsx
```

**Step 3: Final build + lint**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: PASS

Run: `cd /home/penguin/code/lens-platform/ws2 && ruff check . && .venv/bin/pytest core/promptlab/`
Expected: PASS

**Step 4: Commit**

```
jj desc -m "chore: remove old ConversationPanel and PromptEditor components"
jj new
```

---

### Task 12: Manual smoke test via Chrome DevTools MCP

**No code changes.** Verify the full flow works end-to-end:

1. Navigate to `/promptlab` — should show fixture browser
2. Click a fixture — should show the grid view with system prompt editor + one stage group
3. Click `+ Add` — should show picker overlay with remaining fixtures
4. Add second fixture — should appear as second group
5. Edit system prompt — should show modified indicator
6. Click a message in one column — should highlight with ring
7. Click Regenerate — should stream response with reasoning ABOVE the message
8. Verify scroll behavior — scroll up during streaming, confirm it doesn't snap back
9. Click Regenerate All — should fire regenerations in all columns
10. Click Back — should return to fixture browser
