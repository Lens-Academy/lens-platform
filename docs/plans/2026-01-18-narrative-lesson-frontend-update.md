# Narrative Lesson Frontend Update Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the Next.js frontend to consume the new bundled narrative lesson API format.

**Architecture:** The backend now bundles all content (article excerpts, video transcripts) directly in the API response. The frontend no longer needs to fetch article content separately - it just renders what the API provides.

**Tech Stack:** Next.js, TypeScript, React

---

## Summary of Backend API Changes

The new `/api/lessons/{slug}` endpoint returns bundled content:

```json
{
  "slug": "narrative-test",
  "title": "Test Narrative Lesson",
  "sections": [
    {
      "type": "article",
      "meta": {"title": "...", "author": "...", "sourceUrl": "..."},
      "segments": [
        {"type": "text", "content": "..."},
        {"type": "article-excerpt", "content": "... (already extracted!)"},
        {"type": "chat", "instructions": "...", "showUserPreviousContent": true, "showTutorPreviousContent": true}
      ]
    },
    {
      "type": "video",
      "videoId": "fa8k8IQ1_X0",
      "meta": {"title": "...", "channel": null},
      "segments": [
        {"type": "text", "content": "..."},
        {"type": "video-excerpt", "from": 0, "to": 180, "transcript": "..."},
        {"type": "chat", ...}
      ]
    },
    {
      "type": "text",
      "content": "Standalone text section..."
    }
  ]
}
```

**Key changes from old format:**
1. `article-excerpt` segments now have `content` (pre-extracted)
2. `video-excerpt` segments now have `transcript`
3. `chat` segments now have `instructions`, `showUserPreviousContent`, `showTutorPreviousContent`
4. Sections have `meta` object instead of `source`/`label`
5. New `text` section type (standalone, not within article/video)
6. No `format: "narrative"` field

---

## Task 1: Update TypeScript Types

**Files:**
- Modify: `web_frontend_next/src/types/narrative-lesson.ts`

**Step 1: Update segment types**

Replace the segment type definitions:

```typescript
// Segment types within a section
export type TextSegment = {
  type: "text";
  content: string;
};

export type ArticleExcerptSegment = {
  type: "article-excerpt";
  content: string; // Pre-extracted content from API
};

export type VideoExcerptSegment = {
  type: "video-excerpt";
  from: number;
  to: number;
  transcript: string; // Transcript text from API
};

export type ChatSegment = {
  type: "chat";
  instructions: string;
  showUserPreviousContent: boolean;
  showTutorPreviousContent: boolean;
};
```

**Step 2: Update section types**

Replace the section type definitions:

```typescript
// Metadata for article sections
export type ArticleMeta = {
  title: string;
  author: string | null;
  sourceUrl: string | null;
};

// Metadata for video sections
export type VideoMeta = {
  title: string;
  channel: string | null;
};

// Section types
export type NarrativeTextSection = {
  type: "text";
  content: string;
};

export type NarrativeArticleSection = {
  type: "article";
  meta: ArticleMeta;
  segments: NarrativeSegment[];
};

export type NarrativeVideoSection = {
  type: "video";
  videoId: string;
  meta: VideoMeta;
  segments: NarrativeSegment[];
};

export type NarrativeSection =
  | NarrativeTextSection
  | NarrativeArticleSection
  | NarrativeVideoSection;
```

**Step 3: Update lesson type**

```typescript
export type NarrativeLesson = {
  slug: string;
  title: string;
  sections: NarrativeSection[];
};
```

**Step 4: Remove unused types**

Remove `NarrativeLessonState` and the import of `ArticleData` if no longer needed.

**Step 5: Verify types compile**

Run: `cd web_frontend_next && npx tsc --noEmit`

**Step 6: Commit**

```bash
jj describe -m "types(narrative): update TypeScript types to match bundled API"
jj new
```

---

## Task 2: Remove Article Fetching Logic

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Remove article content state**

Delete these state variables (around lines 79-87):

```typescript
// DELETE THESE:
const [articleContent, setArticleContent] = useState<Record<string, ArticleData>>({});
const [articleFetchError, setArticleFetchError] = useState<string | null>(null);
```

**Step 2: Remove article fetching useEffect**

Delete the entire `fetchArticles` useEffect (around lines 113-156):

```typescript
// DELETE THIS ENTIRE BLOCK:
useEffect(() => {
  async function fetchArticles() {
    // ... all of this
  }
  fetchArticles();
}, [lesson.sections]);
```

**Step 3: Verify no type errors**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: Errors in `renderSegment` function (will fix in Task 3)

**Step 4: Commit**

```bash
jj describe -m "refactor(narrative): remove client-side article fetching"
jj new
```

---

## Task 3: Update Segment Rendering

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`

**Step 1: Update article-excerpt rendering**

Replace the `case "article-excerpt":` block (around lines 293-339):

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
  return (
    <ArticleEmbed
      key={`article-${keyPrefix}`}
      article={excerptData}
      showHeader={segmentIndex === 0}
    />
  );
}
```

**Step 2: Update video-excerpt rendering**

The current code at line 346 uses `section.videoId` which is still correct. But we should verify the types work:

```typescript
case "video-excerpt":
  if (section.type !== "video") return null;
  return (
    <VideoEmbed
      key={`video-${keyPrefix}`}
      videoId={section.videoId}
      start={segment.from}
      end={segment.to}
    />
  );
```

**Step 3: Update imports**

Remove unused imports at the top:
- Remove: `ArticleData` from unified-lesson if only used for local creation
- Keep: `ArticleData` if still needed for `ArticleEmbed` prop

Actually, check if `ArticleData` is still needed. If `ArticleEmbed` expects it, keep it.

**Step 4: Handle text sections**

Add handling for top-level text sections in the section rendering. Update the section map (around line 406):

```typescript
{lesson.sections.map((section, sectionIndex) => (
  <div
    key={sectionIndex}
    ref={(el) => {
      if (el) sectionRefs.current.set(sectionIndex, el);
    }}
    data-section-index={sectionIndex}
    className="py-8"
  >
    {section.type === "text" ? (
      // Top-level text section (no segments)
      <AuthoredText content={section.content} />
    ) : (
      // Article/Video section with segments
      section.segments.map((segment, segmentIndex) =>
        renderSegment(segment, section, sectionIndex, segmentIndex),
      )
    )}
  </div>
))}
```

**Step 5: Verify types compile**

Run: `cd web_frontend_next && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
jj describe -m "feat(narrative): render bundled content from API"
jj new
```

---

## Task 4: Update ProgressSidebar for New Section Types

**Files:**
- Modify: `web_frontend_next/src/components/narrative-lesson/ProgressSidebar.tsx`

**Step 1: Read current implementation**

Read the file to understand how it currently derives labels from sections.

**Step 2: Update label derivation**

The sidebar needs to show section labels. Old format had `section.label`, new format uses `section.meta.title` or derives from type:

```typescript
function getSectionLabel(section: NarrativeSection, index: number): string {
  if (section.type === "text") {
    return `Section ${index + 1}`;
  }
  return section.meta.title || `${section.type} ${index + 1}`;
}
```

**Step 3: Verify visually**

Open http://localhost:3000/narrative/narrative-test and check sidebar renders correctly.

**Step 4: Commit**

```bash
jj describe -m "fix(narrative): update sidebar labels for new API format"
jj new
```

---

## Task 5: Clean Up Unused Code

**Files:**
- Modify: `web_frontend_next/src/views/NarrativeLesson.tsx`
- Modify: `web_frontend_next/src/types/narrative-lesson.ts`

**Step 1: Remove extractExcerpt function**

Delete the `extractExcerpt` helper function (lines 33-48) - no longer needed since API extracts content:

```typescript
// DELETE THIS FUNCTION:
function extractExcerpt(content: string, from: string, to: string): string {
  // ...
}
```

**Step 2: Clean up imports**

Remove any unused imports from both files.

**Step 3: Run linter**

Run: `cd web_frontend_next && npm run lint`
Fix any warnings.

**Step 4: Commit**

```bash
jj describe -m "chore(narrative): remove unused excerpt extraction code"
jj new
```

---

## Task 6: Manual Testing

**No code changes - verification only**

**Step 1: Start servers**

Ensure both servers are running:
- Backend: `python main.py --dev --no-bot` (port 8000)
- Frontend: `cd web_frontend_next && npm run dev` (port 3000)

**Step 2: Test narrative lesson page**

Open: http://localhost:3000/narrative/narrative-test

Verify:
- [ ] Article excerpts display with content (not "failed to load")
- [ ] Article header shows title, author, source link
- [ ] Video player loads and plays
- [ ] Text sections render as authored text (white bg)
- [ ] Chat sections appear and accept input
- [ ] Progress sidebar shows section labels
- [ ] Scrolling updates progress indicator

**Step 3: Test error cases**

- Load non-existent lesson: http://localhost:3000/narrative/does-not-exist
- Verify graceful error message

**Step 4: Report results**

Document any issues found for follow-up.

---

## Summary of Changes

| File | Change |
|------|--------|
| `types/narrative-lesson.ts` | Update types to match bundled API |
| `views/NarrativeLesson.tsx` | Remove article fetching, use bundled content |
| `components/narrative-lesson/ProgressSidebar.tsx` | Update label derivation |

**Total: 5 implementation tasks + 1 testing task**
