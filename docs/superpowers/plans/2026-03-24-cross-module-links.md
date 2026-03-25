# Cross-Module Lens Links & Completion State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable lens-to-lens links across modules with proper navigation and completion checkmarks, and support standalone lens links (not in any module).

**Architecture:** Three layers need changes: (1) Content processor populates `moduleSlug` in card/inline link data so the frontend knows where cross-module lenses live. (2) A new API endpoint exposes all completed content IDs for a user. (3) Frontend AuthoredText uses the moduleSlug to build cross-module URLs and fetches global completion state for cross-module cards.

**Tech Stack:** TypeScript (content processor + React frontend), Python/FastAPI (API endpoint), Vitest (frontend tests), pytest (API tests)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `content_processor/src/flattener/resolve-text-links.ts` | Modify | Accept `contentIdToModuleSlug` map; populate `moduleSlug` in card data; encode module slug in inline lens links |
| `content_processor/src/flattener/resolve-text-links.test.ts` | Modify | Tests for cross-module card and inline link resolution |
| `content_processor/src/flattener/index.ts` | Modify | Build `contentId → moduleSlug` map in `processContent`; pass to new post-processing step |
| `content_processor/src/index.ts` | Modify | Add `contentIdToModuleSlug` post-processing call in `processContent` |
| `web_api/routes/progress.py` | Modify | Add `GET /api/progress/completed` endpoint |
| `web_api/tests/test_completed_endpoint.py` | Create | Test for the new endpoint |
| `web_frontend/src/api/progress.ts` | Modify | Add `getCompletedContentIds()` API client function |
| `web_frontend/src/components/module/AuthoredText.tsx` | Modify | Handle `lens:contentId@moduleSlug` and cross-module card hrefs; accept `allCompletedContentIds` prop |
| `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx` | Modify | Tests for cross-module inline links, standalone lens links, cross-module card completion |
| `web_frontend/src/views/Module.tsx` | Modify | Fetch global completed IDs; pass to AuthoredText |

---

### Task 1: Content Processor — Populate `moduleSlug` in Cross-Module Card Links

The content processor currently sets `moduleSlug: null` for all lens card links. After all modules are flattened in `processContent`, we have enough info to build a `contentId → moduleSlug` mapping and populate it.

**Files:**
- Modify: `content_processor/src/flattener/resolve-text-links.ts:120-201` (enrichCardLinks)
- Modify: `content_processor/src/flattener/resolve-text-links.test.ts`
- Modify: `content_processor/src/index.ts:266-368` (processContent)

- [ ] **Step 1: Write failing test for `populateCardModuleSlugs`**

Add to `content_processor/src/flattener/resolve-text-links.test.ts`:

```typescript
import { resolveTextLinks, enrichCardLinks, populateCardModuleSlugs } from './resolve-text-links.js';
import type { Section } from '../index.js';

describe('populateCardModuleSlugs', () => {
  it('populates moduleSlug in card data from contentId→moduleSlug map', () => {
    const cardData = JSON.stringify({
      contentId: 'aaaa-bbbb',
      targetType: 'lens',
      title: 'My Lens',
      tldr: 'Summary',
      moduleSlug: null,
    }).replace(/'/g, '&#39;');

    const section: Section = {
      type: 'lens',
      meta: { title: 'Host Section' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: `<div data-lens-card='${cardData}'></div>` },
      ],
    };

    const mapping = new Map([['aaaa-bbbb', 'target-module']]);
    populateCardModuleSlugs([section], mapping);

    const match = (section.segments[0] as { content: string }).content.match(/data-lens-card='([^']+)'/);
    const data = JSON.parse(match![1].replace(/&#39;/g, "'"));
    expect(data.moduleSlug).toBe('target-module');
  });

  it('leaves moduleSlug null when contentId not in mapping', () => {
    const cardData = JSON.stringify({
      contentId: 'unknown-id',
      targetType: 'lens',
      title: 'Unknown',
      moduleSlug: null,
    }).replace(/'/g, '&#39;');

    const section: Section = {
      type: 'lens',
      meta: { title: 'Host' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: `<div data-lens-card='${cardData}'></div>` },
      ],
    };

    const mapping = new Map<string, string>();
    populateCardModuleSlugs([section], mapping);

    const match = (section.segments[0] as { content: string }).content.match(/data-lens-card='([^']+)'/);
    const data = JSON.parse(match![1].replace(/&#39;/g, "'"));
    expect(data.moduleSlug).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts --reporter verbose`
Expected: FAIL — `populateCardModuleSlugs` is not exported

- [ ] **Step 3: Implement `populateCardModuleSlugs`**

In `content_processor/src/flattener/resolve-text-links.ts`, add after `enrichCardLinks`:

```typescript
/**
 * Post-processing step: populate moduleSlug in card links using a
 * contentId → moduleSlug mapping built from all flattened modules.
 * Call from processContent after all modules are flattened.
 */
export function populateCardModuleSlugs(
  sections: Section[],
  contentIdToModuleSlug: Map<string, string>,
): void {
  for (const section of sections) {
    for (const seg of section.segments) {
      if (seg.type !== 'text') continue;
      if (!seg.content.includes('data-lens-card=')) continue;

      seg.content = seg.content.replace(CARD_HTML_RE, (_match, prefix, jsonStr, suffix) => {
        try {
          const data = JSON.parse(jsonStr.replace(/&#39;/g, "'"));
          if (data.targetType !== 'lens' || !data.contentId) {
            return `${prefix}${jsonStr}${suffix}`;
          }
          const moduleSlug = contentIdToModuleSlug.get(data.contentId);
          if (moduleSlug) {
            data.moduleSlug = moduleSlug;
          }
          const newJson = JSON.stringify(data).replace(/'/g, '&#39;');
          return `${prefix}${newJson}${suffix}`;
        } catch {
          return `${prefix}${jsonStr}${suffix}`;
        }
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts --reporter verbose`
Expected: PASS

- [ ] **Step 5: Wire up in `processContent`**

In `content_processor/src/index.ts`, after the module-flattening loop (around line 333), add:

```typescript
import { populateCardModuleSlugs } from './flattener/resolve-text-links.js';

// After all modules are flattened, build contentId → moduleSlug mapping
// and populate moduleSlug in cross-module card links
const contentIdToModuleSlug = new Map<string, string>();
for (const mod of modules) {
  for (const section of mod.sections) {
    if (section.contentId) {
      contentIdToModuleSlug.set(section.contentId, mod.slug);
    }
  }
}
for (const mod of modules) {
  populateCardModuleSlugs(mod.sections, contentIdToModuleSlug);
}
```

- [ ] **Step 6: Commit**

Message: `feat(content-processor): populate moduleSlug in cross-module card links`

---

### Task 2: Content Processor — Encode Module Slug in Inline Lens Links

Currently inline lens links are `[text](lens:contentId)`. For cross-module links, the frontend needs to know the target module. Use a post-processing approach (like `populateCardModuleSlugs`): after all modules are flattened, scan text segments and rewrite `lens:contentId` → `lens:contentId@moduleSlug` using the mapping.

**Approach:** Don't modify `resolveTextLinks` signature — the mapping doesn't exist at initial flattening time. Instead, add a `resolveInlineLensModuleSlugs` post-processing function called from `processContent` alongside `populateCardModuleSlugs`.

**Files:**
- Modify: `content_processor/src/flattener/resolve-text-links.ts` (add `resolveInlineLensModuleSlugs`)
- Modify: `content_processor/src/flattener/resolve-text-links.test.ts`
- Modify: `content_processor/src/index.ts` (call from `processContent`)

- [ ] **Step 1: Write failing test for `resolveInlineLensModuleSlugs`**

Add to `content_processor/src/flattener/resolve-text-links.test.ts`:

```typescript
import { resolveTextLinks, enrichCardLinks, populateCardModuleSlugs, resolveInlineLensModuleSlugs } from './resolve-text-links.js';

describe('resolveInlineLensModuleSlugs', () => {
  it('adds moduleSlug to inline lens links', () => {
    const section: Section = {
      type: 'lens',
      meta: { title: 'Host' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: 'See [My Lens](lens:aaaa-bbbb)' },
      ],
    };

    const mapping = new Map([['aaaa-bbbb', 'other-module']]);
    resolveInlineLensModuleSlugs([section], mapping);

    expect((section.segments[0] as { content: string }).content).toBe(
      'See [My Lens](lens:aaaa-bbbb@other-module)'
    );
  });

  it('leaves inline lens links unchanged when contentId not in mapping', () => {
    const section: Section = {
      type: 'lens',
      meta: { title: 'Host' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: 'See [My Lens](lens:unknown-id)' },
      ],
    };

    resolveInlineLensModuleSlugs([section], new Map());

    expect((section.segments[0] as { content: string }).content).toBe(
      'See [My Lens](lens:unknown-id)'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts --reporter verbose`
Expected: FAIL — `resolveInlineLensModuleSlugs` is not exported

- [ ] **Step 3: Implement `resolveInlineLensModuleSlugs`**

In `content_processor/src/flattener/resolve-text-links.ts`, add after `populateCardModuleSlugs`:

```typescript
const INLINE_LENS_RE = /\[([^\]]+)\]\(lens:([a-f0-9-]+)\)/g;

/**
 * Post-processing step: add moduleSlug to inline lens links.
 * Rewrites [text](lens:contentId) → [text](lens:contentId@moduleSlug)
 * for lenses that appear in the contentId→moduleSlug mapping.
 * Call from processContent after all modules are flattened.
 */
export function resolveInlineLensModuleSlugs(
  sections: Section[],
  contentIdToModuleSlug: Map<string, string>,
): void {
  for (const section of sections) {
    for (const seg of section.segments) {
      if (seg.type !== 'text') continue;
      if (!seg.content.includes('lens:')) continue;

      seg.content = seg.content.replace(INLINE_LENS_RE, (match, display, contentId) => {
        const moduleSlug = contentIdToModuleSlug.get(contentId);
        if (moduleSlug) {
          return `[${display}](lens:${contentId}@${moduleSlug})`;
        }
        return match;
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts --reporter verbose`
Expected: PASS

- [ ] **Step 5: Wire up in `processContent`**

In `content_processor/src/index.ts`, add to the post-processing block from Task 1 Step 5:

```typescript
import { populateCardModuleSlugs, resolveInlineLensModuleSlugs } from './flattener/resolve-text-links.js';

// (mapping already built in Task 1)
for (const mod of modules) {
  populateCardModuleSlugs(mod.sections, contentIdToModuleSlug);
  resolveInlineLensModuleSlugs(mod.sections, contentIdToModuleSlug);
}
```

- [ ] **Step 6: Run tests to verify all pass**

Run: `cd content_processor && npx vitest run src/flattener/resolve-text-links.test.ts --reporter verbose`
Expected: PASS

- [ ] **Step 7: Commit**

Message: `feat(content-processor): encode moduleSlug in inline cross-module lens links`

---

### Task 3: API Endpoint — `GET /api/progress/completed`

Expose `get_completed_content_ids` so the frontend can check completion for cross-module lenses.

**Files:**
- Modify: `web_api/routes/progress.py`
- Create: `web_api/tests/test_completed_endpoint.py`

- [ ] **Step 1: Write failing test**

Create `web_api/tests/test_completed_endpoint.py`. Follow the project's existing test pattern: use `TestClient` with the root `main.py` app, patch at the import location in `web_api.routes.progress`.

Note: `get_optional_user` is imported as `from web_api.auth import get_optional_user` in `progress.py`, so patch at `web_api.routes.progress.get_optional_user`. `get_or_create_user` is imported as `from core import get_or_create_user`, so patch at `web_api.routes.progress.get_or_create_user`. `get_connection` is from `core.database`, so patch at `web_api.routes.progress.get_connection`. `get_completed_content_ids` will be imported from `core.modules.progress`, so patch at `web_api.routes.progress.get_completed_content_ids`.

```python
"""Tests for GET /api/progress/completed endpoint."""

import sys
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

# Ensure we import from root main.py
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from main import app

client = TestClient(app)


def test_returns_completed_ids_for_authenticated_user():
    """Authenticated user gets their completed content IDs."""
    mock_ids = {"aaaa-bbbb", "cccc-dddd"}

    @asynccontextmanager
    async def fake_conn():
        yield AsyncMock()

    with (
        patch("web_api.routes.progress.get_optional_user", new_callable=AsyncMock) as mock_auth,
        patch("web_api.routes.progress.get_or_create_user", new_callable=AsyncMock) as mock_user,
        patch("web_api.routes.progress.get_connection", fake_conn),
        patch("web_api.routes.progress.get_completed_content_ids", new_callable=AsyncMock) as mock_get,
    ):
        mock_auth.return_value = {"sub": "discord-123"}
        mock_user.return_value = {"user_id": 42}
        mock_get.return_value = mock_ids

        resp = client.get("/api/progress/completed")

    assert resp.status_code == 200
    data = resp.json()
    assert set(data["completed"]) == {"aaaa-bbbb", "cccc-dddd"}


def test_returns_401_for_unauthenticated_user():
    """Unauthenticated user gets 401."""
    with patch("web_api.routes.progress.get_optional_user", new_callable=AsyncMock) as mock_auth:
        mock_auth.return_value = None

        resp = client.get("/api/progress/completed")

    assert resp.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/penguin/code/lens-platform/ws3 && .venv/bin/pytest web_api/tests/test_completed_endpoint.py -v`
Expected: FAIL — endpoint doesn't exist / import error

- [ ] **Step 3: Implement the endpoint**

In `web_api/routes/progress.py`, add import and endpoint:

```python
# Add to imports at top:
from core.modules.progress import (
    get_or_create_progress,
    mark_content_complete,
    update_time_spent,
    get_module_progress,
    get_completed_content_ids,  # NEW
)
from core.database import get_transaction, get_connection  # add get_connection if not imported

# Add endpoint:
@router.get("/completed")
async def get_completed_endpoint(request: Request):
    """Get all content IDs the authenticated user has completed.

    Returns a list of content ID strings (UUIDs). Used by the frontend
    to show completion checkmarks on cross-module lens cards.
    """
    user_jwt = await get_optional_user(request)
    if not user_jwt:
        raise HTTPException(401, "Authentication required")

    discord_id = user_jwt["sub"]
    user = await get_or_create_user(discord_id)

    async with get_connection() as conn:
        completed = await get_completed_content_ids(conn, user["user_id"])

    return {"completed": list(completed)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/penguin/code/lens-platform/ws3 && .venv/bin/pytest web_api/tests/test_completed_endpoint.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

Message: `feat(api): add GET /api/progress/completed endpoint`

---

### Task 4: Frontend API Client — `getCompletedContentIds`

**Files:**
- Modify: `web_frontend/src/api/progress.ts`

- [ ] **Step 1: Add the API client function**

In `web_frontend/src/api/progress.ts`, add:

```typescript
export async function getCompletedContentIds(): Promise<Set<string>> {
  const res = await fetchWithRefresh(`${API_BASE}/api/progress/completed`, {
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 401) {
      return new Set();
    }
    throw new Error("Failed to fetch completed content IDs");
  }

  const data = await res.json();
  return new Set(data.completed);
}
```

No separate test needed — this is a thin fetch wrapper. Covered by integration via AuthoredText tests.

- [ ] **Step 2: Commit**

Message: `feat(frontend): add getCompletedContentIds API client`

---

### Task 5: Frontend — Cross-Module Link Navigation in AuthoredText

Update AuthoredText to handle `lens:contentId@moduleSlug` inline links and cross-module card hrefs.

**Files:**
- Modify: `web_frontend/src/components/module/AuthoredText.tsx`
- Modify: `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx`

- [ ] **Step 1: Write failing tests for cross-module inline links**

Add to `AuthoredText.lenslinks.test.tsx`:

```typescript
describe("cross-module lens links", () => {
  it("renders lens:contentId@moduleSlug as a cross-module link", () => {
    render(
      <AuthoredText
        content="See [Other Lens](lens:aaaa-bbbb@other-module)"
        courseId="my-course"
        moduleSlug="current-module"
        moduleSections={[]}
      />,
    );
    const link = screen.getByText("Other Lens");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/course/my-course/module/other-module");
  });

  it("renders lens:contentId (no moduleSlug, not in current module) as standalone lens link", () => {
    render(
      <AuthoredText
        content="See [Standalone](lens:aaaa-bbbb)"
        courseId="my-course"
        moduleSlug="current-module"
        moduleSections={[]}
      />,
    );
    const link = screen.getByText("Standalone");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/lens/aaaa-bbbb");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx --reporter verbose`
Expected: FAIL — links render as `#lens-aaaa-bbbb` (current fallback)

- [ ] **Step 3: Update AuthoredText to handle cross-module and standalone links**

In `web_frontend/src/components/module/AuthoredText.tsx`, update the `renderLink` callback:

```typescript
const renderLink = useCallback(
  ({
    children,
    href,
  }: {
    children?: React.ReactNode;
    href?: string;
  }) => {
    if (href?.startsWith("lens:")) {
      const rest = href.slice("lens:".length);
      // Check for cross-module format: contentId@moduleSlug
      const atIndex = rest.indexOf("@");
      let contentId: string;
      let targetModuleSlug: string | null = null;

      if (atIndex !== -1) {
        contentId = rest.slice(0, atIndex);
        targetModuleSlug = rest.slice(atIndex + 1);
      } else {
        contentId = rest;
      }

      // Same-module: hash link
      if (moduleSections) {
        const index = moduleSections.findIndex((s) => s.contentId === contentId);
        if (index !== -1) {
          return (
            <a
              href={`#${getSectionSlug(moduleSections[index], index)}`}
              className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
            >
              {children}
            </a>
          );
        }
      }

      // Cross-module: navigate to target module
      if (targetModuleSlug && courseId) {
        return (
          <a
            href={`/course/${courseId}/module/${targetModuleSlug}`}
            className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
          >
            {children}
          </a>
        );
      }

      // Standalone lens (no module)
      return (
        <a
          href={`/lens/${contentId}`}
          className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
        >
          {children}
        </a>
      );
    }

    if (href?.startsWith("module:")) {
      const slug = href.slice("module:".length);
      return (
        <a
          href={courseId ? `/course/${courseId}/module/${slug}` : `#${slug}`}
          className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
        >
          {children}
        </a>
      );
    }

    // External / regular link
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
  [courseId, moduleSections],
);
```

Also update `resolveLensHref` (used by card links) to handle cross-module:

```typescript
const resolveLensHref = useCallback(
  (contentId: string, moduleSlug?: string | null): string => {
    // Same-module lookup
    if (moduleSections) {
      const index = moduleSections.findIndex((s) => s.contentId === contentId);
      if (index !== -1) {
        return `#${getSectionSlug(moduleSections[index], index)}`;
      }
    }
    // Cross-module
    if (moduleSlug && courseId) {
      return `/course/${courseId}/module/${moduleSlug}`;
    }
    // Standalone lens
    return `/lens/${contentId}`;
  },
  [moduleSections, courseId],
);
```

Update the card div handler to pass `moduleSlug`:

```typescript
if (data.targetType === "lens") {
  href = resolveLensHref(data.contentId, data.moduleSlug);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx --reporter verbose`
Expected: PASS

- [ ] **Step 5: Commit**

Message: `feat(frontend): cross-module and standalone lens link navigation`

---

### Task 6: Frontend — Cross-Module Completion State

Fetch global completed content IDs and merge with current-module completions for LensCard display.

**Files:**
- Modify: `web_frontend/src/components/module/AuthoredText.tsx`
- Modify: `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx`
- Modify: `web_frontend/src/views/Module.tsx`

- [ ] **Step 1: Write failing test for cross-module card completion**

Add to `AuthoredText.lenslinks.test.tsx`:

```typescript
describe("cross-module card completion", () => {
  it("shows completion for cross-module card when contentId is in allCompletedContentIds", () => {
    const cardData = JSON.stringify({
      contentId: "cross-mod-id",
      targetType: "lens",
      title: "Cross-Module Lens",
      moduleSlug: "other-module",
    });
    const { container } = render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        courseId="my-course"
        allCompletedContentIds={new Set(["cross-mod-id"])}
      />,
    );
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-lens-gold-400");
  });

  it("does not show completion when cross-module card contentId is not completed", () => {
    const cardData = JSON.stringify({
      contentId: "not-done-id",
      targetType: "lens",
      title: "Not Done Lens",
      moduleSlug: "other-module",
    });
    const { container } = render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        courseId="my-course"
        allCompletedContentIds={new Set()}
      />,
    );
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-gray-200");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx --reporter verbose`
Expected: FAIL — `allCompletedContentIds` prop doesn't exist

- [ ] **Step 3: Add `allCompletedContentIds` prop to AuthoredText**

In `web_frontend/src/components/module/AuthoredText.tsx`:

Add to props type:
```typescript
type AuthoredTextProps = {
  content: string;
  courseId?: string;
  moduleSlug?: string;
  moduleSections?: ModuleSection[];
  completedContentIds?: Set<string>;
  allCompletedContentIds?: Set<string>;  // cross-module completion
};
```

Update the card div handler's `isCompleted` logic (use `||` not `??` so both sets are checked):
```typescript
const isCompleted =
  (completedContentIds?.has(data.contentId) || allCompletedContentIds?.has(data.contentId)) ?? false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx --reporter verbose`
Expected: PASS

- [ ] **Step 5: Wire up in Module.tsx — fetch and pass `allCompletedContentIds`**

In `web_frontend/src/views/Module.tsx`:

Add import:
```typescript
import { getCompletedContentIds } from "../api/progress";
```

Add state (near other state declarations):
```typescript
const [allCompletedContentIds, setAllCompletedContentIds] = useState<Set<string>>(new Set());
```

Fetch on mount (add to the existing useEffect that loads module data, or as a separate effect):
```typescript
useEffect(() => {
  if (isAuthenticated) {
    getCompletedContentIds()
      .then(setAllCompletedContentIds)
      .catch(() => {}); // Non-critical, fail silently
  }
}, [isAuthenticated]);
```

Pass to AuthoredText (in the segment rendering around line 1494):
```typescript
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
  allCompletedContentIds={allCompletedContentIds}
/>
```

- [ ] **Step 6: Run all frontend tests**

Run: `cd web_frontend && npx vitest run --reporter verbose`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

Message: `feat(frontend): cross-module lens completion state via global progress fetch`

---

### Task 7: Verify and Update urlTransform

The ReactMarkdown `urlTransform` in AuthoredText needs to preserve the `@` in `lens:contentId@moduleSlug`.

**Files:**
- Modify: `web_frontend/src/components/module/AuthoredText.tsx:106-113` (if needed)
- Modify: `web_frontend/src/components/module/AuthoredText.lenslinks.test.tsx`

- [ ] **Step 1: Write test verifying the `@` survives urlTransform**

This is already covered by the Task 5 test (`lens:aaaa-bbbb@other-module` renders as a cross-module link). If that test passes, urlTransform is fine because it already allows `lens:` prefix URLs through.

- [ ] **Step 2: Verify by running existing tests**

Run: `cd web_frontend && npx vitest run src/components/module/AuthoredText.lenslinks.test.tsx --reporter verbose`
Expected: PASS

If failing because `@` is stripped by urlTransform, update the transform:
```typescript
urlTransform={(url) => {
  if (url.startsWith("lens:") || url.startsWith("module:")) {
    return url;
  }
  return url;
}}
```

This already passes `lens:` URLs through unchanged, so `@` should be preserved. No action needed.

- [ ] **Step 3: Commit (if changes were needed)**

---

### Task 8: Build and Lint Check

- [ ] **Step 1: Run content processor tests**

Run: `cd content_processor && npx vitest run --reporter verbose`
Expected: All pass

- [ ] **Step 2: Run frontend lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No errors

- [ ] **Step 3: Run backend tests**

Run: `cd /home/penguin/code/lens-platform/ws3 && .venv/bin/pytest web_api/tests/test_completed_endpoint.py -v`
Expected: PASS

- [ ] **Step 4: Final commit if any fixups needed**
