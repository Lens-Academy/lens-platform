# TLDR Feature Design

## Goal

Every lens gets a TLDR (up to 80 words) in its frontmatter. TLDRs are surfaced in two places:
1. A modal when completing a section where optional content follows, helping users choose what to read next
2. The course overview, as subtitle text under each stage

## Content Format

New optional `tldr` field in lens frontmatter:

```yaml
---
id: abc-123
tldr: How cognitive biases affect our ability to evaluate AI risk
---
```

Plain text, no markdown. Max 80 words — content processor emits an error if exceeded.

## Content Processor Changes

- `content-schema.ts`: Add `tldr` to lens schema optional fields
- `parser/lens.ts`: Extract `tldr` from frontmatter, pass it into `ParsedLens`
- `validator/validate-frontmatter.ts` or a new check in lens parsing: Validate word count <= 80
- `flattener/index.ts`: Carry `tldr` from parsed lens into flattened section dict
- Course overview stage building: Include `tldr` in stage info

## Frontend Types

```typescript
// In LensVideoSection and LensArticleSection
tldr?: string | null;

// In StageInfo (course overview)
tldr?: string | null;
```

## Section Navigation Modal

**Trigger:** User marks a section complete AND the next section(s) include optional content before the next required section.

**Content:** Shows the next 2-3 sections with:
- Icon (article/video/page)
- Title
- TLDR text (if available)
- Optional badge
- Duration estimate

**Actions:**
- "Read [optional title]" — navigates to that section
- "Skip to [required title]" — skips optional content, jumps to next required section

Reuses the modal pattern from `ModuleCompleteModal`.

## Course Overview

In `ModuleOverview` (right panel), show TLDR as small gray subtitle text under each stage title. Always visible, no interaction needed.

## Validation

- `tldr` field is optional
- If present, must be <= 80 words (error if exceeded)
- Plain text only (no markdown syntax)
