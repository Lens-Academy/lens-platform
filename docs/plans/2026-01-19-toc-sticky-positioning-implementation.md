# TOC Sticky Positioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the TOC sidebar start at the first article excerpt and scroll away with the last excerpt, using pure CSS sticky behavior.

**Architecture:** Split article section rendering into three groups (pre-excerpt, excerpts, post-excerpt). The excerpt group is wrapped in a new `ArticleExcerptGroup` component that renders the TOC in an absolutely-positioned container spanning the group's height, with sticky positioning inside.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## Task 1: Create ArticleExcerptGroup Component

The sticky container that renders TOC alongside excerpt content.

**Files:**
- Create: `web_frontend_next/src/components/module/ArticleExcerptGroup.tsx`

**Step 1: Create the component file**

```typescript
// web_frontend_next/src/components/module/ArticleExcerptGroup.tsx
"use client";

import { useMemo } from "react";
import type { ArticleSection, ArticleExcerptSegment } from "@/types/module";
import { extractHeadings } from "@/utils/extractHeadings";
import ArticleTOC from "./ArticleTOC";
import { useArticleSectionContext } from "./ArticleSectionContext";

type ArticleExcerptGroupProps = {
  section: ArticleSection;
  children: React.ReactNode;
};

/**
 * Wrapper for article excerpt segments that renders the TOC sidebar.
 * The TOC is sticky within this container, so it:
 * - Starts aligned with the first excerpt
 * - Sticks when reaching the header
 * - Scrolls away when the last excerpt ends
 */
export default function ArticleExcerptGroup({
  section,
  children,
}: ArticleExcerptGroupProps) {
  const context = useArticleSectionContext();

  // Extract headings from all article-excerpt segments
  const allHeadings = useMemo(() => {
    const excerpts = section.segments.filter(
      (s): s is ArticleExcerptSegment => s.type === "article-excerpt",
    );
    return excerpts.flatMap((excerpt) => extractHeadings(excerpt.content));
  }, [section.segments]);

  return (
    <div className="relative">
      {/* Content column - full width */}
      <div className="w-full">{children}</div>

      {/* TOC Sidebar - spans full height of this container */}
      <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-[280px] -translate-x-full pr-8">
        <div className="sticky top-20">
          <ArticleTOC
            title={section.meta.title}
            author={section.meta.author}
            headings={allHeadings}
            passedHeadingIds={context?.passedHeadingIds ?? new Set()}
            onHeadingClick={context?.onHeadingClick ?? (() => {})}
          />
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify compilation**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors (or pre-existing errors only)

**Step 3: Commit**

```bash
jj desc -m "feat: add ArticleExcerptGroup component for TOC sticky positioning"
```

---

## Task 2: Update ArticleSectionContext to Include TOC State

The context needs to expose `passedHeadingIds` and `onHeadingClick` for ArticleExcerptGroup.

**Files:**
- Modify: `web_frontend_next/src/components/module/ArticleSectionContext.tsx`

**Step 1: Update the context type**

Replace the entire file:

```typescript
// web_frontend_next/src/components/module/ArticleSectionContext.tsx
"use client";

import { createContext, useContext } from "react";

type ArticleSectionContextValue = {
  onHeadingRender: (id: string, element: HTMLElement) => void;
  passedHeadingIds: Set<string>;
  onHeadingClick: (id: string) => void;
};

const ArticleSectionContext = createContext<ArticleSectionContextValue | null>(
  null,
);

export function useArticleSectionContext() {
  return useContext(ArticleSectionContext);
}

export const ArticleSectionProvider = ArticleSectionContext.Provider;
```

**Step 2: Verify compilation**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: Errors in ArticleSectionWrapper (we'll fix in next task)

**Step 3: Commit**

```bash
jj desc -m "feat: extend ArticleSectionContext with TOC state"
```

---

## Task 3: Simplify ArticleSectionWrapper to Context Provider Only

Remove the TOC rendering from this component - it now only provides context.

**Files:**
- Modify: `web_frontend_next/src/components/module/ArticleSectionWrapper.tsx`

**Step 1: Replace the entire file**

```typescript
// web_frontend_next/src/components/module/ArticleSectionWrapper.tsx
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArticleSectionProvider } from "./ArticleSectionContext";

type ArticleSectionWrapperProps = {
  children: React.ReactNode;
};

/**
 * Context provider for article sections.
 * Tracks scroll position to highlight headings in TOC.
 * The actual TOC is rendered by ArticleExcerptGroup.
 */
export default function ArticleSectionWrapper({
  children,
}: ArticleSectionWrapperProps) {
  const [passedHeadingIds, setPassedHeadingIds] = useState<Set<string>>(
    new Set(),
  );
  const headingElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  // Track heading elements as they render
  const handleHeadingRender = useCallback(
    (id: string, element: HTMLElement) => {
      headingElementsRef.current.set(id, element);
    },
    [],
  );

  // Scroll tracking for headings
  useEffect(() => {
    const calculatePassedHeadings = () => {
      const passed = new Set<string>();
      const scrollY = window.scrollY;
      const offset = 100; // Account for sticky header

      headingElementsRef.current.forEach((element, id) => {
        const rect = element.getBoundingClientRect();
        const elementTop = rect.top + scrollY;
        if (scrollY + offset >= elementTop) {
          passed.add(id);
        }
      });

      setPassedHeadingIds(passed);
    };

    // Throttle scroll handler
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          calculatePassedHeadings();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Initial calculation after a delay to let headings register
    const timeout = setTimeout(calculatePassedHeadings, 200);

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const handleHeadingClick = useCallback((id: string) => {
    const element = headingElementsRef.current.get(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      onHeadingRender: handleHeadingRender,
      passedHeadingIds,
      onHeadingClick: handleHeadingClick,
    }),
    [handleHeadingRender, passedHeadingIds, handleHeadingClick],
  );

  return (
    <ArticleSectionProvider value={contextValue}>
      {children}
    </ArticleSectionProvider>
  );
}
```

**Step 2: Verify compilation**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "refactor: simplify ArticleSectionWrapper to context provider only"
```

---

## Task 4: Update Module.tsx to Split Article Segments

Split article section rendering into pre-excerpt, excerpt group, and post-excerpt.

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Add import for ArticleExcerptGroup**

Find the imports section (around line 36) and add after the ArticleSectionWrapper import:

```typescript
import ArticleExcerptGroup from "@/components/module/ArticleExcerptGroup";
```

**Step 2: Replace the article section rendering block**

Find the article section case (lines 660-668):

```typescript
            ) : section.type === "article" ? (
              <>
                <SectionDivider type="article" />
                <ArticleSectionWrapper>
                  {section.segments?.map((segment, segmentIndex) =>
                    renderSegment(segment, section, sectionIndex, segmentIndex),
                  )}
                </ArticleSectionWrapper>
              </>
```

Replace with:

```typescript
            ) : section.type === "article" ? (
              <>
                <SectionDivider type="article" />
                <ArticleSectionWrapper>
                  {(() => {
                    // Split segments into pre-excerpt, excerpt, post-excerpt groups
                    const segments = section.segments ?? [];
                    const firstExcerptIdx = segments.findIndex(
                      (s) => s.type === "article-excerpt",
                    );
                    const lastExcerptIdx = segments.reduceRight(
                      (found, s, i) =>
                        found === -1 && s.type === "article-excerpt" ? i : found,
                      -1,
                    );

                    // If no excerpts, render all segments normally
                    if (firstExcerptIdx === -1) {
                      return segments.map((segment, segmentIndex) =>
                        renderSegment(segment, section, sectionIndex, segmentIndex),
                      );
                    }

                    const preExcerpt = segments.slice(0, firstExcerptIdx);
                    const excerpts = segments.slice(
                      firstExcerptIdx,
                      lastExcerptIdx + 1,
                    );
                    const postExcerpt = segments.slice(lastExcerptIdx + 1);

                    return (
                      <>
                        {/* Pre-excerpt content (intro, setup) */}
                        {preExcerpt.map((segment, i) =>
                          renderSegment(segment, section, sectionIndex, i),
                        )}

                        {/* Excerpt group with sticky TOC */}
                        <ArticleExcerptGroup section={section}>
                          {excerpts.map((segment, i) =>
                            renderSegment(
                              segment,
                              section,
                              sectionIndex,
                              firstExcerptIdx + i,
                            ),
                          )}
                        </ArticleExcerptGroup>

                        {/* Post-excerpt content (reflection, chat) */}
                        {postExcerpt.map((segment, i) =>
                          renderSegment(
                            segment,
                            section,
                            sectionIndex,
                            lastExcerptIdx + 1 + i,
                          ),
                        )}
                      </>
                    );
                  })()}
                </ArticleSectionWrapper>
              </>
```

**Step 3: Verify compilation**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 4: Run lint**

Run: `cd web_frontend_next && npm run lint`
Expected: No errors (or pre-existing only)

**Step 5: Commit**

```bash
jj desc -m "feat: split article segments for TOC sticky positioning"
```

---

## Task 5: Manual Testing

**Files:** None (testing only)

**Step 1: Start the dev servers**

Terminal 1: `python main.py --no-bot`
Terminal 2: `cd web_frontend_next && npm run dev`

**Step 2: Navigate to an article module**

Find a module that has an article section with:
- Some intro text or chat BEFORE the first excerpt
- Multiple article excerpts
- Optionally, content AFTER the last excerpt

**Step 3: Verify behavior**

- [ ] TOC appears aligned with the first excerpt (not the section start)
- [ ] Intro content above the excerpts does NOT have TOC beside it
- [ ] TOC sticks when scrolling (at ~80px from viewport top)
- [ ] TOC scrolls away when the last excerpt's bottom pushes it up
- [ ] Post-excerpt content (if any) does NOT have TOC beside it
- [ ] No visual lag or jumpiness during scroll
- [ ] Heading click navigation still works
- [ ] Heading scroll tracking highlights correctly
- [ ] TOC hidden on mobile (< lg breakpoint)

**Step 4: Final commit**

```bash
jj desc -m "feat: TOC sticky positioning - starts at first excerpt, ends at last

- TOC now appears aligned with first article excerpt
- Scrolls naturally until hitting header, then sticks
- Scrolls away when last excerpt ends
- Pre/post-excerpt content renders without TOC sidebar
- Pure CSS sticky behavior, no JS during scroll"
```

---

## Files Summary

**Created:**
- `web_frontend_next/src/components/module/ArticleExcerptGroup.tsx`

**Modified:**
- `web_frontend_next/src/components/module/ArticleSectionContext.tsx`
- `web_frontend_next/src/components/module/ArticleSectionWrapper.tsx`
- `web_frontend_next/src/views/Module.tsx`
