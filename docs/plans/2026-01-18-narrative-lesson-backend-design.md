# Narrative Lesson Backend Design

**Goal:** Backend API to serve narrative lessons with all content bundled, supporting chat segments with position-aware context.

**Date:** 2026-01-18

---

## YAML Format

```yaml
slug: narrative-test
title: "Test Narrative Lesson"

sections:
  # Standalone text section (no segments)
  - type: text
    content: |
      # Welcome to this lesson
      Here's what we'll cover...

  # Article section with segments
  - type: article
    source: articles/tim-urban-artificial-intelligence-revolution-1.md
    segments:
      - type: text
        content: "Before we dive in..."
      - type: article-excerpt
        from: "What does it feel like to stand here?"
        to: "## The Far Future—Coming Soon"
      - type: chat
        instructions: |
          TLDR of what the user just read:
          ...
          Discussion topics to explore:
          ...
        showUserPreviousContent: true
        showTutorPreviousContent: true

  # Video section with segments
  - type: video
    source: video_transcripts/fa8k8IQ1_X0_A.I._Humanitys_Final_Invention.md
    segments:
      - type: video-excerpt
        from: 0
        to: 180
      - type: chat
        instructions: "..."
        showUserPreviousContent: true
        showTutorPreviousContent: true
```

### Section Types

- **text**: Standalone markdown content (no child segments)
- **article**: Groups article excerpts with `source` pointing to markdown file
- **video**: Groups video excerpts with `source` pointing to transcript file

### Segment Types (within article/video sections)

- **text**: Authored markdown content
- **article-excerpt**: Extract from parent article using `from`/`to` text anchors
- **video-excerpt**: Extract from parent video using `from`/`to` seconds
- **chat**: Interactive chat with `instructions`, `showUserPreviousContent`, `showTutorPreviousContent`

---

## API Response

### GET /api/lessons/{slug}

Returns full lesson with all content bundled:

```json
{
  "slug": "narrative-test",
  "title": "Test Narrative Lesson",
  "sections": [
    {
      "type": "text",
      "content": "# Welcome to this lesson..."
    },
    {
      "type": "article",
      "meta": {
        "title": "The AI Revolution",
        "author": "Tim Urban",
        "sourceUrl": "https://waitbutwhy.com/..."
      },
      "segments": [
        { "type": "text", "content": "Before we dive in..." },
        { "type": "article-excerpt", "content": "extracted markdown here..." },
        {
          "type": "chat",
          "instructions": "...",
          "showUserPreviousContent": true,
          "showTutorPreviousContent": true
        }
      ]
    },
    {
      "type": "video",
      "videoId": "fa8k8IQ1_X0",
      "meta": {
        "title": "A.I. - Humanity's Final Invention?",
        "channel": "Kurzgesagt"
      },
      "segments": [
        { "type": "video-excerpt", "from": 0, "to": 180, "transcript": "Humans rule Earth..." },
        {
          "type": "chat",
          "instructions": "...",
          "showUserPreviousContent": true,
          "showTutorPreviousContent": true
        }
      ]
    }
  ]
}
```

### Key Transformations (YAML → API Response)

- `source` → resolved to `meta` (title, author, sourceUrl for articles; title, channel for videos)
- `source` → `videoId` extracted from transcript frontmatter URL (for videos)
- `article-excerpt` → `content` filled with extracted markdown using from/to anchors
- `video-excerpt` → `transcript` filled with extracted text for that time range

---

## Session & Chat API

Reuses existing session system.

### POST /api/lesson-sessions

Create session:
```json
{ "lesson_slug": "narrative-test" }
```

Returns:
```json
{ "session_id": 123 }
```

### POST /api/lesson-sessions/{id}/message

Send message with position:
```json
{
  "content": "user's message",
  "sectionIndex": 1,
  "segmentIndex": 2
}
```

Indices are **zero-indexed**.

Backend uses position to:
1. Find the chat segment at that position
2. Read `instructions` from YAML
3. If `showTutorPreviousContent` is true, include preceding content (article excerpt or video transcript)
4. Build system prompt and stream response

All chat segments share the same conversation history (one session = one message array).

---

## Not In Scope

- Progress tracking / completion flow
- Activity analytics
- Course integration
