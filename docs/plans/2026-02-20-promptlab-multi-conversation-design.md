# Prompt Lab Multi-Conversation Redesign

## Problem

The current Prompt Lab tests one system prompt against one conversation at a time. Facilitators need to:

1. Test a system prompt change across many conversations simultaneously (5-50)
2. See conversations grouped by stage (same instructions + context)
3. Edit the three prompt components independently: base system prompt, per-stage instructions, per-stage context
4. Fix UI issues: reasoning display jumps position between streaming and final state; auto-scroll locks user to bottom during streaming

## Decisions

- **Data source**: Manual JSON fixtures only (no database export)
- **Concurrency**: Simultaneous regeneration, capped at 10 concurrent API calls
- **Editability**: All three prompt parts editable (system prompt, instructions, context)
- **Backward compat**: None needed, migrate the 2 existing fixture files
- **Architecture**: Multi-slot state array with `useConversationSlot` hook (Approach A)

## Data Model

### Fixture JSON format (new)

```json
{
  "name": "Deceptive Alignment Discussion",
  "module": "cognitive-superpowers",
  "description": "Student discussions about deceptive alignment after reading about mesa-optimization",
  "instructions": "Guide the student through a discussion of deceptive alignment. Help them understand the distinction between genuinely aligned vs appearing aligned during training.",
  "context": "Mesa-optimization occurs when a learned model is itself an optimizer...",
  "conversations": [
    {
      "label": "Confused about the distinction",
      "messages": [
        {"role": "user", "content": "I'm confused about deceptive alignment..."},
        {"role": "assistant", "content": "Great question..."}
      ]
    },
    {
      "label": "Already knows mesa-optimization",
      "messages": [
        {"role": "user", "content": "So this is basically when the model..."},
        {"role": "assistant", "content": "You've got a good grasp..."}
      ]
    }
  ]
}
```

Changes from current format:

| Old | New | Reason |
|-----|-----|--------|
| `systemPrompt.base` | Removed (hardcoded default in frontend) | Same for all stages in production |
| `systemPrompt.instructions` | `instructions` (top-level) | Clearer naming, per-fixture |
| `previousContent` | `context` | Clearer naming |
| `messages` (single array) | `conversations[]` (array of {label, messages}) | Multiple conversations per stage |

### Backend types (`core/promptlab/fixtures.py`)

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

### Frontend types (`src/api/promptlab.ts`)

```ts
interface FixtureConversation {
  label: string;
  messages: FixtureMessage[];
}

interface Fixture {
  name: string;
  module: string;
  description: string;
  instructions: string;
  context: string;
  conversations: FixtureConversation[];
}
```

## Layout

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ← Back   Reasoning ☑  Effort [Low ▾]              [Regenerate All]  [+ Add]  │
├────────────────────────────────────────────────────────────────────────────────┤
│ System Prompt                                                [Modified ●]     │
│ ┌──────────────────────────────────────────────────────────────────────────┐   │
│ │ You are a tutor helping someone learn about AI safety. Each piece of    │   │
│ │ content has different topics and learning objectives.                    │   │
│ └──────────────────────────────────────────────────────────────────────────┘   │
├────────────────────────────────────────────────────────────── scroll ▶ ───────┤
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━ │
│ ┃ Deceptive Alignment Discussion            3 chats   ┃ Welcome Chat         │
│ ┃ ┌─────────────────────────────────────────────────┐  ┃ ┌─────────────────── │
│ ┃ │ Instructions: (editable textarea)               │  ┃ │ Instructions:      │
│ ┃ │ Guide the student through a discussion of...    │  ┃ │ What brings you to │
│ ┃ └─────────────────────────────────────────────────┘  ┃ └─────────────────── │
│ ┃ Context: Mesa-optimization occurs when a lea... [▾]  ┃ Context: Welcome..  │
│ ┃                                                      ┃                      │
│ ┃ ┌────────────┐ ┌────────────┐ ┌────────────┐        ┃ ┌────────────┐ ┌──── │
│ ┃ │ Confused   │ │ Knows mesa │ │ Off-topic  │        ┃ │ Eager      │ │ Relu │
│ ┃ │            │ │            │ │            │        ┃ │            │ │      │
│ ┃ │ Student:   │ │ Student:   │ │ Student:   │        ┃ │ Student:   │ │ Stud │
│ ┃ │ I'm confu- │ │ So this is │ │ Hey can    │        ┃ │ I'm so ex- │ │ I gu │
│ ┃ │ sed about  │ │ basically  │ │ you help   │        ┃ │ cited to   │ │ ess  │
│ ┃ │ deceptive  │ │ when the   │ │ me with my │        ┃ │ start!     │ │ I'm  │
│ ┃ │ alignment  │ │ model is   │ │ homework?  │        ┃ │            │ │ here │
│ ┃ │            │ │            │ │            │        ┃ │ Tutor:     │ │      │
│ ┃ │ Tutor:     │ │ Tutor:     │ │ Tutor:     │        ┃ │ Welcome!   │ │ Tuto │
│ ┃ │ Great q!   │ │ You've got │ │ I'd love   │        ┃ │ That enth- │ │ No p │
│ ┃ │ The disti- │ │ a good     │ │ to help... │        ┃ │ usiasm is  │ │ ress │
│ ┃ │ nction is  │ │ grasp...   │ │            │        ┃ │ great...   │ │ ure! │
│ ┃ │            │ │            │ │            │        ┃ │            │ │      │
│ ┃ │ [click to  │ │ [click to  │ │ [click to  │        ┃ │ [Regen-    │ │      │
│ ┃ │  select]   │ │  select]   │ │  select]   │        ┃ │  erate]    │ │      │
│ ┃ │ [follow-up]│ │ [follow-up]│ │ [follow-up]│        ┃ │ [follow-up]│ │      │
│ ┃ └────────────┘ └────────────┘ └────────────┘        ┃ └────────────┘ └──── │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━ │
└────────────────────────────────────────────────────────────────────────────────┘
```

Key layout details:

- **System prompt** at top, full-width, always visible. Shared across all conversations.
- **Horizontal scroll** area below containing all stage groups side by side.
- **Stage groups** are bordered frames (`┏━━┓`). Instructions textarea + collapsible context appear once per group, above that group's conversation columns.
- **Conversation columns** are fixed-width (~280px) within their group. Each is independently scrollable vertically.
- Column header shows the conversation label (e.g., "Confused about the distinction").

### Flow

1. **Start**: Fixture browser shows cards (like today)
2. **Select fixture**: Loads it as a stage group in the grid. The grid view replaces the browser.
3. **Add more**: `[+ Add]` button opens a fixture picker overlay to add another stage group.
4. **Remove**: Each stage group has an `[×]` to remove it.
5. **Back**: `← Back` clears everything and returns to the fixture browser.

## Component Architecture

```
PromptLab.tsx (view)
├── FixtureBrowser.tsx (initial fixture selection — existing, minor changes)
├── SystemPromptEditor.tsx (shared base prompt textarea — renamed from PromptEditor)
├── FixturePicker.tsx (overlay for adding more fixtures — new)
└── ConversationGrid (horizontal scroll container — inline in PromptLab)
    └── StageGroup.tsx (bordered frame per fixture — new)
        ├── StageHeader (instructions textarea + collapsible context — inline)
        └── ConversationColumn.tsx (per-conversation — new, extracted from ConversationPanel)
            ├── Messages list with selection
            ├── Streaming display (with fixed reasoning position)
            └── Follow-up input
```

### Hook: `useConversationSlot`

Extracted from current PromptLab.tsx handlers. Encapsulates per-conversation state:

```ts
function useConversationSlot(initialMessages: ConversationMessage[]) {
  // State
  const [messages, setMessages] = useState(initialMessages);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [hasRegenerated, setHasRegenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Actions
  async function regenerate(fullSystemPrompt: string, enableThinking: boolean, effort: string) { ... }
  async function sendFollowUp(message: string, fullSystemPrompt: string, enableThinking: boolean, effort: string) { ... }
  function selectMessage(index: number) { ... }
  function reset(newMessages: ConversationMessage[]) { ... }

  return { messages, selectedMessageIndex, isStreaming, streamingContent, streamingThinking,
           hasRegenerated, error, regenerate, sendFollowUp, selectMessage, reset };
}
```

The `fullSystemPrompt` parameter is the assembled prompt (base + instructions + context), built by the caller (StageGroup) before passing to the hook's regenerate/sendFollowUp.

## Prompt Assembly

Client-side, matching production `_build_system_prompt()` in `chat.py`:

```ts
function assemblePrompt(systemPrompt: string, instructions: string, context: string): string {
  let prompt = systemPrompt;
  if (instructions) {
    prompt += "\n\nInstructions:\n" + instructions;
  }
  if (context) {
    prompt += "\n\nThe user just engaged with this content:\n---\n" + context + "\n---";
  }
  return prompt;
}
```

The API endpoints remain unchanged — they still receive a single `systemPrompt` string.

## Regenerate All

Button in the toolbar. When clicked:

1. For each conversation slot that has messages with at least one assistant message:
   - Auto-select the last assistant message (if not already selected)
   - Fire regeneration
2. Cap at 10 concurrent API calls (use a semaphore/queue)
3. Each column streams independently
4. After all complete, a brief summary shows: "Regenerated 8/10 (2 errors)"

## Streaming Fixes

### Reasoning position consistency

**Current bug**: During streaming, thinking shows ABOVE the response bubble (ConversationPanel lines 257-265). After streaming completes, thinking is stored in `msg.thinkingContent` and renders BELOW the bubble (lines 215-242). The position jumps.

**Fix**: Always render reasoning ABOVE the message bubble, both during streaming and after.

During streaming:
```
▸ Reasoning (auto-expanded during streaming)
  [streaming thinking text]
┌──────────────────┐
│ Tutor             │
│ [streaming text]  │
└──────────────────┘
```

After done:
```
▸ Show reasoning (collapsed, click to expand)
  [stored thinking text]
┌──────────────────┐
│ Tutor             │
│ [final text]      │
└──────────────────┘
```

Same position. During streaming, the reasoning section is auto-expanded above the message. After done, it collapses and becomes a toggle, still above the message.

### Scroll behavior

**Current bug**: `useEffect` on `isStreaming`/`streamingContent` unconditionally sets `scrollTop = scrollHeight`, preventing user from scrolling up during streaming.

**Fix**: Track whether the user has scrolled up.

```ts
const [userScrolledUp, setUserScrolledUp] = useState(false);

// On scroll event
function handleScroll(e) {
  const el = e.currentTarget;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  setUserScrolledUp(!atBottom);
}

// Auto-scroll only when user hasn't scrolled up
useEffect(() => {
  if (isStreaming && !userScrolledUp && scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [isStreaming, streamingContent, streamingThinking, userScrolledUp]);
```

When `userScrolledUp && isStreaming`, show a small "↓" button at the bottom of the column that scrolls to bottom when clicked.

## API Changes

### Backend

Minimal changes:

- `core/promptlab/fixtures.py` — Update `Fixture`, `FixtureSummary` types and loader to match new JSON format (`instructions`, `context`, `conversations[]`)
- `core/promptlab/fixtures/*.json` — Migrate 2 existing files to new format

No changes to regenerate/continue endpoints (they still receive `systemPrompt` string + `messages` array).

### Frontend API client

- `src/api/promptlab.ts` — Update `Fixture` interface to match new format. `regenerateResponse()` and `continueConversation()` remain unchanged.

## Default System Prompt

The base system prompt is currently hardcoded in `chat.py`:

```
You are a tutor helping someone learn about AI safety. Each piece of content (article, video) has different topics and learning objectives.
```

This becomes the default value for the shared system prompt editor. It's stored as a constant in the frontend (e.g., `DEFAULT_SYSTEM_PROMPT` in PromptLab.tsx). Fixtures no longer carry the base prompt — it was always the same across all of them.

## File Changes

### Modified

| File | Change |
|------|--------|
| `core/promptlab/fixtures.py` | Update types + loader for new format |
| `core/promptlab/fixtures/cognitive-superpowers-chat-1.json` | Migrate to new format |
| `core/promptlab/fixtures/cognitive-superpowers-chat-2.json` | Migrate to new format |
| `src/api/promptlab.ts` | Update Fixture types |
| `src/views/PromptLab.tsx` | Major rewrite: multi-slot, new layout, prompt assembly |

### New

| File | Purpose |
|------|---------|
| `src/components/promptlab/StageGroup.tsx` | Bordered group frame with instructions + context editors + conversation columns |
| `src/components/promptlab/ConversationColumn.tsx` | Per-conversation column (replaces ConversationPanel, fixes reasoning + scroll) |
| `src/components/promptlab/SystemPromptEditor.tsx` | Shared base prompt editor (replaces PromptEditor, simplified) |
| `src/components/promptlab/FixturePicker.tsx` | Overlay for adding more fixtures after initial selection |
| `src/hooks/useConversationSlot.ts` | Per-conversation state and streaming logic hook |
| `src/utils/assemblePrompt.ts` | Prompt assembly utility mirroring `_build_system_prompt()` |

### Deleted

| File | Reason |
|------|--------|
| `src/components/promptlab/ConversationPanel.tsx` | Replaced by ConversationColumn.tsx |
| `src/components/promptlab/PromptEditor.tsx` | Replaced by SystemPromptEditor.tsx |

### Unchanged

| File | Reason |
|------|--------|
| `src/components/promptlab/FixtureBrowser.tsx` | No changes needed — "add more" flow handled by new FixturePicker component |
