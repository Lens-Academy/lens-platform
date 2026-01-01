# Stage Transition Markers Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add visual markers in chat history showing when users start/finish content stages (articles, videos).

**Architecture:** System messages stored in database alongside regular chat messages, rendered as centered gray pills in the UI.

**Tech Stack:** React (frontend), FastAPI (backend), PostgreSQL (storage)

---

## Data Model

Add `"system"` as a new message role:

```typescript
type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};
```

System messages follow this format:
- Start: `"📖 Started reading: Four Background Claims"` or `"📺 Started watching: Intro to AI Safety"`
- Finish: `"📖 Finished reading"` or `"📺 Finished watching"`

Stored in `session["messages"]` array in the database, included in AI context.

---

## Backend Logic

### Session Creation (`POST /api/lesson-sessions`)

If stage 0 is article/video, insert a "Started" system message.

### Stage Advancement (`POST /api/lesson-sessions/{id}/advance`)

1. Get the current (old) stage
2. If old stage is article/video → insert "Finished" message
3. Advance to next stage
4. If new stage is article/video → insert "Started" message with title

### Helper Function

```python
def get_stage_title(stage: Stage) -> str:
    """Extract display title for a stage."""
    if isinstance(stage, ArticleStage):
        # Parse from source_url or content
        return "Article Title"
    elif isinstance(stage, VideoStage):
        # Could fetch from YouTube API or use videoId
        return "Video Title"
    return ""
```

---

## Frontend UI

### ChatPanel.tsx

Render system messages as centered pills:

```tsx
{messages.map((msg, i) => (
  msg.role === "system" ? (
    <div key={i} className="flex justify-center my-3">
      <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
        {msg.content}
      </span>
    </div>
  ) : (
    // Existing Tutor/User bubble rendering
  )
))}
```

### Styling

- Centered horizontally
- Small text (`text-xs`)
- Muted colors: gray-500 text on gray-100 background
- Pill shape (`rounded-full`)
- Vertical margin (`my-3`)

---

## Example Flow

```
📖 Started reading: Four Background Claims
[Tutor] Welcome! What struck you most about this argument...
[User] I found the general intelligence claim interesting
[Tutor] That's a great observation...
📖 Finished reading
📺 Started watching: Intro to AI Safety
📺 Finished watching
[Tutor] I see you've just watched a video about AI safety...
```

---

## Files to Modify

1. `web_frontend/src/types/unified-lesson.ts` - Add "system" to ChatMessage role
2. `web_api/routes/lessons.py` - Insert system messages on stage transitions
3. `web_frontend/src/components/unified-lesson/ChatPanel.tsx` - Render system messages

---

## Not Included

- Chat stage markers (not needed, AI message signals start)
- Collapsible sections
- Real-time "in progress" updates (just start/finish)
