# V2 Content Section Types Design

## Overview

This document describes how v2 markdown content format maps to API section types for the frontend. No backward compatibility with v1 - clean start.

## Markdown Structure (v2 Format)

Modules in the v2 format contain:

```markdown
---
id: <uuid>
slug: introduction
title: Introduction
---

# Page: Welcome
id:: <page-uuid>
## Text
content:: ...

## Chat
instructions:: ...

# Learning Outcome:
source:: [[../Learning Outcomes/Some Outcome]]

# Learning Outcome:
source:: [[../Learning Outcomes/Another Outcome]]

# Uncategorized:
## Lens:
optional:: true
source:: [[../Lenses/Background Reading]]
```

**Learning Outcome files** contain references to Lenses:
```markdown
---
id: <lo-uuid>
title: Understand AI Risks
---
## Lens:
source:: [[../Lenses/Video Lens]]

## Lens:
source:: [[../Lenses/Article Lens]]
```

**Lens files** contain exactly one video or article:
```markdown
---
id: <lens-uuid>
---
### Video: AI Safety Intro
source:: [[../video_transcripts/kurzgesagt]]

#### Text
content:: Watch this introduction.

#### Video-excerpt
from:: 0:00
to:: 5:00

#### Chat
instructions:: What stood out to you?
```

## API Design

### Single Endpoint

| Endpoint | Returns |
|----------|---------|
| `GET /api/modules/{slug}` | Full module with all sections and content bundled |

Content is text (markdown, transcripts, instructions) - not large files. Bundling everything in one response is simpler than lazy loading.

### Section Types

| Type | Description | Content Source |
|------|-------------|----------------|
| `page` | Standalone text/chat content | `# Page:` in module |
| `lens-video` | Lens containing video content | Lens file with `### Video:` |
| `lens-article` | Lens containing article content | Lens file with `### Article:` |

### Flattening

The API **flattens** the hierarchy at cache time. Learning Outcomes and Uncategorized sections are resolved into their constituent lenses.

1. **`# Page:`** → Section with `type: "page"`
2. **`# Learning Outcome:`** → Load LO file → Load each Lens → Section per lens with `learningOutcomeId`
3. **`# Uncategorized:`** → Load each Lens → Section per lens with `learningOutcomeId: null`

### Module Response

```json
{
  "slug": "introduction",
  "title": "Introduction",
  "sections": [
    {
      "type": "page",
      "contentId": "<page-uuid>",
      "meta": {"title": "Welcome"},
      "segments": [
        {"type": "text", "content": "..."},
        {"type": "chat", "instructions": "..."}
      ]
    },
    {
      "type": "lens-video",
      "contentId": "<lens-uuid>",
      "learningOutcomeId": "<lo-uuid>",
      "videoId": "dQw4w9WgXcQ",
      "meta": {"title": "AI Safety Intro", "channel": "Kurzgesagt"},
      "optional": false,
      "segments": [
        {"type": "text", "content": "Watch this introduction."},
        {"type": "video-excerpt", "from": 0, "to": 300, "transcript": "..."},
        {"type": "chat", "instructions": "What stood out to you?"}
      ]
    },
    {
      "type": "lens-article",
      "contentId": "<lens-uuid>",
      "learningOutcomeId": "<lo-uuid>",
      "meta": {"title": "Deep Dive", "author": "...", "sourceUrl": "..."},
      "optional": false,
      "segments": [...]
    },
    {
      "type": "lens-video",
      "contentId": "<lens-uuid>",
      "learningOutcomeId": null,
      "videoId": "...",
      "meta": {"title": "Background Reading"},
      "optional": true,
      "segments": [...]
    }
  ]
}
```

## Progress Tracking

**Progress is tracked at the lens level only.**

- Frontend sends progress updates for the current lens (`content_type='lens'`)
- Frontend knows which Learning Outcome it's in via `learningOutcomeId`
- No writes to module or LO progress rows
- LO/module completion can be computed from lens completion if needed for reporting

## Initialization & Caching

Content is fetched, parsed, flattened, and cached in a single initialization flow at server boot:

```
Server starts
    ↓
Fetch content from GitHub
    ↓
Parse all markdown files (modules, LOs, lenses)
    ↓
Flatten: resolve LO refs → lens refs → build section list with full content
    ↓
Cache the result
    ↓
Server ready
```

This same flow runs when a GitHub webhook triggers a content refresh.

### Path Resolution

Wiki-links resolve to cache keys by filename stem:
- `[[../Learning Outcomes/Some Outcome]]` → lookup `learning_outcomes["Some Outcome"]`
- `[[../Lenses/Video Lens]]` → lookup `lenses["Video Lens"]`

### Cache Structure

```python
@dataclass
class ContentCache:
    courses: dict[str, Course]
    modules: dict[str, FlattenedModule]  # slug → fully resolved module
    # No raw markdown storage - everything parsed and flattened
```

### Error Handling

**Fail fast.** If any reference is missing:
- Module references non-existent LO → error at startup
- LO references non-existent Lens → error at startup
- Lens references non-existent video/article → error at startup

Catches authoring mistakes immediately.

### Validation Rules

- One Lens file = exactly one `### Video:` or `### Article:` (not both, not multiple)
- All referenced files must exist
- All UUIDs in frontmatter must be valid

### No Separate Bundler

The old architecture had:
- Parser: markdown → AST types (`LearningOutcomeRef`, etc.)
- Bundler: AST → API JSON (expanded refs at request time)

The new architecture:
- Parser: parses individual files into typed objects
- Flattening: resolves refs and builds full content (at cache time)
- API: serves cached data directly (no transformation)

The "bundler" concept is replaced by cache-time flattening.

## Implementation Notes

### Backend Changes

1. Update `github_fetcher.py` to:
   - Parse LO and Lens files (not just store raw markdown)
   - Flatten modules at cache time
   - Store fully resolved `FlattenedModule` objects

2. Update `content.py`:
   - Remove runtime bundling/expansion
   - Add flattening logic (resolve LO refs → Lens content)
   - Keep existing segment serialization

3. Simplify cache structure - no raw markdown storage

### Frontend Changes

1. Update TypeScript types for new section types (`lens-video`, `lens-article`)
2. Add `learningOutcomeId` to section types
3. Update rendering for new types
