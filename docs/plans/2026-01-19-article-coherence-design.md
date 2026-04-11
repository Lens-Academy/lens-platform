# Article Coherence Design

## Problem

When showing multiple excerpts from the same article in the module viewer, they feel like separate articles rather than a cohesive journey through one piece. Issues include:
- Repeated title/attribution on each excerpt
- Grey panel styling feels disconnected
- No visual indication of where you are within the article

## Solution

Add a **TOC sidebar** that provides persistent navigation context, combined with refined excerpt markers that reinforce continuity.

## Design

### Layout Structure

Two-column layout when viewing article-based sections:

```
┌──────────────────┬─────────────────────────┐
│ Article Title    │                         │
│ by Author        │                         │
│ ──────────────── │                         │
│ The Alignment... │   Content area          │
│   Why it matters │                         │
│ Current Approa...│                         │
│   RLHF           │                         │
│   Constitutional │                         │
│ Open Questions   │                         │
└──────────────────┴─────────────────────────┘
```

**Left: TOC Sidebar (~280px, spacious)**
- Article title at top
- Author name below title
- Horizontal divider
- Nested list of headers extracted from the excerpts being shown
  - h2 headers at root level
  - h3 headers indented beneath their parent h2

**Right: Content Area (remaining width)**
- Scrollable area showing current content (article excerpt, intro text, chat)
- Max width constrained for readability

### TOC Behavior

**Header extraction:**
- Parse all excerpts being shown in the current section
- Extract h2 and h3 headers
- Display as nested, clickable list
- Clicking a header scrolls content area to that position

**Scroll progress indication:**
- Sections you've passed: dark gray text
- Current section: dark gray text (same as passed)
- Upcoming sections: light gray text
- Creates a "filling up" effect as user progresses

**Visibility:**
- TOC sidebar remains visible throughout the entire section
- Stays visible during article excerpts, intro text, and chat activities
- Provides persistent context regardless of current content type

### Excerpt Markers

**First excerpt from an article:**
- Full attribution block in content area:
  - Article title (h1)
  - Author name
  - "Read original" link (opens in new tab)
- Standard left-aligned presentation

**Subsequent excerpts from the same article:**
- Right-aligned label in muted gray (matching existing "excerpt by Author" color)
- Small article icon + "from [Article Title]"
- Horizontal divider below before content begins

```
                          📄 from "Existential Risk from AI"
────────────────────────────────────────────────────────────

[Excerpt content starts here...]
```

### Content Type Styling

**Article excerpts:**
- Light cream/off-white background
- Subtle warmth distinguishes from Lens Academy content
- Background extends full width of content area
- Static treatment, no animation

**Lens Academy content (intro text, guidance):**
- Standard page background (white/existing site default)
- Existing site typography and styling
- Distinct from article content through background color alone

**Chat windows:**
- Existing chat styling (no changes)
- TOC sidebar remains visible during chat activities

**Transitions:**
- No animation between content types
- Background color shift is the primary signal
- TOC highlighting provides continuous position context

## Mental Model

**"Guided reading" (Model A):** User is in the Lens Academy experience. We bring in article excerpts as supporting material. Our guidance is primary; articles are embedded resources we've curated for them.

The TOC shows "here's the journey we're taking through this article" - our curation, our pacing. The section numbering (implicit through TOC position) represents our internal structure, not the original article's outline.

## Out of Scope

- Animated transitions between content types
- Showing Lens Academy segments (intro, chat) in the TOC
- Visual markers for excerpt boundaries in the TOC
- Changes to existing typography (keep what works)
