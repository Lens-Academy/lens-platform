# Narrative Chat Section Scroll Enhancements

## Overview

Enhance NarrativeChatSection with improved scroll behavior, scroll-to-bottom button, and system message rendering. These features are borrowed from the deprecated ChatPanel (unified lesson) but implemented more simply.

## Goals

1. User message appears at top when sent (not bottom)
2. No auto-scroll during AI streaming
3. Scroll-to-bottom button when user scrolls up
4. System messages rendered as centered badges with icons

## Design

### Two-Wrapper Architecture

Split messages into two containers to enable CSS-only dynamic spacing:

```
┌─────────────────────────────────────┐
│ Scroll Container (onScroll)         │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Previous Messages             │  │
│  │ messages.slice(0, splitIndex) │  │
│  │ (natural height)              │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Current Exchange (min-h-full) │  │
│  │ messages.slice(splitIndex)    │  │
│  │ + pendingMessage              │  │
│  │ + streamingContent            │  │
│  │                               │  │
│  │ [Spacer flex-grow: 1]         │  │
│  └───────────────────────────────┘  │
│                                     │
│  [Scroll-to-bottom button]          │
└─────────────────────────────────────┘
```

**Why two wrappers:**
- Previous messages take natural height
- Current exchange wrapper has `min-h-full` (at least viewport height)
- Spacer with `flex-grow: 1` fills remaining space
- When content exceeds viewport, spacer becomes 0 automatically
- No JavaScript calculation needed for spacer height

### Scroll Behavior

**On send:**
1. Update `currentExchangeStartIndex` to `messages.length`
2. Scroll current exchange wrapper to top with `scrollIntoView({ block: 'start' })`
3. CSS `scroll-margin-top: 24px` provides padding from top

**During streaming:**
- No auto-scroll
- User can scroll freely to review previous messages

**Scroll-to-bottom button:**
- Track scroll position via `onScroll` handler
- Show button when `distanceFromBottom > 50px`
- Button scrolls to bottom with smooth behavior
- Positioned floating above input area

### System Messages

Render system messages as centered badges (previously filtered out):

```tsx
{msg.role === "system" ? (
  <div className="flex justify-center my-3">
    <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
      {msg.icon && <StageIcon type={msg.icon} small />}
      {msg.content}
    </span>
  </div>
) : (
  // User or assistant message rendering
)}
```

### New State

```tsx
const [currentExchangeStartIndex, setCurrentExchangeStartIndex] = useState(0);
const [showScrollButton, setShowScrollButton] = useState(false);
```

### Existing Behavior to Keep

- `hasInteracted` empty state (show placeholder until first message)
- Voice recording with volume visualization
- Auto-resizing textarea (max 200px)
- Pending message with retry on failure
- Streaming content display

## Changes Summary

| Feature | Before | After |
|---------|--------|-------|
| Scroll on send | Bottom | Top with 24px padding |
| During streaming | Auto-scroll to bottom | No auto-scroll |
| Scroll detection | None | Track position |
| Scroll button | None | Floating button when scrolled up |
| System messages | Filtered out | Centered badges with icons |
| Message layout | Single wrapper | Two wrappers (previous + current) |

## Implementation Notes

- Reference ChatPanel for StageIcon component (may need import)
- Remove `visibleMessages` filter that excluded system messages
- Test with long conversation history to verify scroll behavior
- Test streaming with user scrolled up (should not snap back)
