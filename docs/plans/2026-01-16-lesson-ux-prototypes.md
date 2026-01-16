# Interactive Lesson UX Prototypes

**Date**: 2026-01-16
**Goal**: Quick prototypes to test different interleaved content + chat checkpoint UX patterns
**Status**: Planning

## Problem Statement

Current UX has discrete stages (Article → Chat → Video → Chat) which:
1. **Disrupts flow** - stage transitions feel jarring
2. **Misses engagement timing** - can only engage learners at end of content, not mid-content

## Proposed Solution

Interleave chat checkpoints within content at preset stages, creating a more continuous learning experience.

---

## Prototype A: "Unified Scroll"

**Path**: `src/components/lesson-prototypes/prototype-a/`

**Concept**: Everything is a single scrollable page. Chat checkpoints appear inline.

### Articles
- Content renders as markdown sections
- Chat checkpoints appear **inline between sections**
- User scrolls through: Content → Chat → Content → Chat → etc.

### Videos
- Video expands to full-width in the scroll flow
- At checkpoint times, video **pauses automatically**
- Chat appears **below the paused video**
- User completes chat, clicks continue, video resumes
- Scroll position stays at video

### Pros
- Simplest mental model
- Everything is scroll position
- Works well for articles

### Cons
- Video chat below might feel disconnected
- Long videos = lots of scrolling back up

### Key Components
```
UnifiedScrollLesson.tsx
├── ScrollSection (content or chat)
├── InlineChat.tsx (chat box in scroll flow)
├── ScrollVideo.tsx (full-width video with pause points)
└── videoPausePoints: number[] (timestamps)
```

---

## Prototype B: "Sticky Video + Scroll Chat"

**Path**: `src/components/lesson-prototypes/prototype-b/`

**Concept**: Videos stick to top while chat scrolls below.

### Articles
- Same as Prototype A (inline checkpoints)

### Videos
- Video **sticks to top of viewport** (position: sticky)
- Chat sections scroll below it
- Video pauses at preset times
- Active chat section highlighted, others dimmed
- Video is the "anchor", chat happens in scroll space below

### Pros
- Video always visible during discussion
- Clear visual hierarchy
- Feels like "video lecture with discussion"

### Cons
- Takes up screen real estate
- Mobile might be cramped

### Key Components
```
StickyVideoLesson.tsx
├── StickyVideoContainer.tsx (position: sticky)
├── ChatScrollArea.tsx (scrollable chat sections below)
└── SyncManager (pause video when chat section enters view)
```

---

## Prototype C: "Modal Checkpoints"

**Path**: `src/components/lesson-prototypes/prototype-c/`

**Concept**: Video plays normally, modal overlay appears at checkpoints.

### Articles
- Same as Prototype A (inline checkpoints)

### Videos
- Video plays in normal position
- At checkpoint times, video **pauses and dims**
- **Modal/overlay appears** over the video
- Chat happens inside the modal
- Dismiss modal → video resumes

### Pros
- Closest to EdPuzzle pattern (proven UX)
- Clear "stop and reflect" moment
- Video doesn't move around

### Cons
- Modal might feel interruptive
- Chat space constrained to modal size
- Feels more like "quiz popup" than conversation

### Key Components
```
ModalCheckpointLesson.tsx
├── VideoWithOverlay.tsx
├── CheckpointModal.tsx (chat inside modal)
└── modalTriggerTimes: number[]
```

---

## Prototype D: "Side-by-Side Video Chat"

**Path**: `src/components/lesson-prototypes/prototype-d/`

**Concept**: When video pauses, chat slides in next to it (not below). Communicates "still in video, just pausing."

### Articles
- Same as Prototype A (inline checkpoints)

### Videos
- Video plays at full/large width
- At checkpoint: video **pauses and shrinks** to ~60% width
- Chat panel **slides in from right** to fill remaining ~40%
- Visual message: "we're pausing within the video"
- Complete chat → chat slides out → video expands back to full width and resumes

### Pros
- Clear visual metaphor: shrinking = pausing for discussion
- Video stays visible during chat
- Feels like "conversation alongside video" not "video stopped for quiz"

### Cons
- Animation complexity
- Responsive design challenges
- Chat width constrained

### Layout States
```
Playing:        [========== VIDEO ==========]

Paused:         [==== VIDEO ====][== CHAT ==]
                     (60%)          (40%)
```

### Key Components
```
SideBySideLesson.tsx
├── AdaptiveVideoContainer.tsx (animates width)
├── SlideInChat.tsx (slides in/out)
├── VideoController (manages pause/play + layout state)
└── checkpointTimes: number[]
```

---

## Implementation Plan

### Shared Infrastructure
All prototypes share:
- Same lesson data format (stages with checkpoint markers)
- Same chat API (`sendMessage`, streaming)
- Same video player base (YouTube wrapper)
- Same article renderer (markdown)

### File Structure
```
src/components/lesson-prototypes/
├── shared/
│   ├── useCheckpoints.ts (checkpoint timing logic)
│   ├── useChatSession.ts (chat state management)
│   └── MarkdownContent.tsx (article renderer)
├── prototype-a/
│   └── UnifiedScrollLesson.tsx
├── prototype-b/
│   └── StickyVideoLesson.tsx
├── prototype-c/
│   └── ModalCheckpointLesson.tsx
└── prototype-d/
    └── SideBySideLesson.tsx
```

### Routes
```
/lesson/:slug/prototype-a
/lesson/:slug/prototype-b
/lesson/:slug/prototype-c
/lesson/:slug/prototype-d
```

### Evaluation Criteria
After building, evaluate each prototype on:
1. **Flow** - Does it feel continuous or jarring?
2. **Engagement timing** - Do checkpoints feel natural?
3. **Video UX** - Is it clear we're "pausing within" vs "done with video"?
4. **Mobile** - Does it work on smaller screens?
5. **Implementation complexity** - Is it maintainable?

---

## Next Steps
1. Create shared infrastructure
2. Build Prototype A first (simplest)
3. Build D (most novel/interesting)
4. Build B and C if time permits
5. Test with real lesson content
6. Choose winner and polish
