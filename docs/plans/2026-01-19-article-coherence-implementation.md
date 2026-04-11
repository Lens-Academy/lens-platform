# Article Coherence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make multiple article excerpts within a section feel like a cohesive journey through one article, with a TOC sidebar for navigation and refined excerpt markers.

**Architecture:** Add a left TOC sidebar (~280px) that appears for article sections, showing title, author, and extracted headings. First excerpt shows full attribution; subsequent excerpts show a muted right-aligned "from [Title]" marker. Article content gets a warm cream background.

**Tech Stack:** React, TypeScript, Tailwind CSS, react-markdown

---

## Task 1: Create Heading Extraction Utility

Extract h2 and h3 headings from markdown content for the TOC. Also export the ID generation function for use in ArticleEmbed.

**Files:**
- Create: `web_frontend_next/src/utils/extractHeadings.ts`

**Step 1: Create the utility file**

```typescript
// web_frontend_next/src/utils/extractHeadings.ts

export type HeadingItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

/**
 * Generate a URL-safe ID from heading text.
 * Exported for use in both TOC extraction and heading rendering.
 */
export function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

/**
 * Extract h2 and h3 headings from markdown content.
 * Generates stable IDs from heading text for anchor linking.
 */
export function extractHeadings(markdown: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    // Match ## or ### at start of line
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length as 2 | 3;
      const text = match[2].trim();
      // Skip empty headings
      if (!text) continue;
      const id = generateHeadingId(text);
      headings.push({ id, text, level });
    }
  }

  return headings;
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: add extractHeadings utility for TOC generation"
```

---

## Task 2: Create ArticleTOC Component

The sidebar component showing article title, author, and navigable headings.

**Files:**
- Create: `web_frontend_next/src/components/module/ArticleTOC.tsx`

**Step 1: Create the component**

```typescript
// web_frontend_next/src/components/module/ArticleTOC.tsx
"use client";

import type { HeadingItem } from "@/utils/extractHeadings";

type ArticleTOCProps = {
  title: string;
  author: string | null;
  headings: HeadingItem[];
  /** IDs of headings that have been scrolled past or are current */
  passedHeadingIds: Set<string>;
  onHeadingClick: (id: string) => void;
};

/**
 * Table of contents sidebar for article sections.
 * Shows title, author, and nested headings with scroll progress.
 */
export default function ArticleTOC({
  title,
  author,
  headings,
  passedHeadingIds,
  onHeadingClick,
}: ArticleTOCProps) {
  return (
    <nav className="w-[280px] flex-shrink-0 pr-6" aria-label="Article table of contents">
      <div className="sticky top-20">
        {/* Article title */}
        <h2 className="text-base font-semibold text-gray-900 leading-snug">
          {title}
        </h2>

        {/* Author */}
        {author && (
          <p className="text-sm text-gray-500 mt-1">by {author}</p>
        )}

        {/* Divider */}
        <hr className="my-4 border-gray-200" />

        {/* Headings list */}
        <ul className="space-y-2" role="list">
          {headings.map((heading) => {
            const isPassed = passedHeadingIds.has(heading.id);
            return (
              <li
                key={heading.id}
                className={heading.level === 3 ? "pl-4" : ""}
              >
                <button
                  onClick={() => onHeadingClick(heading.id)}
                  className={`text-left text-sm leading-snug transition-colors hover:text-gray-900 ${
                    isPassed ? "text-gray-700" : "text-gray-400"
                  }`}
                >
                  {heading.text}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: add ArticleTOC component for sidebar navigation"
```

---

## Task 3: Create ArticleSectionContext for Heading Registration

Context to pass heading registration callback to ArticleEmbed children.

**Files:**
- Create: `web_frontend_next/src/components/module/ArticleSectionContext.tsx`

**Step 1: Create the context**

```typescript
// web_frontend_next/src/components/module/ArticleSectionContext.tsx
"use client";

import { createContext, useContext } from "react";

type ArticleSectionContextValue = {
  onHeadingRender: (id: string, element: HTMLElement) => void;
};

const ArticleSectionContext = createContext<ArticleSectionContextValue | null>(
  null
);

export function useArticleSectionContext() {
  return useContext(ArticleSectionContext);
}

export const ArticleSectionProvider = ArticleSectionContext.Provider;
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: add ArticleSectionContext for heading registration"
```

---

## Task 4: Update ArticleEmbed for First vs Subsequent Excerpts

Add `isFirstExcerpt` prop and change styling: warm background, different markers. Use shared `generateHeadingId` from utility and context for heading registration.

**Files:**
- Modify: `web_frontend_next/src/components/module/ArticleEmbed.tsx`

**Step 1: Replace the entire file contents**

```typescript
// web_frontend_next/src/components/module/ArticleEmbed.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { ArticleData } from "@/types/module";
import { generateHeadingId } from "@/utils/extractHeadings";
import { useArticleSectionContext } from "./ArticleSectionContext";

type ArticleEmbedProps = {
  article: ArticleData;
  /** Whether this is the first excerpt in the section (shows full attribution) */
  isFirstExcerpt?: boolean;
};

/**
 * Renders article content with warm background.
 * First excerpt shows full attribution; subsequent show muted marker.
 */
export default function ArticleEmbed({
  article,
  isFirstExcerpt = true,
}: ArticleEmbedProps) {
  const { content, title, author, sourceUrl } = article;
  const sectionContext = useArticleSectionContext();

  return (
    <div className="py-4">
      {/* Excerpt marker */}
      {isFirstExcerpt ? (
        // First excerpt: full attribution
        <div className="max-w-[700px] mx-auto px-4 mb-4">
          {title && (
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          )}
          {author && (
            <p className="text-sm text-gray-500 mt-1">by {author}</p>
          )}
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mt-2"
            >
              Read original
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
        </div>
      ) : (
        // Subsequent excerpt: muted right-aligned marker
        <div className="max-w-[700px] mx-auto px-4 mb-4">
          <div className="flex justify-end">
            <span className="text-sm text-gray-400 flex items-center gap-1.5">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              from &ldquo;{title}&rdquo;
            </span>
          </div>
          <hr className="mt-2 border-gray-200" />
        </div>
      )}

      {/* Article content with warm background */}
      <div className="bg-amber-50/50">
        <div className="max-w-[700px] mx-auto px-4 py-6">
          <article className="prose prose-gray max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ children, href }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
                  >
                    {children}
                  </a>
                ),
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold mt-8 mb-4">{children}</h1>
                ),
                h2: ({ children }) => {
                  const text = String(children);
                  const id = generateHeadingId(text);
                  return (
                    <h2
                      id={id}
                      ref={(el) => el && sectionContext?.onHeadingRender(id, el)}
                      className="text-xl font-bold mt-6 mb-3 scroll-mt-24"
                    >
                      {children}
                    </h2>
                  );
                },
                h3: ({ children }) => {
                  const text = String(children);
                  const id = generateHeadingId(text);
                  return (
                    <h3
                      id={id}
                      ref={(el) => el && sectionContext?.onHeadingRender(id, el)}
                      className="text-lg font-bold mt-5 mb-2 scroll-mt-24"
                    >
                      {children}
                    </h3>
                  );
                },
                h4: ({ children }) => (
                  <h4 className="text-base font-bold mt-4 mb-2">{children}</h4>
                ),
                p: ({ children }) => (
                  <p className="mb-4 leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-4 space-y-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-4 space-y-1">
                    {children}
                  </ol>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold">{children}</strong>
                ),
                em: ({ children }) => <em className="italic">{children}</em>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-gray-300 pl-4 italic my-4">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-8 border-gray-300" />,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-gray-300">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-gray-200">{children}</thead>
                ),
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => (
                  <tr className="border-b border-gray-300">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-2 text-left font-semibold border border-gray-300">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-2 border border-gray-300">{children}</td>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: update ArticleEmbed for first vs subsequent excerpt markers"
```

---

## Task 5: Create ArticleSectionWrapper Component

Wrapper that combines TOC sidebar with article content area and provides context.

**Files:**
- Create: `web_frontend_next/src/components/module/ArticleSectionWrapper.tsx`

**Step 1: Create the component**

```typescript
// web_frontend_next/src/components/module/ArticleSectionWrapper.tsx
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ArticleSection, ArticleExcerptSegment } from "@/types/module";
import { extractHeadings } from "@/utils/extractHeadings";
import ArticleTOC from "./ArticleTOC";
import { ArticleSectionProvider } from "./ArticleSectionContext";

type ArticleSectionWrapperProps = {
  section: ArticleSection;
  children: React.ReactNode;
};

/**
 * Wrapper for article sections that adds the TOC sidebar.
 * Tracks scroll position to highlight current heading in TOC.
 */
export default function ArticleSectionWrapper({
  section,
  children,
}: ArticleSectionWrapperProps) {
  const [passedHeadingIds, setPassedHeadingIds] = useState<Set<string>>(
    new Set()
  );
  const headingElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  // Extract all headings from all article-excerpt segments
  const allHeadings = useMemo(() => {
    const excerpts = section.segments.filter(
      (s): s is ArticleExcerptSegment => s.type === "article-excerpt"
    );
    return excerpts.flatMap((excerpt) => extractHeadings(excerpt.content));
  }, [section.segments]);

  // Clear heading refs when content changes
  useEffect(() => {
    headingElementsRef.current.clear();
  }, [allHeadings]);

  // Track heading elements as they render
  const handleHeadingRender = useCallback((id: string, element: HTMLElement) => {
    headingElementsRef.current.set(id, element);
  }, []);

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

    // Initial calculation
    const timeout = setTimeout(calculatePassedHeadings, 100);

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [allHeadings]);

  const handleHeadingClick = useCallback((id: string) => {
    const element = headingElementsRef.current.get(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const contextValue = useMemo(
    () => ({ onHeadingRender: handleHeadingRender }),
    [handleHeadingRender]
  );

  return (
    <ArticleSectionProvider value={contextValue}>
      <div className="flex max-w-[1100px] mx-auto px-4">
        {/* TOC Sidebar - hidden on mobile */}
        <div className="hidden lg:block">
          <ArticleTOC
            title={section.meta.title}
            author={section.meta.author}
            headings={allHeadings}
            passedHeadingIds={passedHeadingIds}
            onHeadingClick={handleHeadingClick}
          />
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </ArticleSectionProvider>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: add ArticleSectionWrapper with TOC sidebar and context"
```

---

## Task 6: Update Module.tsx to Use ArticleSectionWrapper

Integrate the wrapper for article sections and track excerpt indices.

**Depends on:** Tasks 1-5 must be complete.

**Files:**
- Modify: `web_frontend_next/src/views/Module.tsx`

**Step 1: Add import for ArticleSectionWrapper**

Find the imports section (around line 30-40) and add:

```typescript
import ArticleSectionWrapper from "@/components/module/ArticleSectionWrapper";
```

**Step 2: Update the article-excerpt case in renderSegment**

Find the `case "article-excerpt":` block in the `renderSegment` function and replace it:

```typescript
      case "article-excerpt": {
        // Content is now bundled directly in the segment
        const articleMeta = section.type === "article" ? section.meta : null;
        const excerptData: ArticleData = {
          content: segment.content,
          title: articleMeta?.title ?? null,
          author: articleMeta?.author ?? null,
          sourceUrl: articleMeta?.sourceUrl ?? null,
          isExcerpt: true,
        };

        // Count how many article-excerpt segments came before this one
        const excerptsBefore = section.type === "article"
          ? section.segments
              .slice(0, segmentIndex)
              .filter((s) => s.type === "article-excerpt").length
          : 0;
        const isFirstExcerpt = excerptsBefore === 0;

        return (
          <ArticleEmbed
            key={`article-${keyPrefix}`}
            article={excerptData}
            isFirstExcerpt={isFirstExcerpt}
          />
        );
      }
```

**Step 3: Update section rendering to wrap article sections**

Find the section rendering block in the main return statement (inside `module.sections.map`). Look for the final `else` branch that handles article and video sections with segments.

Find:
```typescript
            ) : (
              <>
                <SectionDivider type={section.type} />
                {section.segments?.map((segment, segmentIndex) =>
                  renderSegment(segment, section, sectionIndex, segmentIndex),
                )}
              </>
            )}
```

Replace with:
```typescript
            ) : section.type === "article" ? (
              <>
                <SectionDivider type="article" />
                <ArticleSectionWrapper section={section}>
                  {section.segments?.map((segment, segmentIndex) =>
                    renderSegment(segment, section, sectionIndex, segmentIndex),
                  )}
                </ArticleSectionWrapper>
              </>
            ) : (
              <>
                <SectionDivider type={section.type} />
                {section.segments?.map((segment, segmentIndex) =>
                  renderSegment(segment, section, sectionIndex, segmentIndex),
                )}
              </>
            )}
```

**Step 4: Verify it compiles**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: No errors

**Step 5: Run lint**

Run: `cd web_frontend_next && npm run lint`
Expected: No errors (or only pre-existing ones)

**Step 6: Commit**

```bash
jj desc -m "feat: integrate ArticleSectionWrapper in Module view"
```

---

## Task 7: Manual Testing

**Files:** None (testing only)

**Step 1: Start the dev server**

Run: `python main.py --dev --no-bot`
In another terminal: `cd web_frontend_next && npm run dev`

**Step 2: Navigate to a module with article excerpts**

Find or use a module that has an article section with multiple article-excerpt segments.

**Step 3: Verify behavior**

- [ ] TOC sidebar appears on left for article sections (~280px wide)
- [ ] TOC shows article title and author at top
- [ ] TOC shows extracted h2/h3 headings with nesting
- [ ] Headings start light gray, turn dark gray as you scroll past
- [ ] Clicking a TOC heading scrolls to that heading
- [ ] First excerpt shows full attribution (title, author, "Read original" link)
- [ ] Subsequent excerpts show right-aligned muted marker with document icon and "from [Title]"
- [ ] Article content has warm cream background (bg-amber-50/50)
- [ ] TOC hides on mobile/smaller screens (< lg breakpoint)
- [ ] Non-article sections (video, chat, text) render without TOC sidebar

**Step 4: Final commit**

```bash
jj desc -m "feat: article coherence - TOC sidebar and refined excerpt markers

- Add TOC sidebar for article sections showing title, author, headings
- Headings extracted from markdown, shown with h2/h3 nesting
- Scroll tracking: passed/current headings in dark gray, upcoming in light gray
- First excerpt shows full attribution (title, author, source link)
- Subsequent excerpts show muted right-aligned 'from [Title]' marker
- Article content has warm cream background for visual distinction
- TOC hides on mobile screens (< lg breakpoint)"
```

---

## Files Summary

**Created:**
- `web_frontend_next/src/utils/extractHeadings.ts`
- `web_frontend_next/src/components/module/ArticleTOC.tsx`
- `web_frontend_next/src/components/module/ArticleSectionContext.tsx`
- `web_frontend_next/src/components/module/ArticleSectionWrapper.tsx`

**Modified:**
- `web_frontend_next/src/components/module/ArticleEmbed.tsx`
- `web_frontend_next/src/views/Module.tsx`
