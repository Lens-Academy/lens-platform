# Lesson Markdown Format Specification

This is the authoritative reference for the lesson and course markdown format.
The parser (`markdown_parser.py`) and validator (`markdown_validator.py`) implement this spec.

## Document Structure

```
---
slug: lesson-slug
title: Lesson Title
---

# Section: Title
fields...

## Segment
fields...

## Segment
fields...

# Section: Another Title
fields...
```

## Frontmatter

YAML frontmatter between `---` markers. Required fields:

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | Yes | URL-safe identifier |
| `title` | Yes | Human-readable title |

## Headers

### Sections (`#`)

Top-level content blocks. **Title is required.**

**Valid types:** `Video`, `Article`, `Text`, `Chat`

**Syntax:** `# Type: Title`

**Examples:**
```markdown
# Video: A.I. - Humanity's Final Invention
# Article: Existential Risk from AI
# Text: Summary
# Chat: Discussion
```

**Invalid:**
- Missing title: `# Video` or `# Video:`
- Missing colon before title: `# Video Introduction`
- Space before colon: `# Video : Introduction`
- Wrong level: `## Video` (Video must be `#`, not `##`)

### Segments (`##`)

Child blocks within Video or Article sections. **Title is optional.**

**Valid types:** `Text`, `Chat`, `Video-excerpt`, `Article-excerpt`

**Syntax:** `## Type` or `## Type: Optional Title`

**Examples:**
```markdown
## Text
## Chat
## Video-excerpt
## Article-excerpt
## Chat: Discussion Questions
```

**Invalid:**
- Missing colon before title: `## Chat Discussion`
- Space before colon: `## Chat : Discussion`
- Wrong level: `# Video-excerpt` (must be `##`)

### Type-Level Restrictions

| Type | Valid as Section (`#`) | Valid as Segment (`##`) |
|------|------------------------|-------------------------|
| `Video` | Yes | No |
| `Article` | Yes | No |
| `Text` | Yes | Yes |
| `Chat` | Yes | Yes |
| `Video-excerpt` | No | Yes |
| `Article-excerpt` | No | Yes |

**Examples of invalid headers:**
- `## Video` — Video is section-only, must use `#`
- `## Article` — Article is section-only, must use `#`
- `# Video-excerpt` — Video-excerpt is segment-only, must use `##`
- `# Article-excerpt` — Article-excerpt is segment-only, must use `##`
- `# Introduction` — Unknown type
- `## Summary` — Unknown type

## Fields

All fields use double-colon syntax: `key:: value`

### Single-Line vs Multi-Line

**Single-line:** Value on same line
```markdown
from:: 0:00
to:: 5:00
```

**Multi-line:** Value on following lines, until next `key::`, `##`, or `#`
```markdown
instructions::
First line of instructions.

Second paragraph.
```

### Common Mistakes

| Mistake | Example | Error |
|---------|---------|-------|
| Single colon | `from: 0:00` | "Did you mean `from::`?" |
| Typo in field name | `soruce:: [[...]]` | "Unknown field: soruce::" |

## Section Field Reference

### Video Section

```markdown
# Video: Title
source:: [[path/to/video_transcript]]
optional:: true
```

| Field | Required | Description |
|-------|----------|-------------|
| `source::` | Yes | Wiki-link to video transcript |
| `optional::` | No | Boolean, marks section as optional |

**No other fields allowed.** Must contain segments.

### Article Section

```markdown
# Article: Title
source:: [[path/to/article]]
optional:: true
```

| Field | Required | Description |
|-------|----------|-------------|
| `source::` | Yes | Wiki-link to article |
| `optional::` | No | Boolean, marks section as optional |

**No other fields allowed.** Must contain segments.

### Text Section

```markdown
# Text: Title
content::
The content goes here.
```

| Field | Required | Description |
|-------|----------|-------------|
| `content::` | Yes | Markdown content |

**No other fields allowed.** Standalone (no child segments).

### Chat Section

```markdown
# Chat: Title
instructions::
Instructions for the AI tutor.
hidePreviousContentFromUser:: true
hidePreviousContentFromTutor:: true
```

| Field | Required | Description |
|-------|----------|-------------|
| `instructions::` | Yes | Instructions for AI tutor |
| `hidePreviousContentFromUser::` | No | Boolean, default false (show previous content) |
| `hidePreviousContentFromTutor::` | No | Boolean, default false (include previous content in tutor context) |

**No other fields allowed.** Standalone (no child segments).

## Segment Field Reference

### Text Segment

```markdown
## Text
content::
The content goes here.
```

| Field | Required | Description |
|-------|----------|-------------|
| `content::` | Yes | Markdown content |

**No other fields allowed.**

### Chat Segment

```markdown
## Chat
instructions::
Instructions for the AI tutor.
hidePreviousContentFromUser:: true
hidePreviousContentFromTutor:: false
```

| Field | Required | Description |
|-------|----------|-------------|
| `instructions::` | Yes | Instructions for AI tutor |
| `hidePreviousContentFromUser::` | No | Boolean, default false (show previous content) |
| `hidePreviousContentFromTutor::` | No | Boolean, default false (include previous content in tutor context) |

**No other fields allowed.**

### Video-excerpt Segment

```markdown
## Video-excerpt
from:: 0:00
to:: 5:00
```

| Field | Required | Description |
|-------|----------|-------------|
| `from::` | No | Start timestamp (omit = from start) |
| `to::` | No | End timestamp (omit = to end) |

**No other fields or content allowed** (only blank lines).

### Article-excerpt Segment

```markdown
## Article-excerpt
from:: "Start text marker"
to:: "End text marker"
```

| Field | Required | Description |
|-------|----------|-------------|
| `from::` | No | Start text marker (omit = from start) |
| `to::` | No | End text marker (omit = to end) |

Quotes around values are optional (stripped if present).

**No other fields or content allowed** (only blank lines).

## Boolean Values

Fields that accept boolean values:

- `optional::`
- `hidePreviousContentFromUser::`
- `hidePreviousContentFromTutor::`

**Valid values (case-insensitive):**
- True: `true`, `yes`, `1`
- False: `false`, `no`, `0`

**Invalid values produce an error.** Examples of invalid:
- `yes please` — extra text
- `TRUE!` — extra characters
- `y` — not in allowed list

## Content Headers

Markdown headers inside `content::` fields conflict with structural `#`/`##` markers.
Use `!` prefix to escape:

```markdown
## Text
content::
!# Welcome

This is the introduction.

!## Subsection

More content.
```

The `!` prefix is stripped during parsing, producing normal headers.

## Blank Lines

Blank lines are allowed anywhere and are ignored by the parser, except:
- Inside multi-line field values, where they're preserved

## Wiki-Links

References to other files use wiki-link syntax: `[[path/to/file]]`

- Used in `source::` fields
- Path is relative from file location, must start with `../`
- Extension `.md` is optional (auto-appended if missing)

**Example from `modules/lesson.md`:**
```markdown
source:: [[../video_transcripts/intro]]
```

## Course Format

Course files define lesson progression.

```markdown
---
slug: course-slug
title: Course Title
---

# Lesson: [[../modules/intro]]

# Meeting: 1

# Lesson: [[../modules/advanced]]
optional:: true

# Meeting: 2
```

### Elements

| Syntax | Description |
|--------|-------------|
| `# Lesson: [[path]]` | Lesson reference (wiki-link required) |
| `# Meeting: N` | Meeting marker with number |
| `optional:: true` | Marks preceding lesson as optional |

## Validation Summary

The validator enforces:

1. **Required frontmatter:** `slug` and `title`
2. **Valid header types:** Only recognized types at correct levels
3. **Required fields:** Each section/segment type has required fields
4. **No unknown fields:** Only declared fields allowed per type
5. **No stray content:** Excerpt segments allow only fields and blank lines
6. **Valid boolean values:** Only `true/false/yes/no/1/0`
7. **Double-colon syntax:** Single colon produces error with hint
8. **Wiki-link targets exist:** Referenced files must exist
