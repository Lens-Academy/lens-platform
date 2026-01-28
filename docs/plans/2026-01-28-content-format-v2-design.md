# Content Format v2 Design

**Date:** 2026-01-28
**Status:** Draft
**Replaces:** docs/plans/2026-01-18-lesson-markdown-format-design.md

## Overview

This document specifies the new content format for Lens Academy educational materials authored in Obsidian. The format introduces a hierarchical structure with three file types (Modules, Learning Outcomes, Lenses) connected via wiki-link references.

## Design Goals

1. **Obsidian-native authoring** — Content authors work in Obsidian with live preview
2. **Hierarchical organization** — Modules → Learning Outcomes → Lenses → Sections
3. **Reusable components** — Lenses can be shared across Learning Outcomes
4. **Clear separation** — Parser stores references, bundler resolves content

## File Types

### Module Files (`modules/*.md`)

Top-level curriculum units that students work through.

**Frontmatter:**
```yaml
---
id: uuid
slug: module-slug
title: Module Title
discussion: https://discord.com/... (optional)
---
```

**Header `#` — Sections:**

| Section Type | Has Source? | Contains | Title Required? | Optional? |
|--------------|-------------|----------|-----------------|-----------|
| `# Page: Title` | No | `## Text`, `## Chat` segments | Yes | No |
| `# Learning Outcome:` | Yes (`source::`) | *(from LO file)* | No | Yes (`optional::`) |
| `# Uncategorized:` | No | `## Lens:` refs with `source::` | No | No |

**Header `##` — Inside `# Page:`**

| Segment Type | Fields |
|--------------|--------|
| `## Text` | `content::` |
| `## Chat` | `instructions::`, `hidePreviousContentFromUser::`, `hidePreviousContentFromTutor::` |

- `# Page:` requires an `id::` field for progress tracking
- Segments are optional to include (a Page may have none, one, or many)
- Segments can appear in any order
- Segments do **not** have an `optional::` field (no skip behavior)

**Header `##` — Inside `# Uncategorized:`**

| Type | Fields |
|------|--------|
| `## Lens:` | `optional::`, `source::` |

*Note: `# Uncategorized:` only contains Lens references (no inline definitions). All Lenses must be separate files.*

**Example:**
```md
---
id: 69615c7b-49e1-431b-8748-3f6de6fef21e
slug: introduction
title: Introduction
---
# Page: Welcome
id:: 8a9b0c1d-2e3f-4a5b-6c7d-8e9f0a1b2c3d
## Text
content::
Welcome to the AI Safety course.

## Chat
instructions::
What brings you to this course?

# Learning Outcome:
source:: ![[../Learning Outcomes/Core Concepts]]

# Learning Outcome:
optional:: true
source:: ![[../Learning Outcomes/Objections L1]]

# Uncategorized:
## Lens:
optional:: true
source:: ![[../Lenses/Background Reading]]

## Lens:
source:: ![[../Lenses/Deep Dive]]
```

---

### Learning Outcome Files (`Learning Outcomes/*.md`)

Define what students should learn, with associated tests and learning flows (Lenses).

**Frontmatter:**
```yaml
---
id: uuid
discussion: https://discord.com/... (optional)
---
```

**Header `##` — Sections:**

| Section Type | Has Source? | Optional? |
|--------------|-------------|-----------|
| `## Test:` | Yes (`source::`) | No (TBD) |
| `## Lens:` | Yes (`source::`) | Yes (`optional::`) |

*Note: Test files format is TBD — ignored for now.*

**Example:**
```md
---
id: e8f86891-a3b8-4176-b917-044b4015e0bd
discussion: https://discord.com/channels/...
---
## Test:
source:: ![[../Tests/Core Concepts Quiz]]

## Lens:
source:: ![[../Lenses/AI Basics Video]]

## Lens:
optional:: true
source:: ![[../Lenses/Wikipedia Overview]]
```

---

### Lens Files (`Lenses/*.md`)

Learning flows built around a resource (article, video) with text framing and chat discussions.

**Frontmatter:**
```yaml
---
id: uuid
---
```

**Header `###` — Sections:**

| Section Type | Has Source? | Contains |
|--------------|-------------|----------|
| `### Article: Title` | Yes (`source::`) | `####` segments |
| `### Video: Title` | Yes (`source::`) | `####` segments |

**Header `####` — Segments:**

| Segment Type | Fields | Optional? |
|--------------|--------|-----------|
| `#### Text` | `content::` | Yes (`optional::`) |
| `#### Chat` / `#### Chat: Title` | `instructions::`, `hidePreviousContentFromUser::`, `hidePreviousContentFromTutor::` | Yes (`optional::`) |
| `#### Article-excerpt` | `from::`, `to::` | Yes (`optional::`) |
| `#### Video-excerpt` | `from::`, `to::` | Yes (`optional::`) |

*All segments within a Lens can be marked `optional:: true`.*

**Example:**
```md
---
id: 01f6df31-099f-48ed-adef-773cc4f947e4
---
### Video: AI Basics
source:: [[../video_transcripts/kurzgesagt-ai]]

#### Text
content::
Watch this introduction to AI concepts.

#### Video-excerpt
from:: 0:00
to:: 5:00

#### Text
content::
What stood out to you?

#### Chat: Discussion
optional:: true
instructions::
Discuss the key concepts from the video.
The user just answered: "What stood out to you?"

### Article: Deep Dive
source:: [[../articles/ai-safety-intro]]

#### Article-excerpt
from:: "## The Core Problem"
to:: "requires careful consideration."

#### Chat: Reflection
instructions::
What do you think about the core problem described?
```

---

## Wiki Link Handling

| Syntax | Context | Meaning |
|--------|---------|---------|
| `source:: [[path]]` | Section field | Load file as content source (resolve at bundle time) |
| `source:: ![[path]]` | Section field | Same as above (treat `!` identically for parsing) |
| `[[path\|alias]]` | Inside `content::` | Hyperlink reference (render as link, don't resolve) |

The `!` prefix is an Obsidian display hint for inline preview; the parser treats both forms identically.

---

## Header Level Reference

| Level | Module | Learning Outcome | Lens |
|-------|--------|------------------|------|
| `#` | Page, Learning Outcome, Uncategorized | — | — |
| `##` | Text, Chat (in Page) / Lens refs (in Uncategorized) | Test, Lens | — |
| `###` | — | — | Article, Video |
| `####` | — | — | Text, Chat, Excerpt |

*Note: Modules no longer contain `###` or `####` content directly — all Article/Video sections live in Lens files.*

---

## Required vs Optional Headers

Which sections/headers must be present vs can be omitted:

**In a Module:**
| Header | Required? | Count |
|--------|-----------|-------|
| `# Page:` | No | 0 or many |
| `# Learning Outcome:` | No | 0 or many |
| `# Uncategorized:` | No | 0 or 1 |

**Inside `# Page:`:**
| Header | Required? | Count |
|--------|-----------|-------|
| `## Text` | No | 0 or many |
| `## Chat` | No | 0 or many |

**Inside `# Uncategorized:`:**
| Header | Required? | Count |
|--------|-----------|-------|
| `## Lens:` | Yes | 1 or many |

**In a Learning Outcome file:**
| Header | Required? | Count |
|--------|-----------|-------|
| `## Test:` | No | 0 or 1 |
| `## Lens:` | Yes | 1 or many |

**In a Lens file:**
| Header | Required? | Count |
|--------|-----------|-------|
| `### Article:` / `### Video:` | Yes | 1 or many |

**Inside `### Article:` or `### Video:`:**
| Header | Required? | Count |
|--------|-----------|-------|
| `#### Text` | No | 0 or many |
| `#### Chat` | No | 0 or many |
| `#### Article-excerpt` / `#### Video-excerpt` | Yes | 1 or many |

---

## Bundling Strategy

The parser outputs references; the bundler resolves content at request time.

**Flow:**
1. Parser sees `source:: [[../Learning Outcomes/X]]`
2. Stores as `LearningOutcomeRef(path="../Learning Outcomes/X")`
3. Bundler loads `Learning Outcomes/X.md`, parses it
4. Extracts `id` from frontmatter, parses `## Lens:` refs
5. Recursively resolves Lens files
6. Returns nested JSON with IDs preserved at each level

**Bundled JSON structure:**
```json
{
  "id": "module-uuid",
  "slug": "introduction",
  "title": "Introduction",
  "items": [
    {
      "type": "page",
      "id": "page-uuid",
      "title": "Welcome",
      "segments": [
        { "type": "text", "content": "..." },
        { "type": "chat", "instructions": "..." }
      ]
    },
    {
      "type": "learning_outcome",
      "id": "lo-uuid",
      "optional": false,
      "lenses": [
        {
          "type": "lens",
          "id": "lens-uuid",
          "optional": true,
          "sections": [
            {
              "type": "video",
              "title": "AI Basics",
              "videoId": "abc123",
              "segments": [...]
            }
          ]
        }
      ]
    },
    {
      "type": "uncategorized",
      "lenses": [
        {
          "type": "lens",
          "id": "lens-uuid",
          "optional": true,
          "sections": [...]
        }
      ]
    }
  ]
}
```

---

## Progress Tracking

Progress is tracked at these levels (each has a UUID):

| Level | ID Source | Tracked? |
|-------|-----------|----------|
| Module | frontmatter `id` | Yes |
| Page | `id::` field | Yes |
| Learning Outcome | LO file frontmatter `id` | Yes |
| Lens | Lens file frontmatter `id` | Yes |
| Segment | — | No |

**Key points:**
- All trackable content has an explicit UUID
- `# Uncategorized:` is just a container — no ID, not tracked
- Segments are not individually tracked; progress is at Lens level
- Optional content can be skipped without affecting progress

---

## Cache Structure

The content cache holds raw markdown files by path:

| Cache Key | Contents |
|-----------|----------|
| `cache.modules` | Parsed modules by slug |
| `cache.articles` | Raw article markdown by path (e.g., `articles/foo.md`) |
| `cache.video_transcripts` | Raw transcript markdown by path |
| `cache.learning_outcomes` | Raw LO markdown by path (e.g., `Learning Outcomes/X.md`) |
| `cache.lenses` | Raw Lens markdown by path (e.g., `Lenses/Y.md`) |

**Pattern:** Raw markdown is cached; parsing/bundling happens at request time.

---

## Field Ordering

When a section has multiple fields, use this order:

```md
# Learning Outcome:
optional:: true
source:: ![[...]]
```

1. `optional::` (if applicable)
2. `id::` (if applicable, e.g., for Pages)
3. `source::` (if applicable)
4. Other fields (`content::`, `instructions::`, `from::`, `to::`, etc.)

---

## Optional Content

The `optional:: true` field can be used at multiple levels:

| Level | Location |
|-------|----------|
| Learning Outcome | `# Learning Outcome:` in Module |
| Lens (in LO) | `## Lens:` in Learning Outcome file |
| Lens (in Uncategorized) | `## Lens:` in Module under `# Uncategorized:` |
| Segment | `#### Text/Chat/Excerpt` in Lens |

**No `optional::` field:** `# Page:` sections and their `## Text`/`## Chat` segments. (Page segments are optional to *include* in the markdown, but don't support the skip behavior.)

Optional content is shown to students but can be skipped without affecting progress.

---

## Excerpt Syntax

### Article Excerpts

Use quoted text anchors to specify start/end positions:

```md
#### Article-excerpt
from:: "## Section Heading"
to:: "end of this paragraph."
```

- `from::` — Text anchor for start position (inclusive)
- `to::` — Text anchor for end position (inclusive)
- Both are optional; omit for full content
- Matching is case-insensitive
- Anchors must be unique within the article

### Video Excerpts

Use timestamps in `MM:SS` or `HH:MM:SS` format:

```md
#### Video-excerpt
from:: 1:30
to:: 5:45
```

- `from::` — Start timestamp (default: 0:00)
- `to::` — End timestamp (default: end of video)

---

## Critic Markup

Obsidian files may contain critic markup for collaborative editing. **Strip at parse time** using "reject all changes" behavior:

| Markup | Example | Result |
|--------|---------|--------|
| `{>>comment<<}` | `text{>>note<<}more` | `textmore` |
| `{++addition++}` | `text{++new++}more` | `textmore` |
| `{--deletion--}` | `text{--old--}more` | `textoldmore` |
| `{~~old~>new~~}` | `text{~~foo~>bar~~}more` | `textfoomore` |
| `{==highlight==}` | `text{==important==}more` | `textimportantmore` |

**Implementation:** `core/modules/critic_markup.py` — `strip_critic_markup()` function.

---

## Open Questions

### Test Files

The `## Test:` section references test files. **Format TBD — ignored for now.**

---

## Files to Update

1. **`core/modules/markdown_parser.py`**
   - Add `PageSection`, `LearningOutcomeRef`, `UncategorizedSection`, `LensRef` types
   - Support new header hierarchy
   - Parse Learning Outcome and Lens file formats
   - Call `strip_critic_markup()` before parsing

2. **`core/modules/markdown_validator.py`**
   - Validate new section types and hierarchy
   - Validate `source::` wiki links resolve to existing files
   - Validate required fields (`id::` on Pages, `source::` where needed)
   - Strip critic markup before validation
   - *Used in CI to catch formatting/reference errors before merge*

3. **`core/modules/content.py`**
   - Add `load_learning_outcome()` and `load_lens()` functions
   - Update bundler to resolve references recursively

4. **`core/content/cache.py`**
   - Cache Learning Outcome and Lens files

5. **`core/modules/critic_markup.py`** *(done)*
   - `strip_critic_markup()` — reject all changes behavior

---

## Migration

Existing module files using the old format (direct `# Article:`, `# Video:` at H1) will need migration to the new structure.
