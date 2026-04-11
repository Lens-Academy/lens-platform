# Phase 4: Chat Interface - Context

**Gathered:** 2026-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the AI chatbot work on mobile — input remains visible above keyboard, messages are readable, touch interactions are smooth. This phase focuses on mobile adaptation of the existing chat component, not new chat features.

</domain>

<decisions>
## Implementation Decisions

### Input bar behavior
- Send + microphone buttons (both visible, 44px touch targets)
- Claude's discretion: docking position (fixed bottom vs below messages)
- Claude's discretion: auto-scroll behavior when input focuses
- Claude's discretion: visual styling (distinct bar vs floating pill)

### Message layout
- Different colors for user vs AI messages (user one color, AI another)
- Timestamps shown on tap/hover only (not always visible)
- AI response generation: brief typing indicator, then streaming text
- Full display for long responses (no truncation, user scrolls)

### Swipe navigation
- **Removed from scope**: No swipe left/right between chat stages
- Claude's discretion: any useful swipe gestures (e.g., swipe to dismiss keyboard)

### Keyboard handling
- Input auto-expands for multi-line messages (up to a max height)
- Haptic feedback when sending a message (consistent with Phase 3)
- Claude's discretion: viewport resize vs push-up behavior
- Claude's discretion: tap-outside-to-dismiss-keyboard behavior

### Claude's Discretion
- Input bar docking position and visual styling
- Keyboard adjustment strategy (resize vs push up)
- Tap-outside behavior for keyboard dismissal
- Auto-scroll to latest messages on focus
- Any swipe gestures that improve UX

</decisions>

<specifics>
## Specific Ideas

- Haptic feedback should match Phase 3 implementation (10ms default duration)
- 44px touch targets for send and microphone buttons per iOS HIG
- Typing indicator should feel natural, not jarring, before streaming begins

</specifics>

<deferred>
## Deferred Ideas

- Swipe navigation between lesson stages — user explicitly removed from this phase
- Voice input functionality — microphone button present but actual voice features are future work

</deferred>

---

*Phase: 04-chat-interface*
*Context gathered: 2026-01-22*
