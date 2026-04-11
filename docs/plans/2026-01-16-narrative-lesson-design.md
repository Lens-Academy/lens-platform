# NarrativeLesson Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new lesson format called NarrativeLesson - a single vertically-scrolling experience where content (articles/videos) flows continuously with interleaved authored text and AI chat sections.

**Key Principle:** Reuse existing components and code wherever possible. Do not reinvent the wheel. Features like markdown rendering with bold/superscript, video player controls, scroll behavior, chat message formatting, and auto-pause logic already exist in the codebase.

**Platform:** Next.js (App Router) in `web_frontend_next/`. This is the production frontend - do NOT use the legacy `web_frontend/` (Vite/React).

---

## Overview

### What we're building

A continuous vertical scroll lesson where:
- Articles and videos are the main content (tracked in progress)
- Authored text blocks provide introductions, questions, and summaries
- Chat sections appear interleaved within content, all sharing one conversation
- A progress sidebar on the left shows where you are in the lesson

### Mental model

"I'm going through this article/video now, with interleaved help from a chatbot."

- Progress tracks **content** (articles/videos), not chat
- Article Part 1 → Chat → Article Part 2 = **one** progress marker
- Chat is a helper woven into the content experience

---

## Visual Layout

```
┌────────────────────────────────────────────────────────────┐
│  [Header: Lesson title, exit button]                       │
├────────┬───────────────────────────────────────────────────┤
│        │                                                   │
│        │  ┌─────────────────────────────────────┐          │
│        │  │  Authored text block                │  ← white │
│  ┌──┐  │  │  (introduction)                     │    bg    │
│  │📄│  │  └─────────────────────────────────────┘          │
│  └──┘  │                                                   │
│   │    │  ┌─────────────────────────────────────┐          │
│   │    │  │ ┌─────────────────────────────────┐ │          │
│   ●    │  │ │                                 │ │  ← gray  │
│   │    │  │ │  Article content                │ │    bg    │
│  ┌──┐  │  │ │  (embedded card feel)           │ │  (card)  │
│  │🎬│  │  │ │                                 │ │          │
│  └──┘  │  │ └─────────────────────────────────┘ │          │
│   │    │  └─────────────────────────────────────┘          │
│   ○    │                                                   │
│   │    │  ┌─────────────────────────────────────┐          │
│        │  │  Authored question text             │  ← white │
│        │  └─────────────────────────────────────┘    bg    │
│        │                                                   │
│        │  ┌─────────────────────────────────────┐          │
│        │  │  Chat section (75vh max)            │          │
│        │  │  ┌───────────────────────────────┐  │          │
│        │  │  │ Messages (scroll internally)  │  │          │
│        │  │  ├───────────────────────────────┤  │          │
│        │  │  │ [Input]                 [Send]│  │          │
│        │  │  └───────────────────────────────┘  │          │
│        │  └─────────────────────────────────────┘          │
│        │                                                   │
└────────┴───────────────────────────────────────────────────┘
```

### Progress Sidebar (~60-80px wide)

- Icons for each section (article icon, video icon) at readable size
- Vertical line connecting icons
- Filled portion of line shows progress through lesson
- Current section icon highlighted
- Clicking icon scrolls to that section
- Reuse existing sidebar icon styles where possible

### Content Widths

| Element | Width | Background |
|---------|-------|------------|
| Authored text | ~700px max, centered | White/transparent |
| Article content | ~700px max, centered | Light gray card (embedded feel) |
| Video player | 80% width, centered | Light gray card |
| Chat section | ~700px max, centered | White or subtle border |

---

## Chat Behavior

### Shared State

All chat sections throughout the lesson render the **same React state**. They are not separate conversations - they are windows into one ongoing dialogue.

- One `ChatState` object lifted to lesson level
- All chat sections receive same state via context or props
- Typing in any chat section updates shared state
- All chat sections re-render together

### Scroll Behavior

- Chat container: `max-height: 75vh`, `overflow-y: auto`
- Scrolling inside chat scrolls messages
- Scrolling outside chat bounds scrolls the page
- New messages auto-scroll chat to bottom

### Layout

Classic chat layout:
- Messages stack above
- Input pinned at bottom of container

### Reuse

- Reuse existing chat message rendering (bold text, markdown formatting)
- Reuse existing chat input component
- Reuse existing streaming message display logic

---

## Content Model (YAML Format)

```yaml
format: narrative
slug: intelligence-feedback-loop
title: "The Intelligence Feedback Loop"

sections:
  # Article section with interleaved content
  - type: article
    source: articles/tim-urban-ai-revolution-1.md
    label: "The AI Revolution"  # Progress sidebar label
    segments:
      - text: |
          Welcome to the first lesson. We'll start with Tim Urban's famous
          essay on AI and exponential progress.

          As you read, pay attention to the concept of "Die Progress Units" -
          it's a memorable way to think about accelerating change.

      - from: "What does it feel like"
        to: "## The Far Future"

      - text: |
          **Reflection question:**

          Urban describes bringing someone from 1750 to today. What do you
          think would shock them most?

      - chat

      - from: "## The Far Future"
        to: "## What Is AI?"

      - text: |
          Urban introduces **exponential thinking** vs **linear thinking**.
          Let's make sure you've got it.

      - chat

      - from: "## What Is AI?"
        to: "### Where We Are Currently"

  # Video section with interleaved content
  - type: video
    videoId: "pYXy-A4siMw"
    label: "Intro to AI Safety"
    segments:
      - text: |
          Now let's watch Robert Miles explain these concepts visually.

      - from: 0
        to: 180

      - text: |
          **Quick check:** Can you summarize ANI vs AGI vs ASI?

      - chat

      - from: 180
        to: 360

      - text: |
          ## Summary

          Key takeaways:
          - Progress is exponential, not linear
          - We're in the ANI era
          - AGI → ASI transition could be rapid
```

### Segment Types

| Type | Description |
|------|-------------|
| `text:` | Authored markdown (intros, summaries, questions) |
| `from:/to:` | Article excerpt or video time range |
| `chat` | Chat section appears here |

---

## Component Structure

```
web_frontend_next/src/
├── views/
│   └── NarrativeLesson.tsx           # Main view (like UnifiedLesson.tsx)
├── components/narrative-lesson/
│   ├── ProgressSidebar.tsx           # Left sidebar with icons
│   ├── NarrativeContent.tsx          # Scrollable content area
│   ├── ArticleEmbed.tsx              # Embedded article card (gray bg)
│   ├── VideoEmbed.tsx                # Inline video player (80% width)
│   ├── AuthoredText.tsx              # Our written content (white bg)
│   └── NarrativeChatSection.tsx      # Chat with shared state (75vh max)
├── hooks/
│   └── useNarrativeLessonState.ts    # Shared chat state, progress tracking
├── types/
│   └── narrative-lesson.ts           # TypeScript types for narrative format
└── app/narrative/[lessonId]/
    └── page.tsx                      # Next.js App Router page
```

### Existing Components to Reuse (from `web_frontend_next/src/components/unified-lesson/`)

| Existing Component | What to Reuse |
|-------------------|---------------|
| `ChatPanel.tsx` | Chat message rendering, streaming display, voice recording, input handling |
| `ArticlePanel.tsx` | Markdown rendering with `react-markdown`, `remark-gfm`, `rehype-raw` |
| `VideoPlayer.tsx` | YouTube player, time ranges, progress bar, auto-pause, fade effects |
| `IntroductionBlock.tsx` | Styled intro text blocks |
| `StageProgressBar.tsx` | `StageIcon` component for article/video icons |
| `LessonDrawer.tsx` | Drawer UI patterns, stage list styling |

### Existing Hooks to Reuse (from `web_frontend_next/src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useAnonymousSession.ts` | Session management for anonymous users |
| `useAuth.ts` | Authentication state |
| `useActivityTracker.ts` | Activity tracking for analytics |
| `useVideoActivityTracker.ts` | Video-specific activity tracking |

### Existing API to Reuse (from `web_frontend_next/src/api/lessons.ts`)

- `createSession()` - Create lesson session
- `getSession()` - Fetch session state
- `sendMessage()` - Send chat message (streaming)
- `advanceStage()` - Progress to next stage

**Do NOT reimplement:**
- Markdown rendering (bold, italic, superscript, links, images) - use `ArticlePanel` patterns
- Video player controls and progress bar - use `VideoPlayer`
- Video auto-pause on scroll away - already in `VideoPlayer`
- Chat message formatting - use `ChatPanel` message rendering
- Chat streaming display - use `ChatPanel` streaming logic
- Voice recording/transcription - use `ChatPanel` recording logic

---

## Data Flow

```
NarrativeLesson (view)
  │
  ├── chatState (lifted) ────────────────┐
  │   - messages: ChatMessage[]          │
  │   - streamingContent: string         │
  │   - isLoading: boolean               │
  │                                      │
  ├── ProgressSidebar                    │
  │     └── sections[], currentSection   │
  │     └── scrollProgress (0-1)         │
  │                                      │
  └── NarrativeContent (scrollable)      │
        ├── AuthoredText                 │
        ├── ArticleEmbed                 │
        ├── NarrativeChatSection ←───────┤ (receives chatState)
        ├── ArticleEmbed                 │
        ├── AuthoredText                 │
        ├── NarrativeChatSection ←───────┤ (same chatState)
        ├── VideoEmbed                   │
        └── ...                          │
```

**State Management Pattern:**
```tsx
// In NarrativeLesson.tsx (similar to UnifiedLesson.tsx)
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [streamingContent, setStreamingContent] = useState("");
const [isLoading, setIsLoading] = useState(false);

// Pass to all NarrativeChatSection instances
<NarrativeChatSection
  messages={messages}
  streamingContent={streamingContent}
  isLoading={isLoading}
  onSendMessage={handleSendMessage}
/>
```

---

## Backend Changes

**Minimal changes needed:**

1. New API endpoint to fetch lessons in narrative format (or adapt existing endpoint in `web_api/routes/`)
2. Optionally: Include lesson progress context in chat API so AI knows what user has read

**Reuse existing:**
- Chat API (`sendMessage` in `web_frontend_next/src/api/lessons.ts`)
- Session management (`createSession`, `getSession`)
- Article/video content fetching (backend already handles this)

---

## What's NOT Changing

- Backend chat API (`web_api/`)
- Educational content storage structure (`educational_content/`)
- Article markdown format (YAML frontmatter + content)
- Video transcript format
- Existing `unified-lesson/` components (NarrativeLesson is additive)

## What IS New

- `web_frontend_next/src/components/narrative-lesson/` folder
- `web_frontend_next/src/views/NarrativeLesson.tsx`
- `web_frontend_next/src/app/narrative/[lessonId]/page.tsx` (App Router page)
- New YAML format with `format: narrative` in `educational_content/lessons/`
- Shared chat state architecture across multiple chat appearances

---

## Implementation Notes

1. **Start by auditing existing components** - Before writing any new code, identify all reusable pieces from `web_frontend_next/src/components/unified-lesson/`. Copy patterns, import shared utilities.

2. **Use "use client" directive** - NarrativeLesson and its components need client-side interactivity. Add `"use client"` at top of files that use hooks or browser APIs.

3. **Shared chat state** - Lift state to `NarrativeLesson.tsx`. All `NarrativeChatSection` instances receive the same `messages`, `streamingContent`, `isLoading` props. This is the same pattern as `UnifiedLesson.tsx`.

4. **Progress tracking** - Use Intersection Observer to detect which section is in view. Update progress bar accordingly. Reference existing scroll tracking patterns in `unified-lesson/`.

5. **Article excerpts** - Parse `from`/`to` markers to extract content ranges. The backend already does this for `unified-lesson` - adapt or extend.

6. **Video segments** - Reuse `VideoPlayer.tsx` directly. Pass `start` and `end` props for time ranges. The component already handles this.

7. **Styling** - Use existing Tailwind classes from `unified-lesson/` components. The gray card style for embedded content can use `bg-stone-100` or similar.
