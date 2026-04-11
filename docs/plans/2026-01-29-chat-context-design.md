# Chat Context Restoration Design

**Date:** 2026-01-29
**Status:** Draft
**Problem:** Chat tutor doesn't receive video transcript/article content - regression from v2 content flattening

## Background

The chat feature worked previously but broke during v2 module flattening. The old system had `get_narrative_chat_context()` which gathered preceding content. This was removed, and the current `/api/chat/module` endpoint:

1. Receives full message history from frontend (frontend owns history)
2. Doesn't receive position information (module, section, segment)
3. Passes `None, None` for content context to LLM
4. Doesn't use the `chat_sessions` table at all

Meanwhile, working infrastructure exists but is unused:
- `chat_sessions` table keyed by `module.content_id` + user
- `get_or_create_chat_session()` for persistence
- `_build_system_prompt()` that accepts `previous_content`

## Design Goals

1. **Backend owns chat history** - stored in `chat_sessions` table for persistence and analytics
2. **Frontend is "dumb"** - sends only position and new message, not history
3. **Context scoped to current section** - preceding segments within the page, not preceding pages
4. **Standardize field naming** - use `hide*` fields, deprecate `show*` fields

## Architecture

### Data Flow

```
Frontend sends: { slug, sectionIndex, segmentIndex, message }
                     |
                     v
Backend:
  1. Load module by slug (from cache)
  2. Get/create chat session by module.content_id + user
  3. Retrieve existing messages from DB
  4. Append user's new message to DB
  5. Get current section: module.sections[sectionIndex]
  6. Gather context from section.segments[0:segmentIndex]
     - Skip if segment has hidePreviousContentFromTutor=true
  7. Build system prompt with gathered context
  8. Call LLM with: system prompt + full history
  9. Stream response
  10. Append assistant's response to DB when complete
```

### Scope Definitions

| Term | Definition |
|------|------------|
| **Module** | Top-level content unit (e.g., "introduction") |
| **Section** | A page within a module - lens-video, lens-article, or standalone page |
| **Segment** | Content within a section - text, video-excerpt, article-excerpt, or chat |

### Context Scoping

- **Chat history:** Persists across entire module (all sections)
- **Content context:** Only current section's preceding segments

Example: User chats in Section 0, then moves to Section 1 and chats again:
- Chat history includes both conversations
- Content context for Section 1 chat includes only Section 1's preceding segments

## API Changes

### POST /api/chat/module (Modified)

**Current:**
```json
{
  "messages": [{"role": "user", "content": "..."}],
  "system_context": "optional string"
}
```

**New:**
```json
{
  "slug": "introduction",
  "sectionIndex": 1,
  "segmentIndex": 2,
  "message": "What does this video mean by..."
}
```

**Response:** Same SSE stream (unchanged)

### GET /api/chat/module/{slug}/history (New)

Fetch chat history on page load.

**Auth:** JWT cookie or X-Anonymous-Token header

**Response:**
```json
{
  "sessionId": 123,
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

## Context Gathering

### Flattened Module Structure

Sections contain segments with bundled content:

```json
{
  "type": "video",
  "videoId": "abc123",
  "meta": {"title": "...", "channel": "..."},
  "contentId": "uuid",
  "segments": [
    {"type": "video-excerpt", "from": 0, "to": 120, "transcript": "..."},
    {"type": "chat", "instructions": "...", "hidePreviousContentFromTutor": false},
    {"type": "text", "content": "..."}
  ]
}
```

### Gathering Algorithm

```python
def gather_section_context(section: dict, segment_index: int) -> str | None:
    """Gather content from preceding segments for chat context."""

    segments = section.get("segments", [])
    current_segment = segments[segment_index]

    # Check if this chat hides previous content
    if current_segment.get("hidePreviousContentFromTutor"):
        return None

    # Gather content from segments 0 to segment_index-1
    parts = []
    for i in range(segment_index):
        seg = segments[i]
        seg_type = seg.get("type")

        if seg_type == "text":
            parts.append(seg.get("content", ""))

        elif seg_type == "video-excerpt":
            transcript = seg.get("transcript", "")
            if transcript:
                parts.append(f"[Video transcript]\n{transcript}")

        elif seg_type == "article-excerpt":
            content = seg.get("content", "")
            if content:
                parts.append(content)

        # Skip chat segments - history captures those

    return "\n\n---\n\n".join(parts) if parts else None
```

## Field Naming Cleanup

### Current Inconsistency

- `bundle_article_section` uses `showUserPreviousContent`, `showTutorPreviousContent`
- `bundle_video_section` uses `hidePreviousContentFromUser`, `hidePreviousContentFromTutor`

### Standardize on `hide*`

Change `bundle_article_section` (content.py:663-666):

```python
# From:
"showUserPreviousContent": not seg.hide_previous_content_from_user,
"showTutorPreviousContent": not seg.hide_previous_content_from_tutor,

# To:
"hidePreviousContentFromUser": seg.hide_previous_content_from_user,
"hidePreviousContentFromTutor": seg.hide_previous_content_from_tutor,
```

Frontend code reading `show*` fields must update to `hide*`.

## Frontend Changes

### Message Display

- Maintain local display array (for UI only)
- On send: optimistically show user message with "sending" state
- On first response chunk: confirm user message received
- Stream assistant response chunks
- On done: mark complete

### On Page Load

- Call `GET /api/chat/module/{slug}/history`
- Populate display array with returned messages

### Sync Safety

- Frontend doesn't send history to backend
- Backend is source of truth
- On refresh: fetch fresh history from backend

## Summary of Changes

| Component | Change |
|-----------|--------|
| `POST /api/chat/module` | Accept `{slug, sectionIndex, segmentIndex, message}` |
| `GET /api/chat/module/{slug}/history` | New endpoint for fetching history |
| `web_api/routes/module.py` | Implement new flow with session management |
| `core/modules/content.py` | Fix `bundle_article_section` to use `hide*` fields |
| Frontend `Module.tsx` | Send position, fetch history on load, optimistic UI |

## Open Questions

None at this time.

## Next Steps

1. Create implementation plan with bite-sized tasks
2. Implement backend changes (API, context gathering)
3. Implement frontend changes
4. Test end-to-end
