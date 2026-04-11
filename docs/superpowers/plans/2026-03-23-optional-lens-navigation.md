# Optional Lens Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable course authors to link between lenses/modules using wikilinks (inline and card styles) and let students complete optional lenses without chatting.

**Architecture:** Content processor resolves wikilinks in text segments into markdown links (custom `lens:`/`module:` schemes) and `::card` links into self-contained HTML blocks. Frontend renders these via ReactMarkdown component overrides. Completion gate is relaxed for optional lenses.

**Tech Stack:** TypeScript (content processor, vitest), React 19 + ReactMarkdown + Tailwind v4 (frontend)

**Spec:** `docs/superpowers/specs/2026-03-23-optional-lens-navigation-design.md`

---

## File Map

### Content Processor (Phase 1 + 2)
- **Create:** `content_processor/src/flattener/resolve-text-links.ts` — resolves wikilinks and `::card` links in text segment content strings
- **Create:** `content_processor/src/flattener/resolve-text-links.test.ts` — tests for the above
- **Modify:** `content_processor/src/flattener/index.ts:966-976` — call the resolver on text segments during `convertSegment()`
- **Modify:** `content_processor/src/validator/directives.ts:5-9` — add `card` to prevent false validation errors

### Frontend (Phase 1)
- **Modify:** `web_frontend/src/components/module/AuthoredText.tsx` — add `courseId`, `moduleSlug` props, custom `a` handler for `lens:`/`module:` schemes
- **Create:** `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx` — tests for link rendering
- **Modify:** `web_frontend/src/views/Module.tsx:1476` — pass courseId, moduleSlug to AuthoredText
- **Modify:** `web_frontend/src/views/Module.tsx:2058-2063` — skip chat gate for optional sections

### Frontend (Phase 2)
- **Create:** `web_frontend/src/components/module/LensCard.tsx` — rich card component
- **Create:** `web_frontend/src/components/module/LensCard.test.tsx` — tests for the card
- **Modify:** `web_frontend/src/components/module/AuthoredText.tsx` — add `completedContentIds` prop, custom `div` handler for `data-lens-card`
- **Modify:** `web_frontend/src/views/Module.tsx` — derive and pass `completedContentIds`

---

## Phase 1: Inline Wikilinks + Mark-as-Read

### Task 1: Resolve inline wikilinks in text segments (content processor)

**Files:**
- Create: `content_processor/src/flattener/resolve-text-links.ts`
- Create: `content_processor/src/flattener/resolve-text-links.test.ts`

- [ ] **Step 1: Write failing tests for inline wikilink resolution**

Create `content_processor/src/flattener/resolve-text-links.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTextLinks } from './resolve-text-links.js';

describe('resolveTextLinks', () => {
  // Minimal files map for test fixtures
  const files = new Map<string, string>([
    ['Lenses/My Lens.md', '---\nid: aaaa-bbbb\ntitle: "My Lens Title"\ntldr: "A short summary"\n---\n#### Text\ncontent:: hello'],
    ['modules/My Module.md', '---\nslug: my-module\ntitle: "My Module Title"\n---\n# Lens: Welcome'],
  ]);

  it('resolves [[lens]] to markdown link with lens: scheme', () => {
    const content = 'See [[../Lenses/My Lens]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe('See [My Lens Title](lens:aaaa-bbbb)');
    expect(result.errors).toHaveLength(0);
  });

  it('resolves [[lens|display]] with pipe alias', () => {
    const content = 'Check [[../Lenses/My Lens|this lens]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe('Check [this lens](lens:aaaa-bbbb)');
  });

  it('resolves [[module]] to module: scheme', () => {
    const content = 'See [[../modules/My Module]]';
    const result = resolveTextLinks(content, 'Lenses/test.md', files);
    expect(result.content).toBe('See [My Module Title](module:my-module)');
  });

  it('resolves [[module|display]] with pipe alias', () => {
    const content = 'Read [[../modules/My Module|Module 1]]';
    const result = resolveTextLinks(content, 'Lenses/test.md', files);
    expect(result.content).toBe('Read [Module 1](module:my-module)');
  });

  it('returns error for unresolved wikilink', () => {
    const content = 'See [[../Lenses/Nonexistent]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('not found');
    // Unresolved links pass through as plain text
    expect(result.content).toBe('See [[../Lenses/Nonexistent]]');
  });

  it('handles multiple wikilinks in one string', () => {
    const content = 'See [[../Lenses/My Lens]] and [[../modules/My Module]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe('See [My Lens Title](lens:aaaa-bbbb) and [My Module Title](module:my-module)');
  });

  it('leaves content without wikilinks unchanged', () => {
    const content = 'No links here, just **bold** text.';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe(content);
  });

  it('uses filename as fallback display text when title is missing', () => {
    const filesNoTitle = new Map<string, string>([
      ['Lenses/Untitled.md', '---\nid: cccc-dddd\n---\n#### Text\ncontent:: hello'],
    ]);
    const content = 'See [[../Lenses/Untitled]]';
    const result = resolveTextLinks(content, 'modules/test.md', filesNoTitle);
    expect(result.content).toBe('See [Untitled](lens:cccc-dddd)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolveTextLinks**

Create `content_processor/src/flattener/resolve-text-links.ts`:

```typescript
import type { ContentError } from '../index.js';
import { parseWikilink, resolveWikilinkPath, findFileWithExtension } from '../parser/wikilink.js';
import { parseFrontmatter } from '../parser/frontmatter.js';

// Matches [[path]], [[path|display]], but NOT ![[embeds]]
const INLINE_WIKILINK_RE = /(?<!!)(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g;

export interface ResolveResult {
  content: string;
  errors: ContentError[];
}

/**
 * Resolve wikilinks in text segment content to markdown links.
 * - [[../Lenses/Foo]] → [Title](lens:contentId)
 * - [[../Lenses/Foo|display]] → [display](lens:contentId)
 * - [[../modules/Bar]] → [Title](module:slug)
 */
export function resolveTextLinks(
  content: string,
  sourcePath: string,
  files: Map<string, string>,
): ResolveResult {
  const errors: ContentError[] = [];

  const resolved = content.replace(INLINE_WIKILINK_RE, (fullMatch, _outer, rawPath, pipeDisplay) => {
    const path = rawPath.trim();

    // Resolve relative path
    const resolvedPath = resolveWikilinkPath(path, sourcePath);
    const filePath = findFileWithExtension(resolvedPath, files);

    if (!filePath) {
      errors.push({
        file: sourcePath,
        line: 0,
        message: `Wikilink target not found: ${path}`,
        severity: 'warning',
      });
      return fullMatch; // Leave unresolved links as-is
    }

    const fileContent = files.get(filePath)!;
    const frontmatter = parseFrontmatter(fileContent, filePath);

    // Determine if this is a lens or module
    const isModule = filePath.toLowerCase().includes('modules/');
    const isLens = filePath.toLowerCase().includes('lenses/');

    if (isModule) {
      const slug = frontmatter.data?.slug || fileNameToSlug(filePath);
      const title = frontmatter.data?.title || fileNameToTitle(filePath);
      const display = pipeDisplay?.trim() || title;
      return `[${display}](module:${slug})`;
    }

    if (isLens) {
      const contentId = frontmatter.data?.id;
      if (!contentId) {
        errors.push({
          file: sourcePath,
          line: 0,
          message: `Lens has no id in frontmatter: ${path}`,
          severity: 'warning',
        });
        return fullMatch;
      }
      const title = frontmatter.data?.title || fileNameToTitle(filePath);
      const display = pipeDisplay?.trim() || title;
      return `[${display}](lens:${contentId})`;
    }

    // Unknown target type — leave as-is
    return fullMatch;
  });

  return { content: resolved, errors };
}

/** Extract a display name from a file path: "Lenses/My Lens.md" → "My Lens" */
function fileNameToTitle(filePath: string): string {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}

/** Convert filename to slug: "My Module.md" → "my-module" */
function fileNameToSlug(filePath: string): string {
  return fileNameToTitle(filePath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj describe -m "feat(content-processor): add resolveTextLinks for inline wikilinks in text segments"
jj new
```

---

### Task 2: Wire resolveTextLinks into the flattener

**Files:**
- Modify: `content_processor/src/flattener/index.ts:966-976`
- Modify: `content_processor/src/flattener/index.test.ts`

- [ ] **Step 1: Write a flattener integration test**

Add to `content_processor/src/flattener/index.test.ts` (find the existing text segment test section):

```typescript
it('resolves wikilinks in text segment content', () => {
  const files = new Map<string, string>([
    ['modules/test-module.md', `---
slug: test-module
title: "Test Module"
---
# Lens: Welcome
id:: welcome-id

#### Text
content:: See [[../Lenses/Target Lens]] for more.
`],
    ['Lenses/Target Lens.md', `---
id: target-lens-id
title: "Target Lens Title"
---
#### Text
content:: hello
`],
  ]);

  const result = flattenModule('modules/test-module.md', files);
  const textSeg = result.module!.sections[0].segments[0];
  expect(textSeg.type).toBe('text');
  expect((textSeg as any).content).toBe('See [Target Lens Title](lens:target-lens-id) for more.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd content_processor && npx vitest run src/flattener/index.test.ts -t "resolves wikilinks"`
Expected: FAIL — content still contains raw `[[...]]`

- [ ] **Step 3: Wire resolveTextLinks into convertSegment**

In `content_processor/src/flattener/index.ts`, add import at top:

```typescript
import { resolveTextLinks } from './resolve-text-links.js';
```

Modify the `case 'text'` block (around line 966-976):

```typescript
    case 'text': {
      const resolved = resolveTextLinks(parsedSegment.content, lensPath, files);
      errors.push(...resolved.errors);
      const segment: TextSegment = {
        type: 'text',
        content: resolved.content,
      };
      if (parsedSegment.optional) {
        segment.optional = true;
      }
      return { segment, errors };
    }
```

Note: `lensPath` is the path of the lens file being processed. Check the function signature of `convertSegment` — it receives the lens path. If the parameter is named differently, use that name.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run src/flattener/index.test.ts`
Expected: All tests PASS (including the new one)

- [ ] **Step 5: Run full content processor test suite**

Run: `cd content_processor && npx vitest run`
Expected: All tests PASS — no regressions

- [ ] **Step 6: Commit**

```
jj describe -m "feat(content-processor): wire wikilink resolution into text segment flattening"
jj new
```

---

### Task 3: Frontend — inline link rendering in AuthoredText

**Files:**
- Modify: `web_frontend/src/components/module/AuthoredText.tsx`
- Create: `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx`

- [ ] **Step 1: Write failing test for lens: scheme link rendering**

Create `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthoredText from "./AuthoredText";

describe("AuthoredText lens links", () => {
  it("renders lens: scheme as a same-module hash link", () => {
    render(
      <AuthoredText
        content="See [My Lens](lens:aaaa-bbbb)"
        courseId="my-course"
        moduleSlug="my-module"
        moduleSections={[
          { contentId: "aaaa-bbbb", meta: { title: "My Lens" } },
        ]}
      />,
    );
    const link = screen.getByText("My Lens");
    expect(link.tagName).toBe("A");
    // Same-module lens → hash link
    expect(link.getAttribute("href")).toMatch(/#/);
  });

  it("renders module: scheme as a course module link", () => {
    render(
      <AuthoredText
        content="See [Module 2](module:my-module-2)"
        courseId="my-course"
      />,
    );
    const link = screen.getByText("Module 2");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/course/my-course/module/my-module-2");
  });

  it("renders regular links unchanged", () => {
    render(
      <AuthoredText
        content="Visit [example](https://example.com)"
      />,
    );
    const link = screen.getByText("example");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx`
Expected: FAIL — AuthoredText doesn't accept `courseId`/`moduleSlug` props, so `lens:` and `module:` hrefs pass through to the default `<a>` handler unchanged (rendered as external links with `target="_blank"`, wrong href)

- [ ] **Step 3: Add props and custom `a` handler to AuthoredText**

Modify `web_frontend/src/components/module/AuthoredText.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useCallback } from "react";
import type { LensSection, ModuleSection } from "@/types/module";

type AuthoredTextProps = {
  content: string;
  courseId?: string;
  moduleSlug?: string;
  moduleSections?: Array<{ contentId: string | null; meta: { title?: string | null } }>;
  completedContentIds?: Set<string>;
};

/**
 * Resolve a lens:contentId href to a navigation URL.
 * Same-module: hash to section slug. Cross-module: full URL (deferred — falls back to hash).
 */
function resolveLensHref(
  contentId: string,
  courseId?: string,
  moduleSlug?: string,
  moduleSections?: Array<{ contentId: string | null; meta: { title?: string | null } }>,
): string {
  // Find section index in current module
  if (moduleSections) {
    const index = moduleSections.findIndex((s) => s.contentId === contentId);
    if (index !== -1) {
      const title = moduleSections[index].meta?.title || `Section ${index + 1}`;
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return `#${slug}`;
    }
  }
  // Cross-module or unknown — link to content ID for now
  // TODO: Phase 3 will resolve cross-module links with moduleSlug lookup
  return `#lens-${contentId}`;
}

export default function AuthoredText({
  content,
  courseId,
  moduleSlug,
  moduleSections,
  completedContentIds,
}: AuthoredTextProps) {
  const renderLink = useCallback(
    ({ children, href }: { children?: React.ReactNode; href?: string }) => {
      if (!href) {
        return <a>{children}</a>;
      }

      // lens:contentId → same-module hash or cross-module URL
      if (href.startsWith("lens:")) {
        const contentId = href.slice(5);
        const resolved = resolveLensHref(contentId, courseId, moduleSlug, moduleSections);
        return (
          <a
            href={resolved}
            className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
          >
            {children}
          </a>
        );
      }

      // module:slug → /course/:courseId/module/:slug
      if (href.startsWith("module:")) {
        const slug = href.slice(7);
        const url = courseId
          ? `/course/${courseId}/module/${slug}`
          : `/module/${slug}`;
        return (
          <a
            href={url}
            className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
          >
            {children}
          </a>
        );
      }

      // External link — existing behavior
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
        >
          {children}
        </a>
      );
    },
    [courseId, moduleSlug, moduleSections],
  );

  return (
    <div className="py-6 px-4">
      <article className="prose prose-gray max-w-content mx-auto text-gray-800 [&>:last-child]:mb-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: renderLink,
            h2: ({ children }) => (
              <h2 className="text-xl font-bold mt-6 mb-3 font-display">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-lg font-bold mt-5 mb-2 font-display">{children}</h3>
            ),
            p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
            ul: ({ children }) => (
              <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
            ),
            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            blockquote: ({ children }) => (
              <blockquote
                className="not-prose border-l-3 pl-4 my-4 text-gray-800 [&>p]:mb-0"
                style={{ borderColor: "var(--brand-border)" }}
              >
                {children}
              </blockquote>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj describe -m "feat(frontend): add lens: and module: link handling to AuthoredText"
jj new
```

---

### Task 4: Pass courseId and moduleSections to AuthoredText from Module.tsx

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:1476`

**TDD note:** This is a wiring task — connecting already-tested pieces. The behavior is tested by Task 3's tests (AuthoredText renders lens:/module: links correctly when given the props). If wiring is wrong, Task 3's tests would catch it during integration.

- [ ] **Step 1: Update AuthoredText call site in Module.tsx**

Find the line (around 1476) where AuthoredText is rendered:

```tsx
<AuthoredText key={`text-${keyPrefix}`} content={segment.content} />
```

Replace with:

```tsx
<AuthoredText
  key={`text-${keyPrefix}`}
  content={segment.content}
  courseId={courseId ?? undefined}
  moduleSlug={moduleId}
  moduleSections={module.sections.map((s) => ({
    contentId: s.contentId,
    meta: s.meta,
  }))}
/>
```

Note: Check how `courseId` and `moduleId` are named in the component. They come from the route params — look at the destructuring at the top of the Module component.

- [ ] **Step 2: Verify the build passes**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```
jj describe -m "feat(frontend): pass course/module context to AuthoredText for link resolution"
jj new
```

---

### Task 5: Skip chat gate for optional lenses

**Files:**
- Modify: `web_frontend/src/views/Module.tsx:2058-2063`
- Create: `web_frontend/src/views/__tests__/Module.chatgate.test.tsx`

- [ ] **Step 1: Write a failing test**

Create `web_frontend/src/views/__tests__/Module.chatgate.test.tsx`, following the same mock pattern as `Module.progress.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Module from "../Module";

// Same mocks as Module.progress.test.tsx
vi.mock("@/api/modules", () => ({
  getModule: vi.fn(),
  getModuleProgress: vi.fn(),
  getCourseProgress: vi.fn(),
  getChatHistory: vi.fn(),
  getNextModule: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/api/progress", () => ({
  markComplete: vi.fn(),
  sendHeartbeatPing: vi.fn(),
}));

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/useActivityTracker", () => ({
  useActivityTracker: () => ({ triggerActivity: vi.fn() }),
}));

vi.mock("@/analytics", () => ({
  trackModuleStarted: vi.fn(),
  trackModuleCompleted: vi.fn(),
  trackChatMessageSent: vi.fn(),
}));

import {
  getModule,
  getModuleProgress,
  getCourseProgress,
  getChatHistory,
} from "@/api/modules";

// Module with an optional lens that has a chat segment
const mockModuleWithOptionalChat = {
  slug: "test-module",
  title: "Test Module",
  content_id: "uuid-1",
  sections: [
    {
      type: "lens",
      contentId: "optional-lens-1",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "Optional Lens With Chat" },
      segments: [
        { type: "text", content: "x".repeat(2000) },
        { type: "chat", instructions: "Discuss this." },
      ],
      optional: true,
    },
  ],
};

const mockProgressNotStarted = {
  module: { id: "uuid-1", slug: "test-module", title: "Test Module" },
  status: "not_started" as const,
  progress: { completed: 0, total: 1 },
  lenses: [
    {
      id: "optional-lens-1",
      title: "Optional Lens With Chat",
      type: "lens",
      optional: true,
      completed: false,
      completedAt: null,
      timeSpentS: 0,
    },
  ],
  chatSession: { sessionId: 1, hasMessages: false },
};

describe("Module chat gate for optional lenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isInSignupsTable: false,
      isInActiveGroup: false,
      login: vi.fn(),
    });
    (getModule as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockModuleWithOptionalChat,
    );
    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockProgressNotStarted,
    );
    (getCourseProgress as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  it("enables Mark Complete button on optional lens even without chat interaction", async () => {
    render(<Module courseId="test-course" moduleId="test-module" />);

    await waitFor(() => {
      expect(getModule).toHaveBeenCalled();
    });

    // Find the Mark Complete button — it should NOT be disabled
    // (for a required lens with chat, it WOULD be disabled until chat interaction)
    const button = await screen.findByRole("button", {
      name: /mark section complete/i,
    });
    expect(button).not.toHaveAttribute("disabled");
    // Also check it doesn't have the disabled opacity style
    expect(button.className).not.toContain("opacity-50");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web_frontend && npx vitest run src/views/__tests__/Module.chatgate.test.tsx`
Expected: FAIL — button is disabled because the current code gates ALL sections with chat, not just required ones. The button should have `disabled` attribute or `opacity-50` class.

- [ ] **Step 3: Modify the chatGated computation**

At line 2058-2063 of Module.tsx, change:

```tsx
chatGated={
  ("segments" in section &&
    section.segments?.some((s) => s.type === "chat") &&
    !chatInteractedSections.has(sectionIndex)) ||
  false
}
```

To:

```tsx
chatGated={
  (!section.optional &&
    "segments" in section &&
    section.segments?.some((s) => s.type === "chat") &&
    !chatInteractedSections.has(sectionIndex)) ||
  false
}
```

Note: `section.optional` is a boolean on `LensSection` and `TestSection` types (verified at `module.ts:92` and `module.ts:109`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web_frontend && npx vitest run src/views/__tests__/Module.chatgate.test.tsx`
Expected: PASS — button is now enabled for optional lenses

- [ ] **Step 5: Run existing Module tests to check for regressions**

Run: `cd web_frontend && npx vitest run src/views/__tests__/`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```
jj describe -m "feat(frontend): skip chat gate for optional lenses — allow mark-as-read without chatting"
jj new
```

---

### Task 6: Add `card` to directive validator (prevent false errors)

**Files:**
- Modify: `content_processor/src/validator/directives.ts:5-9`
- Modify: `content_processor/src/validator/directives.test.ts`

- [ ] **Step 1: Write a failing test**

Add to `content_processor/src/validator/directives.test.ts`:

```typescript
it('does not flag ::card as unknown directive', () => {
  const body = '::card[[../Lenses/My Lens]]';
  const errors = validateDirectives(body, 'test.md', 1);
  const cardErrors = errors.filter(e => e.message.includes('card'));
  expect(cardErrors).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd content_processor && npx vitest run src/validator/directives.test.ts -t "card"`
Expected: FAIL — `::card` flagged as unknown directive

- [ ] **Step 3: Update the validator**

The simplest approach: `::card[[...]]` doesn't match the leaf directive regex `::name[content]` because the content starts with `[` not a normal character. Check if the validator actually flags it. If it does, add `card` to `SUPPORTED_DIRECTIVES`:

```typescript
const SUPPORTED_DIRECTIVES: Record<string, { container: boolean; leaf: boolean; text: boolean; open: boolean }> = {
  note:     { container: true,  leaf: true,  text: true,  open: false },
  collapse: { container: true,  leaf: false, text: true,  open: false },
  footnote: { container: false, leaf: true,  text: true,  open: false },
  card:     { container: false, leaf: true,  text: false, open: false },
};
```

If the regex doesn't match `::card[[` at all (because `[[` is not `[`), then the validator won't flag it and no change is needed. Write the test first to find out.

- [ ] **Step 4: Run tests**

Run: `cd content_processor && npx vitest run src/validator/directives.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj describe -m "fix(content-processor): add card to directive validator to prevent false errors"
jj new
```

---

## Phase 2: Card Links

### Task 7: Add ::card link resolution to content processor

**Files:**
- Modify: `content_processor/src/flattener/resolve-text-links.ts`
- Modify: `content_processor/src/flattener/resolve-text-links.test.ts`

- [ ] **Step 1: Write failing tests for ::card resolution**

Add to `resolve-text-links.test.ts`:

```typescript
describe('::card links', () => {
  const files = new Map<string, string>([
    ['Lenses/My Lens.md', '---\nid: aaaa-bbbb\ntitle: "My Lens Title"\ntldr: "A short summary"\n---\n#### Text\ncontent:: hello world foo bar baz'],
    ['modules/My Module.md', '---\nslug: my-module\ntitle: "My Module Title"\n---\n# Lens: Welcome'],
  ]);

  it('resolves ::card[[lens]] to HTML div with JSON metadata', () => {
    const content = '::card[[../Lenses/My Lens]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toContain('data-lens-card=');
    // Parse the JSON from the data attribute
    const match = result.content.match(/data-lens-card='([^']+)'/);
    expect(match).not.toBeNull();
    const data = JSON.parse(match![1]);
    expect(data.contentId).toBe('aaaa-bbbb');
    expect(data.title).toBe('My Lens Title');
    expect(data.tldr).toBe('A short summary');
    expect(data.targetType).toBe('lens');
  });

  it('resolves ::card[[module]] to HTML div with module metadata', () => {
    const content = '::card[[../modules/My Module]]';
    const result = resolveTextLinks(content, 'Lenses/test.md', files);
    const match = result.content.match(/data-lens-card='([^']+)'/);
    const data = JSON.parse(match![1]);
    expect(data.targetType).toBe('module');
    expect(data.slug).toBe('my-module');
    expect(data.title).toBe('My Module Title');
  });

  it('handles mixed inline and card links', () => {
    const content = 'See [[../Lenses/My Lens|link]] and:\n::card[[../Lenses/My Lens]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toContain('[link](lens:aaaa-bbbb)');
    expect(result.content).toContain('data-lens-card=');
  });

  it('returns error for unresolved ::card link', () => {
    const content = '::card[[../Lenses/Nonexistent]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts`
Expected: FAIL — `::card` not handled yet

- [ ] **Step 3: Add ::card resolution to resolveTextLinks**

Add a new regex and processing step to `resolve-text-links.ts`. Process `::card` BEFORE inline wikilinks (so `::card[[...]]` isn't partially matched by the inline regex):

```typescript
// Add at module level
const CARD_LINK_RE = /::card\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// In resolveTextLinks, before the inline replacement:
// First pass: resolve ::card links
let processed = content.replace(CARD_LINK_RE, (fullMatch, rawPath, _pipeDisplay) => {
  const path = rawPath.trim();
  const resolvedPath = resolveWikilinkPath(path, sourcePath);
  const filePath = findFileWithExtension(resolvedPath, files);

  if (!filePath) {
    errors.push({
      file: sourcePath,
      line: 0,
      message: `Card link target not found: ${path}`,
      severity: 'warning',
    });
    return fullMatch;
  }

  const fileContent = files.get(filePath)!;
  const frontmatter = parseFrontmatter(fileContent, filePath);
  const isModule = filePath.toLowerCase().includes('modules/');

  const cardData: Record<string, unknown> = {
    targetType: isModule ? 'module' : 'lens',
    title: frontmatter.data?.title || fileNameToTitle(filePath),
  };

  if (isModule) {
    cardData.slug = frontmatter.data?.slug || fileNameToSlug(filePath);
  } else {
    cardData.contentId = frontmatter.data?.id || null;
    cardData.tldr = frontmatter.data?.tldr || null;
    // displayType and wordCount are computed during section flattening,
    // not available here. Card will render without them.
    cardData.moduleSlug = null; // Same-module by default
  }

  // Escape single quotes in JSON for safe HTML attribute embedding
  const json = JSON.stringify(cardData).replace(/'/g, '&#39;');
  return `<div data-lens-card='${json}'></div>`;
});

// Second pass: resolve inline wikilinks (on the processed string)
const resolved = processed.replace(INLINE_WIKILINK_RE, ...);
```

Update the function to use `processed` instead of `content` for the inline pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd content_processor && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```
jj describe -m "feat(content-processor): add ::card[[wikilink]] resolution to HTML blocks with metadata"
jj new
```

---

### Task 8: LensCard component

**Files:**
- Create: `web_frontend/src/components/module/LensCard.tsx`
- Create: `web_frontend/src/components/module/LensCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `web_frontend/src/components/module/LensCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LensCard from "./LensCard";

describe("LensCard", () => {
  it("renders title and tldr", () => {
    render(
      <LensCard
        title="Why write this book?"
        tldr="The authors argue the situation is serious"
        targetType="lens"
      />,
    );
    expect(screen.getByText("Why write this book?")).toBeDefined();
    expect(screen.getByText(/The authors argue/)).toBeDefined();
  });

  it("shows completion checkmark when completed", () => {
    const { container } = render(
      <LensCard
        title="Test Lens"
        targetType="lens"
        isCompleted={true}
      />,
    );
    // Check for the checkmark element
    expect(container.querySelector("[data-completed]")).not.toBeNull();
  });

  it("shows empty circle when not completed", () => {
    const { container } = render(
      <LensCard
        title="Test Lens"
        targetType="lens"
        isCompleted={false}
      />,
    );
    expect(container.querySelector("[data-completed]")).toBeNull();
    expect(container.querySelector("[data-incomplete]")).not.toBeNull();
  });

  it("renders module variant with book icon", () => {
    render(
      <LensCard
        title="Module 2"
        targetType="module"
        slug="module-2"
      />,
    );
    expect(screen.getByText("Module 2")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web_frontend && npx vitest run src/components/module/LensCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LensCard component**

Create `web_frontend/src/components/module/LensCard.tsx`:

```tsx
type LensCardProps = {
  title: string;
  tldr?: string | null;
  targetType: "lens" | "module";
  displayType?: string | null;
  contentId?: string | null;
  slug?: string | null;
  wordCount?: number | null;
  videoDurationSeconds?: number | null;
  moduleSlug?: string | null;
  isCompleted?: boolean;
  href?: string;
};

function formatDuration(wordCount?: number | null, videoSeconds?: number | null): string | null {
  const readingMinutes = wordCount ? Math.ceil(wordCount / 200) : 0;
  const videoMinutes = videoSeconds ? Math.ceil(videoSeconds / 60) : 0;
  const total = readingMinutes + videoMinutes;
  if (total === 0) return null;
  return `${total} min`;
}

export default function LensCard({
  title,
  tldr,
  targetType,
  displayType,
  wordCount,
  videoDurationSeconds,
  isCompleted,
  href,
}: LensCardProps) {
  const duration = formatDuration(wordCount, videoDurationSeconds);

  const icon = targetType === "module" ? "📚" : "📄";
  const iconBg =
    targetType === "module"
      ? "bg-indigo-500/15"
      : isCompleted
        ? "bg-emerald-500/15"
        : "bg-amber-700/15";

  const Tag = href ? "a" : "div";

  return (
    <Tag
      href={href}
      className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 transition-colors hover:bg-gray-100 ${isCompleted ? "opacity-70" : ""} ${href ? "cursor-pointer" : ""}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconBg}`}
      >
        <span className="text-sm">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-800 truncate">{title}</div>
        {tldr && (
          <div className="mt-0.5 text-xs text-gray-500 truncate">{tldr}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {duration && (
          <span className="text-[10px] text-gray-400">{duration}</span>
        )}
        {targetType === "lens" && (
          isCompleted ? (
            <div
              data-completed
              className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600"
            >
              <span className="text-[10px] text-white">✓</span>
            </div>
          ) : (
            <div
              data-incomplete
              className="h-4 w-4 rounded-full border-[1.5px] border-gray-300"
            />
          )
        )}
        {targetType === "module" && (
          <span className="text-xs text-gray-400">→</span>
        )}
      </div>
    </Tag>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/components/module/LensCard.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj describe -m "feat(frontend): add LensCard component for rich card link rendering"
jj new
```

---

### Task 9: Wire LensCard into AuthoredText via custom div handler

**Files:**
- Modify: `web_frontend/src/components/module/AuthoredText.tsx`
- Modify: `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx`
- Modify: `web_frontend/src/views/Module.tsx`

- [ ] **Step 1: Write failing test for card rendering**

Add to `AuthoredText.lenslinks.test.tsx`:

```tsx
describe("AuthoredText card links", () => {
  it("renders data-lens-card div as a LensCard component", () => {
    const cardData = JSON.stringify({
      contentId: "aaaa-bbbb",
      targetType: "lens",
      title: "My Card Title",
      tldr: "A summary",
    });
    render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        courseId="my-course"
        moduleSlug="my-module"
      />,
    );
    expect(screen.getByText("My Card Title")).toBeDefined();
    expect(screen.getByText("A summary")).toBeDefined();
  });

  it("shows completion state on card when contentId is in completedContentIds", () => {
    const cardData = JSON.stringify({
      contentId: "aaaa-bbbb",
      targetType: "lens",
      title: "Completed Lens",
    });
    const { container } = render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        completedContentIds={new Set(["aaaa-bbbb"])}
      />,
    );
    expect(container.querySelector("[data-completed]")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx`
Expected: FAIL — div not rendered as LensCard

- [ ] **Step 3: Add custom div handler to AuthoredText**

In AuthoredText.tsx, add import:

```tsx
import LensCard from "./LensCard";
```

Add a `div` handler to the `components` object in ReactMarkdown:

```tsx
div: ({ node, ...props }) => {
  const lensCardJson = (node?.properties as any)?.["dataLensCard"] as string | undefined;
  if (lensCardJson) {
    try {
      const data = JSON.parse(lensCardJson);
      const isCompleted = completedContentIds?.has(data.contentId) ?? false;
      // Build href based on target type
      let href: string | undefined;
      if (data.targetType === "lens") {
        href = resolveLensHref(data.contentId, courseId, moduleSlug, moduleSections);
      } else if (data.targetType === "module") {
        href = courseId
          ? `/course/${courseId}/module/${data.slug}`
          : `/module/${data.slug}`;
      }
      return (
        <LensCard
          {...data}
          isCompleted={isCompleted}
          href={href}
        />
      );
    } catch {
      // Invalid JSON — render as regular div
      return <div {...props} />;
    }
  }
  return <div {...props} />;
},
```

Note: `rehype-raw` converts HTML attributes to camelCase, so `data-lens-card` becomes `dataLensCard` in the node properties. Verify this behavior — if it doesn't camelCase, use `data-lens-card` directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj describe -m "feat(frontend): wire LensCard into AuthoredText via custom div handler"
jj new
```

---

### Task 10: Pass completedContentIds from Module.tsx to AuthoredText

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**TDD note:** This is a wiring task. The behavior (card shows checkmark when contentId is in completedContentIds) is tested by Task 9's tests. This task connects the real data source.

- [ ] **Step 1: Derive completedContentIds in Module.tsx**

Near the existing `completedSections` state (line 394), add a memoized derivation:

```tsx
const completedContentIds = useMemo(() => {
  if (!module) return new Set<string>();
  const ids = new Set<string>();
  for (const [index] of module.sections.entries()) {
    if (completedSections.has(index) && module.sections[index].contentId) {
      ids.add(module.sections[index].contentId!);
    }
  }
  return ids;
}, [module, completedSections]);
```

- [ ] **Step 2: Pass it to AuthoredText**

Update the AuthoredText render call (around line 1476) to include the new prop:

```tsx
<AuthoredText
  key={`text-${keyPrefix}`}
  content={segment.content}
  courseId={courseId ?? undefined}
  moduleSlug={moduleId}
  moduleSections={module.sections.map((s) => ({
    contentId: s.contentId,
    meta: s.meta,
  }))}
  completedContentIds={completedContentIds}
/>
```

- [ ] **Step 3: Verify build passes**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```
jj describe -m "feat(frontend): pass completedContentIds to AuthoredText for card completion state"
jj new
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Run all content processor tests**

Run: `cd content_processor && npx vitest run`
Expected: All PASS

- [ ] **Step 2: Run all frontend tests**

Run: `cd web_frontend && npx vitest run`
Expected: All PASS

- [ ] **Step 3: Run lint and build**

```bash
cd web_frontend && npm run lint && npm run build
cd .. && ruff check . && ruff format --check .
```
Expected: All pass

- [ ] **Step 4: Manual integration test**

Create a test lens in the relay with wikilinks and `::card` links. Start the dev server. Verify:
1. Inline `[[wikilink]]` renders as a clickable hyperlink
2. `::card[[wikilink]]` renders as a rich card with title, TLDR, duration
3. Same-module lens cards show completion checkmark after marking read
4. Optional lenses have the "Mark section complete" button enabled immediately
5. Required lenses still require chat interaction before completing

- [ ] **Step 5: Final commit if any fixes needed**

```
jj describe -m "fix: address issues found in end-to-end verification"
jj new
```
