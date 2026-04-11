# Optional Lens Navigation — Design Spec

## Problem

The IABIED Book Club course has ~130 optional QA lenses, with up to ~45 per module. These are FAQ and Extended Discussion items from the book's companion website, converted into lenses. The current UI shows each optional lens as a branch dot in the module timeline, which is unworkable at this scale. Students need a way to browse, discover, and complete optional content freely.

## Solution Overview

Two new linking primitives (inline links and card links) that let course authors link between lenses, modules, and cross-module content. A "catalog lens" — a regular lens whose content is mostly card links organized with authored headers — serves as the browsable index for optional content. Optional lenses get a simplified completion flow (no chat required).

## Design

### 1. Two Link Styles: Inline Links & Card Links

All inter-content linking uses wikilinks. Two rendering modes:

**Inline links** render as simple hyperlinks within prose:
```markdown
See [[../Lenses/IABIED - QA - Why Write This Book]]
Check out [[../Lenses/IABIED - QA - Why Write This Book|this FAQ]]
Read [[../modules/IABIED M2 Nonhuman Minds, Part 2|Module 2]]
```

**Card links** render as rich interactive cards with metadata:
```markdown
::card[[../Lenses/IABIED - QA - Why Write This Book]]
::card[[../Lenses/IABIED - QA - Could ChatGPT Kill Us]]
::card[[../modules/IABIED M2 Nonhuman Minds, Part 2]]
```

| Feature | Inline `[[...]]` | Card `::card[[...]]` |
|---------|:-----------------:|:--------------------:|
| Display text | pipe alias or auto title | from frontmatter title |
| TLDR / description | — | from frontmatter tldr |
| Duration estimate | — | from word count / video |
| Completion state | — | checkmark if read |
| Content type icon | — | article/video/mixed |
| Use in prose | yes, inline in text | standalone block element |

### 2. Link Targets

Three linking scenarios, all using the same wikilink syntax:

**A. Lens to Lens (same module)**
- Navigation: Hash-scroll to that section within the current module player.
- Completion data: Already available from the module progress API response.
- Resolution: Content processor resolves wikilink path to contentId. Frontend matches contentId to a section index.

**B. Lens to Module**
- Navigation: `/course/:courseId/module/:moduleSlug`
- Completion data: Not shown initially (would need course progress API). Card shows title only.
- Resolution: Content processor resolves wikilink to module slug. Frontend builds URL from course context.

**C. Lens to Lens (different module)**
- Navigation: `/course/:courseId/module/:otherModuleSlug#section-slug`
- Completion data: Deferred — would need cross-module progress fetch. Card shows title + TLDR but no checkmark initially.
- Resolution: Content processor resolves lens contentId. A new lookup maps contentId to (moduleSlug, sectionIndex). This lookup is built during course flattening.

**Data flow:** The content processor already resolves wikilink paths to file paths. What's new: when a wikilink in a text segment points to a Lens or Module file, the processor includes structured link metadata in the output — not just the raw markdown text. This metadata includes: target type (lens/module), contentId, slug, title, tldr, displayType, wordCount, videoDurationSeconds.

### 3. Content Processor Changes

**Current behavior:** Text segments pass content through as-is. Wikilinks in `content::` fields are raw strings like `[[../Lenses/Foo]]` that ReactMarkdown doesn't understand.

**New behavior:** During flattening, scan text segment content for:
1. **Inline wikilinks** `[[path]]` or `[[path|display]]` — resolve and replace in-place with markdown links using a custom scheme: `[display text](lens:contentId)` or `[display text](module:slug)`. The frontend's `<a>` handler recognizes these schemes and builds real URLs from course context.
2. **Card links** `::card[[path]]` — resolve and replace in-place with an HTML block: `<div data-lens-card='{"contentId":"...","title":"...","tldr":"...","displayType":"...","wordCount":450,"moduleSlug":null}'></div>`. ReactMarkdown passes this through via `rehype-raw`.

**No placeholder system needed.** Both link types are resolved directly into the content string — inline links become standard markdown links (with custom schemes), card links become self-contained HTML blocks with JSON metadata in a data attribute. The TextSegment type does not change.

**Output examples:**

Input:
```markdown
See [[../Lenses/IABIED - QA - Why Write This Book|this FAQ]] and explore:
::card[[../Lenses/IABIED - QA - Could ChatGPT Kill Us]]
```

Output content string:
```markdown
See [this FAQ](lens:a9bf8d9f-cad8-4a86-9cfe-6c9bd4f33e5f) and explore:
<div data-lens-card='{"contentId":"...","targetType":"lens","title":"Could ChatGPT kill us all?","tldr":"Current AI systems aren't...","displayType":"lens-article","wordCount":320,"moduleSlug":null}'></div>
```

**`::card` parsing:** `::card[[...]]` is parsed as its own syntax rule with a dedicated regex, not as a generic directive. The `::card` prefix is followed by a standard wikilink. The directive validator is updated to not flag `::card` as an unknown directive. In Obsidian, `::card[[wikilink]]` renders as the text "::card" followed by a functioning wikilink — the link still works for navigation and backlinks.

### 4. Frontend Rendering

**AuthoredText changes:** `AuthoredText` currently receives a plain `content` string. Two additions:

1. **Inline links** — The custom `a` component handler in ReactMarkdown checks for `lens:` and `module:` href schemes. For `lens:contentId`, it builds a hash link (`#section-slug`) for same-module or a full URL (`/course/:id/module/:slug#section`) for cross-module. For `module:slug`, it builds `/course/:id/module/:slug`. The course context (courseId) is passed as a prop.
2. **Card links** — A custom `div` component handler in ReactMarkdown checks for `data-lens-card` attribute, parses the JSON, and renders a `LensCard` component.

**New props on AuthoredText:**
- `courseId?: string` — for building navigation URLs
- `moduleSlug?: string` — for identifying same-module links
- `completedContentIds?: Set<string>` — for card completion checkmarks

These are all optional — AuthoredText remains usable outside the module player with no changes.

**Completion state flow:** `Module.tsx` derives a `Set<string>` of completed contentIds from its existing `completedSections` state + `module.sections` array (memoized). This is passed to AuthoredText, which passes it to LensCard via the custom div handler.

**LensCard component:** New component that renders the rich card. Shows:
- Title (from JSON metadata)
- TLDR (truncated, from JSON metadata)
- Display type icon (article/video/mixed for lenses, book icon for modules)
- Duration estimate (from wordCount/videoDurationSeconds)
- Completion state (checkmark circle if completed, empty circle if not)

**Completion state source:**
- Same-module lenses: From `completedContentIds` prop.
- Cross-module lenses: Deferred. Card renders without checkmark.
- Modules: Deferred. Card renders title only, no progress indicator.

### 5. Completion Flow for Optional Lenses

Uses the same `MarkCompleteButton` as required lenses. The only difference:
- **Required lenses:** Button disabled until user sends a chat message.
- **Optional lenses:** Button enabled immediately — chat is available but not required.

Implementation: `MarkCompleteButton` already receives section data. Add a check: if `section.optional === true`, skip the "has user chatted?" gate. Everything else (API call, state update, etc.) stays the same.

### 6. Catalog Lens Pattern

A catalog lens is a regular lens whose content is primarily `::card` links to other lenses, organized with authored text headers. No new content model — course authors create these by hand in the relay.

Example content:
```markdown
#### Text
content::
Explore the Q&A resources for this week's reading. These are optional — browse what interests you.

**Introduction: Hard Calls and Easy Calls**

::card[[../Lenses/IABIED - QA - Why Write This Book]]
::card[[../Lenses/IABIED - QA - Could ChatGPT Kill Us]]
::card[[../Lenses/IABIED - QA - Panicking and Overreacting]]

**Chapter 1: Humanity's Special Power**

::card[[../Lenses/IABIED - QA - Is Intelligence Meaningful]]
::card[[../Lenses/IABIED - QA - General Intelligence]]
::card[[../Lenses/IABIED - QA - Machines Becoming Conscious]]
```

The frontend renders each `::card` as a rich card (Section 4). The authored text headers provide grouping. Course authors control the organization entirely.

## Implementation Phases

### Phase 1 — Inline Wikilinks + Mark-as-Read
Foundation pieces that are independently useful.
- **Content processor:** Resolve `[[wikilinks]]` in text segments — replace with markdown links using custom `lens:`/`module:` schemes directly in the content string.
- **Frontend:** Add custom `a` handler in AuthoredText's ReactMarkdown to recognize `lens:`/`module:` schemes and build navigation URLs from course context. Add `courseId` and `moduleSlug` props.
- **Completion:** In `Module.tsx`, skip the chat-required gate (the `chatGated` prop computation) when `section.optional === true`.

### Phase 2 — Card Links
Rich card rendering for catalog lenses and prominent cross-references.
- **Content processor:** Parse `::card[[path]]` as a dedicated syntax rule (not a generic directive). Replace with `<div data-lens-card='...'>` HTML blocks containing resolved metadata as JSON.
- **Frontend:** New `LensCard` component. Custom `div` handler in AuthoredText's ReactMarkdown renders `data-lens-card` elements. Add `completedContentIds` prop derived from Module.tsx state.
- **Content:** Course authors create catalog lenses in the relay using `::card` links.

### Phase 3 — Cross-Module Completion (Future)
Show completion state for lenses in other modules.
- **API:** `POST /api/progress/batch-status` — accepts array of contentIds, returns completion states.
- **Frontend:** LensCard fetches batch status on mount for cross-module links. Cache in context to avoid repeated calls.
- **Module cards:** Show module-level progress (e.g., "3/5 complete").
