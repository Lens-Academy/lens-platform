# Lesson Back Navigation Design

## Overview

Add reference-mode navigation allowing users to review previous articles and videos without affecting their lesson progress.

## Mental Model

Users progress linearly through stages. At any point, they can **review** previous articles or videos without affecting their progress. Chat stages are forward-only (history visible by scrolling, but not "revisitable" as a stage).

**Key distinction:**
- "Current stage" = where you are in the lesson (actual progress)
- "Viewing stage" = what content you're looking at (can differ when reviewing)

## Navigation States

| State | Back Arrow | Forward Arrow | Return Button | Stage Indicator |
|-------|-----------|---------------|---------------|-----------------|
| At current stage | Shows if previous article/video exists | Hidden | Hidden | "Stage 3 of 5" |
| Reviewing past content | Shows if earlier article/video exists | Shows if later article/video exists (before current) | Shows "Return to current" | "Stage 3 of 5" (unchanged) |

Navigation skips chat stages entirely - back/forward only move between article and video stages.

## UI Layout

### Header when reviewing:

```
┌─────────────────────────────────────────────────────────────────┐
│  [←] [→]  Stage 3 of 5  │  Reviewing previous material  [Return to current]  │
└─────────────────────────────────────────────────────────────────┘
```

### Header at current stage:

```
┌─────────────────────────────────────────────────────────────────┐
│  [←]      Stage 3 of 5                                    [Skip →]  │
└─────────────────────────────────────────────────────────────────┘
```

- Back/forward arrows left-aligned, next to stage indicator
- "Reviewing" indicator right-aligned, replaces Skip button while reviewing
- Skip button hidden while reviewing

### Arrow states:
- Back arrow: disabled (grayed) if no previous article/video exists
- Forward arrow: disabled if viewing the most recent article/video before current

## Implementation Approach

**Frontend-only change.** No backend modifications needed.

### New frontend state:

```typescript
// In UnifiedLesson.tsx
const [viewingStageIndex, setViewingStageIndex] = useState<number | null>(null);

// null = viewing current stage (normal mode)
// number = reviewing a past stage (reference mode)
```

### Derived values:

```typescript
const isReviewing = viewingStageIndex !== null;
const displayStageIndex = viewingStageIndex ?? session.current_stage_index;
```

### Navigation logic:

```typescript
// Get indices of article/video stages before current
const reviewableStages = lesson.stages
  .map((stage, i) => ({ stage, index: i }))
  .filter(({ stage, index }) =>
    stage.type !== 'chat' && index < session.current_stage_index
  );

function goBack() {
  const currentViewing = viewingStageIndex ?? session.current_stage_index;
  const earlier = reviewableStages.filter(s => s.index < currentViewing);
  if (earlier.length) setViewingStageIndex(earlier[earlier.length - 1].index);
}

function goForward() {
  const currentViewing = viewingStageIndex ?? session.current_stage_index;
  const later = reviewableStages.filter(s => s.index > currentViewing);
  if (later.length) setViewingStageIndex(later[0].index);
}

function returnToCurrent() {
  setViewingStageIndex(null);
}
```

## Content Panel Behavior

**When reviewing (viewingStageIndex !== null):**
- ContentPanel receives the reviewed stage's data and content
- For articles: fetch and display the article content
- For videos: show the video player with that stage's videoId/timestamps
- "Next" button and video auto-advance are **disabled**

**When at current stage (viewingStageIndex === null):**
- Normal behavior: ContentPanel shows current stage
- "Next" button and video completion advance the lesson as usual

## Chat Panel Behavior

**Input always enabled.** Users can message the AI at any time - during articles, videos, chat stages, and while reviewing.

### Contextual disclaimer (when not in a chat stage):

```
┌─────────────────────────────────────────────────────────────────┐
│  Feel free to ask questions. The focus is on the content.      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Type a message...                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

- Disclaimer shown during article stages, video stages, and while reviewing
- Disclaimer hidden during chat stages (chat *is* the focus)
- Exact wording TBD through iteration

### AI behavior:
- `transition_to_next` tool only available during chat stages
- During content stages, AI responds helpfully but cannot advance the lesson
- System prompt may need adjustment to inform AI of current context

## Edge Cases

- **First stage is article/video:** Back arrow disabled
- **All previous stages are chat:** Back arrow disabled
- **User on chat stage, previous was article:** Back arrow enabled, chat input remains enabled
- **User can't complete lesson while reviewing:** Next/video-advance disabled in review mode

## Summary of Changes

| Component | Change |
|-----------|--------|
| `UnifiedLesson.tsx` | Add `viewingStageIndex` state, navigation handlers |
| Header | Add back/forward arrows, "Reviewing" indicator |
| `ContentPanel` | Receive `displayStageIndex` content, disable Next when reviewing |
| `ChatPanel` | Always enable input, add contextual disclaimer |
| Backend | No changes |
