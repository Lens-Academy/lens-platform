# Unified Lesson Page Design

## Overview

A unified page for interactive lessons that supports both text articles and YouTube videos, with an AI chat tutor. Uses a split-panel layout with chat on the left and content on the right.

## Layout

```
+------------------+------------------------+
|                  |                        |
|    ChatPanel     |     ContentPanel       |
|    (left)        |     (right)            |
|                  |                        |
|  - Messages      |  - Article (markdown)  |
|  - Input         |  - Video (YouTube)     |
|  - Transition    |  - Empty (chat stage)  |
|    prompt        |                        |
|                  |        [Next] button   |
+------------------+------------------------+
```

## Stage Types

Lessons are defined as a sequence of explicit stages:

### `article` - Display a section of a markdown article
```json
{
  "type": "article",
  "sourceUrl": "/articles/four-background-claims.md",
  "from": "The first claim is",
  "to": "instrumental convergence."
}
```
- `from`/`to`: Text anchors to extract a section (optional, omit for full article)
- Chat panel visible but de-emphasized during this stage

### `video` - Display a YouTube video clip
```json
{
  "type": "video",
  "videoId": "pYXy-A4siMw",
  "from": 0,
  "to": 120
}
```
- `from`/`to`: Timestamps in seconds (optional, omit for full video)
- Chat panel visible but de-emphasized during this stage

### `chat` - Active discussion with AI tutor
```json
{
  "type": "chat",
  "context": "Discuss the orthogonality thesis with the user.",
  "includePreviousContent": true
}
```
- `context`: Instructions for the AI at this stage
- `includePreviousContent`: If true, AI receives the previous article section or video transcript; if false, AI only has the context (enables quizzing without hints)

## Example Lesson Definition

```json
{
  "id": "intro-to-ai-safety",
  "title": "Introduction to AI Safety",
  "stages": [
    {
      "type": "article",
      "sourceUrl": "/articles/four-background-claims.md",
      "from": "The first claim is",
      "to": "instrumental convergence."
    },
    {
      "type": "chat",
      "context": "Discuss what the user just read about the orthogonality thesis. Check their understanding of why intelligence and goals are independent.",
      "includePreviousContent": true
    },
    {
      "type": "video",
      "videoId": "pYXy-A4siMw",
      "from": 0,
      "to": 120
    },
    {
      "type": "chat",
      "context": "Quiz the user on the key points from the video without providing hints.",
      "includePreviousContent": false
    },
    {
      "type": "article",
      "sourceUrl": "/articles/four-background-claims.md",
      "from": "The second claim",
      "to": "convergent instrumental goals."
    }
  ]
}
```

## Stage Transitions

### During `chat` stages:
- AI can signal readiness to move on via `transition_to_next` tool
- Shows prompt: "Ready to continue?" with Confirm/Keep chatting buttons
- "Next" button always available to skip

### During `article` stages:
- User reads at their own pace
- Chat visible but de-emphasized (grayed out or visual indicator)
- User clicks "Continue" when done

### During `video` stages:
- Video plays the specified clip
- When clip ends, shows "Video complete. Continue?" prompt overlay
- User confirms to proceed to next stage

## Chat Behavior

- **Continuous thread**: Chat history persists across all stages
- **During content stages**: Chat is visible but de-emphasized; AI automatically knows what content is showing (system-level context)
- **During chat stages**: Full engagement, AI uses the authored `context` prompt
- **Content in prompt**: When `includePreviousContent: true`, AI receives the actual text of the previous article section or video transcript

## AI Prompt Construction

### For `chat` stages with `includePreviousContent: true`:
```
System: You are an AI tutor helping a student learn about AI safety.

The user just read/watched:
---
[Actual content text or transcript]
---

[Stage context from JSON]

[Full chat history]
```

### For `chat` stages with `includePreviousContent: false`:
```
System: You are an AI tutor helping a student learn about AI safety.

[Stage context from JSON]

[Full chat history]
```

### For `article` or `video` stages (if user chats):
```
System: You are an AI tutor. The user is currently reading/watching content.

Content: [title and section info]
---
[Actual content]
---

Keep responses brief - the user should focus on the content.
Answer questions if asked, but don't initiate lengthy discussion.

[Full chat history]
```

## Data Model

### Lesson (static definition)
- Stored as JSON files in `core/lessons/`
- Immutable, shared across all users

### LessonSession (per-user instance)
- `id`: UUID
- `user_id`: int
- `lesson_id`: string
- `current_stage_index`: int (default 0)
- `messages`: JSON array of {role, content}
- `started_at`: datetime
- `last_active_at`: datetime
- `completed_at`: datetime (nullable)

Stored in PostgreSQL. Enables resume exactly where user left off.

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/lessons` | GET | List available lessons |
| `/api/lessons/{id}` | GET | Get lesson definition |
| `/api/lesson-sessions` | POST | Start new session `{lesson_id}` |
| `/api/lesson-sessions/{id}` | GET | Get session state |
| `/api/lesson-sessions/{id}/message` | POST | Send message, get streamed response |
| `/api/lesson-sessions/{id}/advance` | POST | Move to next stage |

Backend is source of truth. Frontend sends minimal data; backend constructs prompts and manages state.

## File Structure

```
core/
├── lessons/
│   ├── intro-to-ai-safety.json
│   └── advanced-alignment.json
│
├── content/
│   ├── articles/
│   │   └── four-background-claims.md
│   │
│   └── video_transcripts/
│       └── robert-miles-why-ai-safety.md
│
└── lesson_sessions.py  # Business logic for sessions

web_api/routes/
├── lessons.py          # Lesson and session endpoints
└── ...

web_frontend/src/
├── pages/
│   └── UnifiedLesson.tsx
│
└── components/
    └── unified-lesson/
        ├── ChatPanel.tsx
        └── ContentPanel.tsx
```

## Frontend Components

### UnifiedLesson.tsx (page)
- Fetches session state on mount
- Renders split-panel layout
- Handles user actions (send message, advance stage)

### ChatPanel.tsx
- Displays message history
- Input field for new messages
- Visual de-emphasis (gray overlay/indicator) during article/video stages
- Transition prompt when AI suggests moving on

### ContentPanel.tsx
- Switches content based on current stage type:
  - `article` → renders markdown section
  - `video` → renders VideoPlayer with clip bounds
  - `chat` → empty or subtle "discussion time" indicator
- "Next" button always visible

## Content Section Extraction

### Articles
Text between `from` and `to` anchors is extracted by finding those phrases in the markdown and returning everything between them.

### Videos
Transcript markdown files are stored with timestamps. The section between `from` and `to` seconds is extracted for the AI context.
