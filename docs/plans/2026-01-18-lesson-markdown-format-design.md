# Lesson Markdown Format Design

**Date:** 2026-01-18
**Status:** Draft
**Authors:** Luc, Plex (via brainstorming session)

## Overview

A Markdown-based format for defining course lessons, designed to be pleasant to edit in Obsidian while remaining parseable by the course platform. Replaces the current YAML-based lesson definitions.

## Goals

- **Obsidian-native editing** - natural to write and preview in Obsidian
- **Clear structure** - explicit section/segment boundaries, no ambiguity
- **Consistent syntax** - same `key:: value` pattern everywhere
- **No indentation sensitivity** - unlike YAML, prose flows naturally

## Format Specification

### Document Structure

```
---
frontmatter (YAML)
---

# Section
## Segment
## Segment

# Section
## Segment
```

### Frontmatter

Standard YAML frontmatter for document-level metadata:

```markdown
---
slug: lesson-slug
title: Lesson Title
---
```

### Sections (`#`)

Top-level content blocks. Four types:

| Type | Syntax | Description |
|------|--------|-------------|
| Video | `# Video: Title` | Video-based section with source reference |
| Article | `# Article: Title` | Article-based section with source reference |
| Text | `# Text: Title` | Standalone text content |
| Chat | `# Chat: Title` | Standalone chat/discussion |

**Video and Article sections** require a `source::` field and contain child segments.

**Text and Chat sections** are standalone (no child segments, content defined directly).

### Segments (`##`)

Child blocks within Video or Article sections. Four types:

| Type | Syntax | Description |
|------|--------|-------------|
| Text | `## Text` | Prose content with `content::` field |
| Chat | `## Chat` | Discussion prompt with `instructions::` field |
| Video-excerpt | `## Video-excerpt` | Video clip with `from::` and `to::` timestamps |
| Article-excerpt | `## Article-excerpt` | Article section with `from::` and `to::` text markers |

### Fields (`key::`)

All data uses the `key:: value` pattern:

**Single-line value:**
```markdown
from:: 0:00
to:: 5:00
```

**Multi-line value:**
```markdown
instructions::
TLDR of what the user just watched:
Humans dominate Earth because general intelligence enabled cumulative knowledge.

Discussion topics to explore:
- What is intelligence?
- Why are neural networks called "black boxes"?
```

Multi-line values continue until the next `key::`, `##`, or `#`.

### Content Headers (`!#`)

Markdown headers inside content fields use `!` prefix to avoid conflicting with structural markers:

```markdown
## Text
content::
!# Welcome to AI Safety

This is the introduction paragraph.

!## A Subsection

More content here.
```

The `!` is stripped during parsing, producing normal `#`, `##`, `###` headers.

## Complete Example

```markdown
---
slug: introduction-to-ai-safety
title: Introduction to AI Safety
---

# Video: A.I. - Humanity's Final Invention
source:: [[video_transcripts/fa8k8IQ1_X0]]

## Text
content::
!# Welcome to AI Safety

We begin by examining the potential of AI and the risks and opportunities
that the characteristics of this technology present to humanity.

Watch this video from Kurzgesagt to understand why artificial intelligence
might be humanity's most important invention.

## Video-excerpt
from:: 0:00
to:: 5:00

## Text
content::
**Reflection:**

The video describes how humans dominate Earth because of our general
intelligence. It also explains the difference between narrow AI and AGI.

## Chat
showUserPreviousContent:: true
instructions::
TLDR of what the user just watched:
Humans dominate Earth because general intelligence enabled cumulative knowledge.
Modern AI evolved from narrow tools into opaque "black box" learning systems.

Discussion topics to explore:
- What is intelligence as "problem-solving ability" and why is it a source of power?
- Why are neural networks called "black boxes"?
- What's the difference between narrow AI (like ChatGPT) and AGI?

Start by asking what stood out or surprised them. Use Socratic questioning to
check their understanding of these concepts.

## Video-excerpt
from:: 5:00
to:: 10:00

## Text
content::
The video introduces the concept of an **intelligence explosion** - a rapid,
recursive cycle of AI self-improvement that could outpace human oversight.

## Chat
showUserPreviousContent:: true
showTutorPreviousContent:: true
instructions::
The user just watched the second half of the video about AI risks.

Discussion topics:
- How could an "intelligence explosion" happen through recursive self-improvement?
- Why might controlling superintelligent AI be difficult?

Check if they understand why speed of improvement matters.

# Article: Existential Risk from AI
source:: [[articles/wikipedia-existential-risk-from-ai]]

## Text
content::
!## Understanding Existential Risk from AI

Now let's read an overview of the main concepts regarding AI as a source
of existential threat: what capabilities of this technology are considered
most concerning, and why the task of eliminating AI risks differs from
similar tasks for other technologies.

## Article-excerpt
from:: "**Existential risk from artificial intelligence**"
to:: "improve their fundamental architecture."

## Text
content::
**Key concepts so far:**

- AI x-risk refers to the possibility that AGI could cause human extinction
- The "Gorilla Problem": just as gorillas depend on human goodwill, humans
  might depend on AI's goodwill
- Many leading AI researchers take this risk seriously

## Chat
showUserPreviousContent:: true
instructions::
The user just read the introduction to AI existential risk from Wikipedia.

Key concepts covered:
- AI x-risk hypothesis
- The gorilla analogy (Stuart Russell)
- Expert surveys showing concern

Discussion topics:
- What is the "Gorilla Problem" and why is it a useful analogy?
- Why do many AI researchers believe there's a significant chance of catastrophe?

Ask what they found surprising or new.

## Article-excerpt
from:: "One of the earliest authors"
to:: "strong public buy-in."

## Article-excerpt
from:: "### General Intelligence"
to:: "evasion of human control"

## Text
content::
**The path from AGI to superintelligence:**

Notice Bostrom's list of advantages AI has over human brains: speed,
scalability, duplicability. These aren't science fiction - they're
inherent properties of software.

## Chat
instructions::
The user just read about AGI and superintelligence capabilities.

Key points:
- AGI = human-level across most tasks
- Superintelligence = vastly exceeds humans in all domains
- AI advantages: speed, scalability, duplicability, editability

Discussion topics:
- Why might the transition from AGI to superintelligence be rapid?
- Which of the AI advantages over human brains seems most significant?

# Text: Summary
content::
!# Key Takeaways

1. **Intelligence is power** - Humans dominate Earth because of general intelligence
2. **AI is different** - Digital minds can run faster, scale, and be copied
3. **The alignment problem** - Ensuring AI goals match human values is extremely difficult
4. **Expert concern** - Many leading researchers believe AI poses existential risk
5. **Timelines are uncertain** - AGI could arrive within years or decades

In the next lesson, we'll explore common objections to AI safety concerns
and how researchers respond to them.
```

## Parsing Rules

### 1. Extract Frontmatter
Parse YAML between `---` markers for `slug`, `title`, and other document metadata.

### 2. Split into Sections
Split on lines matching `^# (Video|Article|Text|Chat): (.+)$`

### 3. Parse Section
- Extract type and title from header
- For Video/Article: extract `source::` field, then parse child segments
- For Text/Chat: parse fields directly (no child segments)

### 4. Split into Segments (for Video/Article sections)
Split on lines matching `^## (Text|Chat|Video-excerpt|Article-excerpt)$`

### 5. Parse Fields
For each section or segment:
- Find all `key::` patterns
- Single-line: `key:: value` on same line
- Multi-line: `key::` alone, value is all following lines until next `key::`, `##`, or `#`

### 6. Process Content Headers
In `content::` fields, replace `!#` with `#`, `!##` with `##`, etc.

## Field Reference

### Section Fields

| Section Type | Required Fields | Optional Fields |
|--------------|-----------------|-----------------|
| Video | `source::` | - |
| Article | `source::` | - |
| Text | `content::` | - |
| Chat | `instructions::` | `showUserPreviousContent::`, `showTutorPreviousContent::` |

### Segment Fields

| Segment Type | Required Fields | Optional Fields |
|--------------|-----------------|-----------------|
| Text | `content::` | - |
| Chat | `instructions::` | `showUserPreviousContent::`, `showTutorPreviousContent::` |
| Video-excerpt | `from::`, `to::` | - |
| Article-excerpt | `from::`, `to::` | - |

## Deployment Architecture

### Content Repository Separation

Course content lives in a **separate GitHub repository** from the platform code:

```
github.com/org/course-platform     ← Platform code (FastAPI, React, etc.)
github.com/org/course-content      ← Lessons, articles, videos (Markdown)
```

**Why separate:**
- Obsidian/Relay syncs to content repo without touching platform code
- Different access permissions (course authors vs developers)
- Clean commit history (content changes don't mix with code changes)

### Loading External Content

Platform loads content via environment variable:

```python
# core/lessons/content.py
CONTENT_DIR = Path(os.environ.get("CONTENT_DIR",
    Path(__file__).parent.parent.parent / "educational_content"))
```

- **Local dev**: `CONTENT_DIR=/path/to/course-content python main.py --dev`
- **Staging/Prod**: CI clones content repo, sets `CONTENT_DIR`

### Hot Reload (Staging)

Target latency: **2-4 seconds** from GitHub push to content visible on staging.

```
GitHub push → Webhook → Staging server → git pull → Done
              ~1-2s                        ~1-2s
```

**Implementation:**
1. Add webhook endpoint to staging server: `POST /webhooks/content-update`
2. Endpoint runs `git pull` on the content directory
3. No server restart needed - content loads fresh on each request

**Note:** Relay-git-sync batches commits every ~10 seconds, so end-to-end latency from Obsidian save to staging is ~12-15 seconds.

### Production Deployment (Squash Merge)

Relay creates many small commits. Use **squash merge** for clean production history:

```
content repo (main branch, synced from Relay):
  abc123 - sync 10:00:01
  def456 - sync 10:00:11
  ghi789 - sync 10:00:21
          ↓
    PR to production branch
          ↓ (squash merge)
production branch:
  xyz999 - "Update lesson: Introduction to AI Safety"
```

**Workflow:**
1. Relay syncs to `main` branch with frequent small commits
2. Create PR: `main` → `production` when ready to deploy
3. Squash and merge with meaningful commit message
4. Production webhook triggers deployment

**GitHub repo settings:** Enable "Allow squash merging", optionally disable other merge types.

## Migration Path

1. Build parser for new Markdown format
2. Support both YAML and Markdown loaders (detect by file extension)
3. Convert existing YAML lessons to Markdown
4. Deprecate YAML format once migration complete

## Course Manifest Format

Course manifests define the progression of lessons and meetings. Same structural conventions as lessons.

### Structure

```markdown
---
slug: course-slug
title: Course Title
---

# Lesson: [[path/to/lesson]]
optional:: false

# Meeting: 1

# Lesson: [[path/to/another-lesson]]

# Meeting: 2
```

### Elements

| Syntax | Description |
|--------|-------------|
| `# Lesson: [[path]]` | Lesson reference using wiki-link |
| `# Meeting: number` | Meeting marker (synchronous session) |
| `optional:: true` | Marks preceding lesson as optional (defaults to false) |

### Complete Example

```markdown
---
slug: default
title: AI Safety Course
---

# Lesson: [[lessons/introduction]]

# Meeting: 1

# Lesson: [[lessons/alignment-problem]]

# Lesson: [[lessons/mesa-optimization]]
optional:: true

# Meeting: 2

# Lesson: [[lessons/governance]]

# Meeting: 3

# Lesson: [[lessons/career-paths]]

# Meeting: 4
```

### Parsing Rules

1. Extract YAML frontmatter for `slug` and `title`
2. Split on lines matching `^# (Lesson|Meeting): (.+)$`
3. For `# Lesson: [[path]]`: extract path from wiki-link, check for `optional::` field
4. For `# Meeting: number`: extract meeting number
5. Build progression array in order

## Resolved Decisions

1. **Wiki-links** - Use `[[path]]` syntax for all references (sources, lessons). Enables Obsidian navigation.

2. **Validation errors** - Surface via CI/GitHub Actions. Validation runs on push, results visible in PR checks.

3. **Course manifests** - Use same Markdown format as lessons (see above).

## Open Questions

1. **Comments** - Should we support comments in the format? (e.g., `// comment` or `<!-- comment -->`)
