# Design Doc: TOC Heading ID Synchronization

## Problem Statement

The Table of Contents (TOC) in the module viewer has two broken features:
1. Clicking TOC items doesn't scroll to the corresponding section
2. Scrolling through the article doesn't update the TOC's visual progress

**Root Cause:** Heading IDs are generated independently in two places:
- **TOC extraction** (`ArticleExcerptGroup.tsx`) - single pass over all excerpts
- **Heading rendering** (`ArticleEmbed.tsx`) - each component has its own counter

When duplicate headings exist across excerpts, the IDs diverge:

| Location | Excerpt 1 "Intro" | Excerpt 2 "Intro" |
|----------|-------------------|-------------------|
| TOC extraction | `intro` | `intro-1` |
| DOM rendering | `intro` | `intro` (counter reset!) |

## Goals

1. **Single source of truth** for heading IDs
2. **IDs match** between TOC and rendered DOM elements
3. **Minimal changes** to existing component structure
4. **Maintain current UX** - TOC shows headings, clicking jumps, scrolling highlights

## Non-Goals

- Changing the TOC visual design
- Adding new TOC features (collapsible sections, etc.)
- Refactoring unrelated module viewer code

## Proposed Solution: Centralized ID Registry

Create a centralized heading ID registry that both TOC extraction and heading rendering use.

### Architecture

```
ArticleSectionWrapper
  │
  ├─ Creates HeadingIdRegistry from all excerpt content
  ├─ Provides registry via context
  │
  └─ ArticleExcerptGroup
       │
       ├─ Uses registry.getAllHeadings() for TOC
       │
       └─ ArticleEmbed (×N)
            │
            └─ Uses registry.getHeadingId(text) for each h2/h3
```

### Key Design Decision: Registry Initialization

The registry must be initialized with ALL heading text before any component renders. This happens in `ArticleSectionWrapper` which already wraps the entire section.

**Flow:**
1. `ArticleSectionWrapper` receives section data via props (new requirement)
2. On mount, extract all headings and build ID map
3. Provide `getHeadingId(text): string` via context
4. Both TOC and heading components use the same registry

### API Design

```typescript
// New type
type HeadingIdRegistry = {
  getAllHeadings(): HeadingItem[];
  getHeadingId(text: string): string;
};

// Extended context
type ArticleSectionContextValue = {
  // Existing
  onHeadingRender: (id: string, element: HTMLElement) => void;
  passedHeadingIds: Set<string>;
  onHeadingClick: (id: string) => void;
  // New
  headingRegistry: HeadingIdRegistry;
};
```

### ID Generation Strategy

Use a **consumption-based counter** that tracks how many times each base ID has been requested:

```typescript
function createHeadingIdRegistry(markdownContents: string[]): HeadingIdRegistry {
  // Pre-compute all headings for TOC
  const allHeadings = markdownContents.flatMap(content => extractHeadings(content));

  // Track consumption for rendering
  const consumptionCount = new Map<string, number>();

  return {
    getAllHeadings: () => allHeadings,

    getHeadingId: (text: string) => {
      const baseId = generateHeadingId(text);
      const count = consumptionCount.get(baseId) || 0;
      const id = count > 0 ? `${baseId}-${count}` : baseId;
      consumptionCount.set(baseId, count + 1);
      return id;
    }
  };
}
```

This works because:
- Extraction order (markdown parsing) matches render order (React component tree)
- Both use the same `generateHeadingId()` base function
- Counter increments on each call, matching the extraction behavior

## Implementation Plan

### Step 1: Create HeadingIdRegistry utility

**File:** `web_frontend/src/utils/headingIdRegistry.ts` (new file)

```typescript
import { extractHeadings, generateHeadingId, type HeadingItem } from "./extractHeadings";

export type HeadingIdRegistry = {
  getAllHeadings(): HeadingItem[];
  getHeadingId(text: string): string;
};

/**
 * Creates a registry that ensures heading IDs are consistent between
 * TOC extraction and heading rendering.
 *
 * Call getAllHeadings() once for TOC.
 * Call getHeadingId(text) for each heading during render (in document order).
 */
export function createHeadingIdRegistry(markdownContents: string[]): HeadingIdRegistry {
  // Pre-compute all headings (used by TOC)
  const allHeadings = markdownContents.flatMap(content => extractHeadings(content));

  // Track consumption count for rendering (mirrors extraction logic)
  const consumptionCount = new Map<string, number>();

  return {
    getAllHeadings: () => allHeadings,

    getHeadingId: (text: string) => {
      const baseId = generateHeadingId(text);
      const count = consumptionCount.get(baseId) || 0;
      const id = count > 0 ? `${baseId}-${count}` : baseId;
      consumptionCount.set(baseId, count + 1);
      return id;
    }
  };
}
```

### Step 2: Update ArticleSectionContext

**File:** `web_frontend/src/components/module/ArticleSectionContext.tsx`

Add `getHeadingId` to the context type:

```typescript
type ArticleSectionContextValue = {
  onHeadingRender: (id: string, element: HTMLElement) => void;
  passedHeadingIds: Set<string>;
  onHeadingClick: (id: string) => void;
  getHeadingId: (text: string) => string;  // NEW
};
```

### Step 3: Update ArticleSectionWrapper

**File:** `web_frontend/src/components/module/ArticleSectionWrapper.tsx`

Changes:
1. Accept `section: ArticleSection` as new prop
2. Create registry in `useMemo` from section's excerpt contents
3. Pass `registry.getHeadingId` through context
4. Expose `registry.getAllHeadings` for ArticleExcerptGroup

```typescript
type ArticleSectionWrapperProps = {
  section: ArticleSection;  // NEW - was just children
  children: React.ReactNode;
};

export default function ArticleSectionWrapper({
  section,
  children,
}: ArticleSectionWrapperProps) {
  // Create heading ID registry from all excerpt content
  const registry = useMemo(() => {
    const excerptContents = section.segments
      .filter((s): s is ArticleExcerptSegment => s.type === "article-excerpt")
      .map(s => s.content);
    return createHeadingIdRegistry(excerptContents);
  }, [section.segments]);

  // ... existing scroll tracking code ...

  const contextValue = useMemo(
    () => ({
      onHeadingRender: handleHeadingRender,
      passedHeadingIds,
      onHeadingClick: handleHeadingClick,
      getHeadingId: registry.getHeadingId,  // NEW
      getAllHeadings: registry.getAllHeadings,  // NEW - for ArticleExcerptGroup
    }),
    [handleHeadingRender, passedHeadingIds, handleHeadingClick, registry],
  );
  // ...
}
```

### Step 4: Update ArticleExcerptGroup

**File:** `web_frontend/src/components/module/ArticleExcerptGroup.tsx`

Remove local heading extraction, use context instead:

```typescript
export default function ArticleExcerptGroup({
  section,
  children,
}: ArticleExcerptGroupProps) {
  const context = useArticleSectionContext();

  // Use pre-computed headings from registry (removes extractHeadings call)
  const allHeadings = context?.getAllHeadings?.() ?? [];

  return (
    // ... rest unchanged, just uses allHeadings from context
  );
}
```

### Step 5: Update ArticleEmbed

**File:** `web_frontend/src/components/module/ArticleEmbed.tsx`

Remove local ID generation, use context:

```typescript
export default function ArticleEmbed({ article, isFirstExcerpt, showHeader }: ArticleEmbedProps) {
  const sectionContext = useArticleSectionContext();

  // REMOVE: seenIdsRef and getUniqueHeadingId function

  // In h2/h3 components, change:
  // const id = getUniqueHeadingId(text);
  // to:
  // const id = sectionContext?.getHeadingId(text) ?? generateHeadingId(text);

  // ... rest unchanged
}
```

### Step 6: Update Module.tsx

**File:** `web_frontend/src/views/Module.tsx`

Pass `section` prop to `ArticleSectionWrapper` (line 772):

```typescript
// Change from:
<ArticleSectionWrapper>

// To:
<ArticleSectionWrapper section={section}>
```

This is already available in scope since we're inside the `section.type === "article"` branch.

## Alternatives Considered

### A: Pass pre-computed IDs as props to ArticleEmbed

Each ArticleEmbed would receive a map of `text → id` for its headings.

**Rejected:** Requires threading props through multiple layers; harder to maintain.

### B: Global singleton ID generator

A module-level Map that persists across renders.

**Rejected:** Breaks React's render model; would cause bugs with multiple modules or hot reload.

### C: Use heading position (index) in ID

Generate IDs like `heading-0`, `heading-1` based on position.

**Rejected:** Loses semantic meaning in IDs; makes debugging harder; requires coordinating position across components.

## Testing Plan

1. **Manual testing:**
   - Module with single article, unique headings → click/scroll works
   - Module with single article, duplicate headings → IDs are unique, click/scroll works
   - Module with multiple articles, duplicate headings across articles → all IDs unique, click/scroll works

2. **Edge cases:**
   - Empty headings (should be skipped)
   - Very long heading text (truncated to 50 chars)
   - Special characters in headings (sanitized)

## Rollout

This is a bug fix with no user-facing changes beyond "it works now." Ship directly after testing.
