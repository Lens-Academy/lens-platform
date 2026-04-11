# Standalone Lens Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every non-ignored Lens directly loadable at `lensacademy.org/lens/<slug>`, plus a hidden index page listing all modules and lenses.

**Architecture:** The content processor gains a `flattenLens()` function that wraps a single Lens file into a `FlattenedModule` (slug, title, one section). These "lens-modules" enter the same `cache.flattened_modules` dict with a `lens/` slug prefix. The frontend reuses the existing `Module.tsx` component — a standalone lens is just a single-section module. A hidden `/content` index page lists all available content.

**Tech Stack:** TypeScript (Vitest), Python (FastAPI, pytest), React (Vike routing), Tailwind CSS v4

---

## Task 1: Slug utility — `fileNameToSlug()`

**Files:**
- Create: `content_processor/src/utils/slug.ts`
- Create: `content_processor/src/utils/slug.test.ts`

**Step 1: Write failing tests**

```typescript
// content_processor/src/utils/slug.test.ts
import { describe, it, expect } from 'vitest';
import { fileNameToSlug } from './slug.js';

describe('fileNameToSlug', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(fileNameToSlug('Four Background Claims')).toBe('four-background-claims');
  });

  it('strips .md extension if present', () => {
    expect(fileNameToSlug('Four Background Claims.md')).toBe('four-background-claims');
  });

  it('strips directory prefix', () => {
    expect(fileNameToSlug('Lenses/Four Background Claims.md')).toBe('four-background-claims');
  });

  it('collapses multiple hyphens', () => {
    expect(fileNameToSlug('AI - Humanity\'s Final Invention')).toBe('ai-humanitys-final-invention');
  });

  it('removes non-alphanumeric characters except hyphens', () => {
    expect(fileNameToSlug('What is (really) going on?')).toBe('what-is-really-going-on');
  });

  it('trims leading/trailing hyphens', () => {
    expect(fileNameToSlug('  --hello-- ')).toBe('hello');
  });

  it('handles single word', () => {
    expect(fileNameToSlug('intro')).toBe('intro');
  });

  it('returns fallback for pathological input', () => {
    // All special chars → empty after stripping → should return fallback
    expect(fileNameToSlug('!!!.md')).toBe('untitled');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd content_processor && npx vitest run src/utils/slug.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// content_processor/src/utils/slug.ts

/**
 * Convert a filename (with optional path prefix and .md extension) to a URL slug.
 * "Lenses/Four Background Claims.md" → "four-background-claims"
 */
export function fileNameToSlug(fileName: string): string {
  // Strip directory prefix — take only the final path segment
  const base = fileName.split('/').pop() ?? fileName;
  const slug = base
    .replace(/\.md$/i, '')       // strip .md
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric (keep spaces and hyphens)
    .replace(/[\s-]+/g, '-')     // spaces/hyphens → single hyphen
    .replace(/^-+|-+$/g, '');    // trim leading/trailing hyphens
  return slug || 'untitled';     // guard against empty result
}
```

**Step 4: Run test to verify it passes**

Run: `cd content_processor && npx vitest run src/utils/slug.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(content-processor): add fileNameToSlug utility
```

---

## Task 2: `flattenLens()` — wrap a single Lens as a FlattenedModule

This is the core of the feature. Extract the lens-flattening logic from `flattenLearningOutcomeSection` / `flattenUncategorizedSection` into a standalone public function.

**Files:**
- Modify: `content_processor/src/flattener/index.ts` — add `flattenLens()` export
- Modify: `content_processor/src/flattener/index.test.ts` — add tests

**Step 1: Write failing tests**

Add to `content_processor/src/flattener/index.test.ts`:

```typescript
import { flattenLens } from './index.js';  // add to existing imports

describe('flattenLens', () => {
  it('wraps an article lens as a single-section FlattenedModule', () => {
    const files = new Map([
      ['Lenses/Four Background Claims.md', `---
id: c3d4e5f6-a7b8-9012-cdef-345678901234
---
### Article: Four Background Claims
source:: [[../articles/soares-four-background-claims]]

#### Text
content::
This article explains the four key premises.

#### Article-excerpt
from:: # I. AI could be a really big deal
to:: # II. We may be able to influence
`],
      ['articles/soares-four-background-claims.md', `---
title: "Four Background Claims"
author: "Nate Soares"
source_url: "https://example.com/four-claims"
---

# I. AI could be a really big deal

First section content here.

# II. We may be able to influence

Second section content.
`],
    ]);

    const result = flattenLens('Lenses/Four Background Claims.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module).toBeDefined();
    expect(result.module!.slug).toBe('lens/four-background-claims');
    expect(result.module!.title).toBe('Four Background Claims');
    expect(result.module!.contentId).toBe('c3d4e5f6-a7b8-9012-cdef-345678901234');
    expect(result.module!.sections).toHaveLength(1);
    expect(result.module!.sections[0].type).toBe('lens-article');
    expect(result.module!.sections[0].contentId).toBe('c3d4e5f6-a7b8-9012-cdef-345678901234');
  });

  it('wraps a video lens as a single-section FlattenedModule', () => {
    const files = new Map([
      ['Lenses/Kurzgesagt software demo.md', `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
---
### Video: AI Humanity's Final Invention
source:: [[../video_transcripts/kurzgesagt-ai-humanitys-final-invention]]

#### Text
content::
Watch this introduction.

#### Video-excerpt
from:: 0:00
to:: 1:00
`],
      ['video_transcripts/kurzgesagt-ai-humanitys-final-invention.md', `---
title: "AI - Humanity's Final Invention?"
channel: "Kurzgesagt"
url: "https://www.youtube.com/watch?v=fa8k8IQ1_X0"
---

0:00 Hello and welcome
0:30 Today we discuss
1:00 The end
`],
      ['video_transcripts/kurzgesagt-ai-humanitys-final-invention.timestamps.json', `[
        {"word": "Hello", "start": 0, "end": 0.5},
        {"word": "and", "start": 0.5, "end": 0.7},
        {"word": "welcome", "start": 0.7, "end": 1.2},
        {"word": "Today", "start": 30, "end": 30.5},
        {"word": "we", "start": 30.5, "end": 30.7},
        {"word": "discuss", "start": 30.7, "end": 31.2},
        {"word": "The", "start": 60, "end": 60.5},
        {"word": "end", "start": 60.5, "end": 61}
      ]`],
    ]);

    const result = flattenLens('Lenses/Kurzgesagt software demo.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module).toBeDefined();
    expect(result.module!.slug).toBe('lens/kurzgesagt-software-demo');
    expect(result.module!.sections).toHaveLength(1);
    expect(result.module!.sections[0].type).toBe('lens-video');
    expect(result.module!.sections[0].videoId).toBe('fa8k8IQ1_X0');
  });

  it('wraps a page-only lens as a page-type section', () => {
    const files = new Map([
      ['Lenses/Simple Page.md', `---
id: 55555555-6666-7777-8888-999999999999
---
### Page: My Custom Page

#### Text
content::
Some page content here.

#### Chat
instructions::
What did you think?
`],
    ]);

    const result = flattenLens('Lenses/Simple Page.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module).toBeDefined();
    expect(result.module!.slug).toBe('lens/simple-page');
    expect(result.module!.title).toBe('My Custom Page');
    expect(result.module!.sections).toHaveLength(1);
    expect(result.module!.sections[0].type).toBe('page');
    // Should have both text and chat segments
    expect(result.module!.sections[0].segments.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null for ignored lenses', () => {
    const files = new Map([
      ['Lenses/Ignored.md', `---
id: 11111111-2222-3333-4444-555555555555
tags: [validator-ignore]
---
### Page: Test

#### Text
content::
Hello
`],
    ]);

    const tierMap = new Map([['Lenses/Ignored.md', 'ignored' as const]]);
    const result = flattenLens('Lenses/Ignored.md', files, tierMap);

    expect(result.module).toBeNull();
  });

  it('returns null for lenses with parse errors', () => {
    const files = new Map([
      ['Lenses/Bad.md', `not a valid lens file at all`],
    ]);

    const result = flattenLens('Lenses/Bad.md', files);

    expect(result.module).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd content_processor && npx vitest run src/flattener/index.test.ts`
Expected: FAIL — `flattenLens` is not exported

**Step 3: Write implementation**

Add to `content_processor/src/flattener/index.ts`:

1. Import `fileNameToSlug` from the new utility.
2. Add a new exported `flattenLens()` function that:
   - Checks if tier is `ignored` → return null
   - Gets file content from the map
   - Calls `parseLens(content, lensPath)` (already imported)
   - Iterates `lens.sections`, resolving article/video sources using the same `convertSegment()` logic already in the file
   - Wraps result in a `FlattenedModule` with `slug: 'lens/' + fileNameToSlug(lensPath)`, `title` from the lens section header, `contentId` from lens `id`

The implementation reuses `convertSegment()` (already a private function in the file) and the existing `parseWikilink` / `resolveWikilinkPath` / `findFileWithExtension` imports. This is structurally identical to the inner loop of `flattenUncategorizedSection` lines 527-630, but without the parent module context.

```typescript
import { fileNameToSlug } from '../utils/slug.js';

export function flattenLens(
  lensPath: string,
  files: Map<string, string>,
  tierMap?: Map<string, ContentTier>
): FlattenModuleResult {
  const errors: ContentError[] = [];

  // Skip ignored lenses
  if (tierMap?.get(lensPath) === 'ignored') {
    return { module: null, errors };
  }

  const lensContent = files.get(lensPath);
  if (!lensContent) {
    errors.push({
      file: lensPath,
      message: `Lens file not found: ${lensPath}`,
      severity: 'error',
    });
    return { module: null, errors };
  }

  const lensResult = parseLens(lensContent, lensPath);
  errors.push(...lensResult.errors);

  if (!lensResult.lens) {
    return { module: null, errors };
  }

  const lens = lensResult.lens;
  const visitedPaths = new Set<string>([lensPath]);

  // Process lens sections → single flattened Section
  let sectionType: 'page' | 'lens-video' | 'lens-article' = 'page';
  const meta: SectionMeta = {};
  const segments: Segment[] = [];
  let videoId: string | undefined;

  for (const lensSection of lens.sections) {
    // Determine section type and extract metadata
    // (Same logic as flattenUncategorizedSection lines 533-597)
    if (lensSection.type === 'lens-article') {
      sectionType = 'lens-article';
      if (lensSection.source) {
        const articleWikilink = parseWikilink(lensSection.source);
        if (articleWikilink && !articleWikilink.error) {
          const articlePathResolved = resolveWikilinkPath(articleWikilink.path, lensPath);
          const articlePath = findFileWithExtension(articlePathResolved, files);
          if (articlePath) {
            const articleContent = files.get(articlePath)!;
            const articleFrontmatter = parseFrontmatter(articleContent, articlePath);
            if (articleFrontmatter.frontmatter.title)
              meta.title = articleFrontmatter.frontmatter.title as string;
            if (articleFrontmatter.frontmatter.author)
              meta.author = articleFrontmatter.frontmatter.author as string;
            if (articleFrontmatter.frontmatter.source_url)
              meta.sourceUrl = articleFrontmatter.frontmatter.source_url as string;
          }
        }
      }
    } else if (lensSection.type === 'page') {
      sectionType = 'page';
      if (lensSection.title) meta.title = lensSection.title;
    } else if (lensSection.type === 'lens-video') {
      sectionType = 'lens-video';
      if (lensSection.source) {
        const videoWikilink = parseWikilink(lensSection.source);
        if (videoWikilink && !videoWikilink.error) {
          const videoPathResolved = resolveWikilinkPath(videoWikilink.path, lensPath);
          const videoPath = findFileWithExtension(videoPathResolved, files);
          if (videoPath) {
            const videoContent = files.get(videoPath)!;
            const videoFrontmatter = parseFrontmatter(videoContent, videoPath);
            if (videoFrontmatter.frontmatter.title)
              meta.title = videoFrontmatter.frontmatter.title as string;
            if (videoFrontmatter.frontmatter.channel)
              meta.channel = videoFrontmatter.frontmatter.channel as string;
            if (videoFrontmatter.frontmatter.url) {
              const extractedId = extractVideoIdFromUrl(videoFrontmatter.frontmatter.url as string);
              if (extractedId) videoId = extractedId;
            }
          }
        }
      }
    }

    for (const parsedSegment of lensSection.segments) {
      const segmentResult = convertSegment(parsedSegment, lensSection, lensPath, files, visitedPaths, tierMap);
      errors.push(...segmentResult.errors);
      if (segmentResult.segment) segments.push(segmentResult.segment);
    }
  }

  // Use meta.title if extracted from article/video source, else derive from filename
  if (!meta.title) {
    meta.title = fileNameToSlug(lensPath).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const section: Section = {
    type: sectionType,
    meta,
    segments,
    optional: false,
    learningOutcomeId: null,
    learningOutcomeName: null,
    contentId: lens.id ?? null,
    videoId: videoId ?? null,
  };

  const flattenedModule: FlattenedModule = {
    slug: 'lens/' + fileNameToSlug(lensPath),
    title: meta.title ?? fileNameToSlug(lensPath),
    contentId: lens.id ?? null,
    sections: [section],
  };

  return { module: flattenedModule, errors };
}
```

> **Note for implementer:** The metadata extraction blocks (article/video) are duplicated from the existing `flattenUncategorizedSection`. Consider extracting a shared helper `extractLensSectionMetadata()` in the refactor step *after* tests pass — but only if the duplication is bothersome. The existing code already duplicates this between `flattenLearningOutcomeSection` and `flattenUncategorizedSection`, so one more copy is consistent with current patterns.

**Step 4: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run src/flattener/index.test.ts`
Expected: ALL PASS (existing + new)

**Step 5: Commit**

```
feat(content-processor): add flattenLens() to wrap standalone lenses as modules
```

---

## Task 3: Integrate `flattenLens()` into `processContent()`

**Files:**
- Modify: `content_processor/src/index.ts:338-356` — add lens flattening in the `Lenses/` branch
- Modify: `content_processor/src/validator/standalone.test.ts` — add integration test

**Step 1: Write failing test**

Add to `content_processor/src/validator/standalone.test.ts`:

```typescript
describe('standalone lens flattening', () => {
  it('includes standalone lenses as lens/-prefixed modules in processContent output', () => {
    const files = new Map([
      ['Lenses/Test Lens.md', `---
id: 99999999-aaaa-bbbb-cccc-dddddddddddd
---
### Page: Test Content

#### Text
content::
Hello world
`],
    ]);

    const result = processContent(files);

    const lensModule = result.modules.find(m => m.slug === 'lens/test-lens');
    expect(lensModule).toBeDefined();
    expect(lensModule!.title).toBe('Test Content');
    expect(lensModule!.sections).toHaveLength(1);
    expect(lensModule!.sections[0].type).toBe('page');
  });

  it('excludes validator-ignore lenses from standalone modules', () => {
    const files = new Map([
      ['Lenses/Ignored Lens.md', `---
id: 88888888-aaaa-bbbb-cccc-dddddddddddd
tags: [validator-ignore]
---
### Page: Ignored

#### Text
content::
Ignored content
`],
    ]);

    const result = processContent(files);

    const lensModule = result.modules.find(m => m.slug === 'lens/ignored-lens');
    expect(lensModule).toBeUndefined();
  });

  it('does not create duplicate slug entries between regular modules and lens modules', () => {
    const files = new Map([
      ['modules/intro.md', `---
slug: intro
title: Intro
id: 11111111-1111-1111-1111-111111111111
---

# Page: Welcome
id:: 22222222-2222-2222-2222-222222222222

## Text
content::
Hello
`],
      ['Lenses/Test Lens.md', `---
id: 33333333-3333-3333-3333-333333333333
---
### Page: Test

#### Text
content::
World
`],
    ]);

    const result = processContent(files);

    // Both should appear
    expect(result.modules.find(m => m.slug === 'intro')).toBeDefined();
    expect(result.modules.find(m => m.slug === 'lens/test-lens')).toBeDefined();

    // No slug collision errors
    const slugErrors = result.errors.filter(e => e.message.includes('Duplicate slug'));
    expect(slugErrors).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd content_processor && npx vitest run src/validator/standalone.test.ts`
Expected: FAIL — no `lens/test-lens` module in output

**Step 3: Write implementation**

In `content_processor/src/index.ts`, modify the `Lenses/` branch (around line 338). After the existing validation, add the `flattenLens` call.

**Important:** Pass the already-parsed `result.lens` to `flattenLens()` to avoid re-parsing and duplicating errors. This requires updating `flattenLens()` to accept an optional pre-parsed lens (see note below).

```typescript
// Add to imports at top:
import { flattenModule, flattenLens } from './flattener/index.js';

// In the Lenses/ branch (line 338), after existing validation code:
} else if (path.startsWith('Lenses/') || path.includes('/Lenses/')) {
  // Existing validation (keep as-is) ...
  const result = parseLens(content, path);
  errors.push(...result.errors);
  if (result.lens) {
    const excerptErrors = validateLensExcerpts(result.lens, path, files, tierMap);
    errors.push(...excerptErrors);
  }
  if (result.lens?.id) {
    uuidEntries.push({ uuid: result.lens.id, file: path, field: 'id' });
  }

  // NEW: Flatten lens as standalone module (pass pre-parsed lens to avoid re-parsing)
  if (result.lens) {
    const lensModuleResult = flattenLens(path, files, tierMap, result.lens);
    if (lensModuleResult.module) {
      modules.push(lensModuleResult.module);
      slugEntries.push({ slug: lensModuleResult.module.slug, file: path });
      slugToPath.set(lensModuleResult.module.slug, path);  // For output integrity error paths
    }
    // Flattening errors (segment conversion) are real and not duplicates of parse errors — add them
    errors.push(...lensModuleResult.errors);
  }
```

**Update `flattenLens()` signature** (Task 2) to accept optional pre-parsed lens:

```typescript
export function flattenLens(
  lensPath: string,
  files: Map<string, string>,
  tierMap?: Map<string, ContentTier>,
  preParsedLens?: ParsedLens,  // Optional: skip re-parsing when called from processContent
): FlattenModuleResult {
  // ...
  // Replace the parse step with:
  const lens = preParsedLens ?? (() => {
    const lensResult = parseLens(lensContent, lensPath);
    errors.push(...lensResult.errors);
    return lensResult.lens;
  })();

  if (!lens) {
    return { module: null, errors };
  }
  // ... rest unchanged
```

This way `flattenLens()` works both standalone (in tests, with self-parsing) and from `processContent()` (with pre-parsed lens, no duplicate errors).

**Step 4: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```
feat(content-processor): integrate standalone lens flattening into processContent
```

---

## Task 4: Backend — accept slash in module slug

**Files:**
- Modify: `web_api/routes/modules.py` — reorder routes, use `{module_slug:path}`, add type filter
- Create or modify: `web_api/tests/test_modules_route.py` — add tests

**Critical routing constraint:** FastAPI `{slug:path}` is greedy — it consumes everything. Route order matters: the `/progress` route MUST be defined BEFORE the catch-all module route. Verified empirically: with correct ordering, `/api/modules/lens/foo/progress` matches the progress handler (slug=`lens/foo`), not the module handler.

**Step 1: Write failing tests**

Create or add to `web_api/tests/test_modules_route.py`. Check existing test patterns first — if tests use `httpx.AsyncClient` with the FastAPI app, follow that pattern. If no existing test file, create one:

```python
# web_api/tests/test_modules_route.py
import pytest
from unittest.mock import patch, AsyncMock
from uuid import UUID
from core.modules.flattened_types import FlattenedModule


@pytest.fixture
def mock_lens_module():
    """A standalone lens wrapped as a FlattenedModule."""
    return FlattenedModule(
        slug="lens/four-background-claims",
        title="Four Background Claims",
        content_id=UUID("c3d4e5f6-a7b8-9012-cdef-345678901234"),
        sections=[{
            "type": "lens-article",
            "meta": {"title": "Four Background Claims", "author": "Nate Soares"},
            "segments": [{"type": "text", "content": "Test content"}],
            "optional": False,
            "contentId": "c3d4e5f6-a7b8-9012-cdef-345678901234",
            "learningOutcomeId": None,
            "learningOutcomeName": None,
            "videoId": None,
        }],
    )


class TestGetModuleWithSlash:
    """Test that /api/modules/lens/slug works for both module and progress endpoints."""

    @pytest.mark.asyncio
    async def test_get_lens_module_by_slash_slug(self, mock_lens_module):
        """GET /api/modules/lens/foo should pass 'lens/foo' to load_flattened_module."""
        with patch("web_api.routes.modules.load_flattened_module") as mock_load:
            mock_load.return_value = mock_lens_module
            from main import app
            from httpx import AsyncClient, ASGITransport
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.get("/api/modules/lens/four-background-claims")
            assert resp.status_code == 200
            data = resp.json()
            assert data["slug"] == "lens/four-background-claims"
            assert data["title"] == "Four Background Claims"
            mock_load.assert_called_once_with("lens/four-background-claims")

    @pytest.mark.asyncio
    async def test_progress_route_not_swallowed_by_path_param(self, mock_lens_module):
        """GET /api/modules/lens/foo/progress must route to progress handler, not module handler.

        This verifies that {module_slug:path} doesn't greedily consume '/progress'.
        The progress handler will fail auth (no token), but a 401 proves it reached
        the right handler — a 404 would mean the path param ate '/progress'.
        """
        with patch("web_api.routes.modules.load_flattened_module") as mock_load:
            mock_load.return_value = mock_lens_module
            from main import app
            from httpx import AsyncClient, ASGITransport
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.get("/api/modules/lens/four-background-claims/progress")
            # 401 = reached progress handler (no auth token) — correct!
            # 404 or 200 with module data = wrong handler — routing bug!
            assert resp.status_code == 401
```

> **Note for implementer:** Check existing test patterns in `web_api/tests/` before writing. Adapt the test client setup to match.

**Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest web_api/tests/test_modules_route.py -v`
Expected: FAIL — 404 because FastAPI treats `lens/four-background-claims` as two path segments

**Step 3: Write implementation**

In `web_api/routes/modules.py`, apply three changes:

**Change 1: Reorder routes — progress BEFORE catch-all.** This is critical. `{module_slug:path}` is greedy; the more-specific `/progress` suffix route must come first.

**Change 2: Use `{module_slug:path}` on both routes.**

**Change 3: Add type filter to list endpoint.**

```python
# The list endpoint stays first (no path param, no conflict)
@router.get("/modules")
async def list_modules(type: str | None = None):
    """List available modules.

    Query params:
        type: Filter — 'module' (no lens/ prefix), 'lens' (lens/ prefix), or None (all)
    """
    module_slugs = get_available_modules()
    modules = []
    for slug in module_slugs:
        is_lens = slug.startswith("lens/")
        if type == "module" and is_lens:
            continue
        if type == "lens" and not is_lens:
            continue
        try:
            module = load_flattened_module(slug)
            modules.append({"slug": module.slug, "title": module.title, "type": "lens" if is_lens else "module"})
        except ModuleNotFoundError:
            pass
    return {"modules": modules}


# CRITICAL: Progress route MUST be defined BEFORE the catch-all module route.
# {module_slug:path} is greedy — without this ordering, /lens/foo/progress
# would be consumed as module_slug="lens/foo/progress" by the catch-all.
@router.get("/modules/{module_slug:path}/progress")
async def get_module_progress_endpoint(
    module_slug: str,
    request: Request,
    x_anonymous_token: str | None = Header(None),
):
    # ... (body unchanged)


@router.get("/modules/{module_slug:path}")
async def get_module(module_slug: str):
    # ... (body unchanged)
```

**Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest web_api/tests/test_modules_route.py -v`
Expected: PASS — both the module fetch and progress routing tests pass

Also run existing tests to check for regressions:
Run: `.venv/bin/pytest web_api/tests/ -v`
Expected: ALL PASS

**Step 5: Commit**

```
feat(api): support slash in module slug for standalone lens routes

Route order is critical: progress route defined before catch-all
so {module_slug:path} doesn't greedily consume '/progress'.
```

---

### Post-Task 4 audit: callers of `get_available_modules()`

The following callers will now also see `lens/`-prefixed entries:

- `web_api/routes/facilitator.py:252` — fallback module list for facilitator dashboard. Could show standalone lenses in the facilitator view. **Low risk** — this codepath only runs when `load_course("default")` fails, which shouldn't happen in production. But if it does, lens entries would appear alongside modules. Consider filtering with `slug.startswith("lens/")` if this becomes an issue.
- `web_api/routes/facilitator.py:389` — builds a `content_id → module` lookup for chat sessions. Lens entries here are **harmless** — they just add more content_id mappings, which is correct behavior (facilitators should see chat sessions from standalone lenses too).
- `core/modules/loader.py:35` — the source function itself. No filtering needed here.

**Action:** No changes needed for v1. Monitor facilitator dashboard after deployment. If lens entries appear in the facilitator module list, add a filter.

---

## Task 5: Frontend — `/lens/@lensId` route

**Files:**
- Create: `web_frontend/src/pages/lens/@lensId/+Page.tsx`

**Step 1: No unit test needed** — this is a 5-line routing glue file. Verified by manual testing (Task 8).

**Step 2: Write implementation**

```tsx
// web_frontend/src/pages/lens/@lensId/+Page.tsx
import { usePageContext } from "vike-react/usePageContext";
import Module from "@/views/Module";

export default function StandaloneLensPage() {
  const pageContext = usePageContext();
  const lensId = pageContext.routeParams?.lensId ?? "";

  return <Module key={lensId} courseId="default" moduleId={`lens/${lensId}`} />;
}
```

**Step 3: Commit**

```
feat(frontend): add /lens/:lensId route for standalone lens pages
```

---

## Task 6: Frontend — hidden `/content` index page

**Files:**
- Create: `web_frontend/src/pages/content/+Page.tsx`

**Step 1: No unit test** — UI component verified manually (Task 8).

**Step 2: Write implementation**

```tsx
// web_frontend/src/pages/content/+Page.tsx
import { useState, useEffect } from "react";
import { API_URL } from "@/config";

interface ContentItem {
  slug: string;
  title: string;
  type: "module" | "lens";
}

export default function ContentIndexPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/modules`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.modules ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const modules = items.filter((i) => i.type === "module");
  const lenses = items.filter((i) => i.type === "lens");

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-stone-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-semibold text-stone-900 mb-8">Content</h1>

      <section className="mb-10">
        <h2 className="text-lg font-medium text-stone-700 mb-4">
          Modules ({modules.length})
        </h2>
        <ul className="space-y-2">
          {modules.map((m) => (
            <li key={m.slug}>
              <a
                href={`/module/${m.slug}`}
                className="text-blue-700 hover:underline"
              >
                {m.title}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-medium text-stone-700 mb-4">
          Lenses ({lenses.length})
        </h2>
        <ul className="space-y-2">
          {lenses.map((l) => (
            <li key={l.slug}>
              <a
                href={`/${l.slug}`}
                className="text-blue-700 hover:underline"
              >
                {l.title}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

**Step 3: Commit**

```
feat(frontend): add hidden /content index page listing modules and lenses
```

---

## Task 7: Module.tsx — single-section UX polish (optional, can defer)

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`
- Modify: `web_frontend/src/components/ModuleHeader.tsx`

This task hides the progress bar for single-section modules (all standalone lenses) since a 1-of-1 progress indicator looks awkward.

**Step 1: No unit test** — visual change, verified manually.

**Step 2: Write implementation**

In `web_frontend/src/components/ModuleHeader.tsx`, hide the stage progress bar and prev/next arrows when there's only 1 stage:

```tsx
// In ModuleHeader, around the StageProgressBar render:
{stages.length > 1 && (
  <StageProgressBar ... />
)}
```

And hide the `N / M` counter and chevrons:

```tsx
{stages.length > 1 && (
  <>
    <button onClick={onPrevious} disabled={!canGoPrevious}>
      <ChevronLeft ... />
    </button>
    <span>{displayIndex} / {totalStages}</span>
    <button onClick={onNext} disabled={!canGoNext}>
      <ChevronRight ... />
    </button>
  </>
)}
```

**Step 3: Commit**

```
fix(frontend): hide progress bar for single-section modules
```

---

## Task 8: End-to-end verification

**Step 1: Run all content processor tests**

```bash
cd content_processor && npx vitest run
```

Expected: ALL PASS

**Step 2: Run all Python tests**

```bash
.venv/bin/pytest
```

Expected: ALL PASS

**Step 3: Run linting**

```bash
cd web_frontend && npm run lint
cd .. && ruff check . && ruff format --check .
```

Expected: Clean

**Step 4: Build frontend**

```bash
cd web_frontend && npm run build
```

Expected: Build succeeds

**Step 5: Manual testing with dev server**

1. Start backend: `python main.py --dev`
2. Start frontend: `cd web_frontend && npm run dev`
3. Visit `http://dev.vps:3100/content` — verify index page shows modules and lenses
4. Click a lens link — verify it loads at `/lens/<slug>`
5. Verify the lens content renders (text, article excerpts, video embeds)
6. Verify progress tracking works (mark complete button)
7. Verify single-section header looks clean (no "1 / 1" counter)

**Step 6: Final commit if any fixes needed**

---

## Summary

| Task | What | Files | TDD? |
|------|------|-------|------|
| 1 | `fileNameToSlug()` utility | `content_processor/src/utils/slug.{ts,test.ts}` | Yes |
| 2 | `flattenLens()` function | `content_processor/src/flattener/index.{ts,test.ts}` | Yes |
| 3 | Integrate into `processContent()` | `content_processor/src/index.ts`, `validator/standalone.test.ts` | Yes |
| 4 | Backend slash-slug support | `web_api/routes/modules.py`, `web_api/tests/` | Yes |
| 5 | Frontend `/lens/` route | `web_frontend/src/pages/lens/@lensId/+Page.tsx` | Manual |
| 6 | Frontend `/content` index | `web_frontend/src/pages/content/+Page.tsx` | Manual |
| 7 | Single-section UX polish | `ModuleHeader.tsx` | Manual |
| 8 | End-to-end verification | — | Integration |
