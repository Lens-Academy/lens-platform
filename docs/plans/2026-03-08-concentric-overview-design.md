# Concentric Course Overview

Experimental page for course creators to visualize the full content hierarchy as an interactive, zoomable graph with concentric rings.

## Goal

Give course creators a bird's-eye view of how courses, modules, and lenses relate — including orphaned content not used by any course. Similar to Obsidian's graph view, but with concentric ring constraints reflecting the data hierarchy.

## Tech Stack

- **`react-force-graph-2d`** — React wrapper around `force-graph` (d3-force on HTML5 Canvas)
- Built-in zoom/pan (scroll-wheel, pinch, click-drag) — no extra work needed
- `dagMode: 'radialout'` for concentric radial layout
- Custom `nodeCanvasObject` for per-tier node rendering

## Data Model

Three tiers arranged as concentric rings from center outward:

| Ring | Node Type | Source | ~Count |
|------|-----------|--------|--------|
| Center | Course | `cache.courses` | 2 |
| Middle | Module | `cache.flattened_modules` (non-lens slugs) | 10 |
| Outer | Lens | Sections with `contentId` within modules | 80 |

### Edges

- **Course → Module**: From course progression (`ModuleRef` items)
- **Module → Lens**: From module sections that have a `contentId`

If two modules reference the same underlying article/video, both edges appear (each lens has a unique `contentId` even if the source material is shared).

### Node metadata

Each node carries:
- `id`: Namespaced identifier (`course:slug`, `module:slug`, `lens:uuid`)
- `type`: `"course"` | `"module"` | `"lens"`
- `title`: Display name
- `slug`: For navigation links
- `orphan`: True if not reachable from any course
- `wip`: True if the module has validation errors
- `file`: Relative path in content repo (for GitHub editor link)
- `file`: Relative path in content repo (for GitHub editor link), e.g. `"Modules/cognitive-superpowers.md"`. Null for courses and lenses.
- `sectionType`: For lenses — raw section type from the processor: `"video"`, `"article"`, `"page"`, etc. (controls color)

## API

### `GET /api/content/graph`

New endpoint in `web_api/routes/content.py`. Assembles graph data from `ContentCache`:

```json
{
  "nodes": [
    {"id": "course:default", "type": "course", "title": "AI Safety Fundamentals", "slug": "default"},
    {"id": "module:cognitive-superpowers", "type": "module", "title": "Cognitive Superpowers", "slug": "cognitive-superpowers", "orphan": false, "wip": false, "file": "Modules/cognitive-superpowers.md"},
    {"id": "lens:550e8400-...", "type": "lens", "title": "Intro to AI Safety", "slug": "cognitive-superpowers", "sectionType": "lens-article", "file": "Articles/intro-to-ai-safety.md"}
  ],
  "links": [
    {"source": "course:default", "target": "module:cognitive-superpowers"},
    {"source": "module:cognitive-superpowers", "target": "lens:550e8400-..."}
  ]
}
```

Logic:
1. Iterate `cache.courses` → create course nodes
2. Iterate `cache.flattened_modules` (skip `lens/` prefixed slugs) → create module nodes
3. For each module, iterate sections with `contentId` → create lens nodes + module→lens edges
4. For each course, iterate progression `ModuleRef` items → create course→module edges
5. Mark modules as `orphan: true` if no course references them
6. Mark modules as `wip: true` if they have `error` set

## Frontend

### Page: `/overview`

File: `web_frontend/src/pages/overview/+Page.tsx`

Full-viewport canvas (no header/footer chrome beyond a floating toolbar).

### Component hierarchy

```
OverviewPage
├── OverviewToolbar (floating top-left)
│   ├── Toggle: Show orphans (default: on)
│   └── Toggle: Show WIP (default: on)
├── ForceGraph2D (full viewport)
└── NodeDetail (floating panel, shown when node focused)
    ├── Title
    ├── Type badge
    ├── "View on platform" link
    └── "Edit on GitHub" link
```

### ForceGraph2D configuration

```tsx
<ForceGraph2D
  graphData={filteredData}
  dagMode="radialout"
  dagLevelDistance={120}
  nodeCanvasObject={paintNode}    // Custom per-tier rendering
  nodePointerAreaPaint={paintArea} // Hit detection matching visual shape
  onNodeClick={handleFocus}
  onBackgroundClick={clearFocus}
  nodeLabel={node => node.title}  // Hover tooltip
  linkColor={() => 'rgba(255,255,255,0.15)'}
  linkWidth={1}
  backgroundColor="#1a1a2e"       // Dark background
  cooldownTicks={100}
  onEngineStop={() => fgRef.current?.zoomToFit(400)}
/>
```

### Node rendering (`paintNode`)

| Tier | Color | Radius | Focused |
|------|-------|--------|---------|
| Course | `#f59e0b` (amber) | 8 | 12 + glow |
| Module | `#3b82f6` (blue), orphan: `#6b7280` (gray) | 5 | 8 + glow |
| Lens (article) | `#10b981` (emerald) | 3 | 5 + glow |
| Lens (video) | `#8b5cf6` (violet) | 3 | 5 + glow |

When a node is focused:
- Connected nodes + edges render at full opacity
- Non-connected nodes + edges dim to 20% opacity
- Focused node gets a subtle glow effect (larger semi-transparent circle behind it)

### Focus behavior

Click a node → set `focusedNodeId` state. This:
1. Computes connected node IDs (direct neighbors only)
2. Passes `nodeCanvasObject` a flag to dim/brighten accordingly
3. Shows `NodeDetail` floating panel near the node with action links
4. Click background or press Escape → clear focus

### Action links in NodeDetail

**"View on platform":**
- Course: `/course/{slug}`
- Module: `/module/{slug}`
- Lens: no direct link (part of module view)

**"Edit on GitHub":**
- `https://github.com/Lens-Academy/lens-edu-relay/blob/staging/{file}`
- Only shown when `file` is available

### Toggles

Use ForceGraph2D's `nodeVisibility`/`linkVisibility` props to hide nodes in place (preserves layout):
- **Show orphans off**: Hide nodes where `orphan: true` and their edges
- **Show WIP off**: Hide nodes where `wip: true` and their edges

## Visual Design

- Dark background (`#1a1a2e`) — graph visualizations read better on dark
- Floating toolbar: semi-transparent dark panel with toggle switches + color legend
- NodeDetail panel: dark card with rounded corners, centered at bottom of viewport
- Edges: thin (`1px`), slightly transparent white, curved via `linkCurvature`

## Non-goals (for now)

- Ring labels along each concentric circle (can add later)
- Learning outcome tier (can add later as ring between modules and lenses)
- Progress data overlay (completion status per node)
- Editing capabilities (drag to reorganize course structure)
- 3D view
