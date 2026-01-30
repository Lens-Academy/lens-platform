# URL Hash Navigation for Section Deep-Linking

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable URL-based navigation so users can share/bookmark direct links to specific sections (e.g., `/module/intro-to-ai#worst-case-thinking-optional`)

**Architecture:** Add hash read/write logic to Module.tsx. On mount, parse hash and jump to matching section. On section change, update hash via `history.replaceState()`. Use existing `generateHeadingId()` utility to create slugs from section titles. Update document title to reflect current section.

**Tech Stack:** React 19, Vike routing, browser History API, existing `generateHeadingId()` utility

---

## Task 1: Create Section Slug Utility

**Files:**
- Create: `web_frontend/src/utils/sectionSlug.ts`
- Test: `web_frontend/src/utils/sectionSlug.test.ts`

**Step 1: Write the failing test**

Create the test file:

```typescript
// web_frontend/src/utils/sectionSlug.test.ts
import { describe, it, expect } from "vitest";
import { getSectionSlug } from "./sectionSlug";
import type { ModuleSection } from "@/types/module";

describe("getSectionSlug", () => {
  it("returns slug from lens-article title", () => {
    const section: ModuleSection = {
      type: "lens-article",
      contentId: "abc",
      learningOutcomeId: null,
      meta: { title: "Worst-Case Thinking (Optional)", author: null, sourceUrl: null },
      segments: [],
      optional: true,
    };
    expect(getSectionSlug(section, 0)).toBe("worst-case-thinking-optional");
  });

  it("returns slug from lens-video title", () => {
    const section: ModuleSection = {
      type: "lens-video",
      contentId: "def",
      learningOutcomeId: null,
      videoId: "xyz",
      meta: { title: "Introduction to AI Safety", channel: null },
      segments: [],
      optional: false,
    };
    expect(getSectionSlug(section, 1)).toBe("introduction-to-ai-safety");
  });

  it("returns slug from page title", () => {
    const section: ModuleSection = {
      type: "page",
      meta: { title: "Learning Outcomes" },
      segments: [],
    };
    expect(getSectionSlug(section, 2)).toBe("learning-outcomes");
  });

  it("returns fallback for page with null title", () => {
    const section: ModuleSection = {
      type: "page",
      meta: { title: null },
      segments: [],
    };
    expect(getSectionSlug(section, 3)).toBe("section-4");
  });

  it("returns fallback for text section", () => {
    const section: ModuleSection = {
      type: "text",
      content: "Some content here",
    };
    expect(getSectionSlug(section, 0)).toBe("section-1");
  });

  it("truncates long titles to 50 chars", () => {
    const section: ModuleSection = {
      type: "lens-article",
      contentId: "abc",
      learningOutcomeId: null,
      meta: {
        title: "This Is A Very Long Title That Should Be Truncated To Fifty Characters Maximum",
        author: null,
        sourceUrl: null
      },
      segments: [],
      optional: false,
    };
    const slug = getSectionSlug(section, 0);
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web_frontend && npm test -- --run src/utils/sectionSlug.test.ts`
Expected: FAIL with "Cannot find module './sectionSlug'"

**Step 3: Write minimal implementation**

Create the implementation file:

```typescript
// web_frontend/src/utils/sectionSlug.ts
import type { ModuleSection } from "@/types/module";
import { generateHeadingId } from "./extractHeadings";

/**
 * Get a URL-safe slug for a module section.
 * Uses the section title if available, falls back to "section-N".
 */
export function getSectionSlug(section: ModuleSection, index: number): string {
  let title: string | null = null;

  switch (section.type) {
    case "lens-article":
    case "lens-video":
      title = section.meta.title;
      break;
    case "page":
      title = section.meta.title;
      break;
    case "article":
    case "video":
      title = section.meta?.title ?? null;
      break;
    case "chat":
      title = section.meta?.title ?? null;
      break;
    case "text":
      // Text sections don't have titles
      title = null;
      break;
  }

  if (title) {
    return generateHeadingId(title);
  }

  // Fallback: section-1, section-2, etc. (1-indexed for human readability)
  return `section-${index + 1}`;
}

/**
 * Find section index by slug.
 * Returns -1 if not found.
 */
export function findSectionBySlug(
  sections: ModuleSection[],
  slug: string
): number {
  return sections.findIndex(
    (section, index) => getSectionSlug(section, index) === slug
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd web_frontend && npm test -- --run src/utils/sectionSlug.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd web_frontend && git add src/utils/sectionSlug.ts src/utils/sectionSlug.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add section slug utility for URL hashing

Converts section titles to URL-safe slugs using existing generateHeadingId.
Falls back to section-N for sections without titles.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add findSectionBySlug Tests

**Files:**
- Modify: `web_frontend/src/utils/sectionSlug.test.ts`

**Step 1: Add tests for findSectionBySlug**

Append to existing test file:

```typescript
describe("findSectionBySlug", () => {
  const sections: ModuleSection[] = [
    {
      type: "page",
      meta: { title: "Learning Outcomes" },
      segments: [],
    },
    {
      type: "lens-article",
      contentId: "abc",
      learningOutcomeId: null,
      meta: { title: "Worst-Case Thinking (Optional)", author: null, sourceUrl: null },
      segments: [],
      optional: true,
    },
    {
      type: "lens-video",
      contentId: "def",
      learningOutcomeId: null,
      videoId: "xyz",
      meta: { title: "Introduction Video", channel: null },
      segments: [],
      optional: false,
    },
  ];

  it("finds section by slug", () => {
    expect(findSectionBySlug(sections, "worst-case-thinking-optional")).toBe(1);
  });

  it("finds first section", () => {
    expect(findSectionBySlug(sections, "learning-outcomes")).toBe(0);
  });

  it("returns -1 for non-existent slug", () => {
    expect(findSectionBySlug(sections, "does-not-exist")).toBe(-1);
  });

  it("returns -1 for empty slug", () => {
    expect(findSectionBySlug(sections, "")).toBe(-1);
  });
});
```

Also add import at top:
```typescript
import { getSectionSlug, findSectionBySlug } from "./sectionSlug";
```

**Step 2: Run tests to verify they pass**

Run: `cd web_frontend && npm test -- --run src/utils/sectionSlug.test.ts`
Expected: PASS (implementation already exists from Task 1)

**Step 3: Commit**

```bash
cd web_frontend && git add src/utils/sectionSlug.test.ts
git commit -m "$(cat <<'EOF'
test(frontend): add findSectionBySlug tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Hash Reading on Mount

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:200-210` (near currentSectionIndex state)

**Step 1: Import the new utility**

Add import at top of Module.tsx (around line 17):

```typescript
import { getSectionSlug, findSectionBySlug } from "@/utils/sectionSlug";
```

**Step 2: Add hash parsing effect**

Add this effect after the `useEffect` that fetches module data (around line 140, after the `load()` effect):

```typescript
// Parse URL hash on mount and when module loads
useEffect(() => {
  if (!module) return;

  const hash = window.location.hash.slice(1); // Remove leading #
  if (!hash) return;

  const sectionIndex = findSectionBySlug(module.sections, hash);
  if (sectionIndex !== -1) {
    // Valid hash found - navigate to that section
    setCurrentSectionIndex(sectionIndex);
  } else {
    // Invalid hash - strip it from URL
    window.history.replaceState(null, "", window.location.pathname);
  }
}, [module]);
```

**Step 3: Test manually**

1. Start dev server: `cd web_frontend && npm run dev`
2. Navigate to a module with sections
3. Add hash to URL: `#worst-case-thinking-optional` (use actual section title slug)
4. Refresh page - should jump to that section
5. Test invalid hash: `#invalid-section-name`
6. Refresh - should strip hash and show first section

**Step 4: Commit**

```bash
cd web_frontend && git add src/views/Module.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): read URL hash on mount to jump to section

Parses hash on page load, finds matching section, navigates to it.
Strips invalid hashes from URL silently.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update Hash on Section Change

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add effect to update URL hash when section changes**

Add this effect after the hash reading effect (around line 155):

```typescript
// Update URL hash when section changes
useEffect(() => {
  if (!module) return;

  const currentSection = module.sections[currentSectionIndex];
  if (!currentSection) return;

  const slug = getSectionSlug(currentSection, currentSectionIndex);
  const newHash = `#${slug}`;

  // Only update if hash is different (avoid unnecessary history entries)
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, "", `${window.location.pathname}${newHash}`);
  }
}, [module, currentSectionIndex]);
```

**Step 2: Test manually**

1. Navigate to a module
2. Click through sections using navigation
3. Observe URL hash updating in browser address bar
4. Copy URL, open in new tab - should land on same section

**Step 3: Commit**

```bash
cd web_frontend && git add src/views/Module.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): update URL hash when navigating sections

Uses history.replaceState to update hash without creating history entries.
Enables sharing URLs that link directly to specific sections.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update Document Title

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add effect to update document title**

Add this effect after the hash update effect:

```typescript
// Update document title to show current section
useEffect(() => {
  if (!module) return;

  const currentSection = module.sections[currentSectionIndex];
  if (!currentSection) return;

  // Get section title
  let sectionTitle: string | null = null;
  switch (currentSection.type) {
    case "lens-article":
    case "lens-video":
      sectionTitle = currentSection.meta.title;
      break;
    case "page":
      sectionTitle = currentSection.meta.title;
      break;
    case "article":
    case "video":
    case "chat":
      sectionTitle = currentSection.meta?.title ?? null;
      break;
  }

  if (sectionTitle) {
    document.title = `${sectionTitle} | ${module.title}`;
  } else {
    document.title = module.title;
  }

  // Cleanup: restore module title when unmounting
  return () => {
    if (module) {
      document.title = module.title;
    }
  };
}, [module, currentSectionIndex]);
```

**Step 2: Test manually**

1. Navigate to a module
2. Check browser tab title shows section name
3. Navigate between sections - title should update
4. Navigate away from module - title should reset

**Step 3: Commit**

```bash
cd web_frontend && git add src/views/Module.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): update document title with current section

Shows "Section Title | Module Title" in browser tab.
Helps with bookmarking and browser history.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Handle Browser Back/Forward Navigation

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add popstate listener**

Modify the hash reading effect to also listen for popstate events:

```typescript
// Parse URL hash on mount, module load, and browser navigation
useEffect(() => {
  if (!module) return;

  const handleHashChange = () => {
    const hash = window.location.hash.slice(1); // Remove leading #
    if (!hash) {
      // No hash - go to first section
      setCurrentSectionIndex(0);
      return;
    }

    const sectionIndex = findSectionBySlug(module.sections, hash);
    if (sectionIndex !== -1) {
      setCurrentSectionIndex(sectionIndex);
    } else {
      // Invalid hash - strip it and go to first section
      window.history.replaceState(null, "", window.location.pathname);
      setCurrentSectionIndex(0);
    }
  };

  // Handle initial load
  handleHashChange();

  // Handle browser back/forward
  window.addEventListener("popstate", handleHashChange);

  return () => {
    window.removeEventListener("popstate", handleHashChange);
  };
}, [module]);
```

**Step 2: Change hash update to use pushState for navigation**

Update the hash update effect to use `pushState` instead of `replaceState` when user navigates via UI (so back button works):

We need to track whether the navigation is from user interaction vs. initial load. Add a ref:

```typescript
const isInitialLoad = useRef(true);
```

Then update the hash update effect:

```typescript
// Update URL hash when section changes
useEffect(() => {
  if (!module) return;

  const currentSection = module.sections[currentSectionIndex];
  if (!currentSection) return;

  const slug = getSectionSlug(currentSection, currentSectionIndex);
  const newHash = `#${slug}`;

  // Only update if hash is different
  if (window.location.hash !== newHash) {
    if (isInitialLoad.current) {
      // Initial load or hash navigation - use replaceState
      window.history.replaceState(null, "", `${window.location.pathname}${newHash}`);
      isInitialLoad.current = false;
    } else {
      // User clicked navigation - use pushState for back button support
      window.history.pushState(null, "", `${window.location.pathname}${newHash}`);
    }
  }
}, [module, currentSectionIndex]);
```

**Step 3: Test manually**

1. Navigate to module, click through several sections
2. Click browser back button - should go to previous section
3. Click browser forward button - should go to next section
4. Refresh page - should stay on current section

**Step 4: Commit**

```bash
cd web_frontend && git add src/views/Module.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): support browser back/forward for section navigation

Listens to popstate events to handle browser navigation.
Uses pushState for user navigation so back button works.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add Integration Test

**Files:**
- Create: `web_frontend/src/views/Module.hash.test.tsx`

**Step 1: Write integration test**

```typescript
// web_frontend/src/views/Module.hash.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { getSectionSlug, findSectionBySlug } from "@/utils/sectionSlug";
import type { ModuleSection } from "@/types/module";

// Test the slug utilities with real section data patterns
describe("URL Hash Navigation Integration", () => {
  const mockSections: ModuleSection[] = [
    {
      type: "page",
      meta: { title: "Learning Outcomes" },
      segments: [],
    },
    {
      type: "lens-article",
      contentId: "abc",
      learningOutcomeId: null,
      meta: { title: "Worst-Case Thinking (Optional)", author: "Nick Bostrom", sourceUrl: null },
      segments: [],
      optional: true,
    },
    {
      type: "lens-video",
      contentId: "def",
      learningOutcomeId: null,
      videoId: "xyz123",
      meta: { title: "AI Alignment Introduction", channel: "AI Safety" },
      segments: [],
      optional: false,
    },
    {
      type: "text",
      content: "Some standalone text content",
    },
  ];

  describe("slug generation consistency", () => {
    it("generates consistent slugs for all section types", () => {
      const slugs = mockSections.map((section, index) =>
        getSectionSlug(section, index)
      );

      expect(slugs).toEqual([
        "learning-outcomes",
        "worst-case-thinking-optional",
        "ai-alignment-introduction",
        "section-4", // text section falls back to index
      ]);
    });

    it("round-trips: find by generated slug returns correct index", () => {
      mockSections.forEach((section, index) => {
        const slug = getSectionSlug(section, index);
        const foundIndex = findSectionBySlug(mockSections, slug);
        expect(foundIndex).toBe(index);
      });
    });
  });

  describe("hash format", () => {
    it("generates URL-safe slugs with no special characters", () => {
      const section: ModuleSection = {
        type: "lens-article",
        contentId: "abc",
        learningOutcomeId: null,
        meta: { title: "What's the Deal? (A Question!)", author: null, sourceUrl: null },
        segments: [],
        optional: false,
      };

      const slug = getSectionSlug(section, 0);
      expect(slug).toBe("whats-the-deal-a-question");
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    });
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd web_frontend && npm test -- --run src/views/Module.hash.test.tsx`
Expected: PASS

**Step 3: Commit**

```bash
cd web_frontend && git add src/views/Module.hash.test.tsx
git commit -m "$(cat <<'EOF'
test(frontend): add integration tests for URL hash navigation

Tests slug generation consistency across section types.
Verifies round-trip: generate slug -> find by slug -> same index.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final Verification and Cleanup

**Files:**
- None (verification only)

**Step 1: Run all tests**

Run: `cd web_frontend && npm test`
Expected: All tests pass

**Step 2: Run linter**

Run: `cd web_frontend && npm run lint`
Expected: No errors

**Step 3: Run build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds

**Step 4: Manual E2E verification**

1. Start dev server: `npm run dev`
2. Navigate to a module with multiple sections
3. Verify:
   - [ ] URL hash updates when clicking through sections
   - [ ] Page title updates in browser tab
   - [ ] Direct link with hash loads correct section
   - [ ] Invalid hash is stripped, page loads normally
   - [ ] Browser back/forward works
   - [ ] Sharing URL works (open in incognito)

**Step 5: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(frontend): URL hash navigation for section deep-linking

Users can now share/bookmark URLs to specific module sections.
- Hash generated from section title (e.g., #worst-case-thinking-optional)
- Page title shows current section
- Browser back/forward navigation supported
- Invalid hashes stripped gracefully

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create section slug utility | `sectionSlug.ts`, `sectionSlug.test.ts` |
| 2 | Add findSectionBySlug tests | `sectionSlug.test.ts` |
| 3 | Hash reading on mount | `Module.tsx` |
| 4 | Hash update on section change | `Module.tsx` |
| 5 | Document title update | `Module.tsx` |
| 6 | Browser back/forward support | `Module.tsx` |
| 7 | Integration tests | `Module.hash.test.tsx` |
| 8 | Final verification | (manual testing) |

Total: ~150 lines of new code across 3 new/modified files.
