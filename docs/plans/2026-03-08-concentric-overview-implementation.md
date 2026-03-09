# Concentric Course Overview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an interactive `/overview` page that visualizes courses, modules, and lenses as a zoomable concentric ring graph using react-force-graph-2d.

**Architecture:** New backend endpoint `GET /api/content/graph` assembles graph nodes/links from ContentCache. New frontend page at `/overview` renders the graph with `react-force-graph-2d` (dagMode: radialout). Client-side filtering for orphan/WIP toggles.

**Tech Stack:** FastAPI (backend endpoint), react-force-graph-2d (visualization), Vike (routing), Tailwind CSS v4 (toolbar styling)

**Design doc:** `docs/plans/2026-03-08-concentric-overview-design.md`

---

### Task 1: Backend — Graph endpoint

**Files:**
- Modify: `web_api/routes/content.py` (add endpoint at bottom)
- Test: `web_api/tests/test_graph_endpoint.py` (create)

**Step 1: Write failing tests**

Create `web_api/tests/test_graph_endpoint.py`:

```python
# web_api/tests/test_graph_endpoint.py
"""Tests for GET /api/content/graph endpoint."""

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_graph_returns_nodes_and_links():
    """Graph endpoint returns the expected top-level structure."""
    response = client.get("/api/content/graph")
    assert response.status_code == 200
    data = response.json()
    assert "nodes" in data
    assert "links" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["links"], list)


def test_graph_contains_course_nodes():
    """Graph contains a node for each course in the cache."""
    response = client.get("/api/content/graph")
    data = response.json()
    course_nodes = [n for n in data["nodes"] if n["type"] == "course"]
    # conftest has 1 course: "default"
    assert len(course_nodes) == 1
    assert course_nodes[0]["id"] == "course:default"
    assert course_nodes[0]["title"] == "AI Safety Fundamentals"
    assert course_nodes[0]["slug"] == "default"
    assert course_nodes[0]["file"] is None  # courses have no content file


def test_graph_contains_module_nodes():
    """Graph contains a node for each non-lens module."""
    response = client.get("/api/content/graph")
    data = response.json()
    module_nodes = [n for n in data["nodes"] if n["type"] == "module"]
    slugs = {n["slug"] for n in module_nodes}
    # conftest has 5 modules, none with lens/ prefix
    assert slugs == {
        "introduction",
        "core-concepts",
        "advanced-topics",
        "supplementary-reading",
        "final-discussion",
    }
    # Each module carries its file path
    intro = next(n for n in module_nodes if n["slug"] == "introduction")
    assert intro["file"] == "Modules/introduction.md"


def test_graph_contains_lens_nodes():
    """Graph contains a node for each section with a contentId."""
    response = client.get("/api/content/graph")
    data = response.json()
    lens_nodes = [n for n in data["nodes"] if n["type"] == "lens"]
    # conftest modules have these sections with contentId:
    # introduction: video (0102), page (0103)
    # core-concepts: article (0202), page (0203)
    # advanced-topics: page (0302)
    # supplementary-reading: article (0402)
    # final-discussion: page (0502)
    assert len(lens_nodes) == 7


def test_graph_course_to_module_links():
    """Course nodes link to their progression modules."""
    response = client.get("/api/content/graph")
    data = response.json()
    course_links = [
        l for l in data["links"] if l["source"] == "course:default"
    ]
    targets = {l["target"] for l in course_links}
    # conftest course has 5 modules in progression
    assert "module:introduction" in targets
    assert "module:core-concepts" in targets
    assert "module:advanced-topics" in targets
    assert "module:supplementary-reading" in targets
    assert "module:final-discussion" in targets


def test_graph_module_to_lens_links():
    """Module nodes link to their sections (lenses)."""
    response = client.get("/api/content/graph")
    data = response.json()
    intro_links = [
        l for l in data["links"] if l["source"] == "module:introduction"
    ]
    # introduction has 2 sections with contentId
    assert len(intro_links) == 2


def test_graph_orphan_flag():
    """Modules not in any course progression are flagged orphan=True."""
    # All 5 conftest modules are in the course, so none should be orphan
    response = client.get("/api/content/graph")
    data = response.json()
    module_nodes = [n for n in data["nodes"] if n["type"] == "module"]
    orphans = [n for n in module_nodes if n["orphan"]]
    assert len(orphans) == 0


def test_graph_orphan_flag_for_unreferenced_module(api_test_cache):
    """A module not in any course progression is flagged orphan=True."""
    from uuid import UUID
    from core.modules.flattened_types import FlattenedModule

    # Add an extra module not referenced by any course
    api_test_cache.flattened_modules["orphan-module"] = FlattenedModule(
        slug="orphan-module",
        title="Orphan Module",
        content_id=UUID("00000000-0000-0000-0000-000000000901"),
        sections=[],
    )
    response = client.get("/api/content/graph")
    data = response.json()
    orphan_nodes = [
        n for n in data["nodes"] if n["type"] == "module" and n["orphan"]
    ]
    assert len(orphan_nodes) == 1
    assert orphan_nodes[0]["slug"] == "orphan-module"


def test_graph_wip_flag(api_test_cache):
    """Modules with error field set are flagged wip=True."""
    api_test_cache.flattened_modules["introduction"].error = "Some parse error"
    response = client.get("/api/content/graph")
    data = response.json()
    intro = next(
        n for n in data["nodes"]
        if n["type"] == "module" and n["slug"] == "introduction"
    )
    assert intro["wip"] is True


def test_graph_lens_section_type():
    """Lens nodes carry their section type (video, article, page)."""
    response = client.get("/api/content/graph")
    data = response.json()
    lens_nodes = [n for n in data["nodes"] if n["type"] == "lens"]
    types = {n["sectionType"] for n in lens_nodes}
    # conftest has video, article, and page sections
    assert "video" in types
    assert "article" in types
    assert "page" in types
```

**Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest web_api/tests/test_graph_endpoint.py -v`
Expected: All tests FAIL (404 — endpoint doesn't exist)

**Step 3: Implement the endpoint**

Add to the bottom of `web_api/routes/content.py`:

```python
@router.get("/graph")
async def content_graph():
    """Build a graph of courses, modules, and lenses for the overview page.

    Returns nodes (courses, modules, lenses) and links (containment edges)
    structured for react-force-graph-2d.
    """
    from core.modules.flattened_types import ModuleRef

    try:
        cache = get_cache()
    except CacheNotInitializedError:
        raise HTTPException(status_code=503, detail="Content cache not initialized")

    nodes = []
    links = []

    # Collect all module slugs referenced by any course
    referenced_slugs: set[str] = set()
    for course in cache.courses.values():
        for item in course.progression:
            if isinstance(item, ModuleRef):
                referenced_slugs.add(item.slug)

    # Course nodes
    for slug, course in cache.courses.items():
        nodes.append({
            "id": f"course:{slug}",
            "type": "course",
            "title": course.title,
            "slug": slug,
            "orphan": False,
            "wip": False,
            "sectionType": None,
            "file": None,
        })

    # Module nodes + module→lens links
    for slug, module in cache.flattened_modules.items():
        if slug.startswith("lens/"):
            continue

        nodes.append({
            "id": f"module:{slug}",
            "type": "module",
            "title": module.title,
            "slug": slug,
            "orphan": slug not in referenced_slugs,
            "wip": bool(module.error),
            "sectionType": None,
            "file": f"Modules/{slug}.md",
        })

        # Module→lens links (sections with contentId)
        for section in module.sections:
            content_id = section.get("contentId")
            if not content_id:
                continue
            lens_id = f"lens:{content_id}"

            section_type = section.get("type", "page")
            title = (
                section.get("meta", {}).get("title")
                or section.get("title")
                or section_type
            )

            nodes.append({
                "id": lens_id,
                "type": "lens",
                "title": title,
                "slug": slug,
                "orphan": slug not in referenced_slugs,
                "wip": False,
                "sectionType": section_type,
                "file": None,
            })

            links.append({
                "source": f"module:{slug}",
                "target": lens_id,
            })

    # Course→module links
    for slug, course in cache.courses.items():
        for item in course.progression:
            if isinstance(item, ModuleRef):
                if item.slug in cache.flattened_modules:
                    links.append({
                        "source": f"course:{slug}",
                        "target": f"module:{item.slug}",
                    })

    return {"nodes": nodes, "links": links}
```

**Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest web_api/tests/test_graph_endpoint.py -v`
Expected: All 10 tests PASS

**Step 5: Commit**

```
jj new -m "feat: add GET /api/content/graph endpoint for overview page"
jj squash
```

---

### Task 2: Frontend — Install react-force-graph-2d + API client

**Files:**
- Modify: `web_frontend/package.json` (automatic via npm install)
- Create: `web_frontend/src/api/graph.ts`
- Test: `web_frontend/src/api/__tests__/graph.test.ts` (create)

**Step 1: Install the package**

Run: `cd web_frontend && npm install react-force-graph-2d`

**Step 2: Write failing test**

Create `web_frontend/src/api/__tests__/graph.test.ts`:

```typescript
// web_frontend/src/api/__tests__/graph.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createFetchMock,
  jsonResponse,
  errorResponse,
} from "@/test/fetchMock";
import { fetchGraphData, type GraphData } from "@/api/graph";

const fm = createFetchMock();
beforeEach(() => fm.install());
afterEach(() => fm.restore());

const MOCK_GRAPH: GraphData = {
  nodes: [
    {
      id: "course:default",
      type: "course",
      title: "Test Course",
      slug: "default",
      orphan: false,
      wip: false,
      sectionType: null,
      file: null,
    },
    {
      id: "module:intro",
      type: "module",
      title: "Intro",
      slug: "intro",
      orphan: false,
      wip: false,
      sectionType: null,
      file: "Modules/intro.md",
    },
  ],
  links: [{ source: "course:default", target: "module:intro" }],
};

describe("fetchGraphData", () => {
  it("fetches and returns graph data", async () => {
    fm.mock.mockResolvedValueOnce(jsonResponse(MOCK_GRAPH));
    const result = await fetchGraphData();
    expect(result.nodes).toHaveLength(2);
    expect(result.links).toHaveLength(1);
    expect(fm.callsTo("/api/content/graph")).toHaveLength(1);
  });

  it("throws on non-200 response", async () => {
    fm.mock.mockResolvedValueOnce(errorResponse(503));
    await expect(fetchGraphData()).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web_frontend && npx vitest run src/api/__tests__/graph.test.ts`
Expected: FAIL — module `@/api/graph` not found

**Step 3: Implement the API client**

Create `web_frontend/src/api/graph.ts`:

```typescript
// web_frontend/src/api/graph.ts
import { API_URL } from "@/config";

export interface GraphNode {
  id: string;
  type: "course" | "module" | "lens";
  title: string;
  slug: string;
  orphan: boolean;
  wip: boolean;
  sectionType: string | null;
  file: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export async function fetchGraphData(): Promise<GraphData> {
  const res = await fetch(`${API_URL}/api/content/graph`);
  if (!res.ok) throw new Error(`Graph fetch failed: ${res.status}`);
  return res.json();
}
```

**Step 4: Run test to verify it passes**

Run: `cd web_frontend && npx vitest run src/api/__tests__/graph.test.ts`
Expected: PASS

**Step 5: Commit**

```
jj new -m "feat: add react-force-graph-2d and fetchGraphData API client"
jj squash
```

---

### Task 3: Frontend — Graph helper logic (pure functions)

**Files:**
- Create: `web_frontend/src/lib/graphHelpers.ts`
- Test: `web_frontend/src/lib/__tests__/graphHelpers.test.ts` (create)

Note: Filtering is done via `nodeVisibility`/`linkVisibility` props on ForceGraph2D (see Task 5) so the graph layout stays stable when toggling. These helpers extract link IDs safely — d3-force mutates `link.source`/`link.target` from strings to node objects after the simulation runs, so all link access must handle both cases.

**Step 1: Write failing tests**

Create `web_frontend/src/lib/__tests__/graphHelpers.test.ts`:

```typescript
// web_frontend/src/lib/__tests__/graphHelpers.test.ts
import { describe, it, expect } from "vitest";
import { getConnectedIds, linkSourceId, linkTargetId, isNodeVisible } from "@/lib/graphHelpers";
import type { GraphNode } from "@/api/graph";

describe("linkSourceId / linkTargetId", () => {
  it("extracts id from string links", () => {
    const link = { source: "a", target: "b" };
    expect(linkSourceId(link)).toBe("a");
    expect(linkTargetId(link)).toBe("b");
  });

  it("extracts id from object links (post d3-force mutation)", () => {
    const link = { source: { id: "a" }, target: { id: "b" } };
    expect(linkSourceId(link)).toBe("a");
    expect(linkTargetId(link)).toBe("b");
  });
});

describe("isNodeVisible", () => {
  const node = (overrides: Partial<GraphNode>) =>
    ({ id: "x", type: "module", title: "X", slug: "x", orphan: false, wip: false, sectionType: null, file: null, ...overrides } as GraphNode);

  it("shows all nodes when both toggles on", () => {
    expect(isNodeVisible(node({ orphan: true }), true, true)).toBe(true);
    expect(isNodeVisible(node({ wip: true }), true, true)).toBe(true);
  });

  it("hides orphans when showOrphans is off", () => {
    expect(isNodeVisible(node({ orphan: true }), false, true)).toBe(false);
    expect(isNodeVisible(node({ orphan: false }), false, true)).toBe(true);
  });

  it("hides WIP when showWip is off", () => {
    expect(isNodeVisible(node({ wip: true }), true, false)).toBe(false);
    expect(isNodeVisible(node({ wip: false }), true, false)).toBe(true);
  });
});

describe("getConnectedIds", () => {
  const links = [
    { source: "course:c1", target: "module:m1" },
    { source: "module:m1", target: "lens:l1" },
    { source: "module:m2", target: "lens:l2" },
  ];

  it("returns the focused node and its direct neighbors", () => {
    const connected = getConnectedIds("module:m1", links);
    expect(connected).toContain("module:m1");
    expect(connected).toContain("course:c1");
    expect(connected).toContain("lens:l1");
    expect(connected).not.toContain("module:m2");
  });

  it("returns only the node itself if it has no links", () => {
    const connected = getConnectedIds("module:m2", []);
    expect(connected).toEqual(new Set(["module:m2"]));
  });

  it("handles post-mutation object links", () => {
    const mutatedLinks = [
      { source: { id: "course:c1" }, target: { id: "module:m1" } },
      { source: { id: "module:m1" }, target: { id: "lens:l1" } },
    ];
    const connected = getConnectedIds("module:m1", mutatedLinks as any);
    expect(connected).toContain("course:c1");
    expect(connected).toContain("lens:l1");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web_frontend && npx vitest run src/lib/__tests__/graphHelpers.test.ts`
Expected: FAIL — module not found

**Step 3: Implement helper functions**

Create `web_frontend/src/lib/graphHelpers.ts`:

```typescript
// web_frontend/src/lib/graphHelpers.ts
//
// Helpers for the overview graph. All link access goes through
// linkSourceId/linkTargetId because d3-force mutates link.source/target
// from strings to node objects after the simulation runs.

import type { GraphNode } from "@/api/graph";

/** Extract source id from a link (handles both string and post-mutation object). */
export function linkSourceId(link: any): string {
  return typeof link.source === "object" ? link.source.id : link.source;
}

/** Extract target id from a link (handles both string and post-mutation object). */
export function linkTargetId(link: any): string {
  return typeof link.target === "object" ? link.target.id : link.target;
}

/** Whether a node should be visible given current filter toggles. */
export function isNodeVisible(
  node: GraphNode,
  showOrphans: boolean,
  showWip: boolean
): boolean {
  if (!showOrphans && node.orphan) return false;
  if (!showWip && node.wip) return false;
  return true;
}

/** Get the set of node IDs connected to a focused node (including itself). */
export function getConnectedIds(
  focusedId: string,
  links: any[]
): Set<string> {
  const connected = new Set([focusedId]);
  for (const link of links) {
    const source = linkSourceId(link);
    const target = linkTargetId(link);
    if (source === focusedId) connected.add(target);
    if (target === focusedId) connected.add(source);
  }
  return connected;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web_frontend && npx vitest run src/lib/__tests__/graphHelpers.test.ts`
Expected: All PASS

**Step 5: Commit**

```
jj new -m "feat: add graph helper functions (link id extraction, visibility, focus)"
jj squash
```

---

### Task 4: Frontend — Overview page with ForceGraph2D

**Files:**
- Create: `web_frontend/src/pages/overview/+Page.tsx`

This task is UI-heavy and not easily unit-testable (canvas rendering). We'll verify manually with the dev server.

**Step 1: Create the page**

Create `web_frontend/src/pages/overview/+Page.tsx`:

```tsx
// web_frontend/src/pages/overview/+Page.tsx
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { fetchGraphData, type GraphData, type GraphNode } from "@/api/graph";
import {
  getConnectedIds,
  isNodeVisible,
  linkSourceId,
  linkTargetId,
} from "@/lib/graphHelpers";

const GITHUB_BASE =
  "https://github.com/Lens-Academy/lens-edu-relay/blob/staging";

const COLORS = {
  course: "#f59e0b",
  module: "#3b82f6",
  moduleOrphan: "#6b7280",
  lensArticle: "#10b981",
  lensVideo: "#8b5cf6",
  lensPage: "#94a3b8",
  bg: "#1a1a2e",
  dimmed: 0.2,
};

const SIZES: Record<string, number> = {
  course: 8,
  module: 5,
  lens: 3,
};

function nodeColor(node: GraphNode): string {
  if (node.type === "course") return COLORS.course;
  if (node.type === "module")
    return node.orphan ? COLORS.moduleOrphan : COLORS.module;
  if (node.sectionType === "video") return COLORS.lensVideo;
  if (node.sectionType === "article" || node.sectionType === "lens-article")
    return COLORS.lensArticle;
  return COLORS.lensPage;
}

function nodeRadius(node: GraphNode): number {
  return SIZES[node.type] ?? 3;
}

function viewUrl(node: GraphNode): string | null {
  if (node.type === "course") return `/course/${node.slug}`;
  if (node.type === "module") return `/module/${node.slug}`;
  return null;
}

function editUrl(node: GraphNode): string | null {
  if (node.file) return `${GITHUB_BASE}/${node.file}`;
  return null;
}

export default function OverviewPage() {
  const fgRef = useRef<any>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showWip, setShowWip] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    fetchGraphData()
      .then(setGraphData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Escape key clears focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Visibility uses nodeVisibility/linkVisibility props so the layout
  // stays stable when toggling — nodes are hidden, not removed.
  const nodeVisibility = useCallback(
    (node: any) => isNodeVisible(node, showOrphans, showWip),
    [showOrphans, showWip]
  );

  const visibleNodeIds = useMemo(() => {
    if (!graphData) return new Set<string>();
    return new Set(
      graphData.nodes
        .filter((n) => isNodeVisible(n, showOrphans, showWip))
        .map((n) => n.id)
    );
  }, [graphData, showOrphans, showWip]);

  const linkVisibility = useCallback(
    (link: any) => {
      return (
        visibleNodeIds.has(linkSourceId(link)) &&
        visibleNodeIds.has(linkTargetId(link))
      );
    },
    [visibleNodeIds]
  );

  const connectedIds = useMemo(() => {
    if (!focusedId || !graphData) return null;
    return getConnectedIds(focusedId, graphData.links);
  }, [focusedId, graphData]);

  const focusedNode = useMemo(() => {
    if (!focusedId || !graphData) return null;
    return graphData.nodes.find((n) => n.id === focusedId) ?? null;
  }, [focusedId, graphData]);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = nodeRadius(node);
      const color = nodeColor(node);
      const isFocused = !connectedIds || connectedIds.has(node.id);
      const alpha = isFocused ? 1 : COLORS.dimmed;

      ctx.globalAlpha = alpha;

      // Glow for focused node
      if (focusedId === node.id) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 2, 0, 2 * Math.PI);
        ctx.fillStyle = color + "40";
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Label (only at sufficient zoom, or always for courses)
      if (globalScale > 1.5 || node.type === "course") {
        const fontSize = Math.max(10 / globalScale, 1.5);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isFocused ? "#e2e8f0" : "#e2e8f020";
        ctx.fillText(node.title, node.x, node.y + r + 1);
      }

      ctx.globalAlpha = 1;
    },
    [connectedIds, focusedId]
  );

  const paintPointerArea = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const r = nodeRadius(node);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  const handleNodeClick = useCallback((node: any) => {
    setFocusedId((prev) => (prev === node.id ? null : node.id));
  }, []);

  const handleBgClick = useCallback(() => {
    setFocusedId(null);
  }, []);

  const linkColor = useCallback(
    (link: any) => {
      if (!connectedIds) return "rgba(255,255,255,0.15)";
      if (
        connectedIds.has(linkSourceId(link)) &&
        connectedIds.has(linkTargetId(link))
      )
        return "rgba(255,255,255,0.5)";
      return "rgba(255,255,255,0.04)";
    },
    [connectedIds]
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100vh", backgroundColor: COLORS.bg }}
      >
        <p className="text-stone-400">Loading graph...</p>
      </div>
    );
  }

  if (error || !graphData) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100vh", backgroundColor: COLORS.bg }}
      >
        <p className="text-red-400">Error: {error}</p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        dagMode="radialout"
        dagLevelDistance={120}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        nodeVisibility={nodeVisibility}
        linkVisibility={linkVisibility}
        onNodeClick={handleNodeClick}
        onBackgroundClick={handleBgClick}
        nodeLabel={(node: any) => node.title}
        linkColor={linkColor}
        linkWidth={1}
        linkCurvature={0.1}
        backgroundColor={COLORS.bg}
        cooldownTicks={100}
        onEngineStop={() => fgRef.current?.zoomToFit(400, 50)}
      />

      {/* Toolbar */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          padding: "12px 16px",
          borderRadius: 8,
          backgroundColor: "rgba(30, 30, 50, 0.9)",
          display: "flex",
          gap: 16,
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#94a3b8",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
          />
          Orphans
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#94a3b8",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showWip}
            onChange={(e) => setShowWip(e.target.checked)}
          />
          WIP
        </label>

        {/* Legend */}
        <div style={{ display: "flex", gap: 10, marginLeft: 8 }}>
          {[
            { color: COLORS.course, label: "Course" },
            { color: COLORS.module, label: "Module" },
            { color: COLORS.lensArticle, label: "Article" },
            { color: COLORS.lensVideo, label: "Video" },
            { color: COLORS.moduleOrphan, label: "Orphan" },
          ].map(({ color, label }) => (
            <span
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                color: "#64748b",
                fontSize: 11,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: color,
                  display: "inline-block",
                }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Node detail panel */}
      {focusedNode && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 20px",
            borderRadius: 10,
            backgroundColor: "rgba(30, 30, 50, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            gap: 16,
            zIndex: 10,
            maxWidth: "90vw",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: nodeColor(focusedNode),
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 500 }}>
              {focusedNode.title}
            </div>
            <div style={{ color: "#64748b", fontSize: 11 }}>
              {focusedNode.type}
              {focusedNode.orphan ? " · orphan" : ""}
              {focusedNode.wip ? " · wip" : ""}
              {focusedNode.sectionType
                ? ` · ${focusedNode.sectionType}`
                : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
            {viewUrl(focusedNode) && (
              <a
                href={viewUrl(focusedNode)!}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  backgroundColor: "rgba(59, 130, 246, 0.2)",
                  color: "#93c5fd",
                  fontSize: 12,
                  textDecoration: "none",
                }}
              >
                View
              </a>
            )}
            {editUrl(focusedNode) && (
              <a
                href={editUrl(focusedNode)!}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  backgroundColor: "rgba(16, 185, 129, 0.2)",
                  color: "#6ee7b7",
                  fontSize: 12,
                  textDecoration: "none",
                }}
              >
                Edit
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify the page renders**

Run the dev servers if not already running:
```bash
cd web_frontend && npm run dev &
cd .. && python main.py --dev --port 8100 &
```

Navigate to `http://dev.vps:3100/overview` in browser. Verify:
- Graph renders with concentric rings
- Zoom/pan works (scroll wheel, click-drag)
- Nodes are colored by type
- Toolbar toggles filter nodes
- Clicking a node shows the detail panel
- Clicking background clears focus
- "View" and "Edit" links work

**Step 3: Commit**

```
jj new -m "feat: add /overview page with concentric graph visualization"
jj squash
```

---

### Task 5: Frontend — Suppress layout chrome on overview page

The overview page should be full-viewport with no header/footer. Check if the app has a layout wrapper and suppress it for this route.

**Step 1: Check for layout wrapper**

Look at `web_frontend/src/pages/+Layout.tsx` (or equivalent Vike layout file). If it wraps all pages in a header/nav, the overview page needs to opt out.

If the layout adds chrome, create `web_frontend/src/pages/overview/+Layout.tsx`:

```tsx
// web_frontend/src/pages/overview/+Layout.tsx
export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

This overrides the parent layout for just the `/overview` route, giving the graph full viewport.

**Step 2: Verify in browser**

Navigate to `http://dev.vps:3100/overview` — should be full-bleed, no header.

**Step 3: Commit (if changes were needed)**

```
jj new -m "feat: suppress layout chrome on /overview page"
jj squash
```

---

### Task 6: Lint and build check

**Step 1: Run frontend checks**

```bash
cd web_frontend && npm run lint && npm run build
```

Fix any lint/type errors.

**Step 2: Run backend checks**

```bash
cd .. && ruff check . && ruff format --check .
```

Fix any issues.

**Step 3: Run all tests**

```bash
.venv/bin/pytest web_api/tests/test_graph_endpoint.py -v
cd web_frontend && npx vitest run
```

**Step 4: Commit fixes if any**

```
jj new -m "fix: lint and type errors in overview feature"
jj squash
```

---

### Task 7: Manual verification with Chrome DevTools MCP

**Step 1: Ensure servers are running**

```bash
./scripts/list-servers
```

Start if needed (backend on :8100, frontend on :3100).

**Step 2: Navigate and verify**

Use Chrome DevTools MCP to navigate to `http://dev.vps:3100/overview`. Take a screenshot. Verify:

1. Graph renders with concentric rings (courses center, modules middle, lenses outer)
2. Scroll-wheel zoom works
3. Click-drag pan works
4. Toggle "Orphans" off/on — orphan nodes appear/disappear
5. Toggle "WIP" off/on — WIP nodes appear/disappear
6. Click a module node — detail panel appears with View/Edit links
7. Click background — detail panel dismisses
8. Legend shows correct colors

Report any issues and fix them.
