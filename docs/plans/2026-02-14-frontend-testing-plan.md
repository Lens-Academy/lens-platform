# Frontend Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 8 test files covering critical paths (utilities, API layer, hooks) with a shared fetch mock utility, following the [design doc](2026-02-14-frontend-testing-design.md).

**Architecture:** Unit+1 testing — mock `fetch` and timers at the external boundary, run all intermediate code (fetchWithRefresh, fetchWithTimeout, API functions) for real. Shared `createFetchMock()` utility prevents per-file mocking divergence.

**Tech Stack:** Vitest, jsdom, React Testing Library, `@testing-library/react` (renderHook)

**Design doc:** `docs/plans/2026-02-14-frontend-testing-design.md`

---

## Task 1: Shared Fetch Mock Utility

**Files:**
- Create: `web_frontend/src/test/fetchMock.ts`

This is test infrastructure, not production code. No TDD cycle needed.

**Step 1: Create the utility**

```typescript
// web_frontend/src/test/fetchMock.ts
import { vi } from "vitest";

const originalFetch = global.fetch;

/**
 * Reusable fetch mock for unit+1 tests.
 *
 * Usage:
 *   const fm = createFetchMock();
 *   beforeEach(() => fm.install());
 *   afterEach(() => fm.restore());
 *
 *   fm.mock.mockResolvedValueOnce(jsonResponse({ data: 1 }));
 *   fm.mock.mockImplementation((input) => {
 *     if (String(input).includes("/auth/me")) return Promise.resolve(jsonResponse({...}));
 *     return Promise.resolve(errorResponse(404));
 *   });
 */
export function createFetchMock() {
  const mock = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >();

  return {
    mock,
    install() {
      global.fetch = mock as unknown as typeof fetch;
    },
    restore() {
      global.fetch = originalFetch;
      mock.mockReset();
    },
    /** Filter mock.calls to those whose URL contains the substring */
    callsTo(urlSubstring: string) {
      return mock.mock.calls.filter(([input]) => {
        const url = input instanceof Request ? input.url : String(input);
        return url.includes(urlSubstring);
      });
    },
  };
}

/** Create a Response with JSON body */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Create an error Response (no body) */
export function errorResponse(status: number): Response {
  return new Response(null, { status });
}
```

**Step 2: Commit**

```bash
cd web_frontend
jj new -m "test: add shared fetch mock utility"
```

---

## Task 2: extractHeadings Tests

**Files:**
- Create: `web_frontend/src/utils/__tests__/extractHeadings.test.ts`
- Reference: `web_frontend/src/utils/extractHeadings.ts`

**Step 1: Write tests**

```typescript
// web_frontend/src/utils/__tests__/extractHeadings.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateHeadingId,
  extractHeadings,
  extractAllHeadings,
} from "../extractHeadings";

// Suppress debug console.logs in extractHeadings
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateHeadingId", () => {
  it("lowercases and converts spaces to hyphens", () => {
    expect(generateHeadingId("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(generateHeadingId("What's New?")).toBe("whats-new");
  });

  it("collapses multiple hyphens", () => {
    expect(generateHeadingId("a - b - c")).toBe("a-b-c");
  });

  it("truncates to 50 characters", () => {
    expect(generateHeadingId("a".repeat(60))).toHaveLength(50);
  });

  it("handles empty string", () => {
    expect(generateHeadingId("")).toBe("");
  });

  it("handles special-characters-only input", () => {
    expect(generateHeadingId("!@#$%")).toBe("");
  });
});

describe("extractHeadings", () => {
  it("extracts markdown h2 headings", () => {
    const result = extractHeadings("## Introduction\nText\n## Methods");
    expect(result).toEqual([
      { id: "introduction", text: "Introduction", level: 2 },
      { id: "methods", text: "Methods", level: 2 },
    ]);
  });

  it("extracts markdown h3 headings", () => {
    const result = extractHeadings("### Sub-section");
    expect(result).toEqual([
      { id: "sub-section", text: "Sub-section", level: 3 },
    ]);
  });

  it("ignores h1 and h4+ headings", () => {
    const result = extractHeadings("# Title\n## Two\n### Three\n#### Four");
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Two");
    expect(result[1].text).toBe("Three");
  });

  it("extracts HTML h2/h3 tags", () => {
    const result = extractHeadings("<h2>Overview</h2>\n<h3>Details</h3>");
    expect(result).toEqual([
      { id: "overview", text: "Overview", level: 2 },
      { id: "details", text: "Details", level: 3 },
    ]);
  });

  it("deduplicates IDs within a single document", () => {
    const result = extractHeadings("## Setup\n## Setup\n## Setup");
    expect(result.map((h) => h.id)).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("returns empty array for empty input", () => {
    expect(extractHeadings("")).toEqual([]);
  });

  it("returns empty array for input with no headings", () => {
    expect(extractHeadings("Just text\nno headings")).toEqual([]);
  });

  it("shares seenIds counter across calls", () => {
    const seenIds = new Map<string, number>();
    extractHeadings("## Title", seenIds);
    const result = extractHeadings("## Title", seenIds);
    expect(result[0].id).toBe("title-1");
  });
});

describe("extractAllHeadings", () => {
  it("extracts from multiple documents with shared IDs", () => {
    const result = extractAllHeadings(["## Intro", "## Intro\n## Methods"]);
    expect(result).toEqual([
      { id: "intro", text: "Intro", level: 2 },
      { id: "intro-1", text: "Intro", level: 2 },
      { id: "methods", text: "Methods", level: 2 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(extractAllHeadings([])).toEqual([]);
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/utils/__tests__/extractHeadings.test.ts
```

Expected: all pass (testing existing code).

**Step 3: Commit**

```bash
jj new -m "test: add extractHeadings tests"
```

---

## Task 3: completionButtonText Tests

**Files:**
- Create: `web_frontend/src/utils/__tests__/completionButtonText.test.ts`
- Reference: `web_frontend/src/utils/completionButtonText.ts`, `web_frontend/src/types/module.ts`

**Step 1: Write tests**

```typescript
// web_frontend/src/utils/__tests__/completionButtonText.test.ts
import { describe, it, expect } from "vitest";
import {
  getSectionTextLength,
  getCompletionButtonText,
} from "../completionButtonText";
import type { ModuleSection } from "@/types/module";

function textSection(content: string): ModuleSection {
  return { type: "text", content };
}

function pageSection(texts: string[]): ModuleSection {
  return {
    type: "page",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: null },
    segments: texts.map((t) => ({ type: "text" as const, content: t })),
    optional: false,
  };
}

function videoSection(): ModuleSection {
  return {
    type: "lens-video",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    videoId: null,
    meta: { title: "Video", channel: null },
    segments: [],
    optional: false,
  };
}

function articleSection(): ModuleSection {
  return {
    type: "lens-article",
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: "Article", author: null, sourceUrl: null },
    segments: [],
    optional: false,
  };
}

describe("getSectionTextLength", () => {
  it("returns content length for text sections", () => {
    expect(getSectionTextLength(textSection("hello"))).toBe(5);
  });

  it("returns sum of text segment lengths for page sections", () => {
    expect(getSectionTextLength(pageSection(["abc", "de"]))).toBe(5);
  });

  it("returns 0 for page sections with no text segments", () => {
    const section: ModuleSection = {
      type: "page",
      contentId: null,
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: null },
      segments: [
        {
          type: "chat",
          instructions: "",
          hidePreviousContentFromUser: false,
          hidePreviousContentFromTutor: false,
        },
      ],
      optional: false,
    };
    expect(getSectionTextLength(section)).toBe(0);
  });

  it("returns Infinity for video sections", () => {
    expect(getSectionTextLength(videoSection())).toBe(Infinity);
  });

  it("returns Infinity for article sections", () => {
    expect(getSectionTextLength(articleSection())).toBe(Infinity);
  });
});

describe("getCompletionButtonText", () => {
  it("returns 'Get started' for short text at index 0", () => {
    expect(getCompletionButtonText(textSection("short"), 0)).toBe(
      "Get started",
    );
  });

  it("returns 'Continue' for short text at index > 0", () => {
    expect(getCompletionButtonText(textSection("short"), 1)).toBe("Continue");
  });

  it("returns 'Mark section complete' for long text", () => {
    expect(getCompletionButtonText(textSection("x".repeat(1750)), 0)).toBe(
      "Mark section complete",
    );
  });

  it("returns 'Mark section complete' for video sections", () => {
    expect(getCompletionButtonText(videoSection(), 0)).toBe(
      "Mark section complete",
    );
  });

  it("returns 'Mark section complete' for article sections", () => {
    expect(getCompletionButtonText(articleSection(), 0)).toBe(
      "Mark section complete",
    );
  });

  it("threshold is exclusive (1749 = short, 1750 = long)", () => {
    expect(getCompletionButtonText(textSection("x".repeat(1749)), 0)).toBe(
      "Get started",
    );
    expect(getCompletionButtonText(textSection("x".repeat(1750)), 0)).toBe(
      "Mark section complete",
    );
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/utils/__tests__/completionButtonText.test.ts
```

**Step 3: Commit**

```bash
jj new -m "test: add completionButtonText tests"
```

---

## Task 4: stageProgress Tests

**Files:**
- Create: `web_frontend/src/utils/__tests__/stageProgress.test.ts`
- Reference: `web_frontend/src/utils/stageProgress.ts`

**Step 1: Write tests**

```typescript
// web_frontend/src/utils/__tests__/stageProgress.test.ts
import { describe, it, expect } from "vitest";
import { getCircleFillClasses, getRingClasses } from "../stageProgress";

describe("getCircleFillClasses", () => {
  it("completed, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: true, isViewing: false, isOptional: false }),
    ).toBe("bg-blue-500 text-white");
  });

  it("completed, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: true, isViewing: false, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-blue-500 text-white hover:bg-blue-600");
  });

  it("viewing, not completed, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: true, isOptional: false }),
    ).toBe("bg-gray-500 text-white");
  });

  it("viewing, not completed, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: true, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-gray-500 text-white hover:bg-gray-600");
  });

  it("default state, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: false, isOptional: false }),
    ).toBe("bg-gray-200 text-gray-400");
  });

  it("default state, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: false, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-gray-200 text-gray-400 hover:bg-gray-300");
  });

  it("optional completed, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: true, isViewing: false, isOptional: true }),
    ).toBe("bg-white text-blue-500 border-2 border-dashed border-blue-400");
  });

  it("optional completed, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: true, isViewing: false, isOptional: true },
        { includeHover: true },
      ),
    ).toBe("bg-white text-blue-500 border-2 border-dashed border-blue-400 hover:border-blue-500");
  });

  it("optional viewing, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: true, isOptional: true }),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-400");
  });

  it("optional viewing, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: true, isOptional: true },
        { includeHover: true },
      ),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-400 hover:border-gray-500");
  });

  it("optional default, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: false, isOptional: true }),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-300");
  });

  it("optional default, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: false, isOptional: true },
        { includeHover: true },
      ),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-300 hover:border-gray-400");
  });
});

describe("getRingClasses", () => {
  it("returns empty string when not viewing", () => {
    expect(getRingClasses(false, false)).toBe("");
    expect(getRingClasses(false, true)).toBe("");
  });

  it("returns blue ring when viewing and completed", () => {
    expect(getRingClasses(true, true)).toBe("ring-2 ring-offset-2 ring-blue-500");
  });

  it("returns gray ring when viewing and not completed", () => {
    expect(getRingClasses(true, false)).toBe("ring-2 ring-offset-2 ring-gray-500");
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/utils/__tests__/stageProgress.test.ts
```

**Step 3: Commit**

```bash
jj new -m "test: add stageProgress tests"
```

---

## Task 5: formatDuration Tests

**Files:**
- Create: `web_frontend/src/utils/__tests__/formatDuration.test.ts`
- Reference: `web_frontend/src/utils/formatDuration.ts`

**Step 1: Write tests**

```typescript
// web_frontend/src/utils/__tests__/formatDuration.test.ts
import { describe, it, expect } from "vitest";
import { formatDuration } from "../formatDuration";

describe("formatDuration", () => {
  it("formats 0 seconds", () => {
    expect(formatDuration(0)).toBe("0 sec");
  });

  it("formats seconds under a minute", () => {
    expect(formatDuration(45)).toBe("45 sec");
  });

  it("formats 59 seconds (boundary)", () => {
    expect(formatDuration(59)).toBe("59 sec");
  });

  it("formats exactly 1 minute", () => {
    expect(formatDuration(60)).toBe("1 min");
  });

  it("formats minutes with seconds (under 5 min)", () => {
    expect(formatDuration(135)).toBe("2 min 15 sec");
  });

  it("formats 4 min 59 sec (boundary before rounding)", () => {
    expect(formatDuration(299)).toBe("4 min 59 sec");
  });

  it("formats exactly 5 minutes (starts rounding)", () => {
    expect(formatDuration(300)).toBe("5 min");
  });

  it("rounds to nearest minute above 5 min", () => {
    expect(formatDuration(423)).toBe("7 min");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3665)).toBe("1 hr 1 min");
  });

  it("formats exact hours", () => {
    expect(formatDuration(3600)).toBe("1 hr");
  });

  it("returns '0 sec' for negative input", () => {
    expect(formatDuration(-5)).toBe("0 sec");
  });

  it("returns '0 sec' for NaN", () => {
    expect(formatDuration(NaN)).toBe("0 sec");
  });

  it("returns '0 sec' for Infinity", () => {
    expect(formatDuration(Infinity)).toBe("0 sec");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(45.9)).toBe("45 sec");
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/utils/__tests__/formatDuration.test.ts
```

**Step 3: Commit**

```bash
jj new -m "test: add formatDuration tests"
```

---

## Task 6: fetchWithRefresh Tests

**Files:**
- Create: `web_frontend/src/api/__tests__/fetchWithRefresh.test.ts`
- Reference: `web_frontend/src/api/fetchWithRefresh.ts`
- Uses: `web_frontend/src/test/fetchMock.ts`

**Important:** `fetchWithRefresh` has a module-level `refreshPromise` singleton for deduplication. Each test must complete the full refresh cycle so the singleton resets (the `.finally()` sets it to `null`). Since we `await fetchWithRefresh(...)`, this happens automatically.

**Step 1: Create `src/api/__tests__/` directory and write tests**

```typescript
// web_frontend/src/api/__tests__/fetchWithRefresh.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createFetchMock,
  jsonResponse,
  errorResponse,
} from "@/test/fetchMock";
import { fetchWithRefresh } from "../fetchWithRefresh";

const fm = createFetchMock();

beforeEach(() => fm.install());
afterEach(() => fm.restore());

describe("fetchWithRefresh", () => {
  it("passes through non-401 responses", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ data: "ok" }));

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "ok" });
    expect(fm.mock).toHaveBeenCalledTimes(1);
  });

  it("retries after successful token refresh on 401", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // refresh
      .mockResolvedValueOnce(jsonResponse({ data: "ok" })); // retry

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "ok" });
    expect(fm.mock).toHaveBeenCalledTimes(3);
    expect(fm.callsTo("/auth/refresh")).toHaveLength(1);
  });

  it("returns original 401 when refresh fails", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(errorResponse(403)); // refresh fails

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(401);
    expect(fm.mock).toHaveBeenCalledTimes(2);
  });

  it("returns original 401 when refresh throws network error", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401))
      .mockRejectedValueOnce(new Error("Network error"));

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(401);
  });

  it("deduplicates concurrent 401 refreshes", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // call A original
      .mockResolvedValueOnce(errorResponse(401)) // call B original
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // single refresh
      .mockResolvedValueOnce(jsonResponse({ a: 1 })) // call A retry
      .mockResolvedValueOnce(jsonResponse({ b: 2 })); // call B retry

    const [resA, resB] = await Promise.all([
      fetchWithRefresh("/api/a"),
      fetchWithRefresh("/api/b"),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(fm.callsTo("/auth/refresh")).toHaveLength(1);
    expect(fm.mock).toHaveBeenCalledTimes(5);
  });

  it("passes through non-401 errors unchanged", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(500);
    expect(fm.mock).toHaveBeenCalledTimes(1);
  });

  it("preserves request options on retry", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await fetchWithRefresh("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });

    const retryCall = fm.mock.mock.calls[2];
    expect(retryCall[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/api/__tests__/fetchWithRefresh.test.ts
```

**Step 3: Commit**

```bash
jj new -m "test: add fetchWithRefresh tests"
```

---

## Task 7: modules.ts API Tests

**Files:**
- Create: `web_frontend/src/api/__tests__/modules.test.ts`
- Reference: `web_frontend/src/api/modules.ts`
- Uses: `web_frontend/src/test/fetchMock.ts`, real `fetchWithRefresh`, real `fetchWithTimeout`

**Notes:**
- `fetchWithTimeout` is not exported — test timeout behavior through exported functions.
- Suppress `console.error` (timeout handler logs errors).
- `Sentry.captureException` is safe without init (no-op).
- `getAnonymousToken()` uses localStorage (mocked in setup.ts).

**Step 1: Write tests**

```typescript
// web_frontend/src/api/__tests__/modules.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createFetchMock,
  jsonResponse,
  errorResponse,
} from "@/test/fetchMock";
import {
  listModules,
  getModule,
  getChatHistory,
  getNextModule,
  transcribeAudio,
  getModuleProgress,
  getCourseProgress,
  RequestTimeoutError,
} from "../modules";

const fm = createFetchMock();

beforeEach(() => {
  fm.install();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  fm.restore();
  vi.restoreAllMocks();
});

describe("listModules", () => {
  it("returns parsed module list", async () => {
    const modules = [{ slug: "a", title: "A" }];
    fm.mock.mockResolvedValue(jsonResponse({ modules }));

    expect(await listModules()).toEqual(modules);
  });

  it("throws on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(listModules()).rejects.toThrow("Failed to fetch modules");
  });
});

describe("getModule", () => {
  it("returns parsed module", async () => {
    const mod = { slug: "test", title: "Test", sections: [] };
    fm.mock.mockResolvedValue(jsonResponse(mod));

    expect(await getModule("test")).toEqual(mod);
    expect(fm.callsTo("/api/modules/test")).toHaveLength(1);
  });

  it("throws on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(404));
    await expect(getModule("missing")).rejects.toThrow("Failed to fetch module");
  });
});

describe("getChatHistory", () => {
  it("returns parsed chat history", async () => {
    const history = {
      sessionId: 1,
      messages: [{ role: "user", content: "hi" }],
    };
    fm.mock.mockResolvedValue(jsonResponse(history));

    expect(await getChatHistory("mod")).toEqual(history);
  });

  it("returns empty session on 401", async () => {
    // 401 -> fetchWithRefresh tries refresh -> refresh fails -> returns 401
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(errorResponse(403)); // refresh fails

    const result = await getChatHistory("mod");
    expect(result).toEqual({ sessionId: 0, messages: [] });
  });

  it("throws on non-401 error", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getChatHistory("mod")).rejects.toThrow("Failed to fetch chat history");
  });
});

describe("getNextModule", () => {
  it("returns null on 204 No Content", async () => {
    fm.mock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await getNextModule("course", "current")).toBeNull();
  });

  it("returns next_module for nextModuleSlug response", async () => {
    fm.mock.mockResolvedValue(
      jsonResponse({ nextModuleSlug: "mod-2", nextModuleTitle: "Module 2" }),
    );

    expect(await getNextModule("course", "mod-1")).toEqual({
      type: "next_module",
      slug: "mod-2",
      title: "Module 2",
    });
  });

  it("returns unit_complete for completedUnit response", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ completedUnit: 3 }));

    expect(await getNextModule("course", "mod-last")).toEqual({
      type: "unit_complete",
      unitNumber: 3,
    });
  });

  it("throws on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getNextModule("course", "mod")).rejects.toThrow("Failed to fetch next module");
  });
});

describe("getModuleProgress", () => {
  it("returns parsed progress", async () => {
    const progress = {
      module: { id: "1", slug: "test", title: "Test" },
      status: "in_progress",
      progress: { completed: 1, total: 3 },
      lenses: [],
      chatSession: { sessionId: 1, hasMessages: false },
    };
    fm.mock.mockResolvedValue(jsonResponse(progress));

    expect(await getModuleProgress("test")).toEqual(progress);
  });

  it("returns null on 401", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(errorResponse(403)); // refresh fails

    expect(await getModuleProgress("test")).toBeNull();
  });

  it("throws on non-401 error", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getModuleProgress("test")).rejects.toThrow("Failed to fetch module progress");
  });
});

describe("transcribeAudio", () => {
  it("returns transcribed text on success", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ text: "Hello world" }));
    expect(await transcribeAudio(new Blob(["audio"]))).toBe("Hello world");
  });

  it("throws 'Recording too large' on 413", async () => {
    fm.mock.mockResolvedValue(errorResponse(413));
    await expect(transcribeAudio(new Blob())).rejects.toThrow("Recording too large");
  });

  it("throws rate limit error on 429", async () => {
    fm.mock.mockResolvedValue(errorResponse(429));
    await expect(transcribeAudio(new Blob())).rejects.toThrow("Too many requests");
  });

  it("throws generic error on other failures", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(transcribeAudio(new Blob())).rejects.toThrow("Transcription failed");
  });
});

describe("getCourseProgress", () => {
  it("returns parsed course progress", async () => {
    const progress = {
      course: { slug: "course-1", title: "Test Course" },
      units: [
        {
          meetingNumber: 1,
          modules: [
            {
              slug: "mod-1",
              title: "Module 1",
              stages: [],
              status: "completed" as const,
              optional: false,
            },
          ],
        },
      ],
    };
    fm.mock.mockResolvedValue(jsonResponse(progress));

    expect(await getCourseProgress("course-1")).toEqual(progress);
  });

  it("throws on error", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));
    await expect(getCourseProgress("course-1")).rejects.toThrow("Failed to fetch course progress");
  });
});

describe("fetchWithTimeout (via getModule)", () => {
  it("throws RequestTimeoutError when request exceeds timeout", async () => {
    vi.useFakeTimers();

    // Mock fetch to hang and respond to abort signal
    fm.mock.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        }),
    );

    const promise = getModule("test-slug");
    await vi.advanceTimersByTimeAsync(10001);

    await expect(promise).rejects.toThrow(RequestTimeoutError);
    await expect(promise).rejects.toMatchObject({
      url: expect.stringContaining("/api/modules/test-slug"),
      timeoutMs: 10000,
    });

    vi.useRealTimers();
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/api/__tests__/modules.test.ts
```

**Step 3: Commit**

```bash
jj new -m "test: add modules API tests"
```

---

## Task 8: useAuth Hook Tests

**Files:**
- Create: `web_frontend/src/hooks/__tests__/useAuth.test.ts`
- Reference: `web_frontend/src/hooks/useAuth.ts`
- Uses: `web_frontend/src/test/fetchMock.ts`, real `fetchWithRefresh`

**Notes:**
- `renderHook` from `@testing-library/react` to test hooks in isolation.
- Analytics/Sentry functions are no-ops in test env (not production, not initialized).
- `window.location` must be mocked for `login()` test — jsdom's Location doesn't allow safe href assignment.

**Step 1: Write tests**

```typescript
// web_frontend/src/hooks/__tests__/useAuth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  createFetchMock,
  jsonResponse,
  errorResponse,
} from "@/test/fetchMock";
import { useAuth } from "../useAuth";

const fm = createFetchMock();

const mockUser = {
  user_id: 1,
  discord_id: "123456",
  discord_username: "testuser",
  nickname: "Test User",
  email: "test@example.com",
  timezone: "America/New_York",
  availability_local: null,
  tos_accepted_at: "2026-01-01T00:00:00Z",
};

const authenticatedResponse = {
  authenticated: true,
  discord_id: "123456",
  discord_username: "testuser",
  discord_avatar_url: "https://cdn.discordapp.com/avatar.png",
  is_in_signups_table: true,
  is_in_active_group: false,
  user: mockUser,
};

let originalLocation: Location;

beforeEach(() => {
  fm.install();
  originalLocation = window.location;
});

afterEach(() => {
  fm.restore();
  vi.restoreAllMocks();
  // Restore location if it was replaced
  if (window.location !== originalLocation) {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  }
});

describe("useAuth", () => {
  it("starts with isLoading: true", () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("resolves to authenticated state with all fields mapped", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.discordId).toBe("123456");
    expect(result.current.discordUsername).toBe("testuser");
    expect(result.current.discordAvatarUrl).toBe(
      "https://cdn.discordapp.com/avatar.png",
    );
    expect(result.current.isInSignupsTable).toBe(true);
    expect(result.current.isInActiveGroup).toBe(false);
    expect(result.current.user).toEqual(mockUser);
  });

  it("derives tosAccepted from tos_accepted_at", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tosAccepted).toBe(true);
  });

  it("tosAccepted is false when tos_accepted_at is null", async () => {
    const noTos = {
      ...authenticatedResponse,
      user: { ...mockUser, tos_accepted_at: null },
    };
    fm.mock.mockResolvedValue(jsonResponse(noTos));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tosAccepted).toBe(false);
  });

  it("resolves to unauthenticated on non-ok response", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("resolves to unauthenticated on network error", async () => {
    fm.mock.mockRejectedValue(new Error("Network error"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("resolves to unauthenticated when authenticated: false", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ authenticated: false }));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
  });

  it("login() redirects to Discord OAuth URL with params", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ authenticated: false }));

    // Replace location to capture href assignment
    const mockLocation = {
      pathname: "/course/test",
      origin: "http://localhost",
      href: "",
    };
    Object.defineProperty(window, "location", {
      value: mockLocation,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.login();
    });

    expect(mockLocation.href).toContain("/auth/discord");
    expect(mockLocation.href).toContain("next=%2Fcourse%2Ftest");
    expect(mockLocation.href).toContain("origin=");
    expect(mockLocation.href).toContain("anonymous_token=");
  });

  it("logout() POSTs to /auth/logout and resets state", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(fm.callsTo("/auth/logout")).toHaveLength(1);

    const logoutCall = fm.callsTo("/auth/logout")[0];
    expect(logoutCall[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
  });

  it("refreshUser() re-fetches from /auth/me", async () => {
    fm.mock.mockResolvedValue(jsonResponse(authenticatedResponse));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    const updated = {
      ...authenticatedResponse,
      discord_username: "updated-user",
    };
    fm.mock.mockResolvedValue(jsonResponse(updated));

    await act(async () => {
      await result.current.refreshUser();
    });

    expect(result.current.discordUsername).toBe("updated-user");
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/hooks/__tests__/useAuth.test.ts
```

**Step 3: Commit**

```bash
jj new -m "test: add useAuth hook tests"
```

---

## Task 9: useActivityTracker Hook Tests

**Files:**
- Create: `web_frontend/src/hooks/__tests__/useActivityTracker.test.ts`
- Reference: `web_frontend/src/hooks/useActivityTracker.ts`, `web_frontend/src/api/progress.ts`
- Uses: `web_frontend/src/test/fetchMock.ts`, real `sendHeartbeatPing` -> real `fetchWithRefresh`, `vi.useFakeTimers()`

**Notes:**
- `navigator.sendBeacon` must be mocked (not available in jsdom).
- `document.hidden` must be controllable via `Object.defineProperty`.
- Fake timers control `setInterval`, `Date.now()`, and `setTimeout`.
- `sendHeartbeatPing` is fire-and-forget (no error throw) — uses real `fetchWithRefresh` -> mocked `fetch`.

**Step 1: Write tests**

```typescript
// web_frontend/src/hooks/__tests__/useActivityTracker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createFetchMock, jsonResponse } from "@/test/fetchMock";
import { useActivityTracker } from "../useActivityTracker";

const fm = createFetchMock();

const defaultOptions = {
  contentId: "content-1",
  loId: "lo-1",
  moduleId: "module-1",
  isAuthenticated: true,
  contentTitle: "Test Content",
  moduleTitle: "Test Module",
  loTitle: "Test LO",
  heartbeatInterval: 20_000,
  inactivityTimeout: 180_000,
  enabled: true,
};

let sendBeaconMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fm.install();
  fm.mock.mockResolvedValue(jsonResponse({ ok: true }));

  sendBeaconMock = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: sendBeaconMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  fm.restore();
  vi.restoreAllMocks();
});

describe("useActivityTracker", () => {
  it("sends initial heartbeat on mount", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0); // flush async sendHeartbeat

    expect(fm.callsTo("/api/progress/time")).toHaveLength(1);
  });

  it("sends periodic heartbeats while active", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);
    const initial = fm.callsTo("/api/progress/time").length;

    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBeGreaterThan(initial);
  });

  it("stops heartbeats after inactivity timeout", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    // Advance past inactivity timeout
    await vi.advanceTimersByTimeAsync(180_001);
    const callsAfterTimeout = fm.callsTo("/api/progress/time").length;

    // Another heartbeat interval — should NOT send
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBe(callsAfterTimeout);
  });

  it("activity events reset the inactivity timer", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    // Advance close to inactivity timeout
    await vi.advanceTimersByTimeAsync(170_000);

    // Activity resets timer
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    // Advance past original timeout point but within new timeout window
    await vi.advanceTimersByTimeAsync(20_000);
    const callsAtOriginalTimeout = fm.callsTo("/api/progress/time").length;

    // One more interval — should still be active because scroll reset the timer
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fm.callsTo("/api/progress/time").length).toBeGreaterThan(
      callsAtOriginalTimeout,
    );
  });

  it("sends beacon on visibility change to hidden", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(sendBeaconMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/progress/time"),
      expect.any(String),
    );
  });

  it("sends beacon on unmount", async () => {
    const { unmount } = renderHook(() =>
      useActivityTracker(defaultOptions),
    );
    await vi.advanceTimersByTimeAsync(0);

    unmount();

    expect(sendBeaconMock).toHaveBeenCalled();
  });

  it("does nothing when enabled: false", async () => {
    renderHook(() =>
      useActivityTracker({ ...defaultOptions, enabled: false }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(fm.callsTo("/api/progress/time")).toHaveLength(0);
    expect(sendBeaconMock).not.toHaveBeenCalled();
  });

  it("sends beacon on beforeunload", async () => {
    renderHook(() => useActivityTracker(defaultOptions));
    await vi.advanceTimersByTimeAsync(0);

    window.dispatchEvent(new Event("beforeunload"));

    expect(sendBeaconMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/progress/time"),
      expect.any(String),
    );
  });

  it("appends anonymous_token to beacon URL when not authenticated", async () => {
    renderHook(() =>
      useActivityTracker({ ...defaultOptions, isAuthenticated: false }),
    );
    await vi.advanceTimersByTimeAsync(0);

    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(sendBeaconMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/progress\/time\?anonymous_token=.+/),
      expect.any(String),
    );
  });

  it("triggerActivity() resets activity state after timeout", async () => {
    const { result } = renderHook(() =>
      useActivityTracker(defaultOptions),
    );
    await vi.advanceTimersByTimeAsync(0);

    // Go inactive
    await vi.advanceTimersByTimeAsync(180_001);
    const callsWhenInactive = fm.callsTo("/api/progress/time").length;

    // Trigger activity manually
    act(() => {
      result.current.triggerActivity();
    });

    // Next heartbeat should fire
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fm.callsTo("/api/progress/time").length).toBeGreaterThan(
      callsWhenInactive,
    );
  });
});
```

**Step 2: Run tests**

```bash
cd web_frontend && npx vitest run src/hooks/__tests__/useActivityTracker.test.ts
```

**Step 3: Commit**

```bash
jj new -m "test: add useActivityTracker hook tests"
```

---

## Final Verification

After all tasks are complete:

```bash
cd web_frontend && npx vitest run
```

**Expected:** All 15 test files pass (7 existing + 8 new). No test-only methods in production code. Shared fetch mock used consistently.

---

## Execution Notes

**Tasks 2-5 are independent** and can be executed in parallel (pure utilities, no shared dependencies).

**Tasks 6-9 must be sequential:** fetchWithRefresh (6) -> modules (7) -> useAuth (8) -> useActivityTracker (9). Each layer's tests validate that the dependency chain works before the next layer builds on it.

**If tests fail unexpectedly:** The tests are written against existing production code. A failure means either:
1. Bug in test (wrong expectation) — check against source
2. Bug in production code — investigate and decide whether to fix
3. Environment issue (missing mock, jsdom limitation) — adjust test setup
