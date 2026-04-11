# TOC Sticky Positioning Design

## Goal

Make the article TOC sidebar:
1. Start at the first article excerpt (not the section start)
2. Stick when reaching the header
3. Scroll away when the last excerpt's bottom pushes it up

All without laggy JS - pure CSS sticky behavior once DOM is structured correctly.

## Current Problem

The TOC is positioned at `top: 0` of the `ArticleSectionWrapper`, which wraps the entire section including intro text/chat before the first excerpt. This means the TOC appears too early.

## Solution: DOM Restructuring

Split article section rendering into three groups with the TOC's sticky container spanning only the excerpt group:

```
┌─────────────────────────────────────────┐
│  Pre-excerpt segments (intro, chat)     │  ← Normal flow
├─────────────────────────────────────────┤
│ ┌─────────┬─────────────────────────┐   │
│ │   TOC   │   Excerpt segments      │   │  ← Flex container
│ │ (sticky)│   (first to last)       │   │     TOC is sticky within this
│ └─────────┴─────────────────────────┘   │
├─────────────────────────────────────────┤
│  Post-excerpt segments (chat, etc)      │  ← Normal flow
└─────────────────────────────────────────┘
```

## Architecture

### Component Changes

**ArticleSectionWrapper** becomes a thin context provider only:

```tsx
// Just provides heading registration context
export default function ArticleSectionWrapper({ children }) {
  const [passedHeadingIds, setPassedHeadingIds] = useState<Set<string>>(new Set());
  const headingElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  // ... scroll tracking logic stays here ...

  return (
    <ArticleSectionProvider value={contextValue}>
      {children}
    </ArticleSectionProvider>
  );
}
```

**New: ArticleExcerptGroup** - the sticky container:

```tsx
type ArticleExcerptGroupProps = {
  section: ArticleSection;
  children: React.ReactNode; // The excerpt segments
};

export default function ArticleExcerptGroup({ section, children }: ArticleExcerptGroupProps) {
  return (
    <div className="relative">
      {/* Content column */}
      <div className="w-full">
        {children}
      </div>

      {/* TOC - positioned to left, sticky within this container */}
      <div className="hidden lg:block absolute left-0 top-0 bottom-0 -translate-x-full pr-8">
        <div className="sticky top-20">
          <ArticleTOC
            title={section.meta.title}
            author={section.meta.author}
            headings={extractHeadingsFromSection(section)}
            // ... other props from context
          />
        </div>
      </div>
    </div>
  );
}
```

**Module.tsx** - split segment rendering for article sections:

```tsx
// Inside the article section rendering:
const preExcerptSegments = [];
const excerptSegments = [];
const postExcerptSegments = [];

let seenFirstExcerpt = false;
let seenLastExcerpt = false;

for (const segment of section.segments) {
  if (segment.type === "article-excerpt") {
    seenFirstExcerpt = true;
    excerptSegments.push(segment);
  } else if (!seenFirstExcerpt) {
    preExcerptSegments.push(segment);
  } else {
    postExcerptSegments.push(segment);
    seenLastExcerpt = true;
  }
}

// Render:
<ArticleSectionWrapper section={section}>
  {/* Pre-excerpt content */}
  {preExcerptSegments.map((seg, i) => renderSegment(seg, section, sectionIndex, i))}

  {/* Excerpt group with sticky TOC */}
  <ArticleExcerptGroup section={section}>
    {excerptSegments.map((seg, i) =>
      renderSegment(seg, section, sectionIndex, preExcerptSegments.length + i)
    )}
  </ArticleExcerptGroup>

  {/* Post-excerpt content */}
  {postExcerptSegments.map((seg, i) =>
    renderSegment(seg, section, sectionIndex, preExcerptSegments.length + excerptSegments.length + i)
  )}
</ArticleSectionWrapper>
```

## Key Details

### Sticky Behavior

The magic is in `ArticleExcerptGroup`:
- Container has `position: relative`
- TOC wrapper has `absolute top-0 bottom-0` - spans full height of excerpt group
- Inner TOC has `sticky top-20` - sticks at 80px from viewport top
- When container scrolls out, sticky naturally releases

### Context Flow

```
ArticleSectionWrapper (provides context)
├── Pre-excerpt segments (can access context if needed)
├── ArticleExcerptGroup (renders TOC + excerpts)
│   └── Excerpt segments (register headings via context)
└── Post-excerpt segments (can access context if needed)
```

### Spacing

Ensure consistent vertical rhythm:
- Pre-excerpt segments have their normal bottom margin
- ArticleExcerptGroup has no extra top margin (excerpts provide their own)
- Post-excerpt segments have their normal top margin

## Files to Change

1. **Create:** `web_frontend_next/src/components/module/ArticleExcerptGroup.tsx`
2. **Modify:** `web_frontend_next/src/components/module/ArticleSectionWrapper.tsx` - simplify to context-only
3. **Modify:** `web_frontend_next/src/views/Module.tsx` - split segment rendering for article sections

## Verification

1. TOC appears aligned with first excerpt, not section start
2. TOC sticks when scrolling (at ~80px from top)
3. TOC scrolls away when last excerpt bottom passes
4. No visual jumpiness or lag during scroll
5. Pre/post-excerpt content renders with correct spacing
6. Heading click navigation still works
7. Heading scroll tracking still highlights correctly
