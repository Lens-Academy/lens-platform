# One Tutor, Two Positions — Chat Sidebar Redesign

## Problem

Two independent chat implementations share message state but duplicate everything else:

- **ChatSidebar** uses shared `ChatMessageList` + `ChatInputArea` (clean)
- **NarrativeChatSection** is a 733-line monolith with its own message rendering, textarea, voice recording, and scroll mechanics

Module.tsx bridges them with ~80 lines of auto-open/close/scroll-reopen heuristics threaded through props.

## Design

### Mental Model

One AI tutor that physically moves between two positions:

- **Sidebar** — always available while reading article sections (desktop: absolute+sticky right of article; mobile: floating button → overlay)
- **Inline** (×N) — when the user scrolls to an explicit chat section, the tutor moves from sidebar to center. Multiple inline sections can exist per page.

Shared chat history, system prompt changes based on current segment. The input bar is the visual anchor that "moves" between positions (aspirational: FLIP animation; v1: collapse sidebar to icon).

### Architecture

```
useTutorChat()                    ← one hook, one state
  ├── ChatSidebarShell            ← renders ChatMessageList + ChatInputArea
  └── ChatInlineShell (×N)        ← renders ChatMessageList + ChatInputArea
        each with startIndex,
        expand/collapse, scroll logic
```

### `useTutorChat()` hook

Owns:
- `messages`, `pendingMessage`, `streamingContent`, `isLoading`
- `sendMessage(content)`, `retryMessage()`
- `activeSurface: { type: "sidebar" } | { type: "inline", sectionIndex: number }`
- `inputText` + `setInputText` (shared — draft follows the tutor)
- API calls (`sendMessage`, `getChatHistory`)

### `activeSurface` transitions

- Scroll position enters an inline chat section → `{ type: "inline", sectionIndex }` → sidebar collapses to icon
- Scroll position leaves all inline sections → `{ type: "sidebar" }` → sidebar reopens (if user had it open)
- User sends message in inline section → locks to that inline section
- First article section → sidebar auto-opens once, then remembers toggle

### Both shells use shared components

- `ChatMessageList` — renders messages (already exists)
- `ChatInputArea` — renders input + voice (already exists)

### ChatInlineShell (~100 lines, replaces 733-line NarrativeChatSection)

Wraps `ChatMessageList` + `ChatInputArea` with:
- `startIndex` slicing (show only this section's messages onward)
- Expand/collapse to see full history
- Min-height/scroll-ratchet logic (keep or simplify)

### Mobile

Same model. Floating button for sidebar → overlay. Inline sections render inline. `activeSurface` drives which is active.

## What gets deleted

- NarrativeChatSection's duplicated message rendering (~300 lines)
- NarrativeChatSection's duplicated input form (~150 lines)
- Module.tsx's auto-open/close/scroll-reopen heuristics (~80 lines) — replaced by `activeSurface` logic inside the hook
- Most prop threading from Module.tsx into both components

## What stays

- `ChatMessageList`, `ChatInputArea`, `ChatMarkdown` — shared components are good
- Absolute+sticky sidebar positioning (layout work from `qtqksqzn`)
- Expand/collapse UX concept for inline chat (simplified)
- `DoneReadingButton` (separate concern)
